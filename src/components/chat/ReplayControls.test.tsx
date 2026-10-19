import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReplayControls from './ReplayControls';
import { useStore } from '@/store';

beforeEach(() => {
  useStore.setState({
    replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 10, cursor: 4, speed: 1 },
    setReplaySpeed: vi.fn((s) => useStore.setState({ replay: { ...useStore.getState().replay!, speed: s } })),
    skipReplay: vi.fn(),
  } as never);
});

test('显示进度并可切速 / skip', () => {
  render(<ReplayControls />);
  expect(screen.getByText('4/10')).toBeInTheDocument();
  // 进度条按 cursor/total 渲染
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  fireEvent.click(screen.getByText('2x'));
  expect(useStore.getState().setReplaySpeed).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: 'Skip to end' }));
  expect(useStore.getState().skipReplay).toHaveBeenCalled();
});

test('断点续播后进度叠加基点:cursor/total 只计剩余队列,展示 = resumeAfterSequence + 计数(回归:刷新后进度清零)', () => {
  useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 10, cursor: 4, speed: 1, resumeAfterSequence: 90 } } as never);
  render(<ReplayControls />);
  expect(screen.getByText('94/100')).toBeInTheDocument();
  const bar = screen.getByRole('progressbar');
  expect(bar).toHaveAttribute('aria-valuenow', '94');
  expect(bar).toHaveAttribute('aria-valuemax', '100');
});
