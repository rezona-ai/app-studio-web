// 会话快照的**唯一造型处**。
//
// 快照(PersistedSession)在五个地方被写/读:onEvent 检查点、gap 回填、回放逐帧检查点、
// 回放收尾、断点续播恢复。2026-08-24 给它加 subagents 字段时漏了后两处,回放链路上刚落盘的
// 卡片被一份缺字段的快照整体覆盖 —— 症状与本次要修的 bug 一模一样(评审 I-1)。
// 根因是「形状」散落在五处字面量里,加字段必须五处同步改,而没有任何东西守着这件事。
// 故收敛成这一对纯函数:写走 sessionSnapshot、读走 restoreSnapshot,新增字段只改这里。
import type { KoubouState, Message, PersistedSession } from './types';
import { createSubagentState, type SubagentState } from '@/lib/subagent-tasks';

// 从当前会话态造快照。sessionId 显式传入:回放链路要钉住 clone 会话的 id,与 state.sessionId 不同。
export function sessionSnapshot(state: KoubouState, sessionId: string): PersistedSession {
  return {
    sessionId,
    lastSequence: state.lastSequence,
    messages: state.messages,
    turns: state.turns,
    tasks: state.tasks,
    subagents: stripLiveOnly(state.subagents),
  };
}

// 快照 → 会话态字段。缺字段的老快照(2026-08-24 之前写的)与内部键残缺的坏快照都归一到完整形状,
// 否则 sealStaleCards / reduceLifecycle 会在 st.cards 上直接抛。
export function restoreSnapshot(saved: PersistedSession | undefined): Pick<KoubouState, 'messages' | 'turns' | 'tasks' | 'subagents'> {
  return {
    messages: dropLegacyErrors(saved?.messages ?? []),
    turns: saved?.turns ?? [],
    tasks: saved?.tasks ?? [],
    subagents: { ...createSubagentState(), ...saved?.subagents },
  };
}

// 剥掉只属于 live 的字段。lastToolName 来自 TaskProgressMessage,而 progress 不落库
// (见 subagent-tasks.ts 的契约要点),存了它刷新后就是个再也不会被推进的陈旧动作名。
// 在**写快照时**剥而不是在 partialize 里剥:partialize 每次 set() 都跑(流式期每 token 一次),
// 在那里剥会让「未超限即同引用」的零拷贝承诺在整个活跃回合里静默失效(评审 M-2)。
// 无需改动时返回原引用。
function stripLiveOnly(st: SubagentState): SubagentState {
  if (!st.cards.some((c) => c.lastToolName !== undefined)) return st;
  return {
    ...st,
    cards: st.cards.map((c) => {
      if (c.lastToolName === undefined) return c;
      const copy = { ...c };
      delete copy.lastToolName;
      return copy;
    }),
  };
}

// 存量清洗(设计稿 2026-08-27):报错改成固定槽的瞬态字段后,老快照里那些 error 消息在对话流里
// 已无渲染分支,不滤掉就是一段带间距的空壳节点。**一次性清洗,不是长期兼容层** —— 新写入的
// 快照里不会再有 error part。只滤「整条都是 error」的:混排消息(理论上不该出现,但老数据不由
// 我们担保)整条丢掉会连带丢掉助手正文。无存量时返回原引用,不白造新数组。
function dropLegacyErrors(messages: Message[]): Message[] {
  const legacy = (m: Message) => m.parts.length > 0 && m.parts.every((p) => p.type === 'error');
  return messages.some(legacy) ? messages.filter((m) => !legacy(m)) : messages;
}
