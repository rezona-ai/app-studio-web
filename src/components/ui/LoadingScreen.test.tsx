import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LoadingScreen from './LoadingScreen';

describe('LoadingScreen 默认档(spinner)', () => {
  it('渲染 role=status 的 spinner,label 同时用于文案与 aria-label', () => {
    render(<LoadingScreen label="Loading workspace" />);
    const spinner = screen.getByRole('status');
    expect(spinner.getAttribute('aria-label')).toBe('Loading workspace');
    expect(screen.getByText('Loading workspace')).toBeTruthy();
  });

  it('spinner 用品牌橙轨道环(--color-primary 弧线 + primary-soft 底环)', () => {
    render(<LoadingScreen />);
    const spinner = screen.getByRole('status');
    expect(spinner.className).toContain('border-[var(--color-primary-soft)]');
    expect(spinner.className).toContain('border-t-[var(--color-primary)]');
  });

  it('closing=true 播放淡出动画类', () => {
    const { container } = render(<LoadingScreen closing />);
    expect((container.firstChild as HTMLElement).className).toContain('anim-fade-out');
  });

  it('默认档不渲染品牌字标', () => {
    const { container } = render(<LoadingScreen />);
    expect(container.querySelector('.brand-letter')).toBeNull();
  });

  it('spinner 档保留骨架 shimmer 底', () => {
    const { container } = render(<LoadingScreen />);
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
  });
});

describe('LoadingScreen brand 档', () => {
  it('渲染 logo 图片与逐字字标 Rezona Lab', () => {
    const { container } = render(<LoadingScreen variant="brand" label="Loading workspace" />);
    // logo:FigIcon original 档渲染 <img>
    expect(container.querySelector('img[src*="logo"]')).toBeTruthy();
    // 字标逐字拆分,拼起来是 Rezona Lab。词间空格必须是 NBSP:
    // 逐字 span 是 inline-block,普通空格会被折叠掉,字标会连成 "RezonaLab"
    const letters = Array.from(container.querySelectorAll('.brand-letter'));
    expect(letters.map((l) => l.textContent).join('')).toBe('Rezona\u00A0Lab');
    const wordmark = letters[0]!.parentElement!;
    expect(wordmark.className).toContain('font-display');
    // 扫光覆盖层与字母解耦(Chromium 合成层裁切限制),是字母的兄弟覆盖层
    const sheen = wordmark.querySelector('.wordmark-sheen');
    expect(sheen).toBeTruthy();
    expect(sheen!.textContent).toBe('Rezona\u00A0Lab');
    // label 文案与 role=status 仍在
    expect(screen.getByText('Loading workspace')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('brand 档不渲染默认转圈 spinner', () => {
    const { container } = render(<LoadingScreen variant="brand" />);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('brand 档用静态品牌底 brand-backdrop,不用骨架 shimmer', () => {
    const { container } = render(<LoadingScreen variant="brand" />);
    expect(container.querySelector('.brand-backdrop')).toBeTruthy();
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
  });

  it('hints 轮播:每 900ms 顺序切换,停在最后一条不回绕', () => {
    vi.useFakeTimers();
    try {
      render(<LoadingScreen variant="brand" hints={['连接中…', '载入画布…', '马上就好…']} />);
      expect(screen.getByText('连接中…')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(900); });
      expect(screen.getByText('载入画布…')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(900); });
      expect(screen.getByText('马上就好…')).toBeTruthy();
      // 走到最后一条后停住:再推进不回绕到第一条
      act(() => { vi.advanceTimersByTime(2000); });
      expect(screen.getByText('马上就好…')).toBeTruthy();
      expect(screen.queryByText('连接中…')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('不传 hints 时仍显示 label 文案', () => {
    render(<LoadingScreen variant="brand" label="Loading workspace" />);
    expect(screen.getByText('Loading workspace')).toBeTruthy();
  });

  it('closing=true 时中心内容播放揭幕退场 brand-exit', () => {
    const { container } = render(<LoadingScreen variant="brand" closing />);
    expect(screen.getByRole('status').className).toContain('brand-exit');
    // 整层淡出仍在
    expect((container.firstChild as HTMLElement).className).toContain('anim-fade-out');
  });
});
