import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ModelSelector from './ModelSelector';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';

// mock 埋点:track 由外部 vi.fn 代理转发,断言调用而不触真实 gtag/上下文
const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), projectPublicId: () => 'AbCd' }));

function makeClient() {
  const setModel = vi.fn();
  const ref = { current: { setModel } } as unknown as React.RefObject<KoubouClient | null>;
  return { ref, setModel };
}

beforeEach(() => {
  useStore.setState({ availableModels: [], selectedModel: null, newUserStatus: null, plansCache: null, creditModalOpen: false });
  document.documentElement.dataset.theme = 'light';
  track.mockClear();
});
afterEach(cleanup);

test('无可选模型时不渲染', () => {
  const { ref } = makeClient();
  const { container } = render(<ModelSelector client={ref} />);
  expect(container.firstChild).toBeNull();
});

test('显示当前模型展示名(由 ID 派生)', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  expect(screen.getByRole('button', { name: 'Model: Opus 4.8' })).toBeTruthy();
});

test('展开显示已知模型的官方定位文案', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5', 'gpt-5.5', 'grok-4.5'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  expect(screen.getByText('For complex agentic coding and enterprise work')).toBeTruthy();
  expect(screen.getByText('Next-generation intelligence for long-running agents')).toBeTruthy();
  expect(screen.getByText('OpenAI’s smartest and most intuitive model yet')).toBeTruthy();
  expect(screen.getByText('Frontier intelligence for coding and agents, fast and cost-efficient')).toBeTruthy();
  expect(screen.getByText('GPT 5.5')).toBeTruthy();
  expect(screen.getByText('Grok 4.5')).toBeTruthy();
});

test('已收录 gpt-6-astra 显示 GPT 6 Astra 与定位文案', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'gpt-6-astra'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  const row = screen.getByText('Frontier intelligence for 3D worlds and polished visuals').closest('button')!;
  expect(row.textContent).toContain('GPT 6 Astra');
});

test('自研 Rez1 选项带定位文案与项目 logo 图标', () => {
  useStore.setState({ availableModels: ['Rez1', 'claude-opus-4-8'], selectedModel: 'Rez1' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Rez1' })); });
  const row = screen.getByText('Rezona’s own model, trained on millions of games created and played here').closest('button')!;
  expect(row.textContent).toContain('Rez1');
  expect(row.querySelector('img')!.getAttribute('src')).toContain('/figma/icons/logo.svg');
});

test('未知模型选项不带描述', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'gpt-image-2'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  const row = screen.getByText('gpt-image-2').closest('button')!;
  expect(row.textContent).toBe('gpt-image-2');
});

test('gpt-* 未收录 ID 兜底:GPT <版本> <代号> 展示名 + OpenAI 图标,不带描述', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'gpt-6-nova'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  const row = screen.getByText('GPT 6 Nova').closest('button')!;
  expect(row.textContent).toBe('GPT 6 Nova');
  // OpenAI 字形走 mask 重着色(span,非 <img>),从 mask 样式里核对资源路径
  const icon = row.querySelector('span[aria-hidden="true"]') as HTMLElement;
  expect(icon.style.mask).toContain('/figma/icons/model-openai.svg');
});

test('展开选择 → 写 store 且发 set_model', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8' });
  const { ref, setModel } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  act(() => { fireEvent.click(screen.getByText('Fable 5')); });
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
  expect(setModel).toHaveBeenCalledWith('claude-fable-5');
});

test('切换模型上报 model_switch(from→to)', () => {
  useStore.setState({ availableModels: ['m1', 'm2'], selectedModel: 'm1' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: m1' })); }); // 打开下拉
  act(() => { fireEvent.click(screen.getByText('m2')); }); // 选 m2
  expect(track).toHaveBeenCalledWith('model_switch', { model_from: 'm1', model_to: 'm2' });
});

test('选中当前已选项(未实际切换)不上报 model_switch', () => {
  useStore.setState({ availableModels: ['m1', 'm2'], selectedModel: 'm1' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: m1' })); }); // 打开下拉
  // 触发钮文案与当前项选项文案都渲染"m1",取下拉内那个(文档顺序在触发钮之后)
  act(() => { fireEvent.click(screen.getAllByText('m1').at(-1)!); });
  expect(track).not.toHaveBeenCalled();
});

// 报错气泡的 Switch model 按钮只碰 store(requestModelMenu),菜单由本组件按计数展开(设计稿 2026-09-03)
test('store 发出 requestModelMenu → 下拉展开', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8', modelMenuRequest: 0 });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  expect(screen.queryByText('Fable 5')).toBeNull();
  act(() => { useStore.getState().requestModelMenu(); });
  expect(screen.getByText('Fable 5')).toBeTruthy();
});

test('codex 活跃 run 期(禁用)收到 requestModelMenu → 不开,解锁后也不补开', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8', modelMenuRequest: 0, backend: 'codex', runStatus: 'running' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { useStore.getState().requestModelMenu(); });
  expect(screen.queryByText('Fable 5')).toBeNull();
  act(() => { useStore.setState({ runStatus: 'idle' }); });
  expect(screen.queryByText('Fable 5')).toBeNull();
});

// —— 新用户模型门禁(spec 2026-08-28-new-user-model-gate-design)——
const freePlans = {
  currency: 'USD', current_tier: 'free' as const, intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
};

test('锁定态点其他模型:不切换、不发 set_model,只开订阅弹窗', () => {
  useStore.setState({
    availableModels: ['Rez1', 'claude-fable-5'], selectedModel: 'Rez1',
    newUserStatus: true, plansCache: freePlans,
  });
  const { ref, setModel } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Rez1' })); });
  act(() => { fireEvent.click(screen.getByText('Fable 5')); });
  expect(useStore.getState().selectedModel).toBe('Rez1');
  expect(setModel).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
  expect(useStore.getState().creditModalOpen).toBe('modelLocked');
});

test('锁定态下选项照常全部列出(定案:外观不变,不加锁标)', () => {
  useStore.setState({
    availableModels: ['Rez1', 'claude-fable-5'], selectedModel: 'Rez1',
    newUserStatus: true, plansCache: freePlans,
  });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Rez1' })); });
  expect(screen.getByText('Fable 5')).toBeTruthy();
});

test('已订阅的新用户不锁:照常切换', () => {
  useStore.setState({
    availableModels: ['Rez1', 'claude-fable-5'], selectedModel: 'Rez1',
    newUserStatus: true, plansCache: { ...freePlans, current_tier: 'starter' as const },
  });
  const { ref, setModel } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Rez1' })); });
  act(() => { fireEvent.click(screen.getByText('Fable 5')); });
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
  expect(setModel).toHaveBeenCalledWith('claude-fable-5');
  expect(useStore.getState().creditModalOpen).toBe(false);
});
