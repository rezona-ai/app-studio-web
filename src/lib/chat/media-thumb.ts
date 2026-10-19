import type { MediaItem } from '@/koubou/protocol';
import type { Asset } from '@/store/types';
import type { AssetKind } from '@/lib/asset-kind';
import { basename, mediaKindToAssetKind } from '@/lib/media-import';

// 只有图片能拿 previewUrl 直接当缩略图;视频/音频的 previewUrl 是媒体流本身,
// 3D 是 .glb —— 这三类走画布 poster 反查,查不到由调用方回退类型占位图
const SELF_THUMB: AssetKind[] = ['image'];

// 剥 query/hash 后取文件名(签名直链带 ?sig=…)
const fileOf = (url: string): string => basename(url.split(/[?#]/)[0]);

export interface MediaThumbSource { kind: AssetKind; src?: string }

// 对话内一条工具产出媒体的缩略图来源。src 缺省 = 拿不到图,由调用方回退类型图标。
//
// 3D 的 previewUrl 指向 .glb 本身(工具结果契约只有 asset_path/preview_url,无缩略图字段),
// 不能当图渲染;模型那张预览图是 PGC 落画布时产出的 sidecar(CanvasItemData.thumbnail_url
// → Asset.preview.poster),只在画布资产上有。故按文件名 join 画布资产取 poster——
// 值级启发式,命中不了就回退图标,不臆造后端字段。后端若在工具结果里补 thumbnail_url,
// 这里可退化为直读。
export function mediaThumb(item: MediaItem, assets: readonly Asset[]): MediaThumbSource {
  const kind = mediaKindToAssetKind(item.kind);
  if (item.previewUrl && SELF_THUMB.includes(kind)) return { kind, src: item.previewUrl };
  const file = fileOf(item.path);
  const poster = assets.find((a) => {
    const url = a.preview?.src ?? a.preview?.dataUrl;
    return !!url && fileOf(url) === file;
  })?.preview?.poster;
  return poster ? { kind, src: poster } : { kind };
}
