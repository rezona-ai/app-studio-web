import { describe, expect, test, beforeEach } from 'vitest';
import { applyKoubou, applyUserMessage, seedHistory, prependHistory, rebuild, reopenRun } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import type { Part, KoubouState } from '@/store/types';
import { parseFileDiff } from './protocol';
import type { ServerEvent } from './protocol';

const S = () => createInitialKoubouState();
const ev = (e: Partial<ServerEvent> & { type: string }): ServerEvent =>
  ({ project_id: '2', session_id: 's1', payload: {}, ...e }) as ServerEvent;
// visible_state.messages 的真实元素:claude.message 事件信封({ sdk_type, payload })
const cmsg = (sdk_type: string, payload: Record<string, unknown>): ServerEvent =>
  ({ type: 'claude.message', project_id: '2', session_id: 's1', payload: { sdk_type, payload } }) as ServerEvent;
// 用户输入信封:用户文本的真实来源(claude.message/UserMessage 只承载 tool_result)
const umsg = (content: unknown, event_id?: string): ServerEvent =>
  ({ type: 'user.message', project_id: '2', session_id: 's1', event_id, payload: { message: { role: 'user', content }, parent_tool_use_id: null } }) as ServerEvent;

describe('session.ready', () => {
  test('空消息时用 visible_state(事件日志)重建历史 + 恢复 run/pending', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: {
        session_id: 's1',
        visible_state: { messages: [
          cmsg('SystemMessage', { subtype: 'init', data: {} }), // 非展示事件,应跳过
          umsg('做个跳跃游戏', 'evt_u1'), // 用户文本来自 user.message 信封
          cmsg('AssistantMessage', { uuid: 'a1', content: [
            { type: 'thinking', thinking: '先看目录' }, { type: 'text', text: '好的' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ] }),
          cmsg('UserMessage', { uuid: 'u2', content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'a.png\nb.png' },
          ] }),
        ] },
        active_run: { run_id: 'r1', status: 'running' },
        pending_interactions: [
          { interaction_id: 'i1', interaction_type: 'approval', tool_name: 'Bash', request: { interaction_id: 'i1', tool_name: 'Bash', input: { command: 'rm' } } },
        ],
      },
    }));
    expect(next.sessionId).toBe('s1');
    expect(next.runStatus).toBe('running');
    expect(next.activeRunId).toBe('r1');
    // 历史:user 气泡 + assistant 气泡(tool_result 折叠进 tool part,不单独成泡)
    expect(next.messages).toHaveLength(2);
    expect(next.messages[0].role).toBe('user');
    // user.message 用 event_id 作 id(缺失则兜底 newId,避免重复 key)
    expect(next.messages[0].id).toBe('evt_u1');
    expect(next.messages[1].id).toBe('a1');
    expect(next.messages[0].parts).toEqual([{ type: 'text', text: '做个跳跃游戏' }]);
    const tool = next.messages[1].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't1', name: 'Bash', result: 'a.png\nb.png', status: 'ready' });
    expect(next.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
  });

  test('backend / permission_mode 以 ready 为权威校正', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', active_run: null, backend: 'codex', permission_mode: 'acceptEdits' },
    }));
    expect(next.backend).toBe('codex');
    expect(next.permissionMode).toBe('acceptEdits');
  });

  test('backend 缺失 / 词表外时保留现值(不把未知值写进状态)', () => {
    const base = { ...S(), backend: 'codex' as const };
    expect(applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null } })).backend).toBe('codex');
    expect(applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, backend: 'single' } })).backend).toBe('codex');
  });

  test('user.message 事件重建为用户气泡(文本来源,与 tool_result 折叠互不干扰)', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', visible_state: { messages: [
        umsg('先给炮生成击杀动画', 'evt_backfill_a'),
        cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'tool_use', id: 't1', name: 'gen', input: {} }] }),
        cmsg('UserMessage', { uuid: 'u_tr', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }),
        umsg('再给兵生成', undefined), // 缺 event_id → 兜底 newId,不报重复 key
      ] } },
    }));
    // 两条用户气泡 + 一条 assistant(tool_result 折叠进 t1,不单独成泡)
    expect(next.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(next.messages[0].id).toBe('evt_backfill_a');
    expect(next.messages[0].parts).toEqual([{ type: 'text', text: '先给炮生成击杀动画' }]);
    expect(next.messages[2].id).toBeTruthy(); // 兜底 id 非空
    const tool = next.messages[1].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't1', result: 'ok', status: 'ready' });
  });

  test('空内容的 user.message 不产生空气泡', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', visible_state: { messages: [umsg('', 'evt_empty'), umsg([], 'evt_empty2')] } },
    }));
    expect(next.messages).toHaveLength(0);
  });

  test('onReady 用 pending_interactions 整体替换 pending(旧的答过/失效项被清)', () => {
    const base = { ...S(), pendingInteractions: { old: { kind: 'question' as const, interactionId: 'old', questions: [] } } };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, visible_state: { messages: [] }, pending_interactions: [
      { interaction_id: 'i1', interaction_type: 'approval', tool_name: 'Bash', request: { input: { command: 'ls' } } },
    ] } }));
    expect(next.pendingInteractions['old']).toBeUndefined();
    expect(next.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
  });

  test('onReady 无 pending_interactions 时清空所有 pending', () => {
    const base = { ...S(), pendingInteractions: { old: { kind: 'question' as const, interactionId: 'old', questions: [] } } };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, visible_state: { messages: [] } } }));
    expect(next.pendingInteractions).toEqual({});
  });

  test('已有本地消息时不覆盖历史,仅校正 run/pending', () => {
    const base = { ...S(), messages: [{ id: 'local', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }], status: 'ready' as const }] };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].id).toBe('local');
    expect(next.runStatus).toBe('idle');
  });

  // 刷新恢复:快照带回 running 轮(turns 持久化)而 runStatus 不落盘(重置 idle)。
  // ready 是 run 态权威:active_run 为空时须一并闭合本地 running 轮 + 落定草稿,
  // 否则计时器永转、骨架屏因 runStatus=idle 不显示(两者失配)
  test('ready active_run=null 时闭合快照恢复的 running 轮并落定 generating 草稿', () => {
    const base: KoubouState = {
      ...S(),
      messages: [{ id: 'd1', role: 'assistant', parts: [{ type: 'text', text: '半截' }], status: 'generating' }],
      turns: [{ runId: 'r1', model: 'claude-fable-5', startedAt: '2026-07-22T12:05:43Z', finishedAt: null, status: 'running', lastMessageId: 'd1' }],
    };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(next.runStatus).toBe('idle');
    expect(next.turns[0].status).not.toBe('running');
    expect(next.messages[0].status).toBe('ready');
  });

  test('ready active_run 仍在跑时不动本地 running 轮', () => {
    const base: KoubouState = {
      ...S(),
      turns: [{ runId: 'r1', model: null, startedAt: '2026-07-22T12:05:43Z', finishedAt: null, status: 'running', lastMessageId: null }],
    };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: { run_id: 'r1', status: 'running' }, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(next.runStatus).toBe('running');
    expect(next.turns[0].status).toBe('running');
  });

  test('ready 复用已见 sequence 时不被去重吞掉:快照恒应用,runStatus 校正回 idle', () => {
    // 复现 bug 13383614:run 终态帧丢失后,重连(跨 Pod)下发的空闲 ready 若复用了
    // 客户端已见过的 sequence,曾被去重门整帧丢弃 → runStatus 永卡 running
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 4376, payload: { run_id: 'r1' } }));
    expect(s.runStatus).toBe('running');
    s = applyKoubou(s, ev({ type: 'session.ready', sequence: 4376, payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(s.runStatus).toBe('idle');
    expect(s.activeRunId).toBeNull();
  });
});

describe('历史分页 seedHistory / prependHistory', () => {
  const seq = (e: ServerEvent, n: number): ServerEvent => ({ ...e, sequence: n });

  test('seedHistory 用最新一页重建历史并初始化游标,lastSequence 对齐会话最新', () => {
    const events = [seq(umsg('第二页问题', 'evt_u2'), 51), seq(cmsg('AssistantMessage', { uuid: 'a2', content: [{ type: 'text', text: '回答' }] }), 52)];
    const s = seedHistory(S(), { events, has_more: true, latest_sequence: 52 });
    expect(s.messages.map((m) => m.id)).toEqual(['evt_u2', 'a2']);
    expect(s.historyMsgCount).toBe(2);
    expect(s.historyOldestSeq).toBe(51);
    expect(s.historyHasMore).toBe(true);
    expect(s.lastSequence).toBe(52);
  });

  test('prependHistory 前插更早页,保留 live 尾部,游标前移', () => {
    let s = seedHistory(S(), { events: [seq(umsg('近期', 'evt_new'), 51)], has_more: true, latest_sequence: 51 });
    // live 追加一条(模拟 WS 增量)
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 60, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'live1', content: [{ type: 'text', text: 'live' }] } } }));
    s = prependHistory(s, { events: [seq(umsg('更早', 'evt_old'), 1)], has_more: false, latest_sequence: 60 });
    expect(s.messages.map((m) => m.id)).toEqual(['evt_old', 'evt_new', 'live1']);
    expect(s.historyMsgCount).toBe(2);
    expect(s.historyOldestSeq).toBe(1);
    expect(s.historyHasMore).toBe(false);
  });

  test('跨页边界的 tool_use(旧页)/tool_result(新页)在前插后正确折叠', () => {
    // 新页只有 tool_result(无匹配 tool_use,种子化时折叠不上)
    let s = seedHistory(S(), {
      events: [seq(cmsg('UserMessage', { uuid: 'u_tr', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }), 51)],
      has_more: true, latest_sequence: 51,
    });
    expect(s.messages).toHaveLength(0);
    // 旧页带 tool_use → 合并重建后结果应折叠进 tool part
    s = prependHistory(s, {
      events: [seq(cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] }), 50)],
      has_more: false, latest_sequence: 51,
    });
    const tool = s.messages[0].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't1', result: 'ok', status: 'ready' });
  });

  test('空页只更新 has_more,不动消息', () => {
    const base = seedHistory(S(), { events: [seq(umsg('hi', 'evt_1'), 5)], has_more: true, latest_sequence: 5 });
    const s = prependHistory(base, { events: [], has_more: false, latest_sequence: 5 });
    expect(s.messages).toBe(base.messages);
    expect(s.historyHasMore).toBe(false);
  });
});

describe('run 生命周期', () => {
  test('run.started → running;run.finished succeeded → idle', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    expect(s.runStatus).toBe('running');
    expect(s.activeRunId).toBe('r1');
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 4, payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.runStatus).toBe('idle');
    expect(s.activeRunId).toBeNull();
    expect(s.lastSequence).toBe(4);
  });
  test('乐观发送计时 pendingSendAt:run.started 清除(交棒真实 turn);run.finished 兜底清除', () => {
    const pending = { ...S(), pendingSendAt: '2026-07-22T00:00:00.000Z' };
    const started = applyKoubou(pending, ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    expect(started.pendingSendAt).toBeNull();
    // run.started 丢失、直接收到终态:同样不留悬空计时
    const finished = applyKoubou(pending, ev({ type: 'run.finished', sequence: 2, payload: { status: 'failed' } }));
    expect(finished.pendingSendAt).toBeNull();
  });
  test('run.finished failed → error', () => {
    const s = applyKoubou(S(), ev({ type: 'run.finished', sequence: 2, payload: { status: 'failed' } }));
    expect(s.runStatus).toBe('error');
  });
  // 后端实际以 run.finished { status: 'interrupted' } 表示打断(线上会话事件日志实证),
  // 须与 run.interrupted 同处理:闭轮为 interrupted + 追加本地化打断回复,不得误判为 error
  test('run.finished interrupted → 等价 run.interrupted:闭轮 + 打断回复气泡', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 2, payload: { run_id: 'r1', status: 'interrupted' } }));
    expect(s.runStatus).toBe('idle');
    expect(s.turns[0].status).toBe('interrupted');
    const last = s.messages[s.messages.length - 1];
    expect(last.parts[0]).toMatchObject({ type: 'notice', code: 'chat.interruptedReply' });
    expect(s.turns[0].lastMessageId).toBe(last.id);
  });
  // 兜底:后端偶发不下发 run.finished(Meegle 13383614),ResultMessage 是 SDK 的回合终点帧,
  // 收到即视为本轮结束;随后若 run.finished 补到,重复闭轮应为无害幂等
  test('ResultMessage 兜底闭轮:running → idle,generating 气泡落定;后续 run.finished 幂等', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'ResultMessage', payload: { subtype: 'success' } } }));
    expect(s.runStatus).toBe('idle');
    expect(s.activeRunId).toBeNull();
    expect(s.turns[0].status).toBe('succeeded');
    expect(s.messages.every((m) => m.status !== 'generating')).toBe(true);
    const after = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(after.runStatus).toBe('idle');
    expect(after.turns[0].status).toBe('succeeded');
  });
  test('ResultMessage 非 success 子类型兜底闭轮为 error', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'ResultMessage', payload: { subtype: 'error_during_execution' } } }));
    expect(s.runStatus).toBe('error');
    expect(s.turns[0].status).toBe('error');
  });
  // 兜底闭轮(ResultMessage/ready)先行、真终态帧后到:按 runId 回填真实 finishedAt/状态,
  // 否则 footer 永远只显模型不显时长
  test('ResultMessage 兜底闭轮后,真 run.finished 按 runId 补回 finishedAt', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, created_at: '2026-07-22T12:00:00Z', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'ResultMessage', payload: { subtype: 'success' } } }));
    expect(s.turns[0].finishedAt).toBeNull();
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, created_at: '2026-07-22T12:03:00Z', payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.turns[0].finishedAt).toBe('2026-07-22T12:03:00Z');
    expect(s.turns[0].status).toBe('succeeded');
  });
  test('ready 兜底闭轮后,真 run.finished(interrupted) 按 runId 修正状态与时长', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(s.turns[0].status).toBe('succeeded');   // 兜底猜测
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 2, created_at: '2026-07-22T12:05:00Z', payload: { run_id: 'r1', status: 'interrupted' } }));
    expect(s.turns[0].status).toBe('interrupted');
    expect(s.turns[0].finishedAt).toBe('2026-07-22T12:05:00Z');
  });
  test('runId 回退不碰已落 finishedAt 的轮(真终态只补一次)', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 2, created_at: '2026-07-22T12:01:00Z', payload: { run_id: 'r1', status: 'succeeded' } }));
    const again = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, created_at: '2026-07-22T12:09:00Z', payload: { run_id: 'r1', status: 'failed' } }));
    expect(again.turns[0].finishedAt).toBe('2026-07-22T12:01:00Z');
    expect(again.turns[0].status).toBe('succeeded');
  });

  // 后端对同一次打断可能既发 run.interrupted 又发 run.finished{interrupted}(两帧 sequence 不同,
   // 去重挡不住),两条入口都无条件追加回复会让聊天里出现两条一模一样的 "Stopped..."
  test('同一 run 的两个打断终态帧 → 只产一条打断回复', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r1', sequence: 2, created_at: '2026-07-31T10:00:00Z', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, payload: { run_id: 'r1', status: 'interrupted' } }));
    const notices = s.messages.filter((m) => m.parts.some((p) => p.type === 'notice' && p.code === 'chat.interruptedReply'));
    expect(notices).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ status: 'interrupted', finishedAt: '2026-07-31T10:00:00Z', lastMessageId: notices[0].id });
    expect(s.runStatus).toBe('idle');
  });
  // sequence=null 的瞬时打断帧重复下发时同样只产一条(去重只认 sequence,挡不住这类帧)
  test('无 sequence 的重复 run.interrupted → 只产一条打断回复', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r1', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r1', payload: { run_id: 'r1' } }));
    expect(s.messages.filter((m) => m.parts.some((p) => p.type === 'notice' && p.code === 'chat.interruptedReply'))).toHaveLength(1);
  });
  // 下一轮被打断仍要各产各的:幂等只针对同一轮的重复终态帧
  test('两个不同 run 各被打断 → 各产一条打断回复', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r1', sequence: 2, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.started', run_id: 'r2', sequence: 3, payload: { run_id: 'r2' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r2', sequence: 4, payload: { run_id: 'r2' } }));
    const notices = s.messages.filter((m) => m.parts.some((p) => p.type === 'notice' && p.code === 'chat.interruptedReply'));
    expect(notices).toHaveLength(2);
    expect(s.turns.map((t) => t.lastMessageId)).toEqual(notices.map((m) => m.id));
  });
  test('rebuild:同一 run 的两个打断终态帧 → 只产一条打断回复', () => {
    const { messages, turns } = rebuild([
      ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }),
      ev({ type: 'run.interrupted', sequence: 2, created_at: '2026-07-31T10:00:00Z', payload: { run_id: 'r1' } }),
      ev({ type: 'run.finished', sequence: 3, payload: { run_id: 'r1', status: 'interrupted' } }),
    ]);
    const notices = messages.filter((m) => m.parts.some((p) => p.type === 'notice' && p.code === 'chat.interruptedReply'));
    expect(notices).toHaveLength(1);
    expect(turns[0]).toMatchObject({ status: 'interrupted', finishedAt: '2026-07-31T10:00:00Z', lastMessageId: notices[0].id });
  });
  test('rebuild:run.finished interrupted 闭轮为 interrupted + 生成打断回复', () => {
    const { messages, turns } = rebuild([
      ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }),
      { ...cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'text', text: '进行中' }] }), sequence: 2 },
      ev({ type: 'run.finished', sequence: 3, payload: { run_id: 'r1', status: 'interrupted' } }),
    ]);
    expect(turns[0].status).toBe('interrupted');
    const last = messages[messages.length - 1];
    expect(last.parts[0]).toMatchObject({ type: 'notice', code: 'chat.interruptedReply' });
    expect(turns[0].lastMessageId).toBe(last.id);
  });
  test('空闲态收到 ResultMessage 不改状态(无 running 轮)', () => {
    const base = S();
    const s = applyKoubou(base, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'ResultMessage', payload: { subtype: 'success' } } }));
    expect(s.runStatus).toBe('idle');
    expect(s.turns).toEqual(base.turns);
  });
});

describe('claude.message 流式 + 完整消息', () => {
  test('StreamEvent 增量累积文本,AssistantMessage 落定权威内容', () => {
    let s = S();
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } } } } }));
    expect(s.messages[0].parts[0]).toEqual({ type: 'text', text: '你好' });
    // 完整 AssistantMessage(同 message_id)落定,覆盖草稿
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'text', text: '你好,我们开始吧' }] } } }));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].parts[0]).toEqual({ type: 'text', text: '你好,我们开始吧' });
    expect(s.messages[0].status).toBe('ready');
  });

  // 真实事件形状(线上回放验证):并行 tool_use 时同一 API 消息按 content block 拆成多条
  // AssistantMessage 事件,message_id 相同、uuid 各不相同;不能按 message_id 互相覆盖
  test('同 message_id 分块下发的并行 tool_use 不互相覆盖,tool_result 各自回填', () => {
    const blockEv = (uuid: string, seq: number, block: unknown) =>
      ev({ type: 'claude.message', sequence: seq, payload: { sdk_type: 'AssistantMessage', payload: { uuid, message_id: 'mP', content: [block] } } });
    const media = (p: string) => JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: `g-${p}`, kind: 'image', status: 'ready', asset_path: p, preview_url: `http://x/${p}` }] });
    const resultEv = (seq: number, toolId: string, p: string) =>
      ev({ type: 'claude.message', sequence: seq, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: toolId, content: media(p) }] } } });
    let s = S();
    s = applyKoubou(s, blockEv('u0', 30, { type: 'thinking', thinking: '并行生成三张' }));
    s = applyKoubou(s, blockEv('u1', 31, { type: 'tool_use', id: 't1', name: 'mcp__media__generate_image', input: {} }));
    s = applyKoubou(s, blockEv('u2', 32, { type: 'tool_use', id: 't2', name: 'mcp__media__generate_image', input: {} }));
    s = applyKoubou(s, blockEv('u3', 33, { type: 'tool_use', id: 't3', name: 'mcp__media__generate_image', input: {} }));
    s = applyKoubou(s, resultEv(34, 't1', 'a.png'));
    s = applyKoubou(s, resultEv(35, 't2', 'b.png'));
    s = applyKoubou(s, resultEv(36, 't3', 'c.png'));
    const tools = s.messages.flatMap((m) => m.parts).filter((p) => p.type === 'tool');
    expect(tools.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(tools.map((t) => (t as { media?: { path?: string }[] }).media?.[0]?.path)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  test('带 uuid 的首条分块消息收编流式草稿,不产生重复气泡', () => {
    let s = S();
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'mApi' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想想' } } } } }));
    // 首条分块(uuid 与草稿 id 不同)→ 收编草稿;次条 → 新气泡
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'u0', message_id: 'mApi', content: [{ type: 'thinking', thinking: '想想(完整)' }] } } }));
    expect(s.messages).toHaveLength(1);
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'u1', message_id: 'mApi', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } }));
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0].parts).toEqual([{ type: 'thinking', text: '想想(完整)' }]);
    expect(s.messages[1].parts[0]).toMatchObject({ type: 'tool', id: 't1' });
  });

  test('UserMessage 的 tool_result 回填到 tool part,media.tasks.status 解析', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm2', content: [{ type: 'tool_use', id: 'tg', name: 'check_generation_tasks', input: {} }] } } }));
    const mediaJson = JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'x.png', preview_url: 'http://x/x.png' }] });
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 4, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 'tg', content: mediaJson }] } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool')!;
    expect(tool).toMatchObject({ status: 'ready' });
    expect((tool as { media?: { path: string; previewUrl: string }[] }).media?.[0]).toMatchObject({ path: 'x.png', previewUrl: 'http://x/x.png' });
  });

  test('submit_*_generation 的 media.task_submitted(video) → tool part 带 submittedTask', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'ms', content: [{ type: 'tool_use', id: 'ts', name: 'submit_video_generation', input: {} }] } } }));
    const submittedJson = JSON.stringify({ type: 'media.task_submitted', kind: 'video', task_id: 'gtask-9', status: 'pending' });
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 4, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 'ts', content: submittedJson }] } } }));
    const part = s.messages.flatMap((m) => m.parts).find((p) => p.type === 'tool' && p.id === 'ts');
    expect(part && part.type === 'tool' && part.submittedTask).toEqual({ taskId: 'gtask-9', kind: 'video' });
  });
});

describe('交互 + 去重 + 错误', () => {
  test('approval.requested / question.requested 写入 pending', () => {
    let s = applyKoubou(S(), ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'i1', tool_name: 'Bash', input: { command: 'ls' } } }));
    expect(s.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
    s = applyKoubou(s, ev({ type: 'ask_user_question.requested', sequence: 6, payload: { interaction_id: 'i2', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'A' }], multiSelect: false }] } } }));
    expect(s.pendingInteractions['i2']).toMatchObject({ kind: 'question' });
  });

  test('ask_user_question.answered 清对应 pending(答题落库/别 tab 答过/回放),不产气泡', () => {
    let s = applyKoubou(S(), ev({ type: 'ask_user_question.requested', sequence: 6, payload: { interaction_id: 'i2', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] } } }));
    const msgCount = s.messages.length;
    s = applyKoubou(s, ev({ type: 'ask_user_question.answered', sequence: 7, payload: { interaction_id: 'i2', answers: { 'Q?': 'A' }, resolved: true } }));
    expect(s.pendingInteractions['i2']).toBeUndefined();
    expect(s.messages).toHaveLength(msgCount);
    expect(s.lastSequence).toBe(7);
  });

  test('ask_user_question.answered 无命中 pending → 原样返回(容错)', () => {
    const s0 = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    const s1 = applyKoubou(s0, ev({ type: 'ask_user_question.answered', sequence: 2, payload: { interaction_id: 'ghost', answers: {} } }));
    expect(s1.pendingInteractions).toEqual({});
    expect(s1.lastSequence).toBe(2);
  });

  test('同 sequence 重复事件被忽略(幂等)', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'i1', tool_name: 'Bash', input: {} } }));
    const before = s.pendingInteractions;
    s = applyKoubou(s, ev({ type: 'tool.approval.requested', sequence: 5, payload: { interaction_id: 'iX', tool_name: 'Other', input: {} } }));
    expect(s.pendingInteractions).toBe(before); // sequence=5 已见,整事件忽略
  });

  test('error stale 清对应弹窗(命中未决交互 → 仅清弹窗,不冒泡进对话)', () => {
    let s = applyKoubou(S(), ev({ type: 'tool.approval.requested', sequence: 7, payload: { interaction_id: 'i1', tool_name: 'Bash', input: {} } }));
    s = applyKoubou(s, ev({ type: 'error', sequence: 8, payload: { message: 'stale tool approval', interaction_id: 'i1' } }));
    expect(s.pendingInteractions['i1']).toBeUndefined();
    expect(s.messages).toHaveLength(0); // stale 属 housekeeping,不作为 agent 报错气泡
  });

  // 报错落固定槽而非对话流(设计稿 2026-08-27):它是输入框正上方的一格瞬态 UI
  test('error 事件(无匹配弹窗)落进固定槽,不进对话流', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { message: 'agent crashed' } }));
    expect(s.messages).toHaveLength(0);
    expect(s.agentError).toEqual({ text: 'agent crashed', detail: 'agent crashed' });
  });

  test('error 事件无 message → 回落默认文案', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: {} }));
    expect(s.agentError).toEqual({ text: 'agent error' });
  });

  test('error 命中已知 message → 固定槽带本地 code + 回退原文', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { message: 'run already active' } }));
    expect(s.agentError).toMatchObject({ code: 'RUN_ALREADY_ACTIVE', text: 'run already active' });
  });
  test('error 动态异常(带 type) → 通用 AGENT_RUN_ERROR 码', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { type: 'ValueError', message: 'boom' } }));
    expect(s.agentError).toMatchObject({ code: 'AGENT_RUN_ERROR', text: 'boom' });
  });
});

describe('补充覆盖', () => {
  test('run.interrupted → idle 并清 activeRunId', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', sequence: 2, payload: { run_id: 'r1' } }));
    expect(s.runStatus).toBe('idle');
    expect(s.activeRunId).toBeNull();
  });
  test('run.finished 将 generating 助手气泡落定为 ready,并清 activeRunId', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    expect(s.messages[0].status).toBe('generating');
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 5, payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.messages[0].status).toBe('ready');
    expect(s.activeRunId).toBeNull();
  });
  test('SystemMessage 记录 model', () => {
    // 真机形状:模型名在 init 帧的 data 里(2026-08-24 实测),不在 payload 顶层
    const s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'SystemMessage', payload: { subtype: 'init', data: { model: 'claude-opus-4-8' } } } }));
    expect(s.model).toBe('claude-opus-4-8');
  });
  test('StreamEvent thinking_delta 累积到 thinking part', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想想' } } } } }));
    expect(s.messages[0].parts[0]).toEqual({ type: 'thinking', text: '先想想' });
  });
  test('落定消息不含 thinking 块时,保留流式累积的思考(折叠头不消失)', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想想' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 1, content_block: { type: 'text' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '好的' } } } } }));
    // 上游最终消息常省略 thinking,仅回传 text
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'text', text: '好的' }] } } }));
    expect(s.messages[0].parts).toEqual([
      { type: 'thinking', text: '先想想' },
      { type: 'text', text: '好的' },
    ]);
  });
  test('落定消息自带 thinking 块时,以落定内容为准(不重复)', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'message_start', message: { id: 'm1' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: null, payload: { sdk_type: 'StreamEvent', payload: { event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先想想' } } } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'thinking', thinking: '先想想(完整)' }, { type: 'text', text: '好的' }] } } }));
    expect(s.messages[0].parts).toEqual([
      { type: 'thinking', text: '先想想(完整)' },
      { type: 'text', text: '好的' },
    ]);
  });
  test('tool_result is_error:标记 error 并保留错误文本(内联进卡片)', () => {
    let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm2', content: [{ type: 'tool_use', id: 'tb', name: 'Bash', input: {} }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 'tb', content: 'boom', is_error: true }] } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool')!;
    expect(tool).toMatchObject({ status: 'error', result: 'boom' });
  });

  test('UserMessage.tool_use_result 解析为 diff 并按 filePath 挂到对应 tool part', () => {
    let s = applyKoubou(createInitialKoubouState(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'tool_use', id: 'te', name: 'Edit', input: { file_path: 'src/a.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: 'te', content: 'The file has been updated.' }],
      tool_use_result: { type: 'update', filePath: 'src/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' const x=1;', '-foo();', '+bar();', '+baz();'] }] },
    } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>;
    expect(tool.diff).toMatchObject({ type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1 });
    expect(tool.diff!.hunks[0].lines[1]).toEqual({ kind: 'del', text: 'foo();' });
  });

  test('create 无 patch 有 content → tool part 拿到全新增 diff', () => {
    let s = applyKoubou(createInitialKoubouState(), ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'm1', content: [{ type: 'tool_use', id: 'tw', name: 'Write', input: { file_path: 'src/new.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: 'tw', content: 'File created.' }],
      tool_use_result: { type: 'create', filePath: 'src/new.ts', content: 'line1\nline2\nline3' },
    } } }));
    const tool = s.messages[0].parts.find((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>;
    expect(tool.diff).toMatchObject({ type: 'create', additions: 3, deletions: 0 });
  });

  test('同一条消息多 tool_result + 单 diff → 仅挂到 filePath 命中的 part', () => {
    let s = createInitialKoubouState();
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 1, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'a1', message_id: 'mP', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'src/a.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 2, payload: { sdk_type: 'AssistantMessage', payload: { uuid: 'a2', message_id: 'mP', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/b.ts' } }] } } }));
    s = applyKoubou(s, ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'UserMessage', payload: {
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'updated' },
        { type: 'tool_result', tool_use_id: 't2', content: 'file body' },
      ],
      tool_use_result: { type: 'update', filePath: 'src/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] },
    } } }));
    const tools = s.messages.flatMap((m) => m.parts).filter((p) => p.type === 'tool') as Extract<Part, { type: 'tool' }>[];
    expect(tools.find((t) => t.id === 't1')!.diff).toBeTruthy();
    expect(tools.find((t) => t.id === 't2')!.diff).toBeUndefined();
  });
});

describe('历史重建 image 块 → media part', () => {
  const seq = (e: ServerEvent, n: number): ServerEvent => ({ ...e, sequence: n });

  test('seedHistory: 用户消息含 image url 块 → media part', () => {
    const ev = umsg([{ type: 'text', text: '看这张' }, { type: 'image', source: { type: 'url', url: 'http://x/a.png' } }], 'evt_img');
    const s = seedHistory(S(), { events: [seq(ev, 10)], has_more: false, latest_sequence: 10 });
    const msg = s.messages.find((m) => m.role === 'user');
    expect(msg?.parts).toContainEqual({ type: 'media', kind: 'image', url: 'http://x/a.png' });
    expect(msg?.parts).toContainEqual({ type: 'text', text: '看这张' });
  });

  test('seedHistory: image base64 块 → media part(data url)', () => {
    const ev = umsg([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], 'evt_b64');
    const s = seedHistory(S(), { events: [seq(ev, 11)], has_more: false, latest_sequence: 11 });
    const msg = s.messages.find((m) => m.role === 'user');
    expect(msg?.parts).toContainEqual({ type: 'media', kind: 'image', url: 'data:image/png;base64,AAAA' });
  });
});

describe('parseFileDiff', () => {
  test('update:structuredPatch 归一为 DiffLine,丢弃 \\ 无换行标记行,统计仅计 +/-', () => {
    const d = parseFileDiff({
      type: 'update', filePath: 'src/a.ts',
      structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' const x=1;', '-foo();', '+bar();', '+baz();', '\\ No newline at end of file'] }],
    });
    expect(d).toMatchObject({ type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1 });
    expect(d!.hunks[0].lines).toEqual([
      { kind: 'context', text: 'const x=1;' },
      { kind: 'del', text: 'foo();' },
      { kind: 'add', text: 'bar();' },
      { kind: 'add', text: 'baz();' },
    ]);
  });

  test('create:无 patch 有 content → 整文件按全新增,deletions=0', () => {
    const d = parseFileDiff({ type: 'create', filePath: 'src/new.ts', content: 'line1\nline2\nline3' });
    expect(d).toMatchObject({ type: 'create', additions: 3, deletions: 0 });
    expect(d!.hunks[0].lines.map((l) => l.kind)).toEqual(['add', 'add', 'add']);
    expect(d!.hunks[0].lines.map((l) => l.text)).toEqual(['line1', 'line2', 'line3']);
  });

  test('content 末尾换行不产生空尾行', () => {
    const d = parseFileDiff({ type: 'create', filePath: 'a.ts', content: 'a\nb\n' });
    expect(d!.additions).toBe(2);
  });

  test('userModified 透传', () => {
    const d = parseFileDiff({ type: 'update', filePath: 'a.ts', userModified: true, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] });
    expect(d!.userModified).toBe(true);
  });

  test('缺 filePath / 空 patch 且无 content / undefined → null', () => {
    expect(parseFileDiff({ structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a'] }] })).toBeNull();
    expect(parseFileDiff({ filePath: 'a.ts', structuredPatch: [] })).toBeNull();
    expect(parseFileDiff({ filePath: 'a.ts' })).toBeNull();
    expect(parseFileDiff(undefined)).toBeNull();
  });
});


// REST 跟跑复开(spec 2026-07-23 run-rest-tracking):后端 run 事件按连接投递,
// 新连接 ready.active_run 恒 null 会把本地 running 轮误闭为 succeeded;
// REST /sessions.active_run_id 才是权威,据其复开误闭轮
describe('reopenRun REST 权威复开', () => {
  // 构造「刷新后被 ready 误闭」的状态:run.started 开轮 → ready(active_run=null) 闭轮
  const misClosed = () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, created_at: '2026-07-23T00:00:00.000Z', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, pending_interactions: [], visible_state: { messages: [] } } }));
    expect(s.turns[0]).toMatchObject({ status: 'succeeded', finishedAt: null });
    expect(s.runStatus).toBe('idle');
    return s;
  };

  test('误闭轮(succeeded+finishedAt=null,runId 匹配)复开为 running,同步 runStatus/activeRunId', () => {
    const s = reopenRun(misClosed(), 'r1');
    expect(s.turns[0]).toMatchObject({ runId: 'r1', status: 'running', finishedAt: null, startedAt: '2026-07-23T00:00:00.000Z' });
    expect(s.runStatus).toBe('running');
    expect(s.activeRunId).toBe('r1');
  });

  test('无匹配轮(run.started 在种子窗口外)→ 末尾补建 running 轮,startedAt 为 null 不谎报时长', () => {
    const s = reopenRun(S(), 'r9');
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ runId: 'r9', status: 'running', startedAt: null, finishedAt: null });
    expect(s.runStatus).toBe('running');
    expect(s.activeRunId).toBe('r9');
  });

  test('已落 finishedAt 的轮不复开(真终态不可逆),状态原样返回', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 2, created_at: '2026-07-23T00:00:12.000Z', payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(reopenRun(s, 'r1')).toBe(s);
  });

  // updated_at 兜底(spec 2026-07-31 refresh-run-start-backfill):种子窗口外的 run.started 拿不到时,
  // 由 REST /sessions.updated_at(活跃 run 期即该 run 的开始时刻)补起始时刻
  test('补建轮:带 startedAt 兜底 → 用它当起始时刻(不再是 null)', () => {
    const s = reopenRun(S(), 'r9', '2026-07-31T11:16:49.796923Z');
    expect(s.turns[0]).toMatchObject({ runId: 'r9', status: 'running', startedAt: '2026-07-31T11:16:49.796923Z' });
  });

  test('复开轮缺 startedAt(污染的旧快照)→ 用兜底补上', () => {
    const polluted = { ...S(), turns: [{ runId: 'r1', model: 'claude-opus-5', startedAt: null, finishedAt: null, status: 'running' as const, lastMessageId: null }], runStatus: 'running' as const, activeRunId: 'r1' };
    const s = reopenRun(polluted, 'r1', '2026-07-31T11:16:49.796923Z');
    expect(s.turns[0].startedAt).toBe('2026-07-31T11:16:49.796923Z');
  });

  test('复开轮已有 startedAt(live 值更准)→ 兜底不覆盖', () => {
    const s = reopenRun(misClosed(), 'r1', '2026-07-31T11:16:49.796923Z');
    expect(s.turns[0].startedAt).toBe('2026-07-23T00:00:00.000Z');
  });

  test('兜底为 null(字段缺失/无法解析)→ 维持 startedAt=null,不谎报时长', () => {
    const s = reopenRun(S(), 'r9', null);
    expect(s.turns[0].startedAt).toBeNull();
  });

  test('目标轮本就 running → 幂等,仅同步 runStatus/activeRunId', () => {
    const running = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    const s = reopenRun(running, 'r1');
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0].status).toBe('running');
    expect(s.runStatus).toBe('running');
    expect(s.activeRunId).toBe('r1');
    // 重复调用状态收敛(不新增轮)
    expect(reopenRun(s, 'r1')).toBe(s);
  });
});

describe('turns 轮次元数据', () => {
  test('run.started 建 running 轮,取 startedAt 与当前会话 model', () => {
    let s = applyKoubou(S(), cmsg('SystemMessage', { subtype: 'init', data: { model: 'claude-opus-4-8' } }));
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }));
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({
      runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z',
      finishedAt: null, status: 'running', lastMessageId: null,
    });
  });

  test('pendingSendAt 在场时 run.started 沿用发送时刻做 startedAt(乐观计时不重置,续上初始时长)', () => {
    const pending = { ...S(), pendingSendAt: '2026-06-18T00:00:00.000Z' };
    const s = applyKoubou(pending, ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:05.000Z', payload: { run_id: 'r1' } }));
    expect(s.turns[0].startedAt).toBe('2026-06-18T00:00:00.000Z');
    expect(s.pendingSendAt).toBeNull();
  });

  test('pendingModel 在场时 run.started 沿用发送时刻的 model(不被空的会话 model 冲掉),并一并清除', () => {
    const pending = { ...S(), pendingSendAt: '2026-06-18T00:00:00.000Z', pendingModel: 'claude-opus-4-8' };
    const s = applyKoubou(pending, ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    expect(s.turns[0].model).toBe('claude-opus-4-8');
    expect(s.pendingModel).toBeNull();
  });

  test('AssistantMessage 回填 lastMessageId 与 per-turn model', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, cmsg('AssistantMessage', { uuid: 'a1', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '好的' }] }));
    expect(s.turns[0].lastMessageId).toBe('a1');
    expect(s.turns[0].model).toBe('claude-sonnet-4-6');
  });

  test('run.finished succeeded → 闭轮 succeeded + finishedAt', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 2, created_at: '2026-06-18T00:00:12.000Z', payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.turns[0]).toMatchObject({ status: 'succeeded', finishedAt: '2026-06-18T00:00:12.000Z' });
    expect(s.runStatus).toBe('idle');
  });

  test('run.finished failed → status error,runStatus error', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 2, payload: { status: 'failed' } }));
    expect(s.turns[0].status).toBe('error');
    expect(s.runStatus).toBe('error');
  });

  test('run.interrupted → status interrupted,runStatus idle', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', sequence: 2, payload: {} }));
    expect(s.turns[0].status).toBe('interrupted');
    expect(s.runStatus).toBe('idle');
  });

  test('run.interrupted → 追加本地化助手回复,并把该轮 footer 锚到它', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'text', text: '好的,我来生成' }] }));
    s = applyKoubou(s, ev({ type: 'run.interrupted', sequence: 2, payload: {} }));
    const last = s.messages[s.messages.length - 1];
    expect(last).toMatchObject({ role: 'assistant', status: 'ready', parts: [{ type: 'notice', code: 'chat.interruptedReply' }] });
    // footer 锚到 notice(而非之前的 a1),让「Stopped after」贴在回复下方
    expect(s.turns[0].lastMessageId).toBe(last.id);
    expect(s.turns[0].status).toBe('interrupted');
  });

  test('冷启动重建:[Request interrupted…] 哨兵不成泡,run.interrupted 生成 notice 回复', () => {
    const s = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: {
        session_id: 's1',
        visible_state: { messages: [
          umsg('做个跳跃游戏', 'evt_u1'),
          ev({ type: 'run.started', payload: { run_id: 'r1' } }),
          cmsg('AssistantMessage', { uuid: 'a1', content: [
            { type: 'text', text: '好的' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          ] }),
          // SDK 打断哨兵(工具执行中打断):不应成泡
          cmsg('UserMessage', { uuid: 'u2', content: '[Request interrupted by user for tool use]' }),
          ev({ type: 'run.interrupted', payload: { run_id: 'r1' } }),
        ] },
      },
    }));
    // 无哨兵 user 气泡
    expect(s.messages.some((m) => m.role === 'user' && m.parts.some((p) => p.type === 'text' && p.text.includes('Request interrupted')))).toBe(false);
    // 末尾是本地化助手 notice 回复,且该轮 footer 锚到它
    const last = s.messages[s.messages.length - 1];
    expect(last).toMatchObject({ role: 'assistant', parts: [{ type: 'notice', code: 'chat.interruptedReply' }] });
    expect(s.turns[0]).toMatchObject({ status: 'interrupted', lastMessageId: last.id });
  });

  test('sequence 重放不重复建轮', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 1, payload: { run_id: 'r1' } }));
    expect(s.turns).toHaveLength(1);
  });
});

describe('非 error 失败信号本地化报错', () => {
  test('credit.insufficient → 不产气泡(改由模态提示,见设计稿 2026-07-05)', () => {
    const s = applyKoubou(S(), ev({ type: 'credit.insufficient', sequence: 8, payload: { reason: 'mid_run' } }));
    expect(s.messages).toHaveLength(0);
  });
  test('build.failed → 本地化构建失败气泡', () => {
    const s = applyKoubou(S(), ev({ type: 'build.failed', sequence: 8, payload: { stage: 'validate' } }));
    expect(s.agentError).toMatchObject({ code: 'BUILD_FAILED' });
  });
  test('run.finished 携带 OrphanedRun → 闭轮 + RUN_ABANDONED 气泡', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 7, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 8, run_id: 'r1', payload: { status: 'failed', error: { type: 'OrphanedRun', message: 'run abandoned by service restart' } } }));
    expect(s.runStatus).toBe('error');
    expect(s.agentError).toMatchObject({ code: 'RUN_ABANDONED' });
  });
  test('run.finished 内嵌非孤儿 error → AGENT_RUN_ERROR 气泡', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 7, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 8, run_id: 'r1', payload: { status: 'failed', error: { type: 'RateLimited', message: 'too many requests' } } }));
    expect(s.agentError).toMatchObject({ code: 'AGENT_RUN_ERROR' });
  });
  // 2026-08-25 行为变更:后端 live 的 run.finished **从不带 error**(actor.py:1631 与
  // run_lifecycle.py:81 的 payload 都只有 {run_id,status};孤儿的 OrphanedRun 只写 runs 表与
  // trace)。原先「无 error 就什么都不做」意味着属主 Pod 死掉时,用户看到回合悄无声息停住 ——
  // 无气泡、无重试、无手动入口。改为补一条失败气泡;本轮已由 error 事件报过错的则不重复推
  test('run.finished 普通失败(无 error 对象) → 补一条失败气泡,不再静默', () => {
    let s = applyKoubou(S(), ev({ type: 'run.started', sequence: 7, payload: { run_id: 'r1' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', sequence: 8, run_id: 'r1', payload: { status: 'failed' } }));
    expect(s.agentError).not.toBeNull();
    expect(s.messages).toHaveLength(0);
  });
});

describe('历史重建 turns', () => {
  test('从事件日志重建多轮 + 热切换模型 + 末尾未闭合 running 轮', () => {
    const next = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', visible_state: { messages: [
        cmsg('SystemMessage', { subtype: 'init', data: { model: 'claude-opus-4-8' } }),
        ev({ type: 'run.started', sequence: 1, created_at: '2026-06-18T00:00:00.000Z', payload: { run_id: 'r1' } }),
        umsg('做个跳跃游戏', 'evt_u1'),
        cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'text', text: '好的' }] }),
        ev({ type: 'run.finished', sequence: 2, created_at: '2026-06-18T00:00:12.000Z', payload: { run_id: 'r1', status: 'succeeded' } }),
        ev({ type: 'run.started', sequence: 3, created_at: '2026-06-18T00:01:00.000Z', payload: { run_id: 'r2' } }),
        cmsg('AssistantMessage', { uuid: 'a2', model: 'claude-sonnet-4-6', content: [{ type: 'text', text: '继续' }] }),
      ] } },
    }));
    expect(next.turns).toHaveLength(2);
    expect(next.turns[0]).toMatchObject({ runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z', finishedAt: '2026-06-18T00:00:12.000Z', status: 'succeeded', lastMessageId: 'a1' });
    expect(next.turns[1]).toMatchObject({ runId: 'r2', model: 'claude-sonnet-4-6', status: 'running', finishedAt: null, lastMessageId: 'a2' });
    expect(next.historyTurnCount).toBe(2);
  });

  test('seedHistory 写入 turns 与 historyTurnCount', () => {
    const s = seedHistory(S(), { events: [
      ev({ type: 'run.started', sequence: 5, created_at: 'A', payload: { run_id: 'r5' } }),
      cmsg('AssistantMessage', { uuid: 'm5', content: [{ type: 'text', text: 'x' }] }),
      ev({ type: 'run.finished', sequence: 6, created_at: 'B', payload: { status: 'succeeded' } }),
    ], has_more: true, latest_sequence: 6 });
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ runId: 'r5', status: 'succeeded', lastMessageId: 'm5' });
    expect(s.historyTurnCount).toBe(1);
  });

  test('seedHistory 最新窗口缺少 run.started 时保留快照中的完整轮次脚注', () => {
    const base: KoubouState = {
      ...S(),
      messages: [{ id: 'm-final', role: 'assistant', parts: [{ type: 'text', text: '完成' }], status: 'ready' }],
      turns: [{
        runId: 'r-long',
        model: 'gpt-5-6',
        startedAt: '2026-07-24T01:00:00.000Z',
        finishedAt: '2026-07-24T01:10:51.000Z',
        status: 'succeeded',
        lastMessageId: 'm-final',
      }],
      historyTurnCount: 1,
    };
    const s = seedHistory(base, { events: [
      cmsg('AssistantMessage', { uuid: 'm-final', model: 'gpt-5-6', content: [{ type: 'text', text: '完成' }] }),
      ev({
        type: 'run.finished',
        run_id: 'r-long',
        sequence: 100,
        created_at: '2026-07-24T01:10:51.000Z',
        payload: { run_id: 'r-long', status: 'succeeded' },
      }),
    ], has_more: true, latest_sequence: 100 });

    expect(s.turns).toEqual(base.turns);
    expect(s.historyTurnCount).toBe(1);
  });

  test('seedHistory 完整窗口与快照包含同一 runId 时不重复建轮', () => {
    const base: KoubouState = {
      ...S(),
      turns: [{
        runId: 'r5',
        model: 'old-model',
        startedAt: 'old-start',
        finishedAt: 'old-finish',
        status: 'succeeded',
        lastMessageId: 'old-message',
      }],
    };
    const assistant = {
      ...cmsg('AssistantMessage', { uuid: 'm5', model: 'gpt-5-6', content: [{ type: 'text', text: '完成' }] }),
      run_id: 'r5',
    };
    const s = seedHistory(base, { events: [
      ev({ type: 'run.started', run_id: 'r5', sequence: 5, created_at: 'A', payload: { run_id: 'r5' } }),
      assistant,
      ev({ type: 'run.finished', run_id: 'r5', sequence: 6, created_at: 'B', payload: { run_id: 'r5', status: 'succeeded' } }),
    ], has_more: true, latest_sequence: 6 });

    expect(s.turns).toEqual([{
      runId: 'r5',
      model: 'gpt-5-6',
      startedAt: 'A',
      finishedAt: 'B',
      status: 'succeeded',
      lastMessageId: 'm5',
    }]);
    expect(s.historyTurnCount).toBe(1);
  });

  test('seedHistory 重放旧轮消息时不改写快照中的较新 running 轮', () => {
    const base: KoubouState = {
      ...S(),
      turns: [
        { runId: 'r-old', model: 'old', startedAt: 'A', finishedAt: 'B', status: 'succeeded', lastMessageId: 'm-old' },
        { runId: 'r-live', model: 'new', startedAt: 'C', finishedAt: null, status: 'running', lastMessageId: null },
      ],
    };
    const s = seedHistory(base, { events: [
      cmsg('AssistantMessage', { uuid: 'm-old', model: 'old', content: [{ type: 'text', text: '旧回复' }] }),
    ], has_more: true, latest_sequence: 100 });

    expect(s.turns[1]).toMatchObject({
      runId: 'r-live',
      model: 'new',
      status: 'running',
      lastMessageId: null,
    });
  });

  test('prependHistory 按 historyTurnCount 保留 live 尾部 turns', () => {
    let s = seedHistory(S(), { events: [
      ev({ type: 'run.started', sequence: 10, created_at: 'A', payload: { run_id: 'r10' } }),
      cmsg('AssistantMessage', { uuid: 'm10', content: [{ type: 'text', text: 'x' }] }),
      ev({ type: 'run.finished', sequence: 11, created_at: 'B', payload: { status: 'succeeded' } }),
    ], has_more: true, latest_sequence: 11 });
    // live 再来一轮
    s = applyKoubou(s, ev({ type: 'run.started', sequence: 12, created_at: 'C', payload: { run_id: 'r12' } }));
    s = applyKoubou(s, cmsg('AssistantMessage', { uuid: 'm12', content: [{ type: 'text', text: 'y' }] }));
    expect(s.turns).toHaveLength(2);
    expect(s.historyTurnCount).toBe(1);
    // 前插更早一页
    s = prependHistory(s, { events: [
      ev({ type: 'run.started', sequence: 1, created_at: 'X', payload: { run_id: 'r1' } }),
      cmsg('AssistantMessage', { uuid: 'm1', content: [{ type: 'text', text: 'old' }] }),
      ev({ type: 'run.finished', sequence: 2, created_at: 'Y', payload: { status: 'succeeded' } }),
    ], has_more: false, latest_sequence: 11 });
    expect(s.turns.map((t) => t.runId)).toEqual(['r1', 'r10', 'r12']);
  });
});

describe('任务清单(tasks 切片)', () => {
  // 助手消息带 TaskCreate tool_use → UserMessage 带对应 tool_result + tool_use_result
  let seq = 1;
  const assistantWithTool = (uuid: string, toolId: string, name: string, input: unknown): ServerEvent => ({
    type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
    payload: { sdk_type: 'AssistantMessage', payload: { uuid, content: [{ type: 'tool_use', id: toolId, name, input }] } },
  } as unknown as ServerEvent);
  const userResult = (toolId: string, tur: unknown): ServerEvent => ({
    type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
    payload: { sdk_type: 'UserMessage', payload: {
      content: [{ type: 'tool_result', tool_use_id: toolId, content: 'ok' }],
      tool_use_result: tur,
    } },
  } as unknown as ServerEvent);
  beforeEach(() => { seq = 1; });

  const init = () => createInitialKoubouState();

  test('TaskCreate 结果建项(pending),文案从落定 input 补齐', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: '建骨架', description: 'D', activeForm: '正在建骨架' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: '建骨架' } }));
    expect(s.tasks).toEqual([{ id: '1', subject: '建骨架', description: 'D', activeForm: '正在建骨架', status: 'pending' }]);
  });

  test('TaskUpdate 按 statusChange.to 推状态机;deleted 移除;未知 taskId 忽略不抛', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: 'a' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'in_progress' }));
    s = applyKoubou(s, userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } }));
    expect(s.tasks[0].status).toBe('in_progress');
    // 未知 taskId → 原样
    s = applyKoubou(s, assistantWithTool('u3', 't3', 'TaskUpdate', { taskId: '99' }));
    s = applyKoubou(s, userResult('t3', { success: true, taskId: '99', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }));
    expect(s.tasks).toHaveLength(1);
    // deleted → 移除
    s = applyKoubou(s, assistantWithTool('u4', 't4', 'TaskUpdate', { taskId: '1', status: 'deleted' }));
    s = applyKoubou(s, userResult('t4', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'in_progress', to: 'deleted' } }));
    expect(s.tasks).toHaveLength(0);
  });

  test('TaskUpdate 的 updatedFields 文案改写取 input 新值', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: '旧标题' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: '旧标题' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskUpdate', { task_id: '1', subject: '新标题', active_form: '改标题中' }));
    s = applyKoubou(s, userResult('t2', { success: true, taskId: '1', updatedFields: ['subject', 'activeForm'] }));
    expect(s.tasks[0].subject).toBe('新标题');
    expect(s.tasks[0].activeForm).toBe('改标题中');
  });

  test('TaskList 快照整单校正,保留已知项的 activeForm', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a', activeForm: '做 a' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: 'a' } }));
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskList', {}));
    s = applyKoubou(s, userResult('t2', { tasks: [
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ] }));
    expect(s.tasks).toEqual([
      { id: '1', subject: 'a', activeForm: '做 a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
  });

  test('is_error 的任务工具结果不动清单', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a' }));
    s = applyKoubou(s, {
      type: 'claude.message', project_id: 'p', session_id: 's', sequence: seq++,
      payload: { sdk_type: 'UserMessage', payload: {
        content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }],
        tool_use_result: { task: { id: '1', subject: 'a' } },
      } },
    } as unknown as ServerEvent);
    expect(s.tasks).toHaveLength(0);
  });

  test('run.started 清空上一轮清单(每轮任务独立)', () => {
    let s = init();
    s = applyKoubou(s, assistantWithTool('u1', 't1', 'TaskCreate', { subject: '上一轮任务' }));
    s = applyKoubou(s, userResult('t1', { task: { id: '1', subject: '上一轮任务' } }));
    expect(s.tasks).toHaveLength(1);
    s = applyKoubou(s, { type: 'run.started', project_id: 'p', session_id: 's', sequence: seq++, payload: { run_id: 'r2' } } as unknown as ServerEvent);
    expect(s.tasks).toHaveLength(0);
    // 新一轮的 TaskCreate 从空清单开始
    s = applyKoubou(s, assistantWithTool('u2', 't2', 'TaskCreate', { subject: '本轮任务' }));
    s = applyKoubou(s, userResult('t2', { task: { id: '2', subject: '本轮任务' } }));
    expect(s.tasks).toEqual([{ id: '2', subject: '本轮任务', status: 'pending' }]);
  });

  test('rebuild 跨轮事件日志只留最后一轮 tasks', () => {
    const runStarted = (rid: string): ServerEvent =>
      ({ type: 'run.started', project_id: 'p', session_id: 's', sequence: seq++, payload: { run_id: rid } } as unknown as ServerEvent);
    const events: ServerEvent[] = [
      runStarted('r1'),
      assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a' }),
      userResult('t1', { task: { id: '1', subject: 'a' } }),
      runStarted('r2'),
      assistantWithTool('u2', 't2', 'TaskCreate', { subject: 'b' }),
      userResult('t2', { task: { id: '2', subject: 'b' } }),
    ];
    const { tasks } = rebuild(events);
    expect(tasks).toEqual([{ id: '2', subject: 'b', status: 'pending' }]);
  });

  test('rebuild 从事件日志重建 tasks(冷启动路径)', () => {
    const events: ServerEvent[] = [
      assistantWithTool('u1', 't1', 'TaskCreate', { subject: 'a', activeForm: '做 a' }),
      userResult('t1', { task: { id: '1', subject: 'a' } }),
      assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'in_progress' }),
      userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' } }),
    ];
    const { tasks } = rebuild(events);
    expect(tasks).toEqual([{ id: '1', subject: 'a', activeForm: '做 a', status: 'in_progress' }]);
  });

  test('rebuild 传 initialTasks 时在其上叠加(任务效果幂等重放)', () => {
    const events: ServerEvent[] = [
      assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }),
    ];
    const { tasks } = rebuild(events, [{ id: '1', subject: 'a', status: 'pending' }, { id: '2', subject: 'b', status: 'pending' }]);
    expect(tasks).toEqual([{ id: '1', subject: 'a', status: 'completed' }, { id: '2', subject: 'b', status: 'pending' }]);
  });

  test('空事件页保留现有 tasks', () => {
    const { tasks } = rebuild([]);
    expect(tasks).toEqual([]);
    const s: KoubouState = { ...createInitialKoubouState(), tasks: [{ id: '1', subject: 'a', status: 'pending' }] };
    const next = seedHistory(s, { events: [], has_more: false, latest_sequence: 0 });
    expect(next.tasks).toEqual(s.tasks); // 页内无事件 → 保留既有清单
  });

  test('seedHistory:窗口外 create 的 TaskUpdate 不清空快照恢复的清单,而是在其上生效', () => {
    const s: KoubouState = { ...createInitialKoubouState(), tasks: [{ id: '1', subject: 'a', status: 'pending' }] };
    // 该页只含对 '1' 的 TaskUpdate,对应的 TaskCreate 在窗口外(未包含在本页事件里)
    const page = { events: [
      assistantWithTool('u2', 't2', 'TaskUpdate', { taskId: '1', status: 'completed' }),
      userResult('t2', { success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'completed' } }),
    ], has_more: false, latest_sequence: 2 };
    const next = seedHistory(s, page);
    expect(next.tasks).toEqual([{ id: '1', subject: 'a', status: 'completed' }]); // 而不是被清空
  });

  test('prependHistory 不用旧页覆盖 tasks(前插的都是更早事件)', () => {
    const s: KoubouState = { ...createInitialKoubouState(), tasks: [{ id: '9', subject: '最新', status: 'completed' }] };
    const page = { events: [
      assistantWithTool('u1', 't1', 'TaskCreate', { subject: '旧' }),
      userResult('t1', { task: { id: '1', subject: '旧' } }),
    ], has_more: false, latest_sequence: 2 };
    const next = prependHistory({ ...s, historyEvents: [], historyMsgCount: 0, historyTurnCount: 0 }, page);
    expect(next.tasks).toEqual(s.tasks);
  });
});

describe('历史重建 UserMessage 元内容不成泡(Meegle 13601473)', () => {
  // 契约:用户文本只在 user.message 信封;claude.message/UserMessage 是后端注入的
  // 元内容(skill 注入 / 命令 stdout / system-reminder)或 tool_result,live 路径从不成泡,重建须对齐
  test('纯文本 UserMessage(skill 注入 / local-command-stdout)不成泡', () => {
    const { messages } = rebuild([
      umsg('画一张机甲图', 'evt_u1'),
      cmsg('UserMessage', { uuid: 'meta1', content: '<local-command-stdout>Set model to gpt-5.5</local-command-stdout>' }),
      cmsg('UserMessage', { uuid: 'meta2', content: [{ type: 'text', text: 'Base directory for this skill: /opt/agent_plugins/game-kit\n# game-kit\nThis skill is a router...' }] }),
      cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'text', text: '好的' }] }),
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].id).toBe('evt_u1');
  });

  test('混合 text + tool_result 的 UserMessage:折叠 tool_result,text 元内容丢弃(与 live 对齐)', () => {
    const { messages } = rebuild([
      cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] }),
      cmsg('UserMessage', { uuid: 'u1', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
        { type: 'text', text: '<system-reminder>注入的提醒</system-reminder>' },
      ] }),
    ]);
    expect(messages).toHaveLength(1);
    const tool = messages[0].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't1', result: 'ok', status: 'ready' });
  });
});

describe('applyUserMessage(回放专用 user.message 成泡)', () => {
  const um = (seq: number, content: unknown, id = `evt_${seq}`): ServerEvent =>
    ({ type: 'user.message', project_id: '7', session_id: 's1', event_id: id, sequence: seq, payload: { message: { role: 'user', content } } } as unknown as ServerEvent);

  test('文本内容成用户气泡,并登记 sequence/lastSequence(回归:回放丢用户消息)', () => {
    const s = createInitialKoubouState();
    const next = applyUserMessage(s, um(3, '做个跳跃游戏'));
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ role: 'user', status: 'ready' });
    expect(next.messages[0].parts[0]).toMatchObject({ type: 'text', text: '做个跳跃游戏' });
    expect(next.seenSequences).toContain(3);
    expect(next.lastSequence).toBe(3);
  });

  test('同 sequence 重复灌入去重(与 applyKoubou 口径一致)', () => {
    const s = createInitialKoubouState();
    const once = applyUserMessage(s, um(3, 'hi'));
    const twice = applyUserMessage(once, um(3, 'hi'));
    expect(twice.messages).toHaveLength(1);
  });

  test('中断哨兵串不成泡;空内容不成泡', () => {
    const s = createInitialKoubouState();
    const marker = applyUserMessage(s, um(1, '[Request interrupted by user]'));
    expect(marker.messages).toHaveLength(0);
    const empty = applyUserMessage(marker, um(2, ''));
    expect(empty.messages).toHaveLength(0);
    expect(empty.lastSequence).toBe(2);   // 不成泡也要推进 sequence 登记
  });
});

describe('foldResults 定向更新(D3)', () => {
  test('tool_result 只重建含目标 tool part 的消息,其余消息引用透传', () => {
    // 先建历史:用户气泡 + 两条 assistant(第二条含 tool_use t9)
    const seeded = applyKoubou(S(), ev({
      type: 'session.ready',
      payload: { session_id: 's1', visible_state: { messages: [
        umsg('做个跳跃游戏', 'evt_d3_u'),
        cmsg('AssistantMessage', { uuid: 'a_d3_1', content: [{ type: 'text', text: '先说明一下' }] }),
        cmsg('AssistantMessage', { uuid: 'a_d3_2', content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'ls' } }] }),
      ] } },
    }));
    const before = seeded.messages;
    expect(before).toHaveLength(3);
    // live tool_result 到达:折叠进 t9
    const next = applyKoubou(seeded, ev({
      type: 'claude.message',
      payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't9', content: 'ok' }] } },
    }));
    const tool = next.messages[2].parts.find((p) => p.type === 'tool');
    expect(tool).toMatchObject({ id: 't9', result: 'ok', status: 'ready' });
    // 定向更新:不含 t9 的消息不得重建(否则每个 tool_result 全量重建所有消息与 parts,徒增 GC 且击穿下游 memo)
    expect(next.messages[0]).toBe(before[0]);
    expect(next.messages[1]).toBe(before[1]);
    expect(next.messages[2]).not.toBe(before[2]);
  });
});

// —— 审批终态帧清 pending(codex 与 cc 通用;缺这条会让弹窗永挂)——
describe('tool.approval.resolved / pending_interactions.cancelled', () => {
  const withPending = (): KoubouState => applyKoubou(S(), ev({
    type: 'tool.approval.requested', sequence: 1,
    payload: { interaction_id: 'i1', tool_name: 'Bash', input: { command: 'ls' }, method: 'item/commandExecution/requestApproval' },
  }));

  test('requested 带出 method(卡片据此出对应标题)', () => {
    expect(withPending().pendingInteractions['i1']).toMatchObject({ kind: 'approval', method: 'item/commandExecution/requestApproval' });
  });

  test('resolved 按 interaction_id 幂等清 pending', () => {
    const s = applyKoubou(withPending(), ev({ type: 'tool.approval.resolved', sequence: 2, payload: { interaction_id: 'i1', approved: true } }));
    expect(s.pendingInteractions).toEqual({});
    // 重放/再次到达同一 id:幂等,pending 仍为空
    expect(applyKoubou(s, ev({ type: 'tool.approval.resolved', sequence: 3, payload: { interaction_id: 'i1' } })).pendingInteractions).toEqual({});
  });

  test('cancelled 支持 interaction_ids 批量', () => {
    const s = applyKoubou(withPending(), ev({ type: 'pending_interactions.cancelled', sequence: 2, payload: { interaction_ids: ['i1', 'nope'] } }));
    expect(s.pendingInteractions).toEqual({});
  });

  test('cancelled 不带 id → 清空全部未决(后端已不认为它们 pending)', () => {
    const s = applyKoubou(withPending(), ev({ type: 'pending_interactions.cancelled', sequence: 2, payload: {} }));
    expect(s.pendingInteractions).toEqual({});
  });

  test('未命中的 id 不清掉别的未决', () => {
    const base = withPending();
    const s = applyKoubou(base, ev({ type: 'tool.approval.resolved', sequence: 2, payload: { interaction_id: 'other' } }));
    expect(s.pendingInteractions).toEqual(base.pendingInteractions);
  });
});

// ---- 子代理(后台任务)分流与卡片 ----
// 唯一判据是 payload.parent_tool_use_id:非空即子 agent 的流量,绝不能当父回合渲染
describe('子代理分流', () => {
  let seq = 0;
  const next = (e: Partial<ServerEvent> & { type: string }) => ({ ...e, sequence: ++seq }) as Partial<ServerEvent> & { type: string };
  // 一个已开跑的回合:父回合派了一个 Agent 子代理(tool_use id = tu-1)
  const withSubagent = (): KoubouState => {
    seq = 0;
    let s = applyKoubou(S(), ev(next({ type: 'run.started', run_id: 'r1', payload: { run_id: 'r1' } })));
    s = applyKoubou(s, ev(next({ type: 'claude.message', payload: { sdk_type: 'AssistantMessage', payload: {
      uuid: 'a1', parent_tool_use_id: null, content: [
        { type: 'text', text: '好的,我派一个子代理去查。' },
        { type: 'tool_use', id: 'tu-1', name: 'Agent', input: { description: '查找落位逻辑', subagent_type: 'Explore' } },
      ],
    } } })));
    return applyKoubou(s, ev(next({ type: 'claude.message', payload: { sdk_type: 'TaskStartedMessage', payload: {
      task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1',
      task_type: 'local_agent', description: '查找落位逻辑', data: { subagent_type: 'Explore' },
    } } })));
  };

  test('父回合 tool_use id 进已知集合,start 开卡且不进消息流', () => {
    const s = withSubagent();
    expect(s.subagents.knownToolUseIds).toContain('tu-1');
    expect(s.subagents.cards).toHaveLength(1);
    expect(s.subagents.cards[0]).toMatchObject({ taskId: 't1', kind: 'agent', status: 'running', runId: 'r1' });
    expect(s.messages).toHaveLength(1);   // 只有父回合那条
  });

  test('子 agent 的 AssistantMessage 不冒充父 agent(不进 messages),只驱动活体行', () => {
    const before = withSubagent();
    const s = applyKoubou(before, ev(next({ type: 'claude.message', payload: { sdk_type: 'AssistantMessage', payload: {
      uuid: 'sub1', parent_tool_use_id: 'tu-1', content: [
        { type: 'thinking', thinking: '先看 card-layout.ts' },
        { type: 'text', text: '落位在 childPosition' },
        { type: 'tool_use', id: 'sub-tu-1', name: 'Grep', input: { pattern: 'childPosition' } },
      ],
    } } })));
    expect(s.messages).toEqual(before.messages);              // 主流一字不多
    expect(s.subagents.cards[0].lastToolName).toBe('Grep');   // 只留活体指示
  });

  test('子 agent 的 StreamEvent 不产生草稿气泡', () => {
    const before = withSubagent();
    const s = applyKoubou(before, ev({ type: 'claude.message', payload: { sdk_type: 'StreamEvent', payload: {
      parent_tool_use_id: 'tu-1', event: { type: 'message_start', message: { id: 'sub-msg' } },
    } } }));
    expect(s.messages).toEqual(before.messages);
  });

  test('子 agent 的 tool_result 不折叠进父回合的 tool part', () => {
    const before = withSubagent();
    const s = applyKoubou(before, ev(next({ type: 'claude.message', payload: { sdk_type: 'UserMessage', payload: {
      uuid: 'subu1', parent_tool_use_id: 'tu-1', content: [{ type: 'tool_result', tool_use_id: 'sub-tu-1', content: '命中 3 处' }],
    } } })));
    expect(s.messages).toEqual(before.messages);
  });

  test('后台 Agent 调用在父回合的 tool_result 仍照常折叠(那是父回合自己的 part)', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'claude.message', payload: { sdk_type: 'UserMessage', payload: {
      uuid: 'u1', parent_tool_use_id: null, content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'Async agent launched successfully' }],
    } } })));
    const tool = s.messages[0].parts.find((p: Part) => p.type === 'tool');
    expect(tool).toMatchObject({ type: 'tool', name: 'Agent', status: 'ready' });
  });

  test('终态端点收卡,同样不进消息流', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'claude.message', payload: { sdk_type: 'TaskNotificationMessage', payload: {
      task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', status: 'completed', summary: '发现 2 处问题',
    } } })));
    expect(s.subagents.cards[0]).toMatchObject({ status: 'completed', summary: '发现 2 处问题' });
    expect(s.messages).toHaveLength(1);
  });

  test('background_tasks_changed 是参考性成员列表:不开卡、不改状态', () => {
    const before = withSubagent();
    const s = applyKoubou(before, ev(next({ type: 'claude.message', payload: { sdk_type: 'SystemMessage', payload: {
      subtype: 'background_tasks_changed', data: { tasks: [{ task_id: 't1' }, { task_id: 't-unseen' }] },
    } } })));
    expect(s.subagents.cards).toHaveLength(1);
    expect(s.subagents.cards[0].status).toBe('running');
  });

  test('run.started 清空上一轮卡片(与任务清单同一处)', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'run.started', run_id: 'r2', payload: { run_id: 'r2' } })));
    expect(s.subagents.cards).toEqual([]);
    expect(s.subagents.knownToolUseIds).toEqual([]);
  });

  test('run.finished 收尾未收到终态的卡(结局未知)', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'run.finished', run_id: 'r1', payload: { run_id: 'r1', status: 'succeeded' } })));
    expect(s.subagents.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'unknown' });
  });

  test('run.finished(status=error) → 随本轮失败', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'run.finished', run_id: 'r1', payload: { run_id: 'r1', status: 'failed' } })));
    expect(s.subagents.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'failed' });
  });

  test('run.interrupted 不收尾:之后仍会有真实终态到达', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'run.interrupted', run_id: 'r1', payload: { run_id: 'r1' } })));
    expect(s.subagents.cards[0].status).toBe('running');
    const after = applyKoubou(s, ev(next({ type: 'claude.message', payload: { sdk_type: 'TaskUpdatedMessage', payload: {
      task_id: 't1', parent_tool_use_id: 'tu-1', patch: { status: 'killed' },
    } } })));
    expect(after.subagents.cards[0].status).toBe('stopped');   // 真实终态,不是合成态
  });

  // 归属必须取事件信封的 run_id,不能取 state.activeRunId —— finishRun / interruptRun 都会把
  // activeRunId 清成 null(apply-koubou.ts:662),而这两个帧之后仍会有生命周期事件到达
  test('run.interrupted 之后到达的 start 仍归属本 run,run.finished 时被收尾', () => {
    seq = 0;
    let s = applyKoubou(S(), ev(next({ type: 'run.started', run_id: 'r1', payload: { run_id: 'r1' } })));
    // 独立的 run.interrupted 帧只是「正在停止」:activeRunId 此刻已被清空
    s = applyKoubou(s, ev(next({ type: 'run.interrupted', run_id: 'r1', payload: { run_id: 'r1' } })));
    expect(s.activeRunId).toBeNull();
    s = applyKoubou(s, ev(next({ type: 'claude.message', run_id: 'r1', payload: { sdk_type: 'TaskStartedMessage', payload: {
      task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', task_type: 'local_agent', description: '打断后才到的 start',
    } } })));
    expect(s.subagents.cards[0].runId).toBe('r1');
    s = applyKoubou(s, ev(next({ type: 'run.finished', run_id: 'r1', payload: { run_id: 'r1', status: 'interrupted' } })));
    // 收不掉就是 2026-08-07 事故那种永久转圈卡
    expect(s.subagents.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'interrupted' });
  });

  test('收尾后迟到的 start 不建新卡,迟到的无归属终态也不建待定项', () => {
    let s = applyKoubou(withSubagent(), ev(next({ type: 'run.finished', run_id: 'r1', payload: { run_id: 'r1', status: 'failed' } })));
    // 孤儿收割(reconcile_orphans)直接往事件表追加 run.finished,旧 actor 仍可能继续写入
    s = applyKoubou(s, ev(next({ type: 'claude.message', run_id: 'r1', payload: { sdk_type: 'TaskStartedMessage', payload: {
      task_id: 't2', tool_use_id: 'tu-2', parent_tool_use_id: 'tu-2', task_type: 'local_bash', description: '迟到的 start',
    } } })));
    expect(s.subagents.cards.map((c) => c.taskId)).toEqual(['t1']);
    s = applyKoubou(s, ev(next({ type: 'claude.message', run_id: 'r1', payload: { sdk_type: 'TaskUpdatedMessage', payload: {
      task_id: 't9', patch: { status: 'failed' },
    } } })));
    expect(s.subagents.deferred).toEqual({});
  });

  test('run.finished(status=interrupted) 走打断路径但仍收尾', () => {
    const s = applyKoubou(withSubagent(), ev(next({ type: 'run.finished', run_id: 'r1', payload: { run_id: 'r1', status: 'interrupted' } })));
    expect(s.subagents.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'interrupted' });
  });
});

// 三个生命周期端点会落库重放(TaskProgressMessage 不落),故重连时卡片可重建
describe('历史重放重建子代理卡片', () => {
  const lc = (sdk_type: string, payload: Record<string, unknown>, seq: number, runId = 'r1'): ServerEvent =>
    ({ type: 'claude.message', project_id: '2', session_id: 's1', run_id: runId, sequence: seq, payload: { sdk_type, payload } }) as ServerEvent;
  const startEv = (seq: number) => lc('TaskStartedMessage', {
    task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1',
    task_type: 'local_agent', description: '查找落位逻辑',
  }, seq);

  test('start + notification 重建出终态卡', () => {
    const { subagents } = rebuild([
      ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }),
      startEv(2),
      lc('TaskNotificationMessage', { task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', status: 'completed', summary: '汇报' }, 3),
    ]);
    expect(subagents.cards).toHaveLength(1);
    expect(subagents.cards[0]).toMatchObject({ status: 'completed', summary: '汇报' });
  });

  test('重连窗口:父回合那条消息在页外,只有 start 落在页内 → 卡片仍建起来', () => {
    // 已知集合的来源 ② 就是为这条:只认父回合来源会让合法 start 被丢,后续端点连带被丢
    const { subagents } = rebuild([
      startEv(7),
      lc('TaskNotificationMessage', { task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', status: 'failed' }, 8),
    ]);
    expect(subagents.cards[0]).toMatchObject({ taskId: 't1', status: 'failed' });
  });

  test('页内含 run.finished 时按 run 状态收尾(不留转圈卡)', () => {
    const { subagents } = rebuild([
      ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } }),
      startEv(2),
      ev({ type: 'run.finished', run_id: 'r1', sequence: 3, payload: { run_id: 'r1', status: 'succeeded' } }),
    ]);
    expect(subagents.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'unknown' });
  });

  test('子 agent 的消息在重建时同样不进 messages', () => {
    const { messages, subagents } = rebuild([
      startEv(2),
      lc('AssistantMessage', { uuid: 'sub1', parent_tool_use_id: 'tu-1', content: [
        { type: 'text', text: '子代理的话' },
        { type: 'tool_use', id: 'sub-tu', name: 'Grep', input: {} },
      ] }, 3),
    ]);
    expect(messages).toEqual([]);
    expect(subagents.cards[0].lastToolName).toBe('Grep');
  });

  test('seedHistory 以快照里的卡片为底重放最新页', () => {
    const withCard = applyKoubou(applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, payload: { run_id: 'r1' } })), startEv(2));
    const seeded = seedHistory(withCard, {
      events: [lc('TaskNotificationMessage', { task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', status: 'completed' }, 3)],
      has_more: false,
      latest_sequence: 3,
    });
    expect(seeded.subagents.cards[0].status).toBe('completed');
  });

  test('向上翻页(更早的页)不覆盖当前卡片', () => {
    const now = applyKoubou(applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 5, payload: { run_id: 'r1' } })), startEv(6));
    const prepended = prependHistory(now, {
      events: [ev({ type: 'run.started', run_id: 'r0', sequence: 1, payload: { run_id: 'r0' } })],
      has_more: false,
      latest_sequence: 6,
    });
    expect(prepended.subagents).toEqual(now.subagents);
  });
});

// spec 2026-08-24-refresh-restore-turn-model-and-subagents:运行中刷新后当前轮丢模型名。
// 事件顺序恒是 run.started → SystemMessage(init),重建期若不把后者的 model 回填当前轮,
// 就只能靠快照里的同 runId 轮兜底 —— 快照还停在上一轮时(持久化 1s 节流)必然扑空。
describe('刷新后重建的回合模型名', () => {
  const MODEL = 'claude-sonnet-4-5';
  // **真实 wire 形状**(2026-08-24 对 dev 后端实测):模型名在 init 帧的 data 里,payload 顶层
  // 只有 subtype / data。早先按 `payload.model` 造的测试数据是凭空推测的,照着它写的修复在真链路上空转
  const sysInit = (model: string, s: number) =>
    ({ ...cmsg('SystemMessage', { subtype: 'init', data: { type: 'system', subtype: 'init', model } }), sequence: s }) as ServerEvent;
  // 刻意不带 model:隔离出 SystemMessage 这条回填路径(AssistantMessage 自带 model 是另一条)
  const asst = (uuid: string, s: number) =>
    ({ ...cmsg('AssistantMessage', { uuid, content: [{ type: 'text', text: 'x' }] }), sequence: s }) as ServerEvent;

  test('run.started 在页内:模型名来自其后的 SystemMessage', () => {
    const s = seedHistory(S(), {
      events: [
        ev({ type: 'run.started', run_id: 'r1', sequence: 10, created_at: 'A', payload: { run_id: 'r1' } }),
        sysInit(MODEL, 11),
        asst('m1', 12),
      ],
      has_more: true,
      latest_sequence: 12,
    });
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ runId: 'r1', model: MODEL, status: 'running' });
  });

  test('run.started 在页外:会话级 model 由页内 SystemMessage 写回,reopenRun 补建轮带模型名', () => {
    const seeded = seedHistory(S(), {
      events: [sysInit(MODEL, 90), asst('m2', 91), asst('m3', 92)],
      has_more: true,
      latest_sequence: 92,
    });
    // 会话级 model 不落盘,只能从本页事件重建 —— 否则 reopenRun 的补建轮恒无模型名
    expect(seeded.model).toBe(MODEL);
    const s = reopenRun(seeded, 'r1', '2026-08-24T10:00:00.000Z');
    expect(s.turns.at(-1)).toMatchObject({ runId: 'r1', model: MODEL, status: 'running' });
  });

  test('快照停在上一轮:新轮带模型名,旧轮的 model 不被改写', () => {
    // 上一轮的消息仍在窗口内(否则该轮按既有规则随消息一起被 visibleTurns 剔除)
    const base: KoubouState = {
      ...S(),
      turns: [{ runId: 'r0', model: 'old-model', startedAt: 'A0', finishedAt: 'B0', status: 'succeeded', lastMessageId: 'm-prev' }],
      historyTurnCount: 1,
    };
    const s = seedHistory(base, {
      events: [
        asst('m-prev', 19),
        ev({ type: 'run.started', run_id: 'r1', sequence: 20, created_at: 'A1', payload: { run_id: 'r1' } }),
        sysInit(MODEL, 21),
        asst('m1', 22),
      ],
      has_more: true,
      latest_sequence: 22,
    });
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0].model).toBe('old-model');
    expect(s.turns[1]).toMatchObject({ runId: 'r1', model: MODEL, status: 'running' });
  });

  test('页内无 SystemMessage 时不清空已有的会话级 model', () => {
    const base: KoubouState = { ...S(), model: MODEL };
    const s = seedHistory(base, { events: [asst('m4', 30)], has_more: true, latest_sequence: 30 });
    expect(s.model).toBe(MODEL);
  });

  // live 路径:真实序是 run.started → SystemMessage(init),建轮那一刻 model 常为空(pendingModel
  // 只在本 tab 发过消息时才有),要靠 init 帧回填,否则「发出消息到第一条 assistant 落定」这段
  // 空窗里脚注只有时长 —— 这正是刷新后最容易看到的那一幕
  test('live:SystemMessage(init) 回填当前 running 轮的模型名', () => {
    const started = applyKoubou(S(), ev({ type: 'run.started', run_id: 'r1', sequence: 1, created_at: 'A', payload: { run_id: 'r1' } }));
    expect(started.turns.at(-1)?.model).toBeNull();   // 建轮时还不知道模型
    const next = applyKoubou(started, sysInit(MODEL, 2));
    expect(next.model).toBe(MODEL);
    expect(next.turns.at(-1)).toMatchObject({ runId: 'r1', model: MODEL, status: 'running' });
  });

  test('live:无 running 轮时 SystemMessage 只写会话级 model,不凭空造轮', () => {
    const next = applyKoubou(S(), sysInit(MODEL, 1));
    expect(next.model).toBe(MODEL);
    expect(next.turns).toEqual([]);
  });

  test('prependHistory 不用旧页的 model 覆盖会话级现值', () => {
    const now = seedHistory(S(), { events: [sysInit(MODEL, 50), asst('m5', 51)], has_more: true, latest_sequence: 51 });
    const prepended = prependHistory(now, {
      events: [sysInit('very-old-model', 1), asst('m-old', 2)],
      has_more: false,
      latest_sequence: 51,
    });
    expect(prepended.model).toBe(MODEL);
  });
});

// 上游原文透传(设计稿 2026-08-25):命中 code 时主行会被译文覆盖,原文只能靠 detail 带到 UI。
// 两个失败入口(error 事件 / run.finished{failed})此前各推各的气泡,本轮收敛到 failAgentTurn
describe('固定槽报错透传上游原文', () => {
  test('error 事件动态异常 → detail 带异常类名与原文', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { type: 'ValueError', message: 'boom' } }));
    expect(s.agentError).toEqual({ text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
  });

  test('命中固定文案的业务错误同样带 detail(统一口径,不按错误类型分两支)', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: { message: 'run already active' } }));
    expect(s.agentError).toMatchObject({ code: 'RUN_ALREADY_ACTIVE', detail: 'run already active' });
  });

  test('run.finished failed 内嵌 error → 同样带 detail', () => {
    const s = applyKoubou(S(), ev({
      type: 'run.finished', run_id: 'r1', sequence: 2,
      payload: { run_id: 'r1', status: 'failed', error: { type: 'AnthropicOverloadedError', message: 'Overloaded' } },
    }));
    expect(s.agentError).toMatchObject({
      code: 'AGENT_RUN_ERROR', text: 'Overloaded', detail: 'AnthropicOverloadedError: Overloaded',
    });
  });

  // 空字段会让「同一个错」在不同路径下形状不一,断言与快照对比都跟着漂
  test('无 message 无 type → 不写空 detail 字段', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 8, payload: {} }));
    expect(s.agentError).toEqual({ text: 'agent error' });
  });
});
