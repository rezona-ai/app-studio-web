import { afterEach, expect, test, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import StreamingText from './StreamingText';
import { TYPEWRITER } from '@/client/useTypewriter';

afterEach(() => {
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

test('非流式 → 全量 markdown:**加粗** 渲染为 strong,无尾部光标', () => {
  const { container } = render(<StreamingText text={'**粗体** 普通'} streaming={false} />);
  expect(container.querySelector('strong')?.textContent).toBe('粗体');
  expect(container.querySelector('.md-caret')).toBeNull();
});

test('非流式 → 标题与列表正常成型', () => {
  const { container } = render(<StreamingText text={'# 标题\n\n- 项一\n- 项二'} streaming={false} />);
  expect(container.querySelector('h1')?.textContent).toBe('标题');
  expect(container.querySelectorAll('ul li')).toHaveLength(2);
});

test('流式中:已揭示文本逐步出现,且存在尾部光标', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello world" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 5));
  expect(container.textContent).toContain('hel');
  expect(container.querySelector('.md-caret')).toBeTruthy();
});

test('流式打完且渐显窗口过后:全文可见,光标消失', () => {
  vi.useFakeTimers();
  const { container } = render(<StreamingText text="hello" streaming />);
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 20));
  act(() => vi.advanceTimersByTime(TYPEWRITER.FADE_MS * 2));
  expect(container.textContent).toContain('hello');
  expect(container.querySelector('.md-caret')).toBeNull();
});

// —— A2:流式分段——已完成块进稳定实例(只解析一次),增长尾部单独小实例 ——

test('流式跨段后:稳定前缀与增长尾部分离为两个 .md 实例', () => {
  vi.useFakeTimers();
  const text = '第一段已经完成。\n\n第二段还在继续输出';
  const { container } = render(<StreamingText text={text} streaming />);
  // 揭示越过段界足够多(MAX_STEP 封顶,推足 tick 数)
  act(() => vi.advanceTimersByTime(TYPEWRITER.TICK_MS * 60));
  const mds = container.querySelectorAll('.md');
  expect(mds.length).toBe(2);
  expect(mds[0].textContent).toContain('第一段已经完成。');
  expect(mds[1].textContent).toContain('第二段');
});

test('非流式:单一 .md 实例,不分段', () => {
  const { container } = render(<StreamingText text={'段一。\n\n段二。'} streaming={false} />);
  expect(container.querySelectorAll('.md')).toHaveLength(1);
});
