import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThinkingBlock from './ThinkingBlock';

test('展示英文 Thinking 标签', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('Thinking')).toBeInTheDocument();
});

test('流式中 → 自动展开显示思考文本 + 转圈', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('完成(非流式)→ 自动收起,思考文本隐藏且无转圈', () => {
  render(<ThinkingBlock text="推理内容ABC" streaming={false} />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
  expect(screen.queryByRole('status', { name: 'Running' })).not.toBeInTheDocument();
});

test('收起态 → 点击标题手动展开', () => {
  render(<ThinkingBlock text="推理内容ABC" />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Thinking' }));
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
});

test('流式结束(streaming true → false)→ 自动收起', () => {
  const { rerender } = render(<ThinkingBlock text="推理内容ABC" streaming />);
  expect(screen.getByText('推理内容ABC')).toBeInTheDocument();
  rerender(<ThinkingBlock text="推理内容ABC" streaming={false} />);
  expect(screen.queryByText('推理内容ABC')).not.toBeInTheDocument();
});
