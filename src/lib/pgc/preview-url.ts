import { pgcApi } from './client';
import { apiPath } from '@/lib/basePath';

/**
 * 解析某版本的可浏览预览地址。工作台右栏（store action `previewVersionById`）与
 * 全屏页（独立文档，没有 store）共用这一份分流逻辑，避免两处各写一遍 dev 分支。
 *
 * 本函数无副作用、不吞错：REST 失败照抛，由调用方决定收敛成 Toast（store）还是页内提示（全屏页）。
 */
export async function resolvePreviewUrl(
  { pid, vid, seq }: { pid: number; vid: string; seq?: number | null },
): Promise<string> {
  // 本地 Koubou 调试:版本 dist 在本机磁盘(dev PGC bucket 没有),预览改走本服务
  // /api/local-preview 静态路由(v{seq} 即 Version.index,对应 checkpoint 快照目录)
  if (process.env.NEXT_PUBLIC_KOUBOU_BASE_URL && seq != null) {
    return apiPath(`/api/local-preview/${pid}/v${seq}/dist/index.html`);
  }
  return (await pgcApi.previewVersion(pid, vid)).preview_url;
}
