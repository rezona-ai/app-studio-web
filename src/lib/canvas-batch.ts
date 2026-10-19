// 画布批量更新的纯逻辑(spec 2026-08-05-canvas-batch-position)。
// 后端 PATCH /canvas/items 的字段集与单条 PATCH 完全同构。画布界面退役后只剩 agent 产物落库
// 一条调用方(每次一条),故分片工具随拖拽 / 整理一起删了;后端单次上限仍是 500,超出整批 422。

import type { Asset } from '@/store/types';
import type { CanvasBatchUpdateItem } from './pgc/types';
import { assetReference } from './pgc/map';

/**
 * Asset → 一条坐标回写项。
 *
 * 坐标同时写两处:`reference.position`(前端读取口径,保留原始浮点)与顶层 `canvas_x`/`canvas_y`
 * (后端列,int)。只写一套会让两者发散——分组框与批量端点都用顶层字段,服务端一旦按坐标做事
 * (删框的空间计算 / 按区域查询)就会读到旧值。
 *
 * `reference` 走 `assetReference` **从头重建**:它必须把血缘 / 溯源 / 来源等键原样吐回,
 * 否则每次坐标回写都等于把那些键从服务端抹掉(见 map.ts 内注释)。
 */
export function positionBatchItem(a: Asset): CanvasBatchUpdateItem {
  return {
    item_id: a.id,
    reference: assetReference(a),
    canvas_x: Math.round(a.position.x),
    canvas_y: Math.round(a.position.y),
  };
}
