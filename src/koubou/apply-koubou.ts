import type {
  ServerEvent, ContentBlock, TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
  RawStreamEvent, ClaudeMessagePayload, CodexMessagePayload, QuestionDef, FileDiff, ToolUseResultRaw, PlanTask, PlanTaskStatus, TaskEffect,
} from './protocol';
import { isFullMessage, parseMediaItems, parseSubmittedTask, toolResultText, parseFileDiff, isTaskTool, parseTaskResult, parseTaskInput, isTaskLifecycleType, parseTaskLifecycle, type TaskInputMeta } from './protocol';
import type { SubagentState } from '@/lib/subagent-tasks';
import { createSubagentState, learnToolUseIds, noteSubagentTool, reduceLifecycle, sealRun } from '@/lib/subagent-tasks';
import type { KoubouState, Message, Part, PendingInteraction, TurnMeta, TurnStatus } from '@/store/types';
import { newId } from '@/lib/ids';
import { classifyKoubouError, koubouErrorDetail, type KoubouErrorPayload } from '@/i18n/errors';
import { MAX_AGENT_RETRIES, isRetryableAgentError, isAutoRetryText, type AgentFailure, type RetryMode } from '@/lib/agent-retry';
import { applyCodexMessage, codexItemMessage } from './apply-codex';
import { normalizeBackend } from '@/lib/agent-backend';

// SDK 打断哨兵:用户手动终止时后端塞进事件日志的 UserMessage(纯文本),
// 覆盖 "…for tool use"(工具执行中打断)与纯 "…by user"(正文生成中打断)两变体。
// 这条不成泡,改由 run.interrupted 生成一条本地化助手回复(见 interruptNotice)。
const INTERRUPT_MARKER = '[Request interrupted by user';

// 不成泡的两类 user.message:SDK 打断哨兵,以及自动重试自己发的 continue(带不可见哨兵前缀)。
// 后者刻意落进事件日志给 agent 看,但它不是用户说的话 —— 历史重建与回放两条路共用这一个判据,
// 各写一份必然漂移。判据是哨兵而非文本 'continue':用户自己打的 continue 照常成泡。
function isNonBubbleUserMessage(content: ContentBlock[] | string): boolean {
  const text = contentText(content);
  return text.trimStart().startsWith(INTERRUPT_MARKER) || isAutoRetryText(text);
}

function contentText(content: ContentBlock[] | string): string {
  return typeof content === 'string'
    ? content
    : content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text ?? '').join('');
}

// 终止回复气泡:notice part 的 code 即 i18n key,渲染期翻译(切语言会重翻,不存死文本)
const INTERRUPT_REPLY_CODE = 'chat.interruptedReply';
function interruptNotice(): Message {
  return { id: newId('msg'), role: 'assistant', status: 'ready', parts: [{ type: 'notice', code: INTERRUPT_REPLY_CODE }] };
}
// 该轮 footer 是否已锚着一条打断回复 —— 同一 run 只产一条回复的判据(见 interruptRun)
function anchoredToInterruptNotice(messages: Message[], lastMessageId: string | null): boolean {
  if (!lastMessageId) return false;
  const m = messages.find((x) => x.id === lastMessageId);
  return !!m && m.parts.some((p) => p.type === 'notice' && p.code === INTERRUPT_REPLY_CODE);
}

// 记录 sequence 游标(去重集合 + lastSequence);已见或无 sequence 时原样返回
function recordSequence(state: KoubouState, e: ServerEvent): KoubouState {
  if (typeof e.sequence !== 'number' || state.seenSequences.includes(e.sequence)) return state;
  return { ...state, seenSequences: [...state.seenSequences, e.sequence].slice(-500), lastSequence: Math.max(state.lastSequence, e.sequence) };
}

export function applyKoubou(state: KoubouState, e: ServerEvent): KoubouState {
  // session.ready 源头分流:它是状态快照——active_run 即「当前会话是否运行中」的后端权威,
  // pending_interactions 同理——而非可重放增量,不进下方 sequence 去重(重连/跨 Pod 下发的
  // ready 可能复用已见 sequence,被吞会丢掉 runStatus/pending 的校正,页面永卡 running,
  // 见 bug 13383614)。onReady 幂等,恒应用;sequence 仅记游标
  if (e.type === 'session.ready') return onReady(recordSequence(state, e), e);
  // 可重放事件按 sequence 去重(重连重放会重复下发)
  if (typeof e.sequence === 'number') {
    if (state.seenSequences.includes(e.sequence)) return state;
    state = recordSequence(state, e);
  }
  switch (e.type) {
    case 'run.started': {
      const runId = (e.payload.run_id as string) ?? e.run_id ?? null;
      // startedAt 优先取乐观发送时刻:run.started 到达时计时续上等待时长而非归零重开;
      // model 同理优先取发送时刻快照——会话回显 model(SystemMessage)在 run 开始后才到,
      // 此刻 state.model 常为 null/旧值,不用快照会把 pending 期已展示的模型名冲掉(后续权威回填仍会覆盖)
      const turn: TurnMeta = { runId, model: state.pendingModel ?? state.model, startedAt: state.pendingSendAt ?? e.created_at ?? null, finishedAt: null, status: 'running', lastMessageId: null };
      // 任务清单按轮独立:开新轮即清空上一轮任务(agent 不会主动删旧任务,不清会跨轮累积)。
      // 已知边界:本轮若调 TaskList,snapshot 会带回后端会话级的旧任务,接受(agent 实际每轮只 TaskCreate)
      // 真实回合已开:清乐观发送计时(交棒给 turn.startedAt)
      // 子代理卡片同理按轮独立:新一轮开始即清空上一轮的卡与已知归属集合
      // 自愈已发出且 run 真起来了 = 后端受理了这次重试,红色进度气泡立刻退场(不必等回合终态,
      // 那之间隔着整轮生成)。**只从 'running' 转**:退避等待期收到的 run.started 不是本次自愈的
      // 回声。状态留着不清 —— 见 AgentRetry.phase 注释
      const agentRetry = state.agentRetry?.phase === 'running'
        ? { ...state.agentRetry, phase: 'responded' as const }
        : state.agentRetry;
      return { ...state, runStatus: 'running', activeRunId: runId, turns: [...state.turns, turn], tasks: [], subagents: createSubagentState(), pendingSendAt: null, pendingModel: null, agentRetry, agentError: null };
    }
    // 打断是用户自己的动作:清重试态但不报错。不清会让 agentRetry 永久停在 phase:'running'
    // (45s 兜底只装一次、且到点时 run 还在跑就直接 return),进度气泡无限转圈,
    // 且所有错误气泡的手动重试按钮(判据含 agentRetry == null)一并消失
    case 'run.interrupted': return { ...interruptRun(state, e.created_at ?? null, runIdOf(e)), agentRetry: null, agentError: null };
    case 'run.finished': {
      // 子代理卡片必须由前端在这里收尾:run.finished 只带 run_id / status,服务端不会替我们关卡,
      // 不收就会留下永久转圈的卡(2026-08-07 线上事故)。**只在 finished 上收**——
      // run.interrupted 之后仍会有真实终态继续下发,在它上面关卡会让真实状态与合成状态互相打架
      const runId = runIdOf(e);
      const sealed = (s: KoubouState, reason: 'succeeded' | 'error' | 'interrupted'): KoubouState =>
        ({ ...s, subagents: sealRun(s.subagents, runId, reason) });
      // 后端也会以 run.finished { status: 'interrupted' } 表示打断(不总发独立的 run.interrupted 帧),
      // 与 run.interrupted 同处理,否则会误判为 error(既无打断回复,回合状态也错)
      if (e.payload.status === 'interrupted') return { ...sealed(interruptRun(state, e.created_at ?? null, runId), 'interrupted'), agentRetry: null, agentError: null };
      const succeeded = e.payload.status === 'succeeded';
      const next = sealed(finishRun(state, e.created_at ?? null, succeeded ? 'succeeded' : 'error', runId), succeeded ? 'succeeded' : 'error');
      // 仅失败帧才会内嵌 error 对象(孤儿 run 等);succeeded 帧即便异常带 error 也不冒泡
      // 内嵌 error 与 error 事件同形状(四种,见 KoubouErrorPayload):孤儿 run 用 type,
      // 上游/模型侧失败用 code + retryable
      const err = e.payload.error as KoubouErrorPayload | undefined;
      if (!succeeded && err) {
        const { code } = classifyKoubouError(err);
        const resolved = err.type === 'OrphanedRun' ? 'RUN_ABANDONED' : (code ?? 'AGENT_RUN_ERROR');
        // 不比对 classifyKoubouError 的默认字面量来反推「上游没给 message」—— 那是它的内部
        // 实现细节,改那边不会有任何编译或测试报错,这里只会静默失效。直接读原始字段
        const raw = typeof err.message === 'string' ? err.message.trim() : '';
        return failAgentTurn(next, {
          code: resolved,
          fallback: raw || 'run failed',
          detail: koubouErrorDetail(err),
          runId,
          ...(typeof err.retryable === 'boolean' ? { retryable: err.retryable } : {}),
        });
      }
      if (succeeded) return { ...next, agentRetry: null, agentError: null };
      // failed 但不带 error —— 这**才是生产常态**:后端 live 帧与孤儿 tombstone 都只有
      // {run_id, status}。本轮若还没由 error 事件报过错(如属主 Pod 死掉的孤儿收割),
      // 这里必须补一条,否则用户看到的是回合悄无声息地停住:无气泡、无重试、无手动入口
      // 本轮已由 error 事件收口过:那一步要么推了气泡(agentRetry 已是 null),要么安排了自愈。
      // **不能在这里清 agentRetry** —— 生产常态就是「error 事件 + 紧跟一条不带 error 的终态帧」,
      // 清掉等于自愈第一次就被自己掐死,且此刻屏幕上无进度、无气泡、无手动入口(canRetry 要有气泡)
      const reported = next.turns.find((t) => t.runId === runId)?.errorReported;
      if (reported) return next;
      return failAgentTurn(next, { code: 'AGENT_RUN_ERROR', fallback: 'run failed', runId });
    }
    // 传 envelope 的 run_id:后台任务卡片的归属必须取事件自带的 run,不能取 state.activeRunId
    // —— finishRun / interruptRun 会把它清成 null,而这两个帧之后仍有生命周期事件到达
    // (契约:interrupted 后已出队的消息继续下发;孤儿收割还会在 finished 之后追加同 run 事件)
    case 'claude.message': return onClaudeMessage(state, e.payload as unknown as ClaudeMessagePayload, runIdOf(e));
    // codex 会话的 agent 消息。**不按 state.backend 门控**:两类事件本身自带身份
    // (一个会话只会下发其中一种),门控只会在 ready 未到时误吞帧;跨 backend 串味由
    // 「快照按项目+backend 分槽 + 会话恢复只认同 backend」在源头挡住(见设计稿 §3)
    case 'codex.message': return applyCodexMessage(state, e.payload as unknown as CodexMessagePayload);
    case 'tool.approval.requested': return upsertPending(state, {
      kind: 'approval', interactionId: e.payload.interaction_id as string,
      toolName: e.payload.tool_name as string, input: e.payload.input,
      ...(typeof e.payload.method === 'string' ? { method: e.payload.method } : {}),
    });
    case 'ask_user_question.requested': return upsertPending(state, {
      kind: 'question', interactionId: e.payload.interaction_id as string,
      questions: ((e.payload.input as { questions?: QuestionDef[] })?.questions) ?? [],
    });
    // 审批终态帧(本 tab 已乐观清过 / 别 tab 处理 / 超时取消 / 回放重放):按 interaction_id 幂等清 pending。
    // 与 ask_user_question.answered 同语义,codex 与 cc 通用
    case 'tool.approval.resolved':
    case 'pending_interactions.cancelled': {
      const ids = Array.isArray(e.payload.interaction_ids)
        ? (e.payload.interaction_ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : typeof e.payload.interaction_id === 'string' ? [e.payload.interaction_id] : [];
      const hit = ids.filter((id) => state.pendingInteractions[id]);
      // 无 id(如整会话取消)时清空全部未决:后端已不认为它们 pending,残留会永挂
      if (!ids.length && e.type === 'pending_interactions.cancelled') {
        return Object.keys(state.pendingInteractions).length ? { ...state, pendingInteractions: {} } : state;
      }
      if (!hit.length) return state;
      const pending = { ...state.pendingInteractions };
      for (const id of hit) delete pending[id];
      return { ...state, pendingInteractions: pending };
    }
    // 已答帧(答题落库 / 别 tab 答过 / 回放重放):清对应 pending,防弹窗永挂。
    // 不在此合成用户气泡——live 答题 tab 已由 QuestionCard 乐观插入,这里再插会重复;
    // 回放的气泡合成在 useReplayPlayer(它拿得到清除前的 pending questions)
    case 'ask_user_question.answered': {
      const id = e.payload.interaction_id as string | undefined;
      if (!id || !state.pendingInteractions[id]) return state;
      const pending = { ...state.pendingInteractions };
      delete pending[id];
      return { ...state, pendingInteractions: pending };
    }
    // 控制面确认帧(瞬时,sequence=null):服务端才是模型/权限模式的权威。
    // 切模型采用「乐观提交 + 此处校正」:codex 活跃 run 期选择器已禁用,冲突窗口极窄,
    // 而挂起提交会让选择器出现「点了没反应」的观感倒退(偏离文档的取舍,见设计稿 §4)
    case 'model.changed': {
      const model = e.payload.model;
      return typeof model === 'string' && model ? { ...state, model } : state;
    }
    case 'permission_mode.changed': {
      const mode = e.payload.mode;
      return typeof mode === 'string' && mode ? { ...state, permissionMode: mode } : state;
    }
    // credit.insufficient 不再产聊天气泡:由 store.ingestKoubou 分流到积分不足模态(见设计稿 2026-07-05)
    case 'credit.insufficient': return state;
    case 'build.failed': return setAgentError(state, 'BUILD_FAILED', 'Build failed');
    case 'error': return onError(state, e);
    default: return state; // 未知事件容错
  }
}

// 终态帧的 run_id:payload 优先,信封兜底
function runIdOf(e: ServerEvent): string | null {
  return (e.payload.run_id as string | undefined) ?? e.run_id ?? null;
}

// 打断收尾:闭轮为 interrupted 并追加一条本地化助手回复,把该轮 footer 锚到它(让「Stopped after」贴其下)。
// run.interrupted 与 run.finished(status=interrupted) 共用
function interruptRun(state: KoubouState, finishedAt: string | null, runId: string | null = null): KoubouState {
  const next = finishRun(state, finishedAt, 'interrupted', runId);
  const turns = next.turns.slice();
  // 锚到刚被闭为 interrupted 的轮(runId 回退路径下未必是最后一轮),从尾部找第一条 interrupted
  let idx = -1;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].status === 'interrupted') { idx = i; break; }
  }
  // 同一 run 的第二个打断终态帧:后端对一次打断可能既发 run.interrupted 又发 run.finished{interrupted},
  // 两帧 sequence 不同(瞬时帧还可能无 sequence),去重挡不住。闭轮那侧本就幂等(patchTurnForFinish 不重写
  // 已落 finishedAt 的轮),追加回复这侧也须幂等,否则聊天里出现两条一模一样的打断回复
  if (idx >= 0 && anchoredToInterruptNotice(next.messages, turns[idx].lastMessageId)) return next;
  const notice = interruptNotice();
  if (idx >= 0) turns[idx] = { ...turns[idx], lastMessageId: notice.id };
  return { ...next, messages: [...next.messages, notice], turns };
}

// ---- session.ready ----
function onReady(state: KoubouState, e: ServerEvent): KoubouState {
  const p = e.payload as {
    session_id?: string;
    visible_state?: { messages?: ServerEvent[] };
    active_run?: { run_id: string; status: string } | null;
    pending_interactions?: PendingRaw[];
    backend?: string;
    permission_mode?: string;
  };
  const activeRun = p.active_run ?? null;
  // ready 是 run 态权威:active_run 为空而本地仍有 running 轮(刷新恢复的快照——turns 持久化而
  // runStatus 不落盘;或终态帧丢失)时,就地闭轮并落定草稿,否则计时器永转而骨架屏因
  // runStatus=idle 不显示(两者失配)。真实终态未知,按 succeeded 收口(finishedAt 为空,
  // footer 只显模型不显时长,不会谎报耗时);随后若重放出真 run.finished,闭轮已幂等无害。
  let base = state;
  if (!activeRun && state.turns.some((t) => t.status === 'running')) base = finishRun(state, null, 'succeeded');
  let next: KoubouState = {
    ...base,
    sessionId: p.session_id ?? state.sessionId,
    runStatus: activeRun ? 'running' : 'idle',
    activeRunId: activeRun?.run_id ?? null,
    // backend 是渲染器分流依据,ready 为唯一权威(本地开关只决定「新建会话用哪个」);
    // 词表外/缺失时保留现值,不把未知值写进状态
    backend: normalizeBackend(p.backend) ?? state.backend,
    permissionMode: p.permission_mode ?? state.permissionMode,
  };
  // 无本地缓存 → 用 visible_state 重建历史;有本地缓存 → 保留本地消息。
  // 同步写历史游标:REST 种子化失败的回退路径也能继续向上翻页
  if (state.messages.length === 0 && p.visible_state?.messages?.length) {
    next = { ...next, ...historyFields(p.visible_state.messages, undefined, state.tasks) };
  }
  // pending 以后端 pending_interactions 为唯一权威快照:整体替换(先清后设),
  // 后端已不认为 pending 的(答过 / 超时 / 别 tab 处理)不残留
  next = { ...next, pendingInteractions: {} };
  for (const it of p.pending_interactions ?? []) {
    next = upsertPending(next, toPending(it));
  }
  return next;
}

interface PendingRaw { interaction_id: string; interaction_type: string; tool_name: string; request: { input?: unknown; questions?: QuestionDef[]; method?: string } }

function toPending(it: PendingRaw): PendingInteraction {
  if (it.interaction_type === 'question') {
    return { kind: 'question', interactionId: it.interaction_id, questions: (it.request as { questions?: QuestionDef[]; input?: { questions?: QuestionDef[] } }).questions ?? (it.request.input as { questions?: QuestionDef[] })?.questions ?? [] };
  }
  const method = (it.request as { method?: unknown }).method;
  return {
    kind: 'approval', interactionId: it.interaction_id, toolName: it.tool_name, input: it.request.input,
    ...(typeof method === 'string' ? { method } : {}),
  };
}

// visible_state.messages 实为可重放事件日志(与 live 同构),非已消化的 MessageView。
// 用户文本只在 user.message 信封里(client→server 原文,后端回填进历史);claude.message/UserMessage
// 仅承载 tool_result。冷启动无乐观渲染,故用户气泡必须从 user.message 重建(不能照搬 onClaudeMessage 的"仅折叠"路径)。
// assistant 成泡;claude.message/UserMessage 全为 tool_result 则折叠进 tool part。
// 非展示类事件(StreamEvent/SystemMessage/ResultMessage)跳过。id 缺失时兜底 newId,避免重复 key。
// 由事件日志派生历史相关字段(messages 整体替换 + 翻页游标)。
// hasMore 缺省启发:最旧 sequence > 1 说明前面还有事件(visible_state 回退路径用;REST 路径以 has_more 为准)
function historyFields(
  events: ServerEvent[],
  hasMore?: boolean,
  baseTasks: PlanTask[] = [],
  baseTurns: TurnMeta[] = [],
  baseSubagents: SubagentState = createSubagentState(),
) {
  const { messages, turns, tasks, subagents, model } = rebuild(events, baseTasks, baseTurns, baseSubagents);
  const oldest = typeof events[0]?.sequence === 'number' ? events[0].sequence : null;
  return {
    messages,
    turns,
    // 会话级 model:**只在本页扫出 SystemMessage 时才带这个键** —— 展开进状态时天然是「有则覆盖、
    // 无则保留现值」,窗口里恰好没有 init 帧的页不会把已知的模型名清成 null
    ...(model ? { model } : {}),
    // 任务效果本身幂等(create 合并同 id/update 按 id 改状态/snapshot 整单覆盖),
    // 以 baseTasks(通常是快照恢复的清单)为底重放本页事件,局部窗口也不会丢清单
    tasks,
    // 子代理卡片同理以现值为底重放:三个端点会落库,重连时仍在跑的任务能重建出卡片
    subagents,
    historyEvents: events,
    historyMsgCount: messages.length,
    historyTurnCount: turns.length,
    historyOldestSeq: oldest,
    historyHasMore: hasMore ?? (oldest != null && oldest > 1),
  };
}

// REST 最新一页种子化:整体重建 messages 并初始化游标;lastSequence 对齐会话最新值,
// 使后续 WS 持久化检查点(lastSequence ↔ messages)保持一致
export interface EventsPageLike { events: ServerEvent[]; has_more: boolean; latest_sequence: number }

export function seedHistory(state: KoubouState, page: EventsPageLike): KoubouState {
  return {
    ...state,
    // 以快照中的 tasks/turns/subagents 为底重放最新页:局部窗口缺少早期 TaskCreate 或 run.started 时,
    // 仍能保住窗口内可见消息对应的清单与轮次脚注
    ...historyFields(page.events, page.has_more, state.tasks, state.turns, state.subagents),
    lastSequence: Math.max(state.lastSequence, page.latest_sequence ?? 0),
  };
}

// 向上翻页前插:对「旧页 ++ 已加载」的完整事件日志整体重建历史前缀,再拼接 live 尾部。
// 整体重建保证跨页边界的 tool_use(旧页)/tool_result(新页)能正确折叠。
// 取舍:live 期间折叠进历史前缀的变更会被重建覆盖——前缀距 live 至少一页,实际不可达,接受
export function prependHistory(state: KoubouState, page: EventsPageLike): KoubouState {
  if (!page.events.length) return { ...state, historyHasMore: page.has_more };
  const fields = historyFields([...page.events, ...state.historyEvents], page.has_more);
  return {
    ...state,
    ...fields,
    // 前插的都是更早事件:重放旧页会复活其中的 create(哪怕对应任务后来在新页里被 update/删除),
    // 清单已由更新的事件推进过,恒以现值(最新)为准,不接受旧页重建结果覆盖
    tasks: state.tasks,
    // 会话级 model 同理:旧页里的 SystemMessage 带的是那时用的模型,翻页不该把当前模型名改回去
    model: state.model,
    // 子代理卡片同理:旧页里的 start 会把已收掉的卡重新建成 running
    subagents: state.subagents,
    messages: [...fields.messages, ...state.messages.slice(state.historyMsgCount)],
    turns: [...fields.turns, ...state.turns.slice(state.historyTurnCount)],
  };
}

// SystemMessage 里的模型名。**不在 payload.model 上** —— 真实帧(2026-08-24 实测 dev 后端)是
// `{ subtype:'init', data:{ ...SDK init 原样透传, model } }`,payload 顶层只有 subtype / data。
// SystemMessage 里的模型名。**只认 init 帧的 data.model** —— 真机实测(2026-08-24 dev 后端)的帧是
// `{ subtype:'init', data:{ ...SDK init 原样透传, model } }`,payload 顶层没有 model。
// 早先这里还并读一条 `payload.model`,已删:它的唯一存活理由是几条按推测形状伪造的测试数据
// (见 spec §坑),真实帧里从不出现 —— 留着就是给下一个人一条看似有契约背书的假路径。
// 其余 subtype(如 background_tasks_changed)的 data 与模型无关,不取。
function systemMessageModel(p: ClaudeMessagePayload): string | null {
  if (p.payload.subtype !== 'init') return null;
  const data = p.payload.data as { model?: unknown } | undefined;
  return typeof data?.model === 'string' && data.model ? data.model : null;
}

// 单遍重建:从可重放事件日志(含 run.* / claude.message / user.message)同时产出 messages 与 turns。
// 切轮规则与 live(applyKoubou)一致:run.started 开轮、AssistantMessage 回填锚点/模型、run.finished/interrupted 闭轮。
export function rebuild(
  events: ServerEvent[],
  initialTasks: PlanTask[] = [],
  initialTurns: TurnMeta[] = [],
  initialSubagents: SubagentState = createSubagentState(),
): { messages: Message[]; turns: TurnMeta[]; tasks: PlanTask[]; subagents: SubagentState; model: string | null } {
  let messages: Message[] = [];
  // 最新事件页可能从长回合中段开始,用可重放快照补齐窗口外的 run.started。
  // 深拷贝一层保证重建不会修改持久化基线。
  const turns: TurnMeta[] = initialTurns.map((turn) => ({ ...turn }));
  const baselineTurnCount = turns.length;
  const replayedStartIndexes = new Set<number>();
  let model: string | null = null;
  let tasks: PlanTask[] = initialTasks;
  let subagents: SubagentState = initialSubagents;
  const patchTurn = (
    patch: Partial<TurnMeta>,
    runId: string | null = null,
    messageId: string | null = null,
  ) => {
    if (runId) {
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].runId === runId) { turns[i] = { ...turns[i], ...patch }; return; }
      }
    }
    if (messageId) {
      for (let i = turns.length - 1; i >= 0; i--) {
        if (turns[i].lastMessageId === messageId) { turns[i] = { ...turns[i], ...patch }; return; }
      }
    }
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].status === 'running') { turns[i] = { ...turns[i], ...patch }; return; }
    }
  };
  // patchTurn 的定位口径(runId 优先、回退最后一条 running),供打断分支先看目标轮再决定是否产回复
  const findTurn = (runId: string | null): number => {
    if (runId) {
      for (let i = turns.length - 1; i >= 0; i--) if (turns[i].runId === runId) return i;
    }
    for (let i = turns.length - 1; i >= 0; i--) if (turns[i].status === 'running') return i;
    return -1;
  };
  for (const ev of events) {
    if (ev.type === 'run.started') {
      const runId = (ev.payload.run_id as string) ?? ev.run_id ?? null;
      let existing = -1;
      if (runId) {
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].runId === runId) { existing = i; break; }
        }
      }
      const turn: TurnMeta = {
        runId,
        model: model ?? (existing >= 0 ? turns[existing].model : null),
        startedAt: ev.created_at ?? (existing >= 0 ? turns[existing].startedAt : null),
        finishedAt: null,
        status: 'running',
        lastMessageId: null,
      };
      if (existing >= 0) turns[existing] = turn;
      else {
        existing = turns.length;
        turns.push(turn);
      }
      replayedStartIndexes.add(existing);
      tasks = []; // 与 live 一致:任务清单按轮独立;窗口内无 run.started 时保留 initialTasks(快照恢复)
      subagents = createSubagentState();   // 卡片同理按轮独立
      continue;
    }
    if (ev.type === 'run.finished' && ev.payload.status !== 'interrupted') {
      patchTurn(
        { finishedAt: ev.created_at ?? null, status: ev.payload.status === 'succeeded' ? 'succeeded' : 'error' },
        runIdOf(ev),
      );
      // 与 live 同口径:run 结束时仍无终态的卡由前端收尾,否则重建出的历史里留一堆转圈卡
      subagents = sealRun(subagents, runIdOf(ev), ev.payload.status === 'succeeded' ? 'succeeded' : 'error');
      continue;
    }
    // run.finished(status=interrupted) 与 run.interrupted 同义(与 live 口径一致)
    if (ev.type === 'run.finished' || ev.type === 'run.interrupted') {
      const runId = runIdOf(ev);
      // 只有 run.finished 收尾卡片:独立的 run.interrupted 帧只是「正在停止」,之后仍会来真实终态
      if (ev.type === 'run.finished') subagents = sealRun(subagents, runId, 'interrupted');
      const idx = findTurn(runId);
      // 同一 run 的第二个打断终态帧只补状态/时长,不再产第二条回复(与 live 的 interruptRun 同口径);
      // 日志里两帧都在时,重建出的历史须与实时渲染一致
      if (idx >= 0 && anchoredToInterruptNotice(messages, turns[idx].lastMessageId)) {
        patchTurn({ finishedAt: turns[idx].finishedAt ?? ev.created_at ?? null, status: 'interrupted' }, runId);
        continue;
      }
      // 生成本地化助手回复,并一次性闭轮 + 把该轮 footer 锚到回复(取代被抑制的哨兵气泡)
      const notice = interruptNotice();
      messages.push(notice);
      patchTurn({ finishedAt: ev.created_at ?? null, status: 'interrupted', lastMessageId: notice.id }, runId);
      continue;
    }
    if (ev.type === 'user.message') {
      const content = (ev.payload as { message?: { content?: ContentBlock[] | string } }).message?.content ?? [];
      if (isNonBubbleUserMessage(content)) continue; // 打断哨兵(由 run.interrupted 生成回复)/ 自动重试的 continue 不成泡
      const parts = blocksToParts(content);
      if (parts.length) messages.push({ id: ev.event_id ?? newId('msg'), role: 'user', parts, status: 'ready' });
      continue;
    }
    // codex 会话的可回放内容只有 item/completed:与 live 共用同一映射(codexItemMessage),
    // 保证冷启动 / 翻页 / gap 补偿渲染出的卡片与实时一致。同 id 原位替换(跨页重复出现时幂等)
    if (ev.type === 'codex.message') {
      const cp = ev.payload as unknown as CodexMessagePayload;
      if (cp?.method !== 'item/completed') continue;
      const msg = codexItemMessage((cp.payload as { item?: unknown } | undefined)?.item, false);
      if (!msg) continue;
      const at = messages.findIndex((m) => m.id === msg.id);
      if (at === -1) messages.push(msg);
      else messages[at] = msg;
      patchTurn({ lastMessageId: msg.id }, runIdOf(ev), msg.id);
      continue;
    }
    if (ev.type !== 'claude.message') continue;
    const cm = ev.payload as unknown as ClaudeMessagePayload;
    // SystemMessage(init) 是该轮 model 的权威来源,且**恒在 run.started 之后**到达 —— 只更新局部
    // 变量不回填当前轮的话,重建出的这一轮就只能靠快照里的同 runId 轮兜底;快照还停在上一轮时
    // (持久化 1s 节流)必然扑空,脚注退化成只有时长。口径同 reconcileAssistant:存在即覆盖
    if (cm.sdk_type === 'SystemMessage') {
      const sysModel = systemMessageModel(cm);
      if (sysModel) { model = sysModel; patchTurn({ model }, runIdOf(ev)); }
      continue;
    }
    // 后台任务生命周期端点(三个落库的):重建卡片,不进消息流
    if (isTaskLifecycleType(cm.sdk_type)) {
      const lifecycle = parseTaskLifecycle(cm.sdk_type, cm.payload);
      if (lifecycle) subagents = reduceLifecycle(subagents, lifecycle, { runId: runIdOf(ev) });
      continue;
    }
    if (cm.sdk_type !== 'AssistantMessage' && cm.sdk_type !== 'UserMessage') continue;
    // 子 agent 的流量与 live 同口径剥出主流,只留活体行(重建后它会被下一条 progress 或收尾覆盖)
    const subagentParent = typeof cm.payload.parent_tool_use_id === 'string' && cm.payload.parent_tool_use_id
      ? cm.payload.parent_tool_use_id : null;
    if (subagentParent) {
      if (cm.sdk_type === 'AssistantMessage' && Array.isArray(cm.payload.content)) {
        const names = (cm.payload.content as ContentBlock[])
          .filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => b.name);
        const last = names[names.length - 1];
        if (last) subagents = noteSubagentTool(subagents, subagentParent, last);
      }
      continue;
    }
    const pl = cm.payload as {
      content?: ContentBlock[] | string; uuid?: string; message_id?: string; id?: string;
      model?: string; tool_use_result?: ToolUseResultRaw;
    };
    const id = pl.uuid ?? pl.message_id ?? pl.id ?? newId('msg');
    const content = pl.content ?? [];
    if (cm.sdk_type === 'AssistantMessage') {
      // 父回合的 tool_use id 进归属集合(来源 ①),与 live 一致
      subagents = learnToolUseIds(subagents, toolUseIdsOf(content));
      messages.push({ id, role: 'assistant', parts: blocksToParts(content), status: 'ready' });
      const patch: Partial<TurnMeta> = { lastMessageId: id };
      if (pl.model) patch.model = pl.model;
      patchTurn(patch, runIdOf(ev), id);
      continue;
    }
    // UserMessage 只折叠 tool_result,从不成泡(与 live 的 onClaudeMessage 对齐,Meegle 13601473):
    // 用户文本只在 user.message 信封里,claude.message/UserMessage 的非 tool_result 内容
    // 全是后端注入的元内容(skill 注入 / 命令 stdout / system-reminder / 打断哨兵),不该进对话流
    const blocks = Array.isArray(content) ? content : [];
    const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    if (results.length) {
      // 任务清单与 diff 同一 tool_use_result 通道;先记清单再折叠(findToolPart 只依赖 tool_use part,先后均可)
      tasks = applyTaskResults(tasks, messages, results, pl.tool_use_result);
      messages = foldResults(messages, results, parseFileDiff(pl.tool_use_result) ?? undefined);
    }
  }
  const visibleMessageIds = new Set(messages.map((message) => message.id));
  const visibleTurns = turns.filter((turn, index) =>
    index >= baselineTurnCount
    || replayedStartIndexes.has(index)
    || turn.status === 'running'
    || (turn.lastMessageId != null && visibleMessageIds.has(turn.lastMessageId)));
  return { messages, turns: visibleTurns, tasks, subagents, model };
}

// 兼容封装:历史相关旧调用方/测试只取 messages
export function rebuildHistory(events: ServerEvent[]): Message[] {
  return rebuild(events).messages;
}

// 回放专用:live 管线没有 user.message 分支(live 用户气泡由 Composer 乐观渲染,后端不向发送方回播),
// 回放逐帧灌 applyKoubou 会把 user.message 整条吞进 default——用户消息从回放里消失。
// 按 rebuild 的同一规则单独成泡;不并进 applyKoubou 的 switch,避免后端将来回播 user.message 时
// live 路径与乐观气泡重复。sequence 登记/去重与 applyKoubou 口径一致(检查点持久化依赖 lastSequence)。
export function applyUserMessage(state: KoubouState, e: ServerEvent): KoubouState {
  if (typeof e.sequence === 'number') {
    if (state.seenSequences.includes(e.sequence)) return state;
    state = { ...state, seenSequences: [...state.seenSequences, e.sequence].slice(-500), lastSequence: Math.max(state.lastSequence, e.sequence) };
  }
  const content = (e.payload as { message?: { content?: ContentBlock[] | string } }).message?.content ?? [];
  if (isNonBubbleUserMessage(content)) return state; // 同 rebuild 口径:打断哨兵 / 自动重试的 continue 不成泡
  const parts = blocksToParts(content);
  if (!parts.length) return state;
  return { ...state, messages: [...state.messages, { id: e.event_id ?? newId('msg'), role: 'user', parts, status: 'ready' }] };
}

function blocksToParts(content: ContentBlock[] | string): Part[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const parts: Part[] = [];
  for (const b of content) {
    if (b.type === 'text') parts.push({ type: 'text', text: (b as TextBlock).text ?? '' });
    else if (b.type === 'thinking') parts.push({ type: 'thinking', text: (b as ThinkingBlock).thinking ?? '' });
    else if (b.type === 'tool_use') { const t = b as ToolUseBlock; parts.push({ type: 'tool', id: t.id, name: t.name, input: t.input, status: 'ready' }); }
    else if (b.type === 'image') {
      // koubou 仅支持 image 块;url source 直接用,base64 source 拼成 data url 兜底
      const s = (b as { source?: { type?: string; url?: string; media_type?: string; data?: string } }).source;
      const url = s?.type === 'url' ? s.url
        : s?.type === 'base64' && s.data ? `data:${s.media_type ?? 'image/png'};base64,${s.data}`
        : undefined;
      if (url) parts.push({ type: 'media', kind: 'image', url });
    }
    // tool_result 由 foldResults 处理
  }
  return parts;
}

// 把 tool_result 回填到对应 tool_use part(跨消息按 tool_use_id 匹配,纯函数返回新数组)
// diff 存在时:本批仅一个结果直接挂;多结果则按 filePath 匹配,避免并行工具挂错。
// 定向更新(审计 D3):只重建含目标 tool part 的消息,其余原引用透传——
// 长会话多工具调用时避免每个 tool_result 全量重建所有消息与 parts(徒增 GC,且会击穿下游 memo)
function foldResults(messages: readonly Message[], results: ToolResultBlock[], diff?: FileDiff): Message[] {
  if (!results.length) return messages.slice();
  const single = results.length === 1;
  const byId = new Map(results.map((r) => [r.tool_use_id, r]));
  return messages.map((m) => {
    if (!m.parts.some((p) => p.type === 'tool' && byId.has(p.id))) return m;
    return {
      ...m,
      parts: m.parts.map((p) => {
        if (p.type !== 'tool') return p;
        const r = byId.get(p.id);
        if (!r) return p;
        // 工具失败:标 error 并保留错误文本,由 ToolCard 以 danger 配色内联展示(不再走 toast)
        if (r.is_error) return { ...p, status: 'error' as const, result: toolResultText(r.content) || undefined };
        const text = toolResultText(r.content);
        // 多结果场景下:若工具入参取不到路径,diff 静默不挂(不会挂错到别的 part)
        const attach = diff && (single || inputFilePath(p.input) === diff.filePath);
        return { ...p, status: 'ready' as const, result: text, media: parseMediaItems(text) ?? undefined, submittedTask: parseSubmittedTask(text) ?? undefined, diff: attach ? diff : p.diff };
      }),
    };
  });
}

// 从工具入参里取文件路径(兼容 file_path / filePath / path)
function inputFilePath(input: unknown): string | undefined {
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    const v = o.file_path ?? o.filePath ?? o.path;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

// ---- 任务清单(planner 模式)----
// ID/状态机只信 tool_use_result;文案(subject/description/activeForm)从对应 tool_use part
// 的落定 input 补齐(流式半截 JSON 不进这里:input 在完整 AssistantMessage 落定时才写入 part)。
const KNOWN_TASK_STATUS: readonly PlanTaskStatus[] = ['pending', 'in_progress', 'completed'];
function normTaskStatus(s: string | undefined, fallback: PlanTaskStatus): PlanTaskStatus {
  return (KNOWN_TASK_STATUS as readonly string[]).includes(s ?? '') ? (s as PlanTaskStatus) : fallback;
}

// 从消息里按 tool_use_id 反查 tool part(取工具名 + 落定入参);草稿/历史均适用,从尾部找(结果紧跟调用)
function findToolPart(messages: readonly Message[], toolUseId: string): Extract<Part, { type: 'tool' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const p of messages[i].parts) {
      if (p.type === 'tool' && p.id === toolUseId) return p;
    }
  }
  return undefined;
}

// 把一批 tool_result 中的任务工具结果应用到清单。tool_use_result 是消息级单值,
// 多结果时无法可靠归属 → 仅处理单结果场景(任务工具实际单发);失败结果(is_error)不动清单。
function applyTaskResults(tasks: PlanTask[], messages: readonly Message[], results: ToolResultBlock[], raw: unknown): PlanTask[] {
  if (results.length !== 1 || results[0].is_error) return tasks;
  const part = findToolPart(messages, results[0].tool_use_id);
  if (!part || !isTaskTool(part.name)) return tasks;
  const effect = parseTaskResult(part.name, raw);
  if (!effect) return tasks;
  return reduceTasks(tasks, effect, parseTaskInput(part.input) ?? {});
}

function reduceTasks(tasks: PlanTask[], effect: TaskEffect, meta: TaskInputMeta): PlanTask[] {
  switch (effect.kind) {
    case 'create': {
      const item: PlanTask = {
        id: effect.id,
        subject: effect.subject || meta.subject || '',
        ...(meta.description ? { description: meta.description } : {}),
        ...(meta.activeForm ? { activeForm: meta.activeForm } : {}),
        status: 'pending',
      };
      // 重放防御:同 id 已存在则原位合并,不追加重复项
      return tasks.some((t) => t.id === item.id)
        ? tasks.map((t) => (t.id === item.id ? { ...t, ...item } : t))
        : [...tasks, item];
    }
    case 'update': {
      if (effect.to === 'deleted') return tasks.filter((t) => t.id !== effect.taskId);
      return tasks.map((t) => {
        if (t.id !== effect.taskId) return t;
        const next: PlanTask = { ...t, status: normTaskStatus(effect.to ?? undefined, t.status) };
        // updatedFields 声明了哪些文案被改写;新值只在 input 里
        if (effect.updatedFields.includes('subject') && meta.subject) next.subject = meta.subject;
        if (effect.updatedFields.includes('description') && meta.description) next.description = meta.description;
        if (effect.updatedFields.includes('activeForm') && meta.activeForm) next.activeForm = meta.activeForm;
        return next;
      });
    }
    case 'snapshot': {
      // 整单校正:顺序按后端 tasks[];快照不含 activeForm/description,按 id 从已有项保留合并
      const prev = new Map(tasks.map((t) => [t.id, t]));
      return effect.tasks.map((t) => {
        const old = prev.get(t.id);
        return {
          id: t.id,
          subject: t.subject || old?.subject || '',
          ...(old?.description ? { description: old.description } : {}),
          ...(old?.activeForm ? { activeForm: old.activeForm } : {}),
          status: normTaskStatus(t.status, old?.status ?? 'pending'),
        };
      });
    }
    case 'get':
      return tasks.map((t) => {
        if (t.id !== effect.task.id) return t;
        return {
          ...t,
          ...(effect.task.subject ? { subject: effect.task.subject } : {}),
          ...(effect.task.description ? { description: effect.task.description } : {}),
          status: normTaskStatus(effect.task.status, t.status),
        };
      });
  }
}

// 更新最后一条 running 轮(末尾起找);无 running 轮则原样返回。patch 中值为 undefined 的键不应传入(避免覆盖)
function patchActiveTurn(turns: TurnMeta[], patch: Partial<TurnMeta>): TurnMeta[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].status === 'running') {
      const next = turns.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    }
  }
  return turns;
}

// 终态帧闭轮:优先 patch running 轮;无 running 轮时按 runId 回退匹配**未落 finishedAt** 的轮——
// 兜底闭轮(ResultMessage/ready)先行、真终态帧后到的场景补回真实终态与时长(已落 finishedAt 的不重写)
function patchTurnForFinish(turns: TurnMeta[], patch: Partial<TurnMeta>, runId: string | null): TurnMeta[] {
  const next = patchActiveTurn(turns, patch);
  if (next !== turns || !runId) return next;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].runId === runId && turns[i].finishedAt == null) {
      const copy = turns.slice();
      copy[i] = { ...copy[i], ...patch };
      return copy;
    }
  }
  return turns;
}

// ---- run 结束:清 loading + 落定最后一条 assistant + 闭合当前轮 ----
function finishRun(state: KoubouState, finishedAt: string | null, turnStatus: TurnStatus, runId: string | null = null): KoubouState {
  const runStatus = turnStatus === 'error' ? 'error' as const : 'idle' as const;
  const messages = state.messages.map((m) =>
    m.role === 'assistant' && m.status === 'generating'
      ? { ...m, status: turnStatus === 'error' ? 'error' as const : 'ready' as const } : m);
  const turns = patchTurnForFinish(state.turns, { finishedAt, status: turnStatus }, runId);
  // 一并清乐观发送计时:run 已终结,即便 run.started 从未到达也不该留下悬空的计时
  return { ...state, messages, runStatus, activeRunId: null, turns, pendingSendAt: null, pendingModel: null };
}

// REST 权威复开(spec 2026-07-23 run-rest-tracking):后端 run 事件按连接投递,
// 新连接的 ready.active_run 恒 null → onReady 把快照恢复的 running 轮误闭为 succeeded(finishedAt=null)。
// REST /sessions.active_run_id 才是权威;据其复开误闭轮(或补建轮),供 REST 轮询跟跑期正确展示计时/骨架。
// 非服务端事件,不进 applyKoubou 的 switch,由 store action 直调。
// startedAtFallback:run.started 在种子窗口之外(长 run 刷新)时的起始时刻兜底,取 REST
// /sessions.updated_at —— 活跃 run 期该行最后一次写入就是 run 开始那一刻(见 spec 2026-07-31)。
// 只补空、不覆盖(live 的 pendingSendAt / 真实 run.started 恒更准);为 null 时维持旧行为(不谎报时长)。
export function reopenRun(state: KoubouState, runId: string, startedAtFallback: string | null = null): KoubouState {
  let idx = -1;
  for (let i = state.turns.length - 1; i >= 0; i--) {
    if (state.turns[i].runId === runId) { idx = i; break; }
  }
  const hit = idx >= 0 ? state.turns[idx] : undefined;
  // 真终态不可逆:已落 finishedAt 说明终态帧已消化,REST 摘要只是尚未同步,不复开
  if (hit && hit.finishedAt != null) return state;
  // 本次是否要补起始时刻:轮缺 startedAt 且拿到了兜底值
  const fillStartedAt = !!startedAtFallback && (hit ? hit.startedAt == null : true);
  // 幂等收敛:轮已 running 且全局态一致时原样返回(轮询循环会重复调用)。
  // 但「还差起始时刻」要放行 —— 否则被旧版本污染成 startedAt=null 的快照永远补不上
  if (hit && hit.status === 'running' && state.runStatus === 'running' && state.activeRunId === runId && !fillStartedAt) return state;
  const turns = state.turns.slice();
  if (hit) turns[idx] = { ...hit, status: 'running', ...(fillStartedAt ? { startedAt: startedAtFallback } : {}) };
  // run.started 在种子窗口之外:补建轮;拿不到兜底则 startedAt 为 null,footer 退化为纯 running 文案
  else turns.push({ runId, model: state.model, startedAt: startedAtFallback, finishedAt: null, status: 'running', lastMessageId: null });
  return { ...state, turns, runStatus: 'running', activeRunId: runId };
}

// ---- claude.message ----
function onClaudeMessage(state: KoubouState, p: ClaudeMessagePayload, eventRunId: string | null = null): KoubouState {
  // 分流唯一判据是 parent_tool_use_id(见 koubou docs/websocket-events.md「子 agent 归属与渲染」):
  // 一个 run 里父回合与若干子 agent 的消息混在同一条流里,不分流就会把子 agent 的话
  // 渲染成父 agent 自己说的话
  const parentToolUseId = typeof p.payload.parent_tool_use_id === 'string' && p.payload.parent_tool_use_id
    ? p.payload.parent_tool_use_id : null;
  // 后台任务生命周期端点:只喂卡片状态机,不进消息流
  if (isTaskLifecycleType(p.sdk_type)) {
    const lifecycle = parseTaskLifecycle(p.sdk_type, p.payload);
    if (!lifecycle) return state;
    return { ...state, subagents: reduceLifecycle(state.subagents, lifecycle, { runId: eventRunId ?? state.activeRunId }) };
  }
  // 子 agent 自己的流量(Assistant/User/StreamEvent):剥出主消息流,只留「正在做什么」的活体行。
  // 它的文本 / thinking 不展示 —— 真正的产出在 TaskNotificationMessage.summary 里
  if (parentToolUseId) return absorbSubagentMessage(state, p, parentToolUseId);
  if (p.sdk_type === 'StreamEvent') return applyStreamEvent(state, p.payload.event as RawStreamEvent);
  if (!isFullMessage(p.sdk_type)) return state; // HookEvent/TaskProgress 等忽略
  // live 路径同口径:模型名在 init 帧的 data 里,顺带回填当前轮(run.started 建轮时 model 常为空)
  if (p.sdk_type === 'SystemMessage') {
    const sysModel = systemMessageModel(p);
    if (!sysModel) return state;
    return { ...state, model: sysModel, turns: patchActiveTurn(state.turns, { model: sysModel }) };
  }
  // ResultMessage 是 SDK 的回合终点帧,正常由紧随的 run.finished 闭轮;
  // 后端偶发丢 run.finished 时(Meegle 13383614:回合结束后卡 running)以它兜底闭轮,
  // run.finished 随后补到也只是幂等重放(无 running 轮可 patch,状态不变)
  if (p.sdk_type === 'ResultMessage') {
    if (state.runStatus !== 'running') return state;
    return finishRun(state, null, p.payload.subtype === 'success' ? 'succeeded' : 'error', state.activeRunId);
  }
  const content = (p.payload.content ?? []) as ContentBlock[] | string;
  // 消息身份优先用 uuid:并行 tool_use 时同一 API 消息按 block 拆成多条事件,
  // message_id 相同而 uuid 各异——按 message_id 收编会互相覆盖丢 part(也与 rebuildHistory 的 uuid 键对齐)
  const messageId = p.payload.uuid ?? p.payload.message_id ?? p.payload.id;
  if (p.sdk_type === 'AssistantMessage') {
    // 父回合的 tool_use id 是归属校验集合的来源 ①:生命周期事件只认这个集合里的 parent_tool_use_id
    const withIds = { ...state, subagents: learnToolUseIds(state.subagents, toolUseIdsOf(content)) };
    return reconcileAssistant(withIds, messageId, content, p.payload.model);
  }
  // UserMessage:仅折叠 tool_result(用户文本已乐观渲染,不重复成泡);带文件 diff 时一并挂载
  const blocks = Array.isArray(content) ? content : [];
  const results = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  if (!results.length) return state;
  // 文件 diff 走文档约定的 snake_case 字段;与冷启动 rebuildHistory 路径保持一致
  return {
    ...state,
    messages: foldResults(state.messages, results, parseFileDiff(p.payload.tool_use_result) ?? undefined),
    tasks: applyTaskResults(state.tasks, state.messages, results, p.payload.tool_use_result),
  };
}

function toolUseIdsOf(content: ContentBlock[] | string): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b): b is ToolUseBlock => b.type === 'tool_use' && typeof (b as ToolUseBlock).id === 'string')
    .map((b) => b.id);
}

// 子 agent 消息的全部去处:它调的工具名喂给卡片做活体指示,其余丢弃。
// 不进 messages —— 这正是「子 agent 的话冒充父 agent」那个 bug 的修法
function absorbSubagentMessage(state: KoubouState, p: ClaudeMessagePayload, parentToolUseId: string): KoubouState {
  if (p.sdk_type !== 'AssistantMessage') return state;
  const names = Array.isArray(p.payload.content)
    ? (p.payload.content as ContentBlock[]).filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => b.name)
    : [];
  const last = names[names.length - 1];
  if (!last) return state;
  return { ...state, subagents: noteSubagentTool(state.subagents, parentToolUseId, last) };
}

function reconcileAssistant(state: KoubouState, messageId: string | undefined, content: ContentBlock[] | string, model?: string): KoubouState {
  let parts = blocksToParts(content);
  const messages = state.messages.slice();
  // 优先按 message_id 匹配;否则收编尾部 generating 草稿;再否则新增
  let idx = messageId ? messages.findIndex((m) => m.id === messageId) : -1;
  if (idx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].status === 'generating') { idx = i; break; }
    }
  }
  // 上游最终消息常省略 thinking 块;若落定内容不含思考,则保留流式期间累积的思考,避免折叠头消失
  if (idx !== -1) parts = preserveThinking(messages[idx].parts, parts);
  const msg: Message = { id: messageId ?? newId('msg'), role: 'assistant', parts, status: 'ready' };
  if (idx === -1) messages.push(msg); else messages[idx] = msg;
  // 回填当前轮:锚点指向落定消息;model 仅在存在时覆盖(避免抹掉会话级初值)
  const patch: Partial<TurnMeta> = { lastMessageId: msg.id };
  if (model) patch.model = model;
  return { ...state, messages, turns: patchActiveTurn(state.turns, patch) };
}

// 落定内容已含 thinking → 以其为准;否则把草稿里的非空思考块按原序补到前面(思考先于正文/工具)
function preserveThinking(prevParts: Part[], nextParts: Part[]): Part[] {
  if (nextParts.some((p) => p.type === 'thinking')) return nextParts;
  const thinking = prevParts.filter((p) => p.type === 'thinking' && p.text.trim() !== '');
  return thinking.length ? [...thinking, ...nextParts] : nextParts;
}

function applyStreamEvent(state: KoubouState, ev: RawStreamEvent): KoubouState {
  switch (ev.type) {
    case 'message_start': {
      const id = (ev as { message: { id: string } }).message.id;
      if (state.messages.some((m) => m.id === id)) return state;
      return {
        ...state,
        messages: [...state.messages, { id, role: 'assistant', parts: [], status: 'generating' }],
        turns: patchActiveTurn(state.turns, { lastMessageId: id }),
      };
    }
    case 'content_block_start': {
      const cur = lastDraft(state); if (!cur) return state;
      const cb = (ev as { index: number; content_block: { type: string; id?: string; name?: string } });
      const part: Part = cb.content_block.type === 'text' ? { type: 'text', text: '' }
        : cb.content_block.type === 'thinking' ? { type: 'thinking', text: '' }
        : { type: 'tool', id: cb.content_block.id ?? '', name: cb.content_block.name ?? '', input: undefined, status: 'generating' };
      return patchDraft(state, cur.id, (parts) => setAt(parts, cb.index, part));
    }
    case 'content_block_delta': {
      const cur = lastDraft(state); if (!cur) return state;
      const d = (ev as { index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } });
      return patchDraft(state, cur.id, (parts) => {
        const arr = parts.slice(); const p = arr[d.index]; if (!p) return arr;
        if (d.delta.type === 'text_delta' && p.type === 'text') arr[d.index] = { ...p, text: p.text + (d.delta.text ?? '') };
        else if (d.delta.type === 'thinking_delta' && p.type === 'thinking') arr[d.index] = { ...p, text: p.text + (d.delta.thinking ?? '') };
        // tool input 增量在草稿期不解析,等完整 AssistantMessage 落定
        return arr;
      });
    }
    default: return state; // content_block_stop / message_stop 不改草稿
  }
}

function lastDraft(state: KoubouState): Message | undefined {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role === 'assistant' && state.messages[i].status === 'generating') return state.messages[i];
  }
  return undefined;
}
function patchDraft(state: KoubouState, id: string, fn: (parts: Part[]) => Part[]): KoubouState {
  // 草稿恒在尾部附近:从尾部反向定位 + 单点替换,避免每个流式 delta 对全量 messages 跑 map 谓词(长会话每 token 付 O(N) 闭包开销)
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].id !== id) continue;
    const messages = state.messages.slice();
    messages[i] = { ...messages[i], parts: fn(messages[i].parts) };
    return { ...state, messages };
  }
  return state;
}
function setAt(arr: Part[], i: number, v: Part): Part[] {
  const a = arr.slice();
  for (let k = a.length; k < i; k++) a[k] = { type: 'text', text: '' }; // 防御:乱序 index 不留 undefined 空洞
  a[i] = v;
  return a;
}

// ---- pending / error ----
function upsertPending(state: KoubouState, it: PendingInteraction): KoubouState {
  return { ...state, pendingInteractions: { ...state.pendingInteractions, [it.interactionId]: it } };
}
function onError(state: KoubouState, e: ServerEvent): KoubouState {
  const id = e.payload.interaction_id as string | undefined;
  // 命中某个未决交互 = 该弹窗已失效(stale),仅清弹窗;housekeeping,不冒泡进对话
  if (id && state.pendingInteractions[id]) {
    const pending = { ...state.pendingInteractions };
    delete pending[id];
    return { ...state, pendingInteractions: pending };
  }
  // 其余 = agent/run 级错误:归一为本地 code(渲染期翻译),原文作 fallback;
  // 同时清乐观发送计时(run 可能根本不会开跑,不留悬空计时)
  const p = e.payload as KoubouErrorPayload;
  const { code, fallback } = classifyKoubouError(p);
  const failed = failAgentTurn(state, {
    code, fallback, detail: koubouErrorDetail(p), runId: runIdOf(e),
    ...(typeof p.retryable === 'boolean' ? { retryable: p.retryable } : {}),
  });
  return { ...failed, pendingSendAt: null, pendingModel: null };
}

// 写固定槽的报错(设计稿 2026-08-27)。code 命中时渲染期翻译,fallback 为后端原文/默认,
// detail 为上游完整原文(有值才写字段 —— 空字段会让「同一个错」在不同路径下形状不一)。
// **不再往 messages 里 append**:报错是输入框正上方的一格瞬态 UI,不进对话流、不落盘。
function setAgentError(state: KoubouState, code: string | undefined, fallback: string, detail?: string): KoubouState {
  return {
    ...state,
    agentError: { text: fallback, ...(code ? { code } : {}), ...(detail ? { detail } : {}) },
  };
}

// 落正式错误气泡 = 放弃自愈,同时清掉重试态(否则气泡与进度会并存)。
// 单独导出给「用户主动取消」用:那条路径不该借道 failAgentTurn 传假 lastSend 去凑弃疗分支 ——
// 返回值会被 set 写回,把 lastSend 真清掉,手动重试按钮(判据含它)就跟着永久消失了
export function pushAgentError(state: KoubouState, f: AgentFailure): KoubouState {
  const next = setAgentError(state, f.code, f.fallback, f.detail);
  // 后端明说不可重试 → 记事实,固定槽据此改弹「换模型」卡(设计稿 2026-09-03)。
  // 只认 === false:自愈耗尽的 retryable:true 与缺失都不算模型侧不可重试
  const agentError = f.retryable === false && next.agentError ? { ...next.agentError, retryable: false as const } : next.agentError;
  return { ...next, agentError, agentRetry: null };
}

// agent/run 级失败的唯一收口。两个入口(error 事件 / run.finished{failed})此前各推各的气泡,
// 收敛成一处是为了自动重试的判定只写一份 —— 判据各写一份是本仓明列的反模式。
//
// 判定全在这里(纯函数、locale 中立);真正的发送由 client/useAgentRetry 执行 ——
// client 实例是 hook 的 ref,store 与 reducer 都够不着。
export function failAgentTurn(state: KoubouState, f: AgentFailure): KoubouState {
  // 给本轮打「已报过错」标记:后端 live 的 run.finished **只有** {run_id, status}、从不带 error
  // (actor.py:1631 / run_lifecycle.py:81),所以终态帧得自己补气泡才不会让失败静默;
  // 而绝大多数失败又是先来一条 error 事件的 —— 没这个标记两条路会各推一条,重复报错。
  const marked: KoubouState = f.runId
    ? { ...state, turns: state.turns.map((t) => (t.runId === f.runId ? { ...t, errorReported: true } : t)) }
    : state;
  state = marked;
  const giveUp = (): KoubouState => pushAgentError(state, f);

  // 刷新后 lastSend 必然为空(瞬态),没有可重发的东西就只能报错
  if (!state.lastSend) return giveUp();
  if (!isRetryableAgentError(f.code, f.retryable)) return giveUp();
  const attempt = (state.agentRetry?.attempt ?? 0) + 1;
  if (attempt > MAX_AGENT_RETRIES) return giveUp();

  // 本轮是否已有助手输出 —— lastMessageId 在助手消息落定/流式开篇时被 patch,
  // tool_use 作为助手消息的 part 天然包含在内,无需另造判据。
  // 已有产出就别让 agent 从头重做(那部分已经花过钱、可能已经动过文件),改发 continue。
  // **每次失败重判**:一次 resend 之后 agent 吐了半句又崩,下一次就该转成 continue
  // 已进过 continue 就不再退回 resend:产出是不可撤销的事实,而兜底路径(发出后 run 永不开跑)
  // 拿不到 runId,不带这条单调性就会把已有产出的会话退化成从头重发
  const turn = f.runId ? state.turns.find((t) => t.runId === f.runId) : undefined;
  const mode: RetryMode = (turn?.lastMessageId || state.agentRetry?.mode === 'continue') ? 'continue' : 'resend';
  return {
    ...state,
    // 互斥落在**状态**里而不是只靠渲染层:自愈接手这一格,上一条报错就此让位
    // (否则两个字段并存,固定槽画哪个全看组件里那道防线,防线一改就静默丢报错)
    agentError: null,
    agentRetry: {
      attempt,
      mode,
      phase: 'waiting',
      nextAt: null,
      text: f.fallback,
      ...(f.code ? { code: f.code } : {}),
      ...(f.detail ? { detail: f.detail } : {}),
    },
  };
}
