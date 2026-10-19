import { pgcApi, downloadVersion, PgcError, importProjectArchive as importProjectArchiveApi } from '@/lib/pgc/client';
import { koubouApi, KoubouError } from '@/lib/koubou/client';
import { bizApi } from '@/lib/biz/client';
import type { SubscriptionTier } from '@/lib/biz/types';
import { isCreditError } from '@/lib/credit-error';
import { nextLowBalanceState, unlockedByBalance } from '@/lib/subscription/low-balance';
import { readProjectIdFromSearch, syncProjectToUrl, withProjectParam, stripReplayTemplateFromUrl } from '@/lib/project-url';
import { canvasItemsToAssets, canvasItemToAsset, versionsToVersions, versionCreditsMap } from '@/lib/pgc/map';
import type { CanvasGenTask, CanvasGenFailure, CanvasWriteFromUrlRequest, ImportProjectData } from '@/lib/pgc/types';
import { resolveAssetUrl } from '@/lib/pgc/url';
import { resolvePreviewUrl } from '@/lib/pgc/preview-url';
import { apiPath } from '@/lib/basePath';
import { childPosition, cascadePosition, avoidOverlap, cardSize, type XY, type Box } from '@/lib/card-layout';
import { positionBatchItem } from '@/lib/canvas-batch';
import { kindToImportType, mediaKindToAssetKind, eventAssets, type ReadyMedia } from '@/lib/media-import';
import { lineageForTask } from '@/lib/gen-lineage';
import { agentProvenance, provenanceKindOf } from '@/lib/agent-provenance';
import { GEN_STATE_LOST } from '@/lib/gen-retry';
import type { ServerEvent } from '@/koubou/protocol';
import { makeAsset } from '@/lib/assets';
import { newPlaceholderId, isPlaceholderId } from '@/lib/ids';
import { versionArchiveName } from '@/lib/download';
import { type AssetKind } from '@/lib/asset-kind';
import { track, projectPublicId } from '@/lib/analytics';
import { createInitialKoubouState } from './types';
import { sessionSlotKey } from './session-slot';
import { sessionSnapshot, restoreSnapshot } from './session-snapshot';
import type { Asset, GenTask, GenTaskKind, Version, KoubouState, ServerState, ReplayState, PendingImportAsset } from './types';
import { isDerivedGenKind } from './types';

// 异步生成的 item_id 由后端确定性组成 `<前缀><task_id>`(pgc docs/api/canvas.md:视频轮询
// task_id `8f2a1c9b3d4e` ↔ item_id `vid-8f2a1c9b3d4e`,3D / 绑骨 / 重纹理同构)——
// 故换台设备、无痕窗口、清了 localStorage 也能从资产列表把在飞任务接回来接着轮询,
// 而不是把它当孤儿处理(spec 2026-08-06-orphan-gen-task-no-delete)。
// 画布界面退役后前端不再发起 rig / retexture / audio 生成,但服务端可能仍有老应用发起的在飞 item,
// 照样按前缀接回推进(spec 2026-10-19 第二阶段计划 T1)。
//
// `match` 的作用**不是**区分前缀(四个前缀互斥,不可能互相认错),而是:前缀只是命名约定、
// type 才是权威 —— 两者不符的脏卡(如 type=image 却叫 vid-*)一律拒认,不据前缀臆造任务。
//
// 刻意不收 `spr-`(精灵图,契约 canvas.md 有该前缀且**在飞就有服务端卡**):前端未接该生成类型。
// 将来接入 sprite 时必须同时补进本表,否则每次开项目都会把在飞的精灵图判成失败。
const DISCOVERABLE: { prefix: string; kind: GenTaskKind; match: (a: Asset) => boolean }[] = [
  { prefix: 'vid-', kind: 'video', match: (a) => a.kind === 'video' },
  { prefix: 'm3d-', kind: 'model3d', match: (a) => a.threeDType === 'model3d' },
  { prefix: 'rig-', kind: 'rig3d', match: (a) => a.threeDType === 'rig3d' },
  { prefix: 'tex-', kind: 'retexture', match: (a) => a.threeDType === 'model3d' },
  // 音频**必须再认一道 `gtask-`**:服务端两种音频卡同用 `aud-` 前缀 —— 同步是 `aud-{hex12}`
  // (canvas_gen_service:2385)、异步任务是 `aud-{task_id}` 而 task_id 恒 `gtask-*`(:3227)。
  // 只判 `aud-` 会把一张卡在 generating 的同步音频也反推成任务,taskId 取成那串 hex12,
  // 轮询一个不存在的任务 404 到 MAX_FAILS,再把本来好端端的卡标成失败。
  { prefix: 'aud-', kind: 'audio', match: (a) => a.kind === 'audio' && a.id.startsWith('aud-gtask-') },
];

// agent 产物的落位选项(血缘归因结果):sourceItemId=源资产(树形落位 + parentId);refItemIds=其余引用。
// 坐标虽已无人展示,仍随 reference 写回后端(契约不变,见 CLAUDE.md「资产数据层」)
export interface GenPlacement { sourceItemId?: string; refItemIds?: string[] }

// 无源资产时的落位起点。画布在时取视口中心;画布退役后那个注册表恒为空、一直回落到原点,这里直接写明
const PLACEMENT_ORIGIN: XY = { x: 0, y: 0 };

// 仅依赖状态切片,避免与 ServerActions 形成类型环;actions 通过本地闭包互相调用,从不经 get() 取 action
type StoreSlice = KoubouState & ServerState;
type Set = (partial: Partial<StoreSlice>) => void;
type Get = () => StoreSlice;

// ready 版本集合的稳定指纹(顺序无关):版本消耗积分的拉取判据。
// 只认 ready —— 构建中的行不参与切段,它反复出现在轮询结果里也不该触发请求。
function readyVersionKey(versions: Version[]): string {
  return versions.filter((v) => v.status === 'ready').map((v) => v.id).sort().join(',');
}

function latestVersion(versions: Version[]): Version | null {
  return versions.reduce<Version | null>(
    (latest, version) => latest == null || version.index > latest.index ? version : latest,
    null,
  );
}

// 统一错误兜底:401(未登录)只置 authRequired 触发跳转/本地提示,不当报错;其余 PgcError 写 toast(→Toast),非 PgcError 照抛(便于发现 bug)
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) {
      // 401 = 未登录:只置 authRequired(见 useAuthGuard:生产跳转、本地弹 warning 提示),不弹红色报错 Toast
      if (e.status === 401) set({ authRequired: true });
      // 积分不足:弹充值引导模态,不走 Toast(源头分流,见设计稿 2026-07-05)
      else if (isCreditError(e)) set({ creditModalOpen: 'insufficient' });
      else set({ toast: { code: e.code, message: e.message, kind: 'error' } });
    } else throw e;
  }
}

// 无项目时自动建项目的默认名(维持「平台恒有 ≥1 项目」不变式;用户/agent 可后续改名);studio-prelude 新建项目亦复用。
// 与 pgc-server DEFAULT_PLACEHOLDER_NAME(app/services/project_service.py)共享契约:服务端 auto-name 只对该名字生效,改任一侧必须同步
export const DEFAULT_PROJECT_NAME = 'Untitled game';

export function createServerActions(set: Set, get: Get) {
  // loadProjects 并发重入护卫:StrictMode 双挂载/重复 bootstrap 下,防第二个并发调用回灌覆盖刚建出的项目或重复建项目(瞬态控制态,不入 store)
  let loadingProjects = false;

  // 异步生成任务兜底常量(可调):超时上限 / 连续 poll 失败上限。
  // 35 分钟 = 后端契约默认 30 分钟 + 5 分钟余量(网络/排队抖动):pgc docs/api/agent.md 写明
  // 任务最长存活 AGENT__TASK_TIMEOUT_SECONDS(默认 30 分钟)、**任何任务最终必达 ready/failed 终态**。
  // 比它短就会在答案到来前撤走 —— 慢的 3D(Tripo 排队时十几分钟)落进盲区,用户付了钱而画布上什么都没有。
  // ⚠️ 这个值与后端那项配置耦合:运维改大 AGENT__TASK_TIMEOUT_SECONDS 时这里要跟着改
  const DEADLINE_MS = 35 * 60 * 1000;
  const MAX_FAILS = 5;
  const DERIVED_RETRY_BASE_MS = 3_000;
  const DERIVED_RETRY_MAX_MS = 60_000;
  // 单项目导入去重表上限:该表随 persist 落 localStorage,只保留最近 N 条文件名防无界膨胀
  const IMPORTED_CAP = 500;
  // 任务级终态失败:服务端转发上游 status,失败时 item 可能缺失或仍标 generating,须先于 item 判定
  const FAILED_TASK_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired']);

  // genTasks 单一写入口:同步内存工作切片与按项目持久化映射,保证刷新后可重连。
  // 顺带拍一份**在飞占位卡快照**(spec 2026-08-07-inflight-placeholder-persist):
  // 任务持久而卡不持久,刷新后 restoreGenTasks 会因「卡不在」把任务当残留剪掉 —— 付了钱的生成从此无人推进。
  // 跟着这个唯一写入口走,清理就是自动的:任务终结/被删 → 下一次 commit 落新表 → 快照随之重算,
  // 不需要第二个清理点,也不可能复活用户删掉的卡(删卡会摘掉它的 GenTask)
  const commitGenTasks = (next: GenTask[]) => {
    const pid = get().currentProjectId;
    if (pid == null) { set({ genTasks: next }); return; }
    const referenced = new Set(next.map((t) => t.itemId));
    // 只快照占位卡:真实 item 刷新后由 loadCanvas 带回,前端再存一份既多余又会与服务端打架
    const cards = get().assets.filter((a) => isPlaceholderId(a.id) && referenced.has(a.id));
    set({
      genTasks: next,
      genTasksByProject: { ...get().genTasksByProject, [String(pid)]: next },
      inflightCardsByProject: { ...get().inflightCardsByProject, [String(pid)]: cards },
    });
  };

  // 孤儿失败的构造:restoreGenTasks 的兜底与 recheckAsset 的复判共用一份,免得两处漂
  const orphanFailure = () => ({ code: GEN_STATE_LOST, category: 'client_state', message: '', retryable: true });

  // 轮询兜底该挂什么 failure。**占位卡不入孤儿之列** —— 与 restoreGenTasks 那条既有不变式同源:
  // 它没有服务端 item,标成孤儿后用户点「重新检查」,recheckAsset 会先把它置回 generating 并清 failure,
  // 而 loadCanvas 的 alivePlaceholders 只保「在轮询中 or error」,两条都不成立 → 卡被整表替换抹掉,
  // finally 里也找不回来标不回失败 = **静默消失**(增量评审 B-I2 实跑复现)。
  // 占位卡回退成 failure=null:路由走 editForm(开预填表单),卡还在,与本轮改动前一致
  const bailFailure = (itemId: string) => (isPlaceholderId(itemId) ? undefined : orphanFailure());

  // 刷新 / 切项目后用最新 assets 对账:仅恢复仍 generating 的任务(fails 重置),顺带剪除已完成/已删的持久化残留
  const restoreGenTasks = (pid: number) => {
    if (get().currentProjectId !== pid) return;   // await 期间已切项目
    const saved = get().genTasksByProject[String(pid)] ?? [];
    // 刷新后 assets 是 loadCanvas 带回的服务端那份,在飞占位卡不在其中(pgc 在 generating 阶段不返回 item)
    // —— 不先接回来的话,下面那道「卡在不在且 generating」的剪枝会把它的任务当残留剪掉,
    // 付了钱的生成从此无人推进(spec 2026-08-07-inflight-placeholder-persist)。
    // 两道门保证不复活不该活的:①只接**仍被持久化任务引用**的(用户删卡会摘掉任务 ⟹ 快照里也没有);
    // ②只接当前 assets 里没有的(幂等,切项目来回不重复插)
    const wanted = new Set(saved.map((t) => t.itemId));
    const have = new Set(get().assets.map((a) => a.id));
    // 第三道门 c.status === 'generating':今天快照里的卡恒为 generating(唯一能把 referenced 卡改成
    // error 的 failGenTask 同一步就摘了任务,中间无 commit),但那是**隐式**不变式 ——
    // 显式判一次就变成结构性的,还顺带挡住手改 localStorage 的脏数据(评审 M9)
    const revived = (get().inflightCardsByProject[String(pid)] ?? [])
      .filter((c) => wanted.has(c.id) && !have.has(c.id) && c.status === 'generating');
    if (revived.length) set({ assets: [...get().assets, ...revived] });
    const assetsById = new Map(get().assets.map((a) => [a.id, a]));
    const restored = saved
      .filter((t) => assetsById.get(t.itemId)?.status === 'generating')
      .map((t) => ({ ...t, fails: 0, nextPollAt: undefined }));
    const restoredIds = new Set(restored.map((task) => task.itemId));
    const discovered = get().assets.flatMap((asset): GenTask[] => {
      if (asset.status !== 'generating' || restoredIds.has(asset.id)) return [];
      // startedAt 取当下:跨设备拿不到真实提交时刻,而后端保证 30 分钟内必达终态,重新起表只会多等不会漏
      const hit = DISCOVERABLE.find((d) => asset.id.startsWith(d.prefix) && d.match(asset));
      if (!hit) return [];
      return [{ itemId: asset.id, kind: hit.kind, taskId: asset.id.slice(hit.prefix.length), startedAt: Date.now(), fails: 0 }];
    });
    const live = [...restored, ...discovered];
    commitGenTasks(live);
    // 孤儿 generating 资产(服务端仍 generating,而 id 里也没有可反推的 task_id):
    // item 终态只能由轮询驱动落 ready,无任务可恢复即永不完成,故不能留永远转圈的加载卡 ——
    // 但**不删服务端 item**:判据错一次就是不可恢复的数据丢失(后端无 restore 端点),
    // 而就地标失败同样达到目的、还留着重试入口,用户想清掉可以自己删(删除权归用户)。
    // pending_ 占位卡属同会话在途请求(本就无任务),不在孤儿之列
    const liveIds = new Set(live.map((t) => t.itemId));
    const orphanIds = get().assets
      .filter((a) => a.status === 'generating' && !liveIds.has(a.id) && !isPlaceholderId(a.id))
      .map((a) => a.id);
    // 不弹 Toast:卡面已就地显示失败态与重试入口,而卡不再被删 → Toast 会在**每次打开项目**时
    // 重弹一次(改动前删掉了故只弹一次),那比不弹更糟。信息由卡片自己承担。
    // 挂 GEN_STATE_LOST 而非 null:让卡面说得出「读不到状态」(而不是笼统的"生成失败"),
    // 并据此把按钮换成不花钱的「重新检查」、且拦住 discardFailedCard 去删仍在飞的那份
    if (orphanIds.length) markAssetsFailed(orphanIds, orphanFailure());
  };

  const generationFailureToast = (failure?: CanvasGenFailure | null) => failure?.message
    ? { code: failure.code || 'GEN_FAILED', message: failure.message, kind: 'error' as const }
    : { code: 'GEN_FAILED', message: 'Generation failed, please try again', kind: 'error' as const };

  // 异步生成失败:卡片**就地转失败态**(不再删卡)+ Toast + 从 genTasks 移除。
  // 服务端那份 failed item 也**不再删**(此前 deleteRemote=true 会删):删了失败卡就永远活不过刷新,
  // 而保留它正好让 loadCanvas 把失败卡带回(映射层 statusOf('failed')→'error' 已接好),
  // 且用户后续删这张卡时 DELETE 打得到真实 item,不会 404(spec 2026-08-03-canvas-gen-failure-retry)。
  // failure=上游回传的结构化失败原因(如内容合规):卡上显示其本地化 message,Toast 同步提醒;无则回落通用文案。
  const failGenTask = (itemId: string, taskId: string, failure?: CanvasGenFailure | null) => {
    markAssetsFailed([itemId], failure ?? null);
    // 积分不足与同步路径同口径:弹充值模态、**不弹 Toast**(源头分流,设计稿 2026-07-05)。
    // 这里必须单独接一次 —— isCreditError 的其余调用点全在 catch 里,只看得到同步抛出的
    // PgcError;而受理时不预留额度的 provider(suno-music:金额要等 runner 问网关才知道,
    // 故 402 挪到了任务终态)余额不足是在**轮询**里以 failed + CREDIT_INSUFFICIENT 回来的,
    // 那些分支一个都走不到。不接的话用户拿到的是一条未本地化的「生成失败」且没有充值入口,
    // 而同一个人去生成视频/3D(受理期就 reserve)却能正常看到充值引导。
    // 判据是**精确码**不是 isCreditError 的 /credit|insufficient/i —— 刻意不复用。
    // 那条正则存在的理由是同步路径只拿得到 PgcError 的 code、「后端未定稿」(见 credit-error.ts),
    // 只好模糊匹配;而这条路拿到的是结构化 failure,后端 category=billing 下**有三个码**:
    // CREDIT_INSUFFICIENT(余额不足)、CREDIT_CONFLICT(hold key 幂等冲突)、
    // CREDIT_RESERVE_FAILED(预留失败,503 时可重试)。后两个与余额无关,正则却全都匹配 ——
    // 会在用户余额充足时弹充值引导,把一次系统故障说成「你该充钱了」。按 category 判同样错。
    // 它们落到下面的 Toast 分支,如实显示后端给的原因。
    //
    // 余额耗尽对这个人就是耗尽了,与同步路径的 guard 一视同仁。任务只剩 agent 登记这一个来源,
    // 拿不到资产类型,弹窗回退到不带类型的通用态,而不是瞎猜一个。
    if (failure?.code === 'CREDIT_INSUFFICIENT') {
      set({ creditModalOpen: 'insufficient' });
    } else {
      set({ toast: generationFailureToast(failure) });
    }
    commitGenTasks(get().genTasks.filter((g) => g.taskId !== taskId));
  };

  // ---- 项目 ----
  const loadCanvas = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    const data = await pgcApi.listCanvasItems(pid);
    if (get().currentProjectId !== pid) return;   // await 期间已切项目:丢弃旧项目响应,避免覆盖当前项目资产
    // 传当前 assets:整表替换时保留「前端所有」的坐标与血缘(服务端缺失时)——
    // reference 回写是 fire-and-forget,后台刷新可能赶在它落库之前(见 map.ts::preserveFrontendOwned)。
    // 服务端的 groups 字段(分组框)随画布界面一起退役,不再读
    // 在飞占位卡不在服务端(它没有 item),整表替换会抹掉它 —— 而 GenTask 还指着那个 id,
    // 超时/失败时 markAssetsFailed 就打在空处(spec 2026-08-06-gen-task-deadline-and-placeholder)。
    // 留两类占位卡:① 还被 genTasks 引用的(在飞);② 已转失败态的 ——
    // failGenTask 标失败的同时就把 GenTask 摘了,只看「任务还在」的话下一次刷新会把刚转成
    // 失败的卡又抹掉,「就地转失败」就只在瞬时成立(评审 Important 1)。
    // 两者都只是 get().assets 的子集 —— 只能留住已在表里的卡,结构上不可能复活已删的卡
    const polling = new Set(get().genTasks.map((t) => t.itemId));
    const alivePlaceholders = get().assets.filter(
      (a) => isPlaceholderId(a.id) && (polling.has(a.id) || a.status === 'error'),
    );
    // 孤儿兜底判失败的是**服务端真实卡**,而服务端那份仍是 generating(本轮刻意不删)——
    // 直取服务端会把它翻回 generating,又没有任务指着它 = 永远转圈,标失败等于白标(评审 I1)。
    // 判据要求「无 live 任务」:一旦任务被发现/恢复,就该以服务端的 generating 为准继续轮询
    const stuckFailed = new Map(get().assets
      .filter((a) => a.status === 'error' && !isPlaceholderId(a.id) && !polling.has(a.id))
      .map((a) => [a.id, a] as const));
    set({
      assets: [
        ...canvasItemsToAssets(data.items, get().assets)
          // 服务端仍 generating 而本地已判失败(孤儿兜底)→ 保住本地失败态,别翻回转圈
          .map((a) => (a.status === 'generating' && stuckFailed.has(a.id)
            ? { ...a, status: 'error' as const, failure: stuckFailed.get(a.id)!.failure ?? null }
            : a)),
        ...alivePlaceholders,
      ],
    });
  };

  // 本地 Koubou 调试:版本列表以本地磁盘为准(checkpoint 只落磁盘、不在 PGC 登记),
  // 经 /api/local-preview/{pid}/versions 扫描;映射成最小 Version(无封面/摘要)
  const fetchLocalVersions = async (pid: number): Promise<Version[]> => {
    const res = await fetch(apiPath(`/api/local-preview/${pid}/versions`), { credentials: 'include' });
    if (!res.ok) return [];
    const env = (await res.json()) as { data?: { items?: { version: number; created_at: string }[] } };
    return (env.data?.items ?? []).map((it) => ({
      // 磁盘上的 checkpoint 都是已落地快照,恒 ready(本地调试无 building 中间态)
      id: `localv_${it.version}`, index: it.version, label: `V${it.version}`, summary: '',
      createdAt: it.created_at, current: false, status: 'ready', assetKeys: [], game: { title: '', palette: '' },
    }));
  };

  const loadVersions = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    const localMode = !!process.env.NEXT_PUBLIC_KOUBOU_BASE_URL;
    const versions = localMode ? await fetchLocalVersions(pid) : versionsToVersions((await pgcApi.listVersions(pid)).items);
    if (get().currentProjectId !== pid) return;   // 同上:await 期间已切项目则丢弃
    const current = versions.find((v) => v.current) ?? versions[versions.length - 1] ?? null;
    // listVersions **会**返回未就绪的版本(观测到的是 status:'building'、created_at 为空) —— 早先
    // 「只返回 ready 版本」的注释是错的(依据是缺陷 14391311 的线上现象,未经后端文档确认):
    // 那条半成品行进了列表却无人再拉第二次。
    // 现在由 useCanvasPolling 按「列表里存在非 ready 行」驱动轮询推进至 ready。见 spec 2026-08-31。
    // 出新版本(旧列表非空,排除冷启动首载)→ 预览无条件切到最新:改完立刻看效果,即使用户正停留在旧版本
    const prev = get().versions;
    const prevIds = new Set(prev.map((v) => v.id));
    const hasNew = prev.length > 0 && versions.some((v) => !prevIds.has(v.id));
    // 接口顺序不是产品语义:最新版本以契约字段 index 判定。
    const latest = latestVersion(versions);
    const active = get().activeVersionId;
    const coldLoad = prev.length === 0 && active == null;
    const nextActive = hasNew ? latest?.id ?? null
      : coldLoad ? latest?.id ?? null
      : (active ?? current?.id ?? latest?.id ?? null);
    set({
      versions: versions.map((v) => ({ ...v, current: v.id === nextActive })),
      activeVersionId: nextActive,
    });
    // 消耗积分按「定稿时刻」切段(见 spec 2026-08-31-version-credits-breakdown),段只在新版本
    // 定稿时才变。故只在 ready 集合变化时拉——构建期 pollVersions 每 2.5s 调一次本函数,
    // 无脑搭车等于每 2.5s 一个请求;空列表两侧同为空串,空项目不打无谓请求。
    if (readyVersionKey(prev) !== readyVersionKey(versions)) void loadVersionCredits();
  };

  // 版本消耗积分:独立端点供数,失败静默(装饰性信息,为它弹 Toast 会打断主流程,同 refreshBalance)。
  // **刻意不设在途守卫**:本 action 的触发是一次性事件(某版本定稿),不是 pollVersions 那种
  // 「每 2.5s 必再跑」的轮询 —— 在飞时吞掉后来者等于永久丢失那次刷新(v2 在飞期间 v3 定稿、
  // 或旧项目在飞挡住新项目)。落库是整张 map 全量覆盖且幂等,晚到者覆盖早到者无害。
  const loadVersionCredits = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    // 本地 koubou 快照没有 credits 概念,拉了必然 404
    if (process.env.NEXT_PUBLIC_KOUBOU_BASE_URL) return;
    try {
      const data = await pgcApi.getVersionCredits(pid);
      // await 后切项目:丢弃。version_id 是项目内序号(v1/v2),跨项目必然撞 id,
      // 少了这道校验就是把上一项目的数字盖到新项目的同名行上
      if (get().currentProjectId !== pid) return;
      set({ versionCreditsById: versionCreditsMap(data?.items ?? []) });
    } catch { /* 静默:时间线照常渲染,下次版本变化再试 */ }
  };

  const selectProject = async (id: number) => guard(set, async () => {
    // 注:switchProjectSession 是 store action,这里通过 get() 拿不到(actions 闭包);改由 useKoubouConnection 在 currentProjectId 变化时换会话。
    // 同步重置会话态:currentProjectId 与 messages 分属不同 owner(此处 vs switchProjectSession),
    // 若仅切 currentProjectId 而留旧 messages,会出现"已切到新项目但 messages 仍是上一项目"的中间帧,破坏不变式。
    // 故在切项目的同一次 set 内清空会话态,保证不变式"messages 恒属于 currentProjectId";新项目真实快照随后由 switchProjectSession 载入。
    // genTasks: [] 刻意不经 commitGenTasks —— 切项目只清内存工作切片,保留 genTasksByProject[旧pid] 持久化(切回可重连);新项目任务随后由 restoreGenTasks 写入
    // 回放语义分流(spec 2026-07-14 断点续播),与 currentProjectId 同一次 set 内决断:
    // ① enterReplay 编排在途(replay.projectId===id):不动 replay,快照灌入由 enterReplay 自己做;
    // ② 其余情况一律重算 —— 目标项目有未完成进度标记则**恢复**(灌快照 + playing,useKoubouConnection
    //    因 replayActive 早退出,不建连不种子防剧透);没有则置 null(回放中切走即**挂起**,进度已随检查点持久化)
    const s0 = get();
    const inFlight = s0.replay != null && s0.replay.projectId === id;
    const prog = s0.replayProgressByProject[String(id)];
    const snap = s0.koubouByProject[sessionSlotKey(id, s0.backend)];
    const resumed: ReplayState | null = !inFlight && prog ? {
      phase: 'playing', templateId: prog.templateId, projectId: id, sessionId: prog.sessionId,
      total: 0, cursor: 0, speed: 1, resumeAfterSequence: snap?.lastSequence ?? 0,
    } : null;
    set({
      ...createInitialKoubouState(), currentProjectId: id, assets: [], versions: [], activeVersionId: null, versionCreditsById: {}, genTasks: [],

      ...(inFlight ? {} : { replay: resumed }),
      // 恢复路径自灌快照:回放期 useKoubouConnection 早退出,不会替我们 switchProjectSession
      // 四个会话字段一起搬(形状归一见 session-snapshot):少搬 subagents,回放断点恢复出来的
      // 历史里子代理卡片就不回显 —— 与本次要修的 bug 同一个症状
      ...(resumed && snap ? { sessionId: snap.sessionId || prog.sessionId, lastSequence: snap.lastSequence, ...restoreSnapshot(snap) } : {}),
    });
    // 页签↔项目绑定:URL 展示用 public_id(不暴露明文主键),由数值 id 映回;createProject/deleteProject 回退复用此路径
    syncProjectToUrl(get().projects.find((p) => p.id === id)?.public_id ?? null);
    // 分享工作台自愈:fork 卡在 provisioning(当时前端没走完 finalize,如认证抖动/中途关页)时,
    // 打开项目自动补收口(finalize 幂等,复制源画布 + 回写版本指针)。非分享 fork 的 provisioning
    // (如 replay 开通中)调它只 404,吞掉即可;自愈是纯增强,任何失败都不得阻断进入项目。
    // 须在 loadCanvas/loadVersions 之前 await:收口后画布/版本才拉得到数据。
    const selected = get().projects.find((p) => p.id === id);
    if (selected?.status === 'provisioning' && !inFlight) {
      try {
        const fin = await pgcApi.workbenchShare.finalize(id);
        set({ projects: get().projects.map((x) => (x.id === id ? { ...x, status: fin.status, current_version_id: fin.current_version_id } : x)) });
      } catch {
        // 404(非分享 fork)/网络错误:静默放弃,画布保持现状,后端 sweeper 兜底
      }
    }
    await Promise.all([loadCanvas(), loadVersions()]);
    restoreGenTasks(id);
    // 压缩包导入中断续跑:画布已载入,静默补齐剩余素材(fire-and-forget,不阻塞切项目)
    void resumeImportQueue(id);
  });

  const loadProjects = async () => {
    // 并发重入护卫:已在途则直接返回(检查—置位间无 await,原子);避免 StrictMode 双挂载下回灌覆盖与重复建项目
    if (loadingProjects) return;
    loadingProjects = true;
    try {
      await guard(set, async () => {
        try {
          const data = await pgcApi.listProjects();
          set({ projects: data.items });
          // 选定优先级:本页签 URL ?project(页签↔项目绑定) > 持久化的最近使用 > 列表第一个
          // URL token 是展示用 public_id(亦容旧数值链),解析为内部数值 id
          const token = typeof window === 'undefined' ? null : readProjectIdFromSearch(window.location.search);
          const fromUrl = token == null ? null
            : (data.items.find((p) => p.public_id === token || String(p.id) === token)?.id ?? null);
          const cur = get().currentProjectId;
          const stillThere = cur != null && data.items.some((p) => p.id === cur);
          const pick = fromUrl ?? (stillThere ? cur! : (data.items[0]?.id ?? null));
          if (pick != null && pick !== cur) await selectProject(pick);
          else if (pick != null && get().assets.length === 0) { await Promise.all([loadCanvas(), loadVersions()]); restoreGenTasks(pick); void resumeImportQueue(pick); }
          // 无任何项目(新用户/删光):自动建默认项目,使 currentProjectId 落地 → WS 连上 → ws-ticket 发起,否则死工作台
          else if (pick == null) await createProject(DEFAULT_PROJECT_NAME);
          // 其余情况:当前项目未变且已有数据,跳过重复拉取
          // 上方 await 期间用户可能已通过 UI 切到别的项目:此时 pick 已过期,写回会造成 URL ↔ store 失配,故先校验再写
          // (自动建项目后 currentProjectId=新id≠pick(null),此处提前返回跳过 syncProjectToUrl(null);URL 已由 createProject 内 selectProject 同步)
          if (get().currentProjectId !== pick) return;
          // 无论来源,选定结果写回本页签 URL(展示用 public_id,由数值 id 映回;URL 中非法/已删除的 id 由此被纠正)
          syncProjectToUrl(pick == null ? null : (data.items.find((p) => p.id === pick)?.public_id ?? null));
        } finally {
          set({ booting: false });   // 首拉结束(成功或失败)即撤全局加载层
        }
      });
    } finally {
      loadingProjects = false;
    }
  };

  const createProject = async (name: string) => guard(set, async () => {
    const p = await pgcApi.createProject(name);
    set({ projects: [p, ...get().projects] });
    await selectProject(p.id);
  });

  // 仅补全项目列表:拉用户全量项目并并入 projects,绝不改 currentProjectId / URL / 画布。
  // 供 prelude / remix 入口用——这些入口 force-create 单个新项目后,若不补全则侧栏列表
  // 只剩新建项(bug #13088343)。
  // 列表补全是纯增强:**任何失败都不得抛出**,否则会阻断已建项目进入工作台(如 remix 成功路径
  // 在 await 本函数后才撤 booting,抛错会卡住加载层)。故自带 try/catch 永不抛——401 置 authRequired,
  // 其余吞掉(projects 至少含新建项/既有列表,刷新仍可补齐)。
  const refreshProjectList = async () => {
    try {
      const data = await pgcApi.listProjects();
      // 以服务端全量为基底,把内存已有但全量未含的项目(刚建、服务端列出前的竞态窗口)补在最前,按 id 去重保序
      const seen = new Set(data.items.map((p) => p.id));
      const extras = get().projects.filter((p) => !seen.has(p.id));
      set({ projects: [...extras, ...data.items] });
    } catch (e) {
      if (e instanceof PgcError && e.status === 401) set({ authRequired: true });
      // 其余错误(网络 TypeError / 5xx 等)吞掉:列表补全失败不阻断进入,刷新走 loadProjects 可补齐
    }
  };

  const renameProject = async (id: number, name: string) => guard(set, async () => {
    const p = await pgcApi.updateProject(id, { name });
    set({ projects: get().projects.map((x) => (x.id === id ? p : x)) });
  });

  // 首条 prompt 自动命名(对齐 Claude app):当前项目名仍为默认占位名时 fire-and-forget 调
  // pgc auto-name(服务端 LLM 起名 + 条件更新防覆盖手动改名)。失败静默——保持默认名,
  // 名字未变则下条消息天然重试;绝不走 guard/Toast,不影响发送主链路。
  const autoNameProject = async (prompt: string) => {
    const { currentProjectId, projects } = get();
    if (currentProjectId == null || !prompt.trim()) return;
    const current = projects.find((p) => p.id === currentProjectId);
    if (!current || current.name !== DEFAULT_PROJECT_NAME) return;
    try {
      const p = await pgcApi.autoNameProject(currentProjectId, prompt);
      // 应用前复查本地仍是默认名:请求在途期间用户可能已手动改名(其 PATCH 与本次
      // auto-name 落库顺序不定),迟到的 renamed 响应不能用旧 LLM 名覆盖手动名。
      const latest = get().projects.find((x) => x.id === p.id);
      if (p.renamed && latest && latest.name === DEFAULT_PROJECT_NAME) {
        set({ projects: get().projects.map((x) => (x.id === p.id ? p : x)) });
      }
    } catch {
      // 静默:命名是 best-effort 增强,失败不提示、不重试(下条消息按名字判定自然重触发)
    }
  };

  const deleteProject = async (id: number) => guard(set, async () => {
    await pgcApi.deleteProject(id);
    const rest = get().projects.filter((p) => p.id !== id);
    const { [String(id)]: _removed, ...restGenTasks } = get().genTasksByProject;
    const { [String(id)]: _removedAgent, ...restAgentTasks } = get().agentTasksByProject;   // eslint 解构剔除,_ 前缀标记未用
    const { [String(id)]: _removedQueue, ...restImportQueue } = get().importQueueByProject;   // 同步剔除待导入队列
    const { [String(id)]: _removedInflight, ...restInflight } = get().inflightCardsByProject;   // 同步剔除在飞占位卡快照
    set({ projects: rest, genTasksByProject: restGenTasks, agentTasksByProject: restAgentTasks, importQueueByProject: restImportQueue, inflightCardsByProject: restInflight });
    if (get().currentProjectId === id) {
      const next = rest[0]?.id ?? null;
      if (next != null) await selectProject(next);
      // 删光最后一个项目:维持「平台恒有 ≥1 项目」不变式,自动建默认项目(否则 currentProjectId 置 null 又回到死工作台)。
      // createProject 接管 projects/currentProjectId/URL/画布/版本 的落地,旧的手动重置被完全覆盖
      else await createProject(DEFAULT_PROJECT_NAME);
    }
  });

  // ---- 资产落位 ----
  // 坐标虽已无人展示,仍随 reference 写回后端(契约不变);落位算法沿用 card-layout,与旧数据同一口径。
  // 已有卡的真实包围盒(按 kind 取尺寸):喂给 avoidOverlap 做「真实 AABB + GAP」判定。extra=同批已落位的卡
  const occupiedBoxes = (extra: Box[] = []): Box[] =>
    [...get().assets.map((a) => ({ ...a.position, ...cardSize(a.kind) })), ...extra];

  // 单卡落位目标:有源资产→其右侧树形;否则→原点级联;placed 为同批已落位 Box(含尺寸)。
  // 父 / 兄弟均按各自 kind 取真实尺寸(cardSize)喂给 childPosition,使纵向堆叠按真实底边接续、不重叠。
  const placeTarget = (opts: GenPlacement | undefined, placed: Box[]): XY => {
    const existing = get().assets;
    const parent = opts?.sourceItemId ? existing.find((e) => e.id === opts.sourceItemId) : undefined;
    if (parent) {
      const siblings: Box[] = [
        ...existing.filter((e) => e.parentId === parent.id).map((s) => ({ ...s.position, ...cardSize(s.kind) })),
        ...placed,
      ];
      return childPosition({ ...parent.position, ...cardSize(parent.kind) }, siblings);
    }
    return cascadePosition(PLACEMENT_ORIGIN, placed.length);
  };

  // 血缘字段:源卡 → parentId + source:'derived';其余引用 → refIds。
  // 占位卡 / agent 自动导入两处共用同一份,避免各写一遍写漂
  const lineageFields = (opts?: GenPlacement) => ({
    ...(opts?.sourceItemId ? { parentId: opts.sourceItemId, source: 'derived' as const } : {}),
    ...(opts?.refItemIds?.length ? { refIds: opts.refItemIds } : {}),
  });

  // agent 异步生成的占位卡:提交即入 assets(generating),真实 item 回来后由 adoptAgentItem 原位替换。
  // id 用 pending_ 前缀标识"尚无服务端 item"
  const addGenPlaceholder = (kind: AssetKind, opts?: GenPlacement): string => {
    const id = newPlaceholderId();
    const position = avoidOverlap({ ...placeTarget(opts, []), ...cardSize(kind) }, occupiedBoxes());
    set({ assets: [...get().assets, {
      ...makeAsset(kind, { position }), id, key: id, status: 'generating' as const,
      ...lineageFields(opts),
    }] });
    return id;
  };

  const removeGenPlaceholders = (ids: string[]) =>
    set({ assets: get().assets.filter((a) => !ids.includes(a.id)) });

  // 生成失败:卡片**就地转失败态**而不是删掉(spec 2026-08-03-canvas-gen-failure-retry)。
  // 用户为一次生成付了积分、等了几分钟,失败后不该只剩一条 4 秒 Toast —— 卡留在原位,
  // 由 GenErrorBody 展示 failure.message(后端已本地化的可读原因)。
  // 同步路径传占位卡 id,异步路径传真实 item id,两者共用这一个出口。
  // 用 map 而非重建:在飞期间被用户删掉的卡已不在 assets 里,天然不会"复活"。
  const markAssetsFailed = (ids: string[], failure: CanvasGenFailure | null) =>
    set({
      assets: get().assets.map((a) =>
        ids.includes(a.id) ? { ...a, status: 'error' as const, failure, progress: undefined } : a,
      ),
    });

  // 占位卡 → 真实 item_id 卡(upsert):loadCanvas 可能已抢先把同 item_id 拉上来,
  // 故按 item_id 判存:已存在则原位更新(保留前端坐标)+ 删占位卡;否则把占位卡替换为真实卡(沿用其坐标)并回写 reference。
  const adoptAgentItem = (pid: number, placeholderId: string, asset: Asset) => {
    const prev = get().assets.find((a) => a.id === placeholderId);
    const anchor = prev?.position;
    // 「N 个新资产」角标记的是占位卡 id,而这里正把卡换成真实 item_id ——
    // 不迁移的话 offscreenIds 在 assets 里找不到它,产物落定那一刻角标自己消失,
    // 而「agent 的产物落在离屏、给个指路」正是它要解决的场景(终审 rv-agent-badge)。
    // 这里是占位卡 → 真实卡的唯一收口点,一处改覆盖 registerAgentGenTask 与 pollGenTasks 两条路;
    // 用户自己发起的路径(文本卡 / 上传)的占位卡本就不在角标里,includes 判定天然放过
    // 血缘、溯源与坐标同理**归前端所有**:agent 异步任务的 canvas item 由 pgc 自建(vid-/m3d-{task_id}),
    // 服务端那份 reference 里没有前端归因出的血缘、也没有从工具入参提取的溯源 ——
    // 取占位卡上的,别被服务端的 undefined 冲掉
    const lineage = {
      ...(prev?.parentId ? { parentId: prev.parentId, source: 'derived' as const } : {}),
      ...(prev?.refIds?.length ? { refIds: prev.refIds } : {}),
      ...(prev?.provenance ? { provenance: prev.provenance } : {}),
    };
    const rest = get().assets.filter((a) => a.id !== placeholderId);
    const idx = rest.findIndex((a) => a.id === asset.id);
    if (idx >= 0) {
      // loadCanvas 抢先:原位更新,保留其坐标(位置归前端所有),不重复 add
      const next = rest.slice();
      const merged = { ...next[idx], ...asset, position: next[idx].position, ...lineage };
      next[idx] = merged;
      set({ assets: next });
      // 与 else 分支同样回写:只留在内存等于白连 —— 下一次 loadCanvas 整表替换就冲掉,
      // 用户看到「产物回来时有连线、刷新就没了」。仅在真有「前端所有」的字段可写时发,
      // 避免每次抢先都白打一次 PATCH;判「lineage 非空」而非逐字段列举,免得它日后加字段还要回来改这行
      // (溯源就是这么加进来的:纯文生的 agent 卡没有血缘,那份工具入参同样只活在内存里)。
      // 走批量端点(单条也走):它同时写 reference 与顶层 canvas_x/canvas_y —— 坐标口径两套并存,
      // 只写 reference 那套会让服务端列留旧值(约束 5)
      if (Object.keys(lineage).length > 0) void pgcApi.batchUpdateCanvasItems(pid, [positionBatchItem(merged)]).catch(() => {});
    } else {
      // 占位卡还在 → 原位接管;占位卡已被 loadCanvas 抹掉 → 视口中心按真实尺寸避让,别压在已有卡上
      const position = anchor ?? avoidOverlap({ ...PLACEMENT_ORIGIN, ...cardSize(asset.kind) }, occupiedBoxes());
      const placed: Asset = { ...asset, position, ...lineage };
      set({ assets: [...rest, placed] });
      void pgcApi.batchUpdateCanvasItems(pid, [positionBatchItem(placed)]).catch(() => {});   // fire-and-forget 回写坐标(同上,带顶层坐标)
    }
  };

  // agent 生成资产自动导入资产列表:原点兜底落位 → import 端点按 preview_url 落库 → 并入 assets + 记去重。
  // import 端点 server-side GET preview_url 取字节,与 agent 桶布局解耦(早期按文件名读桶的实现已废弃)。
  // 并发契约:调用方(importFromLiveEvent)串行 promise chain + 此处 importedByProject 去重早返回,保证同名不并发重入,无需额外锁。
  const importGeneratedAsset = async ({ filename, path, kind, previewUrl, taskId }: ReadyMedia) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const key = String(pid);
    // 去重键 = 完整 asset_path(同名不同路径互不误杀);兼容历史条目(旧版按 basename 记录)
    const imported = get().importedByProject[key] ?? [];
    if (imported.includes(path) || imported.includes(filename)) return;
    const sourceUrl = resolveAssetUrl(previewUrl);   // 相对 /preview 补 pgc 绝对前缀;绝对 URL 原样透传
    if (!sourceUrl) return;                           // 无 preview_url 无法导入;不记去重,后续可重试
    // 血缘归因:按 taskId 回溯提交这次生成的工具入参,把它用的源 url match 回画布卡。
    // 归因来自 agent 实际入参(不是"上一轮 @过谁"的猜测),没命中就不连线 —— 宁可少连不错连。
    const lineage = taskId ? lineageForTask(get().messages, taskId, get().assets) : {};
    // 创作溯源:同一次回溯(submitInputForTask 同一个 tool part)顺路取整份工具入参落库。
    // 定位不到(无 taskId / 历史分页没加载到那条提交)→ undefined,则整个键不下发
    // (spec 2026-08-06-agent-asset-provenance;at 记的是导入时刻 —— 与后端 created_at 的
    //  「建卡时间」口径不同,不可互相顶替,见 agent-provenance.ts 的说明)
    const provKind = provenanceKindOf(kind);
    const provenance = taskId && provKind
      ? agentProvenance(get().messages, taskId, provKind, new Date().toISOString())
      : undefined;
    // 命中源卡 → 与用户自发起派生同一套落位(父卡右侧树形);未命中 → 保持视口中心兜底
    const { x, y } = avoidOverlap(
      { ...placeTarget(lineage, []), ...cardSize(kind) },
      occupiedBoxes(),
    );
    const body: CanvasWriteFromUrlRequest = {
      source_url: sourceUrl,                     // 请求参数:后端 server-side GET 该 URL 取字节
      type: kindToImportType(kind),
      name: filename,                            // 资产展示名:用 agent 返回的文件名(import 端点 name 缺省为 null,会回落到 uuid)
      canvas_x: Math.round(x), canvas_y: Math.round(y),   // 视口中心来自 screenToFlowPosition 为浮点,后端 canvas_x/y 是 int,取整再传
      reference: {
        source_filename: filename,               // 元数据:后端原样回显,mapper 读回 Asset.sourceFilename 供溯源
        ...(lineage.sourceItemId ? { parent_id: lineage.sourceItemId } : {}),
        ...(lineage.refItemIds?.length ? { ref_item_ids: lineage.refItemIds } : {}),
        ...(provenance ? { provenance } : {}),   // 创作溯源:搭这次创建回写的顺风车落库,零额外请求
      },
    };
    const item = await pgcApi.writeCanvasItemFromUrl(pid, body);
    // 去重键先记、且**不受下面那道项目守卫管辖**:表按 pid 键(与「当前是哪个项目」无关),
    // 而此刻卡在服务端已经建好了。跟着守卫一起跳过的话,切回该项目时 importFromLiveEvent
    // 重扫历史、去重表为空 → 二次 POST → 画布上两张同素材的卡,刷新也在(增量评审 Important-1)。
    // 去重表加上限:该表被 persist 落 localStorage(~5MB 配额)且只增不减,裁掉最旧的以防长期活跃项目无界膨胀;
    // 被裁掉的极旧文件名理论上可能重复导入(多一张卡),权衡后可接受
    set({
      importedByProject: { ...get().importedByProject, [key]: [...(get().importedByProject[key] ?? []), path].slice(-IMPORTED_CAP) },
    });
    // await 后必校验上下文(仓库 10+ 处同款):import 端点要服务端去拉字节,秒级往返 ——
    // 期间切项目的话,这张属于旧项目的卡会落进新项目画布(边被 selectCanvasEdges 过滤掉,
    // 卡本体留着,刷新才消失)。spec 成功标准 9 与 plan T3 都点过这条,但用例从未落地
    if (get().currentProjectId !== pid) return;
    set({
      // 落位与血缘归前端所有:服务端刚回显的 reference 已含上面下发的血缘,此处直接用 mapper 结果
      // (溯源展开在 mapper 结果之后 = 本地这份恒覆盖回显;两者同源 —— 就是上面那次请求发出去的,
      //  这么写只为在服务端漏回显时面板也立即有值,不必等下一次刷新)
      assets: [...get().assets, { ...canvasItemToAsset(item), position: { x, y }, ...lineageFields(lineage), ...(provenance ? { provenance } : {}) }],
    });
  });

  // 压缩包导入素材的类型白名单:域内枚举直传,域外(后端新增形态)传 null 由后端按 content-type 推断
  const IMPORT_TYPES = ['image', 'video', 'audio', 'model3d'] as const;
  // 导入中止控制器:仅上传阶段持有;上传完成(项目已建成)即置 null,取消随之失效。
  // 模块级单飞:同一时刻至多一个导入(弹窗是唯一入口,导入中弹窗不可再提交)
  let importAbort: AbortController | null = null;
  // 完成态展示时长:素材处理完后弹窗停留「导入已完成」再关闭
  const IMPORT_DONE_DELAY_MS = 1200;

  // 待落画布队列落库:total 恒为该次导入的素材总数(还原进度用),items 为剩余;跑空删键,避免持久化 blob 残留
  const commitImportQueue = (pid: number, total: number, items: PendingImportAsset[]) => {
    const { [String(pid)]: _prev, ...rest } = get().importQueueByProject;
    set({ importQueueByProject: items.length ? { ...rest, [String(pid)]: { total, items } } : rest });
  };

  // 队列续跑单飞:同一项目同时只允许一个导入循环(首次导入与 resume 竞态、切项目反复触发)
  const importingQueue = new Set<number>();

  // 逐条把队列素材落画布:成功/永久失败(无 source_url)即从持久化队列移除;
  // 网络类失败保留在队列(下次进入项目重试)。进度写入 importArchiveStatus 驱动弹窗:
  // baseDone=中断前已完成数(首次导入为 0),使续跑弹窗从上次进度继续而非归零。
  const runImportQueue = async (pid: number, items: PendingImportAsset[], total: number, baseDone: number) => {
    let done = 0;
    let failed = 0;
    if (importingQueue.has(pid)) return { done, failed };
    importingQueue.add(pid);
    try {
      // 从落位原点级联;occupied 以已有资产(带真实尺寸)起步(续跑时画布非空),随写入增长防重叠
      const occupied: Box[] = occupiedBoxes();
      for (const [i, asset] of items.entries()) {
        if (get().currentProjectId !== pid) return { done, failed };   // 每轮 await 后复查;剩余队列已持久化,切回续跑
        const sourceUrl = resolveAssetUrl(asset.sourceUrl);
        if (!sourceUrl) { failed += 1; commitImportQueue(pid, total, items.slice(i + 1)); continue; }
        const size = cardSize(mediaKindToAssetKind(asset.type));
        const pos = avoidOverlap({ ...cascadePosition(PLACEMENT_ORIGIN, i), ...size }, occupied);
        occupied.push({ ...pos, ...size });
        try {
          const item = await pgcApi.writeCanvasItemFromUrl(pid, {
            source_url: sourceUrl,
            // 域内枚举直传;域外(后端新增形态)传 null 由后端按 content-type 推断(对齐素材库导入)
            type: (IMPORT_TYPES as readonly string[]).includes(asset.type)
              ? (asset.type as (typeof IMPORT_TYPES)[number]) : null,
            name: asset.name,
            canvas_x: Math.round(pos.x), canvas_y: Math.round(pos.y),   // 后端 int,取整
            // source 同素材库导入那处:不填的话面板报「Generated」,且拖一下卡就被
            // assetReference 固化进服务端。压缩包里的素材是用户上传进来的,故记 uploaded(Nick 拍板)
            reference: { import_rel_path: asset.relPath, source: 'uploaded' },   // 溯源 + 续跑去重键:后端原样回显
          });
          done += 1;
          commitImportQueue(pid, total, items.slice(i + 1));
          if (get().currentProjectId !== pid) return { done, failed };
          set({
            assets: [...get().assets, { ...canvasItemToAsset(item), source: 'uploaded' }],   // 同上:不押在回显上
            importArchiveStatus: { step: 'importing_assets', progress: 1, done: baseDone + done, total },
          });
        } catch { failed += 1; }   // 网络类失败留在队列,下次进入项目重试
      }
      // 全部处理完(含仅剩失败项):清队列,失败项不无限重试挂账
      commitImportQueue(pid, total, []);
      return { done, failed };
    } finally {
      importingQueue.delete(pid);
    }
  };

  // 中断续跑:进入项目且画布已载入后调用。按 import_rel_path 与画布已有资产去重
  // (中断可能发生在"写入已达服务端、队列尚未移除"的窗口),再续跑剩余队列。
  // 全程驱动 importArchiveStatus(弹窗自动挂载,进度从中断处继续),完整走 importing_assets → done → 延迟清态。
  const resumeImportQueue = async (pid: number) => {
    const saved = get().importQueueByProject[String(pid)];
    // 用户主导的导入在途(弹窗已亮)时不抢状态通道;届时 selectProject 再触发即续上
    if (!saved || importingQueue.has(pid) || get().importArchiveStatus != null) return;
    const existing = new Set(get().assets.map((a) => a.importRelPath).filter(Boolean));
    const remaining = saved.items.filter((a) => !existing.has(a.relPath));
    commitImportQueue(pid, saved.total, remaining);
    if (!remaining.length) return;
    const baseDone = saved.total - remaining.length;
    set({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: baseDone, total: saved.total } });
    try {
      const { done, failed } = await runImportQueue(pid, remaining, saved.total, baseDone);
      if (get().currentProjectId !== pid) return;   // 中途切走:剩余已持久化,finally 清态收起弹窗
      if (failed > 0) {
        set({ toast: { code: 'IMPORT_ASSETS_PARTIAL', message: `${failed} asset(s) could not be added to the canvas`, kind: 'error' } });
      }
      set({ importArchiveStatus: { step: 'done', progress: 1, done: baseDone + done, total: saved.total } });
      await new Promise((r) => setTimeout(r, IMPORT_DONE_DELAY_MS));
    } finally {
      set({ importArchiveStatus: null });
    }
  };

  // 导入外部压缩包为新项目:上传(可取消,带进度) → 并入项目列表并切过去 → 素材逐条落画布。
  // 不用 guardRethrow:主动取消(ABORTED)须静默——不写 toast、不弹 Toast,
  // 但仍 rethrow 让弹窗回表单态;其余错误按 guardRethrow 同构分支处理。
  const importProjectArchive = async (file: File, name: string) => {
    const controller = new AbortController();
    importAbort = controller;
    set({ importArchiveStatus: { step: 'uploading', progress: 0, done: 0, total: 0 } });
    try {
      const data: ImportProjectData = await importProjectArchiveApi(
        file, name,
        // 进度只在仍处 uploading 时写入(abort 竞态窗口内的迟到回调直接丢弃)
        (ratio) => {
          if (get().importArchiveStatus?.step === 'uploading') {
            set({ importArchiveStatus: { step: 'uploading', progress: ratio, done: 0, total: 0 } });
          }
        },
        controller.signal,
      );
      importAbort = null;   // 项目已建成,进入不可取消阶段
      set({
        // 项目创建成功即提示(素材落画布是后续增强,不阻塞用户感知)
        toast: { code: 'PROJECT_IMPORTED', message: 'New project created', kind: 'success' },
        importArchiveStatus: { step: 'creating', progress: 1, done: 0, total: data.assets.length },
      });
      // ImportProjectData 是 ProjectData 超集:摘取列表字段并入 projects(与 createProject 同构)
      const p = {
        id: data.id, public_id: data.public_id, name: data.name,
        cover_url: data.cover_url, cover_source: data.cover_source,
        current_version_id: data.current_version_id, status: data.status,
        created_at: data.created_at, updated_at: data.updated_at,
      };
      set({ projects: [p, ...get().projects] });
      await selectProject(data.id);
      if (get().currentProjectId !== data.id) return;   // await 期间用户已切走:放弃落画布
      set({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 0, total: data.assets.length } });
      // 队列先持久化再逐条落画布:页面中断(刷新/关闭)后剩余部分由 resumeImportQueue 续跑(bug 13494008)
      const queue: PendingImportAsset[] = data.assets.map((a) => ({
        sourceUrl: a.source_url, type: a.type, name: a.name, relPath: a.rel_path,
      }));
      commitImportQueue(data.id, queue.length, queue);
      const { done, failed } = await runImportQueue(data.id, queue, queue.length, 0);
      if (get().currentProjectId !== data.id) return;   // 队列中途切走:剩余部分已持久化,切回续跑
      if (failed > 0) {
        set({ toast: { code: 'IMPORT_ASSETS_PARTIAL', message: `${failed} asset(s) could not be added to the canvas`, kind: 'error' } });
      }
      // 完成态:弹窗展示「导入已完成」,停留后由 finally 统一清态;resolve 延后到停留结束
      set({ importArchiveStatus: { step: 'done', progress: 1, done, total: data.assets.length } });
      await new Promise((r) => setTimeout(r, IMPORT_DONE_DELAY_MS));
    } catch (e) {
      if (e instanceof PgcError && e.code !== 'ABORTED') {
        // guardRethrow 同构分支:401→authRequired / 积分→充值模态 / 其余→Toast
        if (e.status === 401) set({ authRequired: true });
        else if (isCreditError(e)) set({ creditModalOpen: 'insufficient' });
        else set({ toast: { code: e.code, message: e.message, kind: 'error' } });
      }
      throw e;   // ABORTED 与其余错误都 rethrow:弹窗据 reject 回表单态
    } finally {
      importAbort = null;
      set({ importArchiveStatus: null });
    }
  };

  // 取消导入:仅上传阶段有效(项目未建成,abort 即干净回滚);其余阶段 controller 已置 null,天然 no-op
  const cancelImportArchive = () => { importAbort?.abort(); };

  // agent 在对话里提交 video/3d 生成任务(media.task_submitted)→ 资产列表即时落 generating 占位卡,
  // 复用 PGC 轮询端点拿真实 item_id 原位替换 + 登记 GenTask,后续由 pollGenTasks 推进到 ready/失败。
  // 触发去重靠 agentTasksByProject(持久);卡片用真实 item_id 作身份 → run.finished 后 loadCanvas 整表替换按同 id 天然合并不重复。
  const registerAgentGenTask = async (taskId: string, kind: 'video' | 'model3d') => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const key = String(pid);
    if ((get().agentTasksByProject[key] ?? []).includes(taskId)) return;   // 已处理(重渲/重连重放/历史重建)
    if (get().genTasks.some((t) => t.taskId === taskId)) return;           // 同会话内已在途

    // 收窄成字面量类型(而非宽 AssetKind):它同时要喂给落位与溯源,后者只收四类生成类别
    const assetKind = kind === 'model3d' ? ('3d' as const) : ('video' as const);
    // 血缘归因:按 taskId 回溯提交这次生成的工具入参(source_url / ref_image_urls 等),把源 url match 回画布卡。
    // 在**落占位卡之前**算:命中源卡则占位卡直接落在源卡右侧并带连线,产物回来 adoptAgentItem 原位替换不跳位;
    // 未命中(纯文生 / 外部 url)则保持原样——视口中心 + 避让、不连线
    const lineage = lineageForTask(get().messages, taskId, get().assets);
    const placeholderId = addGenPlaceholder(assetKind, lineage);
    // 创作溯源:同一次回溯取整份工具入参,先挂占位卡,由 adoptAgentItem 携带到真实卡
    // (同失败路径的做法;此时 at 是提交登记时刻,比同步导入那条更接近真实生成时刻)
    const provenance = agentProvenance(get().messages, taskId, assetKind, new Date().toISOString());
    if (provenance) {
      set({ assets: get().assets.map((a) => (a.id === placeholderId ? { ...a, provenance } : a)) });
    }

    let task;
    try {
      task = kind === 'video' ? await pgcApi.pollVideo(pid, taskId) : await pgcApi.pollModel3d(pid, taskId);
    } catch (e) {
      // 首拉 RPC 失败(网络/PgcError):移除占位卡,不记去重(允许后续重渲重试);PgcError 由外层 guard 转 Toast
      if (get().currentProjectId === pid) removeGenPlaceholders([placeholderId]);
      throw e;
    }
    if (get().currentProjectId !== pid) return;   // await 期间切项目:画布已清空,占位卡随之消失

    // 首拉 RPC 成功 → 记去重(无论后续 item 有无 / 任务失败)
    set({ agentTasksByProject: { ...get().agentTasksByProject, [key]: [...(get().agentTasksByProject[key] ?? []), taskId] } });

    const it = task.item ?? null;
    const asset = it ? canvasItemToAsset(it) : null;
    // 任务级失败(item 常缺失或标 error):卡就地转失败态 + Toast(透传 failure),与其余失败路径同款。
    // 已知真实 item 时先 adopt(把占位卡换成真实 item id)再标失败 —— 卡片身份与服务端一致,
    // 用户删它时 DELETE 打得到、刷新后也能被 loadCanvas 带回;服务端那份不再删(见 failGenTask 注释)。
    if (FAILED_TASK_STATUSES.has(task.status) || asset?.status === 'error') {
      if (asset) adoptAgentItem(pid, placeholderId, asset);
      markAssetsFailed([asset?.id ?? placeholderId], task.failure ?? asset?.failure ?? null);
      set({ toast: generationFailureToast(task.failure ?? asset?.failure) });
      return;
    }
    if (!asset) {
      // 提交瞬间上游未就绪:保留占位卡,登记 GenTask(itemId=占位卡 id),由 pollGenTasks 首次拿到 item 时适配真实 id
      commitGenTasks([...get().genTasks, { itemId: placeholderId, kind, taskId, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
      return;
    }
    // 拿到 item:占位卡 → 真实 item_id 卡(upsert);仍 generating 才登记轮询(已 ready 则首拉即完成)
    adoptAgentItem(pid, placeholderId, asset);
    if (asset.status !== 'ready') {
      commitGenTasks([...get().genTasks, { itemId: asset.id, kind, taskId, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
    }
  });

  // 在途守卫:上一轮未归还时 interval 再触发直接跳过,防后端变慢(单轮 > 间隔)时叠加并发同请求(审计 C1)
  type GenPollScope = 'all' | 'base' | 'derived';
  let pollingBaseTasks = false;
  let pollingDerivedTasks = false;

  // 任务种类到 PGC 幂等轮询端点的唯一分派，避免派生任务误走普通 model3d 路径。
  const pollCanvasGenTask = (pid: number, task: GenTask): Promise<CanvasGenTask> => {
    if (task.kind === 'video') return pgcApi.pollVideo(pid, task.taskId);
    if (task.kind === 'audio') return pgcApi.pollAudioTask(pid, task.taskId);
    if (task.kind === 'model3d') return pgcApi.pollModel3d(pid, task.taskId);
    if (task.kind === 'rig3d') return pgcApi.pollRig3d(pid, task.taskId);
    return pgcApi.pollRetexture(pid, task.taskId);
  };

  // 派生失败必须保留失败卡和服务端 item；用户从原始模型重新 POST 才是一次新重试。
  const settleDerivedFailure = (task: GenTask, asset: Asset, failure?: CanvasGenFailure | null) => {
    set({
      assets: get().assets.map((current) => (current.id === task.itemId
        ? {
            ...current,
            ...asset,
            position: current.position,
            parentId: current.parentId ?? asset.parentId,
            referenceLinks: asset.referenceLinks ?? current.referenceLinks,
            source: 'derived' as const,
            failure: failure ?? asset.failure,
          }
        : current)),
      toast: generationFailureToast(failure),
    });
    commitGenTasks(get().genTasks.filter((current) => current.taskId !== task.taskId));
  };

  // 轮询一轮:并行推进所有 generating 任务(每任务独立 try/catch,一个卡住/失败不拖累同轮其余),含超时 / 连续失败兜底
  const pollGenTasks = async (scope: GenPollScope = 'all') => {
    const includeBase = scope !== 'derived';
    const includeDerived = scope !== 'base';
    if ((includeBase && pollingBaseTasks) || (includeDerived && pollingDerivedTasks)) return;
    const pid = get().currentProjectId; if (pid == null) return;
    if (includeBase) pollingBaseTasks = true;
    if (includeDerived) pollingDerivedTasks = true;
    const now = Date.now();
    const tasks = [...get().genTasks].filter((task) => {
      const derived = isDerivedGenKind(task.kind);
      const inScope = derived ? includeDerived : includeBase;
      return inScope && (task.nextPollAt == null || task.nextPollAt <= now);
    });
    // 结算侧唯一漏斗:任务离队(ready / 失败 / 超时兜底,含派生任务)即意味着后端已结算或退款 →
    // 本轮结束时按"任务集合是否缩小"判定一次,不在四五个终态分支各撒一行;同轮多任务完成由在飞合流并成一个请求
    const taskIdsBefore = new Set(tasks.map((task) => task.taskId));
    try {
      await Promise.all(tasks.map(async (t) => {
        try {
          const task = await pollCanvasGenTask(pid, t);
          if (get().currentProjectId !== pid) return;   // await 期间已切项目:停止把旧项目任务结果写回
          const derived = isDerivedGenKind(t.kind);
          // 成功轮询一律清零 fails(此前被 derived && 门住,base 任务从不清零)——MAX_FAILS 的本意是
          // 「**连续**拉不到就别再拉」,而一次 35 分钟的生成约 210 次请求,累计语义下偶发 5 次抖动
          // 就把仍在跑的任务判死(spec C5)
          if ((t.fails ?? 0) > 0 || t.nextPollAt != null) {
            commitGenTasks(get().genTasks.map((current) => (current.taskId === t.taskId
              ? { ...current, fails: 0, nextPollAt: undefined }
              : current)));
          }
          // rig/retexture 的 task.status 是上游阶段(rig→retarget 等)，稳定终态只能看 item.status。
          if (!derived && FAILED_TASK_STATUSES.has(task.status)) {
            failGenTask(t.itemId, t.taskId, task.failure);   // 任务级明确失败(此时 item 常缺失或未标 failed):卡转失败态 + Toast(透传上游 failure)
            return;
          }
          if (!task.item) {
            // poll 成功但无 item(任务进行中/上游未就绪):不计 fails(非错误),仅靠超时兜底
            // rig/retexture 不能用本地时间推导终态；必须等到 item.status 明确 ready/failed。
            // 超时/连续拉不到 = 「我们接不回状态」,不是「后端说失败了」:挂孤儿 code 后出口自动
            // 收敛到不花钱的「重新检查」,discardFailedCard 也随之拒绝删除仍在飞的付费产物(spec C4)
            if (!derived && now - t.startedAt > DEADLINE_MS) failGenTask(t.itemId, t.taskId, bailFailure(t.itemId));
            return;
          }
          const asset = canvasItemToAsset(task.item);
          if (asset.status === 'error') {
            if (derived) settleDerivedFailure(t, asset, task.failure ?? task.item.failure);
            else failGenTask(t.itemId, t.taskId, task.failure);   // 服务端明确失败:卡转失败态 + Toast(透传上游 failure)
            return;
          }
          // agent 任务首拉暂无 item 时 GenTask.itemId 暂记占位卡 id;首次拿到 item 时适配为真实卡 + 更新 GenTask.itemId
          if (isPlaceholderId(t.itemId)) {
            adoptAgentItem(pid, t.itemId, asset);
            commitGenTasks(asset.status === 'ready'
              ? get().genTasks.filter((g) => g.taskId !== t.taskId)
              : get().genTasks.map((g) => (g.taskId === t.taskId ? { ...g, itemId: asset.id } : g)));
            return;
          }
          // generating 响应没有可见的新信息；跳过整表 set，避免 3 秒轮询反复通知所有画布订阅者。
          if (asset.status === 'generating') {
            // 超时/连续拉不到 = 「我们接不回状态」,不是「后端说失败了」:挂孤儿 code 后出口自动
            // 收敛到不花钱的「重新检查」,discardFailedCard 也随之拒绝删除仍在飞的付费产物(spec C4)
            if (!derived && now - t.startedAt > DEADLINE_MS) failGenTask(t.itemId, t.taskId, bailFailure(t.itemId));
            return;
          }
          // 位置归前端所有:创建时已落位,轮询结果不得覆盖(规避回写未完成被服务端旧坐标冲掉的竞态)
          set({ assets: get().assets.map((a) => (a.id === t.itemId
            ? { ...a, ...asset,
                position: a.position,
                parentId: a.parentId ?? asset.parentId,
                refIds: a.refIds ?? asset.refIds,
                // 溯源同理归前端所有(从工具入参提取,回写是 fire-and-forget)。canvasItemToAsset
                // 恒写这个键,值可能是 undefined —— 不保的话属性面板的提示词/模型/再生成
                // 在转 ready 那一刻整段消失。
                // 与 map.ts 的 preserveFrontendOwned 口径**刻意不同**:那边判 mapped(顶层 ?? reference)
                // 以便后端将来上线顶层字段时新值能压过本地旧值;这条路的 asset 来自轮询响应,
                // 只有「服务端回没回显」两态,与相邻 parentId/refIds 保持同构更重要
                provenance: a.provenance ?? asset.provenance,
                source: a.parentId ? 'derived' : asset.source }
            : a)) });
          if (asset.status === 'ready') {
            commitGenTasks(get().genTasks.filter((g) => g.taskId !== t.taskId));
          } else if (now - t.startedAt > DEADLINE_MS) {
            // 同上:超时挂孤儿 code —— 服务端那份很可能仍在跑
            failGenTask(t.itemId, t.taskId, bailFailure(t.itemId));   // 卡留下,按钮是免费的「重新检查」
          }
        } catch (error) {
          // 单个任务轮询失败:累加 fails,达上限则按失败删卡兜底(防 taskId 失效后无限重试)
          if (get().currentProjectId !== pid) return;
          const fails = (t.fails ?? 0) + 1;
          const derived = isDerivedGenKind(t.kind);
          // 派生任务的稳定终态只有 item.status；网络失败不删卡、不清任务，下轮继续。
          // 达上限同样挂孤儿 code:挂普通失败的话,用户点「重试」会走 discardFailedCard
          // 把服务端仍在生成的付费 item 删掉
          if (!derived && fails >= MAX_FAILS) failGenTask(t.itemId, t.taskId, bailFailure(t.itemId));
          else {
            const permanentlyMissing = derived && error instanceof PgcError && error.status === 404;
            const nextPollAt = permanentlyMissing
              ? Date.now() + DERIVED_RETRY_MAX_MS
              : derived
                ? Date.now() + Math.min(DERIVED_RETRY_BASE_MS * 2 ** Math.min(fails - 1, 5), DERIVED_RETRY_MAX_MS)
              : undefined;
            commitGenTasks(get().genTasks.map((g) => (g.taskId === t.taskId ? { ...g, fails, nextPollAt } : g)));
            if (permanentlyMissing && fails === 1) {
              set({ toast: { code: error.code, message: error.message, kind: 'error' } });
            }
          }
        }
      }));
    } finally {
      if (includeBase) pollingBaseTasks = false;
      if (includeDerived) pollingDerivedTasks = false;
      // 切项目后不刷:此刻 genTasks 已是新项目的列表,"缩小"判定无意义
      if (get().currentProjectId === pid) {
        const stillQueued = new Set(get().genTasks.map((task) => task.taskId));
        if ([...taskIdsBefore].some((id) => !stillQueued.has(id))) void refreshBalance({ terminal: true });
      }
    }
  };

  // ---- 版本 ----
  // 在途守卫同 pollGenTasks:版本轮询间隔短(2.5s),后端稍慢即会叠加,先到先跑、在途直接跳过
  let pollingVersions = false;
  const pollVersions = async () => {
    if (pollingVersions || !get().versions.some((v) => v.status !== 'ready')) return;
    pollingVersions = true;
    try { await loadVersions(); } catch { /* 下一轮再试 */ }
    finally { pollingVersions = false; }
  };

  const previewVersionById = async (vid: string): Promise<string | null> => {
    const pid = get().currentProjectId;
    if (pid == null || !vid) return null;
    // 分流逻辑与全屏页共用(src/lib/pgc/preview-url.ts);此处只负责把已知失败收敛成 Toast
    const seq = get().versions.find((v) => v.id === vid)?.index ?? null;
    try { return await resolvePreviewUrl({ pid, vid, seq }); }
    catch (e) { if (e instanceof PgcError) set({ toast: { code: e.code, message: e.message, kind: 'error' } }); return null; }
  };

  const downloadActiveVersion = async () => guard(set, async () => {
    const pid = get().currentProjectId; const vid = get().activeVersionId;
    if (pid == null || !vid) return;
    const blob = await downloadVersion(pid, vid);
    const projectName = get().projects.find((p) => p.id === pid)?.name;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = versionArchiveName(projectName, vid); a.click();
    URL.revokeObjectURL(url);
  });

  // 外部页经 ?remix=<public_id> 进入:fork 源项目为当前用户的新项目并选中,最后剥离 URL 上的 remix 参;
  // fork 失败(源未开放 / 网络 / 401)兜底 loadProjects,避免空工作台。bootstrap 仅在挂载时调一次(ran 守护 + 剥 URL 防重复 fork)
  const applyStudioRemix = async (sourceCode: string) => {
    // 用本地 forkedPublicId 判定成败,而非读 get().currentProjectId:后者被 persist 回灌,
    // 老用户带旧项目进来时本就非空,无法据此区分 fork 成败(会漏掉失败兜底,把用户留在未加载画布的旧项目上 → 空工作台)
    let forkedPublicId: string | null = null;
    await guard(set, async () => {
      const data = await pgcApi.createRemix({ source_code: sourceCode }); // 不传 name/version_id,后端取默认
      set({ projects: [data.project, ...get().projects] });
      await selectProject(data.project.id); // 落地 currentProjectId + 同步 URL + loadCanvas/loadVersions
      forkedPublicId = data.project.public_id; // guard 吞错时到不了这行,保持 null → 走失败兜底
    });
    if (forkedPublicId != null) {
      // fork 成功:剥掉 ?remix=,仅留 ?project=<fork public_id>(消费一次,刷新不重复 fork;selectProject 内 syncProjectToUrl 会保留旧 remix 参,故从空串重写)
      if (typeof window !== 'undefined') {
        const next = withProjectParam('', forkedPublicId);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      }
      // fork 入列时 projects 仅含新项目(冷启动 projects:[]),须补全用户其余项目,否则列表只剩 fork 项(bug #13088343)
      await refreshProjectList();
      set({ booting: false }); // remix 分支不经 loadProjects 的 finally,自行撤加载层
    } else {
      // fork 失败(guard 已置 toast/authRequired):先剥掉 ?remix= 防刷新重复 fork(withProjectParam 只管 project 参,故直接删 remix),
      // 再兜底载入用户自己的项目避免空工作台(loadProjects 内撤 booting + 选定项目并同步 ?project=)
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.delete('remix');
        const s = params.toString();
        const next = s ? `?${s}` : '';
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      }
      await loadProjects();
    }
  };

  // 外部页经 ?share=<public_id> 进入(分享工作台):三步编排 pgc open → koubou clone-from-share → pgc finalize,
  // 得到 recipient 名下含对话的完整可写副本,选中并钉住克隆会话续作。成功后剥 ?share= 仅留 ?project=(消费一次,
  // 刷新不重复 fork;bootstrap 的 ran 守护再兜一层)。与 applyStudioRemix 同构(成功剥参 / 失败兜底 loadProjects),
  // 但错误处理不走 guard:需在 clone 的 KoubouError 409 上「不 dead-end 路由到既有项目」,且 401 须保留 ?share=
  // 让登录后回到同一链接继续 fork。端点/字段形态见计划 U2/U3;若姊妹单元落地有别,改点集中在 pgc/koubou client 薄封装。
  const applyWorkbenchShare = async (code: string) => {
    let forkedPublicId: string | null = null;   // 非 null 即成功(含 409 路由到既有):据此剥参
    let needAuth = false;                        // 401:保留 ?share=,交 useAuthGuard 跳登录后回来续 fork
    // 加载层由函数级 finally 统一收口(镜像 applyStudioPrelude 的写法)。此前是逐个出口手写 set,
    // 未知错误 throw 逃出函数时就漏了 —— 调用方是 bootstrap 的 void applyWorkbenchShare(),rejection
    // 被静默丢弃,LoadingScreen 也没有自身超时兜底,用户于是永久停在 loading 页(bug #13870465)。
    // 收成一处后,以后新增早退 / 抛出路径都自动被覆盖。**必须包住下面的尾部分支**:失败兜底那支要
    // await loadProjects(),提前撤层会让用户先看见一瞬空工作台。
    try {
    try {
      // 1. pgc open:开通/命中目标 project,取源三元组 + share_token(未登录 401 → 转登录门闸)。
      //    open 回执直接带 target_project(完整 ProjectData):数值 id 供 koubou clone path / finalize / selectProject 用,
      //    public_id 供 ?project= 导航;无需再拉列表映射(与 replay 一致,均用数值 id 寻址)。
      const opened = await pgcApi.workbenchShare.open(code);
      const pid = opened.target_project.id;
      // owner 本人打开自己的分享链接:pgc 未建副本(target=源项目、token 空),直接进入原工作台,
      // 跳过 clone/finalize/pin(否则 koubou 会拿空 token 报错)。成功路径同样剥 ?share= 留 ?project=。
      if (opened.owner_self) {
        const list0 = await pgcApi.listProjects();
        set({ projects: list0.items });
        // listProjects await 期间用户已主动选中别的项目 → 放弃 stale 的 owner-self 续接,
        // 不把用户拉回源项目(Codex review P2:事后校验太晚,selectProject 已覆盖选择)
        if (get().currentProjectId != null && get().currentProjectId !== pid) return;
        await selectProject(pid);
        if (get().currentProjectId !== pid) return;
        forkedPublicId = opened.target_project.public_id;
      } else {
      // 刷新项目列表,使 fork 出的新项目出现在侧栏(不依赖它解析 id,id 已由 open 直接给出)
      const list = await pgcApi.listProjects();
      set({ projects: list.items });
      // 2. koubou clone-from-share:带 share_token 授权;409 = 目标已开通/含无关内容 → 不 dead-end,跳过 pin 路由到既有。
      //    body 字段须为字符串(koubou Pydantic v2 不做 int→str 强转,送数字会 422)。
      let clonedSessionId: string | null = null;
      try {
        const cloned = await koubouApi.cloneFromShare(pid, {
          source_user_id: String(opened.source_owner_user_id),
          source_project_id: String(opened.source_project_id),
          source_session_id: opened.source_session_id,
          share_token: opened.share_token,
        });
        clonedSessionId = cloned.session_id;
      } catch (e) {
        // 409(code 或 status):幂等/既有内容,改由连接层解析既有会话;非 409 照抛
        if (e instanceof KoubouError && (e.code === 409 || e.status === 409)) clonedSessionId = null;
        else throw e;
      }
      // 3. pgc finalize:复制 ready 画布 + 写版本指针(幂等,409 恢复路径也调,保证画布/版本收口)
      await pgcApi.workbenchShare.finalize(pid);
      // 4. 钉住克隆会话:写会话快照,使 switchProjectSession(useKoubouConnection 触发)载入该 sessionId,
      //    连接层 resolveSession 信任本地 sessionId(afterSequence=0)并经 /events 种子化历史,不用 listSessions 猜。
      //    409 恢复路径无 session_id → 不 pin,交连接层常规 resolveSession 兜底。
      if (clonedSessionId) {
        set({ koubouByProject: { ...get().koubouByProject, [sessionSlotKey(pid, get().backend)]: { sessionId: clonedSessionId, lastSequence: 0, messages: [], turns: [], tasks: [] } } });
      }
      // 5. 选中目标:落 currentProjectId + 同步 URL(?project=<public_id>)+ loadCanvas/loadVersions;WS 随 currentProjectId 变化建连
      await selectProject(pid);
      // await 后校验(仓库不变式,同各 action 的 currentProjectId !== pid 守卫):selectProject 的
      // canvas/versions 载入期间用户切到别的项目 → 放弃 fork 的成功提交(URL 重写/剥参),不覆盖用户当前选择;
      // 撤加载层后直接返回(?share= 留在 URL 由 bootstrap 的 ran 守护挡重复消费)
      if (get().currentProjectId !== pid) return;
      forkedPublicId = opened.target_project.public_id;
      }
    } catch (e) {
      if (e instanceof PgcError) {
        if (e.status === 401) { set({ authRequired: true }); needAuth = true; }
        else if (isCreditError(e)) set({ creditModalOpen: 'insufficient' });
        else set({ toast: { code: e.code, message: e.message, kind: 'error' } });
      } else if (e instanceof KoubouError) {
        set({ toast: { code: String(e.code), message: e.message, kind: 'error' } });
      } else {
        // 未知错误照抛(红线:只归一已知 PgcError/KoubouError,guard 之外不吞非预期错误,留给上层暴露 bug),
        // 不剥参/不兜底——避免把程序 bug 伪装成"分享打开失败"的业务报错。
        // 但给一条**不归因**的提示:这个 catch 分不出错误来源(koubou clone 的断网抛 TypeError,
        // 空指针也抛 TypeError),声称任何具体原因都是在猜。UNKNOWN 只说「出现错误,请重试」——
        // 不冒充业务失败,错误照旧 rethrow 给监控/控制台,而用户不再对着无声的界面。
        // message 传空串:UNKNOWN 在 11 语都有词条,resolveErrorMessage 必命中(同 connErrorToast 先例),
        // 塞后端/运行时原文只会把英文技术串漏给用户。
        set({ toast: { code: 'UNKNOWN', message: '', kind: 'error' } });
        throw e;
      }
    }
    if (forkedPublicId != null) {
      // 成功:剥 ?share=,仅留 ?project=<fork public_id>;selectProject 内 syncProjectToUrl 会保留旧 share 参,故从空串重写
      if (typeof window !== 'undefined') {
        const next = withProjectParam('', forkedPublicId);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      }
    } else if (needAuth) {
      // 未登录:保留 ?share= 链接(登录跳转后回到同一 URL 续 fork),不剥参、不兜底 loadProjects
    } else {
      // 其它失败(403/分享已关闭这类确定性失败):剥 ?share= 防刷新重复 fork,再兜底 loadProjects 避免空工作台。
      // 注意这支**不含**未知错误 —— 那条在上面 catch 里直接 throw 出去了,刻意保留 ?share= 让刷新即重试
      // (整条编排按幂等设计:open 回 idempotent_hit、clone 回 409、finalize 幂等,重试是安全的)
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        params.delete('share');
        const s = params.toString();
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`);
      }
      await loadProjects();
    }
    } finally {
      set({ booting: false });   // 任何出口(成功 / 已知失败 / 未知错误照抛 / 早退)都撤加载层
    }
  };

  // 消耗后刷新余额:只打 /credits/balance(不带 /auth/me,用户信息不会因消耗变化)。失败静默且保留旧值——
  // 余额是非关键信息,拉不到时展示上一次已知值比抹成 "0" 更可信。
  // 在飞合流:多个生成任务几乎同时完成会各触发一次,复用同一 promise 免得打出一串同样的请求。
  // 回血解锁补丁:任何拿到新余额的非终态路径都带上它。锁按用户存,故只解当前用户自己的锁;
  // 用户未就绪或锁不属于当前用户时什么都不动(fail-closed,与终态分支同口径)。
  const unlockPatch = (balance: number | null | undefined): { lowBalanceLockedUserId?: null } => {
    const uid = get().userInfo?.id ?? null;
    if (uid == null || get().lowBalanceLockedUserId !== uid) return {};
    return unlockedByBalance(balance, true) ? {} : { lowBalanceLockedUserId: null };
  };

  let balanceInflight: Promise<void> | null = null;
  let inflightTerminal = false;
  let queuedTerminal: Promise<void> | null = null;
  // terminal=「这次刷新发生在一次生成真的结束之后」。只有终态刷新才允许弹低余额升购弹窗:
  // 本函数同时被 useBalanceRefresh 的在途兜底 tick 调用(run 期间每 15s 一次),那条路径上弹窗会
  // 当场盖在进行中的生成上,与产品口径「上一次生成**完成后**」不符(终审 I6)。
  // 缺省 false 是 fail-closed:将来新增调用点不会意外弹窗,要弹必须显式声明自己是终态。
  const refreshBalance = (opts: { terminal?: boolean } = {}): Promise<void> => {
    const terminal = !!opts.terminal;
    if (balanceInflight) {
      // 同终态性直接合流(多个生成几乎同时完成时省掉一串同样的请求,这也是合流的初衷)
      if (!terminal || inflightTerminal) return balanceInflight;
      // 终态撞上在飞的**非终态**:不能借它的响应——那个 GET 在生成完成前就发出了,
      // 余额可能还没扣完,拿它做终态判定等于判「完成前」的旧余额(与异步生成提交时那条坑同源)。
      // 故排到它后面重发一次,保证判据是完成后的余额。
      return (queuedTerminal ??= balanceInflight.then(() => {
        queuedTerminal = null;
        return refreshBalance({ terminal: true });
      }));
    }
    inflightTerminal = terminal;
    balanceInflight = pgcApi.getBalance()
      .then((b) => {
        if (!b) return;
        // 非终态刷新只更余额,**连锁也不推进**——若在这里推进锁,run 结束后的终态刷新会看到
        // 已上锁而不再弹,这次提示就永久丢失了(比弹在中途更糟)。
        // 但解锁要照做:回血(充值 / 订阅 / 后端侧返还)不经终态判定,不解锁的话
        // 「回血后又跌破」这个新区间会被旧锁吃掉。
        if (!terminal) { set({ credit: b, ...unlockPatch(b.balance) }); return; }
        // 锁按用户存:userInfo 未就绪时无法归属,只更余额不动锁(fail-closed)
        const uid = get().userInfo?.id ?? null;
        if (uid == null) { set({ credit: b }); return; }
        // 低余额判定只挂这里:refreshBalance 是消耗后余额的唯一漏斗(三个生成漏斗都汇入它),
        // 不在各 generate* 里各撒一份。冷启动的 loadUserInfo 特意不接——触发口径是「上一次生成后」。
        const { locked, shouldOpen } = nextLowBalanceState(b.balance, get().lowBalanceLockedUserId === uid);
        // 已有任一弹窗开着就不抢:硬失败的 insufficient 语义更强,且两者同为 z-40 会叠窗
        const busy = get().creditModalOpen !== false || get().topupModalOpen;
        set({
          credit: b,
          lowBalanceLockedUserId: locked ? uid : null,
          ...(shouldOpen && !busy ? { creditModalOpen: 'lowBalance' as const, creditModalKind: null } : {}),
        });
      })
      .catch(() => { /* 账户条非关键信息,静默 */ })
      .finally(() => { balanceInflight = null; });
    return balanceInflight;
  };

  // 预览区账户条:并发拉当前用户 + 余额。非关键信息,失败一律静默(不走 guard、不弹 Toast、不触发登录跳转),各自成功即写入
  const loadUserInfo = async () => {
    const [u, b] = await Promise.allSettled([pgcApi.getCurrentUser(), pgcApi.getBalance()]);
    if (u.status === 'fulfilled' && u.value) set({ userInfo: u.value });
    // 充值 / 订阅成功后走的就是这条:余额回到阈值以上要解锁(见 unlockPatch)。
    // 但仍不判弹窗——这里不是「上一次生成之后」,冷启动就弹不符合口径。
    if (b.status === 'fulfilled' && b.value) set({ credit: b.value, ...unlockPatch(b.value.balance) });
  };

  // ---- 订阅单轮询(设计稿 2026-08-14-subscribe-order-watch)----
  // 轮询归 store 而非弹窗:挂在弹窗上时,用户关窗或点「See all plans」跳到另一个弹窗就会被
  // clearInterval 带走——支付照样成功,前端却再也不知道。节奏由 client/useSubscribeWatch 驱动。
  const SUBSCRIBE_DEADLINE_MS = 10 * 60_000;
  // 「这单不会再成功了」的终态。past_due 不在内——那是续扣失败进宽限期,属订阅生命周期问题,不是本次下单失败。
  const SUBSCRIBE_DEAD_STATUSES = ['closed', 'expired', 'canceled'];

  // 订阅成功后 plansCache 里的 current_tier 就过期了(它决定开哪个弹窗、推荐哪一档,以及下一次
  // 下单走 createSubscription 还是 changeSubscription)。但**不能在成功那一刻清**:CreditModalGate
  // 见 plans==null 直接 return null,弹窗会当场消失、吃掉成功态停留。故弹窗开着时只标记,留给
  // setCreditModalOpen(false) 在关窗那一刻清;没有弹窗开着则当场清(没人在渲染它,安全)。
  const stalePlansCachePatch = (): Partial<StoreSlice> => {
    const anyModalOpen = get().creditModalOpen !== false || get().topupModalOpen || get().allPlansOpen;
    return anyModalOpen ? { subscribeSucceeded: true } : { plansCache: null, subscribeSucceeded: false };
  };

  const watchSubscribeOrder = (order: { id: string; tier: SubscriptionTier; messages: { active: string; closed: string } }) =>
    set({ subscribeOrder: { ...order, startedAt: Date.now() }, subscribeSucceeded: false });

  // 判成功的判据是「status=active **且** tier 已切到目标档」——升档改的是同一条订阅行,授权期间
  // 它一直是 active,只看 status 会在支付完成前就误报成功。首次订阅走同一判据,不需要分支。
  const pollSubscribeOrder = async () => {
    const watched = get().subscribeOrder;
    if (!watched) return;
    const expired = () => Date.now() - watched.startedAt > SUBSCRIBE_DEADLINE_MS;
    let order;
    try {
      order = await bizApi.getSubscriptionOrder(watched.id);
    } catch {
      // 单轮失败跳过、下轮重试,但**超时判定照跑**:否则持续 5xx / 超时会让它永远轮询下去,
      // 文档写的 10 分钟兜底形同虚设(PR#9 评审 C7)
      if (expired()) set({ subscribeOrder: null });
      return;
    }
    // await 期间可能已被别的分支收单、或换了新的一单:丢弃过期响应
    if (get().subscribeOrder?.id !== watched.id) return;
    if (order.status === 'active' && order.tier === watched.tier) {
      set({
        subscribeOrder: null,
        toast: { code: 'SUBSCRIBED', message: watched.messages.active, kind: 'success' },
        ...stalePlansCachePatch(),
      });
      void loadUserInfo();
      return;
    }
    if (SUBSCRIBE_DEAD_STATUSES.includes(order.status)) {
      set({ subscribeOrder: null, toast: { code: 'SUBSCRIBE_CLOSED', message: watched.messages.closed, kind: 'error' } });
      return;
    }
    // 超时只停轮询回可重试态,不判失败(权益开通最终由 Waffo webhook 保证)
    if (expired()) set({ subscribeOrder: null });
  };

  // 实时 WS 帧携带的资产副作用:仅 useKoubouConnection 的 onEvent 调用(历史——localStorage 快照 / REST 分页——不走 WS 事件,天然不触发)。
  // 串行导入保证级联落位:下一条能读到上一条已落库坐标;await 后校验 pid,切项目则丢弃旧链残留;去重由 import/register 内部兜底。
  let liveImportChain: Promise<void> = Promise.resolve();
  const importFromLiveEvent = (e: ServerEvent) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const { media, tasks } = eventAssets(e);
    for (const m of media) {
      liveImportChain = liveImportChain
        .then(() => { if (get().currentProjectId !== pid) return; return importGeneratedAsset(m); })
        .catch(() => {}); // 单条失败不阻断队列(PgcError 已在 action 内转 toast)
    }
    for (const t of tasks) if (get().currentProjectId === pid) void registerAgentGenTask(t.taskId, t.kind).catch(() => {});
  };

  // 媒体-only 事件导入:回放播放器与建连种子化历史共用(与 live 共用 eventAssets 的 media,图像/音频/文本原位导入),
  // 但**丢弃 tasks**——回放/历史里的 task 早已终态,送进 registerAgentGenTask 会轮询失败弹 Toast(见回放 spec §3.4)。
  // 种子路径补导堵住「断连窗口内 ready 帧被 REST 种子消化、永不过 onEvent」的丢失(见 2026-07-22 导入可靠性 spec);
  // 历史页每次建连重扫,幂等靠 importedByProject 去重。复用 liveImportChain 串行落位,去重由 importGeneratedAsset 内部兜底
  const importMediaFromEvent = (e: ServerEvent) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const { media } = eventAssets(e);
    for (const m of media) {
      liveImportChain = liveImportChain
        .then(() => { if (get().currentProjectId !== pid) return; return importGeneratedAsset(m); })
        .catch(() => {});
    }
  };

  // 回放进度摘要 setter(replay 为 null 时 no-op,防播放器卸载竞态)
  const patchReplay = (patch: Partial<ReplayState>) => {
    const r = get().replay; if (!r) return;
    set({ replay: { ...r, ...patch } });
  };
  // playheadAt=最近派发帧的 created_at:随游标一起推进播放头(TurnFooter 回放期计时终点)
  const setReplayCursor = (n: number, playheadAt?: string | null) =>
    patchReplay(playheadAt === undefined ? { cursor: n } : { cursor: n, playheadAt });
  const setReplayTotal = (n: number) => patchReplay({ total: n });
  const setReplaySpeed = (s: 1 | 2 | 4) => patchReplay({ speed: s });
  const skipReplay = () => patchReplay({ phase: 'skipping' });

  // 回放 provisioning 三步兜底:409/403/429/503/网络错误 → error 态 + toast(已知错误);未知照抛。
  // 不自动重试(start 幂等,用户刷新即重来)
  const replayFail = (code: string) => {
    const r = get().replay;
    set({ replay: r ? { ...r, phase: 'error', errorCode: code } : r });
  };

  // 播放期(逐帧派发 / skip flush)拉取失败兜底,供 useReplayPlayer 调用——与上面 enterReplay
  // 内部的 replayFail 语义一致(置 error 态,input 停用),但播放器场景没有 provisioning 那样按
  // 错误类型细分文案的必要,统一弹 toast(code 走 ERROR_KEYS 映射到 chat.replay.error 本地化;
  // message 留同源英文兜底,未命中映射时按契约展示)。replay 若已被 completeReplay/skip 收尾为
  // null(await 期间输光竞态)则不复活它,仍照常提示——错误本身真实发生,用户理应看到
  const failReplay = (code: string) => {
    const r = get().replay;
    if (r) set({ replay: { ...r, phase: 'error', errorCode: code } });
    set({ toast: { code, message: 'Could not start the replay. Refresh to try again.', kind: 'error' } });
  };

  // clone 409 / ready 恢复:取该项目 clone 会话(列表按 updated_at 倒序,回放项目恒仅一条 clone 会话)
  const resolveCloneSession = async (pid: number): Promise<string | null> => {
    const sessions = await koubouApi.listSessions(pid);
    return sessions[0]?.session_id ?? null;
  };

  // 回放入口编排:start(幂等) → selectProject → 按 status 分流。
  // 先置 replay(provisioning) 再 selectProject:currentProjectId 一变 useKoubouConnection 即早退出(不建连/不种子)。
  // 每个 await 后校验 replay.templateId 仍是本次(防 await 期间用户又切走/重进)
  const enterReplay = async (templateId: string) => {
    set({ replay: { phase: 'provisioning', templateId, projectId: null, sessionId: null, total: 0, cursor: 0, speed: 1, resumeAfterSequence: 0 } });
    try {
      const started = await pgcApi.startReplay(templateId);
      if (get().replay?.templateId !== templateId) return;
      const pid = started.target_project_id;
      set({ replay: { ...get().replay!, projectId: pid } });
      await selectProject(pid);   // guard 包裹:落 currentProjectId + 同步 URL + loadCanvas/loadVersions
      if (get().replay?.templateId !== templateId) return;
      set({ booting: false }); // 回放分支不经 loadProjects 的 finally,自行撤全局加载层(镜像 applyStudioRemix),否则整段回放被 LoadingScreen 盖住
      // 回放入口绕过 loadProjects,projects 列表从未拉过 → 项目菜单空。与 remix 入口同款:
      // fire-and-forget 补全列表(自带 try/catch 永不抛,不动 currentProjectId/URL)
      void refreshProjectList();

      // 已完成:不回放(避免重复导入),剥参当正常项目,useKoubouConnection 正常续接。
      // 顺手清残留进度标记(如另一设备播完/本地标记过期),防下次 selectProject 误触发恢复
      if (started.status === 'completed') {
        const nextProgress = { ...get().replayProgressByProject };
        delete nextProgress[String(pid)];
        set({ replay: null, replayProgressByProject: nextProgress });
        stripReplayTemplateFromUrl();
        return;
      }

      let sessionId: string | null;
      if (started.status === 'ready') {
        // 克隆+finalize 此前已完成(掉线/刷新中间态):取既有 clone 会话直接播
        sessionId = await resolveCloneSession(pid);
      } else {
        // provisioning:克隆 → finalize(v1)
        set({ replay: { ...get().replay!, phase: 'cloning' } });
        try {
          const cloned = await koubouApi.cloneFromTemplate(pid, templateId);
          sessionId = cloned.session_id;
        } catch (e) {
          // 409 REPLAY_ALREADY_PROVISIONED:已有会话,改查既有,勿重克隆
          if (e instanceof KoubouError && e.code === 409) sessionId = await resolveCloneSession(pid);
          else throw e;
        }
        if (get().replay?.templateId !== templateId) return;
        set({ replay: { ...get().replay!, phase: 'finalizing', sessionId } });
        // finalize 幂等:已 ready/completed 上重复调是 no-op,不回退指针;版本号固定 v1
        await pgcApi.finalizeReplay(pid, 'v1');
      }
      if (get().replay?.templateId !== templateId) return;
      if (!sessionId) { replayFail('REPLAY_NO_SESSION'); set({ toast: { code: 'REPLAY_NO_SESSION', message: 'Replay session not found', kind: 'error' } }); return; }
      // 断点续播(spec 2026-07-14):本地有本会话的未完成进度 + 一致快照 → 灌快照消息、从 lastSequence 续播。
      // selectProject 在编排在途(replay.projectId===pid)时不动 replay/快照,故此处自灌
      const prog = get().replayProgressByProject[String(pid)];
      const snap = get().koubouByProject[sessionSlotKey(pid, get().backend)];
      const canResume = prog?.sessionId === sessionId && snap?.sessionId === sessionId && snap.lastSequence > 0;
      if (canResume) {
        set({
          replay: { ...get().replay!, phase: 'playing', sessionId, resumeAfterSequence: snap.lastSequence },
          // 四个字段一起灌:这一处没有前置的 createInitialKoubouState(),漏灌 subagents 就会是
          // 「回放的 messages/turns/tasks + 上一次 live 会话残留的卡片」并存
          sessionId, lastSequence: snap.lastSequence, ...restoreSnapshot(snap),
        });
      } else {
        // 全新起播:写进度标记(此后每帧检查点持久化快照,刷新/切走即可断点恢复)
        set({
          replay: { ...get().replay!, phase: 'playing', sessionId, resumeAfterSequence: 0 },
          replayProgressByProject: { ...get().replayProgressByProject, [String(pid)]: { templateId, sessionId } },
        });
        // 回放开始上报(PR#129 §6):完成率分母,provisioning/ready 两分支都汇到这里才真正起播;
        // 断点恢复不重复上报,防完成率分母虚增
        track('replay_start', { template_id: templateId, project_id: projectPublicId() });
      }
    } catch (e) {
      if (e instanceof PgcError) {
        replayFail(e.code);
        if (e.status === 401) set({ authRequired: true });
        else set({ toast: { code: e.code, message: e.message, kind: 'error' } });
      } else if (e instanceof KoubouError) {
        replayFail(String(e.code));
        set({ toast: { code: String(e.code), message: e.message, kind: 'error' } });
      } else {
        replayFail('REPLAY_FAILED');
        throw e;   // 未知错误不吞,暴露 bug(bootstrap 的 void 调用会记录未捕获拒绝)
      }
    } finally {
      // 任何出口都撤加载层(同 applyWorkbenchShare):两处 await 后校验的早退曾漏撤,未知错误照抛也漏,
      // 而调用方是 bootstrap 的 void enterReplay(),没人接手 → 用户永久停在 loading 页(bug #13870465)。
      // 成功路径上面那处提前撤层仍保留:那是为了让整段回放不被 LoadingScreen 盖住,不是兜底。
      set({ booting: false });
    }
  };

  // 回放收尾(播完 / skip flush 完由 useReplayPlayer 调):
  // 播放器已把全量事件经 ingestKoubou 灌进 koubou 态,此处读现值落快照 + 标 completed + 置续接握手。
  const completeReplay = () => {
    const r = get().replay; if (!r || r.projectId == null) return;
    const pid = r.projectId;
    const s = get();
    const sessionId = r.sessionId ?? s.sessionId ?? '';
    // 回放已完整播完:清进度标记,防刷新/切回再触发断点恢复
    const nextProgress = { ...s.replayProgressByProject };
    delete nextProgress[String(pid)];
    // 落会话快照(与 live onEvent 检查点同构):续接时 switchProjectSession 据此载回完整回放消息。
    // 顺手清固定槽:回放灌进来的 error 帧是**当时**发生过的失败,收尾后不该以「现在失败了」的
    // 形态挂在输入框上方(它又不进快照,续接后也无从解释)
    set({
      agentError: null,
      koubouByProject: { ...s.koubouByProject, [sessionSlotKey(pid, s.backend)]: sessionSnapshot(s, sessionId) },
      // 续接握手:pin clone session + afterSequence,useKoubouConnection 据此跳过 resolveSession 与种子
      // projectId 限定归属:防用户切项目后,另一项目的连接误消费本次握手(pin 错会话)
      replayHandoff: { sessionId, afterSequence: s.lastSequence, projectId: pid },
      replay: null,
      replayProgressByProject: nextProgress,
      // 续作首发埋点待报标记:Composer 在本项目下发出第一条消息时消费(replay_continue_first_message)
      replayContinuePending: { projectId: pid, templateId: r.templateId },
    });
    // 回放完成上报(PR#129 §6):含 skip 收尾——skip flush 后同走本函数,phase 区分是否跳过
    track('replay_complete', { template_id: r.templateId, skipped: r.phase === 'skipping', project_id: projectPublicId() });
    // 标完成(刷新/换设备据此走续接而非重播);失败不阻断续接(下次刷新 start 重判,素材导入幂等)
    void pgcApi.updateReplayState(pid, 'completed').catch(() => {});
    // 补拉画布/版本(镜像 live 的 run.finished(succeeded) 刷新):enterReplay 里 selectProject 的那次
    // loadVersions 发生在 finalize 之前,v1 版本尚未创建,拉回是空的——回放管线又不经 useKoubouConnection
    // 的终态刷新,不在此补拉的话右侧预览播完仍无版本。fire-and-forget,失败不阻断收尾
    void loadCanvas().catch(() => {});
    // 回放收尾(含 skip)后预览显式切到最新版本:loadVersions 的 hasNew 判定只针对"增量出新",
    // 回放期版本可能早已整批载入(前后两次列表相同),不切的话预览会停在回放中途选中的旧版本
    void loadVersions().then(() => {
      const s = get();
      if (s.currentProjectId !== pid) return;   // await 期间已切项目则不动
      const latest = s.versions[s.versions.length - 1];
      if (latest) set({ activeVersionId: latest.id, versions: s.versions.map((v) => ({ ...v, current: v.id === latest.id })) });
    }).catch(() => {});
    stripReplayTemplateFromUrl();
  };

  return {
    loadProjects, selectProject, createProject, renameProject, autoNameProject, deleteProject, refreshProjectList,
    loadCanvas, loadVersions, loadVersionCredits, pollGenTasks, restoreGenTasks, resumeImportQueue,
    pollVersions, previewVersionById, downloadActiveVersion,
    importGeneratedAsset, importProjectArchive, cancelImportArchive, applyStudioRemix, applyWorkbenchShare, registerAgentGenTask, loadUserInfo, refreshBalance, watchSubscribeOrder, pollSubscribeOrder, importFromLiveEvent,
    importMediaFromEvent, setReplayCursor, setReplayTotal, setReplaySpeed, skipReplay,
    enterReplay, completeReplay, failReplay,
  };
}

export type ServerActions = ReturnType<typeof createServerActions>;
