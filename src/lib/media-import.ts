import type { AssetKind } from '@/lib/asset-kind';
import type { ServerEvent, SubmittedTask } from '@/koubou/protocol';
import { toolResultText, parseMediaPayload, parseSubmittedTaskPayload } from '@/koubou/protocol';

// 纯文本扩展集:landing document 资产与 @引用内联判定共用(pdf 不在内,不可内联)
const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown'];

// 按文件名/URL 的扩展名判定是否纯文本;URL 先剥 query/hash 再取路径末段
export function isPlainTextName(nameOrUrl: string): boolean {
  const path = nameOrUrl.split(/[?#]/)[0];
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return path.includes('.') && PLAIN_TEXT_EXTS.includes(ext);
}

// 取路径纯文件名(兼容纯文件名 / 带目录)
export function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

// media item.kind → 画布 AssetKind
export function mediaKindToAssetKind(kind: string): AssetKind {
  switch (kind) {
    case 'video': return 'video';
    case 'audio': return 'audio';
    case '3d': case 'model3d': return '3d';
    case 'image': return 'image';
    case 'text': case 'doc': return 'text';
    default: return 'image';
  }
}

// 文件 MIME → 画布 AssetKind(未知回退 image)
// PDF 特判归 text:文档形态复用文本图标/气泡渲染;发送时作为原生 document 块(URL 源)交模型直接理解,不折 @url
// model/*(glb·gltf)归 3D;但浏览器对 glb 常给空/octet-stream MIME,扩展名兜底见 assets.ts::kindFromFile
export function mimeToAssetKind(mime: string): AssetKind {
  if (mime === 'application/pdf') return 'text';
  const top = mime.split('/')[0];
  if (top === 'video') return 'video';
  if (top === 'audio') return 'audio';
  if (top === 'text') return 'text';
  if (top === 'model') return '3d';
  return 'image';
}

// 画布 AssetKind → import type(无法映射返回 undefined,由后端按扩展名推断)
export function kindToImportType(kind: AssetKind): 'image' | 'video' | 'audio' | 'model3d' | 'text' | undefined {
  switch (kind) {
    case 'image': return 'image';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case '3d': return 'model3d';
    case 'text': return 'text';
    default: return undefined;
  }
}

// taskId:pgc 任务 id,导入时据此回溯该次生成的源卡做血缘归因(见 lib/gen-lineage.ts)
export interface ReadyMedia { filename: string; path: string; kind: AssetKind; previewUrl: string | null; taskId?: string }

// media 结果(就绪资产 / 提交回执)→ 可导入条目;两个 backend 的提取路径汇到这里
function collectMedia(json: unknown, media: ReadyMedia[], tasks: SubmittedTask[]): void {
  for (const item of parseMediaPayload(json) ?? []) {
    if (!item.path) continue;
    const kind = mediaKindToAssetKind(item.kind);
    if (kind === 'video' || kind === '3d') continue;   // video/3D 走 task 路径,不从 media 导;text/doc(agent 产出文档)自然放行
    media.push({ filename: basename(item.path), path: item.path, kind, previewUrl: item.previewUrl, ...(item.taskId ? { taskId: item.taskId } : {}) });
  }
  const task = parseSubmittedTaskPayload(json);
  if (task) tasks.push(task);
}

// Codex 的工具结果:`item.result.structuredContent` 优先(结构化对象),
// 兼容路径再逐条解析 `item.result.content[].text` 里的同一 JSON(见 koubou 文档「MCP media 结果」)
function codexResultJsons(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as { structuredContent?: unknown; content?: unknown };
  if (r.structuredContent !== undefined) return [r.structuredContent];
  if (!Array.isArray(r.content)) return [];
  const out: unknown[] = [];
  for (const c of r.content) {
    const text = c && typeof c === 'object' ? (c as { text?: unknown }).text : undefined;
    if (typeof text !== 'string') continue;
    try { out.push(JSON.parse(text)); } catch { /* 非 JSON 文本:不是 media 结果 */ }
  }
  return out;
}

// 从「实时 WS 帧」解析出可导入资产:
// - Claude:claude.message/UserMessage 的 tool_result(跳过 is_error),结果是 text block 里的 JSON;
// - Codex:codex.message / item/completed 的工具 item,结果在 item.result(structuredContent 优先)。
// 供 onEvent 与建连种子化历史调用(见 importFromLiveEvent / importMediaFromEvent)。
export function eventAssets(e: ServerEvent): { media: ReadyMedia[]; tasks: SubmittedTask[] } {
  const media: ReadyMedia[] = [];
  const tasks: SubmittedTask[] = [];
  if (e.type === 'codex.message') {
    const cp = e.payload as unknown as { method?: string; payload?: { item?: unknown } };
    if (cp?.method !== 'item/completed') return { media, tasks };
    const item = cp.payload?.item;
    if (!item || typeof item !== 'object') return { media, tasks };
    const it = item as { result?: unknown; error?: unknown };
    if (it.error) return { media, tasks };   // 工具失败:与 Claude 侧 is_error 同处理,不导入
    for (const json of codexResultJsons(it.result)) collectMedia(json, media, tasks);
    return { media, tasks };
  }
  if (e.type !== 'claude.message') return { media, tasks };
  const cm = e.payload as unknown as { sdk_type?: string; payload?: { content?: unknown } };
  if (cm.sdk_type !== 'UserMessage' || !Array.isArray(cm.payload?.content)) return { media, tasks };
  for (const b of cm.payload.content as Array<Record<string, unknown>>) {
    if (!b || b.type !== 'tool_result' || b.is_error) continue;
    const text = toolResultText(b.content);
    let json: unknown;
    try { json = JSON.parse(text); } catch { continue; }   // 非 JSON 结果:不是 media 工具
    collectMedia(json, media, tasks);
  }
  return { media, tasks };
}
