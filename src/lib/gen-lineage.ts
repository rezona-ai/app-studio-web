import type { Asset, Message } from '@/store/types';
import { parseSubmittedTaskId } from '@/koubou/protocol';
import { resolveAssetUrl } from './pgc/url';
import { basename } from './media-import';

// agent 生成工具入参里**确实存在**的源素材字段(契约见 koubou app/claude/tools/media.py):
// 图生图 source_urls / 图生3D·视频首帧 source_url / 视频尾帧 last_frame_url / 视频 omni-ref 两个列表。
// 只认这张白名单 —— 臆测字段名是反模式,认错了会连出假血缘。
// 绑骨·重纹理的源是 source_task_id(pgc gtask,非 url),首版不归因,见设计稿约束 6。
const SOURCE_FIELDS = ['source_urls', 'source_url', 'last_frame_url', 'ref_image_urls', 'ref_video_urls'] as const;

// 工具入参 → 源素材 url 列表(按给定字段顺序、保序去重)
function urlsFromInput(input: unknown, fields: readonly string[]): string[] {
  if (!input || typeof input !== 'object') return [];
  const o = input as Record<string, unknown>;
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v && !out.includes(v)) out.push(v);
  };
  for (const field of fields) {
    const v = o[field];
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
  }
  return out;
}

export const sourceUrlsFromInput = (input: unknown): string[] => urlsFromInput(input, SOURCE_FIELDS);

// 归一:相对 /preview 补绝对前缀,再剥 query/hash —— agent 可能给带 ?v= 的直链,
// 路径相同即同一资产
function normalize(url: string): string {
  return (resolveAssetUrl(url) ?? url).split(/[?#]/)[0];
}

// 源 url → 画布卡 item_id(保序去重)。全等命中 preview.src 优先;不中按 basename **唯一**命中兜底
// (同名多卡 = 歧义,宁可不连也不连错,见设计稿约束 5)
export function matchAssetsByUrl(urls: string[], assets: readonly Asset[]): string[] {
  if (urls.length === 0) return [];
  const bySrc = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const a of assets) {
    const src = a.preview?.src;
    if (!src) continue;
    const norm = normalize(src);
    bySrc.set(norm, a.id);
    const name = basename(norm);
    byName.set(name, [...(byName.get(name) ?? []), a.id]);
  }
  const ids: string[] = [];
  for (const url of urls) {
    const norm = normalize(url);
    const sameName = byName.get(basename(norm)) ?? [];
    // 全等优先;basename 兜底只在**唯一**命中时采信
    const id = bySrc.get(norm) ?? (sameName.length === 1 ? sameName[0] : undefined);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// 归因结果:交给 GenPlacement —— sourceItemId 决定落位(父卡右侧树形)与 reference.parent_id,
// refItemIds 进 reference.ref_item_ids(多引用连线)
export interface GenLineage { sourceItemId?: string; refItemIds?: string[] }

// 按 pgc 任务 id 取提交该次生成的**工具入参**:提交回执(media.task_submitted)与工具入参被
// foldResults 折叠在同一个 tool part 上(apply-koubou.ts),故按 part.result 的 task_id 定位、
// 读同一 part 的 input。
//
// 单独导出是为了让「血缘」与「溯源」结构上不可能取到不同的那次调用 ——
// 两者都从这一个 part 读 input(前者挑源 url、后者取整份入参),各写一遍扫描逻辑就会漂移
// (spec 2026-08-06-agent-asset-provenance)
export function submitInputForTask(
  messages: readonly Message[],
  taskId: string,
): Record<string, unknown> | undefined {
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== 'tool' || !p.result) continue;   // 无 result 无从配对 task_id(守卫由 tsc 钉住)
      if (parseSubmittedTaskId(p.result) !== taskId) continue;
      // 工具入参按契约恒为 JSON 对象;数组 / 标量一律当没有 —— 放行数组会给资产挂一份空壳溯源
      // (面板照渲染、再生成按钮照出现,提示词却是空的)
      return p.input && typeof p.input === 'object' && !Array.isArray(p.input)
        ? (p.input as Record<string, unknown>)
        : undefined;
    }
  }
  return undefined;
}

// 按 pgc 任务 id 回溯该次生成的源卡。
// 找不到 / 无源字段 / 一个都 match 不到 → 空对象(调用方据此保持现状不连线)
export function lineageForTask(messages: readonly Message[], taskId: string, assets: readonly Asset[]): GenLineage {
  const [first, ...rest] = matchAssetsByUrl(sourceUrlsFromInput(submitInputForTask(messages, taskId)), assets);
  if (!first) return {};
  return { sourceItemId: first, ...(rest.length ? { refItemIds: rest } : {}) };
}
