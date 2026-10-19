import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// 保留真实导出(PgcError 供 instanceof),仅替换 workbenchShare 方法为 mock(沿用仓库既有写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: { workbenchShare: { get: vi.fn(), enable: vi.fn(), disable: vi.fn() } },
  };
});
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), projectPublicId: () => 'AbCd' }));

import WorkbenchSharePopover from './WorkbenchSharePopover';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { useStore } from '@/store';

const share = pgcApi.workbenchShare as unknown as Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => { useStore.setState({ authRequired: false, toast: null }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('挂载读取分享状态:生效态展示 share_url + 开关拨开 + Sharing on(已开启不重复 enable)', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/game?share=AbCd' });
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  expect(share.get).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.getByDisplayValue('https://x/game?share=AbCd')).toBeInTheDocument());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Sharing on')).toBeInTheDocument();
  expect(share.enable).not.toHaveBeenCalled();
});

test('挂载时后端未开启:默认自动 enable 并直接展示可复制链接', async () => {
  share.get.mockResolvedValue({ enabled: false, share_url: null });
  share.enable.mockResolvedValue({ enabled: true, share_url: 'https://x/auto' });
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(share.enable).toHaveBeenCalledWith(7, 'sess-1'));
  await waitFor(() => expect(screen.getByDisplayValue('https://x/auto')).toBeInTheDocument());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Sharing on')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy link' })).not.toBeDisabled();
});

test('自动 enable 失败:开关不乐观翻转,保持 Sharing off + 复制禁用 + 报错', async () => {
  share.get.mockResolvedValue({ enabled: false, share_url: null });
  share.enable.mockRejectedValue(new PgcError('BOOM', 'nope', 500));
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText('Sharing off')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Sharing is off')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  expect(useStore.getState().toast?.code).toBe('BOOM');
});

test('自动 enable 401:置 authRequired 走登录门闸,不弹红色报错', async () => {
  share.get.mockResolvedValue({ enabled: false, share_url: null });
  share.enable.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(useStore.getState().authRequired).toBe(true));
  expect(useStore.getState().toast).toBeNull();
});

test('点击 Copy 写入剪贴板并显示 Copied', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/game?share=AbCd' });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByDisplayValue('https://x/game?share=AbCd')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith('https://x/game?share=AbCd');
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
});

test('说明含能力/风险(融合进 desc 一句话)', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/y' });
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/fully editable copy/i)).toBeInTheDocument());
});

test('生效态拨关开关(disable):撤销分享后弹窗不关闭,就地翻 Sharing off', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/y' });
  share.disable.mockResolvedValue({ enabled: false, share_url: null });
  const onClose = vi.fn();
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={onClose} />);
  await waitFor(() => expect(screen.getByDisplayValue('https://x/y')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(share.disable).toHaveBeenCalledWith(7));
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  expect(screen.getByText('Sharing off')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

test('拨关后再拨开(enable):以当前 session 开启并翻回生效展示 share_url', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/y' });
  share.disable.mockResolvedValue({ enabled: false, share_url: null });
  share.enable.mockResolvedValue({ enabled: true, share_url: 'https://x/z' });
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByDisplayValue('https://x/y')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(share.enable).toHaveBeenCalledWith(7, 'sess-1'));
  await waitFor(() => expect(screen.getByDisplayValue('https://x/z')).toBeInTheDocument());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Sharing on')).toBeInTheDocument();
});

test('Esc 关闭:播完退场后回调 onClose(无关闭按钮,靠 Esc/遮罩)', async () => {
  vi.useFakeTimers();
  try {
    share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/y' });
    const onClose = vi.fn();
    render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

// StrictMode 双挂载(cleanup 置 aborted 后重放 setup):重放的 effect 重新发起并消费 get(幂等无副作用),
// loading 正常落地展示 share_url,而不是被跨渲染 ref 挡住卡死在 loading。
test('StrictMode 双挂载:重放的 effect 重新发起 get,loading 落地展示 share_url', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/game?share=AbCd' });
  render(
    <StrictMode>
      <WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />
    </StrictMode>,
  );
  await waitFor(() => expect(screen.getByDisplayValue('https://x/game?share=AbCd')).toBeTruthy());
  expect(share.get).toHaveBeenCalledTimes(2);
  expect(share.get).toHaveBeenCalledWith(7);
});

test('get 401:置 authRequired 走登录门闸,不弹红色报错', async () => {
  share.get.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={() => {}} />);
  await waitFor(() => expect(useStore.getState().authRequired).toBe(true));
  expect(useStore.getState().toast).toBeNull();
});

test('disable 401:置 authRequired 走登录门闸,不弹红色报错、不关弹窗、开关不乐观翻转', async () => {
  share.get.mockResolvedValue({ enabled: true, share_url: 'https://x/y' });
  share.disable.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  const onClose = vi.fn();
  render(<WorkbenchSharePopover projectId={7} sessionId="sess-1" onClose={onClose} />);
  await waitFor(() => expect(screen.getByDisplayValue('https://x/y')).toBeTruthy());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(useStore.getState().authRequired).toBe(true));
  expect(useStore.getState().toast).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
