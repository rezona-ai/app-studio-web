'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

// 拉当前 backend 的可用模型列表写入 store(setAvailableModels 内解析默认选中并回落越界记忆)。
// backend 变化时重拉 —— 两个 backend 的模型列表不同,选错会在建连时被 4400 拒。
// 失败静默 —— 列表保持空,ModelSelector 不渲染。
export function useModelList() {
  const backend = useStore((s) => s.agentBackend);
  useEffect(() => {
    let aborted = false;
    void koubouApi.listModels(backend)
      .then((models) => { if (!aborted) useStore.getState().setAvailableModels(models, backend); })
      .catch(() => { /* 静默:无模型时选择器不渲染 */ });
    return () => { aborted = true; };
  }, [backend]);
}
