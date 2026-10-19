// 净化 Windows/Unix 文件名非法字符并折叠空白,避免生成非法/畸形文件名;空结果回退 fallback
function sanitizeFileName(raw: string, fallback: string): string {
  return raw.replace(/[/\\:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim() || fallback;
}

// 版本压缩包下载文件名:项目名-版本号.zip;项目名缺失/净化后为空时回退仅版本号。
// (单资产 / 多资产打包下载随画布界面退役,spec 2026-10-19 第二阶段)
export function versionArchiveName(projectName: string | undefined, versionId: string): string {
  // 纯非法字符的项目名会被折叠成下划线,剥掉首尾下划线后再判空
  const name = sanitizeFileName(projectName ?? '', '').replace(/^_+|_+$/g, '');
  return name ? `${name}-${versionId}.zip` : `${versionId}.zip`;
}
