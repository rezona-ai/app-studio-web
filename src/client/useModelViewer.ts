'use client';
import { useEffect, useState } from 'react';

// model-viewer 是 Web Component,import 副作用会注册 customElements,
// 触碰 window/customElements → 不能在 SSR 阶段执行。这里客户端懒加载一次,
// module 级 promise 去重,只有真正渲染 3D 时才拉取(不进首屏 bundle)。
let loadPromise: Promise<unknown> | null = null;

function loadModelViewer(): Promise<unknown> {
  if (!loadPromise) loadPromise = import('@google/model-viewer');
  return loadPromise;
}

// 返回 model-viewer 是否已注册可用;未就绪时调用方先占位。
// enabled=false 时不触发加载(3D 卡海报态延迟到激活才拉库,审计 B2+);置回 true 开始加载。
export function useModelViewer(enabled = true): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void loadModelViewer().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  return ready;
}
