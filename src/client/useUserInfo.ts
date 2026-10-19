'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';

// 挂载时拉一次当前用户 + 余额写入 store(预览区账户条用)。
// loadUserInfo 自身已并发拉取且静默失败,此处仅触发一次;catch 兜底防极端情况下的未处理拒绝。
export function useUserInfo() {
  useEffect(() => {
    void useStore.getState().loadUserInfo().catch(() => { /* 账户条非关键信息,静默 */ });
  }, []);
}
