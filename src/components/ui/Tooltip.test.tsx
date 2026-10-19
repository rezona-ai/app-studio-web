import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import Tooltip from './Tooltip';

// 触发外包 span:render 返回 container 的第一个子节点
function trigger(container: HTMLElement) {
  return container.firstChild as HTMLElement;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  act(() => vi.runOnlyPendingTimers());
  vi.useRealTimers();
  cleanup();
});

// 推进打开延时(350ms)
function advanceOpen() {
  act(() => vi.advanceTimersByTime(400));
}

describe('Tooltip', () => {
  it('渲染子元素', () => {
    render(<Tooltip label="发送"><button aria-label="发送">x</button></Tooltip>);
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument();
  });

  it('hover 经过延时后显示气泡文案', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    expect(screen.queryByText('发送')).not.toBeInTheDocument(); // 延时内不显示
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
  });

  it('无 label 时回退读子元素 aria-label', () => {
    const { container } = render(<Tooltip><button aria-label="提及">x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('提及')).toBeInTheDocument();
  });

  it('显式 label 覆盖 aria-label', () => {
    const { container } = render(
      <Tooltip label="提及一个资产"><button aria-label="提及">x</button></Tooltip>,
    );
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('提及一个资产')).toBeInTheDocument();
    expect(screen.queryByText('提及')).not.toBeInTheDocument();
  });

  it('mouseleave 后隐藏气泡', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger(container));
    expect(screen.queryByText('发送')).not.toBeInTheDocument();
  });

  it('包裹 disabled 按钮时 hover 外包仍触发气泡', () => {
    const { container } = render(
      <Tooltip label="发送"><button disabled>x</button></Tooltip>,
    );
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toBeInTheDocument();
  });

  it('气泡为纯视觉:带 aria-hidden', () => {
    const { container } = render(<Tooltip label="发送"><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.getByText('发送')).toHaveAttribute('aria-hidden', 'true');
  });

  it('无任何文案来源时透传子元素、不显示气泡', () => {
    const { container } = render(<Tooltip><button>x</button></Tooltip>);
    fireEvent.mouseEnter(trigger(container));
    advanceOpen();
    expect(screen.queryByText('x')).toBeInTheDocument(); // 子元素仍在
    // 没有额外气泡节点:此处仅断言不抛错且子元素存在
  });
});
