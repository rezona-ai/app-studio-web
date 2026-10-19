import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageSkeleton from './MessageSkeleton';

test('骨架屏暴露 role=status 与无障碍名称', () => {
  render(<MessageSkeleton />);
  expect(screen.getByRole('status', { name: 'Generating reply' })).toBeInTheDocument();
});

test('骨架屏渲染 3 条错落占位行', () => {
  render(<MessageSkeleton />);
  expect(screen.getAllByTestId('skeleton-bar')).toHaveLength(3);
});
