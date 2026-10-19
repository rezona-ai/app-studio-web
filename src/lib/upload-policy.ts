// 上传校验策略:按场景配置允许类型/大小/数量,供对话窗与画布共用。
import type { TFunction } from 'i18next';
import type { AssetKind } from '@/lib/asset-kind';
import { mimeToAssetKind } from '@/lib/media-import';

// 上传场景:对话窗附件 / 画布资产(后续可加更多)
export type UploadSurface = 'chat' | 'canvas';

export interface UploadPolicy {
  accept: readonly string[];   // 允许的 MIME(只读:防止共享数组被误 push)
  acceptExtensions?: readonly string[];  // 按文件名扩展名(小写无点)额外放行:glb/gltf 等浏览器常给空/octet-stream MIME 的类型
  maxBytes: number;   // 单文件兜底上限(原始字节);无 per-kind 覆盖时用
  maxBytesByKind?: Partial<Record<AssetKind, number>>;  // 按 kind 覆盖上限(image/video/audio/3d),对齐后端 per-kind 限额
  maxBytesByMime?: Record<string, number>;  // 按完整 MIME 覆盖上限(优先于 kind):PDF 归 text kind 但限额 20MB,与 md/txt 的 1MB 不同
  maxCount?: number;  // 附件总数上限(含已暂存 existingCount,按实际放行数算名额);省略=不限
}

// 模型支持的图片格式(JPEG/PNG/GIF/WebP)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// 模型/平台支持的视频、音频格式(与画布上传端点一致:image/video/audio)
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/webm'];
// 文本资产(text 卡):md/纯文本,1MB 足够(后端契约同步提)。
// 导出供上传分流复用:命中即读内容走专用 text 接口,扩容时两处自动同步
export const TEXT_MIMES = ['text/markdown', 'text/plain'];
// PDF 文档:上传落画布桶(type=pdf),发送时折叠为 @[document]<url> token 交 agent 经 understand_media 理解;后端限额 20MB
export const PDF_MIMES = ['application/pdf'];
// 3D 模型(glb/gltf):上传落画布桶(type=model3d);浏览器对 glb 常给空/octet-stream MIME,
// 故 accept 挂标准 MIME 的同时靠 MODEL3D_EXTS 扩展名兜底放行。后端限额 100MB。
export const MODEL3D_MIMES = ['model/gltf-binary', 'model/gltf+json'];
export const MODEL3D_EXTS = ['glb', 'gltf'];

const MB = 1_000_000;

// 上传端点放行的全部媒体类型(不含 3D:3D 走 canvas 面单独放行 + 扩展名兜底)
const MEDIA_MIMES = [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES];
// 按 kind 限额对齐后端(PGC Upload Canvas Item:图片 20MB、视频/音频 20MB、3D 100MB);兜底 maxBytes 取 100MB
const UPLOAD_LIMITS: Partial<Record<AssetKind, number>> = { image: 20 * MB, video: 20 * MB, audio: 20 * MB, text: 1 * MB, '3d': 100 * MB };
// PDF 归 text kind(图标/渲染复用文本形态)但限额对齐后端 max_pdf_bytes=20MB,故走 MIME 级覆盖
const MIME_LIMITS: Record<string, number> = { 'application/pdf': 20 * MB };

// 两个 surface 共享五种文件类型与限额，避免 chat/canvas 后续漂移。
// chat 只额外放行 PDF：PDF 折叠为 @[document]<url> token，md/txt 读内容内联进正文。
const SHARED_FILE_POLICY = {
  accept: [...MEDIA_MIMES, ...TEXT_MIMES, ...MODEL3D_MIMES],
  acceptExtensions: MODEL3D_EXTS,
  maxBytesByKind: UPLOAD_LIMITS,
} satisfies Pick<UploadPolicy, 'accept' | 'acceptExtensions' | 'maxBytesByKind'>;

export const UPLOAD_POLICY: Record<UploadSurface, UploadPolicy> = {
  chat: { ...SHARED_FILE_POLICY, accept: [...SHARED_FILE_POLICY.accept, ...PDF_MIMES], maxBytes: 100 * MB, maxBytesByMime: MIME_LIMITS, maxCount: 5 },
  canvas: { ...SHARED_FILE_POLICY, maxBytes: 100 * MB },
};

export type RejectReason = 'type' | 'size' | 'count';
export interface FileReject {
  file: File;
  reason: RejectReason;
}
export interface ValidateResult {
  accepted: File[];
  rejected: FileReject[];
}

// 取文件名扩展名(小写无点);无扩展名返回空串
function fileExt(file: File): string {
  return file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
}

// 文件是否被策略放行:MIME 命中 accept,或扩展名命中 acceptExtensions(glb 等浏览器常给空/octet-stream MIME)。
// 3D 文件(glb/gltf)只能经 acceptExtensions 放行——JSON glTF 可能带 text/plain MIME,若靠 MIME 混入,
// 会绕过"某面是否支持 3D"的判定(如 chat 面只支持 canvas 3D),故对 3D 扩展名一律只认 acceptExtensions。
function isTypeAccepted(file: File, policy: UploadPolicy): boolean {
  const ext = fileExt(file);
  if (MODEL3D_EXTS.includes(ext)) return policy.acceptExtensions?.includes(ext) ?? false;
  if (policy.accept.includes(file.type)) return true;
  return policy.acceptExtensions?.includes(ext) ?? false;
}

// 文件对应 AssetKind:扩展名优先(glb/gltf→3d),再回落 MIME——与后端"content-type 不足按扩展名兜底"一致
function kindForFile(file: File): AssetKind {
  const ext = fileExt(file);
  if (ext === 'glb' || ext === 'gltf') return '3d';
  return mimeToAssetKind(file.type);
}

// 单文件适用上限:MIME 级覆盖 > kind 级覆盖(扩展名兜底) > 兜底 maxBytes
function limitForFile(file: File, policy: UploadPolicy): number {
  return (
    policy.maxBytesByMime?.[file.type] ??
    policy.maxBytesByKind?.[kindForFile(file)] ??
    policy.maxBytes
  );
}

// 按策略筛选文件。existingCount=已暂存附件数,计入总额。校验顺序:名额(已放行 existingCount+accepted)用尽则记 'count';
// 否则逐个 type → size(按 kind 取上限)。名额按"实际放行数"算——被 type/size 拒的文件不占额。
export function validateUpload(files: File[], policy: UploadPolicy, existingCount = 0): ValidateResult {
  const accepted: File[] = [];
  const rejected: FileReject[] = [];
  files.forEach((file) => {
    if (policy.maxCount != null && existingCount + accepted.length >= policy.maxCount) {
      rejected.push({ file, reason: 'count' });
    } else if (!isTypeAccepted(file, policy)) {
      rejected.push({ file, reason: 'type' });
    } else if (file.size > limitForFile(file, policy)) {
      rejected.push({ file, reason: 'size' });
    } else {
      accepted.push(file);
    }
  });
  return { accepted, rejected };
}

// 已知 MIME 的友好名;未知回退为子类型大写
const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WebP',
  'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV',
  'audio/mpeg': 'MP3', 'audio/wav': 'WAV', 'audio/ogg': 'OGG', 'audio/aac': 'AAC',
  'text/markdown': 'Markdown', 'text/plain': 'TXT',
  'application/pdf': 'PDF',
  'model/gltf-binary': 'GLB', 'model/gltf+json': 'glTF',
};

// 放行类型的友好名清单:accept MIME + acceptExtensions(扩展名大写),去重
function formatList(policy: UploadPolicy): string {
  const fromMime = policy.accept.map((m) => MIME_LABELS[m] ?? (m.split('/')[1] ?? m).toUpperCase());
  const fromExt = (policy.acceptExtensions ?? []).map((e) => e.toUpperCase());
  return Array.from(new Set([...fromMime, ...fromExt])).join(', ');
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

// 生成 <input accept> 属性值,如 'image/jpeg,...,.glb,.gltf'。
// 附上 acceptExtensions(带点)——glb 浏览器常无标准 MIME,靠扩展名让文件选择器放行。
export function acceptAttr(policy: UploadPolicy): string {
  const exts = (policy.acceptExtensions ?? []).map((e) => `.${e}`);
  return [...policy.accept, ...exts].join(',');
}

// 把拒绝结果转成本地化提示(按原因聚合,带文件名),配合 Toast;注入 t 以支持多语言
export function rejectMessage(rejected: FileReject[], policy: UploadPolicy, t: TFunction): string {
  if (rejected.length === 0) return '';
  const names = (reason: RejectReason) =>
    rejected.filter((r) => r.reason === reason).map((r) => r.file.name).join(', ');
  const parts: string[] = [];
  if (rejected.some((r) => r.reason === 'type')) {
    parts.push(t('errors.upload.wrongType', { names: names('type'), allowed: formatList(policy) }));
  }
  if (rejected.some((r) => r.reason === 'size')) {
    // 上限按 kind 不同,逐文件标注各自适用上限
    const list = rejected
      .filter((r) => r.reason === 'size')
      .map((r) => `${r.file.name} (max ${formatBytes(limitForFile(r.file, policy))})`)
      .join(', ');
    parts.push(t('errors.upload.tooLarge', { list }));
  }
  if (rejected.some((r) => r.reason === 'count')) {
    parts.push(t('errors.upload.tooMany', { names: names('count'), max: policy.maxCount }));
  }
  return parts.join(' ');
}
