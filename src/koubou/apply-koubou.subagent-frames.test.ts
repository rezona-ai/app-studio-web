import { describe, expect, test } from 'vitest';
import { applyKoubou, rebuild } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import type { ServerEvent } from './protocol';

// 真实帧夹具:2026-08-18 在 dev(devlab)真发一条「后台派两个只读子代理」的需求后,
// 从 koubou HTTP history 取回的事件日志(project 1608 / session_4f4fc056…,共 184 条)里
// 与后台任务有关的那几帧,按原样保留字段形状(路径与 id 已缩短脱敏,结构未改)。
//
// 守的是**字段形状**而非逻辑分支(逻辑由 subagent-tasks.test.ts 覆盖):start 的
// task_id / description / tool_use_id / task_type 在顶层而 subagent_type 在 data 里、
// updated 的 patch.end_time 是毫秒**数字**、notification 带 summary/output_file ——
// 这些都是从实机抓出来的,上游一旦漂移这里先红。
const TOOL_0 = 'call-1c52-0';
const TOOL_1 = 'call-1c52-1';
const RUN = 'run_6b37cdbc';
const SESSION = 'sess-63c37090';

const env = (e: Partial<ServerEvent> & { type: string }): ServerEvent =>
  ({ project_id: '1608', session_id: 'session_4f4fc056', run_id: RUN, payload: {}, ...e }) as ServerEvent;
const cm = (sequence: number, sdk_type: string, payload: Record<string, unknown>): ServerEvent =>
  env({ type: 'claude.message', sequence, payload: { sdk_type, payload } });

// 父回合那条派两个后台子代理的消息(run_in_background: true)
const PARENT_DISPATCH = cm(33, 'AssistantMessage', {
  uuid: 'a-33', session_id: SESSION, parent_tool_use_id: null, model: 'Rez1',
  content: [
    { type: 'text', text: '我会同时在后台派两个只读子代理。' },
    { type: 'tool_use', id: TOOL_0, name: 'Agent', input: { description: 'Count files in current/', subagent_type: 'Explore', run_in_background: true, prompt: '只读任务：统计…' } },
    { type: 'tool_use', id: TOOL_1, name: 'Agent', input: { description: 'Read index.html scripts', subagent_type: 'Explore', run_in_background: true, prompt: '只读任务：找到并读取…' } },
  ],
});

const started = (sequence: number, taskId: string, toolUseId: string, description: string): ServerEvent =>
  cm(sequence, 'TaskStartedMessage', {
    subtype: 'task_started', task_id: taskId, description, uuid: `s-${taskId}`, session_id: SESSION,
    tool_use_id: toolUseId, task_type: 'local_agent', parent_tool_use_id: toolUseId,
    // subagent_type / prompt 只在 data 里(顶层没有)
    data: {
      type: 'system', subtype: 'task_started', task_id: taskId, tool_use_id: toolUseId,
      description, subagent_type: 'Explore', task_type: 'local_agent', prompt: '只读任务：…',
      uuid: `s-${taskId}`, session_id: SESSION,
    },
  });

const updatedCompleted = (sequence: number, taskId: string, toolUseId: string): ServerEvent =>
  cm(sequence, 'TaskUpdatedMessage', {
    subtype: 'task_updated', task_id: taskId, status: 'completed',
    // end_time 是毫秒数字,不是 ISO 串
    patch: { status: 'completed', end_time: 1787045282274 },
    uuid: `u-${taskId}`, session_id: SESSION, parent_tool_use_id: toolUseId,
    data: { type: 'system', subtype: 'task_updated', task_id: taskId, patch: { status: 'completed', end_time: 1787045282274 }, uuid: `u-${taskId}`, session_id: SESSION },
  });

const notified = (sequence: number, taskId: string, toolUseId: string, summary: string): ServerEvent =>
  cm(sequence, 'TaskNotificationMessage', {
    subtype: 'task_notification', task_id: taskId, status: 'completed', summary,
    output_file: `/tmp/claude-1000/-workspaces-1608/${SESSION}/tasks/${taskId}.output`,
    tool_use_id: toolUseId, uuid: `n-${taskId}`, session_id: SESSION, parent_tool_use_id: toolUseId,
    data: { type: 'system', subtype: 'task_notification', task_id: taskId, tool_use_id: toolUseId, status: 'completed', summary },
  });

const SUMMARY_0 = 'current/ 目录不存在（工作区为空），因此 current/ 下共有 0 个文件。';
const SUMMARY_1 = '工作区内不存在 index.html（current/ 目录都还没创建），所以没有任何可报告的 script 引用。';

// 子代理自己的流量:实机这一轮共 21 条(15 AssistantMessage + 6 UserMessage),此处取两条代表
const SUBAGENT_TEXT = cm(84, 'AssistantMessage', {
  uuid: 'sub-84', session_id: SESSION, parent_tool_use_id: TOOL_0,
  content: [{ type: 'text', text: SUMMARY_0 }],
});
const SUBAGENT_TOOL_RESULT = cm(85, 'UserMessage', {
  uuid: 'sub-85', session_id: SESSION, parent_tool_use_id: TOOL_0,
  content: [{ type: 'tool_result', tool_use_id: 'call-bash-9', content: 'find: no results' }],
});

const LOG: ServerEvent[] = [
  env({ type: 'run.started', sequence: 1, payload: { run_id: RUN } }),
  PARENT_DISPATCH,
  started(35, 'a7911d62', TOOL_0, 'Count files in current/'),
  started(39, 'a7a17090', TOOL_1, 'Read index.html scripts'),
  SUBAGENT_TEXT,
  SUBAGENT_TOOL_RESULT,
  updatedCompleted(86, 'a7911d62', TOOL_0),
  notified(87, 'a7911d62', TOOL_0, SUMMARY_0),
  updatedCompleted(173, 'a7a17090', TOOL_1),
  notified(174, 'a7a17090', TOOL_1, SUMMARY_1),
  env({ type: 'run.finished', sequence: 184, payload: { run_id: RUN, status: 'succeeded' } }),
];

describe('真实 dev 帧:两个后台子代理', () => {
  test('live 逐帧消费:两张卡收成 completed,带各自 summary 与 output_file', () => {
    const s = LOG.reduce((acc, e) => applyKoubou(acc, e), createInitialKoubouState());
    expect(s.subagents.cards).toHaveLength(2);
    expect(s.subagents.cards[0]).toMatchObject({
      taskId: 'a7911d62', kind: 'agent', status: 'completed',
      description: 'Count files in current/', subagentType: 'Explore', summary: SUMMARY_0, toolUseId: TOOL_0,
    });
    expect(s.subagents.cards[0].outputFile).toContain('a7911d62.output');
    expect(s.subagents.cards[1]).toMatchObject({
      taskId: 'a7a17090', kind: 'agent', status: 'completed', summary: SUMMARY_1, toolUseId: TOOL_1,
    });
    // 双端点都带终态 → 幂等,不会被 notification 再算一次或改状态
    expect(s.subagents.cards.every((c) => c.status === 'completed')).toBe(true);
    // run.finished 收尾不该给已终态的卡加合成措辞
    expect(s.subagents.cards.some((c) => c.sealReason)).toBe(false);
    // 暂存区无残留(本轮所有端点都有归属且 start 先到)
    expect(s.subagents.deferred).toEqual({});
  });

  test('子代理的汇报文本不进主消息流(修前这一轮有 21 条会进)', () => {
    const s = LOG.reduce((acc, e) => applyKoubou(acc, e), createInitialKoubouState());
    const text = s.messages.flatMap((m) => m.parts).map((p) => ('text' in p ? p.text : '')).join('\n');
    expect(text).not.toContain(SUMMARY_0);
    expect(text).not.toContain('find: no results');
    // 父回合自己的话照旧
    expect(text).toContain('我会同时在后台派两个只读子代理。');
  });

  test('历史重放(冷启动/重连)重建出与 live 同样的两张卡', () => {
    const { subagents, messages } = rebuild(LOG);
    expect(subagents.cards.map((c) => [c.taskId, c.status])).toEqual([
      ['a7911d62', 'completed'], ['a7a17090', 'completed'],
    ]);
    expect(messages.flatMap((m) => m.parts).some((p) => 'text' in p && p.text === SUMMARY_0)).toBe(false);
  });

  // 同一天在 dev 上补测的第二轮:前台(run_in_background=False)派一个子代理。
  // 结论与「后台才有生命周期事件」的直觉相反 —— 前台调用同样发全套 start/updated/notification,
  // 所以按 parent_tool_use_id 剥流不会让前台子代理变成「什么都看不见」:卡片照样兜底。
  // 这条用例就是钉住这个事实的,别据「后台任务」的措辞去给剥流加 run_in_background 门控。
  test('前台(非后台)子代理同样发全套生命周期帧,卡片照样建起并收卡', () => {
    const FG = 'call-4943b23f-3';
    const RUN2 = 'run_fg';
    const fg = (sequence: number, sdk_type: string, payload: Record<string, unknown>): ServerEvent =>
      ({ type: 'claude.message', project_id: '1608', session_id: 'session_4f4fc056', run_id: RUN2, sequence, payload: { sdk_type, payload } }) as ServerEvent;
    const log: ServerEvent[] = [
      env({ type: 'run.started', run_id: RUN2, sequence: 233, payload: { run_id: RUN2 } }),
      fg(234, 'AssistantMessage', {
        uuid: 'a-234', parent_tool_use_id: null,
        content: [{ type: 'tool_use', id: FG, name: 'Agent', input: { description: 'List workspace root entries', subagent_type: 'Explore', run_in_background: false } }],
      }),
      fg(235, 'TaskStartedMessage', {
        subtype: 'task_started', task_id: 'a6802b44', tool_use_id: FG, parent_tool_use_id: FG,
        task_type: 'local_agent', description: 'List workspace root entries',
        data: { subagent_type: 'Explore', task_id: 'a6802b44', tool_use_id: FG, task_type: 'local_agent' },
      }),
      // 注意:updated 的 tool_use_id 是 null(它本就没这个字段),归属只靠服务端盖的 parent_tool_use_id
      fg(239, 'TaskUpdatedMessage', {
        subtype: 'task_updated', task_id: 'a6802b44', tool_use_id: null, parent_tool_use_id: FG,
        status: 'completed', patch: { status: 'completed', end_time: 1787046408207 },
      }),
      fg(240, 'TaskNotificationMessage', {
        subtype: 'task_notification', task_id: 'a6802b44', tool_use_id: FG, parent_tool_use_id: FG,
        status: 'completed', summary: '工作区根目录是空的，没有任何顶层条目。', output_file: '/tmp/…/a6802b44.output',
      }),
      env({ type: 'run.finished', run_id: RUN2, sequence: 284, payload: { run_id: RUN2, status: 'succeeded' } }),
    ];
    const s = log.reduce((acc, e) => applyKoubou(acc, e), createInitialKoubouState());
    expect(s.subagents.cards).toHaveLength(1);
    expect(s.subagents.cards[0]).toMatchObject({
      taskId: 'a6802b44', kind: 'agent', status: 'completed',
      description: 'List workspace root entries', summary: '工作区根目录是空的，没有任何顶层条目。',
    });
    expect(s.subagents.cards[0].sealReason).toBeUndefined();
  });

  test('只有 start 落在历史页内(父回合消息在页外)也能建卡', () => {
    // 重连只取最新一页的真实场景:start 自带 tool_use_id,是已知集合的第二个来源
    const { subagents } = rebuild(LOG.slice(2));
    expect(subagents.cards).toHaveLength(2);
    expect(subagents.cards[0].status).toBe('completed');
  });
});
