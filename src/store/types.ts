import type { AssetKind } from '@/lib/asset-kind';
import type { SubscriptionPlansData, SubscriptionTier } from '@/lib/biz/types';
import type { UpsellSource } from '@/lib/subscription/plan-display';
import type { ProjectData, CurrentUser, BalanceData, CanvasGenFailure } from '@/lib/pgc/types';
import type { MediaItem, QuestionDef, FileDiff, ServerEvent, SubmittedTask, PlanTask, UserMessageContent } from '@/koubou/protocol';
import type { RetryMode } from '@/lib/agent-retry';
import type { AgentBackend } from '@/lib/agent-backend';
import type { SubagentState } from '@/lib/subagent-tasks';
import { createSubagentState } from '@/lib/subagent-tasks';

// manual = 用户在画布上手写的文本便签(既非 AI 生成也非上传文件)。
// source 现随 reference 持久化(见 pgc/map.ts):此前每次 loadCanvas 都按 parentId 现推,
// 上传的图片和手写便签刷新后统统变成「生成」——字段一直是错的,只是从没显示给用户看过。
export type AssetSource = 'generated' | 'derived' | 'uploaded' | 'reference' | 'manual';
export type Status = 'pending' | 'generating' | 'ready' | 'error';

// 创作溯源(spec 2026-08-03-canvas-provenance):这张资产「当时是怎么生成的」。
// 随 reference 落库,故能跨刷新。画布界面退役后只剩 agent 产物这一个写入方(从工具入参提取),
// 写回后端的契约不变
export interface AssetProvenance {
  kind: 'image' | 'video' | 'audio' | '3d';   // 决定重发走哪个 generate*
  req: Record<string, unknown>;               // 原始请求体(prompt / model / 各类生成参数)
  // 生成时刻 ISO,由调用方给(导入 / 登记时刻)。后端 canvas item 现在有 created_at 了,
  // 但那是**建卡时间**、口径不同 —— 异步登记路径尤其差一整个生成周期(见 lib/agent-provenance.ts)
  at: string;
  // 口径判别器:req 是 **koubou 工具入参**而非前端 PGC 请求体(agent 在对话里生成的资产)。
  // 两者只差模型别名一处(spec 2026-08-06-agent-asset-provenance;读侧归一已随画布界面退役)。
  // 用显式字段而非嗅探键名 —— 嗅探会在 koubou / pgc 任一侧改字段时静默错判
  agent?: true;
}

export interface AssetPreviewData { color?: string; title?: string; src?: string; dataUrl?: string; duration?: string; text?: string; poster?: string; }
export interface Asset {
  id: string; key: string; label: string;
  kind: AssetKind; source: AssetSource;
  parentId?: string;
  refIds?: string[];         // 本次生成引用的其他画布资产 id(多引用连线,parentId 之外)
  status: Status;
  position: { x: number; y: number };
  preview?: AssetPreviewData;
  provenance?: AssetProvenance;   // 见上;取代了早先声明却从未被赋值的死字段 prompt
  // 服务端数字主键(自增),仅作**创建顺序**依据供列表排序 —— 它是自增的,所以本身就是创建顺序。
  // 只读不写:服务端自有主键,回写它没有意义,故不进 assetReference
  seq?: number;
  // 建卡时间(服务端口径,UTC tz-aware)。给的是**刻度**(相对时间 / 按天分组),顺序仍用 seq ——
  // 两者语义重叠,不做成第二个排序维度。前端自建的 pending_ 占位卡没有它,故可选;
  // 但**不要**拿「有没有它」当在飞判据 —— 服务端异步生成的在飞卡是有它的真实卡,
  // 在飞看 status
  createdAt?: string;
  sourceFilename?: string;   // 来源 agent 资产文件名(import 经 reference 回显),仅作溯源;去重由 importedByProject 负责
  importRelPath?: string;    // 压缩包导入溯源(reference.import_rel_path 回显);中断续导入按此去重
  progress?: number;         // 上传字节进度 0..1;仅上传占位卡在字节上传阶段有值,其余态为 undefined
  threeDType?: 'model3d' | 'rig3d'; // kind=3d 下保留 PGC 原始类型,决定静态/骨骼动画渲染
  rigAnimations?: string[];       // rig3d 请求动作顺序；兼容历史 GLB 的 NlaTrack 泛化命名
  referenceLinks?: { to: string; kind: string }[]; // PGC 派生血缘,坐标 PATCH 时必须原样保留
  failure?: CanvasGenFailure | null;
}

export interface Version {
  id: string; index: number; label: string; summary: string;
  createdAt: string; current: boolean;
  status: string;          // PGC 契约值域:ready(已 build)/ building(新建占位);发布到 Rezona 前据此预检
  cover?: string;          // 已解析的版本封面图直链;缺失时时间线回退色块
  assetKeys: string[];
  game: { title: string; palette: string };
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'media'; kind: AssetKind; url?: string; name?: string }   // url 可缺:文本附件(专用 text 接口,url 恒空)靠 kind 图标渲染 chip
  // 存量形态:报错已改为固定槽的瞬态 AgentError(设计稿 2026-08-27),新会话不会再产生这种 part。
  // 类型保留只为老快照能被读出来再滤掉(见 session-snapshot 的 dropLegacyErrors),勿再往里写
  | { type: 'error'; text: string; code?: string; detail?: string }
  | { type: 'notice'; code: string }   // 系统性提示(如用户终止后的助手回复);code 即 i18n key,渲染期翻译
  | { type: 'tool'; id: string; name: string; input: unknown; status: Status; result?: string; media?: MediaItem[]; diff?: FileDiff; submittedTask?: SubmittedTask };

// 对话窗上传附件的会话内态:后台上传 → 就绪后带 url/itemId;移除时按 itemId 删孤儿
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  kind: AssetKind;
  status: 'uploading' | 'ready' | 'error';
  url?: string;     // resolveAssetUrl 后的绝对 URL:气泡缩略图 + koubou
  itemId?: string;  // 画布 item_id:移除时删孤儿
  text?: string;    // 纯文本内容(txt/md):发送时内联进正文而非 URL 引用
}

export interface Message {
  id: string; role: 'user' | 'assistant'; parts: Part[]; status: Status;
}

export type TurnStatus = 'running' | 'succeeded' | 'error' | 'interrupted';
// 一轮 agent run 的元数据:用于在最后一条消息下方展示「模型 · 耗时」。起止时间取服务端 created_at。
export interface TurnMeta {
  runId: string | null;
  model: string | null;          // 该轮实际所用模型 id
  startedAt: string | null;      // run.started.created_at (ISO)
  finishedAt: string | null;     // run.finished/interrupted.created_at;running 时 null
  status: TurnStatus;
  lastMessageId: string | null;  // 该轮最后一条 assistant 消息 id —— footer 锚点
  // 本轮是否已由 error 事件报过错。终态帧(run.finished{failed})要靠它去重 ——
  // 后端 live 的 run.finished 从不带 error,得自己补气泡,但不能和 error 事件各推一条。
  // 可选字段:老快照没有它,读出来是 undefined,按「没报过」处理正合适
  errorReported?: boolean;
}

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal' | 'stalled';
export type RunStatus = 'idle' | 'running' | 'error';

// 未决交互(工具审批 / AskUserQuestion),按 interaction_id 去重
// method:codex 用它区分命令 / 文件修改 / 权限 / MCP elicitation(Claude backend 不带 → 通用卡)
export interface ApprovalInteraction { kind: 'approval'; interactionId: string; toolName: string; input: unknown; method?: string }
export interface QuestionInteraction { kind: 'question'; interactionId: string; questions: QuestionDef[] }
export type PendingInteraction = ApprovalInteraction | QuestionInteraction;

// 对话切片(由 applyKoubou 维护)
export interface KoubouState {
  messages: Message[];
  runStatus: RunStatus;
  activeRunId: string | null;
  sessionId: string | null;
  lastSequence: number;
  model: string | null;
  // 当前会话实际所属 backend:建会话时固定,以 session.ready.backend 为权威;
  // 决定 agent 消息渲染器(claude.message / codex.message)。UIState.agentBackend 只是「新建会话用哪个」
  backend: AgentBackend;
  // 会话权限模式(session.ready.permission_mode / permission_mode.changed);本期只观测,无切换 UI
  permissionMode: string | null;
  pendingInteractions: Record<string, PendingInteraction>;
  turns: TurnMeta[];
  tasks: PlanTask[];         // agent 任务清单(planner 模式);由任务工具 tool_use_result 累积,TaskList 快照整单校正
  // 后台任务(子代理 / 后台命令)卡片。与上面的 tasks 是两回事:那是 agent 自己的待办清单,
  // 这是 Task*Message 生命周期端点维护的一组卡。
  // **随会话快照持久化**(spec 2026-08-24,取代原先「瞬态不落盘」的口径):事件窗口只有最新 100 条,
  // 长回合里开卡事件早被挤出窗口,不落盘就只能靠重放重建出最新那几张。当初拒绝落盘是怕留下一批
  // 无从推进的僵尸卡 —— 现在有三条通道兜着:① `sealStaleCards` 按 REST 权威 active_run 收陈旧卡;
  // ② backfillSessionGap 补回的 run.finished 走 sealRun;③ PlanCard 只在 runStatus==='running'
  // 时渲染,回合不在跑时卡片整块不可见。**改回不落盘前先想清楚这三条**(③ 是 UI 门控,
  // 放宽 PlanCard 的可见条件等于拆掉最后一道)
  subagents: SubagentState;
  historyTurnCount: number;  // turns 中由 historyEvents 重建的前缀长度(瞬态,与 historyMsgCount 对称)
  seenSequences: number[];   // 重放去重,不持久化
  // 乐观发送时间(ISO,瞬态不持久化):用户发出新一轮消息即置位,run.started/终态/ready 校正时清除;
  // 用于 run.started 前(及 model 未知时)就渲染回合计时,而非只有骨架屏
  pendingSendAt: string | null;
  // 发送时刻的 model 快照(瞬态,与 pendingSendAt 同生命周期):run.started 到达时会话回显 model
  // 可能仍为 null(SystemMessage 未到),用它兜底避免 footer 上模型名闪失
  pendingModel: string | null;
  // ---- 历史分页(REST events 端点),全部瞬态不持久化 ----
  historyEvents: ServerEvent[];      // 已加载的历史事件日志(升序,仅内存;prepend 时整体重建保证跨页折叠正确)
  historyMsgCount: number;           // messages 中由 historyEvents 重建出的前缀长度
  historyOldestSeq: number | null;   // 翻页游标(已加载最旧 sequence)
  historyHasMore: boolean;
  historyLoading: boolean;
  // ---- 应用层自动重试(设计稿 2026-08-25),两项都瞬态不持久化 ----
  // 最后一次发送的原始 payload,供 resend 模式原样重发。**不能从用户气泡反推** ——
  // 气泡里是渲染文本,与实际发给后端的 koubouText(@[type]<url> token / attachment 标签 /
  // image 内容块)不是一回事。
  // 插话(steer)同样记在这里:实测无活动 run 时后端把 user.steer 当新消息照常起一轮 run,
  // 所以重发插话内容 = 重发用户那句话,语义正确 —— 插话不该因一次上游抖动就丢掉
  lastSend: LastSend | null;
  // 重试上下文。**必须瞬态**:要重发的 payload 跨不了刷新,落盘只会留下一条永远转圈的
  // 「重试中 3/10」。phase='waiting' 等退避到点,'running' 已发出还没回声(nextAt 由 client hook 补,
  // 时钟是副作用不进 reducer),'responded' 后端已起 run —— 自愈这件事对用户已经结束
  agentRetry: AgentRetry | null;
  // 当前要展示的报错(设计稿 2026-08-27)。与 agentRetry 同为**瞬态**、同一个固定槽、同一套
  // 生命周期,同一时刻至多一条 —— 报错不再是 messages 里的一条消息,故对话流里不再堆历史失败。
  // 两者互斥:落正式报错即放弃自愈。
  agentError: AgentError | null;
}

export interface AgentError {
  text: string;               // 主行 fallback(渲染期按 code 翻译)
  code?: string;
  detail?: string;            // 上游原文,走 ErrorDetail 折叠
  // 后端权威判定「不可重试」(upstream_auth_failed / upstream_error / output_limit / budget_exceeded)。
  // 只记**事实**:气泡该不该附带「换模型」提示由 selectModelSwitchHint 结合模型列表 / 门禁判定,
  // reducer 看不到那些状态(设计稿 2026-09-03)。retryable 缺失或自愈耗尽的报错不写此字段
  retryable?: false;
}

// 最后一次发送的可重发 payload(普通发送与插话同权)
export type LastSend = { content: UserMessageContent['content'] };

export interface AgentRetry {
  attempt: number;            // 已用掉的重试次数,1 起
  mode: RetryMode;            // 本次要发什么:原样重发 / continue
  // responded = 重试已被后端受理(run.started 到了):进度气泡就此退场,但状态**不清空** ——
  // attempt 还得留着,否则「起跑后再失败」每次都从 1 重数,10 次上限形同虚设
  phase: 'waiting' | 'running' | 'responded';
  nextAt: number | null;      // waiting 期的到点时刻(epoch ms);null = 尚未排期或正在跑
  text: string;               // 主行 fallback(与 error part 同源)
  code?: string;
  detail?: string;            // 本次上游原文
}

export function createInitialKoubouState(): KoubouState {
  return {
    messages: [], runStatus: 'idle', activeRunId: null,
    sessionId: null, lastSequence: 0, model: null, backend: 'cc', permissionMode: null, pendingInteractions: {},
    turns: [], tasks: [], subagents: createSubagentState(), historyTurnCount: 0, seenSequences: [], pendingSendAt: null, pendingModel: null,
    historyEvents: [], historyMsgCount: 0, historyOldestSeq: null, historyHasMore: false, historyLoading: false,
    lastSend: null, agentRetry: null, agentError: null,
  };
}

// 每项目会话持久化(单会话自动恢复)
// subagents 可选:老快照没有这个字段(2026-08-24 之前卡片刻意不落盘),载入时按空态兜底
export interface PersistedSession { sessionId: string; lastSequence: number; messages: Message[]; turns: TurnMeta[]; tasks: PlanTask[]; subagents?: SubagentState }

// audio 只有音乐模型走异步(Noiz / Seed-Audio 仍是同步端点当场返回),故本类别不等于「所有音频生成」
export type GenTaskKind = 'video' | 'model3d' | 'rig3d' | 'retexture' | 'audio';

/** 派生任务(从已有 3D 资产再加工):轮询间隔更短、失败语义与超时兜底都与基础任务不同 */
export const isDerivedGenKind = (kind: GenTaskKind): boolean => kind === 'rig3d' || kind === 'retexture';

/**
 * 基础任务 = **不是派生的那些**,刻意不枚举 video/model3d/audio。
 *
 * 这里曾经是三份各自枚举的清单(actions 的 pollGenTasks、useCanvasPolling 的计数选择器与 tick),
 * 加第五种 kind `audio` 时只改到其中一份 —— 另外两份仍写死 `video || model3d`,于是音频任务
 * 登记进了 store 却**没有任何 interval 会起来**,GET 一次都不发。服务端 77 秒就出了货,画布上
 * 的卡转圈到天荒地老(2026-10-08 devlab 实发,task gtask-72b0d219)。
 * 按补集定义之后,下一种 kind 不写这里也自动被轮询 —— 漏写的失败方向从「静默不轮询」翻成
 * 「多轮询一个」,后者会立刻被发现,前者不会。
 */
export const isBaseGenKind = (kind: GenTaskKind): boolean => !isDerivedGenKind(kind);

// 异步生成任务(video/model3d/rig3d/retexture/audio)的轮询登记:agent 在对话里提交的任务,
// 以及 restoreGenTasks 按 item 前缀从服务端接回的在飞任务。
// startedAt 持久化用于超时判定;fails/nextPollAt 用于派生任务的输运错误退避,恢复时重置。
export interface GenTask {
  itemId: string; kind: GenTaskKind; taskId: string; startedAt: number; fails?: number;
  nextPollAt?: number;
}

// 底部提示条载荷:kind 缺省视为 error(红色报错);warning 为柔和提示(中性色);success 为成功反馈
export type ToastKind = 'error' | 'success' | 'warning';
export type ToastMessage = {
  code: string; message: string; kind: ToastKind;
  // i18n 插值参数(如「N 张卡的位置未能保存」的 count)。有了它,带数量的文案不必再由
  // store 提前本地化好塞进 message(UPLOAD 那条的历史包袱)
  params?: Record<string, unknown>;
};
export type ReplayPhase = 'provisioning' | 'cloning' | 'finalizing' | 'playing' | 'skipping' | 'error';
// 回放切片:provisioning 三步 → playing 逐帧 → completeReplay 收尾。total/cursor 为进度摘要(队列本体在 useReplayPlayer)
export interface ReplayState {
  phase: ReplayPhase;
  templateId: string;
  projectId: number | null;   // start 返回的 target_project_id
  sessionId: string | null;   // clone 返回的 session_id
  total: number;
  cursor: number;
  speed: 1 | 2 | 4;
  // 断点续播坐标:播放器从该 sequence 之后增量拉取(与 live 重连 afterSequence 同语义);缺省/0=全新回放从头播
  resumeAfterSequence?: number;
  // 播放头时间(最近一帧的 created_at):回放期运行中回合的计时终点,替代真实 Date.now()
  // (源事件是历史时间戳,用当前时间会显示成"已运行数月")
  playheadAt?: string | null;
  errorCode?: string;
}
export interface ReplayHandoff { sessionId: string; afterSequence: number; projectId: number }
// 未完成回放的进度标记(持久化):存在即「该项目回放播到一半」,快照本体在 koubouByProject;completeReplay 清除
export interface ReplayProgress { templateId: string; sessionId: string }

// 压缩包导入的单个待落画布素材(持久化,页面中断后续跑);字段对齐导入接口返回的 assets 项
export interface PendingImportAsset {
  sourceUrl: string;   // 后端原始 source_url(未 resolve),导入时再 resolveAssetUrl
  type: string;        // 后端素材类型(域外形态导入时传 null 由后端推断)
  name: string;
  relPath: string;     // 压缩包内相对路径,唯一溯源键(去重用)
}

// 压缩包导入待落画布队列:total=该次导入素材总数(续跑还原弹窗 done/total 进度),items=剩余待写入
export interface PendingImportQueue { total: number; items: PendingImportAsset[] }

// 升购模态的触发源:
//   insufficient=生成被积分不足拒绝(硬失败,INSUFFICIENT CREDITS hero)
//   lowBalance  =上一次生成完成后余额低于阈值(ALMOST OUT OF CREDITS hero)
//   manual      =主动点预览区积分块(2026-08-12 加回)。它的分流与前两种**不同**:
//                非 Max 一律开 all-plans,Max 开完整充值弹窗(见该日 spec 约束 2)
// 与 lib/subscription 的 UpsellSource 同源(那边是纯逻辑层的权威定义),store 只做再导出别名
export type CreditModalSource = UpsellSource;

export interface ServerState {
  booting: boolean;   // 启动首拉(项目/画布/版本)进行中,全局加载层依据;不持久化
  projects: ProjectData[];
  currentProjectId: number | null;
  assets: Asset[];
  versions: Version[];
  activeVersionId: string | null;
  // 版本消耗积分:version_id → 段级 total_credits(端点 /versions/credits,见 loadVersionCredits)。
  // **刻意不挂在 Version 行上**:loadVersions 每次都用后端新对象整体替换 versions,挂在行上的
  // 数字会被每一次「不出新版本的刷新」静默擦掉(而拉取判据恰好保证那时不重拉)。
  // 缺键 = 无数据(在途段 / 后端把 total 置 null 的「不编数」),时间线不渲染该处;
  // 0 是有效值(确实没花钱)。**不得**用 asset_credits 回落冒充全量口径。
  versionCreditsById: Record<string, number>;
  genTasks: GenTask[];
  authRequired: boolean;   // 检测到未登录(PGC 401),触发跳转 sign-in;瞬态不持久化。不主动归零:生产整页跳转后状态销毁,本地 localhost no-op 不跳转
  userInfo: CurrentUser | null;   // 预览区账户条:当前用户;瞬态不持久化(鉴权派生,廉价可重取)
  credit: BalanceData | null;     // 预览区账户条:账户余额;瞬态不持久化
  toast: ToastMessage | null;   // 全局 Toast 通道,语义入口见 index.ts 的 setError/setSuccess/setWarning
  koubouByProject: Record<string, PersistedSession>;   // 按项目持久化会话
  genTasksByProject: Record<string, GenTask[]>;   // 按项目持久化生成任务,刷新后重连轮询用
  // 在飞占位卡快照(按项目):**被 genTasks 引用的 pending_ 卡**。assets 整体是瞬态(刷新后以服务端为准),
  // 但这一小片不是 —— 它代表一次**已付费、仍在跑**的生成,而 pgc 在 generating 阶段不返回 item
  // (canvas.md 明写),丢了就再也接不回来:任务虽持久,restoreGenTasks 会因「卡不在」把它当残留剪掉。
  // 写入跟着 commitGenTasks 走(单一写入口),故清理是自动的:任务没了快照就没了
  inflightCardsByProject: Record<string, Asset[]>;
  importedByProject: Record<string, string[]>;   // 已导入画布的 agent 资产文件名(按项目),去重用
  agentTasksByProject: Record<string, string[]>;   // 已处理的 agent 生成 taskId(按项目),触发去重用(镜像 importedByProject 语义)
  importQueueByProject: Record<string, PendingImportQueue>;   // 压缩包导入待落画布队列(按项目,**持久化**);页面中断后下次进入项目续跑并还原弹窗进度
  // 升购模态打开态(真值即打开);来源驱动 hero 与埋点 trigger。瞬态不持久化
  creditModalOpen: CreditModalSource | false;
  // 触发生成的资产类型(升购弹窗进度卡用);agent 侧触发拿不到类型,为 null 时进度卡退化成纯余额行。瞬态
  creditModalKind: AssetKind | null;
  // 完整订阅弹窗(三档并排)打开态:free 用户被触发时直接开,或单卡弹窗点「See all plans」。瞬态
  allPlansOpen: boolean;
  // 请求展开 Composer 里的模型下拉(报错气泡的 Switch model 按钮,设计稿 2026-09-03)。递增计数而非
  // 布尔:菜单的开合归 Select 自己管,布尔在「用户手动关了再点一次」时值不变、effect 不重跑。瞬态
  modelMenuRequest: number;
  // 后端判定的「game 侧新用户」(pgc /api/auth/me/new-user-status)。**三态**:
  // null = 未知(没拉到 / 接口 503「暂时不知道」),此时模型门禁一律放行(见 lib/subscription/model-gate.ts)。
  // 瞬态不持久化:它是服务端事实,缓存过夜只会拿旧结论继续锁人。
  newUserStatus: boolean | null;
  // 订阅套餐配置缓存(瞬态,不持久化):档位/价格是后端配置,会话内复用即可,落盘反而会让
  // 调价后前端拿旧价。缓存放 store 而非弹窗组件,是为了让弹窗关掉再开时不必重等一个往返。
  plansCache: SubscriptionPlansData | null;
  // 在飞的订阅单(已建单、等权益开通)。**存 store 而非弹窗内部**:轮询若挂在弹窗上,
  // 用户关窗或点「See all plans」跳到另一个弹窗时会被 clearInterval 带走,支付照样成功
  // 但前端再也不知道(见 spec 2026-08-14-subscribe-order-watch)。瞬态不持久化——
  // plansCache 本就瞬态,刷新后重开弹窗自然重拉当前档位,刷新场景天然自愈。
  // messages 是**建单时就译好**的两条 Toast 文案:轮询搬进 store 后成败可能发生在弹窗关掉之后,
  // 而 store 层没有 t()(既有 store Toast 都是英文字面量)。按 lib/upload-policy 的既有做法注入而非
  // 在 store 里引 i18n 单例——代价是 10 分钟窗口内切语言仍出旧语种,可接受。
  subscribeOrder: { id: string; tier: SubscriptionTier; startedAt: number; messages: { active: string; closed: string } } | null;
  // 「订阅成功了但弹窗还开着」的待失效标记:不能在成功那一刻清 plansCache——
  // CreditModalGate 见 plans==null 直接 return null,弹窗会当场消失、吃掉成功态停留。
  // 故留到关窗那一刻由 setCreditModalOpen(false) 连同本标记一起清。瞬态
  subscribeSucceeded: boolean;
  // 完整充值弹窗(六档 + 自定义金额)打开态。两条可达路径:顶档升购弹窗的「View all pricing
  // options」,以及 Max 用户点预览区积分块。故它有自己的开关而不再复用 creditModalOpen。瞬态
  topupModalOpen: boolean;
  // 充值弹窗是从哪来的(埋点 trigger 用)。开关与来源分开存:开关决定渲染,来源只喂埋点,
  // 关窗时一并复位,避免下一次开窗沿用上一次的来源。瞬态
  topupTrigger: CreditModalSource;
  // 低余额弹窗已弹过、等余额回升到阈值才解锁(见 lib/subscription/low-balance.ts)。**持久化**:刷新不重弹。
  // 存「锁属于哪个用户」而非布尔:共用浏览器换账号时,布尔锁会被上一个账号带给下一个账号,
  // 把新账号该弹的第一次提示吞掉(终审自查发现)。null = 未上锁。
  lowBalanceLockedUserId: number | null;
  // 压缩包导入进行中状态(弹窗步骤/进度展示 + 取消按钮可见性依据);瞬态不持久化
  importArchiveStatus: {
    step: 'uploading' | 'creating' | 'importing_assets' | 'done';   // done=素材处理完的展示态,停留后由 action 清
    progress: number;   // 0..1,仅 uploading 阶段有意义
    done: number;       // 已落画布素材数,仅 importing_assets 阶段
    total: number;      // 素材总数
  } | null;
  // ---- 回放 onboarding(全部瞬态,不持久化) ----
  // 回放编排 + 播放态;为 null 表示非回放路由(useKoubouConnection 据此决定是否早退出)
  replay: ReplayState | null;
  // 续接握手:回放结束后传给 useKoubouConnection 的续接坐标(pin session + afterSequence,跳过种子)
  replayHandoff: ReplayHandoff | null;
  // 埋点 replay_continue_first_message 待报标记:completeReplay 置位,Composer 首条续作消息消费并清空
  replayContinuePending: { projectId: number; templateId: string } | null;
  // 未完成回放进度标记(按项目,**持久化**):刷新/切项目/返回主站后据此断点续播(spec 2026-07-14)
  replayProgressByProject: Record<string, ReplayProgress>;
}

export function createInitialServerState(): ServerState {
  return { booting: true, projects: [], currentProjectId: null, assets: [], versions: [], activeVersionId: null, versionCreditsById: {}, genTasks: [], authRequired: false, userInfo: null, credit: null, toast: null, koubouByProject: {}, genTasksByProject: {}, inflightCardsByProject: {}, importedByProject: {}, agentTasksByProject: {}, importQueueByProject: {}, creditModalOpen: false, creditModalKind: null, allPlansOpen: false, modelMenuRequest: 0, newUserStatus: null, plansCache: null, subscribeOrder: null, subscribeSucceeded: false, topupModalOpen: false, topupTrigger: 'insufficient', lowBalanceLockedUserId: null, importArchiveStatus: null, replay: null, replayHandoff: null, replayContinuePending: null, replayProgressByProject: {} };
}
