import { describe, expect, test, beforeAll } from 'vitest';
import i18n from './index';
import { resolveErrorMessage, classifyKoubouError, connErrorToast, koubouErrorDetail } from './errors';

beforeAll(async () => { await i18n.changeLanguage('en'); });

test('命中映射 → 返回译文', () => {
  expect(resolveErrorMessage('GEN_FAILED', '后端原文', i18n.t.bind(i18n))).toBe('Generation failed, please try again');
});
test('未命中映射 → 回退后端原 message', () => {
  expect(resolveErrorMessage('SOME_BACKEND_CODE', 'Backend says no', i18n.t.bind(i18n))).toBe('Backend says no');
});
test('映射存在但词条缺失 → 回退后端原 message', () => {
  expect(resolveErrorMessage('GHOST', 'fallback', i18n.t.bind(i18n))).toBe('fallback');
});

test('classifyKoubouError: 固定 message 命中 → 对应 code', () => {
  expect(classifyKoubouError({ message: 'run already active' })).toEqual({ code: 'RUN_ALREADY_ACTIVE', fallback: 'run already active' });
});
test('classifyKoubouError: 有 type(动态异常) → 通用 AGENT_RUN_ERROR', () => {
  expect(classifyKoubouError({ type: 'ValueError', message: 'boom' })).toEqual({ code: 'AGENT_RUN_ERROR', fallback: 'boom' });
});
test('classifyKoubouError: 未知 message 且无 type → 无 code,回退原文', () => {
  expect(classifyKoubouError({ message: 'weird thing' })).toEqual({ code: undefined, fallback: 'weird thing' });
});
test('classifyKoubouError: 空 payload → 默认 fallback', () => {
  expect(classifyKoubouError({})).toEqual({ code: undefined, fallback: 'agent error' });
});
test('新 koubou code 经 resolveErrorMessage 出译文', () => {
  expect(resolveErrorMessage('RUN_ALREADY_ACTIVE', 'fb', i18n.t.bind(i18n))).toBe('A run is already in progress. Wait for it to finish.');
});
test('PROJECT_IMPORTED 经 resolveErrorMessage 出译文', () => {
  expect(resolveErrorMessage('PROJECT_IMPORTED', 'New project created', i18n.t.bind(i18n))).toBe('New project created');
});
// COPIED 是 success 类 code。ErrorDetail 的「复制」发的是 { code: 'COPIED', message: '' } ——
// 缺词条时 resolveErrorMessage 回退到那个空 message,弹出一个有边框有图标、一个字都没有的 Toast。
// ERROR_KEYS 的值是裸字符串,tsc 管不到 —— 故留一条守护
test('COPIED 经 resolveErrorMessage 出译文,而不是回退到空 message', () => {
  expect(resolveErrorMessage('COPIED', '', i18n.t.bind(i18n))).toBe('Copied');
});
test('REPLAY_LOAD_FAILED 经 resolveErrorMessage 出译文(复用回放已有的 chat.replay.error 文案)', () => {
  expect(resolveErrorMessage('REPLAY_LOAD_FAILED', 'fb', i18n.t.bind(i18n))).toBe('Could not start the replay. Refresh to try again.');
});
test('seed 模型 flag 关闭的 503 出译文,而非后端英文原文', () => {
  expect(resolveErrorMessage('SEEDREAM_IMAGE_DISABLED', 'seedream image disabled', i18n.t.bind(i18n)))
    .toBe('Seedream is unavailable right now. Pick another model or try again later.');
  expect(resolveErrorMessage('SEEDAUDIO_SPEECH_DISABLED', 'seedaudio speech disabled', i18n.t.bind(i18n)))
    .toBe('Seed-Audio is unavailable right now. Pick another model or try again later.');
});
test('connErrorToast: superseded 弹 warning,fatal/其他不弹(fatal 走内联条)', () => {
  expect(connErrorToast('fatal')).toBeNull();
  expect(connErrorToast('superseded')).toEqual({ code: 'SESSION_SUPERSEDED', message: '', kind: 'warning' });
  expect(connErrorToast('open')).toBeNull();
});
test('stalled 不弹 toast(走内联条)', () => {
  expect(connErrorToast('stalled')).toBeNull();
});

// 插值:带参数的 Toast(如「模型已下架,已切到 X」)不必在 store 里拼好已翻译文案,
// 通道带一个可选 params 即可
describe('resolveErrorMessage 插值', () => {
  const t = ((key: string, params?: Record<string, unknown>) =>
    key === 'errors.modelRetired'
      ? `${params?.from} 已下架,已切到 ${params?.to}`
      : key) as unknown as Parameters<typeof resolveErrorMessage>[2];

  test('已知 code 带 params → 插值后的文案', () => {
    expect(resolveErrorMessage('MODEL_RETIRED', 'fallback', t, { from: 'A', to: 'B' }))
      .toBe('A 已下架,已切到 B');
  });

  test('不传 params 时行为不变', () => {
    expect(resolveErrorMessage('GEN_FAILED', 'fallback', t)).toBe('fallback');
  });

  test('未知 code 仍回退到 message', () => {
    expect(resolveErrorMessage('NOPE', 'fallback', t, { count: 3 })).toBe('fallback');
  });
});

// 上游原文透传(设计稿 2026-08-25):classifyKoubouError 出「稳定 code + 主行 fallback」,
// 这个出「给人看的完整原文」—— 命中 code 时译文会覆盖主行,原文只能靠这条通道带到 UI
describe('koubouErrorDetail', () => {
  test('有异常类名 → `Type: message`', () => {
    expect(koubouErrorDetail({ type: 'AnthropicOverloadedError', message: 'Overloaded' }))
      .toBe('AnthropicOverloadedError: Overloaded');
  });

  test('只有 message → 原样', () => {
    expect(koubouErrorDetail({ message: 'run already active' })).toBe('run already active');
  });

  test('只有 type → 只给 type', () => {
    expect(koubouErrorDetail({ type: 'TimeoutError' })).toBe('TimeoutError');
  });

  test('两者皆空 → undefined(不写空字段进快照)', () => {
    expect(koubouErrorDetail({})).toBeUndefined();
    expect(koubouErrorDetail({ message: '   ' })).toBeUndefined();
  });

  test('非字符串字段不臆测,按空处理', () => {
    expect(koubouErrorDetail({ message: 42, type: null })).toBeUndefined();
  });

  test('超长原文截断(detail 随 messages 落盘,不能把快照撑爆)', () => {
    const d = koubouErrorDetail({ message: 'x'.repeat(5000) });
    expect(d).toHaveLength(2001);
    expect(d?.endsWith('…')).toBe(true);
  });
});

// 上游/模型侧失败带**后端机器码**(koubou docs/websocket-events.md §上游/模型侧失败 +
// app/sessions/actor.py 的 MessageError.public()):payload 形如
// {code, message, api_error_status, retryable},没有 type。原始文本只进服务端 trace、
// 绝不下发 —— 所以 code + api_error_status 就是排障能拿到的全部信息
describe('后端机器码(上游/模型侧失败)', () => {
  test('classifyKoubouError 认 code,优先于文案匹配', () => {
    expect(classifyKoubouError({ code: 'upstream_unavailable', message: 'The service is temporarily busy. Please try again in a moment.' }))
      .toEqual({ code: 'upstream_unavailable', fallback: 'The service is temporarily busy. Please try again in a moment.' });
  });

  test('无 code 时仍走原有文案匹配 / type 兜底', () => {
    expect(classifyKoubouError({ message: 'run already active' }).code).toBe('RUN_ALREADY_ACTIVE');
    expect(classifyKoubouError({ type: 'ValueError', message: 'boom' }).code).toBe('AGENT_RUN_ERROR');
  });

  test('detail 带上 code 与上游 HTTP 状态码', () => {
    expect(koubouErrorDetail({ code: 'upstream_unavailable', api_error_status: 529, message: 'The service is temporarily busy.' }))
      .toBe('upstream_unavailable (HTTP 529): The service is temporarily busy.');
  });

  test('无 HTTP 状态码时只带 code(budget_exceeded 这类无上游状态)', () => {
    expect(koubouErrorDetail({ code: 'budget_exceeded', message: 'This run reached its cost limit.' }))
      .toBe('budget_exceeded: This run reached its cost limit.');
  });

  test('异常类名仍优先于 code(更具体)', () => {
    expect(koubouErrorDetail({ type: 'OrphanedRun', code: 'run_error', message: 'abandoned' }))
      .toBe('OrphanedRun: abandoned');
  });

  test('7 个后端 code 都有译文,不回落英文原句', () => {
    for (const code of ['upstream_unavailable', 'upstream_auth_failed', 'upstream_error', 'output_limit', 'budget_exceeded', 'execution_error', 'run_error']) {
      expect(resolveErrorMessage(code, 'RAW-FALLBACK', i18n.t.bind(i18n))).not.toBe('RAW-FALLBACK');
    }
  });
});
