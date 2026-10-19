import { expect, test } from 'vitest';
import {
  BASE_POINTS,
  HANDLE_CLIP,
  HANDLE_H,
  HANDLE_REACH,
  HANDLE_W,
  LIQUID_W,
  HIT_R,
  hitCircle,
  liquidPath,
  tension,
} from './edge-handle';

test('两版 clipPath 是同一形状的左右镜像(x → HANDLE_W − x,y 不变)', () => {
  const coords = (path: string) => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const left = coords(HANDLE_CLIP.left);
  const right = coords(HANDLE_CLIP.right);
  expect(left).toHaveLength(right.length);
  expect(left.length % 2).toBe(0);
  for (let i = 0; i < left.length; i += 2) {
    expect(left[i]).toBe(HANDLE_W - right[i]); // x 互为镜像
    expect(left[i + 1]).toBe(right[i + 1]); // y 相同
  }
});

const CY = HANDLE_H / 2;
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
/** 路径每段 C 的终点 = 曲线真正经过的点(Catmull-Rom 插值过所有采样点) */
const knots = (d: string) => {
  const pts: { x: number; y: number }[] = [];
  for (const seg of d.split('C').slice(1)) {
    const v = nums(seg);
    pts.push({ x: v[4], y: v[5] });
  }
  return pts;
};
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

test('形变量为 0 时轮廓逐点经过静态采样点 —— 静态等价由构造保证', () => {
  const d = liquidPath(HANDLE_W, CY, 0, 'left');
  const got = knots(d);
  expect(got).toHaveLength(BASE_POINTS.length);
  // 闭合曲线的段终点依次是 P1,P2,…,P0,顺序对齐即可
  for (let i = 0; i < BASE_POINTS.length; i++) {
    const want = BASE_POINTS[(i + 1) % BASE_POINTS.length];
    expect(near(got[i].x, want.x)).toBe(true);
    expect(near(got[i].y, want.y)).toBe(true);
  }
});

test('贴边的浸润线横向恒不动 —— 液体不离开边栏,任何情况下 x 都 ≥ 0', () => {
  for (const [tx, ty, st] of [
    [HANDLE_W + HANDLE_REACH, CY, 1],
    [HANDLE_W + HANDLE_REACH, 0, 1],
    [HANDLE_W + HANDLE_REACH, HANDLE_H, 1],
    [HANDLE_W + HANDLE_REACH / 2, CY, -0.08], // 回弹过冲的内凹态
  ] as const) {
    const xs = nums(liquidPath(tx, ty, st, 'left')).filter((_, i) => i % 2 === 0);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
  }
  // 贴边采样点(x=0)位移后仍恰好在 0 上
  const zeros = BASE_POINTS.filter((p) => p.x === 0).length;
  expect(zeros).toBeGreaterThan(4); // 贴边那条线确实被采到了
  const got = knots(liquidPath(HANDLE_W + HANDLE_REACH, CY, 1, 'left'));
  expect(got.filter((p) => near(p.x, 0)).length).toBe(zeros);
});

test('牵引点在凸边范围内时轮廓最外点到达牵引点 —— 头部到位,指针才粘得住', () => {
  for (const ty of [40, CY, 90]) {
    const tx = HANDLE_W + HANDLE_REACH;
    const xs = knots(liquidPath(tx, ty, 1, 'left')).map((p) => p.x);
    // 容差 0.3px 是离散采样的必然下界:牵引点落在两个采样点正中时欠冲最大(间隔 3px → 0.25px),
    // 不是随手放宽。真正把这条守住的是负瓣公式 —— 写错成 g − LOBE·g2 会一下欠 12%
    expect(near(Math.max(...xs), tx, 0.3)).toBe(true);
  }
});

test('还没拉动时轮廓与静态逐点一致 —— 指针刚碰上把手不该有任何跳变', () => {
  // 指针还在把手本体内时 tx = HANDLE_W(pull=0),但 strength 一进入牵引态就是满值。
  // 纵向收拢若不随拉伸缩放,这一瞬把手会突然矮一截(实测 132 → 120.2,已踩)
  const got = knots(liquidPath(HANDLE_W, CY, 1, 'left'));
  for (let i = 0; i < BASE_POINTS.length; i++) {
    const want = BASE_POINTS[(i + 1) % BASE_POINTS.length];
    expect(near(got[i].x, want.x)).toBe(true);
    expect(near(got[i].y, want.y)).toBe(true);
  }
});

test('整体在变:上下两端被抽走体积而内收,不是只有中段动', () => {
  const got = knots(liquidPath(HANDLE_W + HANDLE_REACH, CY, 1, 'left'));
  const base = BASE_POINTS.map((_, i) => BASE_POINTS[(i + 1) % BASE_POINTS.length]);
  const dented = got.filter((p, i) => base[i].x > 1 && p.x < base[i].x - 0.5);
  expect(dented.length).toBeGreaterThan(0);
});

test('整体在变:贴边浸润线朝牵引点收缩变短', () => {
  const got = knots(liquidPath(HANDLE_W + HANDLE_REACH, CY, 1, 'left'));
  const base = BASE_POINTS.map((_, i) => BASE_POINTS[(i + 1) % BASE_POINTS.length]);
  // 顶端(y≈0)被往下拉、底端(y≈132)被往上拉 —— 浸润线两头都在动
  const top = base.findIndex((p) => p.x === 0 && p.y < 1);
  const bot = base.findIndex((p) => p.x === 0 && p.y > HANDLE_H - 1);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bot).toBeGreaterThanOrEqual(0);
  expect(got[top].y).toBeGreaterThan(base[top].y + 1);
  expect(got[bot].y).toBeLessThan(base[bot].y - 1);
});

test('拉得越远轮廓伸得越外', () => {
  const outer = (tx: number) => Math.max(...knots(liquidPath(tx, CY, 1, 'left')).map((p) => p.x));
  const a = outer(HANDLE_W);
  const b = outer(HANDLE_W + HANDLE_REACH / 2);
  const c = outer(HANDLE_W + HANDLE_REACH);
  expect(b).toBeGreaterThan(a);
  expect(c).toBeGreaterThan(b);
});

test('脱手判据两轴分开:横向拉断 / 纵向滑出横带 / 退回边栏内侧', () => {
  expect(tension(HANDLE_REACH, 0)).not.toBeNull();
  expect(tension(HANDLE_REACH + 1, 0)).toBeNull(); // 横向拉断
  expect(tension(0, HANDLE_H / 2)).not.toBeNull();
  expect(tension(0, HANDLE_H / 2 + 1)).toBeNull(); // 滑出把手所在横带
  expect(tension(-(HANDLE_W + 13), 0)).toBeNull(); // 退回边栏内侧够深
  // 斜着拉不该提前断:纵向是沿液面滑,不拉伸液体(用欧氏距离判时这一条会断)
  expect(tension(HANDLE_REACH - 5, 60)).not.toBeNull();
  // 往边栏侧移动不形变,但牵引点纵向照常跟随
  expect(tension(-10, 20)).toEqual({ tx: HANDLE_W, ty: CY + 20 });
  expect(tension(40, 0)).toEqual({ tx: HANDLE_W + 40, ty: CY });
});

test('牵引点纵向恒等于指针真实位置,不做夹取 —— 命中圆才罩得住指针', () => {
  for (const dy of [-66, -30, 0, 45, 66]) {
    expect(tension(20, dy)!.ty).toBe(CY + dy);
  }
});

test('右侧把手是左侧的 x → LIQUID_W − x 镜像', () => {
  const l = nums(liquidPath(HANDLE_W + HANDLE_REACH * 0.7, CY - 20, 1, 'left'));
  const r = nums(liquidPath(HANDLE_W + HANDLE_REACH * 0.7, CY - 20, 1, 'right'));
  expect(l).toHaveLength(r.length);
  for (let i = 0; i < l.length; i += 2) {
    expect(near(l[i], LIQUID_W - r[i])).toBe(true);
    expect(near(l[i + 1], r[i + 1])).toBe(true);
  }
});

test('命中圆把牵引点裹在正中 —— 指针底下恒有命中区,粘着就点得到', () => {
  // 拉到最远、牵引点又在凸边范围外(轮廓头部够不到指针)是最苛刻的一组
  const c = hitCircle(HANDLE_W + HANDLE_REACH, 20, 'left');
  expect(c.size).toBe(HIT_R * 2);
  expect(c.left).toBe(HANDLE_W + HANDLE_REACH - HIT_R); // 左边缘 = 牵引点 − 半径
  expect(c.top).toBe(`calc(50% + ${20 - HANDLE_H / 2 - HIT_R}px)`);
  // 牵引点在把手竖直中线时,圆恰好压在容器的垂直中心
  expect(hitCircle(HANDLE_W, HANDLE_H / 2, 'left').top).toBe(`calc(50% + ${-HIT_R}px)`);
});

test('命中圆是独立元素而非并进液体层的 clipPath —— 否则拉满时它有一半在 box 外被裁掉', () => {
  // 拉到最远时牵引点正落在液体层的边缘:并进 clipPath 的话圆的外半圈超出 border box,
  // 指针恰在边界上点不动(已踩)。独立定位则不受 box 约束,允许 left 越过层宽
  const c = hitCircle(HANDLE_W + HANDLE_REACH, HANDLE_H / 2, 'left');
  expect(c.left! + c.size).toBeGreaterThan(LIQUID_W);
});

test('命中圆的镜像:右侧把手用 right 定位,数值与左侧一致', () => {
  const l = hitCircle(HANDLE_W + 20, 40, 'left');
  const r = hitCircle(HANDLE_W + 20, 40, 'right');
  expect(r.left).toBeUndefined();
  expect(r.right).toBe(l.left);
  expect(r.top).toBe(l.top);
});

test('形变量为负时位移反向 —— 回弹过冲的内凹', () => {
  const pulled = Math.max(...knots(liquidPath(HANDLE_W + HANDLE_REACH * 0.7, CY, 1, 'left')).map((p) => p.x));
  const dent = knots(liquidPath(HANDLE_W + HANDLE_REACH * 0.7, CY, -0.08, 'left'));
  const mid = dent.find((p) => near(p.y, CY, 3) && p.x > 1);
  expect(pulled).toBeGreaterThan(HANDLE_W);
  expect(mid!.x).toBeLessThan(HANDLE_W); // 中段被吸回本体内侧
});
