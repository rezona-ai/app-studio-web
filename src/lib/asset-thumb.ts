// 资产缩略图来源的**唯一判据**(纯函数,无副作用)。
//
// 迁入后画布之外的几处缩略图各判一次类型,口径互不相同 —— 资产列表最严重:
// `dataUrl || src || poster` 一把梭喂给 <img>,而 video 的 src 是媒体流、3d 是 .glb,
// 于是视频 / 音频 / 3D 行全是碎图。判据收到这里一份,渲染壳各自去套
// (同「四个重试入口共用 retryRouteFor」那条纪律)。
//
// 口径逐类型对齐画布卡:
//   image  → ImageNode:dataUrl || src;取不到走类型占位图(它的 !loaded 分支就是占位图)
//   video  → VideoNode:poster 优先;无 poster 用媒体流首帧(#t=0.001 由渲染层拼)
//   3d     → ThreeDNode:只认 poster(后端 thumbnail_url sidecar),glb 绝不当图
//   audio  → AudioNode 是播放器、压根没有缩略图,故恒退类型占位图
//   text   → TextNode 显示正文;它也是唯一没有类型占位图的类型,故退类型图标
// 生成中 / 失败态一律退类型占位图,与 GeneratingPlaceholder / GenErrorBody 同一张底图 ——
// 拿上一轮的预览冒充产物会让「正在重生成」看起来像已经成了。
import type { Asset } from '@/store/types';
import { generatingPlaceholderPath, type AssetKind, type GeneratingAssetKind } from './asset-kind';

export type AssetThumbSource =
  /**
   * 当图渲染。`placeholder` 标记「这只是类型底图、不是这张卡的真实产物」——
   * 引用 chip 一类的调用方要据此退回「小图 + 名称」的 pill 形态(拿占位图当封面等于
   * 让四张不同的 text/无预览资产长成同一张脸,名称才是那里唯一的辨识信息)
   */
  | { mode: 'image'; src: string; placeholder?: true }
  /** 媒体流首帧:调用方按 VideoNode 的口径渲染 <video src="…#t=0.001" muted preload="metadata"> */
  | { mode: 'videoFrame'; src: string }
  /** 无图可用(仅 text):渲染该类型的图标 */
  | { mode: 'icon'; kind: AssetKind };

/** text 之外都有类型占位图 */
const placeholderOr = (kind: AssetKind): AssetThumbSource =>
  kind === 'text'
    ? { mode: 'icon', kind }
    : { mode: 'image', src: generatingPlaceholderPath(kind as GeneratingAssetKind), placeholder: true };

export function assetThumbSource(asset: Asset): AssetThumbSource {
  const { kind, preview } = asset;
  // 未就绪的卡不看 preview:占位卡可能带着上一轮的图,失败卡也可能留着旧 poster
  if (asset.status !== 'ready') return placeholderOr(kind);

  const self = preview?.dataUrl || preview?.src;
  switch (kind) {
    case 'image':
      return self ? { mode: 'image', src: self } : placeholderOr(kind);
    case 'video':
      if (preview?.poster) return { mode: 'image', src: preview.poster };
      return self ? { mode: 'videoFrame', src: self } : placeholderOr(kind);
    case '3d':
      return preview?.poster ? { mode: 'image', src: preview.poster } : placeholderOr(kind);
    case 'audio':
    case 'text':
      return placeholderOr(kind);
  }
}
