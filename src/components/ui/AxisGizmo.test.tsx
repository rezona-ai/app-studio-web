import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import AxisGizmo from './AxisGizmo';
import { projectAxes } from '@/lib/axis-gizmo';
import { GIZMO_SIZE } from './AxisGizmo';

afterEach(cleanup);

// 正面视角:+Z 冲着观察者,-Z 在最远
const FRONT = { x: 0, y: 0, z: 1 };
const g = (c: HTMLElement, axis: string) => c.querySelector(`[data-axis="${axis}"]`)!;

// 「可点」与「别挡住拖拽」同时成立的唯一做法:容器不吃指针,只有六个端点吃。
// 整块吃指针的话,指示器压着的那一角就再也拖不动模型了
test('容器不吃指针,只有六个端点吃', () => {
  const { container } = render(<AxisGizmo dir={FRONT} onPick={() => {}} />);
  const svg = container.querySelector('[data-testid="axis-gizmo"]')!;
  // SVG 元素的 .className 是 SVGAnimatedString(不是字符串),只能读 class 属性
  expect(svg.getAttribute('class')).toContain('pointer-events-none');
  const hits = container.querySelectorAll('[data-axis-hit]');
  expect(hits).toHaveLength(6);
  hits.forEach((h) => expect(h.getAttribute('class')).toContain('pointer-events-auto'));
});

// 端点是真的控件,故整块不再 aria-hidden;每个都要有名字(CLAUDE.md:交互元素必须有 aria-label)
test('六个端点各是带名字的按钮,且进 Tab 序', () => {
  const { container } = render(<AxisGizmo dir={FRONT} onPick={() => {}} />);
  const hits = [...container.querySelectorAll('[data-axis-hit]')];
  expect(hits.map((h) => h.getAttribute('aria-label'))).toEqual(
    expect.arrayContaining(['View from +X', 'View from -X', 'View from +Y', 'View from -Y', 'View from +Z', 'View from -Z']),
  );
  hits.forEach((h) => {
    expect(h).toHaveAttribute('role', 'button');
    expect(h).toHaveAttribute('tabindex', '0');
  });
});

test('点端点 → 回报对应半轴;Enter / Space 等价', () => {
  const onPick = vi.fn();
  const { container } = render(<AxisGizmo dir={FRONT} onPick={onPick} />);
  const hit = (a: string) => container.querySelector(`[data-axis-hit="${a}"]`)!;
  fireEvent.click(hit('x+'));
  expect(onPick).toHaveBeenLastCalledWith('x', 1);
  fireEvent.click(hit('z-'));
  expect(onPick).toHaveBeenLastCalledWith('z', -1);
  fireEvent.keyDown(hit('y+'), { key: 'Enter' });
  expect(onPick).toHaveBeenLastCalledWith('y', 1);
  fireEvent.keyDown(hit('y-'), { key: ' ' });
  expect(onPick).toHaveBeenLastCalledWith('y', -1);
  expect(onPick).toHaveBeenCalledTimes(4);
});

// 不给 onPick 时退化成纯展示:命中区整个不渲染,容器也回到 aria-hidden
test('不传 onPick:退化成纯展示,连命中区都不渲染', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  expect(container.querySelectorAll('[data-axis-hit]')).toHaveLength(0);
  expect(container.querySelector('[data-testid="axis-gizmo"]')).toHaveAttribute('aria-hidden');
});

// 尺寸全由 GIZMO_SIZE 派生:改那一个常量就整体缩放。这条钉住 viewBox 与画布同步 ——
// 只改 width/height 而漏了 viewBox 的话图会被裁掉一半
test('画布与 viewBox 都由 GIZMO_SIZE 派生', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  const svg = container.querySelector('[data-testid="axis-gizmo"]')!;
  expect(svg.getAttribute('width')).toBe(String(GIZMO_SIZE));
  expect(svg.getAttribute('height')).toBe(String(GIZMO_SIZE));
  expect(svg.getAttribute('viewBox')).toBe(`0 0 ${GIZMO_SIZE} ${GIZMO_SIZE}`);
});

// 六条半轴同色系(同一根轴的两头是同一件事),正负靠**实心 / 空心**区分 ——
// 负轴改用 --color-line 那版反而丢了「这是哪根轴」的信息
test('六条半轴都用自己那根轴的令牌色', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  for (const axis of ['x', 'y', 'z']) {
    // 正轴:杆与球都是这根轴的色(球走同色渐变)
    expect(g(container, `${axis}+`).querySelector('line')!.getAttribute('stroke'))
      .toBe(`var(--color-axis-${axis})`);
    // 负轴:那个点也用同色 —— 改灰会丢掉「这是哪根轴」的信息
    expect(g(container, `${axis}-`).querySelector('circle')!.getAttribute('fill'))
      .toBe(`var(--color-axis-${axis})`);
  }
});

// 六个端点走**同一档半径**:正轴球与负轴点在同一深度上一样大,只在「有没有渐变/字母」上不同。
// 负轴曾单独用一档更小的范围(3.95→6.24px),差 2.3px 肉眼读不出在缩,且没有任何用例覆盖它,
// 于是「等于没做」也不会红 —— 这条既锁「两档一致」,也锁「真的在缩」
test('负轴点与正轴球共用同一档半径,且都近大远小', () => {
  const r = (c: HTMLElement, a: string) =>
    Number(c.querySelector(`[data-axis="${a}"] circle`)!.getAttribute('r'));

  // 从 +Z 看:z+ 正对观察者(depth=1)、z- 在最远(depth=-1)
  const front = render(<AxisGizmo dir={{ x: 0, y: 0, z: 1 }} />).container;
  // 从 -Z 看:两者深度正好互换
  const back = render(<AxisGizmo dir={{ x: 0, y: 0, z: -1 }} />).container;

  // 最近那一档:正轴球 与 负轴点 相等
  expect(r(back, 'z-')).toBe(r(front, 'z+'));
  // 最远那一档:同样相等
  expect(r(back, 'z+')).toBe(r(front, 'z-'));
  // 且确实在缩(近的比远的大)
  expect(r(back, 'z-')).toBeGreaterThan(r(back, 'z+'));
});

// 换掉「线 + 箭头」的理由:线是一维图元,转起来只有角度在变。球端有体积,
// 且近球会遮住它后面的线 —— 遮挡是转动时最强的深度线索
// 正轴连线 + 端点球 + 字母;负轴**只有一个点**(参照 Tripo)。
// 连杆版六条杆从中心放射、转起来互相穿插;空心环版三球三环六团圆更乱 —— 都试过了
test('正轴连线带球与字母;负轴只有一个点(不连杆、不带字)', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  for (const axis of ['x', 'y', 'z']) {
    expect(g(container, `${axis}+`).querySelector('line')).not.toBeNull();
    expect(g(container, `${axis}+`).querySelector('circle')!.getAttribute('fill')).toBe(`var(--color-axis-${axis})`);
    expect(g(container, `${axis}+`).querySelector('text')!.textContent).toBe(axis.toUpperCase());

    expect(g(container, `${axis}-`).querySelector('line')).toBeNull();     // 不连杆
    expect(g(container, `${axis}-`).querySelector('circle')).not.toBeNull(); // 只有点
    expect(g(container, `${axis}-`).querySelector('text')).toBeNull();
  }
  // 三条杆、三个字母、六个圆(三球 + 三点),一个不多
  expect(container.querySelectorAll('line')).toHaveLength(3);
  expect(container.querySelectorAll('text')).toHaveLength(3);
  expect(container.querySelectorAll('circle')).toHaveLength(6);
});

// 六个端点一律**实心**(参照 Tripo)。曾给正轴球加径向渐变做球体感,外圈只有 0.55 不透明度、
// 边缘是虚的 —— 于是同样半径下它看着比实心的负轴点小,居中那个近端负轴点又是最大档,
// 显得格外大(实机看出来的)。改实心之后「半径相等 = 看着一样大」才成立
test('六个端点都是实心的轴色,不带渐变', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  expect(container.querySelectorAll('radialGradient')).toHaveLength(0);
  for (const axis of ['x', 'y', 'z']) {
    for (const sign of ['+', '-']) {
      expect(g(container, `${axis}${sign}`).querySelector('circle')!.getAttribute('fill'))
        .toBe(`var(--color-axis-${axis})`);
    }
  }
});

// 字压在球上,故要用「实色底上的文字」那档令牌,不能用会随主题翻的 --color-ink
test('球内字母用 --color-on-primary(实色底上的文字)', () => {
  const { container } = render(<AxisGizmo dir={FRONT} />);
  expect(g(container, 'x+').querySelector('text')!.getAttribute('fill')).toBe('var(--color-on-primary)');
});

// 「读得出方位」靠三件叠加:透视缩放(几何层)+ 不透明度渐变 + 线宽/端点随深度变。
// 渐变而非二值 —— 二值只分得出前后两档,分不出「偏前多少」
test('深度线索:越朝观察者越不透明、线越粗、端点越大', () => {
  const dir = { x: 0.5, y: 0.2, z: 0.84 };
  const { container } = render(<AxisGizmo dir={dir} />);
  const opacity = (a: string) => Number(g(container, a).getAttribute('opacity'));
  // z+ 明显朝前、z- 明显朝后
  expect(opacity('z+')).toBeGreaterThan(opacity('z-'));
  // 线宽只有正轴有(负轴不连杆),故拿两根正轴比
  const width = (a: string) => Number(g(container, a).querySelector('line')!.getAttribute('stroke-width'));
  expect(width('z+')).toBeGreaterThan(width('x+'));
  // 不透明度是连续量:与视线近乎垂直的那条应落在两端之间,不是被归进某一档
  expect(opacity('y+')).toBeGreaterThan(opacity('z-'));
  expect(opacity('y+')).toBeLessThan(opacity('z+'));
  // 端点也随深度变大(近大远小是透视之外的第二重体积线索)
  const ball = (a: string) => Number(g(container, a).querySelector('circle')!.getAttribute('r'));
  expect(ball('z+')).toBeGreaterThan(ball('x+'));
});

// 遮挡关系靠绘制顺序(远的先画),而顺序由 projectAxes 的 depth 升序保证 ——
// 组件里若自己再排一次或打乱,这条会红
test('绘制顺序 = projectAxes 的 depth 升序(远的在前)', () => {
  const dir = { x: 0.3, y: 0.5, z: 0.81 };
  const { container } = render(<AxisGizmo dir={dir} />);
  const dom = [...container.querySelectorAll('[data-axis]')].map((e) => e.getAttribute('data-axis'));
  const expected = projectAxes(dir).map((t) => `${t.axis}${t.sign === 1 ? '+' : '-'}`);
  expect(dom).toEqual(expected);
});

// 相机转了,轴端点就得跟着变 —— 少了这条,把 dir 忽略掉画一张固定图也能让上面几条全绿
test('换相机方向:轴端点随之改变', () => {
  const a = render(<AxisGizmo dir={FRONT} />);
  const before = g(a.container, 'x+').querySelector('line')!.getAttribute('x2');
  a.unmount();
  const b = render(<AxisGizmo dir={{ x: 1, y: 0, z: 0 }} />);
  expect(g(b.container, 'x+').querySelector('line')!.getAttribute('x2')).not.toBe(before);
});

test('正俯视不产出 NaN 坐标(退化分支的组件级兜底)', () => {
  const { container } = render(<AxisGizmo dir={{ x: 0, y: 1, z: 0 }} />);
  for (const line of container.querySelectorAll('line')) {
    for (const attr of ['x1', 'y1', 'x2', 'y2']) {
      expect(Number(line.getAttribute(attr))).not.toBeNaN();
    }
  }
});
