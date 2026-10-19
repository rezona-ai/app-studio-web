import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VersionTimeline, { formatVersionTime } from './VersionTimeline';
import { useStore } from '@/store';
import type { Version } from '@/store/types';

function makeVersion(id: string, label: string, current = false, status = 'ready'): Version {
  return { id, index: 1, label, summary: 's', createdAt: '2026-01-01T00:00:00Z', current, status, assetKeys: [], game: { title: 'T', palette: 'neon' } };
}

beforeEach(() => useStore.setState({ versions: [], activeVersionId: null, compare: { on: false, withId: null } }));
afterEach(() => cleanup());

test('空版本区不渲染 Compare(贴合设计稿空态)', () => {
  render(<VersionTimeline />);
  expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument();
});

test('仅一个版本:渲染 Compare 但禁用(需 ≥2 才能对比)', () => {
  useStore.setState({ versions: [makeVersion('v1', 'V1', true)], activeVersionId: 'v1' });
  render(<VersionTimeline />);
  expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
});

test('两个版本:Compare 可用', () => {
  useStore.setState({ versions: [makeVersion('v1', 'V1', true), makeVersion('v2', 'V2')], activeVersionId: 'v1' });
  render(<VersionTimeline />);
  expect(screen.getByRole('button', { name: 'Compare' })).toBeEnabled();
});

test('formatVersionTime:本地时间 24h 格式 HH:MM; DD/MM/YYYY', () => {
  // 无 Z → 按本地时区解析,结果确定
  expect(formatVersionTime('2026-07-20T17:35:00')).toBe('17:35; 20/07/2026');
});

test('formatVersionTime:无效时间返回空串', () => {
  expect(formatVersionTime('nope')).toBe('');
});

test('时间线渲染版本名与时间戳,激活项标记 aria-current', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1'), makeVersion('v2', 'Version 2', true)],
    activeVersionId: 'v2',
  });
  render(<VersionTimeline />);
  // 最新在上:Version 2 在 Version 1 之前
  const items = screen.getAllByRole('button').filter((b) => /Version/.test(b.textContent ?? ''));
  expect(items[0]).toHaveTextContent('Version 2');
  expect(items[0]).toHaveAttribute('aria-current', 'true');
  expect(items[1]).not.toHaveAttribute('aria-current');
});

test('常态点击非激活版本 → setActive', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
  });
  render(<VersionTimeline />);
  fireEvent.click(screen.getByRole('button', { name: /Version 2/ }));
  expect(useStore.getState().activeVersionId).toBe('v2');
});

test('compare 模式点击非激活版本 → setCompareWith(不改 active)', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: null },
  });
  render(<VersionTimeline />);
  fireEvent.click(screen.getByRole('button', { name: /Version 2/ }));
  expect(useStore.getState().compare.withId).toBe('v2');
  expect(useStore.getState().activeVersionId).toBe('v1');
});

test('版本消耗积分:紧凑数字紧跟版本名,title 给精确值', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true)],
    versionCreditsById: { v1: 1234 },
    activeVersionId: 'v1',
  });
  render(<VersionTimeline />);
  expect(screen.getByText('1.2K')).toBeInTheDocument();               // 与账户条同口径的紧凑记法
  expect(screen.getByTitle('1,234 credits spent on this version')).toBeInTheDocument();
});

test('版本消耗积分:0 也渲染(确实没花钱 ≠ 无数据)', () => {
  useStore.setState({ versions: [makeVersion('v1', 'Version 1', true)], versionCreditsById: { v1: 0 }, activeVersionId: 'v1' });
  render(<VersionTimeline />);
  expect(screen.getByText('0')).toBeInTheDocument();
});

test('版本消耗积分:map 里缺键时该处不渲染(后端不编数也无副作用)', () => {
  useStore.setState({ versions: [makeVersion('v1', 'Version 1', true)], versionCreditsById: {}, activeVersionId: 'v1' });
  render(<VersionTimeline />);
  expect(screen.queryByTitle(/credits spent/)).not.toBeInTheDocument();
});

// spec 2026-08-31:构建中的行来自 listVersions 本身(status:'building'、created_at 为空),
// 早先那套独立的构建中占位字段已随本次修复删除。
test('列表里的 building 行:禁用、无 aria-current、不显示时间', () => {
  const building: Version = { ...makeVersion('v2', 'V2', false, 'building'), createdAt: '' };
  useStore.setState({ versions: [makeVersion('v1', 'V1', true), building], activeVersionId: 'v1' });
  render(<VersionTimeline />);
  const items = screen.getAllByRole('button').filter((b) => /^V\d/.test(b.textContent ?? ''));
  // 行序:最新在上,构建中的 V2 排第一
  expect(items[0]).toHaveTextContent('V2');
  expect(items[0]).toBeDisabled();
  expect(items[0]).not.toHaveAttribute('aria-current');
  // 时间戳不渲染(createdAt 为空)
  expect(items[0].textContent).not.toMatch(/\d{2}:\d{2};/);
  // 已 ready 的行不受影响
  expect(items[1]).toHaveTextContent('V1');
  expect(items[1]).toBeEnabled();
});

test('列表里的 building 行不可点:点击不切换 activeVersion', () => {
  const building: Version = { ...makeVersion('v2', 'V2', false, 'building'), createdAt: '' };
  useStore.setState({ versions: [makeVersion('v1', 'V1', true), building], activeVersionId: 'v1' });
  render(<VersionTimeline />);
  const items = screen.getAllByRole('button').filter((b) => /^V\d/.test(b.textContent ?? ''));
  fireEvent.click(items[0]);
  expect(useStore.getState().activeVersionId).toBe('v1');
});
