// 本地 Koubou 调试:本地游戏预览静态路由。
// 本地 koubou 把版本快照写在本机磁盘(LOCAL_GAME_ROOT={data_root}/{user}/workspaces),
// dev PGC 的 bucket 里没有这些 dist,故预览在本地模式下改走本路由直读磁盘。
// 仅本地调试启用:LOCAL_GAME_ROOT 未配置时一律 404。路径经 resolveLocalPreviewRelPath
// 白名单校验({pid}/v{n}/dist/**、段内禁 ./..)后再做 root 包含性复核,双重防穿越。
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { resolveLocalPreviewRelPath, contentTypeFor, parseVersionDirNames, type LocalVersionItem } from '@/lib/local-preview';

export const dynamic = 'force-dynamic';

const notFound = () =>
  new Response(JSON.stringify({ success: false, code: 'NOT_FOUND', message: 'local preview not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const root = process.env.LOCAL_GAME_ROOT;
  if (!root) return notFound();
  const { path } = await ctx.params;
  // 版本列表:GET /{pid}/versions —— 扫描 {root}/{pid} 下 v{n}/dist/index.html 齐备的快照。
  // 本地 koubou 的 checkpoint 只落磁盘、不在 PGC 登记版本,故本地模式版本列表以磁盘为准
  if (path?.length === 2 && /^\d+$/.test(path[0]) && path[1] === 'versions') {
    return listLocalVersions(root, path[0]);
  }
  const rel = resolveLocalPreviewRelPath(path ?? []);
  if (!rel) return notFound();
  const rootAbs = resolve(root);
  const fileAbs = resolve(rootAbs, rel);
  if (!fileAbs.startsWith(rootAbs + sep)) return notFound(); // 包含性复核(防符号/边界意外)
  try {
    const data = await readFile(fileAbs);
    return new Response(new Uint8Array(data), {
      status: 200,
      // 本地调试不缓存:重新 checkpoint 同号版本(理论上不可变,但调试期以磁盘为准)即时生效
      headers: { 'content-type': contentTypeFor(rel), 'cache-control': 'no-store' },
    });
  } catch {
    return notFound();
  }
}

async function listLocalVersions(root: string, pid: string): Promise<Response> {
  const dir = join(resolve(root), pid);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    names = []; // 项目目录不存在 = 尚无本地版本,返回空列表而非 404(与 PGC 语义一致)
  }
  const items: LocalVersionItem[] = [];
  for (const n of parseVersionDirNames(names)) {
    try {
      const s = await stat(join(dir, `v${n}`, 'dist', 'index.html')); // 只收 dist 齐备的快照
      items.push({ version: n, created_at: s.mtime.toISOString() });
    } catch {
      // dist 缺失(checkpoint 中断)跳过
    }
  }
  return new Response(JSON.stringify({ success: true, data: { items } }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
