// 登录跳转的纯逻辑:localhost 判定 + sign-in URL 拼接。副作用(整页跳转)见 client/useAuthGuard。

/** localhost 判定:本地开发不跳转 sign-in(跨域 + 登录后 cookie 落 .rezona.ai,localhost 读不到会死循环)
    IPv6 回环两种写法都收:`location.hostname` 对 `http://[::1]:5173` 报的是**带方括号**的 `[::1]`,
    裸 `::1` 在浏览器里永远不出现——只认裸形态时这条分支从来没生效过。裸形态保留,以防非浏览器调用方传它。 */
export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname.endsWith('.localhost');
}

/** 拼 sign-in 跳转地址。origin 取 window.location.origin(生产本应用与主站同源,自动适配 devlab/prod);
    sign-in 在主站 /studio 下,不带本应用 basePath。returnHref 用完整 href(含 basePath 与 ?project=),登录后原样回跳。 */
export function buildSignInUrl(origin: string, returnHref: string): string {
  return `${origin}/studio/sign-in?redirect=${encodeURIComponent(returnHref)}`;
}
