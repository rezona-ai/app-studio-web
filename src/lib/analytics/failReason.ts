import type { FailReason } from './events';

// 后端未定稿失败码(canvas failure.code / PgcError.code)→ GA4 fail_reason 枚举,按关键字模糊归类。
// 枚举"以实装为准",落点后同步数据团队核对(设计稿 §10)。
export function mapFailReason(code?: string): FailReason {
  const c = (code ?? '').toLowerCase();
  if (/credit|insufficient|balance/.test(c)) return 'insufficient_credit';
  if (/moderation|content|policy|blocked|nsfw/.test(c)) return 'content_blocked';
  if (/timeout|deadline|expired/.test(c)) return 'timeout';
  return 'server_error';
}
