import { afterEach, describe, expect, test } from 'vitest';
import { useStore } from './index';
import { createInitialServerState } from './types';

afterEach(() => { useStore.setState({ ...createInitialServerState() }); });

describe('Toast 语义化入口', () => {
  test('setError/setSuccess/setWarning 写入对应 kind,clearToast 清空', () => {
    const s = useStore.getState();
    s.setError({ code: 'E', message: 'boom' });
    expect(useStore.getState().toast).toEqual({ code: 'E', message: 'boom', kind: 'error' });
    s.setSuccess({ code: 'OK', message: 'done' });
    expect(useStore.getState().toast).toEqual({ code: 'OK', message: 'done', kind: 'success' });
    s.setWarning({ code: 'W', message: 'careful' });
    expect(useStore.getState().toast).toEqual({ code: 'W', message: 'careful', kind: 'warning' });
    s.clearToast();
    expect(useStore.getState().toast).toBeNull();
  });
});
