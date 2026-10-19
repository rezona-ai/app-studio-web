import { newId } from './ids';
import type { Asset, AssetSource, AssetPreviewData } from '@/store/types';
import type { AssetKind } from '@/lib/asset-kind';

// 本地新建资产时的默认显示名(英文);与 asset-kind.ts 的 KIND_LABEL(中文筛选标签)职责不同
const KIND_DEFAULT_LABEL: Record<AssetKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  '3d': '3D World',
  text: 'Text',
};

export interface NewAssetOpts {
  label?: string;
  source?: AssetSource;
  preview?: AssetPreviewData;
  position?: { x: number; y: number };
}

// 本地新增资产工厂:id=key
export function makeAsset(kind: AssetKind, opts: NewAssetOpts = {}): Asset {
  const id = newId('a');
  return {
    id,
    key: id,
    label: opts.label ?? KIND_DEFAULT_LABEL[kind],
    kind,
    source: opts.source ?? 'generated',
    status: 'ready',
    position: opts.position ?? { x: 0, y: 0 },
    preview: opts.preview,
  };
}

// 文本及未知归 text;真正的类型拦截由 upload-policy accept 白名单负责
export function kindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('model/')) return '3d';
  return 'text';
}

// 从上传 File 推断画布 AssetKind:优先文件名扩展名(glb/gltf→3D),再回落 MIME。
// 浏览器对 glb 常给空/application/octet-stream 的 type,单靠 MIME 会误判为 text,故先看扩展名。
export function kindFromFile(file: File): AssetKind {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'glb' || ext === 'gltf') return '3d';
  return kindFromMime(file.type);
}
