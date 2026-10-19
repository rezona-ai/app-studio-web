// 后台任务(子代理 / 后台命令)卡片状态机 —— 同步纯函数,不 import store / 无副作用。
// 契约来源:koubou docs/websocket-events.md「子 agent 归属与渲染」。要点:
//   · 开卡只认 TaskStartedMessage;收卡条件是「任一端点带来终态」,不是「收到 notification」
//   · TaskUpdatedMessage 的 patch 不一定带 status(只有 end_time/result/error 的补丁不是终态)
//   · 两端点都带终态时幂等:先到者定状态,后到者只补 summary / output_file
//   · TaskProgressMessage 只做活体指示,绝不参与状态
import type { SealReason, SubagentKind, SubagentStatus, TaskLifecycle } from '@/koubou/protocol';

export interface SubagentCard {
  taskId: string;
  toolUseId: string | null;   // 归属(启动它的那次工具调用);null = 不归组的无归属卡
  runId: string | null;       // 开卡所属 run:收尾与跨轮清理的判据
  kind: SubagentKind;
  description: string;
  subagentType?: string;
  status: SubagentStatus;
  sealReason?: SealReason;    // 仅本地合成态(ended_without_terminal)带
  summary?: string;           // 子代理的最终汇报(仅 TaskNotificationMessage 提供,可能没有)
  outputFile?: string;
  error?: string;
  lastToolName?: string;      // 仅 live(TaskProgressMessage 不落库),重连后会丢
}

// 卡未建时暂存的补丁(按 task_id)。两种来源共用一个容器,因为消费时机相同(等 start 到达):
//   · 有归属的终态先于自己的 start 到达 —— 契约里的「tombstone」,toolUseId 记下来供一致性校验
//   · 无归属事件(盖不上章)—— toolUseId 为 null,只能靠 task_id 反查,不能丢(可能带唯一终态)
// runId 用于 run 收尾时清掉未被任何 start 消费的条目。
export interface DeferredPatches {
  toolUseId: string | null;
  runId: string | null;
  events: Exclude<TaskLifecycle, { kind: 'started' }>[];
}

export interface SubagentState {
  cards: SubagentCard[];                            // 开卡顺序
  knownToolUseIds: string[];                        // 本 run 已知 tool_use id(父回合 block + 带 id 的可信 start)
  taskToolUse: Record<string, string>;              // task_id → tool_use_id,由 start 学到
  deferred: Record<string, DeferredPatches>;        // 卡未建时的暂存补丁
  sealedRunIds: string[];                           // 已收尾的 run(Task 4 起用)
}

export function createSubagentState(): SubagentState {
  return { cards: [], knownToolUseIds: [], taskToolUse: {}, deferred: {}, sealedRunIds: [] };
}

// 终态 = 归一后的 wire 三态 + 本地合成态。只有 pending / running / paused 是非终态
const TERMINAL_STATUSES: SubagentStatus[] = ['completed', 'failed', 'stopped', 'ended_without_terminal'];
export function isTerminalStatus(status: SubagentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// 父回合 AssistantMessage 里 tool_use block 的 id 灌入已知集合 —— 归属校验的来源 ①
export function learnToolUseIds(st: SubagentState, ids: string[]): SubagentState {
  const add = ids.filter((id) => id && !st.knownToolUseIds.includes(id));
  if (!add.length) return st;
  return { ...st, knownToolUseIds: [...st.knownToolUseIds, ...add] };
}

// 事件的归属成色。跨 run 残留只能靠 parent_tool_use_id 隔离 —— 绝不能退化成按 task_id 配对:
// 契约不假设 task_id 跨 run 唯一,按 task_id 认亲会把一张正在跑的卡直接建成已完成
type Attribution = 'known' | 'foreign' | 'unattributed';
function attributionOf(st: SubagentState, parentToolUseId: string | null): Attribution {
  if (!parentToolUseId) return 'unattributed';
  return st.knownToolUseIds.includes(parentToolUseId) ? 'known' : 'foreign';
}

export function reduceLifecycle(
  st: SubagentState,
  ev: TaskLifecycle,
  ctx: { runId: string | null },
): SubagentState {
  // 收尾过的 run 之后还可能来事件(孤儿收割直接往事件表追加 run.finished,不经旧 actor 的投递锁),
  // 此时只允许并入已存在的卡片:不建新卡、不建新的暂存条目
  const sealed = !!ctx.runId && st.sealedRunIds.includes(ctx.runId);
  if (ev.kind === 'started') return sealed ? st : openCard(st, ev, ctx.runId);
  return patchCard(st, ev, ctx.runId, false, sealed);
}

// 子 agent 自己的 AssistantMessage 里的工具调用 —— 唯一还有用的信息就是「它正在做什么」。
// 按归属(而非 task_id,子消息不带 task_id)找卡;终态卡不再更新活体行
export function noteSubagentTool(st: SubagentState, toolUseId: string, toolName: string): SubagentState {
  const idx = st.cards.findIndex((c) => c.toolUseId === toolUseId && !isTerminalStatus(c.status));
  if (idx < 0 || st.cards[idx].lastToolName === toolName) return st;
  const cards = [...st.cards];
  cards[idx] = { ...cards[idx], lastToolName: toolName };
  return { ...st, cards };
}

// run.finished 上自行收尾 —— 服务端不会替前端关卡(run.finished 只带 run_id 与 status)。
// **只在 run.finished 上收**:run.interrupted 之后仍会有已从 SDK 队列取出的真实终态继续下发,
// 在它上面关卡会让合成状态被随后的真实状态覆盖、或让已关闭的卡片被重新打开。
export function sealRun(
  st: SubagentState,
  runId: string | null,
  runStatus: 'succeeded' | 'error' | 'interrupted',
): SubagentState {
  // 措辞跟 run.finished.status 走,而不是一律叫「中断」:run 成功而任务终态没到是「结局未知」,
  // 不该显示成失败
  const sealReason: SealReason = runStatus === 'interrupted' ? 'interrupted' : runStatus === 'error' ? 'failed' : 'unknown';
  // 归属对不上时一律按「属于正在收尾的这个 run」处理:契约允许 run.finished.run_id 为 null
  // (极端失败帧),开卡时也可能拿不到 run 归属。两种情况下无从区分,而留一张永久转圈的卡
  // 比多收一张更糟 —— 卡片本就按 run.started 整体重置,不会跨轮堆积
  const belongs = (cardRunId: string | null) => cardRunId === runId || cardRunId == null || runId == null;
  const cards = st.cards.map((c) => (
    belongs(c.runId) && !isTerminalStatus(c.status)
      ? { ...c, status: 'ended_without_terminal' as const, sealReason }
      : c
  ));
  // 未被任何 start 消费的暂存条目到此作废(归属判据同上,含 runId 为 null 的条目)
  const deferred = Object.fromEntries(
    Object.entries(st.deferred).filter(([, entry]) => !belongs(entry.runId)),
  );
  const sealedRunIds = runId && !st.sealedRunIds.includes(runId) ? [...st.sealedRunIds, runId] : st.sealedRunIds;
  return { ...st, cards, deferred, sealedRunIds };
}

// 按 REST 的权威 active_run_id 收掉陈旧卡片(spec 2026-08-24)。
// 注意作用域:调用点挂在每次 session.ready 上,收的是**当下全部**非终态卡,不只是快照恢复的那批
// (live 建出来的也在内)。这是有意的 —— 调用方已用「本地 activeRunId 与 REST 答案一致」把
// 落后答案挡在外面,剩下的情形里 live 卡与快照卡没有区别对待的理由。
// **不能用 session.ready.active_run 代替**:它对新连接恒为 null(后端 run 事件按连接投递),
// 在它上面一刀切会把仍在跑的卡误收 —— 而合成态只能被真实终态覆盖、**不能改回 running**
// (见 cardPatch),误收即不可逆。故宁可多等 REST 那一个往返。
// 归属不明(runId 为 null)的卡**只在没有 run 在跑时**收。不能照搬 sealRun 的「一律收」:
// 那是在 run.finished 上收(run 已结束,非终态卡必是僵尸,宁可多收);这里可能是 run 正跑到一半,
// 一张归属不明的卡多半就属于这个活跃 run(rebuild 路径下事件不带 run_id 就会建出 runId=null 的卡,
// 它没有 live 路径的 activeRunId 兜底),提前收掉纯是损失且不可逆 —— 它会在 run.finished 上由
// sealRun 收口,那里的 belongs 判据本来就把 null 算作属于本 run。
export function sealStaleCards(st: SubagentState, activeRunId: string | null): SubagentState {
  const stale = (cardRunId: string | null) => activeRunId == null || (cardRunId != null && cardRunId !== activeRunId);
  if (!st.cards.some((c) => stale(c.runId) && !isTerminalStatus(c.status))) return st;
  const cards = st.cards.map((c) => (
    stale(c.runId) && !isTerminalStatus(c.status)
      ? { ...c, status: 'ended_without_terminal' as const, sealReason: 'unknown' as const }
      : c
  ));
  return { ...st, cards };
}

function openCard(st: SubagentState, ev: Extract<TaskLifecycle, { kind: 'started' }>, runId: string | null): SubagentState {
  // 盖上章的 start 可信(服务端把指向本 run 从未发出的工具调用的 start 整条抑制),它自己就是
  // 已知集合的来源 ②:重连只取最新一页时,父回合那条带 Agent tool_use block 的消息可能在页外,
  // 缺这条来源会丢掉合法 start,卡片建不起来、后续 notification / progress 连带被丢。
  // 反过来,**无归属的 start 绝不能进集合** —— 它绕过了服务端的陌生 start 判定,不可信
  const trustedId = ev.parentToolUseId;   // 盖上章即可信;为 null 即无归属
  const next = trustedId ? learnToolUseIds(st, [trustedId, ...(ev.toolUseId ? [ev.toolUseId] : [])]) : st;
  // 已开的卡不被后来的同 id start 改写(重放兜底:sequence 去重之外再保一道)
  if (next.cards.some((c) => c.taskId === ev.taskId)) return next;
  const card: SubagentCard = {
    taskId: ev.taskId,
    toolUseId: trustedId ? ev.toolUseId ?? trustedId : null,   // 无归属 → 不归组卡
    runId,
    kind: ev.taskType,
    description: ev.description,
    ...(ev.subagentType ? { subagentType: ev.subagentType } : {}),
    status: 'running',   // start 本身不带状态,开卡即在跑
  };
  const opened: SubagentState = {
    ...next,
    cards: [...next.cards, card],
    taskToolUse: trustedId && ev.toolUseId ? { ...next.taskToolUse, [ev.taskId]: ev.toolUseId } : next.taskToolUse,
  };
  return consumeDeferred(opened, ev.taskId, card);
}

// 消费该 task_id 的暂存补丁:
//   · 暂存条目带归属时,只有与这次 start 的 tool_use_id 一致才可消费(否则是别的 run 的同名任务)
//   · 无归属条目(toolUseId=null)对本 run 的任何 start 都可消费 —— 它本来就只有 task_id 可依
function consumeDeferred(st: SubagentState, taskId: string, card: SubagentCard): SubagentState {
  const entry = st.deferred[taskId];
  if (!entry) return st;
  if (entry.toolUseId && entry.toolUseId !== card.toolUseId) return st;
  const deferred = { ...st.deferred };
  delete deferred[taskId];
  return entry.events.reduce((acc, e) => patchCard(acc, e, card.runId, true), { ...st, deferred });
}

function patchCard(
  st: SubagentState,
  ev: Exclude<TaskLifecycle, { kind: 'started' }>,
  runId: string | null,
  replaying = false,
  sealed = false,
): SubagentState {
  // 重放暂存条目时归属已在入队时校验过,不再判(无归属条目本来就过不了 known)
  if (!replaying) {
    const attribution = attributionOf(st, ev.parentToolUseId);
    if (attribution === 'foreign') return st;   // 上一个 run 的残留,整条丢弃
  }
  const idx = st.cards.findIndex((c) => c.taskId === ev.taskId);
  // 卡不在:未收尾时暂存等 start;收尾后不再建暂存条目(它永远等不到 start 了)
  if (idx < 0) return replaying || sealed ? st : defer(st, ev, runId);
  const card = st.cards[idx];
  const patch = cardPatch(card, ev);
  if (!patch) return st;
  const merged = { ...card, ...patch };
  // 合成态被真实终态替换时,连带撤掉只属于合成态的措辞
  if (merged.status !== 'ended_without_terminal') delete merged.sealReason;
  const cards = [...st.cards];
  cards[idx] = merged;
  return { ...st, cards };
}

// 卡未建时暂存补丁,等 start 到达再合并。progress 不暂存 —— 它只实时下发、只做活体指示,
// 没有对应卡片时按契约直接丢弃
function defer(
  st: SubagentState,
  ev: Exclude<TaskLifecycle, { kind: 'started' }>,
  runId: string | null,
): SubagentState {
  if (ev.kind === 'progress') return st;
  const prev = st.deferred[ev.taskId];
  const entry: DeferredPatches = {
    // 已记下的非空归属不被后来的无归属事件降级;反之无归属条目可被带归属的事件升级
    toolUseId: prev?.toolUseId ?? ev.parentToolUseId,
    runId: prev?.runId ?? runId,
    events: [...(prev?.events ?? []), ev],
  };
  return { ...st, deferred: { ...st.deferred, [ev.taskId]: entry } };
}

// 计算这条事件对卡片的增量;无变化返回 null(避免无谓的对象抖动)
function cardPatch(card: SubagentCard, ev: Exclude<TaskLifecycle, { kind: 'started' }>): Partial<SubagentCard> | null {
  if (ev.kind === 'progress') {
    // 只做「正在做什么」的活体指示,不碰状态
    if (!ev.lastToolName || card.lastToolName === ev.lastToolName) return null;
    return { lastToolName: ev.lastToolName };
  }
  const patch: Partial<SubagentCard> = {};
  if (ev.kind === 'notification') {
    if (ev.summary && ev.summary !== card.summary) patch.summary = ev.summary;
    if (ev.outputFile && ev.outputFile !== card.outputFile) patch.outputFile = ev.outputFile;
  } else if (ev.error && ev.error !== card.error) {
    patch.error = ev.error;
  }
  // 状态推进:已是终态的卡不再被改(幂等,先到者定状态,后到者只补产出);
  // status 为 null 的补丁(只带 end_time/result/error)本身不是终态,不动状态 —— end_time 推不出终态。
  // 丢弃 result / endTime:UI 不展示它们,汇报一律取 notification 的 summary,存了即 dead data
  if (ev.status) {
    if (!isTerminalStatus(card.status)) patch.status = ev.status;
    // 唯一例外:合成态只是我们的推断,迟到的**真实** wire 终态优于它 —— 真实信息优先。
    // 这也顺带满足「迟到的非终态绝不把卡片改回 running」:非终态进不了这个分支
    else if (card.status === 'ended_without_terminal' && isTerminalStatus(ev.status)) patch.status = ev.status;
  }
  return Object.keys(patch).length ? patch : null;
}
