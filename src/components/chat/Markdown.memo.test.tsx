import { expect, test, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

// 探针替身:统计 ReactMarkdown 实际渲染(=重新解析)次数;本文件只验证 memo,不验证映射
vi.mock('react-markdown', () => ({
  __esModule: true,
  default: vi.fn(({ children }: { children: string }) => <div data-md>{children}</div>),
}));

import ReactMarkdown from 'react-markdown';
import Markdown from './Markdown';

function Host() {
  const [n, setN] = useState(0);
  return (
    <div>
      <button onClick={() => setN(n + 1)}>bump {n}</button>
      <Markdown text="**固定内容**" />
    </div>
  );
}

// A2:Markdown 必须 memo——父级因无关状态重渲时,text 未变不得重新解析
test('父组件重渲、text 未变:ReactMarkdown 不再次渲染(memo)', () => {
  render(<Host />);
  const probe = ReactMarkdown as unknown as ReturnType<typeof vi.fn>;
  const calls = probe.mock.calls.length;
  fireEvent.click(screen.getByRole('button'));
  expect(probe.mock.calls.length).toBe(calls);
});
