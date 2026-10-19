// 3D 空间指示器的投影几何(spec 2026-08-20-axis-gizmo-and-estimate-chip)。无副作用、不认识 React、不认识引擎。
//
// 接口刻意取「**相机方向单位向量**」而不是球坐标:本仓库有两套 3D 引擎 ——
// model-viewer 给的是球坐标(getCameraOrbit),自建的 three.js 预览直接给 position−target。
// 以向量为界,投影只写一遍;球坐标→向量是另一个小纯函数,只有 model-viewer 那条路用。

export interface Vec3 { x: number; y: number; z: number }

/** 一条半轴投影到屏幕后的样子。x/y 落在 [-1,1] 单位空间,组件再乘半径映射到 SVG */
export interface AxisTick {
  axis: 'x' | 'y' | 'z';
  sign: 1 | -1;
  /** 屏幕 x,向右为正 */
  x: number;
  /** 屏幕 y,**向下为正**(已按 SVG/DOM 口径翻转) */
  y: number;
  /** 沿视线的深度:正 = 指向观察者(近),负 = 指向背面(远) */
  depth: number;
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
/** 退化阈值:相机方向与参考轴共线时叉积长度趋 0,低于此值就换参考轴 */
const DEGENERATE = 1e-6;

/**
 * 透视强度。**空间感的主要来源** —— 纯正交投影下「朝观察者」与「背离观察者」的同一条轴
 * 投影等长,前后完全读不出来(只剩不透明度这一个线索,偏弱)。
 * 加一档透视除法后近端更长、远端更短,比例约 1 : (1-k)/(1+k)。
 * 0.3 是实测的折中:再大会让近端轴显得夸张失真,再小则看不出前后。
 */
const PERSPECTIVE = 0.3;

/**
 * phi 夹离极点的余量。**这不是数值卫生,是功能所需**:
 * 正俯视 / 正仰视时相机方向向量退化成 ±Y,**方位角在向量里彻底丢了**(数学上不可恢复),
 * 而本模块的整个接口就是向量 —— 于是转盘自转时指示器会冻住:模型在转、三轴不动。
 * model-viewer 的 `minimumPolarAngle` 默认就是 0,phi 真能取到正 0。
 * 夹一丝之后 y 仍≈1(看上去还是正俯视),水平分量约 1e-3、远高于 DEGENERATE,归一化后方位角原样恢复。
 */
const POLE_EPS = 1e-3;

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const norm = (v: Vec3): Vec3 => {
  const l = len(v);
  // 零向量归一化会得到 NaN;调用方只在已知非退化时走到这里,兜一手是为了别把 NaN 传下去
  return l < DEGENERATE ? { x: 0, y: 0, z: 0 } : { x: v.x / l, y: v.y / l, z: v.z / l };
};

/**
 * model-viewer 的球坐标 → 相机方向单位向量(从目标指向相机)。
 *
 * 口径按 model-viewer 的 `getCameraOrbit()`:`theta` 绕 Y 轴、**从 +Z 转向 +X**;
 * `phi` 是与 +Y 的夹角(0 = 正俯视)。两者都是弧度。
 * 记错任何一条都不会报错,只会让整块指示器指向错误的方向 —— 故单测把这几个特征点钉死。
 * phi 会被夹离极点(见 POLE_EPS)。
 */
export function orbitToDirection(theta: number, phi: number): Vec3 {
  const clamped = Math.min(Math.max(phi, POLE_EPS), Math.PI - POLE_EPS);
  const s = Math.sin(clamped);
  return { x: s * Math.sin(theta), y: Math.cos(clamped), z: s * Math.cos(theta) };
}

/**
 * 六条半轴在屏幕上的投影,**按 depth 升序**(远的在前)——
 * 调用方顺序绘制即天然获得遮挡关系,组件里不必再排序。
 *
 * 视基是标准的「看向原点」look-at:`zc` = 相机方向(指向观察者),
 * `xc = normalize(cross(worldUp, zc))`,`yc = cross(zc, xc)`。
 * 世界轴 `v` 的屏幕坐标是 `(v·xc, -(v·yc))`、深度是 `v·zc`,再乘一档**透视缩放**:
 * `scale = (1 - k) / (1 - k·depth)` —— 分子取 `1 - k` 是为了把最大值(depth = 1)钉在 1,
 * 于是结果恒不超出单位圆,组件按半径映射时不会画到 viewBox 外面。
 *
 * **退化分支是必须的**:正俯视 / 正仰视时 `zc` 与 worldUp 共线,`cross` 得零向量 ——
 * 不换参考轴的话归一化产出 NaN,整块指示器塌掉(单测钉住这条)。改用 +Z 当参考轴,
 * 于是俯视时 X/Z 平面照常铺开、Y 缩到原点。
 */
export function projectAxes(dir: Vec3): AxisTick[] {
  const zc = norm(dir);
  let xc = cross(WORLD_UP, zc);
  if (len(xc) < DEGENERATE) xc = cross({ x: 0, y: 0, z: 1 }, zc);
  xc = norm(xc);
  const yc = cross(zc, xc);

  const axes: { axis: AxisTick['axis']; v: Vec3 }[] = [
    { axis: 'x', v: { x: 1, y: 0, z: 0 } },
    { axis: 'y', v: { x: 0, y: 1, z: 0 } },
    { axis: 'z', v: { x: 0, y: 0, z: 1 } },
  ];
  const ticks: AxisTick[] = [];
  for (const { axis, v } of axes) {
    for (const sign of [1, -1] as const) {
      const w = { x: v.x * sign, y: v.y * sign, z: v.z * sign };
      const depth = dot(w, zc);
      const scale = (1 - PERSPECTIVE) / (1 - PERSPECTIVE * depth);
      ticks.push({
        axis,
        sign,
        x: dot(w, xc) * scale,
        // 屏幕 y 向下为正,而 yc 是「向上」——取负号翻转到 SVG 口径
        y: -dot(w, yc) * scale,
        depth,
      });
    }
  }
  return ticks.sort((a, b) => a.depth - b.depth);
}

/**
 * 「点这个端点 → 相机该去哪」:半轴 → 目标球坐标(弧度,与 `orbitToDirection` 同口径)。
 *
 * 抽成纯函数的理由与 `projectAxes` 相同:两套引擎只在**怎么把相机搬过去**上不同
 * (model-viewer 写 `cameraOrbit`、three.js 挪 `camera.position`),「搬到哪」是同一件事。
 *
 * `±Y` 落在极点上,**方位角在那里没有意义** —— 故沿用调用方给的当前 theta。
 * 不沿用的话点一下俯视图会顺带把模型在画面里转个方向,用户没要求过那件事。
 */
export function axisToOrbit(
  axis: 'x' | 'y' | 'z',
  sign: 1 | -1,
  currentTheta: number,
): { theta: number; phi: number } {
  if (axis === 'y') return { theta: currentTheta, phi: sign === 1 ? 0 : Math.PI };
  // theta 从 +Z 转向 +X(见 orbitToDirection):+Z→0、+X→π/2、−Z→π、−X→−π/2
  const theta = axis === 'z' ? (sign === 1 ? 0 : Math.PI) : (sign === 1 ? Math.PI / 2 : -Math.PI / 2);
  return { theta, phi: Math.PI / 2 };
}
