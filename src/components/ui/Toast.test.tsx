import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '@/store';
import Toast from './Toast';

beforeEach(() => { vi.useFakeTimers(); useStore.setState({ toast: null }); });
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useStore.setState({ toast: null });
  // 主题写在 <html> 上,不清会泄漏进后续用例(useIsDark 未设时视为深色,泄漏 'light' 会翻转结论)
  delete document.documentElement.dataset.theme;
});

describe('Toast', () => {
  test('只渲染消息文本,不再显示 code 前缀;默认 kind=error 用 alert + error 图标', () => {
    useStore.setState({ toast: { code: 'ERR', message: '出错了', kind: 'error' } });
    const { container } = render(<Toast />);
    expect(screen.getByText('出错了')).toBeTruthy();
    expect(screen.queryByText('ERR')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-error.svg"]')).toBeTruthy();
  });

  test('success 用 status role + success 图标', () => {
    useStore.setState({ toast: { code: 'OK', message: '成功了', kind: 'success' } });
    const { container } = render(<Toast />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-success.svg"]')).toBeTruthy();
  });

  test('warning 用 status role + warning 图标', () => {
    useStore.setState({ toast: { code: 'WARN', message: '注意', kind: 'warning' } });
    const { container } = render(<Toast />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(container.querySelector('img[src$="toast-warning.svg"]')).toBeTruthy();
  });

  test('退场期间仍渲染末次内容,延时后卸载', () => {
    useStore.setState({ toast: { code: 'ERR', message: '出错了', kind: 'error' } });
    render(<Toast />);
    expect(screen.getByText('出错了')).toBeTruthy();
    act(() => { useStore.getState().clearToast(); });
    expect(screen.queryByText('出错了')).toBeTruthy();
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('出错了')).toBeNull();
  });

  test('卡片宽度上限按视口而非外框:外框过窄时也不收缩成逐字换行的竖条', () => {
    useStore.setState({ toast: { code: 'ERR', message: '出错了', kind: 'error' } });
    render(<Toast leftInset={1000} rightInset={512} />);
    const card = screen.getByRole('alert');
    expect(card.className).toContain('max-w-[calc(100vw-32px)]');
    expect(card.className).not.toContain('max-w-full');
  });

  test('鼠标移入暂停自动消失,移出后重新计 4s', () => {
    useStore.setState({ toast: { code: 'ERR', message: '出错了', kind: 'error' } });
    render(<Toast />);
    const toast = screen.getByRole('alert');
    act(() => fireEvent.mouseEnter(toast));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('出错了')).toBeTruthy();
    act(() => fireEvent.mouseLeave(toast));
    act(() => vi.advanceTimersByTime(4000));
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('出错了')).toBeNull();
  });
});
