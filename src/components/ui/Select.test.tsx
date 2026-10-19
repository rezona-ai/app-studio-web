import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Select from './Select';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// jsdom 无布局:伪造触发钮位置(夹取据它推算)与菜单宽度(offsetWidth 恒 0)
function stubLayout(anchorRight: number, menuW: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: anchorRight - 90, right: anchorRight, width: 90, top: 1100, bottom: 1140, height: 40, x: anchorRight - 90, y: 1100, toJSON: () => ({}),
  } as DOMRect);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(menuW);
}

const OPTS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

test('triggerLabel 覆盖触发钮显示文本(不显示完整 label)', () => {
  render(<Select value="en" options={OPTS} onChange={() => {}} triggerLabel="EN" ariaLabel="Language" />);
  const trigger = screen.getByRole('button', { name: 'Language' });
  expect(trigger).toHaveTextContent('EN');
  expect(trigger).not.toHaveTextContent('English');
});

test('未传 triggerLabel 时触发钮显示选中项 label(回归既有行为)', () => {
  render(<Select value="zh" options={OPTS} onChange={() => {}} ariaLabel="Lang" />);
  expect(screen.getByRole('button', { name: 'Lang' })).toHaveTextContent('中文');
});

test('菜单溢出视口左侧时右移夹回(Chat 栏拖到最窄)', () => {
  stubLayout(286, 300); // 右对齐:菜单左边缘落到 -14,掉出视口
  render(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" align="right" />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  const menu = screen.getByRole('button', { name: '中文' }).parentElement!;
  expect(menu.style.right).toBe('-26px'); // 右移 14(溢出) + 12(边距)
});

test('菜单在视口内时不偏移', () => {
  stubLayout(800, 300);
  render(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" align="right" />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  const menu = screen.getByRole('button', { name: '中文' }).parentElement!;
  expect(menu.style.right).toBe('0px');
});

// openRequest:外部请求展开(报错气泡的 Switch model 按钮开 Composer 的模型下拉)。
// 递增计数而非布尔:用户手动关掉菜单后再点按钮,布尔值不变 effect 不重跑
test('openRequest 递增 → 菜单展开;首次挂载的初值不算请求', () => {
  const { rerender } = render(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" openRequest={0} />);
  expect(screen.queryByRole('button', { name: '中文' })).not.toBeInTheDocument();
  rerender(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" openRequest={1} />);
  expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument();
  // 用户点遮罩关掉后,再来一次请求仍能开
  fireEvent.click(screen.getByRole('button', { name: '中文' }));
  expect(screen.queryByRole('button', { name: '中文' })).not.toBeInTheDocument();
  rerender(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" openRequest={2} />);
  expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument();
});

// 禁用期收到请求要**消费掉**而不是记着:否则 open 悄悄置 true,解锁后菜单在用户没操作的时刻凭空弹出
// (codex 活跃 run 期 ModelSelector 处于 locked,而 error 事件不关轮,这个窗口是真实存在的,评审 I-1)
test('disabled 期间的 openRequest 被消费,解锁后不补开', () => {
  const { rerender } = render(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" disabled openRequest={0} />);
  rerender(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" disabled openRequest={1} />);
  rerender(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" openRequest={1} />);
  expect(screen.queryByRole('button', { name: '中文' })).not.toBeInTheDocument();
  // 解锁后新的请求照常开
  rerender(<Select value="en" options={OPTS} onChange={() => {}} ariaLabel="Language" openRequest={2} />);
  expect(screen.getByRole('button', { name: '中文' })).toBeInTheDocument();
});

test('展开后菜单项显示完整 label,点击回调选中值', () => {
  let picked = '';
  render(<Select value="en" options={OPTS} onChange={(v) => { picked = v; }} triggerLabel="EN" ariaLabel="Language" direction="down" />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  fireEvent.click(screen.getByRole('button', { name: '中文' }));
  expect(picked).toBe('zh');
});

// placeholder:value 无匹配时显示占位且菜单无选中点(Rezona 发布目标失效后的「须重选」态)
test('传 placeholder 且 value 无匹配:触发钮显示占位,菜单不给任何项打选中点', () => {
  render(<Select value={null} options={OPTS} onChange={() => {}} ariaLabel="Target" placeholder="请选择" />);
  const trigger = screen.getByRole('button', { name: 'Target' });
  expect(trigger).toHaveTextContent('请选择');
  expect(trigger).not.toHaveTextContent('English');
  fireEvent.click(trigger);
  const menu = screen.getByRole('button', { name: 'English' }).parentElement!;
  expect(menu.querySelector('.bg-\\[var\\(--color-live\\)\\]')).toBeNull();
});

// 只剩一项时平常渲染静态标签;但占位态下用户必须能明确选它,否则无从解除「未选」(Rezona 目标失效后列表清空)
test('占位态下即使只有一项也可展开选择', () => {
  const onChange = vi.fn();
  render(<Select value={null} options={[OPTS[0]]} onChange={onChange} ariaLabel="Target" placeholder="请选择" />);
  fireEvent.click(screen.getByRole('button', { name: 'Target' }));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(onChange).toHaveBeenCalledWith('en');
});

test('已选中且只有一项:仍是静态标签(回归既有行为)', () => {
  render(<Select value="en" options={[OPTS[0]]} onChange={() => {}} ariaLabel="Target" placeholder="请选择" />);
  expect(screen.queryByRole('button', { name: 'Target' })).toBeNull();
  expect(screen.getByText('English')).toBeInTheDocument();
});

test('未传 placeholder 时 value 无匹配仍回落第一项(回归既有行为)', () => {
  render(<Select value={null} options={OPTS} onChange={() => {}} ariaLabel="Target" />);
  expect(screen.getByRole('button', { name: 'Target' })).toHaveTextContent('English');
});
