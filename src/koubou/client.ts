import { newId } from '@/lib/ids';
import {
  buildWsUrl, classifyClose,
  type ServerEvent, type UserMessageContent, type ClientEvent,
} from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'superseded' | 'fatal' | 'stalled';

// 唤醒/网络恢复时是否应重连:仅停滞态(放弃 stalled / 瞬时错 error / 退避等待 closed)才重连;
// open/connecting 已在连,fatal/superseded 为终态不自愈
export function shouldReconnectOnWake(status: string): boolean {
  return status === 'stalled' || status === 'error' || status === 'closed';
}

export interface KoubouClientOpts {
  wsBaseUrl: string;
  projectId: string;
  sessionId?: string | null;
  afterSequence?: number | null;
  model?: string | null;
  // 新建会话时固定的 agent backend(cc / codex);attach 不带(见 buildWsUrl)
  backend?: string | null;
  // 返回 null = 免票直连(本地 Koubou 调试,mock 鉴权不校验 ticket)
  mintTicket: () => Promise<string | null>;
  onEvent: (e: ServerEvent) => void;
  onStatus: (s: ConnStatus) => void;
  factory?: (url: string) => WebSocket;   // 测试注入
  genId?: () => string;                    // 测试注入幂等键生成器
}

export interface KoubouClient {
  sendUserMessage: (message: UserMessageContent, parentToolUseId?: string | null) => void;
  steer: (content: string) => void;
  interrupt: () => void;
  approveTool: (interactionId: string, approved: boolean) => void;
  answerQuestion: (interactionId: string, answers: Record<string, string | string[]>) => void;
  setModel: (model: string) => void;
  reconnect: () => void;
  close: () => void;
}

const WS_OPEN = 1;
const MAX_TICKET_FAILS = 5;
const HEARTBEAT_TIMEOUT_MS = 45_000;   // >2× 服务端 ~20s 心跳:此间无任何入站帧判定连接已死(治半开/僵尸连接)
const HANDSHAKE_TIMEOUT_MS = 15_000;   // socket 建出后至 onopen 的上限:休眠恢复后握手可能永久悬挂(无任何回调),超时强制重连

export function createKoubouClient(opts: KoubouClientOpts): KoubouClient {
  let ws: WebSocket | null = null;
  let sessionId: string | null = opts.sessionId ?? null;
  let afterSequence: number | null = opts.afterSequence ?? null;
  let retry = 0;
  let ticketFails = 0;   // mintTicket 连续失败计数,达上限后停止重连(后端不可用时避免无限狂打 ticket 接口)
  let closedByUser = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  // socket open 前发出的命令在此积压,open 后按 FIFO 冲刷;每条命令建帧时一次性分配 event_id 幂等键。
  // 重放边界:仅积压(尚未交给活动 socket)的命令在重连后用「原 event_id」冲刷——这类命令服务端必然
  // 没收到,重放安全。一旦 send() 交给活动 socket 即出队,不保留以待「在途丢失」重放:koubou 当前无
  // event_id 去重(随后端 owner/lease 一并落地,见跨栈方案 U11),此时盲目重放会双执行。待后端去重就绪
  // 后,可把出队时机从 send 后改为服务端 ack 后,实现 at-least-once 重放——event_id 已为此铺好幂等基础。
  const pending: ClientEvent[] = [];

  const make = opts.factory ?? ((u: string) => new WebSocket(u));
  const genId = opts.genId ?? (() => newId('cmd'));

  const clearWatchdog = () => { clearTimeout(watchdog); watchdog = undefined; };
  // 每收到任意入站帧即重置;超时无帧 → 判半开,主动关闭当前 socket,落入 onclose(默认码)走退避重连
  const kickWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (ws && ws.readyState === WS_OPEN) { try { ws.close(); } catch { /* 已关闭 */ } }
    }, HEARTBEAT_TIMEOUT_MS);
  };

  const connect = async () => {
    if (closedByUser) return;
    opts.onStatus('connecting');
    let ticket: string | null;
    try { ticket = await opts.mintTicket(); }
    catch {
      // 连续失败累加;未达上限 → error + 退避重连;达上限 → 放弃自动重连,发 stalled 供 UI 手动重连(旧为静默停在 error)
      if (++ticketFails < MAX_TICKET_FAILS) { opts.onStatus('error'); scheduleReconnect(); }
      else opts.onStatus('stalled');
      return;
    }
    ticketFails = 0;
    if (closedByUser) return;
    const url = buildWsUrl(opts.wsBaseUrl, opts.projectId, { sessionId, afterSequence, ticket, model: opts.model, backend: opts.backend });
    // 重连前解绑旧 socket handlers 并主动关闭,防止其残留帧污染新连接、避免同 tab 残留两个活动连接
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; clearWatchdog(); try { ws.close(); } catch { /* 已关闭 */ } }
    ws = make(url);
    // 握手看门狗:超时未 onopen 判握手悬死(休眠恢复典型态,可能永不回调任何事件)。
    // 处理不依赖 onclose:解绑 handlers → 主动 close → 确定性推进 closed + 退避重连
    clearWatchdog();
    watchdog = setTimeout(() => {
      if (!ws || ws.readyState === WS_OPEN) return;
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* 已关闭 */ }
      opts.onStatus('closed');
      scheduleReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
    ws.onopen = () => { retry = 0; opts.onStatus('open'); flush(); kickWatchdog(); };
    ws.onmessage = (e: MessageEvent | { data: string }) => {
      kickWatchdog();   // 任意入站帧证明连接存活,重置看门狗
      const raw = (e as { data: string }).data;
      let ev: ServerEvent | null = null;
      try { ev = JSON.parse(raw) as ServerEvent; } catch { return; } // 容错:跳过非法帧
      // 应用层心跳:服务端每 ~20s 发 server.heartbeat 保活(浏览器发不了协议级 ping)。
      // 立即回 client.ping 作为存活证明——服务端据此放行/收口连接(koubou U3 missed-close)。
      // 瞬态帧:直发不入幂等队列(非命令),也不透传给 store(无 sequence、不进历史)。
      if (ev.type === 'server.heartbeat') {
        if (ws && ws.readyState === WS_OPEN) ws.send(JSON.stringify({ type: 'client.ping' }));
        return;
      }
      // 记住 session_id,供重连用恢复 URL;跟踪 lastSequence 供续传
      if (ev.session_id && !sessionId) sessionId = ev.session_id;
      if (typeof ev.sequence === 'number') afterSequence = ev.sequence;
      opts.onEvent(ev);
    };
    ws.onerror = () => opts.onStatus('error');
    ws.onclose = (e: CloseEvent | { code: number }) => {
      clearWatchdog();
      const code = (e as { code: number }).code ?? 1006;
      if (closedByUser) { opts.onStatus('closed'); return; }
      const action = classifyClose(code);
      if (action === 'superseded') { opts.onStatus('superseded'); return; }
      if (action === 'fatal') { opts.onStatus('fatal'); return; }   // 终态:与 ws.onerror 的瞬时 'error' 区分,避免抖动误报
      if (action === 'recreate') { sessionId = null; afterSequence = null; }
      // reauth / retry / recreate 均走指数退避重连(reauth 会重新 mintTicket),避免 4401 紧循环狂打 mintTicket
      opts.onStatus('closed');
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closedByUser) return;
    clearTimeout(timer);
    timer = setTimeout(() => void connect(), Math.min(1000 * 2 ** retry++, 8000));
  };

  // 冲刷积压命令:socket 未 open 时不发,留待下次 onopen;成功 send 的帧才出队
  const flush = () => {
    if (!ws || ws.readyState !== WS_OPEN) return;
    while (pending.length) {
      ws.send(JSON.stringify(pending[0]));
      pending.shift();
    }
  };

  // 入队一条客户端命令:分配幂等键 event_id(仅此一次),立即尝试冲刷;未 open 则积压
  const enqueue = (type: string, payload: unknown) => {
    pending.push({ type, payload, event_id: genId() });
    flush();
  };

  void connect();

  return {
    sendUserMessage: (message, parentToolUseId = null) =>
      enqueue('user.message', { message, parent_tool_use_id: parentToolUseId }),
    steer: (content) => enqueue('user.steer', { content }),
    interrupt: () => enqueue('run.interrupt', {}),
    approveTool: (interactionId, approved) => enqueue('tool.approval', { interaction_id: interactionId, approved }),
    answerQuestion: (interactionId, answers) => enqueue('ask_user_question.answer', { interaction_id: interactionId, answers }),
    setModel: (model) => enqueue('session.set_model', { model }),
    // 手动/唤醒重连:清零退避与 ticket 失败计数、解除用户关闭标记,立即重连(先 clearTimeout 防与在途退避竞态双连)
    reconnect: () => { closedByUser = false; retry = 0; ticketFails = 0; clearTimeout(timer); void connect(); },
    // 解绑 onmessage:切项目时 effect cleanup 调本方法,而此刻已入任务队列的那一帧仍会到达 ——
    // 它会被当成新项目的帧消化(消息进 ingestKoubou、快照按闭包 pid 落进**旧项目槽位**)。
    // **只解绑 onmessage**:onclose 里的 closedByUser 分支还要上报 'closed',
    // 照重连路径那样四个全解绑会把这个状态上报弄丢
    close: () => {
      closedByUser = true;
      clearTimeout(timer);
      clearWatchdog();
      if (ws) ws.onmessage = null;
      ws?.close();
    },
  };
}
