import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

// 保留真实导出(PgcError 供 instanceof),仅替换 remixPolicy 方法为 mock(沿用 WorkbenchSharePopover.test 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: { remixPolicy: { get: vi.fn(), set: vi.fn() } },
  };
});
const trackMock = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => trackMock(...a), projectPublicId: () => 'AbCd' }));

import SharePopover from './SharePopover';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { useStore } from '@/store';

const policy = pgcApi.remixPolicy as unknown as Record<string, ReturnType<typeof vi.fn>>;
const POLICY_OFF = { enabled: false, source_code: 'AbCd', source_version_id: null, remix_url: null, display_title: null, display_description: null };
const POLICY_ON = { ...POLICY_OFF, enabled: true, source_version_id: 'v3', remix_url: 'https://x/game?remix=AbCd' };

// 默认入参:项目 7、当前分享 v3 且已 build
const props = { url: 'https://x/y', projectId: 7, versionId: 'v3', versionStatus: 'ready', onClose: () => {} };

beforeEach(() => {
  useStore.setState({ authRequired: false, toast: null });
  policy.get.mockResolvedValue(POLICY_OFF);
  policy.set.mockResolvedValue(POLICY_ON);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('展示传入的 url', async () => {
  render(<SharePopover {...props} url="https://x/game/pgcserver/pv/abc/v1/dist/index.html" />);
  expect(screen.getByDisplayValue('https://x/game/pgcserver/pv/abc/v1/dist/index.html')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
});

test('点击 Copy 写入剪贴板并显示 Copied', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<SharePopover {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith('https://x/y');
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
});

test('复制成功上报 game_link_copy(game_id/project_id)', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<SharePopover {...props} url="https://x/pv/AbCd/v1/dist/index.html" />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(trackMock).toHaveBeenCalledWith('game_link_copy', { game_id: 'AbCd', project_id: 'AbCd' }));
});

test('剪贴板写入失败不上报 game_link_copy', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('denied'));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<SharePopover {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(trackMock).not.toHaveBeenCalled();
});

// ---- Remix 开关(设计稿 2026-08-28-share-remix-toggle)----

test('挂载即读策略:后端已开启 → 开关置位', async () => {
  policy.get.mockResolvedValue(POLICY_ON);
  render(<SharePopover {...props} />);
  expect(policy.get).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
});

test('GET 未回来前开关禁用,不先摆一个「关」出来误导', () => {
  policy.get.mockReturnValue(new Promise(() => {}));
  render(<SharePopover {...props} />);
  expect(screen.getByRole('switch')).toBeDisabled();
});

test('拨开:乐观置位并 PATCH 当前分享的版本;成功后以回执为准', async () => {
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'); // 乐观,不等来回
  expect(policy.set).toHaveBeenCalledWith(7, { enabled: true, version_id: 'v3' });
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});

test('拨关:PATCH 不带 version_id(契约里仅开启时必填)', async () => {
  policy.get.mockResolvedValue(POLICY_ON);
  policy.set.mockResolvedValue(POLICY_OFF);
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
  fireEvent.click(screen.getByRole('switch'));
  expect(policy.set).toHaveBeenCalledWith(7, { enabled: false });
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
});

test('在飞期间开关禁用:连点不会重复 PATCH', async () => {
  let resolve: (v: unknown) => void = () => {};
  policy.set.mockReturnValue(new Promise((r) => { resolve = r; }));
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).toBeDisabled();
  fireEvent.click(screen.getByRole('switch'));
  expect(policy.set).toHaveBeenCalledTimes(1);
  resolve(POLICY_ON);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
});

test('PATCH 失败:回滚到后端事实 + 弹 Toast', async () => {
  policy.set.mockRejectedValue(new PgcError('REMIX_SOURCE_NOT_READY', 'nope', 409));
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('switch'));
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'));
  expect(useStore.getState().toast?.code).toBe('REMIX_SOURCE_NOT_READY');
});

test('PATCH 401:置 authRequired 走登录门闸,不弹红色报错', async () => {
  policy.set.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(useStore.getState().authRequired).toBe(true));
  expect(useStore.getState().toast).toBe(null);
});

test('GET 失败:开关禁用 + 说明,不弹 Toast(仅打开弹窗就红字刷屏太吵)', async () => {
  policy.get.mockRejectedValue(new PgcError('BOOM', 'nope', 500));
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByText('Remix settings are unavailable right now.')).toBeInTheDocument());
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(useStore.getState().toast).toBe(null);
});

// GET 与 PATCH 是两条独立的 catch 分支,后者绿灯不保护前者(评审 I-1)
test('GET 401:置 authRequired 走登录门闸,不弹红色报错,开关保持禁用', async () => {
  policy.get.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  render(<SharePopover {...props} />);
  await waitFor(() => expect(useStore.getState().authRequired).toBe(true));
  expect(useStore.getState().toast).toBe(null);
  expect(screen.getByRole('switch')).toBeDisabled();
});

test('当前版本未 build:开关禁用 + 原因,且不发 PATCH', async () => {
  render(<SharePopover {...props} versionStatus="building" />);
  await waitFor(() => expect(screen.getByText("This version isn't built yet, so it can't be opened for remix.")).toBeInTheDocument());
  const sw = screen.getByRole('switch');
  expect(sw).toBeDisabled();
  fireEvent.click(sw);
  expect(policy.set).not.toHaveBeenCalled();
});

test('已开启但绑在别的版本:出提示,且不隐式改绑(不发 PATCH)', async () => {
  policy.get.mockResolvedValue({ ...POLICY_ON, source_version_id: 'v2' });
  render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByText(/Remix is currently open for v2\./)).toBeInTheDocument());
  expect(policy.set).not.toHaveBeenCalled();
});

test('缺项目 id(理论不出现,防御性):不渲染开关也不发请求', () => {
  render(<SharePopover {...props} projectId={null} />);
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(policy.get).not.toHaveBeenCalled();
});

// 评审 M-1:组件不带 key,projectId 变了不会重挂 —— 旧项目的策略事实必须立刻作废,
// 否则新 GET 落地前开关可点,一点就按旧事实对新项目发 PATCH
test('projectId 变更:旧策略立刻作废,新 GET 落地前开关禁用', async () => {
  policy.get.mockResolvedValue(POLICY_ON);
  const { rerender } = render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));

  let resolveNext: (v: unknown) => void = () => {};
  policy.get.mockReturnValue(new Promise((r) => { resolveNext = r; }));
  rerender(<SharePopover {...props} projectId={8} />);
  expect(policy.get).toHaveBeenLastCalledWith(8);
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

  resolveNext(POLICY_OFF);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
});

test('换项目后到达的 PATCH 回执不得覆盖新项目的策略视图(await 后校验上下文)', async () => {
  let resolveSet: (v: unknown) => void = () => {};
  policy.set.mockReturnValue(new Promise((r) => { resolveSet = r; }));
  const { rerender } = render(<SharePopover {...props} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('switch')); // 对项目 7 拨开,回执悬而未决

  policy.get.mockResolvedValue(POLICY_OFF);
  rerender(<SharePopover {...props} projectId={8} />);
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());

  resolveSet(POLICY_ON); // 项目 7 的「已开启」回执迟到
  await waitFor(() => expect(policy.get).toHaveBeenLastCalledWith(8));
  expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false'); // 仍是项目 8 的事实
});

test('StrictMode 双挂载:GET 幂等重放,不产生错乱状态', async () => {
  policy.get.mockResolvedValue(POLICY_ON);
  render(<StrictMode><SharePopover {...props} /></StrictMode>);
  await waitFor(() => expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
});
