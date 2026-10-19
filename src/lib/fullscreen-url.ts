/**
 * 全屏预览页链接：`{basePath}/full/{pid}/{vid}?seq={n}`。
 *
 * 供工作台「全屏展示」在点击的同步栈内 `window.open` —— 不 await 任何请求，页签一开就落到我们自己的
 * 页面上，加载态由该页首帧渲染（预览地址在页内解析）。basePath 在调用时读 env（而非模块常量），
 * 与 `buildSharePageUrl` 一致，便于测试 stub。
 *
 * `seq` 即 `Version.index`：全屏页用它拼本地 Koubou 调试直链，并作加载文案的版本名。
 * 缺 pid / version 时返回 null，调用方据此禁用按钮。
 */
export function buildFullscreenUrl(
  pid: number | null | undefined,
  version: { id: string; index: number } | null | undefined,
): string | null {
  if (pid == null || !version?.id) return null;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  return `${basePath}/full/${pid}/${encodeURIComponent(version.id)}?seq=${version.index}`;
}
