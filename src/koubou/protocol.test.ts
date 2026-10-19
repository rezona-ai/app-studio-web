import { describe, expect, test, it } from 'vitest';
import { isFullMessage, parseMediaItems, parseSubmittedTask, parseSubmittedTaskId, classifyClose, buildWsUrl, toolResultText, isTaskLifecycleType, parseTaskLifecycle } from './protocol';

describe('isFullMessage', () => {
  test('完整消息类型为 true,StreamEvent/未知为 false', () => {
    expect(isFullMessage('AssistantMessage')).toBe(true);
    expect(isFullMessage('UserMessage')).toBe(true);
    expect(isFullMessage('SystemMessage')).toBe(true);
    expect(isFullMessage('ResultMessage')).toBe(true);
    expect(isFullMessage('StreamEvent')).toBe(false);
    expect(isFullMessage('HookEventMessage')).toBe(false);
  });
});

describe('parseMediaItems', () => {
  test('media.task_submitted → 空数组(仅提交回执,无就绪资产)', () => {
    const j = JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: 'g1', status: 'pending', next_tool: 'mcp__media__check_generation_tasks' });
    expect(parseMediaItems(j)).toEqual([]);
  });
  test('media.tasks.status → 仅取 ready item(asset_path→path,preview_url→previewUrl)', () => {
    const j = JSON.stringify({ type: 'media.tasks.status', items: [
      { task_id: 'g1', kind: 'image', status: 'ready', progress: 100, asset_path: 'current/src/assets/slime.png', preview_url: 'https://x/slime.png' },
      { task_id: 'g2', kind: 'video', status: 'running' },   // 未就绪:跳过
      { task_id: 'g3', kind: 'audio', status: 'failed' },    // 失败:跳过
      { task_id: 'g4', kind: 'image', status: 'ready' },     // ready 但缺 asset_path:跳过
    ] });
    expect(parseMediaItems(j)).toEqual([
      // taskId 是血缘归因的配对键(回溯到提交它的那次工具调用)
      { kind: 'image', path: 'current/src/assets/slime.png', previewUrl: 'https://x/slime.png', taskId: 'g1' },
    ]);
  });
  test('tasks.status 缺 items → 空数组(仍是 media 结果)', () => {
    expect(parseMediaItems('{"type":"media.tasks.status"}')).toEqual([]);
  });
  test('非 media JSON / 纯文本 / 非法 → null', () => {
    expect(parseMediaItems('{"status":"ok"}')).toBeNull();
    expect(parseMediaItems('plain text')).toBeNull();
    expect(parseMediaItems('{"type":"media.generated","path":"a.png"}')).toBeNull();
  });
});

describe('parseSubmittedTask', () => {
  test('video 提交回执 → {taskId, kind:video}', () => {
    const j = JSON.stringify({ type: 'media.task_submitted', kind: 'video', task_id: 'gtask-1', status: 'pending' });
    expect(parseSubmittedTask(j)).toEqual({ taskId: 'gtask-1', kind: 'video' });
  });
  test('3d / model3d 都归一为 model3d', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: '3d', task_id: 'g2' }))).toEqual({ taskId: 'g2', kind: 'model3d' });
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'model3d', task_id: 'g3' }))).toEqual({ taskId: 'g3', kind: 'model3d' });
  });
  test('image / audio → null(无 poll 端点,走 auto-import)', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: 'g4' }))).toBeNull();
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'audio', task_id: 'g5' }))).toBeNull();
  });
  test('缺 task_id → null', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'video' }))).toBeNull();
  });
  test('非 task_submitted(tasks.status) / 纯文本 / 非法 → null', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.tasks.status', items: [] }))).toBeNull();
    expect(parseSubmittedTask('plain text')).toBeNull();
    expect(parseSubmittedTask('{"kind":"video","task_id":"x"}')).toBeNull();
  });
});

// 血缘归因的配对键:只要 task_id,不限 kind(与上面 video/3d 门槛的区别见函数注释)
describe('parseSubmittedTaskId', () => {
  test('image / audio / video / 3d 一律取到 task_id', () => {
    for (const kind of ['image', 'audio', 'video', '3d', 'model3d']) {
      expect(parseSubmittedTaskId(JSON.stringify({ type: 'media.task_submitted', kind, task_id: 'gtask-x' }))).toBe('gtask-x');
    }
  });
  test('缺 task_id / 空串 → null', () => {
    expect(parseSubmittedTaskId(JSON.stringify({ type: 'media.task_submitted', kind: 'image' }))).toBeNull();
    expect(parseSubmittedTaskId(JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: '' }))).toBeNull();
  });
  test('非提交回执 / 非 JSON → null(其它工具结果不误取)', () => {
    expect(parseSubmittedTaskId(JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1' }] }))).toBeNull();
    expect(parseSubmittedTaskId('不是 JSON')).toBeNull();
  });
});

describe('toolResultText', () => {
  test('字符串原样;block 数组拼 text', () => {
    expect(toolResultText('hi')).toBe('hi');
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
});

describe('classifyClose', () => {
  test('关闭码分类', () => {
    expect(classifyClose(4401)).toBe('reauth');
    expect(classifyClose(4404)).toBe('recreate');
    expect(classifyClose(4000)).toBe('superseded');
    expect(classifyClose(4400)).toBe('fatal');
    expect(classifyClose(4403)).toBe('fatal');
    expect(classifyClose(1006)).toBe('retry');
  });
});

describe('buildWsUrl', () => {
  test('新建会话 URL', () => {
    expect(buildWsUrl('ws://h', '2', { ticket: 'tk' })).toBe('ws://h/projects/2/ws?ws_ticket=tk');
  });
  test('恢复会话 URL', () => {
    expect(buildWsUrl('ws://h/', '2', { sessionId: 's1', ticket: 'tk' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk');
  });
  test('续传带 after_sequence(仅恢复时)', () => {
    expect(buildWsUrl('ws://h', '2', { sessionId: 's1', afterSequence: 7, ticket: 'tk' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk&after_sequence=7');
  });
  test('带 model 追加 model 参数', () => {
    expect(buildWsUrl('ws://h', '2', { ticket: 'tk', model: 'claude-opus-4-8' }))
      .toBe('ws://h/projects/2/ws?ws_ticket=tk&model=claude-opus-4-8');
  });
  // model 与 backend 同口径:只在建会话时带。**推翻**原先「恢复会话也带 model」的断言 ——
  // koubou 的 attach_session_ws 根本不读这个参数(只有 create_session_ws 读并校验),
  // 带上它纯属误导:它让人以为建连就能纠正在世会话的模型,已骗过一轮修复
  // (spec 2026-09-11-session-model-adopt-design)
  test('恢复会话带 after_sequence 但不带 model', () => {
    expect(buildWsUrl('ws://h', '2', { sessionId: 's1', afterSequence: 7, ticket: 'tk', model: 'claude-fable-5' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk&after_sequence=7');
  });
  // backend 只在建会话时固定;attach 不带(后端沿用会话持久化的 backend,带了也无意义)
  test('新建会话带 backend', () => {
    expect(buildWsUrl('ws://h', '2', { ticket: 'tk', backend: 'codex', model: 'gpt-5.5' }))
      .toBe('ws://h/projects/2/ws?ws_ticket=tk&backend=codex&model=gpt-5.5');
  });
  test('恢复会话不带 backend', () => {
    expect(buildWsUrl('ws://h', '2', { sessionId: 's1', ticket: 'tk', backend: 'codex' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk');
  });
});

import { parseTaskResult, parseTaskInput, isTaskTool } from './protocol';

describe('parseTaskResult', () => {
  it('TaskCreate → create effect(取 task.id/subject)', () => {
    expect(parseTaskResult('TaskCreate', { task: { id: '1', subject: '建骨架' } }))
      .toEqual({ kind: 'create', id: '1', subject: '建骨架' });
  });
  it('TaskUpdate → update effect(statusChange.to + updatedFields)', () => {
    expect(parseTaskResult('TaskUpdate', {
      success: true, taskId: '1', updatedFields: ['status'], statusChange: { from: 'pending', to: 'in_progress' },
    })).toEqual({ kind: 'update', taskId: '1', to: 'in_progress', updatedFields: ['status'] });
  });
  it('TaskUpdate 无 statusChange → to 为 null', () => {
    expect(parseTaskResult('TaskUpdate', { success: true, taskId: '2', updatedFields: ['subject'] }))
      .toEqual({ kind: 'update', taskId: '2', to: null, updatedFields: ['subject'] });
  });
  it('TaskList → snapshot(过滤畸形项)', () => {
    expect(parseTaskResult('TaskList', { tasks: [
      { id: '1', subject: 'a', status: 'completed' },
      { subject: '缺 id 丢弃' },
    ] })).toEqual({ kind: 'snapshot', tasks: [{ id: '1', subject: 'a', status: 'completed' }] });
  });
  it('TaskGet → get effect', () => {
    expect(parseTaskResult('TaskGet', { task: { id: '3', subject: 's', description: 'd', status: 'pending' } }))
      .toEqual({ kind: 'get', task: { id: '3', subject: 's', description: 'd', status: 'pending' } });
  });
  it.each([
    ['非任务工具', 'Bash', { task: { id: '1' } }],
    ['null', 'TaskCreate', null],
    ['缺 task.id', 'TaskCreate', { task: { subject: 'x' } }],
    ['TaskUpdate 缺 taskId', 'TaskUpdate', { success: true }],
    ['TaskList 非数组', 'TaskList', { tasks: 'nope' }],
  ])('畸形输入返回 null:%s', (_n: string, tool: string, raw: unknown) => {
    expect(parseTaskResult(tool, raw)).toBeNull();
  });
});

describe('parseTaskInput', () => {
  it('规范键直取', () => {
    expect(parseTaskInput({ taskId: '1', subject: 's', description: 'd', activeForm: '进行中文案' }))
      .toEqual({ taskId: '1', subject: 's', description: 'd', activeForm: '进行中文案' });
  });
  it('别名兜底:active_form/task_id/id(流式保留模型原始键)', () => {
    expect(parseTaskInput({ id: '2', active_form: '做某事' })).toEqual({ taskId: '2', activeForm: '做某事' });
    expect(parseTaskInput({ task_id: '3' })).toEqual({ taskId: '3' });
  });
  it('规范键优先于别名', () => {
    expect(parseTaskInput({ taskId: '1', task_id: '9' })).toEqual({ taskId: '1' });
  });
  it('非对象/空对象返回 null', () => {
    expect(parseTaskInput(undefined)).toBeNull();
    expect(parseTaskInput('str')).toBeNull();
    expect(parseTaskInput({})).toBeNull();
  });
});

describe('isTaskTool', () => {
  it('四个任务工具 true,其余 false', () => {
    for (const n of ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) expect(isTaskTool(n)).toBe(true);
    expect(isTaskTool('Bash')).toBe(false);
    expect(isTaskTool('TaskStartedMessage')).toBe(false); // 后台任务事件,不是清单工具
  });
});

// 本地 Koubou 调试(mock 鉴权):ticket=null 不带 ws_ticket 参数
describe('buildWsUrl ticket=null(本地调试免票)', () => {
  test('新建会话:无 query', () => {
    expect(buildWsUrl('ws://127.0.0.1:8000', '2', { ticket: null })).toBe('ws://127.0.0.1:8000/projects/2/ws');
  });
  test('恢复 + 续传:仅 after_sequence', () => {
    expect(buildWsUrl('ws://127.0.0.1:8000', '2', { sessionId: 's1', afterSequence: 7, ticket: null }))
      .toBe('ws://127.0.0.1:8000/projects/2/sessions/s1/ws?after_sequence=7');
  });
});

// ---- 后台任务生命周期(子代理 / 后台命令)----
describe('isTaskLifecycleType', () => {
  it('四类生命周期为 true,完整消息与流式为 false', () => {
    for (const n of ['TaskStartedMessage', 'TaskUpdatedMessage', 'TaskNotificationMessage', 'TaskProgressMessage']) {
      expect(isTaskLifecycleType(n)).toBe(true);
    }
    expect(isTaskLifecycleType('AssistantMessage')).toBe(false);
    expect(isTaskLifecycleType('StreamEvent')).toBe(false);
    expect(isTaskLifecycleType('TaskCreate')).toBe(false); // 清单工具名,不是 sdk_type
  });
});

describe('parseTaskLifecycle:TaskStartedMessage', () => {
  it('取归属 / 类型 / 标签,data.subagent_type 补 agent 类型', () => {
    expect(parseTaskLifecycle('TaskStartedMessage', {
      subtype: 'task_started', task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1',
      task_type: 'local_agent', description: 'build a module', data: { subagent_type: 'Explore', prompt: '...' },
    })).toEqual({
      kind: 'started', taskId: 't1', toolUseId: 'tu-1', parentToolUseId: 'tu-1',
      taskType: 'agent', description: 'build a module', subagentType: 'Explore',
    });
  });
  it('local_bash → bash', () => {
    const ev = parseTaskLifecycle('TaskStartedMessage', {
      task_id: 't2', tool_use_id: 'tu-2', parent_tool_use_id: 'tu-2', task_type: 'local_bash', description: 'pnpm test',
    });
    expect(ev).toMatchObject({ kind: 'started', taskType: 'bash', description: 'pnpm test' });
  });
  it.each([
    ['缺 task_type', undefined],
    ['未知取值', 'local_something'],
    ['非字符串', 42],
  ])('%s → unknown 形态(不影响归属)', (_n: string, taskType: unknown) => {
    const ev = parseTaskLifecycle('TaskStartedMessage', { task_id: 't3', tool_use_id: 'tu-3', parent_tool_use_id: 'tu-3', task_type: taskType });
    expect(ev).toMatchObject({ kind: 'started', taskType: 'unknown', toolUseId: 'tu-3', parentToolUseId: 'tu-3' });
  });
  it('未盖章(无 parent_tool_use_id)/无 tool_use_id 时两者为 null,不臆造', () => {
    expect(parseTaskLifecycle('TaskStartedMessage', { task_id: 't4', task_type: 'local_agent' }))
      .toMatchObject({ kind: 'started', toolUseId: null, parentToolUseId: null });
  });
  it('description 缺失 → 空串(UI 兜底,不丢事件)', () => {
    expect(parseTaskLifecycle('TaskStartedMessage', { task_id: 't5' })).toMatchObject({ description: '' });
  });
});

describe('parseTaskLifecycle:TaskUpdatedMessage', () => {
  it('patch.status 归一,killed → stopped', () => {
    expect(parseTaskLifecycle('TaskUpdatedMessage', {
      task_id: 't1', parent_tool_use_id: 'tu-1', patch: { status: 'killed' }, status: 'killed',
    })).toEqual({ kind: 'updated', taskId: 't1', parentToolUseId: 'tu-1', status: 'stopped' });
  });
  it('只带 end_time / result 的补丁:status 为 null(不是终态)', () => {
    expect(parseTaskLifecycle('TaskUpdatedMessage', {
      task_id: 't1', parent_tool_use_id: 'tu-1', patch: { end_time: '2026-08-18T00:00:00Z', result: 'ok' },
    })).toEqual({ kind: 'updated', taskId: 't1', parentToolUseId: 'tu-1', status: null, result: 'ok', endTime: '2026-08-18T00:00:00Z' });
  });
  it('patch 缺 status 时回退顶层 status(同源字段)', () => {
    expect(parseTaskLifecycle('TaskUpdatedMessage', { task_id: 't1', patch: {}, status: 'running' }))
      .toMatchObject({ status: 'running' });
  });
  it('未知状态取值 → null(不当终态)', () => {
    expect(parseTaskLifecycle('TaskUpdatedMessage', { task_id: 't1', patch: { status: 'weird' } }))
      .toMatchObject({ status: null });
  });
  it('error 补丁原样带上', () => {
    expect(parseTaskLifecycle('TaskUpdatedMessage', { task_id: 't1', patch: { status: 'failed', error: 'boom' } }))
      .toMatchObject({ status: 'failed', error: 'boom' });
  });
});

describe('parseTaskLifecycle:TaskNotificationMessage', () => {
  it('取终态 + summary + output_file', () => {
    expect(parseTaskLifecycle('TaskNotificationMessage', {
      task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', status: 'completed',
      summary: '发现 2 处问题', output_file: '/tmp/t1.out',
    })).toEqual({
      kind: 'notification', taskId: 't1', parentToolUseId: 'tu-1', status: 'completed',
      summary: '发现 2 处问题', outputFile: '/tmp/t1.out',
    });
  });
  it('stopped 原样保留(与 killed 归一到同一值)', () => {
    expect(parseTaskLifecycle('TaskNotificationMessage', { task_id: 't1', status: 'stopped' }))
      .toMatchObject({ status: 'stopped' });
  });
  it('output_file 空串视为无(后台命令即如此),summary 缺失不补', () => {
    expect(parseTaskLifecycle('TaskNotificationMessage', { task_id: 't1', status: 'failed', output_file: '' }))
      .toEqual({ kind: 'notification', taskId: 't1', parentToolUseId: null, status: 'failed' });
  });
});

describe('parseTaskLifecycle:TaskProgressMessage', () => {
  it('取 last_tool_name 做活体指示', () => {
    expect(parseTaskLifecycle('TaskProgressMessage', {
      task_id: 't1', tool_use_id: 'tu-1', parent_tool_use_id: 'tu-1', last_tool_name: 'Grep',
    })).toEqual({ kind: 'progress', taskId: 't1', parentToolUseId: 'tu-1', lastToolName: 'Grep' });
  });
  it('无 last_tool_name 时不带该字段', () => {
    expect(parseTaskLifecycle('TaskProgressMessage', { task_id: 't1' }))
      .toEqual({ kind: 'progress', taskId: 't1', parentToolUseId: null });
  });
});

describe('parseTaskLifecycle:畸形输入', () => {
  it.each([
    ['缺 task_id', 'TaskStartedMessage', { tool_use_id: 'tu-1' }],
    ['task_id 空串', 'TaskUpdatedMessage', { task_id: '', patch: { status: 'completed' } }],
    ['非对象 payload', 'TaskStartedMessage', 'nope'],
    ['null payload', 'TaskNotificationMessage', null],
    ['非生命周期 sdk_type', 'AssistantMessage', { task_id: 't1' }],
  ])('%s → null', (_n: string, sdkType: string, payload: unknown) => {
    expect(parseTaskLifecycle(sdkType, payload)).toBeNull();
  });
});
