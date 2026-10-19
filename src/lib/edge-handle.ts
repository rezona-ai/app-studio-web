// 骑缝竖长条把手(IDE 侧栏折叠把手样式)的纯几何:直边贴边栏边缘、曲边凸向画布侧。
// Chat 收起/展开与预览一键全宽共用同一份 —— 各画一遍镜像 clipPath 迟早漂移。
export const HANDLE_W = 24;
export const HANDLE_H = 132; // 与宽等比(原 16×88 整体 ×1.5)

// 圆角梯形:一侧直边贴边栏,另一侧以曲线收进短边。两版是 x → HANDLE_W − x 的镜像(由单测守护)
export const HANDLE_CLIP = {
  left: "path('M0 0 C0 16.5 24 21 24 36 L24 96 C24 111 0 115.5 0 132 Z')", // 直边在左,凸向右(Chat 栏右缘)
  right: "path('M24 0 C24 16.5 0 21 0 36 L0 96 C0 111 24 115.5 24 132 Z')", // 直边在右,凸向左(预览面板左缘)
} as const;

// ── 液体粘连跟随(设计稿 2026-08-18-edge-handle-liquid-follow)────────────────
// 把手是一滴贴在边栏上的液体:指针牵引时**整滴**变形 —— 轮廓上每个采样点各有各的位移,
// 再用闭合 Catmull-Rom 重建。整体感来自位移场本身,不是给某一段加装饰。
// 只算左侧一套坐标(贴边在 x=0),右侧由 x → LIQUID_W − x 出镜像(单测守护);
// **不用 CSS scaleX(-1)** —— 那会把同一棵子树里的图标一起镜像。

// 张力作用长度;同时是最大拉伸行程 —— 牵引点 1:1 跟手直到脱手。
// 取身宽的 1.8 倍:表面张力偏弱、粘一小段就脱手。早先试过 110(4.5 倍)整滴被抻成细长三角旗、
// 88(3.7 倍)仍偏长,且粘太久会一直吃掉画布的点击
export const HANDLE_REACH = 44;
export const LIQUID_W = HANDLE_W + HANDLE_REACH; // 液体层宽度
export const HIT_R = 14; // 指针处隐形命中圆的半径

const SIGMA_X = 32; // 主瓣宽度:决定被拉出的「头」有多宽
const SIGMA_LOBE = 55; // 负瓣宽度:决定腰收在哪儿
const SIGMA_Y = 60; // 纵向收拢的作用宽度:取大是为了让贴边线的两端也动起来
const LOBE = 0.15; // 负瓣系数:腰与两端内收的幅度
const DRAW_Y = 0.3; // 纵向朝牵引点收拢的强度

type Pt = { x: number; y: number };

const gauss = (d: number, sigma: number) => Math.exp(-((d / sigma) ** 2));
// 平顶高斯(4 次方):峰顶是一段平台而不是一个尖点 —— 被拉出的那一端因此是**圆头**。
// 用普通高斯的话峰顶只有一个点到得了牵引点,轮廓读作一根尖刺
const flatTop = (d: number, sigma: number) => Math.exp(-((d / sigma) ** 4));

// 静态轮廓的四段(与 HANDLE_D.left 逐值一致):曲线 → 凸边直线 → 曲线 → 贴边直线
const CUBIC_IN = [{ x: 0, y: 0 }, { x: 0, y: 16.5 }, { x: 24, y: 21 }, { x: 24, y: 36 }] as const;
const CUBIC_OUT = [{ x: 24, y: 96 }, { x: 24, y: 111 }, { x: 0, y: 115.5 }, { x: 0, y: 132 }] as const;

const cubicAt = (p: readonly Pt[], t: number): Pt => {
  const u = 1 - t;
  const w = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3];
  return {
    x: w[0] * p[0].x + w[1] * p[1].x + w[2] * p[2].x + w[3] * p[3].x,
    y: w[0] * p[0].y + w[1] * p[1].y + w[2] * p[2].y + w[3] * p[3].y,
  };
};
const lineAt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// 每段取 [0,1) 区间的点,闭合时端点不重复。曲线段密一些,直线段稀一些(共线点重建仍是直线)
const sampleOutline = (): Pt[] => {
  const pts: Pt[] = [];
  for (let i = 0; i < 20; i++) pts.push(cubicAt(CUBIC_IN, i / 20));
  // 凸边间隔 3px:牵引点落在两个采样点之间时头部会欠冲,间隔越大欠冲越明显(6px 时差 1.8px)
  for (let i = 0; i < 20; i++) pts.push(lineAt({ x: 24, y: 36 }, { x: 24, y: 96 }, i / 20));
  for (let i = 0; i < 20; i++) pts.push(cubicAt(CUBIC_OUT, i / 20));
  for (let i = 0; i < 14; i++) pts.push(lineAt({ x: 0, y: 132 }, { x: 0, y: 0 }, i / 14));
  // 采样值带浮点尾巴,贴边那条线必须是**严格** 0 才守得住「浸润线不离开边栏」
  return pts.map((p) => ({ x: Math.abs(p.x) < 1e-9 ? 0 : p.x, y: Math.abs(p.y) < 1e-9 ? 0 : p.y }));
};

/** 静态轮廓的采样点:模块加载时算一次,每帧只做位移 + 重建 */
export const BASE_POINTS: readonly Pt[] = sampleOutline();

/**
 * 指针相对本体外缘的位移 → 牵引点(液体层局部坐标)。
 * 超出张力作用长度返回 null = 脱手;指针退回边栏内侧够深也返回 null ——
 * 否则指针停在边栏上永远够不着张力作用长度,rAF 会一直空转。
 */
export function tension(dx: number, dy: number): { tx: number; ty: number } | null {
  // 两轴分开判,**不用**欧氏距离:纵向移动是手指沿液面滑,并不拉伸液体,算进距离会让稍微斜一点
  // 的拉扯提前脱手(实测斜拉 45px 就断)。横向才是拉伸
  if (dx > HANDLE_REACH) return null;
  if (dx < -(HANDLE_W + 12)) return null; // 退回边栏内侧够深:否则指针停在边栏上永远够不着阈值,rAF 空转
  // 滑出把手所在的横带即收场。这条同时保证 ty 落在液体层内 ——
  // 牵引点若被夹取就不再等于指针真实位置,命中圆罩不住指针,「粘着就点得到」立刻失效
  if (Math.abs(dy) > HANDLE_H / 2) return null;
  // 往边栏侧(dx ≤ 0)不形变,但牵引点纵向照常跟随
  return { tx: HANDLE_W + Math.max(dx, 0), ty: HANDLE_H / 2 + dy };
}

/** 位移场:轮廓上每个点各有各的位移,整体形变由此而来 */
function displace(tx: number, ty: number, strength: number): Pt[] {
  const pull = tx - HANDLE_W;
  const stretch = pull / HANDLE_REACH; // 归一化拉伸量:两个方向的位移都得随它缩放,否则没拉动也会变形
  return BASE_POINTS.map((p) => {
    const d = Math.abs(p.y - ty);
    // 边缘因子:贴边(x=0)为 0 → 浸润线横向不动;凸边为 1 → 拉得最多
    const e = p.x / HANDLE_W;
    // 主瓣(平顶,出圆头) − 负瓣(宽而缓,出腰与两端内收)。
    // 系数写成 (1+LOBE)·主 − LOBE·负:d=0 处恰好为 1,头部精确到位;
    // 写成 主 − LOBE·负 的话 d=0 得 1−LOBE,头就够不到指针,粘连立刻失真
    const w = (1 + LOBE) * flatTop(d, SIGMA_X) - LOBE * gauss(d, SIGMA_LOBE);
    // 纵向收拢**不乘 e** —— 贴边那条线也朝牵引点聚拢,浸润线因此变短。这是「整滴在变」的关键一笔。
    // 但必须乘 stretch:横向有 pull 兜着「没拉就不动」,纵向没有,漏了它就会在指针刚碰上把手、
    // 什么都还没拉的那一瞬把整个把手压矮一截(132 → 120.2),读作「聚焦时高度突然变小」(已踩)
    const dy = (ty - p.y) * gauss(d, SIGMA_Y) * DRAW_Y * stretch * strength;
    return { x: p.x + pull * e * w * strength, y: p.y + dy };
  });
}

const n = (v: number) => Math.round(v * 100) / 100;

/** 闭合 Catmull-Rom → 三次贝塞尔:曲线过每一个采样点,且处处平滑无折角 */
function toPath(pts: Pt[], side: 'left' | 'right'): string {
  const N = pts.length;
  const at = (i: number) => pts[((i % N) + N) % N];
  // 输出前把 x 夹到 ≥0 再镜像:Catmull-Rom 的**控制点**会被邻点带到负半轴(实测 −0.02),
  // 曲线随之微微越过边栏。夹在这里,「液体不离开边栏」就由构造保证而不是靠容差
  const out = (p: Pt) => {
    const x = Math.max(p.x, 0);
    return `${n(side === 'left' ? x : LIQUID_W - x)} ${n(p.y)}`;
  };
  let d = `M${out(at(0))}`;
  for (let i = 0; i < N; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${out(c1)} ${out(c2)} ${out(p2)}`;
  }
  return `${d} Z`;
}

/**
 * 形变后的闭合轮廓。strength=0 时逐点落在静态采样点上(= 静态轮廓);
 * strength<0 是脱手回弹的过冲,位移整体反向 = 反向内凹。
 */
export function liquidPath(tx: number, ty: number, strength: number, side: 'left' | 'right'): string {
  return toPath(displace(tx, ty, strength), side);
}

/**
 * 指针处那个隐形命中圆的落位(相对把手的定位容器 —— 容器是 inset-y-0 全高,液体层垂直居中)。
 *
 * 牵引点落在凸边范围外时轮廓头部伸不到指针(边缘因子 e < 1),只认可见轮廓就会点不到,
 * 这个圆保证指针底下**恒有**命中区。它必须是**独立元素**而不是并进液体层的 clipPath ——
 * 拉到最远时牵引点正落在液体层的边缘,并进去的话圆有一半在 box 外被裁掉,
 * 「拉满时点不动」(已踩:恰好拉到 REACH 时点击不触发)。
 */
export function hitCircle(
  tx: number,
  ty: number,
  side: 'left' | 'right',
): { size: number; top: string; left?: number; right?: number } {
  const size = HIT_R * 2;
  return {
    size,
    top: `calc(50% + ${n(ty - HANDLE_H / 2 - HIT_R)}px)`,
    ...(side === 'left' ? { left: n(tx - HIT_R) } : { right: n(tx - HIT_R) }),
  };
}
