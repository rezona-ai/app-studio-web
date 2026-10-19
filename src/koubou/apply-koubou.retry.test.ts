import { describe, expect, test } from 'vitest';
import { applyKoubou, applyUserMessage, seedHistory } from './apply-koubou';
import { createInitialKoubouState } from '@/store/types';
import { sessionSnapshot } from '@/store/session-snapshot';
import type { KoubouState } from '@/store/types';
import type { ServerEvent } from './protocol';
import { MAX_AGENT_RETRIES, AUTO_RETRY_MARKER, AUTO_RETRY_CONTINUE, autoRetryPrompt } from '@/lib/agent-retry';

// 应用层自动重试的判定(设计稿 2026-08-25)。传输层重连只管「连接断了」,这套管
// 「连接开着、run 却失败了」—— 判定全在 reducer 内完成,发送这一步才落到 client hook。
const ev = (e: Partial<ServerEvent> & { type: string }): ServerEvent =>
  ({ project_id: '2', session_id: 's1', payload: {}, ...e }) as ServerEvent;

// 有可重发 payload 的初始态:用户手动发过一条消息(store 的 markPendingSend 记下的)
const S = (patch: Partial<KoubouState> = {}): KoubouState =>
  ({ ...createInitialKoubouState(), lastSend: { content: 'hi' }, ...patch });

// 让某个 run 已经吐过助手消息 —— lastMessageId 随之置位,是「本轮已有产出」的判据
const withAssistantOutput = (s: KoubouState, runId: string, seq: number): KoubouState =>
  applyKoubou(s, ev({
    type: 'claude.message', run_id: runId, sequence: seq,
    payload: { sdk_type: 'AssistantMessage', payload: { uuid: `u${seq}`, content: [{ type: 'text', text: '干活中' }] } },
  }));

const started = (s: KoubouState, runId: string, seq: number): KoubouState =>
  applyKoubou(s, ev({ type: 'run.started', run_id: runId, sequence: seq, payload: { run_id: runId } }));

// 默认样本用「后端明说可重试」的上游失败(限流 / 5xx):白名单口径下只有这类和孤儿 run 会自愈
const BUSY = { code: 'upstream_unavailable', message: 'The service is temporarily busy.', retryable: true };
const failed = (s: KoubouState, runId: string, seq: number, error: Record<string, unknown> = BUSY): KoubouState =>
  applyKoubou(s, ev({ type: 'run.finished', run_id: runId, sequence: seq, payload: { run_id: runId, status: 'failed', error } }));

describe('可重试性', () => {
  test('后端明说可重试的上游失败 → 不推气泡,置重试态', () => {
    const s = failed(started(S(), 'r1', 1), 'r1', 2);
    expect(s.messages).toHaveLength(0);
    expect(s.agentRetry).toMatchObject({
      attempt: 1, phase: 'waiting',
      text: 'The service is temporarily busy.',
      detail: 'upstream_unavailable: The service is temporarily busy.',
    });
  });

  test('Claude 执行异常不在白名单 → 落报错 + 手动重试,不自动重试', () => {
    const s = failed(started(S(), 'r1', 1), 'r1', 2, { type: 'ValueError', message: 'boom' });
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
  });

  test('业务错误 → 直接推正式错误气泡,不重试', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: { message: 'run already active' } }));
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ code: 'RUN_ALREADY_ACTIVE' });
  });

  test('孤儿 run 属瞬时故障 → 重试', () => {
    const s = failed(started(S(), 'r1', 1), 'r1', 2, { type: 'OrphanedRun', message: 'abandoned' });
    expect(s.agentRetry).toMatchObject({ attempt: 1 });
    expect(s.messages).toHaveLength(0);
  });

  test('无可重发 payload(刷新后 lastSend 丢失)→ 不重试', () => {
    const s = failed(started(createInitialKoubouState(), 'r1', 1), 'r1', 2);
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ detail: 'upstream_unavailable: The service is temporarily busy.' });
  });

  // 实测:无活动 run 时后端把 user.steer 当新消息照常起一轮 run(2026-08-25 浏览器验证),
  // 所以重发插话内容 = 重发用户那句话,语义正确 —— 插话不该因一次上游抖动就丢掉
  test('插话内容同样可重发,不再被排除在自愈之外', () => {
    const s = failed(started(S({ lastSend: { content: '把卡面改暗一点' } }), 'r1', 1), 'r1', 2);
    expect(s.agentRetry).toMatchObject({ attempt: 1, mode: 'resend' });
  });
});

describe('重试动作按 run 跑到哪一步分流', () => {
  test('本轮没吐过任何助手输出 → 原样重发', () => {
    const s = failed(started(S(), 'r1', 1), 'r1', 2);
    expect(s.agentRetry?.mode).toBe('resend');
  });

  test('本轮已有助手输出 → 改发 continue(不让 agent 从头重做已花过钱的部分)', () => {
    const s = failed(withAssistantOutput(started(S(), 'r1', 1), 'r1', 2), 'r1', 3);
    expect(s.agentRetry?.mode).toBe('continue');
  });

  test('应用层 error 事件无对应 run → 按没跑起来处理,原样重发', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: BUSY }));
    expect(s.agentRetry?.mode).toBe('resend');
  });

  test('mode 每次失败重判:先 resend,agent 吐了半句又崩 → 转 continue', () => {
    let s = failed(started(S(), 'r1', 1), 'r1', 2);
    expect(s.agentRetry?.mode).toBe('resend');
    s = failed(withAssistantOutput(started(s, 'r2', 3), 'r2', 4), 'r2', 5);
    expect(s.agentRetry).toMatchObject({ attempt: 2, mode: 'continue' });
  });
});

describe('次数上限与清态', () => {
  // 用 **error 事件** 驱动而非 run.finished{failed,error}:后端 live 的 run.finished 从不带
  // error(actor.py:1631),run 级失败的真实到达通道只有 error 事件。用不会出现的形状跑计数,
  // 覆盖会弱于表面(评审 M-6)
  const upstreamFail = (s: KoubouState, seq: number): KoubouState =>
    applyKoubou(s, ev({ type: 'error', sequence: seq, payload: BUSY }));

  test('连续失败累加 attempt,第 11 次落正式错误并清态', () => {
    let s = S();
    for (let i = 0; i < MAX_AGENT_RETRIES; i++) {
      s = upstreamFail(s, i + 1);
      expect(s.agentRetry?.attempt).toBe(i + 1);
      expect(s.messages).toHaveLength(0);
    }
    s = upstreamFail(s, 100);
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ detail: 'upstream_unavailable: The service is temporarily busy.' });
  });

  test('重试成功 → 清重试态', () => {
    let s = failed(started(S(), 'r1', 1), 'r1', 2);
    expect(s.agentRetry).not.toBeNull();
    s = applyKoubou(started(s, 'r2', 3), ev({ type: 'run.finished', run_id: 'r2', sequence: 4, payload: { run_id: 'r2', status: 'succeeded' } }));
    expect(s.agentRetry).toBeNull();
  });
});

// 后端已经算好了 retryable(koubou docs/websocket-events.md §上游/模型侧失败):
// upstream_unavailable=true,upstream_auth_failed / upstream_error / output_limit /
// budget_exceeded=false。前端自己那份白名单只是 retryable 缺失时的降级判据。
describe('以后端 retryable 为准', () => {
  const upstream = (code: string, retryable: boolean, status?: number) => ({
    code, retryable, message: 'sanitized upstream message', ...(status ? { api_error_status: status } : {}),
  });

  test('限流 / 5xx(retryable:true)→ 重试,且 detail 带 code 与状态码', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: upstream('upstream_unavailable', true, 529) }));
    expect(s.agentRetry).toMatchObject({ attempt: 1 });
    expect(s.messages).toHaveLength(0);
  });

  test('鉴权/计费失败(retryable:false)→ 零重试,直接落气泡', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: upstream('upstream_auth_failed', false, 401) }));
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({
      code: 'upstream_auth_failed',
      detail: 'upstream_auth_failed (HTTP 401): sanitized upstream message',
    });
  });

  test('其余 4xx / 成本超限 / 输出截断都不重试(重试只会继续烧钱或再被拒)', () => {
    for (const [i, code] of ['upstream_error', 'budget_exceeded', 'output_limit'].entries()) {
      const s = applyKoubou(S(), ev({ type: 'error', sequence: 10 + i, payload: upstream(code, false) }));
      expect(s.agentRetry, code).toBeNull();
      expect(s.agentError, code).not.toBeNull();
    }
  });

  test('run.finished{failed} 内嵌的上游 error 同样以 retryable 为准', () => {
    const s = applyKoubou(started(S(), 'r1', 1), ev({
      type: 'run.finished', run_id: 'r1', sequence: 2,
      payload: { run_id: 'r1', status: 'failed', error: upstream('upstream_auth_failed', false, 403) },
    }));
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ code: 'upstream_auth_failed' });
  });

  test('retryable 缺失时回落前端白名单:只有孤儿 run 自愈,其余落手动', () => {
    const orphan = failed(started(S(), 'r1', 1), 'r1', 2, { type: 'OrphanedRun', message: 'abandoned' });
    expect(orphan.agentRetry).toMatchObject({ attempt: 1 });
    const exc = applyKoubou(S(), ev({ type: 'error', sequence: 5, payload: { type: 'ValueError', message: 'boom' } }));
    expect(exc.agentRetry).toBeNull();
    const biz = applyKoubou(S(), ev({ type: 'error', sequence: 6, payload: { message: 'invalid model' } }));
    expect(biz.agentRetry).toBeNull();
  });
});

// 后端 live 的 run.finished payload **只有** {run_id, status},从不带 error
// (actor.py:1631、run_lifecycle.py:81 —— 孤儿的 {type:"OrphanedRun"} 只写 runs 表与 trace)。
// 于是终态帧必须自己把重试态收口,否则 agentRetry 永久停在 phase:'running':
// 进度气泡无限转圈,且所有错误气泡的手动重试按钮(判据含 agentRetry == null)一并消失。
describe('run 终态收口重试态', () => {
  const inflight = (s: KoubouState): KoubouState =>
    ({ ...s, agentRetry: { attempt: 1, mode: 'resend', phase: 'running', nextAt: null, text: 'boom' } });

  test('用户打断重试的 run → 清重试态,不推气泡(是用户自己停的)', () => {
    const s = applyKoubou(inflight(started(S(), 'r2', 1)), ev({ type: 'run.interrupted', run_id: 'r2', sequence: 2, payload: { run_id: 'r2' } }));
    expect(s.agentRetry).toBeNull();
    expect(s.messages.filter((m) => m.parts.some((p) => p.type === 'error'))).toHaveLength(0);
  });

  test('run.finished{interrupted} 同样清重试态', () => {
    const s = applyKoubou(inflight(started(S(), 'r2', 1)), ev({ type: 'run.finished', run_id: 'r2', sequence: 2, payload: { run_id: 'r2', status: 'interrupted' } }));
    expect(s.agentRetry).toBeNull();
  });

  test('run.finished{failed} 无 error(生产常态)→ 收口并补一条失败气泡', () => {
    const s = applyKoubou(inflight(started(S(), 'r2', 1)), ev({ type: 'run.finished', run_id: 'r2', sequence: 2, payload: { run_id: 'r2', status: 'failed' } }));
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).toMatchObject({ code: 'AGENT_RUN_ERROR' });
  });

  test('孤儿 run 的 tombstone 不再静默:属主 Pod 死掉时用户能看到失败与手动重试', () => {
    const s = applyKoubou(started(S(), 'r9', 1), ev({ type: 'run.finished', run_id: 'r9', sequence: 2, payload: { run_id: 'r9', status: 'failed' } }));
    expect(s.agentError).not.toBeNull();
  });

  // 生产常态的到达顺序是「error 事件 → 紧跟一条不带 error 的 run.finished{failed}」。
  // error 那步若已安排自愈,终态帧上的 errorReported 短路曾把 agentRetry 一并清成 null 且不补气泡 ——
  // 自动重试第一次就死,屏幕上还什么都不剩(无进度、无气泡、无手动入口,因为 canRetry 判据要有气泡)。
  test('error 已安排自愈 → 随后的 failed 终态帧不掐断它', () => {
    let s = applyKoubou(started(S(), 'r4', 1), ev({ type: 'error', run_id: 'r4', sequence: 2, payload: BUSY }));
    expect(s.agentRetry).toMatchObject({ attempt: 1, phase: 'waiting' });
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r4', sequence: 3, payload: { run_id: 'r4', status: 'failed' } }));
    expect(s.agentRetry).toMatchObject({ attempt: 1, phase: 'waiting' });
    expect(s.messages).toHaveLength(0);   // 也不该借机补第二条气泡:自愈还在跑
  });

  // 失败必须留痕这条不变式,不该靠逐条路径各自记得。清态与气泡二选一:要么自愈还挂着,要么屏幕上有错误
  test('不变式:终态帧过后,要么自愈还在,要么有可见错误气泡', () => {
    const arrivals: Array<[string, Record<string, unknown>]> = [
      ['error', BUSY],
      ['error', { code: 'upstream_auth_failed', message: 'auth failed', retryable: false }],
      ['error', { type: 'ValueError', message: 'boom' }],
    ];
    for (const [type, payload] of arrivals) {
      let s = applyKoubou(started(S(), 'r5', 1), ev({ type, run_id: 'r5', sequence: 2, payload }));
      s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r5', sequence: 3, payload: { run_id: 'r5', status: 'failed' } }));
      expect(s.agentRetry != null || s.agentError != null).toBe(true);
    }
  });

  // 固定槽只有一格,「推两条」已不可能;去重仍要守 —— 终态帧那步若拿自己那份兜底文案
  // (fallback:'run failed')覆盖一遍,用户看到的报错原因就从真实的上游文案退化成通用句
  test('本轮已由 error 事件报过错 → 终态帧不覆盖已有的报错原因', () => {
    let s = applyKoubou(started(S(), 'r3', 1), ev({
      type: 'error', run_id: 'r3', sequence: 2,
      payload: { code: 'upstream_auth_failed', message: 'auth failed', retryable: false },
    }));
    expect(s.agentError).toMatchObject({ code: 'upstream_auth_failed', text: 'auth failed' });
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r3', sequence: 3, payload: { run_id: 'r3', status: 'failed' } }));
    expect(s.agentError).toMatchObject({ code: 'upstream_auth_failed', text: 'auth failed' });
  });
});

// continue 重试是发给 agent 的机器指令,不是用户说的话。它真实落进后端事件日志(刻意的:
// agent 侧要看得见),所以刷新后必须在重建这一层滤掉 —— 否则历史里每自愈一次就多一个
// 「continue」用户气泡。判据是不可见哨兵前缀而非文本 'continue' 本身:用户自己打 continue 得留着。
describe('自动 continue 的哨兵前缀', () => {
  const umsg = (content: unknown, event_id?: string): ServerEvent =>
    ({ type: 'user.message', project_id: '2', session_id: 's1', event_id, payload: { message: { role: 'user', content } } }) as ServerEvent;
  const rebuiltFrom = (...msgs: unknown[]): KoubouState =>
    applyKoubou(S(), ev({ type: 'session.ready', payload: { session_id: 's1', visible_state: { messages: msgs } } }));
  const userTexts = (s: KoubouState): string[] =>
    s.messages.filter((m) => m.role === 'user').flatMap((m) => m.parts.map((p) => (p.type === 'text' ? p.text : '')));

  test('冷启动重建:带哨兵的 continue 不成泡', () => {
    const s = rebuiltFrom(umsg('做个跳跃游戏', 'evt_u1'), umsg(AUTO_RETRY_CONTINUE, 'evt_u2'));
    expect(userTexts(s)).toEqual(['做个跳跃游戏']);
  });

  test('用户自己打的 continue 照常成泡', () => {
    const s = rebuiltFrom(umsg('continue', 'evt_u1'), umsg('  Continue  ', 'evt_u2'));
    expect(userTexts(s)).toEqual(['continue', '  Continue  ']);
  });

  test('哨兵也认 content block 形态(后端回填成数组时)', () => {
    const s = rebuiltFrom(umsg([{ type: 'text', text: AUTO_RETRY_CONTINUE }], 'evt_u1'));
    expect(userTexts(s)).toEqual([]);
  });

  // 生产里真正的冷启动是 REST 最新一页种子化(session.ready 已不再带 visible_state),
  // 两条路共用 rebuild,但覆盖得落在真跑的那条上
  test('REST 种子化(seedHistory)同样滤掉', () => {
    const s = seedHistory(createInitialKoubouState(), {
      events: [umsg('做个跳跃游戏', 'evt_u1'), umsg(AUTO_RETRY_CONTINUE, 'evt_u2')],
      has_more: false, latest_sequence: 2,
    });
    expect(userTexts(s)).toEqual(['做个跳跃游戏']);
  });

  test('回放路径同口径:applyUserMessage 也滤掉,但 sequence 照常登记', () => {
    const e = { type: 'user.message', project_id: '2', session_id: 's1', event_id: 'evt_u3', sequence: 5,
      payload: { message: { role: 'user', content: AUTO_RETRY_CONTINUE } } } as unknown as ServerEvent;
    const s = applyUserMessage(createInitialKoubouState(), e);
    expect(s.messages).toHaveLength(0);
    expect(s.lastSequence).toBe(5);
  });

  // 判据是前缀而非整串相等 —— resend 模式重发的是用户原话,后半截是任意文本。
  // 代价是「以哨兵开头的用户输入会被吞掉」,所以哨兵取**两个**连续 U+2063:
  // 粘贴文本里出现一个不可见分隔符尚可想象,连着两个不可想象
  test('单个哨兵字符开头的用户输入不被误伤', () => {
    const s = rebuiltFrom(umsg('\u2063 只是粘来的怪字符', 'evt_u1'));
    expect(userTexts(s)).toEqual(['\u2063 只是粘来的怪字符']);
  });

  test('resend 重发的用户原话同样带哨兵,历史里不重复成泡', () => {
    const s = rebuiltFrom(umsg('做个跳跃游戏', 'evt_u1'), umsg(autoRetryPrompt('做个跳跃游戏'), 'evt_u2'));
    expect(userTexts(s)).toEqual(['做个跳跃游戏']);
  });

  test('哨兵作为独立 text block 前插时也认(带附件的 resend)', () => {
    const s = rebuiltFrom(umsg([{ type: 'text', text: AUTO_RETRY_MARKER }, { type: 'image' }, { type: 'text', text: '照这张改' }], 'evt_u1'));
    expect(userTexts(s)).toEqual([]);
  });

  test('前导空白不让哨兵漏滤(与打断哨兵同口径)', () => {
    const s = rebuiltFrom(umsg(`  ${AUTO_RETRY_CONTINUE}`, 'evt_u1'));
    expect(userTexts(s)).toEqual([]);
  });

  test('哨兵是不可见字符:去掉它就是干净的 continue 指令,agent 侧语义不变', () => {
    expect(AUTO_RETRY_CONTINUE.replace(AUTO_RETRY_MARKER, '')).toBe('continue');
    expect(AUTO_RETRY_MARKER.trim()).toBe(AUTO_RETRY_MARKER);   // 不是空白符,不会被 trim 吃掉
  });
});

// 重试发出后 run 真开跑 = 后端收到了这次自愈,红色进度气泡该立刻退场(不必等回合结束)。
// 但**状态不清空**:attempt 要留着,否则「起跑后再失败」每次都从 1 重数,10 次上限形同虚设。
describe('已有响应', () => {
  const retrying = (patch: Partial<KoubouState> = {}): KoubouState =>
    S({ agentRetry: { attempt: 3, mode: 'resend', phase: 'running', nextAt: null, text: 'busy', code: 'upstream_unavailable' }, ...patch });

  test('重试在跑时 run.started 到达 → 转 responded(气泡退场),attempt 不动', () => {
    const s = started(retrying(), 'r9', 1);
    expect(s.agentRetry).toMatchObject({ phase: 'responded', attempt: 3 });
  });

  // 生产常态路径:error 事件先到(run 级失败的真实到达通道),紧跟一条**不带 error** 的终态帧。
  // 用 run.finished{failed,error} 驱动会用上一个后端不会发的形状跑计数,覆盖弱于表面(上一轮评审 M-6)
  test('起跑后这一轮再失败 → 计数从 4 续,不归零', () => {
    const s = applyKoubou(started(retrying(), 'r9', 1), ev({ type: 'error', run_id: 'r9', sequence: 2, payload: BUSY }));
    expect(s.agentRetry).toMatchObject({ phase: 'waiting', attempt: 4 });
  });

  // 紧跟的终态帧走 errorReported 短路:不能再动 agentRetry,否则自愈第一次就被自己掐死
  test('error 事件后紧跟的终态帧不动刚排好的自愈', () => {
    let s = applyKoubou(started(retrying(), 'r9', 1), ev({ type: 'error', run_id: 'r9', sequence: 2, payload: BUSY }));
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r9', sequence: 3, payload: { run_id: 'r9', status: 'failed' } }));
    expect(s.agentRetry).toMatchObject({ phase: 'waiting', attempt: 4 });
    expect(s.messages).toHaveLength(0);
  });

  test('退避等待期的 run.started 不动 phase(那不是本次自愈的回声)', () => {
    const s = started(retrying({ agentRetry: { attempt: 3, mode: 'resend', phase: 'waiting', nextAt: 1, text: 'busy' } }), 'r9', 1);
    expect(s.agentRetry).toMatchObject({ phase: 'waiting' });
  });

  test('这一轮成功 → 照常清空重试态', () => {
    const s = applyKoubou(started(retrying(), 'r9', 1), ev({ type: 'run.finished', run_id: 'r9', sequence: 2, payload: { run_id: 'r9', status: 'succeeded' } }));
    expect(s.agentRetry).toBeNull();
  });
});

// 报错改成输入框上方的固定槽(设计稿 2026-08-27):落点从「messages 里的一条 error 消息」
// 换成瞬态字段 agentError,与 agentRetry 同一套生命周期 —— 同一时刻至多一条,不落盘。
describe('固定槽错误态', () => {
  const bizErr = (s: KoubouState, seq: number): KoubouState =>
    applyKoubou(s, ev({ type: 'error', sequence: seq, payload: { type: 'ValueError', message: 'boom' } }));

  test('不可重试的失败 → 置 agentError(主行 + code + 上游原文)', () => {
    const s = bizErr(S(), 1);
    expect(s.agentError).toMatchObject({ text: 'boom', code: 'AGENT_RUN_ERROR', detail: 'ValueError: boom' });
  });

  test('build.failed 走同一个槽', () => {
    const s = applyKoubou(S(), ev({ type: 'build.failed', sequence: 1 }));
    expect(s.agentError).toMatchObject({ code: 'BUILD_FAILED' });
  });

  test('与 agentRetry 互斥:落正式错误即清自愈态', () => {
    const s = bizErr(S({ agentRetry: { attempt: 2, mode: 'resend', phase: 'waiting', nextAt: null, text: 'x' } }), 1);
    expect(s.agentRetry).toBeNull();
    expect(s.agentError).not.toBeNull();
  });

  test('新一轮开跑即清(run.started)', () => {
    const s = started(bizErr(S(), 1), 'r1', 2);
    expect(s.agentError).toBeNull();
  });

  test('回合成功即清', () => {
    let s = started(bizErr(S(), 1), 'r1', 2);
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, payload: { run_id: 'r1', status: 'succeeded' } }));
    expect(s.agentError).toBeNull();
  });

  test('用户打断即清', () => {
    let s = started(S(), 'r1', 1);
    s = { ...s, agentError: { text: 'boom' } };
    s = applyKoubou(s, ev({ type: 'run.interrupted', run_id: 'r1', sequence: 2, payload: { run_id: 'r1' } }));
    expect(s.agentError).toBeNull();
  });

  // 与 agentRetry 同为瞬态:重发 payload(lastSend)跨不了刷新,留一条不能操作的红条更糟
  test('不进会话快照', () => {
    const s = bizErr(S(), 1);
    expect(Object.keys(sessionSnapshot(s, 'sess1'))).not.toContain('agentError');
  });
});

// T3 删旧:报错只写固定槽,不再往对话流里 append 消息
describe('报错不再进对话流', () => {
  test('不可重试的失败 → messages 长度不变', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: { type: 'ValueError', message: 'boom' } }));
    expect(s.messages).toHaveLength(0);
    expect(s.agentError).not.toBeNull();
  });

  test('次数耗尽 → 同样只落固定槽', () => {
    let s = S();
    for (let i = 0; i < MAX_AGENT_RETRIES + 1; i++) s = applyKoubou(s, ev({ type: 'error', sequence: i + 1, payload: BUSY }));
    expect(s.agentRetry).toBeNull();
    expect(s.messages).toHaveLength(0);
    expect(s.agentError).toMatchObject({ detail: 'upstream_unavailable: The service is temporarily busy.' });
  });

  // 上一轮那条不变式:终态帧过后失败必须**看得见**。落点从「对话流里有错误气泡」
  // 换成「固定槽有报错」,判据跟着换 —— 不换的话这条守卫会在新机制下静默失效
  test('不变式:终态帧过后,要么自愈还在,要么固定槽有报错', () => {
    let s = applyKoubou(started(S(), 'r1', 1), ev({ type: 'error', run_id: 'r1', sequence: 2, payload: { type: 'ValueError', message: 'boom' } }));
    s = applyKoubou(s, ev({ type: 'run.finished', run_id: 'r1', sequence: 3, payload: { run_id: 'r1', status: 'failed' } }));
    expect(s.agentRetry != null || s.agentError != null).toBe(true);
  });
});

// 评审 I-1/I-2:互斥不能只靠渲染层那道防线,否则报错会被静默吞掉
describe('固定槽与自愈态的互斥', () => {
  test('安排自愈时清掉上一条报错(状态层互斥)', () => {
    const s = applyKoubou(S({ agentError: { text: '上一条' } }), ev({ type: 'error', sequence: 1, payload: BUSY }));
    expect(s.agentRetry).not.toBeNull();
    expect(s.agentError).toBeNull();
  });

  test('自愈已被受理(responded)期间的报错照样写进固定槽', () => {
    let s = S({ agentRetry: { attempt: 2, mode: 'resend', phase: 'running', nextAt: null, text: 'x' } });
    s = started(s, 'r7', 1);                     // → responded
    s = applyKoubou(s, ev({ type: 'build.failed', sequence: 2, payload: { stage: 'validate' } }));
    expect(s.agentError).toMatchObject({ code: 'BUILD_FAILED' });
  });
});

// 模型侧不可重试失败要在固定槽引导换模型(设计稿 2026-09-03):reducer 只记「后端说了不可重试」
// 这个事实,该不该弹卡由 selector 结合模型列表 / 门禁判定 —— reducer 看不到那些状态
describe('retryable:false 的事实进 agentError', () => {
  const upstream = (code: string, retryable: boolean) => ({ code, retryable, message: 'sanitized' });

  test('后端 retryable:false → agentError.retryable === false', () => {
    const s = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: upstream('upstream_error', false) }));
    expect(s.agentError).toMatchObject({ code: 'upstream_error', retryable: false });
  });

  test('run.finished{failed} 内嵌 retryable:false 同样记事实', () => {
    const s = applyKoubou(started(S(), 'r1', 1), ev({
      type: 'run.finished', run_id: 'r1', sequence: 2,
      payload: { run_id: 'r1', status: 'failed', error: upstream('budget_exceeded', false) },
    }));
    expect(s.agentError).toMatchObject({ retryable: false });
  });

  test('retryable 缺失 / 自愈耗尽后的报错不带该字段(形状一致,不冒充模型侧失败)', () => {
    const biz = applyKoubou(S(), ev({ type: 'error', sequence: 1, payload: { message: 'invalid model' } }));
    expect(biz.agentError).not.toHaveProperty('retryable');
    let s = S();
    for (let i = 0; i <= MAX_AGENT_RETRIES; i++) s = applyKoubou(s, ev({ type: 'error', sequence: i + 1, payload: BUSY }));
    expect(s.agentError).not.toBeNull();
    expect(s.agentError).not.toHaveProperty('retryable');
  });
});
