import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import FullscreenPreview from '@/components/preview/FullscreenPreview';

export const metadata: Metadata = { title: 'Rezona Lab · Preview' };

// 全屏预览路由:GET /full/{pid}/{vid}?seq={n}(basePath=/game 由 Next 前置)。
// 工作台「全屏展示」在点击的同步栈内直接打开这条链接——首屏即渲染加载态,预览地址由页内解析,
// 页签不再空白等 REST(设计稿 docs/superpowers/specs/2026-08-03-fullscreen-preview-instant-loading.md)。
// server 侧只做参数校验:pid 须为正整数、vid 非空,否则 404;seq 缺失/非法按 null 传下去(退化为通用文案)。
export default async function FullscreenPage({
  params,
  searchParams,
}: {
  params: Promise<{ pid: string; vid: string }>;
  searchParams: Promise<{ seq?: string | string[] }>;
}) {
  const { pid, vid } = await params;
  const projectId = Number(pid);
  if (!Number.isInteger(projectId) || projectId <= 0 || !vid) notFound();

  const rawSeq = (await searchParams).seq;
  const seqNum = Number(Array.isArray(rawSeq) ? rawSeq[0] : rawSeq);
  const seq = Number.isInteger(seqNum) && seqNum > 0 ? seqNum : null;

  // params 已由 Next 解码,此处不再 decodeURIComponent(会把 vid 里的 % 二次解码)
  return <FullscreenPreview pid={projectId} vid={vid} seq={seq} />;
}
