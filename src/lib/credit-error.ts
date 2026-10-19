// 后端未定稿积分不足错误码,按关键字模糊识别(code 或 failure.code 含 CREDIT/INSUFFICIENT,忽略大小写)。
// 命中者由 guard 分流到积分不足模态,不走 Toast(见设计稿 2026-07-05)。
const CREDIT_RE = /credit|insufficient/i;

export function isCreditError(e: { code: string; failure?: { code: string } | null }): boolean {
  return CREDIT_RE.test(e.code) || (e.failure != null && CREDIT_RE.test(e.failure.code));
}
