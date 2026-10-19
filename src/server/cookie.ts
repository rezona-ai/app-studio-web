// 解析转发给上游(pgc/koubou)的 Cookie 头,用于 cookie 制鉴权(biz-api 统一鉴权)。
//
// 生产:浏览器在 *.rezona.ai/game 下与 BFF 同源,自动携带 .rezona.ai 的 session cookie,
//        这里原样透传 incoming。部署环境不设 DEV_COOKIE。
// 本地开发:浏览器在 localhost,拿不到 .rezona.ai 域 cookie。设置 DEV_COOKIE 后与请求自带
//        cookie 合并转发:DEV_COOKIE 的键优先(残留 cookie 不得覆盖鉴权),浏览器其余键
//        (含代理回传落地的 LB 亲和 cookie,见 dev-set-cookie.ts)追加在后打通会话亲和。

// 拆 Cookie 头为 [名, 原始段] 列表,容忍空白段与多余分号
function splitPairs(header: string): Array<[string, string]> {
  return header
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const eq = seg.indexOf('=');
      return [eq === -1 ? seg : seg.slice(0, eq).trim(), seg];
    });
}

export function resolveForwardCookie(
  incoming: string | null | undefined,
  devCookie: string | undefined,
): string | undefined {
  const dev = devCookie?.trim();
  const got = incoming?.trim();
  if (!dev) return got || undefined;
  if (!got) return dev;
  const devPairs = splitPairs(dev);
  const devNames = new Set(devPairs.map(([n]) => n));
  const rest = splitPairs(got).filter(([n]) => !devNames.has(n));
  return [...devPairs, ...rest].map(([, seg]) => seg).join('; ');
}
