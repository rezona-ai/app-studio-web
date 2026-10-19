'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

// 拉当前 backend 的可选 skill 列表写入 store(调用串形态随 backend 变:cc 为 /name、codex 为 $name);
// backend 变化时重拉,失败静默(弹窗显示空态,不 Toast)
export function useSkillList() {
  const backend = useStore((s) => s.agentBackend);
  useEffect(() => {
    let aborted = false;
    void koubouApi.listSkills(backend)
      .then((skills) => { if (!aborted) useStore.getState().setSkills(skills); })
      .catch(() => { /* 静默:无 skill 时弹窗空态 */ });
    return () => { aborted = true; };
  }, [backend]);
}
