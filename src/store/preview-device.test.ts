import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';

// 预览设备档(spec 2026-10-19-preview-mobile-device):默认桌面 = 改动前的行为,零变化
beforeEach(() => {
  useStore.setState({ previewDevice: 'desktop' });
});

test('默认桌面档,setPreviewDevice 切换', () => {
  expect(useStore.getState().previewDevice).toBe('desktop');
  useStore.getState().setPreviewDevice('mobile');
  expect(useStore.getState().previewDevice).toBe('mobile');
  useStore.getState().setPreviewDevice('desktop');
  expect(useStore.getState().previewDevice).toBe('desktop');
});

test('设备档进持久化切片:调移动端适配要反复刷新,每次回落桌面就白切了', () => {
  useStore.getState().setPreviewDevice('mobile');
  const persisted = useStore.persist.getOptions().partialize?.(useStore.getState()) as Record<string, unknown>;
  expect(persisted.previewDevice).toBe('mobile');
});
