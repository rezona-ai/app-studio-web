// 本地 Koubou 调试:本地游戏预览的纯逻辑(路径校验/归一 + content-type 映射)。
// 本地 koubou 把版本快照写在本机磁盘({workspaces}/{pid}/v{n}/dist/),dev PGC 的 bucket 里没有,
// 预览改走本服务的 /api/local-preview/* 静态路由(见 src/app/api/local-preview/[...path]/route.ts)。
// 纯函数、无 IO:文件读取由 route 负责。

// URL 段 → 相对路径:仅放行 {纯数字 pid}/v{n}/dist/{文件路径},段内禁 . / .. 与路径分隔符(防穿越)
export function resolveLocalPreviewRelPath(segments: string[]): string | null {
  if (segments.length < 4) return null;
  const [pid, ver, dist, ...rest] = segments;
  if (!/^\d+$/.test(pid)) return null;
  if (!/^v\d+$/.test(ver)) return null;
  if (dist !== 'dist') return null;
  for (const seg of rest) {
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) return null;
  }
  return [pid, ver, dist, ...rest].join('/');
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  wasm: 'application/wasm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
};

export function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

// 目录名列表 → 版本号升序(仅取 v{n} 形目录);扫描 IO 由 route 负责
export function parseVersionDirNames(names: string[]): number[] {
  return names
    .map((n) => /^v(\d+)$/.exec(n)?.[1])
    .filter((m): m is string => m != null)
    .map(Number)
    .sort((a, b) => a - b);
}

// 本地版本列表端点的响应项(与 route/前端共享形状)
export interface LocalVersionItem { version: number; created_at: string }
