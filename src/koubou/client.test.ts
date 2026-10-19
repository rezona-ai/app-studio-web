import { describe, expect, test, vi } from 'vitest';
import { createKoubouClient, shouldReconnectOnWake } from './client';
import type { ServerEvent } from './protocol';

// FakeWS 模拟真实 readyState 生命周期:构造时 CONNECTING(0),open() 后 OPEN(1),close() 后 CLOSED(3)。
// 这样客户端「open 前积压 / open 后冲刷」逻辑能被真实驱动(旧版固定 readyState=1 测不出积压)。
class FakeWS {
  static OPEN = 1;
  readyState = 0;            // CONNECTING
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {}
  open() { this.readyState = FakeWS.OPEN; this.onopen?.(); }
  send(d: string) { this.sent.push(d); }
  close() { if (this.closed) return; this.closed = true; this.readyState = 3; this.onclose?.({ code: 1000 }); }
  emit(ev: ServerEvent) { this.onmessage?.({ data: JSON.stringify(ev) }); }
  parsed() { return this.sent.map((s) => JSON.parse(s)); }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(over: Partial<Parameters<typeof createKoubouClient>[0]> = {}) {
  const created: FakeWS[] = [];
  const statuses: string[] = [];
  const events: ServerEvent[] = [];
  let n = 0;
  const client = createKoubouClient({
    wsBaseUrl: 'ws://h',
    projectId: '2',
    mintTicket: () => Promise.resolve('tk'),
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    factory: (url: string) => { const w = new FakeWS(url); created.push(w); return w as never; },
    genId: () => `cmd_${++n}`,   // 确定性幂等键,便于断言「重连不换 ID」
    ...over,
  });
  return { client, created, statuses, events };
}

describe('createKoubouClient', () => {
  test('新建会话:mint ticket 后用新建 URL 连接,事件透传', async () => {
    const { created, events } = setup();
    await flush();
    expect(created[0].url).toBe('ws://h/projects/2/ws?ws_ticket=tk');
    created[0].open();
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's9', payload: {} });
    expect(events[0]).toMatchObject({ type: 'session.ready', session_id: 's9' });
  });

  test('sendUserMessage 组装 user.message envelope(带幂等键)', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.sendUserMessage({ role: 'user', content: 'hi' });
    expect(created[0].parsed()[0]).toEqual({
      type: 'user.message',
      payload: { message: { role: 'user', content: 'hi' }, parent_tool_use_id: null },
      event_id: 'cmd_1',
    });
  });

  test('approveTool / answerQuestion / interrupt 各自 envelope(带幂等键)', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.approveTool('toolu_1', false);
    client.answerQuestion('toolu_2', { 'Q?': '像素风' });
    client.interrupt();
    const sent = created[0].parsed();
    expect(sent[0]).toEqual({ type: 'tool.approval', payload: { interaction_id: 'toolu_1', approved: false }, event_id: 'cmd_1' });
    expect(sent[1]).toEqual({ type: 'ask_user_question.answer', payload: { interaction_id: 'toolu_2', answers: { 'Q?': '像素风' } }, event_id: 'cmd_2' });
    expect(sent[2]).toEqual({ type: 'run.interrupt', payload: {}, event_id: 'cmd_3' });
  });

  test('每条命令各带唯一 event_id', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.sendUserMessage({ role: 'user', content: 'a' });
    client.sendUserMessage({ role: 'user', content: 'b' });
    const ids = created[0].parsed().map((f) => f.event_id);
    expect(ids).toEqual(['cmd_1', 'cmd_2']);
    expect(new Set(ids).size).toBe(2);
  });

  test('open 前发送的命令入队,open 后按序冲刷', async () => {
    const { client, created } = setup();
    await flush();
    // 此刻 socket 已建但未 open(readyState=CONNECTING)
    client.sendUserMessage({ role: 'user', content: 'first' });
    client.steer('second');
    expect(created[0].sent).toHaveLength(0);   // 未 open → 积压,不发
    created[0].open();
    const sent = created[0].parsed();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'user.message', payload: { message: { content: 'first' } } });
    expect(sent[1]).toMatchObject({ type: 'user.steer', payload: { content: 'second' } });
  });

  test('open 前入队的命令在重连后以原幂等键冲刷(不换新 ID)', async () => {
    vi.useFakeTimers();
    try {
      const { client, created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);    // created[0] 已建,未 open
      client.sendUserMessage({ role: 'user', content: 'queued' });   // 入队 → event_id cmd_1
      expect(created[0].sent).toHaveLength(0);
      created[0].onclose?.({ code: 4401 });    // 未 open 即断,命令仍滞留队列
      await vi.advanceTimersByTimeAsync(1100);  // 退避重连 → created[1]
      expect(created).toHaveLength(2);
      created[1].open();                        // 新连接 open → 冲刷
      const sent = created[1].parsed();
      expect(sent).toHaveLength(1);
      expect(sent[0].event_id).toBe('cmd_1');   // 原 ID,未换新
      expect(sent[0]).toMatchObject({ type: 'user.message', payload: { message: { content: 'queued' } } });
    } finally {
      vi.useRealTimers();
    }
  });

  test('收到 session.ready 后记住 session_id,4401 关闭重连用恢复 URL', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup();
      await vi.advanceTimersByTimeAsync(0);   // flush 初次 connect 的 mintTicket 微任务
      created[0].open();
      created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's9', payload: {}, sequence: null });
      created[0].onclose?.({ code: 4401 });
      await vi.advanceTimersByTimeAsync(1100); // 推进退避计时器 + mintTicket
      expect(created[1].url).toBe('ws://h/projects/2/sessions/s9/ws?ws_ticket=tk');
    } finally {
      vi.useRealTimers();
    }
  });

  test('重连时主动关闭旧 socket,不残留两个活动连接', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup();
      await vi.advanceTimersByTimeAsync(0);
      created[0].open();
      created[0].onclose?.({ code: 4401 });
      await vi.advanceTimersByTimeAsync(1100);
      expect(created).toHaveLength(2);
      expect(created[0].closed).toBe(true);    // 旧 socket 被显式关闭
      expect(created[1].closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('4000 superseded 不重连', async () => {
    const { created, statuses } = setup();
    await flush();
    created[0].open();
    created[0].onclose?.({ code: 4000 });
    await flush();
    expect(created.length).toBe(1);
    expect(statuses).toContain('superseded');
  });

  test('setModel 组装 session.set_model envelope', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.setModel('claude-fable-5');
    expect(created[0].parsed()[0]).toMatchObject({ type: 'session.set_model', payload: { model: 'claude-fable-5' } });
  });

  test('opts.model 透传到建连 URL', async () => {
    const { created } = setup({ model: 'claude-opus-4-8' });
    await flush();
    expect(created[0].url).toBe('ws://h/projects/2/ws?ws_ticket=tk&model=claude-opus-4-8');
  });

  test('steer 组装 user.steer envelope', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.steer('先列方案');
    expect(created[0].parsed()[0]).toMatchObject({ type: 'user.steer', payload: { content: '先列方案' } });
  });

  test('非法 JSON 帧被吞掉,不影响后续事件', async () => {
    const { created, events } = setup();
    await flush();
    created[0].open();
    created[0].onmessage?.({ data: 'not json{{{' });
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's1', payload: {} });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session.ready');
  });

  test('close() 后不再重连', async () => {
    const { client, created } = setup();
    await flush();
    created[0].open();
    client.close();   // FakeWS.close() 触发 onclose,closedByUser 守卫阻止重连
    await flush();
    expect(created.length).toBe(1);
  });

  test('mintTicket 连续失败达上限 → 停止重连不再狂打 ticket', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { created } = setup({ mintTicket: () => { calls++; return Promise.reject(new Error('backend down')); } });
      await vi.advanceTimersByTimeAsync(0);
      // 推进足够长时间覆盖全部退避窗口(1+2+4+8+8s)
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(5);          // 连续 5 次失败后放弃
      expect(created.length).toBe(0); // 从未建立过 WS
      // 再推进也不会有新尝试
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  test('mintTicket 成功会重置连续失败计数', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      // 前 4 次失败,第 5 次成功;随后 WS 关闭再重连时不应因历史失败而放弃
      const { created } = setup({ mintTicket: () => { calls++; return calls === 5 ? Promise.resolve('tk') : Promise.reject(new Error('x')); } });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(created.length).toBe(1);
      created[0].open();
      created[0].onclose?.({ code: 1006 });
      await vi.advanceTimersByTimeAsync(60_000);
      // 关闭后继续重连(计数已清零,又能再失败 5 次)
      expect(calls).toBeGreaterThan(5);
    } finally {
      vi.useRealTimers();
    }
  });

  test('mintTicket 失败 → error 状态并退避重连', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { created, statuses } = setup({ mintTicket: () => { calls++; return calls === 1 ? Promise.reject(new Error('x')) : Promise.resolve('tk'); } });
      await vi.advanceTimersByTimeAsync(0);     // 首次 connect:mintTicket reject → error + scheduleReconnect
      expect(statuses).toContain('error');
      await vi.advanceTimersByTimeAsync(1100);  // 退避后第二次 mintTicket resolve → 建 WS
      expect(created.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('server.heartbeat → 立即回 client.ping(瞬态,不带 event_id)', async () => {
    const { created } = setup();
    await flush();
    created[0].open();
    created[0].emit({ type: 'server.heartbeat', project_id: '2', session_id: 's', payload: {} });
    const sent = created[0].parsed();
    expect(sent).toEqual([{ type: 'client.ping' }]);
    // 不是幂等命令:无 event_id
    expect(sent[0].event_id).toBeUndefined();
  });

  test('server.heartbeat 不透传给 store,也不当作 sequence', async () => {
    const { created, events } = setup();
    await flush();
    created[0].open();
    // 先来一条真实事件确立基线 afterSequence
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's', payload: {}, sequence: 5 });
    created[0].emit({ type: 'server.heartbeat', project_id: '2', session_id: 's', payload: {} });
    // 真实事件透传给 store;heartbeat 被吞掉
    expect(events.map((e) => e.type)).toEqual(['session.ready']);
  });

  test('未 open 时收到 heartbeat:不发 ping、不报错', async () => {
    const { created } = setup();
    await flush();
    // 此刻 socket 已建但未 open(readyState=CONNECTING)
    created[0].emit({ type: 'server.heartbeat', project_id: '2', session_id: 's', payload: {} });
    expect(created[0].sent).toEqual([]);
  });

  test('4400 关闭 → fatal 终态(区别于瞬时 error)', async () => {
    const { created, statuses } = setup();
    await flush();
    created[0].open();
    created[0].onclose?.({ code: 4400 });
    expect(statuses).toContain('fatal');
    expect(statuses).not.toContain('error');
  });
  test('4000 关闭 → superseded(被顶替)', async () => {
    const { created, statuses } = setup();
    await flush();
    created[0].open();
    created[0].onclose?.({ code: 4000 });
    expect(statuses).toContain('superseded');
    expect(statuses).not.toContain('fatal');
    expect(statuses).not.toContain('error');
  });

  test('mintTicket 连续失败达上限 → stalled 状态(而非静默 error)', async () => {
    vi.useFakeTimers();
    try {
      const { statuses } = setup({ mintTicket: () => Promise.reject(new Error('down')) });
      await vi.advanceTimersByTimeAsync(60_000);   // 覆盖全部退避窗口
      expect(statuses).toContain('stalled');
    } finally { vi.useRealTimers(); }
  });

  test('reconnect():停滞后立即重连,重置退避与 ticket 失败计数', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      // 前 5 次失败 → stalled;reconnect() 清零后第 6 次成功建连
      const { client, created, statuses } = setup({
        mintTicket: () => { calls++; return calls <= 5 ? Promise.reject(new Error('x')) : Promise.resolve('tk'); },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(statuses).toContain('stalled');
      expect(created).toHaveLength(0);
      client.reconnect();
      await vi.advanceTimersByTimeAsync(0);
      expect(created).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  test('心跳看门狗:open 后 45s 无帧 → 主动关闭并重连', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      created[0].open();
      expect(created[0].closed).toBe(false);
      await vi.advanceTimersByTimeAsync(45_000);   // 无帧 → 看门狗判死
      expect(created[0].closed).toBe(true);         // 主动关闭
      await vi.advanceTimersByTimeAsync(1100);      // 退避重连
      expect(created).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  test('心跳看门狗:期间持续收帧则不触发关闭', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      created[0].open();
      // 每 30s(< 45s 阈值)来一帧,持续 90s 都不应判死
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(30_000);
        created[0].emit({ type: 'server.heartbeat', project_id: '2', session_id: 's9', payload: {} });
      }
      expect(created[0].closed).toBe(false);
      expect(created).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  test('握手看门狗:socket 建出后 15s 未 open → 关闭并退避重连(不依赖 onclose 回调)', async () => {
    vi.useFakeTimers();
    try {
      const { created, statuses } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      expect(created).toHaveLength(1);            // socket 已建,停在 CONNECTING
      // 模拟僵尸 socket:close() 不回调 onclose(休眠后浏览器可能不回调)
      created[0].close = function (this: FakeWS) { this.closed = true; this.readyState = 3; };
      await vi.advanceTimersByTimeAsync(15_000);  // 握手超时
      expect(created[0].closed).toBe(true);       // 旧 socket 被显式关闭
      expect(statuses).toContain('closed');       // 确定性推进状态,不等 onclose
      await vi.advanceTimersByTimeAsync(1100);    // 退避重连
      expect(created).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  test('握手看门狗:15s 内正常 open 则不误杀', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      created[0].open();                           // 10s 时 open
      await vi.advanceTimersByTimeAsync(10_000);   // 越过 15s 握手线(open 后属心跳档,45s 未到)
      expect(created[0].closed).toBe(false);
      expect(created).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  test('握手看门狗:open 后切换为 45s 心跳档(open 后无帧 45s 才判死)', async () => {
    vi.useFakeTimers();
    try {
      const { created } = setup({ sessionId: 's9' });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(14_000);
      created[0].open();                           // 临界前 open
      await vi.advanceTimersByTimeAsync(44_000);   // open 后 44s:未到心跳阈值
      expect(created[0].closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100);    // 越过 45s → 心跳看门狗判死
      expect(created[0].closed).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  // close() 后必须不再派发帧:切项目时 effect cleanup 调 close(),而此刻已入任务队列的那一帧
  // 仍会到达 onmessage。它会被当成新项目的帧消化 —— 消息进 ingestKoubou、快照按闭包 pid 落进
  // **旧项目槽位**(等于把新项目的消息存进旧项目)。重连路径早就在解绑 handlers,close() 漏了
  test('close() 后到达的帧不再派发(过期帧不污染下一个项目)', async () => {
    const { client, created, events, statuses } = setup();
    await flush();
    created[0].open();
    created[0].emit({ type: 'session.ready', project_id: '2', session_id: 's1', payload: {} } as ServerEvent);
    expect(events).toHaveLength(1);

    client.close();
    // 用户主动关闭仍要上报 closed(onclose 里 closedByUser 分支),故只解绑 onmessage、不动 onclose
    expect(statuses.at(-1)).toBe('closed');

    created[0].onmessage?.({ data: JSON.stringify({ type: 'session.ready', project_id: '2', session_id: 's1', payload: {} }) });
    expect(events).toHaveLength(1);   // 未增长
  });

  test('shouldReconnectOnWake:仅停滞态触发唤醒重连', () => {
    expect(shouldReconnectOnWake('stalled')).toBe(true);
    expect(shouldReconnectOnWake('error')).toBe(true);
    expect(shouldReconnectOnWake('closed')).toBe(true);
    expect(shouldReconnectOnWake('open')).toBe(false);
    expect(shouldReconnectOnWake('connecting')).toBe(false);
    expect(shouldReconnectOnWake('fatal')).toBe(false);       // 终态不自愈
    expect(shouldReconnectOnWake('superseded')).toBe(false);  // 被顶替,重连会再被顶
  });
});
