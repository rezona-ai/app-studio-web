import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuestionCard from './QuestionCard';
import type { QuestionDef } from '@/koubou/protocol';

const single: QuestionDef[] = [
  { question: '美术风格?', header: '美术', options: [{ label: '像素风' }, { label: '手绘' }], multiSelect: false },
];

test('单问题单选:点选项即提交,且不渲染导航行', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i2" questions={single} onSubmit={onSubmit} />);
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /像素风/ }));
  expect(onSubmit).toHaveBeenCalledWith('i2', { '美术风格?': '像素风' });
});

test('渲染 header 与选项 description 与序号', () => {
  const qs: QuestionDef[] = [
    { question: '美术风格?', header: '美术', options: [{ label: '像素风', description: '复古 8-bit 颗粒感' }, { label: '手绘' }] },
  ];
  render(<QuestionCard interactionId="i4" questions={qs} onSubmit={vi.fn()} />);
  expect(screen.getByText('美术')).toBeInTheDocument();
  expect(screen.getByText('复古 8-bit 颗粒感')).toBeInTheDocument();
  expect(screen.getByText('1')).toBeInTheDocument(); // 选项序号方块
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('单问题多选:点选只切换,右箭头门控并充当提交,无计数无左箭头', () => {
  const multi: QuestionDef[] = [
    { question: '支持平台?', options: [{ label: 'Web' }, { label: 'iOS' }, { label: 'Android' }], multiSelect: true },
  ];
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i3" questions={multi} onSubmit={onSubmit} />);
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.queryByText('1 of 1')).toBeNull();
  const confirm = screen.getByRole('button', { name: 'Submit' }); // 右箭头,末题 aria=Submit
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Web/ }));
  fireEvent.click(screen.getByRole('button', { name: /iOS/ }));
  fireEvent.click(screen.getByRole('button', { name: /Web/ })); // 再点取消
  expect(onSubmit).not.toHaveBeenCalled();
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(onSubmit).toHaveBeenCalledWith('i3', { '支持平台?': ['iOS'] });
});

const twoQs: QuestionDef[] = [
  { question: '风格?', header: '风格', options: [{ label: 'A' }, { label: 'B' }] },
  { question: '难度?', header: '难度', options: [{ label: '简单' }] },
];

test('多问题:单选点选自动前进,末题点选即提交', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i6" questions={twoQs} onSubmit={onSubmit} />);
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /简单/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  // 自动前进到第二题
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /简单/ }));
  expect(onSubmit).toHaveBeenCalledWith('i6', { '风格?': 'A', '难度?': '简单' });
});

test('左箭头回退保留已选,首题禁用;右箭头未答禁用', () => {
  render(<QuestionCard interactionId="i7" questions={twoQs} onSubmit={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /A/ })).toHaveAttribute('aria-pressed', 'true');
  // 已答题,右箭头可用于前进
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

test('进度条宽度随已答题数变化', () => {
  const { container } = render(<QuestionCard interactionId="i8" questions={twoQs} onSubmit={vi.fn()} />);
  const bar = container.querySelector('[data-testid="question-progress-fill"]') as HTMLElement;
  expect(bar.style.width).toBe('0%');
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  expect(bar.style.width).toBe('50%');
});

test('custom answer:点击展开输入,回车即答并提交(末题);Esc 收起', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i9" questions={single} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  const input = screen.getByPlaceholderText('Custom answer');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByPlaceholderText('Custom answer')).toBeNull(); // Esc 收起
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  fireEvent.change(screen.getByPlaceholderText('Custom answer'), { target: { value: ' 赛博朋克 ' } });
  fireEvent.keyDown(screen.getByPlaceholderText('Custom answer'), { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith('i9', { '美术风格?': '赛博朋克' }); // trim 后提交
});

test('custom answer 多选:回车并入数组,不提交,再点右箭头提交', () => {
  const multi: QuestionDef[] = [
    { question: '支持平台?', options: [{ label: 'Web' }], multiSelect: true },
  ];
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i10" questions={multi} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: /Web/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  fireEvent.change(screen.getByPlaceholderText('Custom answer'), { target: { value: 'Switch' } });
  fireEvent.keyDown(screen.getByPlaceholderText('Custom answer'), { key: 'Enter' });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(onSubmit).toHaveBeenCalledWith('i10', { '支持平台?': ['Web', 'Switch'] });
});
