// 剪贴板 → 待上传文件的纯逻辑(对话栏与画布共用)。
// 只负责「取出文件 + 补齐文件名」,类型/限额校验仍归 upload-policy,落库归 store action。

// MIME 子类型 → 扩展名:仅列子类型与扩展名不同的,其余直接取子类型(png/webp/mp4/wav...)
const EXT_ALIAS: Record<string, string> = {
  jpeg: 'jpg',
  quicktime: 'mov',
  mpeg: 'mp3',
  markdown: 'md',
  plain: 'txt',
  'gltf-binary': 'glb',
  'gltf+json': 'gltf',
};

// 按 MIME 生成兜底文件名。剪贴板文件在部分浏览器给空名,而后端与 kindFromFile 都依赖扩展名兜底
// (glb 常无标准 MIME、图片 MIME 亦可能缺失),故补名而非原样透传空名。
function fallbackName(type: string): string {
  const sub = type.split('/')[1] ?? '';
  if (!sub) return 'pasted';
  return `pasted.${EXT_ALIAS[sub] ?? sub}`;
}

// 文件名为空时按 MIME 重建同内容的 File(File 名只读,必须新建);有名则原样返回
function withName(file: File): File {
  if (file.name) return file;
  return new File([file], fallbackName(file.type), { type: file.type });
}

// 从剪贴板 DataTransfer 取待上传文件。
// files 有内容时以它为准,不再合并 items——部分浏览器两路是同一份文件,合并会上传两次。
export function filesFromClipboard(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const direct = Array.from(data.files ?? []);
  if (direct.length > 0) return direct.map(withName);
  return Array.from(data.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => f != null)
    .map(withName);
}
