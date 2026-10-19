'use client';
import { useEffect, useRef, useState } from 'react';
import { axisToOrbit, orbitToDirection, type AxisTick, type Vec3 } from '@/lib/axis-gizmo';
import AxisGizmo from './AxisGizmo';

/**
 * `<model-viewer>` 宿主的空间指示器接线(spec 2026-08-20)。
 *
 * ⚠️ **必须同时读转盘角**:model-viewer 的 `auto-rotate` 改的是 `scene.yaw`(即
 * `turntableRotation`)——**它转的是模型,不是相机**。于是静置自转期间 `getCameraOrbit()`
 * 一个数都不变、`camera-change` 也一次都不发。只读相机的话:模型在转、指示器一动不动。
 * 指示器画的是**模型的**三轴,故要把相机方位换算到模型局部坐标:`theta - turntableRotation`。
 *
 * ⚠️ **必须轮询,不能只订阅事件**:`turntableRotation` 变化不发任何事件。故走 rAF 每帧采样,
 * 并用点积阈值挡住「没变也 setState」——用户不动、也没自转时,这里一次都不重渲。
 * rAF 在标签页隐藏时由浏览器自己暂停,不必另加 visibilitychange。
 *
 * 状态待在这一层而不是宿主:自转期间相机方位每帧都变,放宿主会让整个 lightbox / Files 面板
 * 每帧重渲;放这里每帧重渲的只有十来个 SVG 节点。
 */
type Orbiter = HTMLElement & {
  getCameraOrbit?: () => { theta: number; phi: number };
  /** 转盘角(弧度)。model-viewer 的 auto-rotate 只动这个 */
  turntableRotation?: number;
  /** 写它即切视角,model-viewer 自带插值动画 */
  cameraOrbit?: string;
  /** 切完把自转的延时重新起算,给用户几秒看清这个视角(见下) */
  autoRotate?: boolean;
};

/** 缺省朝向:略偏右上的 3/4 视角。首帧采样前用它,免得先闪一个塌成一条线的正面图 */
const DEFAULT_DIR: Vec3 = orbitToDirection(Math.PI / 5, Math.PI / 2.6);
/**
 * 变化阈值(弧度)。**比的是角度而不是方向向量**:接近正俯视时 `sinφ` 很小,
 * 同样的转盘自转带来的**向量**变化被压到极小、会被点积阈值整个吞掉 —— 表现又是
 * 「模型在转、指示器冻住」。角度差与 phi 无关,故这一档判据在任何视角下都灵。
 * 1e-4 rad ≈ 0.006°,足以挡住阻尼收敛的尾巴与浮点抖动。
 */
const SAME_RAD = 1e-4;

export default function ModelViewerGizmo({ viewer, className }: { viewer: Orbiter | null; className?: string }) {
  const [dir, setDir] = useState<Vec3>(DEFAULT_DIR);
  // 切视图要**写元素属性**(命令式 DOM API)。这件事只能在 effect 里做:渲染期创建的闭包里写
  // prop 上的属性会被 react-compiler 的 lint 判成「改 props」,而它也确实分不清那是个 DOM 元素。
  // 于是入口挂在 ref 上,由下面那个 effect 填充 —— 顺带获得「没元素时是 noop」这个性质
  const pickRef = useRef<(axis: AxisTick['axis'], sign: 1 | -1) => void>(() => {});
  const handlePick = (axis: AxisTick['axis'], sign: 1 | -1) => pickRef.current(axis, sign);

  useEffect(() => {
    if (!viewer?.getCameraOrbit) return;
    let frame = 0;
    // 上一次已落库的角度。不从 state 读:那会让 effect 依赖它、每帧重建 rAF 循环
    let last: { theta: number; phi: number } | null = null;
    const sample = () => {
      const orbit = viewer.getCameraOrbit?.();
      if (orbit) {
        // 转盘转的是模型 ⟹ 相机在模型局部坐标里的方位角反向偏移。
        // 符号推导:scenePivot.rotation.y = yaw 把局部点映到世界 p_w = R_y(yaw)·p_l,
        // 故相机方向在局部坐标里是 R_y(−yaw)·d,方位角 θ − yaw(three.js 的 R_y 约定)
        const theta = orbit.theta - (viewer.turntableRotation ?? 0);
        if (!last || Math.abs(theta - last.theta) + Math.abs(orbit.phi - last.phi) > SAME_RAD) {
          last = { theta, phi: orbit.phi };
          setDir(orbitToDirection(theta, orbit.phi));
        }
      }
      frame = requestAnimationFrame(sample);
    };
    sample();

    // 点端点切视图。目标角要**加上当前转盘角**:用户点的是模型的某根轴,而 cameraOrbit 说的是
    // 世界角 —— 少这一项,自转中点一下会切到偏掉一个 yaw 的视角
    pickRef.current = (axis, sign) => {
      const orbit = viewer.getCameraOrbit?.();
      if (!orbit) return;
      const yaw = viewer.turntableRotation ?? 0;
      const target = axisToOrbit(axis, sign, orbit.theta - yaw);
      // radius 给 auto:保持当前距离(切视角不该顺带改远近)
      viewer.cameraOrbit = `${target.theta + yaw}rad ${target.phi}rad auto`;
      // 把自转的延时重新起算(model-viewer 在 autoRotate 属性变化时重置计时),
      // 否则刚切到位就被转走 —— 用户点它正是为了看清这个方位
      if (viewer.autoRotate) {
        viewer.autoRotate = false;
        viewer.autoRotate = true;
      }
    };

    return () => {
      cancelAnimationFrame(frame);
      pickRef.current = () => {};
    };
  }, [viewer]);

  // 只在真拿到元素时才给 onPick:没元素时退化成纯展示(命中区都不渲染)
  return <AxisGizmo dir={dir} onPick={viewer ? handlePick : undefined} className={className} />;
}
