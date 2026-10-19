import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiffView from './DiffView';
import type { FileDiff } from '@/koubou/protocol';

const oneHunk: FileDiff = {
  type: 'update', filePath: 'src/a.ts', additions: 2, deletions: 1,
  hunks: [{ lines: [
    { kind: 'context', text: 'const x = 1;' },
    { kind: 'del', text: 'foo();' },
    { kind: 'add', text: 'bar();' },
    { kind: 'add', text: 'baz();' },
  ] }],
};

test('逐行渲染文本', () => {
  render(<DiffView diff={oneHunk} />);
  expect(screen.getByText('const x = 1;')).toBeInTheDocument();
  expect(screen.getByText('foo();')).toBeInTheDocument();
  expect(screen.getByText('bar();')).toBeInTheDocument();
  expect(screen.getByText('baz();')).toBeInTheDocument();
});

test('增删行按类型着色(emerald=新增,red=删除)', () => {
  const { container } = render(<DiffView diff={oneHunk} />);
  expect(container.querySelectorAll('[class*="bg-emerald"]')).toHaveLength(2);
  expect(container.querySelectorAll('[class*="bg-red"]')).toHaveLength(1);
});

test('多 hunk 之间有分隔线', () => {
  const twoHunks: FileDiff = { ...oneHunk, hunks: [{ lines: [{ kind: 'context', text: 'a' }] }, { lines: [{ kind: 'context', text: 'b' }] }] };
  const { container } = render(<DiffView diff={twoHunks} />);
  expect(screen.getByText('a')).toBeInTheDocument();
  expect(screen.getByText('b')).toBeInTheDocument();
  expect(container.querySelectorAll('[class*="border-t"]')).toHaveLength(1);
});
