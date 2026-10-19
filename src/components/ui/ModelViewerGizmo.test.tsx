import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import ModelViewerGizmo from './ModelViewerGizmo';
import { GIZMO_SIZE } from './AxisGizmo';

// rAF 手动驱动:组件靠轮询采样(turntableRotation 变化不发任何事件),
// 用真 rAF 会让用例依赖真实帧率
let queue: FrameRequestCallback[] = [];
beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** 冲掉当前这一批 rAF 回调(每次采样会再排一个,故先取出快照再跑) */
const tick = () => act(() => { const batch = queue; queue = []; batch.forEach((cb) => cb(0)); });

// 假的 <model-viewer>:只需要 getCameraOrbit / turntableRotation 两个读点。
// 真元素在 jsdom 里跑不起来(WebGL),而要测的恰恰只是「采样 → 换算 → 投影」这条线
function fakeViewer(orbit = { theta: 0, phi: Math.PI / 2 }, turntable = 0) {
  const el: HTMLElement & {
    getCameraOrbit?: () => typeof orbit;
    turntableRotation?: number;
    cameraOrbit?: string;
    autoRotate?: boolean;
  } = document.createElement('div');
  el.getCameraOrbit = () => orbit;
  el.turntableRotation = turntable;
  el.autoRotate = true;
  return {
    el,
    orbitTo(next: { theta: number; phi: number }) { orbit = next; tick(); },
    spinTurntable(rad: number) { el.turntableRotation = rad; tick(); },
  };
}

const tipOf = (c: HTMLElement, axis: string) =>
  c.querySelector(`[data-axis="${axis}"] line`)!.getAttribute('x2');

test('挂载即先采一次相机:不等任何事件', () => {
  const v = fakeViewer({ theta: Math.PI / 2, phi: Math.PI / 2 });   // 从 +X 看
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  // 从 +X 看时 X 轴正对观察者 ⟹ 投影缩到中心附近;若组件只等事件,这里会停在缺省 3/4 视角上
  expect(Math.abs(Number(tipOf(container, 'x+')) - GIZMO_SIZE / 2)).toBeLessThan(1);
});

test('用户转相机:指示器跟转', () => {
  const v = fakeViewer({ theta: 0, phi: Math.PI / 2 });
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  const before = tipOf(container, 'x+');
  v.orbitTo({ theta: Math.PI / 2, phi: Math.PI / 2 });
  expect(tipOf(container, 'x+')).not.toBe(before);
});

// 这条是本次修的那个 bug 的锁:model-viewer 的 auto-rotate 改的是 scene.yaw(转模型),
// 相机 orbit 一个数都不变、camera-change 一次都不发 —— 只读相机的话模型在转而指示器一动不动
test('静置自转(只有 turntableRotation 在变):指示器仍同步', () => {
  const v = fakeViewer({ theta: 0, phi: Math.PI / 2 }, 0);
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  const before = tipOf(container, 'x+');
  v.spinTurntable(Math.PI / 3);
  expect(tipOf(container, 'x+')).not.toBe(before);
});

// 接近正俯视时 sinφ 很小,同样的自转带来的**方向向量**变化被压到极小 ——
// 早先按点积设阈值会把它整个吞掉,表现同样是「模型在转、指示器冻住」。改成比角度后与 phi 无关
test('近乎正俯视时的慢速自转:仍然同步(阈值比的是角度,不是方向向量)', () => {
  const v = fakeViewer({ theta: 0, phi: 0.02 }, 0);   // 几乎正俯视
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  const before = tipOf(container, 'x+');
  v.spinTurntable(0.01);                              // 约 0.57°,一帧多一点的自转量
  expect(tipOf(container, 'x+')).not.toBe(before);
});

// 反向对照:两个读点都没动就不该重画 —— 少了它,把阈值判断删掉(每帧无脑 setState)也能全绿
test('相机与转盘都没动:不产生新的绘制结果', () => {
  const v = fakeViewer({ theta: 0.4, phi: 1.1 }, 0.2);
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  const before = container.innerHTML;
  tick(); tick(); tick();
  expect(container.innerHTML).toBe(before);
});

test('卸载停掉轮询:不给已卸载的组件 setState', () => {
  const v = fakeViewer();
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const { unmount } = render(<ModelViewerGizmo viewer={v.el} />);
  unmount();
  expect(cancel).toHaveBeenCalled();
});

// 元素进 state 是刻意的(ref 赋值不引起重渲,子组件永远拿不到元素):
// 宿主首帧给 null、绑定后才给元素,这条锁住「拿到之后要补订阅」
test('viewer 从 null 变成元素后才采样得上', () => {
  const v = fakeViewer({ theta: 0, phi: Math.PI / 2 });
  const { container, rerender } = render(<ModelViewerGizmo viewer={null} />);
  const before = tipOf(container, 'x+');
  rerender(<ModelViewerGizmo viewer={v.el} />);
  v.orbitTo({ theta: Math.PI / 2, phi: Math.PI / 2 });
  expect(tipOf(container, 'x+')).not.toBe(before);
});

test('元素没有 getCameraOrbit(库升级换了实现)也不崩', () => {
  const bare = document.createElement('div');
  expect(() => render(<ModelViewerGizmo viewer={bare} />)).not.toThrow();
});

// 点端点切视图:目标角要加上当前转盘角 —— 用户点的是**模型**的某根轴,而 cameraOrbit 说的是世界角。
// 少这一项,自转中点一下会切到偏掉一个 yaw 的视角(而且没有任何测试会红,故这条必须在)
test('点 +X:写 cameraOrbit,且把当前转盘角加回去', () => {
  const yaw = 0.7;
  const v = fakeViewer({ theta: 1.2, phi: 1.0 }, yaw);
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  act(() => { container.querySelector('[data-axis-hit="x+"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  // +X 的目标局部方位角是 π/2 ⟹ 世界角 = π/2 + yaw
  expect(v.el.cameraOrbit).toBe(`${Math.PI / 2 + yaw}rad ${Math.PI / 2}rad auto`);
});

// ±Y 在极点上、方位角没有意义:要沿用**当前局部** theta,否则点一下俯视图会顺带把模型转个方向
test('点 +Y:phi 取极点,theta 沿用当前(换算掉转盘角再加回来 ⟹ 世界角不变)', () => {
  const v = fakeViewer({ theta: 1.2, phi: 1.0 }, 0.7);
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  act(() => { container.querySelector('[data-axis-hit="y+"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(v.el.cameraOrbit).toBe(`1.2rad 0rad auto`);
});

// 刚切到位就被自转转走的话,用户点它就白点了
test('切完把自转延时重新起算(autoRotate 走一次 false→true)', () => {
  const v = fakeViewer();
  const seen: boolean[] = [];
  Object.defineProperty(v.el, 'autoRotate', {
    get: () => true,
    set: (x: boolean) => { seen.push(x); },
    configurable: true,
  });
  const { container } = render(<ModelViewerGizmo viewer={v.el} />);
  act(() => { container.querySelector('[data-axis-hit="z+"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(seen).toEqual([false, true]);
});
