'use client';
import { useTranslation } from 'react-i18next';
import { projectAxes, type AxisTick, type Vec3 } from '@/lib/axis-gizmo';

/**
 * 3D 空间指示器(spec 2026-08-20-axis-gizmo-and-estimate-chip)。
 *
 * 解两件事:**出现即暗示这东西可以拖**、**方位跟着相机实时转即告知模型朝向**。
 * 三处可拖的 3D 预览共用它(lightbox 的 model3d / rig3d、Files 面板的 glb),故落在 ui/ 而非 canvas/ ——
 * canvas/ 与 files/ 是同级功能目录,让后者横向 import 前者没有先例(只有 workspace/ 自上而下引 canvas/)。
 * 本组件零 store 耦合、纯展示,正合 ui/ 这个共享桶。
 * 各宿主只负责把「相机方向向量」喂进来 —— 投影几何在 lib/axis-gizmo.ts,不在这里。
 *
 * 画法参照 Tripo Studio 的视图 gizmo:**正轴连线 + 端点球(带字母),负轴只留一个点**。
 * 连杆版(六条杆从中心放射)与空心环版(三球三环)都试过,转起来互相穿插更乱。
 *
 * **六个端点可点,点了切到对应视图**。容器 `pointer-events-none`、只有端点 `pointer-events-auto` ——
 * 这是「可点」与「别挡住拖模型」唯一能同时成立的做法(整块吃指针的话那一角就拖不动了)。
 * 端点是真控件,故带 `role="button"` + `aria-label` + Enter/Space,不再整块 aria-hidden。
 *
 * 体积感靠**端点 + 遮挡**,不是「线 + 箭头」:
 * 线是一维图元,转起来只有角度在变;球有体积,且**近球会遮住它后面的线** ——
 * 遮挡是转动过程中最强的深度线索,而遮挡关系由 projectAxes 的 depth 升序自然给出。
 *
 * **无 CSS 动画**:它跟着相机走、不自己动,故不必进 prefers-reduced-motion 的禁用列表。
 */

/**
 * 画布尺寸。**其余尺寸一律由它按比例派生** —— 改这一个数即整体缩放,
 * 不必再逐个调线宽 / 字号 / 球径(曾因只改 SIZE 而线条显得虚)。
 * 导出还给接线处的用例算中心,免得那边把 SIZE/2 抄成字面量、改这里就悄悄失准。
 */
export const GIZMO_SIZE = 208;
const C = GIZMO_SIZE / 2;
/** 轴长(到球心)。R + 最大球径必须 < GIZMO_SIZE/2,否则近端球会被 viewBox 切掉 */
const R = GIZMO_SIZE * 0.36;
/**
 * 端点半径:近大远小(透视之外的第二重体积线索)。**六个端点共用这一档** ——
 * 正轴球与负轴点在同一深度上一样大,只在「有没有渐变 / 字母」上不同。
 * 曾给负轴单开一档更小的范围,结果是它自己那点差值(2.3px)肉眼读不出在缩。
 */
const BALL = { far: GIZMO_SIZE * 0.037, near: GIZMO_SIZE * 0.062 };
/** 命中区半径:恒取最大值那一档,免得远端的点小到点不中(费米茨定律,不因深度缩小) */
const HIT = GIZMO_SIZE * 0.062;
/** 轴杆线宽 */
const WIDTH = { far: GIZMO_SIZE * 0.011, near: GIZMO_SIZE * 0.022 };
/** 球内字母字号(要塞进最小的那个正轴球里) */
const FONT = GIZMO_SIZE * 0.058;
/** 不透明度渐变:二值只分得出前后两档,渐变才读得出「偏前多少」 */
const OPACITY = { far: 0.3, near: 1 };
/** depth ∈ [-1,1] → [a,b] */
const byDepth = (depth: number, a: number, b: number) => a + ((depth + 1) / 2) * (b - a);

const AXIS_COLOR = {
  x: 'var(--color-axis-x)',
  y: 'var(--color-axis-y)',
  z: 'var(--color-axis-z)',
} as const;

export default function AxisGizmo({
  dir, onPick, className = '',
}: {
  dir: Vec3;
  /** 点端点切视图。不传即退化成纯展示(连命中区都不渲染) */
  onPick?: (axis: AxisTick['axis'], sign: 1 | -1) => void;
  className?: string;
}) {
  const { t: t18n } = useTranslation();
  // projectAxes 已按 depth 升序(远的在前),顺序绘制即天然获得遮挡关系 —— 这里不再排序
  const ticks = projectAxes(dir);
  return (
    <svg
      // 可点时它是控件簇(端点各自有名字),不能整块藏起来;纯展示时才是装饰
      aria-hidden={onPick ? undefined : true}
      data-testid="axis-gizmo"
      width={GIZMO_SIZE}
      height={GIZMO_SIZE}
      viewBox={`0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`}
      className={`pointer-events-none select-none ${className}`}
    >
      {ticks.map((t) => {
        const positive = t.sign === 1;
        const color = AXIS_COLOR[t.axis];
        const opacity = byDepth(t.depth, OPACITY.far, OPACITY.near);
        const r = byDepth(t.depth, BALL.far, BALL.near);
        const width = byDepth(t.depth, WIDTH.far, WIDTH.near);
        const tipX = C + t.x * R;
        const tipY = C + t.y * R;
        return (
          // data-axis 只为让单测断得住绘制顺序(远→近)与逐轴取色 —— 那两条是真实不变式,
          // jsdom 无布局、量不出坐标,只能靠这个锚点
          <g key={`${t.axis}${t.sign}`} data-axis={`${t.axis}${positive ? '+' : '-'}`} opacity={opacity}>
            {/* 只有正轴连杆。杆止于球心:球是实心的,压在杆头上正好收口 */}
            {positive && (
              <line x1={C} y1={C} x2={tipX} y2={tipY} stroke={color} strokeWidth={width} strokeLinecap="round" />
            )}
            {/* 六个端点一律实心同色:正负只差「有没有杆和字母」。
                曾给正轴球加径向渐变做球体感,但外圈是半透明的 ⟹ 同样半径下它看着比实心的
                负轴点小、居中那个近端负轴点显得格外大(实机看出来的)。
                改实心之后「半径相等 = 看着一样大」才成立;体积感由半径 / 不透明度 / 遮挡 / 透视四档承担 */}
            <circle cx={tipX} cy={tipY} r={r} fill={color} />
            {positive && (
              <text
                x={tipX}
                y={tipY}
                // 字压在实色球上,故用「实色底上的文字」那档令牌;用会随主题翻的 --color-ink
                // 会在浅色稿变成深字压深色球
                fill="var(--color-on-primary)"
                fontSize={FONT}
                fontWeight="700"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {t.axis.toUpperCase()}
              </text>
            )}
          </g>
        );
      })}
      {/* 命中区单独一层、画在最上面:六个透明圆,只有它们吃指针。
          与可视端点分开画是因为**命中区不该随深度缩小** —— 远端那个点只有 4px,
          按可视半径做热区就点不中了(而透明圆压在别的轴上也不影响观感) */}
      {onPick && ticks.map((t) => {
        const positive = t.sign === 1;
        const label = `${positive ? '+' : '-'}${t.axis.toUpperCase()}`;
        const pick = () => onPick(t.axis, t.sign);
        return (
          <circle
            key={`hit-${t.axis}${t.sign}`}
            data-axis-hit={`${t.axis}${positive ? '+' : '-'}`}
            role="button"
            tabIndex={0}
            aria-label={t18n('canvas.gizmo.viewFrom', { axis: label })}
            cx={C + t.x * R}
            cy={C + t.y * R}
            r={HIT}
            fill="transparent"
            className="pointer-events-auto cursor-pointer outline-none"
            onClick={pick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();   // Space 默认会滚动页面
                pick();
              }
            }}
          />
        );
      })}
    </svg>
  );
}
