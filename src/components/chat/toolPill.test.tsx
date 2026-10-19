import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolStatusIcon, CollapseArrow } from './toolPill';

test('generating → amber 转圈(role=status)', () => {
  render(<ToolStatusIcon status="generating" />);
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('pending → 同样显示转圈', () => {
  render(<ToolStatusIcon status="pending" />);
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
});

test('ready → 品牌橙 check(data-tool-status=done)', () => {
  const { container } = render(<ToolStatusIcon status="ready" />);
  const icon = container.querySelector('[data-tool-status="done"]');
  expect(icon).toBeInTheDocument();
  expect(icon).toHaveClass('text-[var(--color-primary)]');
});

test('error → danger warning(data-tool-status=error)', () => {
  const { container } = render(<ToolStatusIcon status="error" />);
  const icon = container.querySelector('[data-tool-status="error"]');
  expect(icon).toBeInTheDocument();
  expect(icon).toHaveClass('text-[var(--color-danger)]');
});

test('CollapseArrow 展开 → rotate-180', () => {
  const { container, rerender } = render(<CollapseArrow open={false} />);
  expect(container.querySelector('[data-collapse-arrow]')).not.toHaveClass('rotate-180');
  rerender(<CollapseArrow open />);
  expect(container.querySelector('[data-collapse-arrow]')).toHaveClass('rotate-180');
});
