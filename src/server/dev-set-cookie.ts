// 仅本地开发:把上游(LB/服务)响应的 Set-Cookie 重写成 localhost 可落地的形式,
// 让 LB 会话亲和 cookie 在浏览器落库、后续经 resolveForwardCookie 合并回传上游。
// 规则:去 Domain(host-only 落 localhost) / 去 Secure(本地 http) / SameSite=None→Lax(None 必须配 Secure)。
// 生产不启用(路由层按 DEV_COOKIE 存在与否门控),浏览器与上游同站,cookie 天然直达。
// 路由层接线:仅设 DEV_COOKIE(即本地开发)时,把上游全部 Set-Cookie 重写后附加到回传响应头。
// 不识别亲和 cookie 名(LB 生成名不可预知),全量回传;localhost 收到无关 cookie 无害。
export function appendDevSetCookies(out: Headers, upstream: Headers, devCookie: string | undefined): void {
  if (!devCookie?.trim()) return;
  for (const sc of upstream.getSetCookie()) out.append('set-cookie', rewriteSetCookieForDev(sc));
}

export function rewriteSetCookieForDev(setCookie: string): string {
  const [pair, ...attrs] = setCookie.split(';').map((s) => s.trim());
  const kept = attrs.filter((a) => {
    const name = a.split('=')[0].trim().toLowerCase();
    return name !== 'domain' && name !== 'secure';
  }).map((a) => (/^samesite=none$/i.test(a) ? 'SameSite=Lax' : a));
  return [pair, ...kept].join('; ');
}
