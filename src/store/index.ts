'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyKoubou, applyUserMessage, seedHistory, prependHistory, reopenRun, failAgentTurn, pushAgentError } from '@/koubou/apply-koubou';
import type { AgentFailure } from '@/lib/agent-retry';
import { koubouApi, type EventsPage, type SessionSummary } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState, type KoubouState, type ServerState, type Version, type Message, type PersistedSession, type ChatAttachment, type ConnStatus, type CreditModalSource, type LastSend } from './types';
import { pgcApi, uploadCanvasItem, PgcError } from '@/lib/pgc/client';
import { resolveAssetUrl, assetProxyUrl } from '@/lib/pgc/url';
import { isPlainTextName } from '@/lib/media-import';
import type { ServerEvent } from '@/koubou/protocol';
import type { AssetKind } from '@/lib/asset-kind';
import type { SubscriptionPlansData } from '@/lib/biz/types';
import type { ProjectData } from '@/lib/pgc/types';
import { createServerActions, DEFAULT_PROJECT_NAME, type ServerActions } from './actions';
import { BASE_MODEL, modelGateLocked, gatedModel } from '@/lib/subscription/model-gate';
import { modelLabel, resolveReadyModel, resolveSelectedModel } from '@/lib/koubou/models';
import { normalizeIsoUtc } from '@/lib/koubou/timestamp';
import { selectActiveVersion } from './selectors';
import { newId } from '@/lib/ids';
import { formatQuestionAnswer } from '@/lib/koubou/formatAnswer';
import { withProjectParam } from '@/lib/project-url';
import { assetSeedLabel, type StudioPrelude } from '@/lib/studio-prelude';
import { kindFromFile } from '@/lib/assets';
import { createThrottledPersistStorage, capPersistedSessions } from './persist-storage';
import { sessionSlotKey } from './session-slot';
import { sealStaleCards } from '@/lib/subagent-tasks';
import { sessionSnapshot, restoreSnapshot } from './session-snapshot';
import { insertMentionRef, removeMentionKey } from '@/lib/refs';
import type { SkillDef } from '@/lib/skills';
import { TEXT_MIMES } from '@/lib/upload-policy';
import { AGENT_BACKEND_KEY, resolveAgentBackend, type AgentBackend } from '@/lib/agent-backend';

// 单例:整个 tab 生命周期共享同一节流器(共享 timer / 待写队列),避免多实例各写各的破坏合并。
// 对象级节流:高频 set()(koubou 流式)下「序列化 + 写盘」都合并为每秒至多一次(审计 D1),详见 persist-storage。
const persistStorage = createThrottledPersistStorage<PersistedAppState>(() =>
  typeof window !== 'undefined' ? window.localStorage : undefined,
);

// agent backend 初值:渲染期同步解析(URL query > 独立 localStorage key > 'cc'),
// 使 useKoubouConnection 建连时 getState().agentBackend 恒已就绪(不依赖 effect 顺序)。
// 只读不写:写回存储由 useAgentBackend 负责(副作用留在 client 层)。
// SSR 下无 window → 'cc';backend 不参与渲染输出,故不会造成水合不一致。
export function initialAgentBackend(): AgentBackend {
  if (typeof window === 'undefined') return 'cc';
  try {
    return resolveAgentBackend(window.location.search, window.localStorage.getItem(AGENT_BACKEND_KEY)).backend;
  } catch {
    return 'cc';   // localStorage 不可用(隐私模式等)
  }
}

// persist v2→v3(spec 2026-10-19 第二阶段):画布界面退役,其持久化偏好与视口不再有读方。
// 不迁移也不出错(下一次写盘 partialize 自然丢弃),但 persist 的浅合并会先把它们灌进内存态,
// 成为没人读的脏字段 —— 一次性删掉。更早的 v0→v1(visibleKinds 补 text)随字段一起退役
const RETIRED_PERSIST_KEYS = ['visibleKinds', 'alignEnabled', 'listOpen', 'listWidth', 'viewportByProject'] as const;
export function migratePersistedState(persisted: unknown, version: number): unknown {
  if (version < 3 && persisted && typeof persisted === 'object') {
    const s = persisted as Record<string, unknown>;
    for (const k of RETIRED_PERSIST_KEYS) delete s[k];
  }
  return persisted;
}

export type PreviewDevice = 'desktop' | 'mobile';

export interface ComposerState { draft: string; attachments: ChatAttachment[]; baseLines: number; }
export interface UIState {
  connStatus: ConnStatus;
  compare: { on: boolean; withId: string | null };
  // 预览面板 Preview/Files tab
  previewTab: 'preview' | 'files';
  // 预览舞台设备档(spec 2026-10-19-preview-mobile-device):desktop = 16:9 封顶满幅,mobile = 竖屏 282:519 框。
  // 只改舞台内框尺寸,不碰任何列宽;持久化(调移动端适配要反复刷新,每次回落桌面很烦),全局一份不分项目
  previewDevice: PreviewDevice;
  composer: ComposerState;
  // 历史输入回填后由 Composer 自己消费聚焦；只存递增请求号，不跨组件传 DOM ref，也不持久化。
  composerFocusRequest: number;
  availableModels: string[];
  // 当前项目的选中模型(视图):恒等于 modelByProject[currentProjectId],无记忆时承担「最近一次全局选择」兜底
  selectedModel: string | null;
  // 按项目+backend 记忆的模型选择(持久化,spec 2026-07-23 model-per-project):多窗口/多项目互不干扰
  modelByProject: Record<string, string>;
  // availableModels / selectedModel 所属 backend(持久化,与 selectedModel 成对)。
  // 两个 backend 的模型列表不同:带着别的 backend 的模型建**新**会话会被服务端
  // `invalid model` + 4400 拒(classifyClose→fatal 不重连,dev 实测)。故凡是"用模型"的地方
  // 都要先确认它属于当前 backend,不确定就不带(服务端用该 backend 默认模型)
  modelBackend: AgentBackend | null;
  // 按项目记忆的 Play Bundle 包名(applicationId,持久化):用户上次亲手填的值,下次打开导出表单预填。
  // **按项目而非全局** —— 包名与应用一一对应、首次上传 Play 后永久不可改,跨项目复用等于诱导用户
  // 把 A 应用的 applicationId 烧进 B 应用。服务端派生值仍不预填(那是 Rezona 命名空间,理由见模态注释)
  packageNameByProject: Record<string, string>;
  // 可选 skill 列表(GET /skills?backend=,含 backend 原生调用串 invocation)
  skills: SkillDef[];
  // 瞬态:landing prelude 填好输入框后置位,提示 Composer 在 client 就绪时自动发送一次(不持久化,见 partialize)
  autoSendArmed: boolean;
  // planner 计划卡折叠态;纯 UI 瞬态,不持久化(见 partialize)
  planCollapsed: boolean;
  // 计划卡当前看的是哪一段(任务清单 / 子代理)。瞬态:是「这一刻在看哪段」而非长期偏好,
  // 且 run.started 会重置回 tasks —— 子代理开卡不自动抢切,免得把用户从清单上弹走
  planView: 'tasks' | 'subagents';
  // 新建会话时使用的 agent backend(cc / codex);本期无 UI 入口,靠 ?agent= + 独立 localStorage key
  // 切换(见 lib/agent-backend.ts)。**当前会话实际 backend** 以 KoubouState.backend 为准(session.ready 校正)
  agentBackend: AgentBackend;
}

interface Actions {
  ingestKoubou: (e: ServerEvent) => void;
  ingestReplayUserMessage: (e: ServerEvent) => void;        // 回放专用:user.message 成用户气泡(live 无此分支)
  ingestReplayQuestionAnswer: (e: ServerEvent) => void;    // 回放专用:answered 帧合成回答气泡(live 由 QuestionCard 乐观插入)
  switchProjectSession: (nextPid: number | null) => void;   // 仅载入目标项目会话快照
  seedKoubouHistory: (page: EventsPage) => void;            // REST 最新一页种子化历史
  // 滚顶向上翻页(前插更早 50 条)。batch:循环内只累积、凑满后一次性落库——
  // 不满一屏自动续拉用(逐页整体重建会让列表连闪数秒);用户滚顶手势保持逐页(有滚动补偿,即时反馈)
  loadOlderMessages: (opts?: { batch?: boolean }) => Promise<void>;
  backfillSessionGap: () => Promise<void>;                  // 重连后 REST 回填断线窗口内的事件缺口
  // 进行中 run 的 REST 跟跑(spec 2026-07-23):后端 run 事件按连接投递,新连接收不到旧 run 的帧;
  // ready 后据 REST active_run_id 复开误闭轮并轮询回填直到终态。isWsOwned 豁免本连接发起的 run(WS 正常投递)
  trackActiveRunViaRest: (isWsOwned: (runId: string) => boolean, pollMs?: number) => Promise<void>;
  setConn: (s: UIState['connStatus']) => void;
  setAvailableModels: (models: string[], backend?: AgentBackend) => void;
  setSelectedModel: (id: string) => void;
  // session.ready 的会话落库模型 → 选择器(spec 2026-09-11)。返回「要发 session.set_model 的模型 id」,
  // null = 不发帧 —— 发帧要 client 句柄,归 useKoubouConnection,store 只管落库与提示
  // (action 有返回值的先例:applyDragSnap 回报 handled)。
  // pid = 该 ready 所属项目:socket 回调与项目绑定,而本 action 写的 selectedModel / modelByProject
  // 取实时 currentProjectId 且都在 persist 白名单里,不核对就会把 A 项目的会话模型落进 B 项目
  syncSessionModel: (pid: number, readyModel: string | null | undefined, readyAvailable: string[] | undefined) => string | null;
  // 发起 aab 构建时记住包名(见 packageNameByProject)
  rememberPackageName: (projectId: number, packageName: string) => void;
  setSkills: (skills: SkillDef[]) => void;
  setAutoSendArmed: (v: boolean) => void;
  applyStudioPrelude: (prelude: StudioPrelude) => Promise<void>;
  // 升购模态开关(字段归 ServerState)。两个触发源都由 store 驱动:insufficient 来自 guard/WS 的
  // 积分不足错误,lowBalance 来自 refreshBalance 的余额阈值判定;关闭时一并清掉资产类型。
  setCreditModalOpen: (open: CreditModalSource | false, kind?: AssetKind | null) => void;
  setAllPlansOpen: (v: boolean) => void;   // 完整订阅弹窗开关(单卡弹窗的 see-all 与 free 直开共用)
  /** trigger 只在开窗时有意义(关窗复位);缺省 'insufficient' 保持「从升购弹窗进来」的既有语义 */
  setTopupModalOpen: (v: boolean, trigger?: CreditModalSource) => void;
  /** 订阅套餐配置缓存(瞬态);传 null 即失效——订阅成功后 current_tier 已过期,须重拉 */
  setPlansCache: (d: SubscriptionPlansData | null) => void;
  setNewUserStatus: (v: boolean | null) => void;
  // 锁定态下把选中模型强制归位到 Rez1(持久化里可能留着上次选的别家模型)
  enforceModelGate: () => void;
  togglePlanCollapsed: () => void;
  setPlanView: (view: 'tasks' | 'subagents') => void;
  setActiveVersion: (id: string) => void;
  saveVersion: () => void;                             // 本地"保存为版本"
  toggleCompare: () => void;
  setCompareWith: (id: string | null) => void;
  setPreviewTab: (tab: 'preview' | 'files') => void;
  setPreviewDevice: (device: PreviewDevice) => void;
  pushUserMessage: (m: Message) => void;
  // 乐观发送计时:新一轮消息发出即置位(run.started 前先行计时);同时记下可重发 payload
  markPendingSend: (send: LastSend) => void;
  markSteerSent: (content: string) => void;            // 插话已发出:记下内容供重发(不开新轮,故不置乐观计时)
  // ---- 应用层自动重试(设计稿 2026-08-25);判定在 reducer,执行在 client/useAgentRetry ----
  scheduleAgentRetry: (nextAt: number) => void;        // 退避排期到点时刻(时钟是副作用,不进 reducer)
  startAgentRetry: () => void;                         // 已发出,转在跑
  failAgentRetry: (f: AgentFailure) => void;           // 本次重试失败:走同一套判定推进下一次 / 落正式错误
  cancelAgentRetry: () => void;                        // 放弃自愈:落正式错误气泡(带最后一次原文)
  retryAgentNow: () => void;   // 固定槽报错上的手动重试;原因取自 agentError,不再需要调用方传(它就是那条气泡的数据源)
  requestModelMenu: () => void;   // 报错气泡的 Switch model:请求 Composer 的模型下拉展开(设计稿 2026-09-03)
  composerSet: (patch: Partial<ComposerState>) => void;
  editComposerDraft: (draft: string) => void;
  addRef: (key: string) => void;
  // 批量 @ 引用:N 个 key 折叠成**一次** set —— 循环调 addRef 会触发 N 轮 set + N 次重渲
  addRefs: (keys: string[]) => void;
  removeRef: (key: string) => void;
  resetComposer: () => void;
  uploadChatAttachment: (file: File) => Promise<void>;
  removeChatAttachment: (id: string) => void;
  resolvePending: (id: string) => void;
  // Toast 语义化入口:kind 由方法名承载,调用方不传 kind(杜绝用 setError 发成功提示)
  setError: (e: { code: string; message: string }) => void;
  setSuccess: (e: { code: string; message: string }) => void;
  setWarning: (e: { code: string; message: string }) => void;
  clearToast: () => void;
  // 组件直调 PGC(不经 guard)撞 401 时置位,统一交 useAuthGuard 跳转/本地提示(不弹红色报错)
  setAuthRequired: () => void;
  clearAuthRequired: () => void;
  setProjects: (projects: ProjectData[]) => void;
  setCurrentProject: (id: number | null) => void;
}

export type AppStore = KoubouState & ServerState & UIState & Actions & ServerActions;

// 回填 user.message 与既有 user 气泡是否同文本(own-tab 冲刷竞态去重;见 backfillSessionGap)
// REST 跟跑重入守卫(模块级,store 单例):同一 (pid,sid) 同时只跑一条轮询循环
let restTrackingKey: string | null = null;

function hasSameUserBubble(messages: Message[], e: ServerEvent): boolean {
  const content = (e.payload as { message?: { content?: unknown } }).message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b): b is { type: string; text?: string } => (b as { type?: string }).type === 'text').map((b) => b.text ?? '').join('')
      : '';
  if (!text) return false;
  return messages.some((m) =>
    m.role === 'user' && m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('') === text);
}

// 持久化切片(供 persist 的 partialize 与对象级节流 storage 共用同一形状)
function partializeAppState(s: AppStore) {
  return {
    currentProjectId: s.currentProjectId,
    // 只持久化每个项目最近若干条对话:localStorage 仅作快速回显缓存,历史真相在服务端
    // (重连经 REST /events 重新种子化),避免长会话把持久化 blob 无限撑大
    koubouByProject: capPersistedSessions(s.koubouByProject),
    genTasksByProject: s.genTasksByProject,
    // 与 genTasksByProject 成对:任务恢复得回来、卡恢复不回来的话,任务会被当残留剪掉(见 types.ts 注释)
    inflightCardsByProject: s.inflightCardsByProject,
    importedByProject: s.importedByProject,
    agentTasksByProject: s.agentTasksByProject,
    // 压缩包导入待落画布队列:页面中断后下次进入项目续跑(bug 13494008)
    importQueueByProject: s.importQueueByProject,
    // 未完成回放进度标记:刷新/切项目/返回主站后断点续播(快照本体在 koubouByProject)
    replayProgressByProject: s.replayProgressByProject,
    // 低余额弹窗锁:持久化才能做到「同一低余额区间只弹一次,刷新页面不重弹」(spec 约束 3)
    lowBalanceLockedUserId: s.lowBalanceLockedUserId,
    composer: { draft: s.composer.draft, attachments: [] as ChatAttachment[], baseLines: s.composer.baseLines },
    selectedModel: s.selectedModel,
    modelByProject: s.modelByProject,
    // 包名记忆:不持久化就只在当前标签页有效,等于没记(用户下次导出多半是另一天另一次会话)
    packageNameByProject: s.packageNameByProject,
    // 与 selectedModel 成对持久化:刷新后仍能判断"这个模型属于哪个 backend"
    modelBackend: s.modelBackend,
    previewDevice: s.previewDevice,
  };
}
type PersistedAppState = ReturnType<typeof partializeAppState>;

export const useStore = create<AppStore>()(
  // 显式标注持久化切片泛型:storage 是对象级(直收 StorageValue<PersistedAppState>),缺省推断会退化成 unknown
  persist<AppStore, [], [], PersistedAppState>(
    (set, get) => ({
      ...createInitialKoubouState(),
      ...createInitialServerState(),
      connStatus: 'connecting',
      compare: { on: false, withId: null },
      previewTab: 'preview',
      previewDevice: 'desktop',
      composer: { draft: '', attachments: [], baseLines: 2 },
      composerFocusRequest: 0,
      availableModels: [],
      selectedModel: null,
      modelByProject: {},
      packageNameByProject: {},
      modelBackend: null,
      skills: [],
      autoSendArmed: false,
      planCollapsed: false,
      planView: 'tasks',
      agentBackend: initialAgentBackend(),

      // 历史惰性化改由 onEvent 源头分流负责(useKoubouConnection.onEvent → importFromLiveEvent),此处不再预填去重集合
      // credit.insufficient 是 UI 级信号:仅对未见过的 live 帧弹积分模态(重连重放同 sequence 不二次弹);
      // 冷启动历史在 reducer 内部重放,不经过这里,天然不弹。
      ingestKoubou: (e) => set((s) => {
        const fresh = e.type === 'credit.insufficient'
          && (e.sequence == null || !s.seenSequences.includes(e.sequence));
        const next = applyKoubou(s, e);
        // agent 侧触发拿不到资产类型(事件只带 reason),进度卡据此退化成纯余额行
        if (fresh) return { ...next, creditModalOpen: 'insufficient' as const, creditModalKind: null };
        // model.changed 是服务端对切模型的确认(唯一权威):把选择器视图与项目记忆一并对齐,
        // 使被拒的切换(如 codex 'run already active')回到真实值而非停在乐观值
        if (e.type === 'model.changed' && typeof e.payload.model === 'string' && e.payload.model) {
          const model = e.payload.model;
          return {
            ...next,
            selectedModel: model,
            ...(s.currentProjectId != null
              ? { modelByProject: { ...s.modelByProject, [sessionSlotKey(s.currentProjectId, s.agentBackend)]: model } }
              : {}),
          };
        }
        return next;
      }),
      // 回放专用入口:user.message 事件成用户气泡(live 由 Composer 乐观渲染,reducer 无此分支)
      ingestReplayUserMessage: (e) => set((s) => applyUserMessage(s, e)),
      // 回放专用入口:AskUserQuestion 的回答只在 answered 帧(事件流无对应 user.message),
      // 用清除前的 pending questions 还原「标题:选项」排版合成用户气泡;pending 缺失(断点恢复
      // 落在 requested/answered 之间,pending 不持久化)退化为按 answers 键拼装。
      // applyKoubou 负责记 sequence + 清 pending;返回原引用 == sequence 已见(重连重放),不重复插泡
      ingestReplayQuestionAnswer: (e) => set((s) => {
        const p = e.payload as { interaction_id?: string; answers?: Record<string, string | string[]> };
        const answers = p.answers ?? {};
        const pending = p.interaction_id ? s.pendingInteractions[p.interaction_id] : undefined;
        const questions = pending?.kind === 'question' && pending.questions.length
          ? pending.questions
          : Object.keys(answers).map((q) => ({ question: q, options: [] }));
        const next = applyKoubou(s, e);
        const text = formatQuestionAnswer(questions, answers);
        if (!text || next === s) return next;
        return { ...next, messages: [...next.messages, { id: e.event_id ?? newId('msg'), role: 'user' as const, status: 'ready' as const, parts: [{ type: 'text' as const, text }] }] };
      }),
      // 载入目标项目会话快照;上一项目快照已在 onEvent 检查点持久化,无需在此回存
      switchProjectSession: (nextPid) => {
        set((s) => {
          // 槽位按「项目 + backend」:同项目下 cc / codex 是两个不同会话,快照与模型记忆各存各的
          const slot = nextPid != null ? sessionSlotKey(nextPid, s.agentBackend) : null;
          const saved: PersistedSession | undefined = slot ? s.koubouByProject[slot] : undefined;
          // 载入目标项目的模型记忆(槽位已含 backend,天然同 backend);无记忆时沿用当前值
          // ——**仅当当前值确属本 backend**(新项目继承最近一次全局选择,spec 2026-07-23);
          // 跨 backend 不继承:否则会把 cc 模型带进 codex 新会话,被 4400 拒且不重连。
          // 列表已加载则校验回落(记忆的模型可能已下线);冷启动列表为空先信记忆,setAvailableModels 会再解析
          // 未知归属(modelBackend=null:冷启动 / 老快照)按可继承处理 —— 真正的安全阀在建连处
          // (只带 modelBackend === agentBackend 的模型),这里宽松不会造成 4400,且保住 cc 既有语义
          const inherited = s.modelBackend == null || s.modelBackend === s.agentBackend ? s.selectedModel : null;
          const modelCandidate = (slot ? s.modelByProject[slot] : undefined) ?? inherited;
          // 门禁锁定时项目记忆一律让位 Rez1:否则切到一个记忆是 Claude 的旧项目就绕过了锁
          const gated = gatedModel(modelCandidate, modelGateLocked({
            isNewUser: s.newUserStatus, tier: s.plansCache?.current_tier ?? null, models: s.availableModels,
          }));
          return {
            selectedModel: s.availableModels.length ? resolveSelectedModel(s.availableModels, gated) : gated,
            ...createInitialKoubouState(),
            // 预选渲染器:新建会话用开关值,attach 已有会话时随后由 session.ready.backend 校正
            backend: s.agentBackend,
            sessionId: saved?.sessionId || null,
            lastSequence: saved?.lastSequence ?? 0,
            // messages / turns / tasks / subagents 一起搬(形状归一见 session-snapshot)。
            // 卡片跨刷新回显是 spec 2026-08-24 新增的;恢复出来的非终态卡由
            // trackActiveRunViaRest 按权威 active_run 校正,不会永久转圈
            ...restoreSnapshot(saved),
          };
        });
      },
      // REST 种子化:替换历史并初始化游标。历史惰性化交给 onEvent 源头分流,不再预填去重集合
      seedKoubouHistory: (page) => set((s) => seedHistory(s, page)),
      loadOlderMessages: async (opts) => {
        const s = get();
        if (s.historyLoading || !s.historyHasMore || s.historyOldestSeq == null || !s.sessionId || s.currentProjectId == null) return;
        const pid = s.currentProjectId;
        const sid = s.sessionId;
        const batch = opts?.batch === true;
        set({ historyLoading: true });
        // 每次手势凑满一批可见消息再停:事件页按「事件」计 50 条,其中大半是非展示帧
        // (thinking_tokens/SystemMessage/tool_result 折叠等),单页往往只出一两条可见消息,
        // 逐页停会让每次滚顶只多出几条,翻长历史体验极差。故循环续拉直到本次手势累计
        // 前插 ≥TARGET_MESSAGES_PER_GESTURE 条可见消息、或翻到顶(has_more=false)。
        // 这同时覆盖死区停摆问题(整页 0 可见消息 → historyMsgCount 不涨 → 内容高度不变
        // → 用户钉在顶部再无滚动增量 → 分页静默停摆,Bug #13426934)。
        // 上限兜底:防病态会话(超长连续死区)一次性发起海量请求冻结 UI;命中上限即停,
        // 靠后续滚动继续(此时内容多半已因命中上限前的可见消息而可再次滚动)。
        const TARGET_MESSAGES_PER_GESTURE = 50;
        const MAX_PAGES_PER_GESTURE = 50;
        const startMsgCount = s.historyMsgCount;
        // batch 模式:影子状态只做计数/游标推进,累积各页事件(页序新→旧,前插保持升序),循环结束一次性落库
        let shadow: KoubouState = s;
        let batchedEvents: ServerEvent[] = [];
        let fetchedAny = false;
        try {
          for (let fetched = 0; fetched < MAX_PAGES_PER_GESTURE; fetched += 1) {
            const cursor = (batch ? shadow : get()).historyOldestSeq;
            if (cursor == null) break;
            const page = await koubouApi.listEvents(pid, sid, { limit: 100, beforeSequence: cursor });
            // await 后校验:项目/会话已切换则丢弃过期响应(状态已被 switchProjectSession 重置)
            if (get().currentProjectId !== pid || get().sessionId !== sid) return;
            fetchedAny = true;
            let next: KoubouState;
            if (batch) {
              shadow = prependHistory(shadow, page);
              batchedEvents = [...page.events, ...batchedEvents];
              next = shadow;
            } else {
              set((st) => prependHistory(st, page));
              next = get();
            }
            const grewEnough = next.historyMsgCount - startMsgCount >= TARGET_MESSAGES_PER_GESTURE;
            const cursorAdvanced = next.historyOldestSeq != null && next.historyOldestSeq < cursor;
            // 停止条件:本次手势已凑满一批、已到顶、或游标没前移(空页/异常,避免同游标死循环)
            if (grewEnough || !next.historyHasMore || !cursorAdvanced) break;
          }
        } catch {
          // 静默失败:下次滚顶再试
        } finally {
          // batch 一次性落库:对**当前**state 重放合并页(live 尾部经 slice 保留)。
          // 0 可见消息也要落——has_more=false 必须写回,否则触发方(不满一屏 effect)会无限重试
          if (batch && fetchedAny && get().currentProjectId === pid && get().sessionId === sid) {
            const merged = { events: batchedEvents, has_more: shadow.historyHasMore, latest_sequence: shadow.lastSequence };
            set((st) => prependHistory(st, merged));
          }
          // 恒在 finally 复位:同项目内 sessionId 变更(重连改建新会话)走上面的 return 时,
          // 若不复位则 historyLoading 永卡 true,此后所有翻页静默失效(实测复现过的死锁)。
          // 项目已切换则 switchProjectSession 已整体重置,此处复位是幂等空写,无害
          if (get().currentProjectId === pid) set({ historyLoading: false });
        }
      },
      // 重连缺口回填(spec 2026-07-22 chat-conn-resilience):实测后端 WS 建连不重放历史事件,
      // 断线窗口内产生的消息/终态帧会永久缺失。重连的 session.ready 之后从 REST events 端点
      // 按 lastSequence 正向拉缺口逐条 ingest;seenSequences 幂等,后端将来支持 WS 重放也不重复。
      backfillSessionGap: async () => {
        const s0 = get();
        if (s0.replay != null) return;   // 回放期播放器独占会话,不回填
        const pid = s0.currentProjectId;
        const sid = s0.sessionId;
        if (pid == null || !sid) return;
        let cursor = s0.lastSequence;
        let sawSucceededRun = false;
        // 页数上限兜底:防病态长缺口一次性海量请求;残余缺口靠下次 ready 继续
        for (let i = 0; i < 10; i++) {
          let page: EventsPage;
          try {
            page = await koubouApi.listEvents(pid, sid, { afterSequence: cursor, limit: 100 });
          } catch { break; }   // 静默失败:下次重连 ready 再试
          // await 后校验:项目/会话已切换则丢弃过期响应
          if (get().currentProjectId !== pid || get().sessionId !== sid) return;
          if (!page.events.length) break;
          for (const e of page.events) {
            if (e.type === 'user.message') {
              // own-tab 冲刷竞态:重连 open 时积压命令冲刷,其 user.message 可能同时落进回填页,
              // 而本地已有乐观气泡 → 与既有 user 气泡同文本则跳过(启发式,窗口极窄)
              set((st) => (hasSameUserBubble(st.messages, e) ? st : applyUserMessage(st, e)));
            } else {
              get().ingestKoubou(e);
            }
            get().importMediaFromEvent(e);
            if (e.type === 'run.finished' && (e.payload as { status?: string }).status === 'succeeded') sawSucceededRun = true;
          }
          const newest = page.newest_sequence ?? cursor;
          if (newest <= cursor) break;   // 游标未前移:异常页,防死循环
          cursor = newest;
          if (newest >= (page.latest_sequence ?? newest)) break;   // 已追平会话最新
        }
        // 回填不走 onEvent 检查点,这里补一次快照持久化(与 onEvent 同形状)
        const st = get();
        if (st.currentProjectId === pid && st.sessionId === sid && st.lastSequence > s0.lastSequence) {
          set({ koubouByProject: { ...st.koubouByProject, [sessionSlotKey(pid, st.agentBackend)]: sessionSnapshot(st, sid) } });
        }
        // 缺口内 run 成功收尾:补做画布/版本刷新(live 路径挂在 onEvent,断线窗口错过)
        if (sawSucceededRun && get().currentProjectId === pid) {
          void get().loadCanvas().catch(() => {});
          void get().loadVersions().catch(() => {});
        }
      },
      // 进行中 run 的 REST 跟跑(spec 2026-07-23 run-rest-tracking):后端 run 事件只投递给发起
      // 命令的那条 WS 连接,刷新/重连后的新连接既收不到旧 run 的帧,ready.active_run 也恒 null
      // (会把本地 running 轮误闭)。REST /sessions.active_run_id 才是权威:据其复开误闭轮,
      // 并循环 backfillSessionGap 追消息流,直到终态帧(run.finished/interrupted)落地。
      trackActiveRunViaRest: async (isWsOwned, pollMs = 2_500) => {
        const s0 = get();
        if (s0.replay != null) return;   // 回放期播放器独占会话
        const pid = s0.currentProjectId;
        const sid = s0.sessionId;
        if (pid == null || !sid) return;
        // 重入守卫按 (pid,sid) 记键:同会话密集 ready(StrictMode/重连风暴)只跑一条循环;
        // 换会话的新调用放行(旧循环会在上下文守卫处自行退出)
        const key = `${pid}:${sid}`;
        if (restTrackingKey === key) return;
        restTrackingKey = key;
        try {
          let sessions: SessionSummary[];
          try { sessions = await koubouApi.listSessions(pid); } catch { return; }   // 静默:下次 ready 重试
          if (get().currentProjectId !== pid || get().sessionId !== sid || get().replay != null) return;
          const session = sessions.find((x) => x.session_id === sid);
          const runId = session?.active_run_id ?? null;
          // 快照恢复出来的陈旧卡片在此收口(spec 2026-08-24)。**必须在下面的早退之前** ——
          // 「无活跃 run」与「WS 已接管」恰恰是最需要收口的两种情形,写在早退之后就一次都不会执行。
          // 这里是唯一权威时机:session.ready.active_run 对新连接恒 null,靠它收会误伤仍在跑的卡。
          // **run 身份也要过 await 后的上下文校验**:runId 是 listSessions 发出那一刻的服务端快照,
          // 而卡片是响应到达那一刻的当下值。窗口内本地新开一轮(run.started 重置卡片并建出新卡)时,
          // 拿这个落后的答案去收会误伤正在跑的新卡 —— 而合成态不可逆(cardPatch 不许改回 running)。
          // 本地已知有个 REST 答案里没有的 run 在跑 ⟹ 这次答案对卡片没有权威性,跳过;
          // 下次 ready 会重新校正,run.finished 上的 sealRun 也仍是兜底
          const localRun = get().activeRunId;
          if (localRun == null || localRun === runId) {
            const sealed = sealStaleCards(get().subagents, runId);
            if (sealed !== get().subagents) set({ subagents: sealed });
          }
          if (!runId || isWsOwned(runId)) return;   // 无活跃 run / 本连接的 run 由 WS 流式投递
          // 起始时刻兜底(spec 2026-07-31):长 run 的 run.started 落在种子窗口(最新 100 条)之外时
          // 复开/补建的轮拿不到 startedAt,脚注退化成纯 "Running…"。活跃 run 期会话行最后一次写入
          // 就是该 run 开始那一刻(updated_at),据此补;它不带时区标记,必须归一后再用(否则偏 8 小时)
          set((st) => reopenRun(st, runId, normalizeIsoUtc(session?.updated_at)));
          // 上限兜底(240 次 ≈ 10 分钟):防病态长 run 无限轮询;命中后放弃,下次 ready 重新进入
          for (let i = 0; i < 240; i++) {
            await get().backfillSessionGap();
            const st = get();
            if (st.currentProjectId !== pid || st.sessionId !== sid || st.replay != null) return;
            if (st.runStatus !== 'running') return;   // 终态帧已消化,收口
            // WS 接管收敛:该 run 的帧开始经本连接到达(单进程部署下刷新 attach 会接管
            // 进行中 run 的后续投递,见 ws 文档「注意事项」)→ 退位让流式路径独跑
            if (isWsOwned(runId)) return;
            await new Promise((r) => setTimeout(r, pollMs));
            const st2 = get();
            if (st2.currentProjectId !== pid || st2.sessionId !== sid || st2.replay != null) return;
          }
        } finally {
          if (restTrackingKey === key) restTrackingKey = null;
        }
      },
      setConn: (connStatus) => set({ connStatus }),
      // 写可用模型列表,并解析默认选中(沿用有效旧选 / 否则首项)。
      // backend:该列表所属 backend —— 记下它,后续建连才知道 selectedModel 能不能用(见 modelBackend)
      setAvailableModels: (models, backend) =>
        set((s) => ({
          availableModels: models,
          selectedModel: resolveSelectedModel(models, s.selectedModel),
          ...(backend ? { modelBackend: backend } : {}),
        })),
      // 写视图 + 同步落当前项目的记忆;无项目(prelude 建项目前)只写视图,留待 pid 落地后再落映射。
      // 门禁在**写入口**收口(而非只在 UI 拦):prelude 的 ?model= 与项目记忆也走这里,
      // 单靠组件拦截会被这些路径绕过(spec 2026-08-28)
      setSelectedModel: (raw) =>
        set((s) => {
          const selectedModel = gatedModel(raw, modelGateLocked({
            isNewUser: s.newUserStatus, tier: s.plansCache?.current_tier ?? null, models: s.availableModels,
          })) as string;
          return {
          selectedModel,
          ...(s.currentProjectId != null
            ? { modelByProject: { ...s.modelByProject, [sessionSlotKey(s.currentProjectId, s.agentBackend)]: selectedModel } }
            : {}),
          };
        }),
      // 会话是「在用哪个模型」的唯一权威:选择器此前只信前端记忆,旧项目(记忆缺失或记忆已下架
      // 回落首项)因此显示 Rez1 而会话实际跑 fable 5 —— 与 TurnFooter 同屏打架(spec 2026-09-11)。
      // 判定是纯函数;这里只落两件副作用:回填走写入口 setSelectedModel(门禁与项目记忆都在那收口),
      // 下架则弹提示并把「该切到哪」回报调用方。切换的落定等后端 model.changed,不乐观改写 ——
      // set_model 可能被 invalid model / run already active 拒掉。
      syncSessionModel: (pid, readyModel, readyAvailable) => {
        const s = get();
        // 上下文校验:ready 帧可能属于已切走的项目(两个源头已在 koubou/client.ts 的 close() 与
        // useKoubouConnection 的 aborted 守卫堵掉,但不变式归写入口所有才不依赖调用点自觉)。
        // 本 action 写的两个字段都在 persist 白名单里,写错会跨刷新留存,方向与本需求正相反
        if (s.currentProjectId !== pid) return null;
        const action = resolveReadyModel(readyModel, readyAvailable, s.availableModels);
        if (action.kind === 'none') return null;
        if (action.kind === 'adopt') { get().setSelectedModel(action.model); return null; }
        // 门禁锁定态下 useNewUserGate 本来就会把会话切到 BASE_MODEL,这里再发一条是两条命令打架
        if (modelGateLocked({
          isNewUser: s.newUserStatus, tier: s.plansCache?.current_tier ?? null, models: s.availableModels,
        })) return null;
        // 目标由纯函数给出(取判定所用列表的首项),不在这里另取 store 列表 —— 两者可能不同源
        const next = action.fallback;
        // warning 而非 error:这是一次**成功的自动补救**(模型已下架 + 已替你切好),
        // 红色 error 样式会把它说成事故。柔和档的先例是 SESSION_SUPERSEDED
        set({ toast: {
          code: 'MODEL_RETIRED',
          message: `${modelLabel(action.model)} has been retired. Switched to ${modelLabel(next)}.`,
          kind: 'warning',
          params: { from: modelLabel(action.model), to: modelLabel(next) },
        } });
        return next;
      },
      // 空串按「清空记忆」处理(用户主动删掉不该被旧值顶回来)
      rememberPackageName: (projectId, packageName) =>
        set((s) => {
          const v = packageName.trim();
          const next = { ...s.packageNameByProject };
          if (v) next[String(projectId)] = v; else delete next[String(projectId)];
          return { packageNameByProject: next };
        }),
      setSkills: (skills) => set({ skills }),
      setAutoSendArmed: (autoSendArmed) => set({ autoSendArmed }),
      // 外部页面经 URL 传参进入:强制新建项目承载本次会话,再预填模型/输入框/资产,最后剥离 URL 上的 prelude 参数。
      applyStudioPrelude: async (prelude) => {
        try {
          // 模型须在建项目**之前**写入:currentProjectId 一落地 useKoubouConnection 即建连并读 selectedModel,
          // 若延后到 createProject 之后,建连 URL 会带上持久化的旧模型(主站选 A 实际连 B)。
          // 模型表达用户入口意图,即便后续建项目失败也保留。
          if (prelude.model) get().setSelectedModel(prelude.model);
          // 强制新建(不复用最近项目);createProject 经 guard,失败时 currentProjectId 不落地
          await get().createProject(DEFAULT_PROJECT_NAME);
          const pid = get().currentProjectId;
          if (pid == null) return; // 新建失败:跳过预填(toast 已由 guard 置)
          // pid 落地后再写一次:建项目前那次只写了视图(无项目不落映射),此处补落该新项目的记忆
          if (prelude.model) get().setSelectedModel(prelude.model);
          // 纯文本种子(txt/md)预拉内容:发送时内联进正文;经同源媒体代理规避 CORS。
          // 全部落定(成败均可)后才预填并 arm——保证自动发送时内容已就位;失败降级 URL token,不弹 Toast
          const seedTexts = await Promise.all(prelude.assets.map(async (a) => {
            if (a.kind !== 'text' || !isPlainTextName(a.name ?? a.url)) return undefined;
            try {
              const res = await fetch(assetProxyUrl(a.url)!);
              return res.ok ? await res.text() : undefined;
            } catch {
              return undefined;
            }
          }));
          if (get().currentProjectId !== pid) return; // await 后校验:切项目则丢弃
          get().composerSet({
            draft: prelude.prompt ?? '',
            // 资产已在 PGC 入库、传 url:预置为 ready 附件(无 itemId → 移除仅本地丢弃、不删 PGC),
            // AttachmentBar 在输入框上方渲染、Composer.send 已有路径随消息发送
            attachments: prelude.assets.map((a, i): ChatAttachment => ({
              id: newId('att'), name: assetSeedLabel(a), mime: '', kind: a.kind, status: 'ready', url: a.url,
              ...(seedTexts[i] != null ? { text: seedTexts[i] } : {}),
            })),
          });
          // 有可发送内容(prompt 或 assets)→ armed,由 Composer 在 client 就绪时自动发送一次;仅 model 不发(无内容可发)
          if ((prelude.prompt && prelude.prompt.trim()) || prelude.assets.length > 0) set({ autoSendArmed: true });
          // 收敛 URL:剥掉 model/prompt/assets,仅留 ?project=<public_id>
          // (createProject 内 syncProjectToUrl 用 withProjectParam 会保留旧参数,故须显式重写)
          if (typeof window !== 'undefined') {
            const publicId = get().projects.find((p) => p.id === pid)?.public_id ?? null;
            const next = withProjectParam('', publicId);
            window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
          }
          // createProject 入列时 projects 仅含新建项(冷启动 projects:[]),须补全用户其余项目,
          // 否则进入工作台后侧栏列表只剩这个新建的「Untitled game」(bug #13088343)。current 不变。
          await get().refreshProjectList();
        } finally {
          set({ booting: false }); // 撤全局加载层(prelude 分支不经 loadProjects 的 finally)
        }
      },
      // 关闭时把资产类型与 all-plans 一并清掉:下次打开若拿不到类型,不能沿用上一次的
      setCreditModalOpen: (creditModalOpen, kind = null) => set(
        creditModalOpen
          ? { creditModalOpen, creditModalKind: kind }
          : {
              creditModalOpen, creditModalKind: null, allPlansOpen: false,
              // 订阅成功时弹窗还开着的话,plansCache 的失效被推到关窗这一刻——当场清会让
              // CreditModalGate 见 plans==null 直接卸载弹窗、吃掉成功态停留(见 ServerState.subscribeSucceeded)
              ...(get().subscribeSucceeded ? { plansCache: null, subscribeSucceeded: false } : {}),
            },
      ),
      setAllPlansOpen: (allPlansOpen) => set({ allPlansOpen }),
      setTopupModalOpen: (topupModalOpen, trigger = 'insufficient') => set(
        topupModalOpen ? { topupModalOpen, topupTrigger: trigger } : { topupModalOpen, topupTrigger: 'insufficient' },
      ),
      setPlansCache: (plansCache) => set({ plansCache }),
      setNewUserStatus: (newUserStatus) => set({ newUserStatus }),
      // 门禁归位:判据是纯函数(modelGateLocked),这里只做「锁定 && 选中不是 Rez1 → 改写」。
      // 复用 setSelectedModel 以带上「同步落当前项目模型记忆」的语义,否则切回本项目又会取回旧模型。
      enforceModelGate: () => {
        const s = get();
        const locked = modelGateLocked({
          isNewUser: s.newUserStatus, tier: s.plansCache?.current_tier ?? null, models: s.availableModels,
        });
        if (!locked || s.selectedModel === BASE_MODEL) return;
        get().setSelectedModel(BASE_MODEL);
      },
      togglePlanCollapsed: () => set((s) => ({ planCollapsed: !s.planCollapsed })),
      setPlanView: (view) => set({ planView: view }),
      setActiveVersion: (id) =>
        set((s) => ({ activeVersionId: id, versions: s.versions.map((v) => ({ ...v, current: v.id === id })) })),
      saveVersion: () =>
        set((s) => {
          const index = s.versions.length + 1;
          const active = selectActiveVersion(s.versions, s.activeVersionId);
          const v: Version = {
            id: newId('v'),
            index,
            label: `Version ${index}`,
            summary: 'Manual save',
            createdAt: new Date().toISOString(),
            current: true,
            status: 'ready',   // 纯前端手动存档,不经 PGC build,直接视作可用版本
            assetKeys: s.assets.map((a) => a.key),
            game: active?.game ?? { title: 'NIGHTCAP', palette: 'neon' },
          };
          return { versions: [...s.versions.map((x) => ({ ...x, current: false })), v], activeVersionId: v.id };
        }),
      // 开启时默认比较最新的两个版本:激活最新(左),withId 次新(右);关闭时清空选择。
      // 开启同时强制切回 preview tab:对比视图渲染在 preview 舞台,停留在 Files 会看不到对比。
      toggleCompare: () =>
        set((s) => {
          if (s.compare.on) return { compare: { on: false, withId: null } };
          if (s.versions.length < 2) return {};
          const latest = s.versions[s.versions.length - 1];
          const second = s.versions[s.versions.length - 2];
          return {
            compare: { on: true, withId: second.id },
            previewTab: 'preview',
            activeVersionId: latest.id,
            versions: s.versions.map((v) => ({ ...v, current: v.id === latest.id })),
          };
        }),
      setCompareWith: (withId) => set((s) => ({ compare: { ...s.compare, withId } })),
      setPreviewTab: (previewTab) => set({ previewTab }),
      setPreviewDevice: (previewDevice) => set({ previewDevice }),
      pushUserMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      // 乐观发送计时 + 超时兜底:run.started 永不到达(命令在后端丢失/连接实际已死)时,
      // 45s 后若时间戳未被清/未被新发送刷新且 run 未开跑,清计时并提示重试——否则骨架+计时永挂
      markPendingSend: (send) => {
        const stamp = new Date().toISOString();
        // 一并快照发送时刻的 model(选择器意图优先,会话回显兜底):run.started 建轮时用它兜底,
        // 避免会话 model 尚为 null 时把 pending 期已展示的模型名冲掉。
        // lastSend 供自动重试原样重发;顺带清重试态 —— 用户手动发送即放弃上一条的自愈
        set((s) => ({ pendingSendAt: stamp, pendingModel: s.selectedModel ?? s.model, lastSend: send, agentRetry: null, agentError: null }));
        setTimeout(() => {
          const s = get();
          if (s.pendingSendAt !== stamp || s.runStatus === 'running') return;
          set({ pendingSendAt: null, pendingModel: null });
          s.setError({ code: 'SEND_TIMEOUT', message: 'No response from the agent, please retry' });
        }, 45_000);
      },
      // 插话不开新轮,故不置乐观计时;内容照记 —— 后端把 user.steer 当新消息跑,重发它语义正确
      markSteerSent: (content) => set({ lastSend: { content }, agentRetry: null, agentError: null }),
      scheduleAgentRetry: (nextAt) =>
        set((s) => (s.agentRetry ? { agentRetry: { ...s.agentRetry, phase: 'waiting' as const, nextAt } } : {})),
      startAgentRetry: () =>
        set((s) => (s.agentRetry ? { agentRetry: { ...s.agentRetry, phase: 'running' as const, nextAt: null } } : {})),
      failAgentRetry: (f) => set((s) => failAgentTurn(s, f)),
      cancelAgentRetry: () => set((s) => {
        const r = s.agentRetry;
        if (!r) return {};
        // 用户放弃 / 连接已致命:把最后一次的原因落成正式气泡,否则取消后什么痕迹都不留。
        // 走 pushAgentError 而非 failAgentTurn —— 取消的是**自动**重试,lastSend 要留着给手动重试
        return pushAgentError(s, { code: r.code, fallback: r.text, detail: r.detail });
      }),
      // 手动重试:从头计数。mode 仍按「失败的那一轮是否已有产出」判,不是无脑重发。
      // **必须校 status === 'error'**:失败可能根本没起 run(error 事件先于 run.started 到),
      // 这时 turns 末条是上一轮**成功**的 turn,拿它的 lastMessageId 判会发出 continue ——
      // 而用户点「重试」的意图是重发那句话
      retryAgentNow: () => set((s) => {
        const err = s.agentError;
        if (!err) return {};
        if (!s.lastSend) return {};
        if (s.agentRetry) return {};   // 已在自愈中就不叠一次(UI 判据已含,action 层再兜一道)
        const lastTurn = s.turns[s.turns.length - 1];
        const resumable = lastTurn?.status === 'error' && lastTurn.lastMessageId != null;
        // 清掉固定槽:进度气泡就地占它那一格,两条并排等于「刚又失败了一次」。
        // 不是丢弃 —— 原因随 agentRetry 带走,重试再失败或用户喊停时会重新落回固定槽
        return {
          agentError: null,
          agentRetry: {
            attempt: 1,
            mode: resumable ? 'continue' as const : 'resend' as const,
            phase: 'waiting' as const,
            nextAt: null,
            text: err.text,
            ...(err.code ? { code: err.code } : {}),
            ...(err.detail ? { detail: err.detail } : {}),
          },
        };
      }),
      requestModelMenu: () => set((s) => ({ modelMenuRequest: s.modelMenuRequest + 1 })),
      composerSet: (patch) => set((s) => ({ composer: { ...s.composer, ...patch } })),
      // 编辑历史输入只替换草稿；保留用户尚未发送的附件与输入框高度，避免消息操作静默丢状态。
      editComposerDraft: (draft) => set((s) => ({
        composer: { ...s.composer, draft },
        composerFocusRequest: s.composerFocusRequest + 1,
      })),
      addRef: (key) => set((s) => ({ composer: { ...s.composer, draft: insertMentionRef(s.composer.draft, key) } })),
      // 折叠而非循环:insertMentionRef 是纯函数,N 个 key 在一次 set 里算完
      addRefs: (keys) => {
        if (keys.length === 0) return;   // 空选区 no-op:不空转一次 set,也不给草稿平添尾随空格
        set((s) => ({ composer: { ...s.composer, draft: keys.reduce(insertMentionRef, s.composer.draft) } }));
      },
      removeRef: (key) => set((s) => ({ composer: { ...s.composer, draft: removeMentionKey(s.composer.draft, key) } })),
      // 保留用户拖出的基准高度,不随重置丢失
      resetComposer: () => set((s) => ({ composer: { draft: '', attachments: [], baseLines: s.composer.baseLines } })),
      // 对话窗上传:走画布上传端点拿 URL,标记 chat_attachment(loadCanvas 据此过滤,不上画布),仅对话内显示
      uploadChatAttachment: async (file) => {
        const id = newId('att');
        const pid = get().currentProjectId;
        if (pid == null) return;
        const kind = kindFromFile(file);
        const setAtts = (next: ChatAttachment[]) => set((s) => ({ composer: { ...s.composer, attachments: next } }));
        const patch = (p: Partial<ChatAttachment>) =>
          setAtts(get().composer.attachments.map((a) => (a.id === id ? { ...a, ...p } : a)));
        setAtts([...get().composer.attachments, { id, name: file.name, mime: file.type, kind, status: 'uploading' }]);
        try {
          // 纯文本(txt/md)分流专用 text 接口(与画布 doUploadAsset 同构):multipart 上传端点只收
          // 图片/视频/音频/PDF/glb(文本 → 422);content 内联入库并缓存到附件,发送时内联进正文
          // glTF 可能被浏览器标成 text/plain；先尊重 kindFromFile 的扩展名判定，避免误送文本接口。
          if (kind === 'text' && TEXT_MIMES.includes(file.type)) {
            const content = await file.text();
            const item = await pgcApi.createTextItem(pid, {
              content,
              name: file.name.replace(/\.[^.]+$/, ''),
              text_format: file.type === 'text/markdown' ? 'markdown' : 'plain',
              reference: { chat_attachment: true },   // 创建即带标记,免二次 PATCH
            });
            if (get().currentProjectId !== pid) return; // await 后切项目则丢弃
            patch({ status: 'ready', url: resolveAssetUrl(item.url), itemId: item.item_id, text: content });
            return;
          }
          const item = await uploadCanvasItem(pid, file);
          if (get().currentProjectId !== pid) return; // await 后校验:切项目则丢弃,不再标记
          await pgcApi.updateCanvasReference(pid, item.item_id, { chat_attachment: true });
          if (get().currentProjectId !== pid) return; // await 后切项目则丢弃
          patch({ status: 'ready', url: resolveAssetUrl(item.url), itemId: item.item_id });
        } catch (e) {
          if (get().currentProjectId !== pid) return;
          patch({ status: 'error' });
          if (e instanceof PgcError) set({ toast: { code: e.code, message: e.message, kind: 'error' } });
          else throw e; // 未知错误照抛,便于发现 bug
        }
      },
      // 移除附件:已上传(未发送)的删孤儿;未就绪/无 itemId 仅本地移除
      removeChatAttachment: (id) => {
        const att = get().composer.attachments.find((a) => a.id === id);
        const pid = get().currentProjectId;
        if (att?.itemId && pid != null) void pgcApi.deleteCanvasItem(pid, att.itemId).catch(() => {});
        set((s) => ({ composer: { ...s.composer, attachments: s.composer.attachments.filter((a) => a.id !== id) } }));
      },
      resolvePending: (id) => set((s) => { const p = { ...s.pendingInteractions }; delete p[id]; return { pendingInteractions: p }; }),
      setError: (e) => set({ toast: { ...e, kind: 'error' } }),
      setSuccess: (e) => set({ toast: { ...e, kind: 'success' } }),
      setWarning: (e) => set({ toast: { ...e, kind: 'warning' } }),
      clearToast: () => set({ toast: null }),
      setAuthRequired: () => set({ authRequired: true }),
      clearAuthRequired: () => set({ authRequired: false }),
      setProjects: (projects) => set({ projects }),
      setCurrentProject: (currentProjectId) => set({ currentProjectId }),
      ...createServerActions(set, get),
    }),
    {
      // 应用自有 key(防白闪脚本读的是主站契约 key `rezonalab-config`,与本 key 无关)。
      // 画布退役(2026-10-19)刻意**不换 key**:换 key 会清掉模型记忆、草稿、低余额锁、回放断点与
      // 导入续跑队列,只为少几个残留字段不值 —— 残留由 v3 迁移清理(见 migratePersistedState)
      name: 'rezonalab-v4',
      // v2:新增 modelByProject(旧快照缺字段由 persist 浅合并回落初始 {},selectedModel 自然成全局兜底,无需搬数据)
      // v3:删除画布退役后无读方的五个键
      version: 3,
      // migrate 收旧版本快照(形状未知),修补后即视为当前持久化形状(persist 的约定语义)
      migrate: (persisted, version) => migratePersistedState(persisted, version) as PersistedAppState,
      // 对象级节流:koubou 流式期间 set() 高频触发,序列化 + 写盘都合并进节流窗口
      // (旧实现只节流写盘,stringify 仍每 token 执行;见 persist-storage / createThrottledPersistStorage)
      storage: persistStorage,
      partialize: partializeAppState,
    },
  ),
);

// 开发调试句柄:控制台/Playwright 直读 store 状态(生产构建剔除)
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __store?: typeof useStore }).__store = useStore;
}
