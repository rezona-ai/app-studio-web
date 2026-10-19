import { describe, expect, test } from 'vitest';
import { axisToOrbit, orbitToDirection, projectAxes, type Vec3 } from './axis-gizmo';

// 浮点比较:投影值是三角函数算出来的,不能用 toBe
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const pick = (ticks: ReturnType<typeof projectAxes>, axis: 'x' | 'y' | 'z', sign: 1 | -1) =>
  ticks.find((t) => t.axis === axis && t.sign === sign)!;

// model-viewer 的球坐标口径:theta 绕 Y 轴、从 +Z 转向 +X;phi 是与 +Y 的夹角。
// 这三条钉住口径 —— 记错任何一条,整个 gizmo 会指向错误的方向而不会报错
describe('orbitToDirection', () => {
  test('theta=0, phi=π/2 → 相机在 +Z(正面看)', () => {
    const d = orbitToDirection(0, Math.PI / 2);
    near(d.x, 0); near(d.y, 0); near(d.z, 1);
  });

  test('theta=π/2, phi=π/2 → 相机在 +X(右侧看)', () => {
    const d = orbitToDirection(Math.PI / 2, Math.PI / 2);
    near(d.x, 1); near(d.y, 0); near(d.z, 0);
  });

  // 正俯视(phi=0)是**必须特殊对待**的:方向向量在极点上把方位角彻底丢了(数学上不可恢复),
  // 而本模块的整个接口就是向量 —— 于是转盘自转时指示器会冻住(模型在转、轴不动)。
  // 故把 phi 夹离极点一丝:y 仍≈1(看上去还是正俯视),但水平分量非零、归一化后方位角原样恢复
  test('phi=0 → 仍是近乎正俯视,但方位角不丢', () => {
    const a = orbitToDirection(0, 0);
    near(a.y, 1, 1e-5);
    expect(Math.hypot(a.x, a.z)).toBeGreaterThan(1e-6);   // 水平分量没被压成 0

    // 不同 theta 必须给出不同的水平朝向 —— 这条才是「方位角没丢」的实质
    const b = orbitToDirection(Math.PI / 2, 0);
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeGreaterThan(1e-6);
  });

  test('phi=π(正仰视)同样不丢方位角', () => {
    const a = orbitToDirection(0, Math.PI);
    near(a.y, -1, 1e-5);
    const b = orbitToDirection(Math.PI / 2, Math.PI);
    expect(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)).toBeGreaterThan(1e-6);
  });

  test('恒是单位向量', () => {
    for (const [th, ph] of [[0.3, 0.7], [2.1, 2.9], [-1.2, 0.05]]) {
      const d = orbitToDirection(th, ph);
      near(Math.hypot(d.x, d.y, d.z), 1);
    }
  });
});

describe('projectAxes', () => {
  const front: Vec3 = { x: 0, y: 0, z: 1 };   // 正面视角

  test('六条轴各出一次(三正三负)', () => {
    const ticks = projectAxes(front);
    expect(ticks).toHaveLength(6);
    expect(new Set(ticks.map((t) => `${t.axis}${t.sign}`)).size).toBe(6);
  });

  // 正面视角下:+X 在右、+Y 在上(**屏幕 y 向下为正,故 y 应为负**)、+Z 冲着观察者
  test('正面视角:+X 落右侧、+Y 落上方(屏幕 y 已翻转)、+Z 深度最大且投影≈原点', () => {
    const ticks = projectAxes(front);
    // 垂直于视线的轴带中间档透视缩放,故只断方向与量级(不再是满长 1)
    const px = pick(ticks, 'x', 1);
    expect(px.x).toBeGreaterThan(0.5);
    near(px.y, 0);

    const py = pick(ticks, 'y', 1);
    expect(py.y).toBeLessThan(-0.5);          // 向上 = 负 y
    near(py.x, 0);

    const pz = pick(ticks, 'z', 1);
    near(pz.x, 0); near(pz.y, 0);
    near(pz.depth, 1);                        // 正对观察者
  });

  // 透视缩放让同一条轴的正负半轴**长度不等**(近的长、远的短),故只断「共线且反向」+ 深度取反
  test('负轴与对应正轴共线反向,深度取反', () => {
    const ticks = projectAxes({ x: 0.3, y: 0.5, z: 0.81 });
    for (const axis of ['x', 'y', 'z'] as const) {
      const p = pick(ticks, axis, 1);
      const n = pick(ticks, axis, -1);
      near(p.depth, -n.depth);
      near(p.x * n.y - p.y * n.x, 0, 1e-9);          // 叉积为 0 = 共线
      expect(p.x * n.x + p.y * n.y).toBeLessThanOrEqual(0);   // 点积非正 = 反向
    }
  });

  // 空间感的主要来源:正交投影下「朝观察者」与「背离观察者」的同一条轴投影等长,
  // 完全读不出前后。加一档透视除法后近端更长 —— 这条钉住它,去掉透视即红
  test('透视:朝向观察者的半轴比背离的更长', () => {
    const ticks = projectAxes({ x: 0.5, y: 0.2, z: 0.84 });
    for (const axis of ['x', 'y', 'z'] as const) {
      const p = pick(ticks, axis, 1);
      const n = pick(ticks, axis, -1);
      const [near_, far] = p.depth > n.depth ? [p, n] : [n, p];
      // 深度差得够大才有可比性(某条轴几乎垂直于视线时两半轴本就等长)
      if (Math.abs(near_.depth - far.depth) < 0.2) continue;
      expect(Math.hypot(near_.x, near_.y)).toBeGreaterThan(Math.hypot(far.x, far.y));
    }
  });

  // 透视缩放**不得**把投影推出单位圆 —— 否则组件按 R 映射时会画到 viewBox 外面
  test('透视后仍不超出单位圆', () => {
    for (const dir of [{ x: 0, y: 0, z: 1 }, { x: 0.5, y: 0.5, z: 0.7 }, { x: 0, y: 1, z: 0 }]) {
      for (const t of projectAxes(dir)) {
        expect(Math.hypot(t.x, t.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  // 远的在前:调用方顺序绘制即得遮挡关系,组件里不再排序
  test('返回值按 depth 升序', () => {
    const ticks = projectAxes({ x: 0.3, y: 0.5, z: 0.81 });
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].depth).toBeGreaterThanOrEqual(ticks[i - 1].depth);
    }
  });

  // 相机方向与 worldUp 共线时 cross 退化成零向量 —— 不兜这一下,正俯视整块会塌成 NaN
  test('正俯视 / 正仰视不出 NaN,且投影仍在单位范围内', () => {
    for (const dir of [{ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }]) {
      const ticks = projectAxes(dir);
      expect(ticks).toHaveLength(6);
      for (const t of ticks) {
        expect(Number.isFinite(t.x)).toBe(true);
        expect(Number.isFinite(t.y)).toBe(true);
        expect(Number.isFinite(t.depth)).toBe(true);
        expect(Math.hypot(t.x, t.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  // 正俯视时 Y 轴正对观察者:它必须缩到原点附近,而 X/Z 铺在平面上
  test('正俯视:+Y 投影≈原点且深度为 1,X/Z 仍展开', () => {
    const ticks = projectAxes({ x: 0, y: 1, z: 0 });
    const py = pick(ticks, 'y', 1);
    near(py.x, 0); near(py.y, 0); near(py.depth, 1);
    expect(Math.hypot(pick(ticks, 'x', 1).x, pick(ticks, 'x', 1).y)).toBeGreaterThan(0.5);
    expect(Math.hypot(pick(ticks, 'z', 1).x, pick(ticks, 'z', 1).y)).toBeGreaterThan(0.5);
  });

  // 非单位向量(调用方忘了归一)不该把投影放大 —— 内部先归一
  test('传入非单位向量也按方向处理', () => {
    const a = projectAxes({ x: 0, y: 0, z: 1 });
    const b = projectAxes({ x: 0, y: 0, z: 7 });
    for (let i = 0; i < a.length; i++) {
      near(a[i].x, b[i].x); near(a[i].y, b[i].y); near(a[i].depth, b[i].depth);
    }
  });
});

// 点端点切视图:先把「哪根轴」翻译成目标球坐标,再交给各引擎搬相机。
// 抽成纯函数是因为两套引擎(model-viewer 写 cameraOrbit / three.js 挪 camera.position)
// 只在「怎么搬」上不同,「搬到哪」是同一件事
describe('axisToOrbit', () => {
  // 往返一致性是最强的断言:轴 → 球坐标 → 方向向量,应当就是那根轴本身
  test('四条水平轴:换算回方向向量就是该轴', () => {
    const cases: [('x' | 'z'), (1 | -1), Vec3][] = [
      ['x', 1, { x: 1, y: 0, z: 0 }],
      ['x', -1, { x: -1, y: 0, z: 0 }],
      ['z', 1, { x: 0, y: 0, z: 1 }],
      ['z', -1, { x: 0, y: 0, z: -1 }],
    ];
    for (const [axis, sign, want] of cases) {
      const { theta, phi } = axisToOrbit(axis, sign, 0);
      const d = orbitToDirection(theta, phi);
      near(d.x, want.x, 1e-3); near(d.y, want.y, 1e-3); near(d.z, want.z, 1e-3);
    }
  });

  // ±Y 在极点上,方位角**没有意义** —— 必须沿用当前 theta,否则点一下俯视图会顺带把模型转个方向
  test('±Y:phi 取极点,theta 沿用当前值(不凭空转一下)', () => {
    for (const current of [0, 1.2, -2.5]) {
      expect(axisToOrbit('y', 1, current)).toEqual({ theta: current, phi: 0 });
      expect(axisToOrbit('y', -1, current)).toEqual({ theta: current, phi: Math.PI });
    }
  });

  // 水平轴的 theta 与当前视角无关(点 +X 就是从 +X 看,不受你此刻在哪影响)
  test('水平轴的目标与当前 theta 无关', () => {
    expect(axisToOrbit('x', 1, 0)).toEqual(axisToOrbit('x', 1, 3));
  });
});
