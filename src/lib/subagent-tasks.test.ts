import { describe, expect, it } from 'vitest';
import type { TaskLifecycle } from '@/koubou/protocol';
import {
  createSubagentState, isTerminalStatus, learnToolUseIds, noteSubagentTool, reduceLifecycle, sealRun,
  sealStaleCards,
} from './subagent-tasks';

const RUN = { runId: 'run-1' };

// 事件构造 helper:默认都带归属 tu-1(已知集合里),便于只关注状态机主干
const started = (over: Partial<Extract<TaskLifecycle, { kind: 'started' }>> = {}): TaskLifecycle => ({
  kind: 'started', taskId: 't1', toolUseId: 'tu-1', parentToolUseId: 'tu-1',
  taskType: 'agent', description: '查找落位逻辑', ...over,
});
const updated = (over: Partial<Extract<TaskLifecycle, { kind: 'updated' }>> = {}): TaskLifecycle => ({
  kind: 'updated', taskId: 't1', parentToolUseId: 'tu-1', status: null, ...over,
});
const notification = (over: Partial<Extract<TaskLifecycle, { kind: 'notification' }>> = {}): TaskLifecycle => ({
  kind: 'notification', taskId: 't1', parentToolUseId: 'tu-1', status: 'completed', ...over,
});
const progress = (over: Partial<Extract<TaskLifecycle, { kind: 'progress' }>> = {}): TaskLifecycle => ({
  kind: 'progress', taskId: 't1', parentToolUseId: 'tu-1', ...over,
});

// 已知 tu-1 的起点(父回合那条 Agent tool_use 已到)
const base = () => learnToolUseIds(createSubagentState(), ['tu-1']);
const feed = (evs: TaskLifecycle[], st = base()) => evs.reduce((s, e) => reduceLifecycle(s, e, RUN), st);

describe('createSubagentState / isTerminalStatus', () => {
  it('初始为空态', () => {
    const st = createSubagentState();
    expect(st.cards).toEqual([]);
    expect(st.knownToolUseIds).toEqual([]);
    expect(st.taskToolUse).toEqual({});
    expect(st.deferred).toEqual({});
    expect(st.sealedRunIds).toEqual([]);
  });
  it('终态集合 = wire 三态 + 本地合成态', () => {
    for (const s of ['completed', 'failed', 'stopped', 'ended_without_terminal'] as const) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    for (const s of ['pending', 'running', 'paused'] as const) expect(isTerminalStatus(s)).toBe(false);
  });
});

describe('learnToolUseIds', () => {
  it('灌入父回合 tool_use id,去重', () => {
    const st = learnToolUseIds(learnToolUseIds(createSubagentState(), ['tu-1', 'tu-2']), ['tu-2', 'tu-3']);
    expect(st.knownToolUseIds).toEqual(['tu-1', 'tu-2', 'tu-3']);
  });
  it('空数组不产生新对象抖动', () => {
    const st = base();
    expect(learnToolUseIds(st, [])).toBe(st);
  });
});

describe('开卡(TaskStartedMessage)', () => {
  it('建一张 running 卡,记 runId 与归属,并学到 task_id → tool_use_id', () => {
    const st = feed([started({ subagentType: 'Explore' })]);
    expect(st.cards).toEqual([{
      taskId: 't1', toolUseId: 'tu-1', runId: 'run-1', kind: 'agent',
      description: '查找落位逻辑', subagentType: 'Explore', status: 'running',
    }]);
    expect(st.taskToolUse).toEqual({ t1: 'tu-1' });
  });
  // 契约:task_type 未知不影响归属与终态收敛 —— 别因为类型不认识就把事件当父回合流量
  it('类型未知(unknown)的卡照样归组、照样能被终态收掉', () => {
    const st = feed([
      started({ taskType: 'unknown' }),
      notification({ status: 'completed', summary: '汇报' }),
    ]);
    expect(st.cards[0]).toMatchObject({ kind: 'unknown', toolUseId: 'tu-1', status: 'completed', summary: '汇报' });
  });
  it('bash 与 agent 两种形态区分保留(UI 据此决定类型标)', () => {
    const st = feed([started({ taskId: 'a', taskType: 'agent' }), started({ taskId: 'b', taskType: 'bash' })]);
    expect(st.cards.map((c) => c.kind)).toEqual(['agent', 'bash']);
  });
  it('多个任务按开卡顺序排列', () => {
    const st = feed([
      started({ taskId: 't1' }),
      started({ taskId: 't2', description: '跑测试', taskType: 'bash' }),
    ]);
    expect(st.cards.map((c) => c.taskId)).toEqual(['t1', 't2']);
  });
  it('同 task_id 重复 start 不产生第二张卡', () => {
    const st = feed([started(), started({ description: '改了标签' })]);
    expect(st.cards).toHaveLength(1);
    expect(st.cards[0].description).toBe('查找落位逻辑'); // 已开的卡不被后来的 start 改写
  });
});

describe('补丁(TaskUpdatedMessage)不带 status 时不是终态', () => {
  it('只有 end_time / result 的补丁:保留原状态,不收卡', () => {
    const st = feed([started(), updated({ status: null, endTime: '2026-08-18T00:00:00Z', result: 'ok' })]);
    expect(st.cards[0].status).toBe('running');
    expect(isTerminalStatus(st.cards[0].status)).toBe(false);
  });
  it('非终态 status 推进状态但不收卡', () => {
    const st = feed([started(), updated({ status: 'paused' })]);
    expect(st.cards[0].status).toBe('paused');
  });
  it('error 补丁挂到卡上', () => {
    const st = feed([started(), updated({ status: 'failed', error: 'boom' })]);
    expect(st.cards[0]).toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('收卡:任一端点带来终态', () => {
  it('只有 TaskUpdated(killed→stopped) 也能收卡(notification 非必达)', () => {
    const st = feed([started(), updated({ status: 'stopped' })]);
    expect(st.cards[0].status).toBe('stopped');
  });
  it('只有 TaskNotification 也能收卡,并带上 summary / output_file', () => {
    const st = feed([started(), notification({ summary: '发现 2 处问题', outputFile: '/tmp/t1.out' })]);
    expect(st.cards[0]).toMatchObject({ status: 'completed', summary: '发现 2 处问题', outputFile: '/tmp/t1.out' });
  });
  it('两端点都带终态:先到者定状态,后到者只补产出(幂等)', () => {
    const st = feed([started(), updated({ status: 'stopped' }), notification({ status: 'completed', summary: '汇报' })]);
    expect(st.cards[0]).toMatchObject({ status: 'stopped', summary: '汇报' });
  });
  it('反向同理:notification 先定终态,随后的 updated 不改状态', () => {
    const st = feed([started(), notification({ status: 'completed', summary: '汇报' }), updated({ status: 'failed' })]);
    expect(st.cards[0]).toMatchObject({ status: 'completed', summary: '汇报' });
  });
  it('终态卡可能没有 summary(UI 需能显示只有状态的卡)', () => {
    const st = feed([started(), notification({ status: 'failed' })]);
    expect(st.cards[0].status).toBe('failed');
    expect(st.cards[0].summary).toBeUndefined();
  });
});

describe('活体指示(TaskProgressMessage)', () => {
  it('更新 lastToolName,不改状态', () => {
    const st = feed([started(), progress({ lastToolName: 'Grep' })]);
    expect(st.cards[0]).toMatchObject({ status: 'running', lastToolName: 'Grep' });
  });
  it('不参与状态:终态卡收到 progress 也不回到 running', () => {
    const st = feed([started(), notification({ status: 'completed' }), progress({ lastToolName: 'Read' })]);
    expect(st.cards[0].status).toBe('completed');
  });
});

describe('跨 run 隔离:有归属事件只认本 run 的已知 tool_use id', () => {
  it('归属在已知集合内 → 接受', () => {
    const st = feed([started(), notification({ status: 'completed' })]);
    expect(st.cards[0].status).toBe('completed');
  });
  it('陌生归属的补丁不动已有卡片(上一个 run 的残留)', () => {
    const st = feed([started(), notification({ status: 'completed' })]);
    const after = reduceLifecycle(st, updated({ parentToolUseId: 'tu-ghost', status: 'failed' }), RUN);
    expect(after.cards[0].status).toBe('completed');
    expect(after.deferred).toEqual({});
  });
  it('陌生归属的补丁在无卡时也不进暂存区', () => {
    const st = feed([updated({ parentToolUseId: 'tu-ghost', status: 'completed' })]);
    expect(st.cards).toEqual([]);
    expect(st.deferred).toEqual({});
  });
  it('来源②:带非空 tool_use_id 的 start 自我加入集合(重连时父回合消息在页外)', () => {
    // 已知集合为空,只有 start 到达 → 卡片仍建起来,且后续同 id 的 notification 被接受
    const st = feed([
      started({ taskId: 't9', toolUseId: 'tu-9', parentToolUseId: 'tu-9' }),
      notification({ taskId: 't9', parentToolUseId: 'tu-9', status: 'completed', summary: '汇报' }),
    ], createSubagentState());
    expect(st.knownToolUseIds).toContain('tu-9');
    expect(st.cards[0]).toMatchObject({ taskId: 't9', status: 'completed', summary: '汇报' });
  });
});

describe('终态先于 start 到达(墓碑)', () => {
  it('终态单独出现绝不开卡,只记暂存', () => {
    const st = feed([notification({ status: 'completed', summary: '汇报' })]);
    expect(st.cards).toEqual([]);
    expect(Object.keys(st.deferred)).toEqual(['t1']);
  });
  it('start 到达时直接建成终态并带上产出', () => {
    const st = feed([notification({ status: 'completed', summary: '汇报' }), started()]);
    expect(st.cards).toHaveLength(1);
    expect(st.cards[0]).toMatchObject({ status: 'completed', summary: '汇报' });
    expect(st.deferred).toEqual({});
  });
  it('同 task_id 但不同 tool_use_id 的 start 不消费墓碑(task_id 不假设跨 run 唯一)', () => {
    const st = feed([
      notification({ status: 'completed', summary: '上一个 run 的汇报' }),
      started({ toolUseId: 'tu-2', parentToolUseId: 'tu-2' }),
    ]);
    expect(st.cards[0]).toMatchObject({ status: 'running' });
    expect(st.cards[0].summary).toBeUndefined();
    // 墓碑**保留**而非丢弃:后来那个 tool_use_id 一致的 start 仍应能消费它
    expect(Object.keys(st.deferred)).toEqual(['t1']);
    const later = reduceLifecycle(st, started({ taskId: 't1', toolUseId: 'tu-1', parentToolUseId: 'tu-1' }), RUN);
    expect(later.cards).toHaveLength(1);   // t1 已被上一张卡占位,不重复开卡
  });
  it('非终态补丁在卡未建时同样暂存,start 后合并', () => {
    const st = feed([updated({ status: 'paused' }), started()]);
    expect(st.cards[0].status).toBe('paused');
  });
});

describe('无归属事件(盖不上章)', () => {
  it('无归属补丁先到 → 待定,合法 start 到达后并入', () => {
    const st1 = feed([updated({ parentToolUseId: null, status: 'stopped' })]);
    expect(st1.cards).toEqual([]);
    expect(Object.keys(st1.deferred)).toEqual(['t1']);
    const st2 = reduceLifecycle(st1, started(), RUN);
    expect(st2.cards[0].status).toBe('stopped');   // 被 TaskStop 杀掉时唯一的终态来源
  });
  it('无归属 start 建成不归组卡,且其 id 绝不进已知集合', () => {
    const st = feed([started({ toolUseId: null, parentToolUseId: null })], createSubagentState());
    expect(st.cards[0]).toMatchObject({ taskId: 't1', toolUseId: null, status: 'running' });
    expect(st.knownToolUseIds).toEqual([]);
    expect(st.taskToolUse).toEqual({});
  });
  it('同 task_id 的无归属补丁并入那张不归组卡', () => {
    const st = feed([
      started({ toolUseId: null, parentToolUseId: null }),
      notification({ parentToolUseId: null, status: 'failed' }),
    ], createSubagentState());
    expect(st.cards[0]).toMatchObject({ toolUseId: null, status: 'failed' });
  });
  it('无归属 start 不消费带归属的墓碑', () => {
    const st = feed([
      notification({ status: 'completed', summary: '别人的汇报' }),
      started({ toolUseId: null, parentToolUseId: null }),
    ]);
    expect(st.cards[0]).toMatchObject({ toolUseId: null, status: 'running' });
    expect(st.cards[0].summary).toBeUndefined();
  });
});

describe('progress 无卡时直接丢弃', () => {
  it('不开卡、不进暂存区', () => {
    const st = feed([progress({ lastToolName: 'Grep' })]);
    expect(st.cards).toEqual([]);
    expect(st.deferred).toEqual({});
  });
});

describe('run.finished 收尾:非终态卡收成本地合成态', () => {
  it.each([
    ['succeeded', 'unknown'],   // run 成功而任务终态没到 → 结局未知,不该显示成失败
    ['error', 'failed'],
    ['interrupted', 'interrupted'],
  ])('run 状态 %s → sealReason %s', (runStatus: string, reason: string) => {
    const st = sealRun(feed([started()]), 'run-1', runStatus as 'succeeded');
    expect(st.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: reason });
  });
  it('绝不伪造 wire 终态', () => {
    const st = sealRun(feed([started()]), 'run-1', 'interrupted');
    expect(st.cards[0].status).not.toBe('stopped');
    expect(st.cards[0].status).not.toBe('failed');
  });
  it('已是终态的卡不动', () => {
    const st = sealRun(feed([started(), notification({ status: 'completed', summary: '汇报' })]), 'run-1', 'error');
    expect(st.cards[0]).toMatchObject({ status: 'completed', summary: '汇报' });
    expect(st.cards[0].sealReason).toBeUndefined();
  });
  it('顺手清掉该 run 下未被任何 start 消费的暂存条目', () => {
    const st = sealRun(feed([notification({ status: 'completed' })]), 'run-1', 'succeeded');
    expect(st.deferred).toEqual({});
  });
  it('幂等:连续两次收尾结果一致', () => {
    const once = sealRun(feed([started()]), 'run-1', 'interrupted');
    expect(sealRun(once, 'run-1', 'interrupted')).toEqual(once);
  });
  // 契约:run.finished.payload.run_id 在极端失败场景可能为 null。此时无从区分归属,
  // 一律收掉在场的非终态卡 —— 留着转圈比多收一张更糟
  it('runId 为 null(极端失败帧)时收掉全部非终态卡', () => {
    const st = sealRun(feed([started()]), null, 'error');
    expect(st.cards[0]).toMatchObject({ status: 'ended_without_terminal', sealReason: 'failed' });
  });

  it('卡片 runId 为 null(开卡时拿不到 run 归属)也能被收尾', () => {
    const st = sealRun(reduceLifecycle(base(), started(), { runId: null }), 'run-1', 'succeeded');
    expect(st.cards[0].status).toBe('ended_without_terminal');
  });

  it('别的 run 的卡不受影响', () => {
    const st = reduceLifecycle(feed([started()]), started({ taskId: 't2', toolUseId: 'tu-2', parentToolUseId: 'tu-2' }), { runId: 'run-2' });
    const sealed = sealRun(st, 'run-1', 'interrupted');
    expect(sealed.cards.find((c) => c.taskId === 't1')?.status).toBe('ended_without_terminal');
    expect(sealed.cards.find((c) => c.taskId === 't2')?.status).toBe('running');
  });
});

describe('收尾过的 run 不因迟到事件重开', () => {
  const sealed = () => sealRun(feed([started()]), 'run-1', 'succeeded');

  it('迟到的 start 不建新卡(孤儿收割后仍可能来同 run 的事件)', () => {
    const st = reduceLifecycle(sealed(), started({ taskId: 't2', toolUseId: 'tu-2', parentToolUseId: 'tu-2' }), RUN);
    expect(st.cards.map((c) => c.taskId)).toEqual(['t1']);
  });
  it('迟到的无归属终态不建新的待定项', () => {
    const st = reduceLifecycle(sealed(), notification({ taskId: 't9', parentToolUseId: null, status: 'failed' }), RUN);
    expect(st.deferred).toEqual({});
  });
  it('合成态遇到迟到的真实 wire 终态 → 用真实终态替换并补产出', () => {
    const st = reduceLifecycle(sealed(), notification({ status: 'completed', summary: '迟到的汇报' }), RUN);
    expect(st.cards[0]).toMatchObject({ status: 'completed', summary: '迟到的汇报' });
    expect(st.cards[0].sealReason).toBeUndefined();   // 措辞随合成态一起退场
  });
  it('迟到的非终态补丁绝不把卡片改回 running', () => {
    const st = reduceLifecycle(sealed(), updated({ status: 'running' }), RUN);
    expect(st.cards[0].status).toBe('ended_without_terminal');
  });
  it('迟到事件只能并入已存在的卡片:progress 更新活体行但不复活状态', () => {
    const st = reduceLifecycle(sealed(), progress({ lastToolName: 'Read' }), RUN);
    expect(st.cards[0]).toMatchObject({ status: 'ended_without_terminal', lastToolName: 'Read' });
  });
});

describe('noteSubagentTool:子 agent 消息只留活体行', () => {
  it('按归属找卡更新 lastToolName', () => {
    const st = noteSubagentTool(feed([started()]), 'tu-1', 'Grep');
    expect(st.cards[0].lastToolName).toBe('Grep');
  });
  it('终态卡不再更新(结束了就不该显示还在做什么)', () => {
    const st = noteSubagentTool(feed([started(), notification({ status: 'completed' })]), 'tu-1', 'Read');
    expect(st.cards[0].lastToolName).toBeUndefined();
  });
  it('归属对不上任何卡 → 原样返回', () => {
    const st = feed([started()]);
    expect(noteSubagentTool(st, 'tu-ghost', 'Bash')).toBe(st);
  });
});

describe('不可变更新', () => {
  it('每次 reduce 返回新对象,不改旧 state', () => {
    const st0 = feed([started()]);
    const st1 = reduceLifecycle(st0, notification({ status: 'completed' }), RUN);
    expect(st1).not.toBe(st0);
    expect(st0.cards[0].status).toBe('running');
  });
});

// spec 2026-08-24-refresh-restore-turn-model-and-subagents:卡片进了会话快照之后,刷新恢复出来的
// 非终态卡要靠 REST 的权威 active_run_id 校正,否则回合早已结束时会留下永久转圈的卡。
// 不用 session.ready.active_run —— 它对新连接恒为 null,一刀切会把仍在跑的卡误收,而合成态
// **不能改回 running**(见 cardPatch),误收即不可逆。
describe('sealStaleCards:按 REST 权威 active_run 校正陈旧卡片', () => {
  // 两张卡分属两个 run:t1 属 run-1(base 的 RUN),t2 属 run-2
  const twoRuns = () => {
    const a = feed([started({ taskId: 't1' })]);
    return reduceLifecycle(
      learnToolUseIds(a, ['tu-2']),
      started({ taskId: 't2', toolUseId: 'tu-2', parentToolUseId: 'tu-2' }),
      { runId: 'run-2' },
    );
  };

  it('属于活跃 run 的非终态卡保持 running', () => {
    const st = sealStaleCards(twoRuns(), 'run-1');
    expect(st.cards.find((c) => c.taskId === 't1')).toMatchObject({ status: 'running' });
  });

  it('不属于活跃 run 的非终态卡收成结局未知', () => {
    const st = sealStaleCards(twoRuns(), 'run-1');
    expect(st.cards.find((c) => c.taskId === 't2')).toMatchObject({
      status: 'ended_without_terminal', sealReason: 'unknown',
    });
  });

  it('无活跃 run 时全部非终态卡收口', () => {
    const st = sealStaleCards(twoRuns(), null);
    expect(st.cards.map((c) => c.status)).toEqual(['ended_without_terminal', 'ended_without_terminal']);
  });

  it('已是终态的卡不被改写(幂等)', () => {
    const done = feed([started(), notification({ status: 'completed' })]);
    const st = sealStaleCards(done, null);
    expect(st.cards[0]).toMatchObject({ status: 'completed' });
    expect(st.cards[0].sealReason).toBeUndefined();
  });

  // 归属不明的卡不能照搬 sealRun 的「一律收」:那是在 run.finished 上收(run 已结束,非终态卡
  // 必是僵尸);这里可能是 run 正跑到一半,一张 runId 为 null 的卡多半就属于这个活跃 run,
  // 提前收掉纯是损失且不可逆 —— 它会在 run.finished 上由 sealRun 正确收口(那里的 belongs 认 null)
  it('有活跃 run 时,归属不明(runId 为 null)的卡不收', () => {
    const orphan = reduceLifecycle(base(), started(), { runId: null });
    expect(sealStaleCards(orphan, 'run-1').cards[0]).toMatchObject({ status: 'running' });
  });

  it('无活跃 run 时,归属不明的卡照收', () => {
    const orphan = reduceLifecycle(base(), started(), { runId: null });
    expect(sealStaleCards(orphan, null).cards[0]).toMatchObject({ status: 'ended_without_terminal' });
  });

  it('无卡可收时返回原引用(不制造无谓重渲)', () => {
    const done = feed([started(), notification({ status: 'completed' })]);
    expect(sealStaleCards(done, 'run-1')).toBe(done);
    expect(sealStaleCards(createSubagentState(), null)).toBeTruthy();
  });
});
