import { describe, expect, test } from 'vitest';
import { childPosition, cascadePosition, avoidOverlap, fallbackGridPosition, cardSize, CARD_SIZE, CARD_W, CARD_H, GAP_X, GAP_Y, CASCADE_STEP, FALLBACK_COLS, type Box } from './card-layout';

describe('childPosition 树形落位', () => {
  test('首个子节点:父右侧一卡宽+横距,y 与父对齐', () => {
    expect(childPosition({ x: 100, y: 200 }, [])).toEqual({ x: 100 + CARD_W + GAP_X, y: 200 });
  });
  test('已有兄弟:堆叠在最下方兄弟之下', () => {
    const sib = { x: 360, y: 200 };
    expect(childPosition({ x: 100, y: 200 }, [sib])).toEqual({ x: 360, y: 200 + CARD_H + GAP_Y });
  });
  test('多个兄弟:取 y 最大者向下堆叠', () => {
    const sibs = [{ x: 360, y: 500 }, { x: 360, y: 200 }];
    expect(childPosition({ x: 100, y: 200 }, sibs)).toEqual({ x: 360, y: 500 + CARD_H + GAP_Y });
  });
});

describe('childPosition 尺寸感知(按真实宽高落位)', () => {
  test('兄弟带真实高:堆到兄弟真实底边之下(而非固定 CARD_H)', () => {
    const sib = { x: 360, y: 200, h: 200 }; // image 真实高 ≈200 > CARD_H(150)
    expect(childPosition({ x: 100, y: 200 }, [sib])).toEqual({ x: 360, y: 200 + 200 + GAP_Y });
  });
  test('不等高兄弟:取「真实底边」最大者向下堆叠', () => {
    const sibs = [{ x: 360, y: 0, h: 200 }, { x: 360, y: 240, h: 130 }];
    // 底边:0+200=200 vs 240+130=370 → 取 370
    expect(childPosition({ x: 100, y: 0 }, sibs)).toEqual({ x: 360, y: 370 + GAP_Y });
  });
  test('父带真实宽:首子按父真实宽向右偏移(而非固定 CARD_W)', () => {
    expect(childPosition({ x: 100, y: 200, w: 210 }, [])).toEqual({ x: 100 + 210 + GAP_X, y: 200 });
  });
  test('缺省宽高:与旧公式逐字节兼容(回归锁)', () => {
    const sib = { x: 360, y: 200 };
    expect(childPosition({ x: 100, y: 200 }, [sib])).toEqual({ x: 100 + CARD_W + GAP_X, y: 200 + CARD_H + GAP_Y });
  });
});

describe('cardSize 按类型尺寸', () => {
  test('已知类型返回表内尺寸', () => {
    expect(cardSize('video')).toEqual(CARD_SIZE.video);
    expect(cardSize('image')).toEqual(CARD_SIZE.image);
  });
  test('未知 / 缺省类型退回通用兜底(CARD_W/CARD_H)', () => {
    expect(cardSize(undefined)).toEqual({ w: CARD_W, h: CARD_H });
    expect(cardSize('unknown')).toEqual({ w: CARD_W, h: CARD_H });
  });
  test('所有类型高度均 ≥ CARD_H 兜底基准下限不会更小导致重叠', () => {
    // image 真实高 > CARD_H,确保表内 image 高度不再低估
    expect(CARD_SIZE.image.h).toBeGreaterThan(CARD_H);
  });
});

describe('cascadePosition 级联落位', () => {
  test('第 i 个按固定步距对角错开', () => {
    expect(cascadePosition({ x: 10, y: 20 }, 0)).toEqual({ x: 10, y: 20 });
    expect(cascadePosition({ x: 10, y: 20 }, 2)).toEqual({ x: 10 + 2 * CASCADE_STEP, y: 20 + 2 * CASCADE_STEP });
  });
});

describe('avoidOverlap 就近螺旋避让', () => {
  const STEP_X = CARD_W + GAP_X; // 260
  const STEP_Y = CARD_H + GAP_Y; // 190
  const overlaps = (p: { x: number; y: number }, occupied: { x: number; y: number }[]) =>
    occupied.some((o) => Math.abs(o.x - p.x) < STEP_X && Math.abs(o.y - p.y) < STEP_Y);

  test('无重叠:原样返回', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: STEP_X, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
  test('目标被占:落到最近的一格(垂直比水平近,优先正下方)', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: STEP_Y });
  });
  test('正下方也被占:向上更近,不再无限向下', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 0, y: STEP_Y }];
    expect(avoidOverlap({ x: 0, y: 0 }, occupied)).toEqual({ x: 0, y: -STEP_Y });
  });
  test('返回的落点本身不与任何卡片重叠', () => {
    const occupied = [{ x: 0, y: 0 }, { x: 0, y: STEP_Y }, { x: 0, y: -STEP_Y }, { x: STEP_X, y: 0 }];
    expect(overlaps(avoidOverlap({ x: 0, y: 0 }, occupied), occupied)).toBe(false);
  });
  test('四周环数内全占满:兜底原样返回 target(不死循环)', () => {
    const occupied: { x: number; y: number }[] = [];
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) occupied.push({ x: dx * STEP_X, y: dy * STEP_Y });
    expect(avoidOverlap({ x: 0, y: 0 }, occupied)).toEqual({ x: 0, y: 0 });
  });
});

describe('avoidOverlap 尺寸感知(真实包围盒 + GAP 间距)', () => {
  const img = CARD_SIZE.image;   // 180×200
  const aud = CARD_SIZE.audio;   // 210×130
  // 两框(各按自身真实宽高)是否留够 GAP:落位结果的通用不变式
  const tooClose = (p: Box, o: Box) =>
    p.x < o.x + o.w! + GAP_X && o.x < p.x + p.w! + GAP_X &&
    p.y < o.y + o.h! + GAP_Y && o.y < p.y + p.h! + GAP_Y;

  test('同尺寸 image 卡被占:落到其真实底边 + GAP_Y(旧实现按 CARD_H=150 判定会压掉 10px)', () => {
    const occupied: Box[] = [{ x: 0, y: 0, ...img }];
    expect(avoidOverlap({ x: 0, y: 0, ...img }, occupied)).toEqual({ x: 0, y: img.h + GAP_Y });
  });

  test('连续落位的两张 image 卡之间恒留 ≥GAP_Y 空隙', () => {
    const first: Box = { x: 0, y: 0, ...img };
    const second = avoidOverlap({ x: 0, y: 0, ...img }, [first]);
    expect(second.y - (first.y + img.h)).toBeGreaterThanOrEqual(GAP_Y);
  });

  test('矮卡避让高卡:按各自真实高判定,正上方一格已足够(旧实现两向都是 190)', () => {
    // audio(h=130)向下一格 = 170,仍压在 image(h=200)身上 → 同距离的正上方才是真空位
    const occupied: Box[] = [{ x: 0, y: 0, ...img }];
    const p = avoidOverlap({ x: 0, y: 0, ...aud }, occupied);
    expect(p).toEqual({ x: 0, y: -(aud.h + GAP_Y) });
    expect(tooClose({ ...p, ...aud }, occupied[0])).toBe(false);
  });

  test('混排多卡:返回落点与每张已有卡都留够 GAP', () => {
    const occupied: Box[] = [
      { x: 0, y: 0, ...img },
      { x: 0, y: img.h + GAP_Y, ...CARD_SIZE.video },
      { x: 0, y: -(CARD_SIZE.text.h + GAP_Y), ...CARD_SIZE.text },
      { x: img.w + GAP_X, y: 0, ...CARD_SIZE['3d'] },
    ];
    const p = avoidOverlap({ x: 0, y: 0, ...aud }, occupied);
    expect(occupied.some((o) => tooClose({ ...p, ...aud }, o))).toBe(false);
  });

  test('缺省尺寸(纯 XY)与历史行为等价:退回 CARD_W/CARD_H 判定', () => {
    expect(avoidOverlap({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual({ x: 0, y: CARD_H + GAP_Y });
  });
});

describe('fallbackGridPosition 无坐标资产兜底网格', () => {
  test('按行铺放,每行 FALLBACK_COLS 张;首张落在 origin,行内同 y、换行回到首列', () => {
    expect(fallbackGridPosition({ x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
    const one = fallbackGridPosition({ x: 0, y: 0 }, 1);
    expect(one.y).toBe(0);
    expect(one.x).toBeGreaterThan(0);
    const wrapped = fallbackGridPosition({ x: 0, y: 0 }, FALLBACK_COLS);
    expect(wrapped.x).toBe(0);
    expect(wrapped.y).toBeGreaterThan(0);
  });
  test('格距按各类型最大卡尺寸取,任意类型混排都不重叠', () => {
    const maxW = Math.max(CARD_W, ...Object.values(CARD_SIZE).map((s) => s.w));
    const maxH = Math.max(CARD_H, ...Object.values(CARD_SIZE).map((s) => s.h));
    const a = fallbackGridPosition({ x: 0, y: 0 }, 0);
    const b = fallbackGridPosition({ x: 0, y: 0 }, 1);
    const c = fallbackGridPosition({ x: 0, y: 0 }, FALLBACK_COLS);
    expect(b.x - a.x).toBeGreaterThanOrEqual(maxW + GAP_X);
    expect(c.y - a.y).toBeGreaterThanOrEqual(maxH + GAP_Y);
    expect(c.x).toBe(a.x);
  });
  test('origin 平移整体生效', () => {
    expect(fallbackGridPosition({ x: 100, y: 50 }, 0)).toEqual({ x: 100, y: 50 });
  });
});
