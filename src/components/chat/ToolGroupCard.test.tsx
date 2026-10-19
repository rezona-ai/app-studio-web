import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolGroupCard from './ToolGroupCard';
import type { Part } from '@/store/types';

type ToolPart = Extract<Part, { type: 'tool' }>;
const tool = (over: Partial<ToolPart> = {}): ToolPart =>
  ({ type: 'tool', id: over.id ?? 't', name: 'Read', input: { file: 'a.ts' }, status: 'ready', ...over });

test('渲染 name ×N', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2' }), tool({ id: '3' })]} />);
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.getByText('×3')).toBeInTheDocument();
});

test('全部完成 → 头部 品牌橙 check(data-tool-status=done),默认收起(不显示参数)', () => {
  const { container } = render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2' })]} />);
  expect(container.querySelector('[data-tool-status="done"]')).toBeInTheDocument();
  expect(screen.queryByText(/"file":"a.ts"/)).not.toBeInTheDocument();
});

test('含进行中 → 有转圈(role=status)且默认展开显示参数', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1' }), tool({ id: '2', status: 'generating' })]} />);
  expect(screen.getAllByRole('status', { name: 'Running' }).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/"file":"a.ts"/).length).toBeGreaterThan(0);
});

test('含失败(无进行中)→ 头部 data-tool-status=error 且默认折叠(与全完成一致)', () => {
  const { container } = render(<ToolGroupCard name="Bash" parts={[tool({ id: '1' }), tool({ id: '2', status: 'error' })]} />);
  expect(container.querySelector('[data-tool-status="error"]')).toBeInTheDocument();
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
});

test('点击标题切换 aria-expanded 并展示各调用参数', () => {
  render(<ToolGroupCard name="Read" parts={[tool({ id: '1', input: { file: 'a.ts' } }), tool({ id: '2', input: { file: 'b.ts' } })]} />);
  const btn = screen.getByRole('button');
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/"file":"a.ts"/)).toBeInTheDocument();
  expect(screen.getByText(/"file":"b.ts"/)).toBeInTheDocument();
});

test('展开后:完成的行不加状态图标,失败的行加标记(头部+失败行共 2 个 error 标记,无 done)', () => {
  const { container } = render(<ToolGroupCard name="Bash" parts={[tool({ id: '1' }), tool({ id: '2', status: 'error' })]} />);
  // 失败组默认折叠,先展开才能看到行级标记
  fireEvent.click(screen.getByRole('button'));
  expect(container.querySelectorAll('[data-tool-status="error"]')).toHaveLength(2);
  expect(container.querySelector('[data-tool-status="done"]')).toBeNull();
});

test('任务工具组:标签本地化 + 不可展开(无箭头,点击不出参数)', () => {
  const parts = [
    { type: 'tool', id: 't1', name: 'TaskUpdate', input: { taskId: '1' }, status: 'ready' },
    { type: 'tool', id: 't2', name: 'TaskUpdate', input: { taskId: '2' }, status: 'ready' },
  ] as const;
  render(<ToolGroupCard name="TaskUpdate" parts={parts as unknown as ToolPart[]} />);
  expect(screen.getByText('Updated plan')).toBeInTheDocument();
  expect(screen.getByText('×2')).toBeInTheDocument();
  expect(document.querySelector('[data-collapse-arrow]')).toBeNull();
});
