import type { CanvasItemData, VersionCreditsSegment, VersionData } from './types';
import type { Asset, AssetProvenance, AssetSource, Status, Version } from '@/store/types';
import type { AssetKind } from '@/lib/asset-kind';
import { resolveAssetUrl } from './url';
import { fallbackGridPosition } from '@/lib/card-layout';

const TYPE_TO_KIND: Record<string, AssetKind> = { image: 'image', video: 'video', audio: 'audio', model3d: '3d', rig3d: '3d', text: 'text' };

function statusOf(s: string): Status {
  if (s === 'ready') return 'ready';
  if (s === 'failed') return 'error';
  return 'generating';
}

export interface CanvasReference {
  position?: { x: number; y: number };
  parent_id?: string;        // 引用生成:连线到源资产 id(前端连线 + 持久化)
  ref_item_ids?: string[];   // 多引用生成:引用资产 id 列表(前端连线 + 持久化)
  source_filename?: string;  // 自动导入溯源
  import_rel_path?: string;  // 压缩包导入溯源(压缩包内相对路径),中断续导入按此去重
  chat_attachment?: boolean; // 对话窗上传附件:仅对话内显示,loadCanvas 据此过滤,不上画布
  links?: { to: string; kind: string }[]; // PGC 派生血缘(rigged_from/retextured_from)
  provenance?: AssetProvenance; // 创作溯源:生成参数快照,前端自写自读(后端顶层字段上线后优先取那边)
  source?: string;              // 资产来源语义(generated/derived/uploaded/reference/manual);后端不提供,前端自写自读
  [k: string]: unknown;
}

// 服务端 item 是否带任何画布坐标(reference.position 或 canvas_x/canvas_y)
const hasCanvasCoord = (it: CanvasItemData) =>
  !!((it.reference ?? {}) as CanvasReference).position || (it.canvas_x != null && it.canvas_y != null);

const PROVENANCE_KINDS: AssetProvenance['kind'][] = ['image', 'video', 'audio', '3d'];
const isProvenanceKind = (v: unknown): v is AssetProvenance['kind'] =>
  PROVENANCE_KINDS.includes(v as AssetProvenance['kind']);

// 溯源来源优先级:后端顶层字段 > reference.provenance。
// 后端目前不返回它,这里预留位置 —— 将来上线即自动生效、不上线也无副作用。
// (原先援引的先例 VersionData.credits_spent 已退役:后端改走独立端点 /versions/credits,
//  见 spec 2026-08-31-version-credits-breakdown。)形状不合契约的脏数据一律当没有,不半信半疑。
function provenanceOf(it: CanvasItemData): AssetProvenance | undefined {
  const raw = (it as { provenance?: unknown }).provenance
    ?? ((it.reference ?? {}) as CanvasReference).provenance;
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Partial<AssetProvenance>;
  if (!isProvenanceKind(p.kind) || typeof p.at !== 'string' || !p.req || typeof p.req !== 'object') return undefined;
  // agent 判别器只认严格 true(脏值不采信):它决定 req 按哪套口径解析,认错了模型就显示成 koubou 别名。
  // 逐字段重建的白名单漏掉它会被静默吃掉,故有专测钉住往返
  return { kind: p.kind, req: p.req as Record<string, unknown>, at: p.at, ...(p.agent === true ? { agent: true as const } : {}) };
}

const ASSET_SOURCES: AssetSource[] = ['generated', 'derived', 'uploaded', 'reference', 'manual'];
// 来源以持久化的 reference.source 为准;缺失(历史资产)才回落旧推导,保证老数据不回归。
// 非法值不采信 —— 宁可推导也不把脏字符串喂给 i18n 键
function sourceOf(ref: CanvasReference, parentId?: string): AssetSource {
  const raw = ref.source;
  if (ASSET_SOURCES.includes(raw as AssetSource)) return raw as AssetSource;
  return parentId ? 'derived' : 'generated';
}

function rigAnimationsOf(metadata: unknown): string[] | undefined {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const rig = (metadata as Record<string, unknown>).rig;
  if (!rig || typeof rig !== 'object') return undefined;
  const animations = (rig as Record<string, unknown>).animations;
  return Array.isArray(animations) && animations.every((name): name is string => typeof name === 'string')
    ? animations
    : undefined;
}

export function canvasItemToAsset(it: CanvasItemData): Asset {
  const ref = (it.reference ?? {}) as CanvasReference;
  const links = Array.isArray(ref.links)
    ? ref.links.filter((link): link is { to: string; kind: string } =>
        !!link && typeof link.to === 'string' && typeof link.kind === 'string')
    : undefined;
  const lineage = links?.find((link) => link.kind === 'rigged_from' || link.kind === 'retextured_from');
  const parentId = ref.parent_id ?? lineage?.to;
  const position = ref.position ?? (it.canvas_x != null && it.canvas_y != null ? { x: it.canvas_x!, y: it.canvas_y! } : { x: 0, y: 0 });
  const src = resolveAssetUrl(it.url);
  // thumbnail_url:后端生成的缩略图 sidecar(3D 模型快照/视频封面),归一为 preview.poster
  const poster = resolveAssetUrl(it.thumbnail_url);
  const media = { ...(src ? { src } : {}), ...(poster ? { poster } : {}) };
  // content 优先内联入 preview.text；否则有 src/poster 才建 preview,全无则 undefined
  const preview = it.content != null
    ? { ...media, text: it.content }
    : src || poster ? media : undefined;
  return {
    id: it.item_id,
    key: it.item_id,
    label: it.name ?? it.item_id,
    kind: TYPE_TO_KIND[it.type] ?? 'image',
    source: sourceOf(ref, parentId),
    parentId,
    refIds: Array.isArray(ref.ref_item_ids) ? ref.ref_item_ids.filter((x): x is string => typeof x === 'string') : undefined,
    status: statusOf(it.status),
    position,
    preview,
    sourceFilename: ref.source_filename,
    importRelPath: typeof ref.import_rel_path === 'string' ? ref.import_rel_path : undefined,
    threeDType: it.type === 'model3d' || it.type === 'rig3d' ? it.type : undefined,
    rigAnimations: it.type === 'rig3d' ? rigAnimationsOf(it.metadata) : undefined,
    referenceLinks: links,
    provenance: provenanceOf(it),
    seq: it.id,
    createdAt: it.created_at,
    failure: it.failure,
  };
}

// 整表替换时保留「前端所有」的字段:坐标与血缘由前端算出、经 fire-and-forget 的 reference PATCH 落库,
// 若整表刷新(run.finished 后台 loadCanvas)赶在 PATCH 之前,服务端那份还没有这些值 ——
// 直取服务端会让血缘连线消失、坐标退化成兜底网格(卡跳位)。
// 口径:**仅服务端缺失时**取本地(服务端有值一律以服务端为准,不让本地旧值挡住新值),
// 与轮询 ready 分支既有的 `a.parentId ?? asset.parentId` 同构。
function preserveFrontendOwned(mapped: Asset, local: Asset, it: CanvasItemData): Asset {
  const ref = (it.reference ?? {}) as CanvasReference;
  const next: Asset = { ...mapped };
  if (!hasCanvasCoord(it)) next.position = local.position;
  if (!ref.parent_id && local.parentId) next.parentId = local.parentId;
  if (!ref.ref_item_ids?.length && local.refIds?.length) next.refIds = local.refIds;
  // 溯源同理:agent 卡的 provenance 由前端从工具入参提取、经 fire-and-forget 回写落库,
  // 异步路径(registerAgentGenTask → adoptAgentItem)的回写与 run.finished 的整表刷新是赛跑关系。
  // 判据对着 **mapped**(而非 ref.provenance):provenanceOf 读的是「顶层 ?? reference」两个来源,
  // 只看 reference 会让后端将来上线的顶层字段被本地旧值盖掉(与「顶层优先」那条自相矛盾)
  if (!mapped.provenance && local.provenance) next.provenance = local.provenance;
  // 来源同理:导入卡的 reference/uploaded 是前端在建卡那一刻定的,全靠后端原样回显才活得下来。
  // 服务端漏回显时 mapped 会现推成 generated —— 面板退回「Generated」,用户拖一下卡
  // assetReference 再把这个错值固化进服务端,正是本轮要消灭的那个失败模式(终审 M1)
  if (!ref.source && local.source) next.source = local.source;
  // 血缘的 derived 排在兜底之后:它按 parentId 现推,与「回没回显」无关,不该被本地旧值挡住
  if (next.parentId && !ref.source) next.source = 'derived';
  return next;
}

// prev:当前内存里的资产(按 id),给上面的字段保留用;不传则纯按服务端映射(首载 / 无本地态场景)
export function canvasItemsToAssets(items: CanvasItemData[], prev?: readonly Asset[]): Asset[] {
  const localById = new Map((prev ?? []).map((a) => [a.id, a]));
  // 无任何坐标的历史资产:按列表序在原点起铺兜底网格(确定性、互不重叠),加载后由 fitView 保证可见;不回写服务端。
  // 早期按 CASCADE_STEP(40)对角级联,数量一多就叠成一摞(卡片重叠反馈的另一来源)
  let fallbackIdx = 0;
  // 单项容错:某个脏 item(字段缺失 / 整项为 null 等后端异常)不得阻断整表映射,
  // 否则一坏全崩——assets 一个都进不来、整块画布不加载(与"非法 WS 帧跳过"同思路)。
  // 逐项 try/catch 跳过坏项,坏项落 console.warn 保留现场;fallbackIdx 仅对成功映射项自增,保证级联序号连续。
  const out: Asset[] = [];
  for (const it of items) {
    try {
      if (((it.reference ?? {}) as CanvasReference).chat_attachment) continue;   // 对话附件不上画布
      const a = canvasItemToAsset(it);
      const local = localById.get(a.id);
      // 内存里已有这张卡:保留前端所有的字段(服务端缺失时);新卡走原路径,无坐标者铺兜底网格
      if (local) out.push(preserveFrontendOwned(a, local, it));
      else out.push(hasCanvasCoord(it) ? a : { ...a, position: fallbackGridPosition({ x: 0, y: 0 }, fallbackIdx++) });
    } catch (e) {
      console.warn('[canvas] 跳过无法解析的画布资产', it, e);
    }
  }
  return out;
}

// 从 Asset 已知字段重建完整 reference,避免回写坐标时覆盖 parent_id / source_filename
export function assetReference(a: Asset): CanvasReference {
  const ref: CanvasReference = { position: a.position };
  if (a.parentId) ref.parent_id = a.parentId;
  if (a.refIds?.length) ref.ref_item_ids = a.refIds;
  if (a.sourceFilename) ref.source_filename = a.sourceFilename;
  if (a.importRelPath) ref.import_rel_path = a.importRelPath;
  if (a.referenceLinks?.length) ref.links = a.referenceLinks;
  // 必须吐回:本函数是**从头重建**的,漏一个字段就等于每次坐标回写把它从服务端抹掉
  if (a.provenance) ref.provenance = a.provenance;
  ref.source = a.source;   // 同上:不吐回就等于每次坐标回写把它抹掉
  return ref;
}

export function versionToVersion(v: VersionData): Version {
  return {
    id: v.version_id,
    index: v.seq,
    label: v.title || `Version ${v.seq}`,
    status: v.status,
    summary: v.status === 'building' ? 'Building…' : '',
    createdAt: v.created_at ?? '',
    current: !!v.is_current,
    cover: resolveAssetUrl(v.cover_url),
    assetKeys: [],
    game: { title: v.title || 'GAME', palette: 'neon' },
  };
}

export function versionsToVersions(items: VersionData[]): Version[] {
  return items.map(versionToVersion);
}

// 版本消耗积分:段 → { [version_id]: total_credits }。
// 只收 version_id 非空且 total_credits 为数字的段 —— 在途段(version_id null)没有版本行可挂;
// total_credits 为 null 是后端明确的「不编数」,**不得**回落 asset_credits 冒充全量口径。
// 0 是有效值(确实没花钱 ≠ 无数据),故判据是 typeof === 'number' 而非真值。
export function versionCreditsMap(items: VersionCreditsSegment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const seg of items) {
    if (!seg.version_id) continue;
    if (typeof seg.total_credits !== 'number') continue;
    out[seg.version_id] = seg.total_credits;
  }
  return out;
}
