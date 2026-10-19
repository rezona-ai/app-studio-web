import { render, screen, act } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WorkspaceEntry from './WorkspaceEntry';

// Workspace 拉起连接/轮询等副作用,单测只关心分发,mock 成占位
vi.mock('@/components/workspace/Workspace', () => ({ default: () => <div data-testid="workspace" /> }));

function mockNavigator(maxTouchPoints: number, ua: string) {
  vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(maxTouchPoints);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

afterEach(() => { vi.restoreAllMocks(); });

test('桌面 Mac(无触点)→ 渲染工作台', async () => {
  mockNavigator(0, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByTestId('workspace')).toBeInTheDocument();
});

test('iPadOS 伪装桌面 UA(多触点 Mac)→ 渲染拦截页', async () => {
  mockNavigator(5, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByRole('heading', { name: 'Desktop only' })).toBeInTheDocument();
  expect(screen.queryByTestId('workspace')).toBeNull();
});

test('Windows 触屏笔记本(多触点非 Mac)→ 渲染工作台', async () => {
  mockNavigator(10, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByTestId('workspace')).toBeInTheDocument();
});
