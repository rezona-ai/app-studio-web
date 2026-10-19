import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import { useAuthGuard } from './useAuthGuard';

afterEach(() => { cleanup(); useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }); });

function Probe() { useAuthGuard(); return null; }

describe('useAuthGuard', () => {
  test('localhost 下 authRequired 被清且弹 warning 提示(非报错),不跳转', () => {
    useStore.setState({ authRequired: true });   // 模拟检测到未登录
    act(() => { render(<Probe />); });            // jsdom 默认 hostname=localhost → 走清标志分支
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().toast?.kind).toBe('warning');
  });
});
