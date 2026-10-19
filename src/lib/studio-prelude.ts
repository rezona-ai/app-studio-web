// 解析外部页面经工作台 URL query 传入的预填参数(模型 / 提示词 / 资产),校验并归一。
// 纯函数、无副作用、不依赖 store —— 副作用(新建项目/写 store/剥离 URL)由 store action applyStudioPrelude 负责。
import { KIND_ORDER, type AssetKind } from './asset-kind';

// 资产种子:外部页传来的已入库资产,仅 url(公网可达)必填;kind 决定缩略图与发送路由;name 仅作 chip 标签
export interface AssetSeed { url: string; kind: AssetKind; name?: string }
export interface StudioPrelude { model?: string; prompt?: string; assets: AssetSeed[] }

// 资产数组归一:逐条校验,非法条目丢弃 —— URL query 线与 handoff sessionStorage 线共用
function normalizeAssetSeeds(arr: unknown): AssetSeed[] {
  if (!Array.isArray(arr)) return [];
  const out: AssetSeed[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const { url, kind, name } = item as { url?: unknown; kind?: unknown; name?: unknown };
    if (typeof url !== 'string' || !url) continue;                       // url 必填且非空
    // landing 线格式 kind='document'(txt/pdf 统称)归一为内部一等类型 'text';
    // 内部枚举不新增成员——TextNode/筛选/MENTION_TYPE(text→document)全链路复用
    const normalized = kind === 'document' ? 'text' : kind;
    if (typeof normalized !== 'string' || !KIND_ORDER.includes(normalized as AssetKind)) continue;
    out.push({ url, kind: normalized as AssetKind, ...(typeof name === 'string' && name ? { name } : {}) });
  }
  return out;
}

// assets 参数:encodeURIComponent(JSON.stringify(AssetSeed[]));非法 JSON 整体回退空(沿用"非法帧跳过"哲学)
function parseAssets(raw: string | null): AssetSeed[] {
  if (!raw) return [];
  try { return normalizeAssetSeeds(JSON.parse(raw)); } catch { return []; }
}

// 解析 location.search;model/prompt 皆空且 assets 为空 → 返回 null(视为无 prelude)
export function parseStudioPrelude(search: string): StudioPrelude | null {
  const params = new URLSearchParams(search);
  const model = params.get('model') || undefined;   // 空串视为缺省
  const prompt = params.get('prompt') || undefined; // URLSearchParams 已解码;空串视为缺省
  const assets = parseAssets(params.get('assets'));
  if (!model && !prompt && assets.length === 0) return null;
  return { ...(model ? { model } : {}), ...(prompt ? { prompt } : {}), assets };
}

// 附件 chip 标签:优先 name,否则取 url 路径末段(文件名),无路径段(仅 scheme://host)时回退整个 url
export function assetSeedLabel(seed: AssetSeed): string {
  if (seed.name) return seed.name;
  try {
    const last = new URL(seed.url).pathname.split('/').filter(Boolean).pop();
    return last ?? seed.url; // 无路径段 → 回退整个 url
  } catch {
    return seed.url; // 非法 url:原样回退
  }
}

// —— handoff 线:超长 prelude 经 sessionStorage 传递(URL 只带 id,规避 URL 长度上限)——

// 解析 ?handoff=<id>;空/缺省返回 null
export function parseHandoffId(search: string): string | null {
  const v = new URLSearchParams(search).get('handoff');
  return v && v.trim() ? v : null; // 空串视为缺省
}

// sessionStorage key 约定(与 landing 侧写入格式对齐)
export function handoffStorageKey(id: string): string {
  return `tln.game.handoff.${id}`;
}

// 解析 sessionStorage 载荷 { v:1, model?, prompt?, assets?, createdAt } → StudioPrelude。
// 仅认 v===1(为后续版本升级留兼容位);createdAt 是 landing 侧写入时间戳,消费端不校验
// (sessionStorage 随标签页销毁,且消费即删,无过期风险)。非法/全空返回 null。
export function parseHandoffPayload(raw: string | null): StudioPrelude | null {
  if (!raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (typeof obj !== 'object' || obj === null) return null;
  const { v, model, prompt, assets } = obj as { v?: unknown; model?: unknown; prompt?: unknown; assets?: unknown };
  if (v !== 1) return null;
  const m = typeof model === 'string' && model ? model : undefined;
  const p = typeof prompt === 'string' && prompt ? prompt : undefined;
  const seeds = normalizeAssetSeeds(assets);
  if (!m && !p && seeds.length === 0) return null;
  return { ...(m ? { model: m } : {}), ...(p ? { prompt: p } : {}), assets: seeds };
}

// 解析 ?remix=<public_id>(外部页带 fork 跳转);空/缺省返回 null。public_id 直接作 createRemix 的 source_code
export function parseRemixSource(search: string): string | null {
  const v = new URLSearchParams(search).get('remix');
  return v && v.trim() ? v : null; // 空串视为缺省
}

// 解析 ?share=<public_id>(分享工作台链接:owner 分享完整可写副本);空/缺省返回 null。
// public_id 直接作 workbench-share open 的 code。与 ?remix= 平行(remix=只读单版本,share=含对话完整 fork),
// 二者同时出现时由 bootstrap 令 share 优先(见 useProjectBootstrap)。
export function parseShareSource(search: string): string | null {
  const v = new URLSearchParams(search).get('share');
  return v && v.trim() ? v : null; // 空串视为缺省
}
