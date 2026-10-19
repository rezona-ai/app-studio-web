import { describe, expect, test } from 'vitest';
import { positionBatchItem } from './canvas-batch';
import type { Asset } from '@/store/types';

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: 'img-1', key: 'img-1', label: 'A', kind: 'image', source: 'generated',
  status: 'ready', position: { x: 0, y: 0 }, ...over,
});

describe('positionBatchItem', () => {
  test('顶层坐标取整(后端 canvas_x/y 是 int)', () => {
    const it = positionBatchItem(asset({ position: { x: 10.7, y: -3.2 } }));
    expect(it.item_id).toBe('img-1');
    expect(it.canvas_x).toBe(11);
    expect(it.canvas_y).toBe(-3);
  });

  // 读取口径是 reference.position 优先(map.ts:75),它保留原始浮点值;
  // 取整只为顶层 int 字段,两者不同步是有意的
  test('reference.position 仍是未取整的原值', () => {
    const it = positionBatchItem(asset({ position: { x: 10.7, y: -3.2 } }));
    expect(it.reference).toMatchObject({ position: { x: 10.7, y: -3.2 } });
  });

  // 回归护栏:assetReference 是「从头重建」的,漏一个键就等于每次坐标回写
  // 把它从服务端抹掉(见 map.ts:154 的注释)
  test('血缘 / 溯源 / 来源等键原样带上,不被坐标回写抹掉', () => {
    const it = positionBatchItem(asset({
      parentId: 'img-src', refIds: ['img-r1'], source: 'derived',
      sourceFilename: 'hero.png', importRelPath: 'src/assets/hero.png',
      referenceLinks: [{ to: 'm3d-1', kind: 'rigged_from' }],
      provenance: { kind: 'image', req: { prompt: 'x' }, at: '2026-08-05T00:00:00Z' },
    }));
    expect(it.reference).toMatchObject({
      parent_id: 'img-src',
      ref_item_ids: ['img-r1'],
      source: 'derived',
      source_filename: 'hero.png',
      import_rel_path: 'src/assets/hero.png',
      links: [{ to: 'm3d-1', kind: 'rigged_from' }],
      provenance: { kind: 'image', req: { prompt: 'x' }, at: '2026-08-05T00:00:00Z' },
    });
  });
});
