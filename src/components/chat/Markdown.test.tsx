import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from './Markdown';

test('标题渲染为 h1', () => {
  const { container } = render(<Markdown text="# 大标题" />);
  expect(container.querySelector('h1')?.textContent).toBe('大标题');
});

test('无序列表渲染为 ul>li', () => {
  const { container } = render(<Markdown text={'- 一\n- 二'} />);
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
});

test('有序列表渲染为 ol>li', () => {
  const { container } = render(<Markdown text={'1. 甲\n2. 乙'} />);
  expect(container.querySelector('ol')).toBeTruthy();
  expect(container.querySelectorAll('ol li')).toHaveLength(2);
});

test('行内码渲染为 code', () => {
  const { container } = render(<Markdown text={'用 `pnpm dev` 启动'} />);
  expect(container.querySelector('code')?.textContent).toBe('pnpm dev');
});

test('围栏代码块渲染为 pre>code', () => {
  const { container } = render(<Markdown text={'```\nconst a = 1\n```'} />);
  expect(container.querySelector('pre code')?.textContent).toContain('const a = 1');
});

test('行内码长串可换行(避免路径/JSON 溢出被裁切)', () => {
  const { container } = render(
    <Markdown text={'见 `plugins/agent_plugins/game-kit/scripts/build_game.py` 文件'} />,
  );
  // jsdom 不做布局,只能守护换行类仍在:去掉它长串会溢出聊天栏右缘被裁切
  expect(container.querySelector('code')?.className).toContain('break-words');
});

test('加粗与斜体', () => {
  render(<Markdown text="**粗** 和 *斜*" />);
  expect(screen.getByText('粗').tagName).toBe('STRONG');
  expect(screen.getByText('斜').tagName).toBe('EM');
});

test('引用渲染为 blockquote', () => {
  const { container } = render(<Markdown text="> 引用内容" />);
  expect(container.querySelector('blockquote')?.textContent).toContain('引用内容');
});

test('GFM 表格渲染为 table', () => {
  const md = '| A | B |\n| - | - |\n| 1 | 2 |';
  const { container } = render(<Markdown text={md} />);
  expect(container.querySelector('table')).toBeTruthy();
  expect(container.querySelectorAll('tbody td')).toHaveLength(2);
});

test('GFM 删除线渲染为 del', () => {
  const { container } = render(<Markdown text="~~删了~~" />);
  expect(container.querySelector('del')?.textContent).toBe('删了');
});

test('链接带 target=_blank 与 rel=noopener', () => {
  const { container } = render(<Markdown text="[去](https://a.com)" />);
  const a = container.querySelector('a')!;
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toContain('noopener');
});

test('长 URL 链接可换行(避免裸链接撑出对话栏横向滚动条)', () => {
  // 裸 URL 经 remark-gfm 自动链接后,可见文本即整条 URL——无空格的单一长 token
  const { container } = render(
    <Markdown text="https://example.com/very/long/path/that/would/otherwise/overflow/the/narrow/chat/panel?token=abcdefghijklmnop" />,
  );
  // jsdom 不做布局,只能守护换行类仍在:去掉它长 URL 会撑破气泡使对话栏出现横向滚动条
  expect(container.querySelector('a')?.className).toContain('break-words');
});

test('XSS:裸 <script> 不产生可执行 script 元素', () => {
  const { container } = render(<Markdown text={'前 <script>window.__x=1</script> 后'} />);
  expect(container.querySelector('script')).toBeNull();
});

test('XSS:裸 <img onerror> 不产生 img 元素', () => {
  const { container } = render(<Markdown text={'<img src=x onerror="alert(1)">'} />);
  expect(container.querySelector('img')).toBeNull();
});

test('XSS:javascript: 链接 href 被剥离', () => {
  const { container } = render(<Markdown text="[x](javascript:alert(1))" />);
  const a = container.querySelector('a');
  expect(a?.getAttribute('href') ?? '').not.toContain('javascript:');
});
