import { describe, expect, test } from 'vitest';
import { applyKoubou, seedHistory } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import type { KoubouState, Part } from '@/store/types';
import type { ServerEvent } from './protocol';

const S = (patch: Partial<KoubouState> = {}): KoubouState => ({ ...createInitialKoubouState(), backend: 'codex', ...patch });

// codex.message 信封:payload = { method, payload, task_list? }。瞬时帧 sequence 为 null
const cx = (method: string, payload: Record<string, unknown>): ServerEvent =>
  ({ type: 'codex.message', project_id: '2', session_id: 's1', sequence: null, payload: { method, payload } }) as unknown as ServerEvent;

const item = (i: Record<string, unknown>) => ({ threadId: 'th1', turnId: 'tu1', item: i });
const parts = (s: KoubouState, idx = 0): Part[] => s.messages[idx].parts;

describe('item/completed → 消息映射', () => {
  test('agentMessage 成 assistant 文本气泡,id 取 item.id', () => {
    const s = applyKoubou(S(), cx('item/completed', item({ id: 'message_1', type: 'agentMessage', text: '已完成。' })));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: 'message_1', role: 'assistant', status: 'ready' });
    expect(parts(s)).toEqual([{ type: 'text', text: '已完成。' }]);
  });

  test('reasoning 成可折叠 thinking 段(summary 优先)', () => {
    const s = applyKoubou(S(), cx('item/completed', item({ id: 'r1', type: 'reasoning', summary: ['先看目录', '再改代码'] })));
    expect(parts(s)).toEqual([{ type: 'thinking', text: '先看目录\n再改代码' }]);
  });

  test('reasoning 无可读文本 → 不成泡', () => {
    const s = applyKoubou(S(), cx('item/completed', item({ id: 'r2', type: 'reasoning' })));
    expect(s.messages).toHaveLength(0);
  });

  test('commandExecution 成命令卡(command / 输出 / 状态)', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'c1', type: 'commandExecution', command: 'pnpm build', cwd: '/w', status: 'completed', exitCode: 0,
      aggregatedOutput: 'done',
    })));
    expect(parts(s)).toEqual([{ type: 'tool', id: 'c1', name: 'Bash', input: { command: 'pnpm build', cwd: '/w' }, status: 'ready', result: 'done' }]);
  });

  test('commandExecution 失败 → tool part 标 error(内联展示,不弹 toast)', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'c2', type: 'commandExecution', command: 'false', status: 'failed', exitCode: 1, aggregatedOutput: 'boom',
    })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', status: 'error', result: 'boom' });
  });

  test('fileChange 每个变更一张卡,diff 归一成 FileDiff', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'f1', type: 'fileChange', status: 'completed',
      changes: [
        { path: 'src/a.ts', kind: 'update', diff: '@@ -1,1 +1,1 @@\n-a\n+b' },
        { path: 'src/b.ts', kind: 'add', diff: '@@ -0,0 +1,1 @@\n+new' },
      ],
    })));
    const ps = parts(s);
    expect(ps).toHaveLength(2);
    expect(ps[0]).toMatchObject({ type: 'tool', id: 'f1#0', name: 'Edit', input: { file_path: 'src/a.ts' }, status: 'ready' });
    expect((ps[0] as Extract<Part, { type: 'tool' }>).diff).toMatchObject({ type: 'update', filePath: 'src/a.ts', additions: 1, deletions: 1 });
    expect(ps[1]).toMatchObject({ type: 'tool', id: 'f1#1', name: 'Write', input: { file_path: 'src/b.ts' } });
    expect((ps[1] as Extract<Part, { type: 'tool' }>).diff).toMatchObject({ type: 'create', additions: 1 });
  });

  test('fileChange 的 diff 解析不出 → 仍出卡片,只是不挂 diff', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'f2', type: 'fileChange', changes: [{ path: 'src/c.ts', kind: 'update', diff: 'not a diff' }],
    })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', name: 'Edit' });
    expect((parts(s)[0] as Extract<Part, { type: 'tool' }>).diff).toBeUndefined();
  });

  test('mcpToolCall 成工具卡(server.tool 名 + 入参 + 结果文本)', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'm1', type: 'mcpToolCall', server: 'media', tool: 'submit_image_generation', status: 'completed',
      arguments: { name: 'slime' },
      result: { structuredContent: { type: 'media.task_submitted', kind: 'image', task_id: 'gtask-1' } },
    })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', id: 'm1', name: 'media.submit_image_generation', input: { name: 'slime' }, status: 'ready' });
    expect((parts(s)[0] as Extract<Part, { type: 'tool' }>).result).toContain('media.task_submitted');
  });

  test('webSearch 等已知活动类型走通用工具卡', () => {
    const s = applyKoubou(S(), cx('item/completed', item({ id: 'w1', type: 'webSearch', query: 'godot 2d', status: 'completed' })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', id: 'w1', name: 'webSearch', status: 'ready' });
  });

  test('未知 item.type / 缺 id → 忽略且不崩(向前兼容)', () => {
    const base = S();
    expect(applyKoubou(base, cx('item/completed', item({ id: 'x1', type: 'brandNewThing', foo: 1 })))).toEqual(base);
    expect(applyKoubou(base, cx('item/completed', item({ type: 'agentMessage', text: 'no id' })))).toEqual(base);
    expect(applyKoubou(base, cx('item/completed', {}))).toEqual(base);
  });

  test('同 id 重放 → 原位替换,不产生第二条', () => {
    let s = applyKoubou(S(), cx('item/completed', item({ id: 'm1', type: 'agentMessage', text: 'v1' })));
    s = applyKoubou(s, cx('item/completed', item({ id: 'm1', type: 'agentMessage', text: 'v2' })));
    expect(s.messages).toHaveLength(1);
    expect(parts(s)).toEqual([{ type: 'text', text: 'v2' }]);
  });

  test('落定消息回填当前 running 轮的 footer 锚点', () => {
    const s0 = S({ runStatus: 'running', turns: [{ runId: 'r1', model: 'gpt-5.5', startedAt: 't0', finishedAt: null, status: 'running', lastMessageId: null }] });
    const s = applyKoubou(s0, cx('item/completed', item({ id: 'msg1', type: 'agentMessage', text: 'ok' })));
    expect(s.turns[0].lastMessageId).toBe('msg1');
  });
});

describe('live 增量与合并', () => {
  test('item/started + delta 累积草稿,completed 落定为同一条', () => {
    let s = applyKoubou(S(), cx('item/started', item({ id: 'a1', type: 'agentMessage' })));
    expect(s.messages[0]).toMatchObject({ id: 'a1', status: 'generating' });
    s = applyKoubou(s, cx('item/agentMessage/delta', { itemId: 'a1', delta: '正在' }));
    s = applyKoubou(s, cx('item/agentMessage/delta', { itemId: 'a1', delta: '生成' }));
    expect(parts(s)).toEqual([{ type: 'text', text: '正在生成' }]);
    s = applyKoubou(s, cx('item/completed', item({ id: 'a1', type: 'agentMessage', text: '正在生成中,已完成' })));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].status).toBe('ready');
    expect(parts(s)).toEqual([{ type: 'text', text: '正在生成中,已完成' }]);
  });

  test('delta 先到(无 started)也建草稿', () => {
    const s = applyKoubou(S(), cx('item/agentMessage/delta', { itemId: 'a2', delta: 'hi' }));
    expect(s.messages[0]).toMatchObject({ id: 'a2', status: 'generating' });
    expect(parts(s)).toEqual([{ type: 'text', text: 'hi' }]);
  });

  test('reasoning 的 summary / 正文增量都追加到 thinking', () => {
    let s = applyKoubou(S(), cx('item/reasoning/summaryTextDelta', { itemId: 'r1', delta: '思考A' }));
    s = applyKoubou(s, cx('item/reasoning/textDelta', { itemId: 'r1', delta: '思考B' }));
    expect(parts(s)).toEqual([{ type: 'thinking', text: '思考A思考B' }]);
  });

  test('delta 缺 itemId / 缺文本 → 无副作用', () => {
    const base = S();
    expect(applyKoubou(base, cx('item/agentMessage/delta', { delta: 'x' }))).toEqual(base);
    expect(applyKoubou(base, cx('item/agentMessage/delta', { itemId: 'a3' }))).toEqual(base);
  });

  test('工具类 item/started 出转圈卡,completed 原位落定', () => {
    let s = applyKoubou(S(), cx('item/started', item({ id: 'c9', type: 'commandExecution', command: 'ls', status: 'in_progress' })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', id: 'c9', status: 'generating' });
    s = applyKoubou(s, cx('item/completed', item({ id: 'c9', type: 'commandExecution', command: 'ls', status: 'completed', aggregatedOutput: 'a.png' })));
    expect(s.messages).toHaveLength(1);
    expect(parts(s)[0]).toMatchObject({ status: 'ready', result: 'a.png' });
  });
});

describe('turn/plan/updated → 计划卡', () => {
  test('优先读 Koubou 附加的 task_list', () => {
    const e = {
      type: 'codex.message', project_id: '2', session_id: 's1', sequence: null,
      payload: {
        method: 'turn/plan/updated',
        payload: { plan: [{ step: '忽略我', status: 'inProgress' }] },
        task_list: { tasks: [
          { id: '1', subject: '看工程', status: 'completed', blockedBy: [] },
          { id: '2', subject: '改代码', status: 'in_progress', blockedBy: [] },
        ] },
      },
    } as unknown as ServerEvent;
    const s = applyKoubou(S(), e);
    expect(s.tasks).toEqual([
      { id: '1', subject: '看工程', status: 'completed' },
      { id: '2', subject: '改代码', status: 'in_progress' },
    ]);
  });

  test('无 task_list 时降级读原生 plan[](inProgress → in_progress)', () => {
    const s = applyKoubou(S(), cx('turn/plan/updated', { plan: [
      { step: '看工程', status: 'completed' },
      { step: '改代码', status: 'inProgress' },
      { step: '待办', status: 'pending' },
    ] }));
    expect(s.tasks).toEqual([
      { id: 'plan-0', subject: '看工程', status: 'completed' },
      { id: 'plan-1', subject: '改代码', status: 'in_progress' },
      { id: 'plan-2', subject: '待办', status: 'pending' },
    ]);
  });

  test('空 plan → 清空清单', () => {
    const s = applyKoubou(S({ tasks: [{ id: '1', subject: 'x', status: 'pending' }] }), cx('turn/plan/updated', { plan: [] }));
    expect(s.tasks).toEqual([]);
  });
});

// 以下三条来自 dev 后端真实抓帧(2026-07-30,gpt-5.6 会话):
// 后端会把**用户自己的输入**也作为 item(type=userMessage,带 sequence)下发。
// 它必须被忽略:live 已有 Composer 的乐观气泡,历史另有 user.message 信封重建 —— 渲染它会出现重复用户气泡。
describe('真实帧回归', () => {
  test('userMessage item 不成泡(避免与乐观气泡 / user.message 重复)', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: '019fb16a-1b73', type: 'userMessage',
      content: [{ type: 'text', text: '先运行 ls current', text_elements: [] }],
    })));
    expect(s.messages).toHaveLength(0);
  });

  test('hook/started、hook/completed 等平台钩子 method 无副作用', () => {
    const base = S();
    expect(applyKoubou(base, cx('hook/started', { hook: 'Stop' }))).toEqual(base);
    expect(applyKoubou(base, cx('hook/completed', { hook: 'Stop' }))).toEqual(base);
  });

  test('真实 agentMessage delta → completed 链路(itemId 与 item.id 同值)', () => {
    const id = 'msg_resp_0dd29428adcde52d016a6adbe552788197a3fc2fb9baf93f0e_0';
    let s = applyKoubou(S(), cx('item/started', item({ id, type: 'agentMessage', text: '' })));
    s = applyKoubou(s, cx('item/agentMessage/delta', { itemId: id, delta: '我先查看 ' }));
    s = applyKoubou(s, cx('item/agentMessage/delta', { itemId: id, delta: '`current` 顶层目录' }));
    expect(s.messages).toHaveLength(1);
    s = applyKoubou(s, cx('item/completed', item({ id, type: 'agentMessage', text: '我先查看 `current` 顶层目录,再用一句话概括结构。' })));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].status).toBe('ready');
  });

  test('真实 commandExecution item(含 exitCode/durationMs/source 等新增字段)照常成卡', () => {
    const s = applyKoubou(S(), cx('item/completed', item({
      id: 'call_xJ6ZLp9uLQjsCyd9gI0w00eY', type: 'commandExecution',
      command: 'ls current', commandActions: [], cwd: '/workspace', durationMs: 42, exitCode: 0,
      processId: 123, source: 'shell', status: 'completed', aggregatedOutput: 'src\ndist\n',
    })));
    expect(parts(s)[0]).toMatchObject({ type: 'tool', name: 'Bash', status: 'ready', result: 'src\ndist\n' });
  });
});

describe('其余 method 容错', () => {
  test('已知瞬时 method 与未知 method 一律无副作用', () => {
    const base = S();
    for (const m of ['turn/started', 'turn/completed', 'thread/goal/updated', 'thread/tokenUsage/updated', 'turn/diff/updated', 'brand/new/method']) {
      expect(applyKoubou(base, cx(m, { anything: true }))).toEqual(base);
    }
  });

  test('payload 缺失 / 非对象不崩', () => {
    const base = S();
    expect(applyKoubou(base, { type: 'codex.message', project_id: '2', session_id: 's1', payload: {} } as ServerEvent)).toEqual(base);
  });
});

// —— 历史重建(冷启动 / REST 分页 / gap 补偿走同一 rebuild)——
describe('历史重建', () => {
  const hist = (method: string, payload: Record<string, unknown>, sequence: number): ServerEvent =>
    ({ type: 'codex.message', project_id: '2', session_id: 's1', sequence, payload: { method, payload } }) as unknown as ServerEvent;
  const ev = (e: Partial<ServerEvent> & { type: string }): ServerEvent =>
    ({ project_id: '2', session_id: 's1', payload: {}, ...e }) as ServerEvent;

  test('item/completed 重建出与 live 同构的消息与工具卡', () => {
    const s = seedHistory(S(), {
      events: [
        ev({ type: 'run.started', payload: { run_id: 'r1' }, sequence: 1, created_at: 't0' }),
        ev({ type: 'user.message', event_id: 'u1', payload: { message: { role: 'user', content: '做个游戏' } }, sequence: 2 }),
        hist('item/completed', item({ id: 'c1', type: 'commandExecution', command: 'ls', status: 'completed', aggregatedOutput: 'a.png' }), 3),
        hist('item/completed', item({ id: 'm1', type: 'agentMessage', text: '好了' }), 4),
        ev({ type: 'run.finished', payload: { run_id: 'r1', status: 'succeeded' }, sequence: 5, created_at: 't1' }),
      ],
      has_more: false,
      latest_sequence: 5,
    });
    expect(s.messages.map((m) => m.id)).toEqual(['u1', 'c1', 'm1']);
    expect(s.messages[1].parts[0]).toMatchObject({ type: 'tool', name: 'Bash', result: 'a.png' });
    expect(s.messages[2].parts).toEqual([{ type: 'text', text: '好了' }]);
    // 轮次脚注锚到该轮最后一条消息,状态收口
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ runId: 'r1', status: 'succeeded', lastMessageId: 'm1' });
  });

  test('瞬时 method 出现在历史里也不成泡(仅 item/completed 参与回放)', () => {
    const s = seedHistory(S(), {
      events: [hist('turn/plan/updated', { plan: [{ step: 'x', status: 'pending' }] }, 1)],
      has_more: false,
      latest_sequence: 1,
    });
    expect(s.messages).toHaveLength(0);
  });

  test('同一 item 跨页重复出现 → 幂等替换,不重复成泡', () => {
    const page = (seq: number) => ({
      events: [hist('item/completed', item({ id: 'dup', type: 'agentMessage', text: `v${seq}` }), seq)],
      has_more: false,
      latest_sequence: seq,
    });
    let s = seedHistory(S(), page(1));
    s = seedHistory(s, page(2));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].parts).toEqual([{ type: 'text', text: 'v2' }]);
  });
});
