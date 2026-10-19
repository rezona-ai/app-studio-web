import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import UpsellHero from './UpsellHero';

describe('UpsellHero(三种 hero 变体)', () => {
  // 三种 hero 的字标都是贴纸结构:每行画两遍(描边副本 + 渐变层),取可见的渐变层断言
  test('三种变体各自的字标(装饰性艺术字,不 i18n)', () => {
    const linesOf = (v: 'insufficient' | 'lowBalance' | 'upgradeForMore') => {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      const lines = [...container.querySelectorAll('.hero-wordart')].map((e) => e.textContent);
      unmount();
      return lines;
    };
    expect(linesOf('insufficient')).toEqual(['Insufficient', 'Credits...']);
    expect(linesOf('lowBalance')).toEqual(['Almost out of', 'Credits!']);
    expect(linesOf('upgradeForMore')).toEqual(['Upgrade', 'for more']);
  });

  test('贴纸字标的描边副本对无障碍不可见(可见文本仍只有一份)', () => {
    const { container } = render(<UpsellHero variant="upgradeForMore" />);
    const strokes = [...container.querySelectorAll('.hero-wordart-stroke')];
    expect(strokes).toHaveLength(2);
    for (const s of strokes) expect(s.getAttribute('aria-hidden')).toBe('true');
  });

  test('三种变体的字标都走同一个渐变裁字类', () => {
    for (const v of ['insufficient', 'lowBalance', 'upgradeForMore'] as const) {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      expect(container.querySelectorAll('.hero-wordart')).toHaveLength(2);
      unmount();
    }
  });

  test('主视觉与底纹一律经 assetPath(部署在 /game 前缀下不能裸写绝对路径)', () => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    for (const v of ['insufficient', 'upgradeForMore'] as const) {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
      expect(srcs.length).toBeGreaterThan(0);
      for (const s of srcs) expect(s.startsWith(`${basePath}/figma/`)).toBe(true);
      unmount();
    }
  });

  // 两张稿的差别首先在主视觉:积分不足是 2 道闪电的空箱,低余额是 6 道闪电的满箱。
  // 满箱素材欠了一路,2026-08-12 补齐,回落机制随之删除。
  test('两个宝箱变体各用各的主视觉(空箱 / 满箱)', () => {
    const chestOf = (v: 'insufficient' | 'lowBalance') => {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      const src = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '')
        .find((s) => !s.includes('swirl')) ?? '';
      unmount();
      return src;
    };
    expect(chestOf('insufficient')).toContain('insufficient-chest');
    expect(chestOf('lowBalance')).toContain('lowbalance-chest');
  });

  // 底色是两张稿最直观的差别:积分不足偏粉、低余额偏黄。共用一份渐变是上一版的实现偏差。
  test('两个宝箱变体的底色渐变取不同令牌', () => {
    const tintOf = (v: 'insufficient' | 'lowBalance') => {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      const el = container.querySelector('[data-layer="tint"]');
      const cls = el?.className ?? '';
      unmount();
      return cls;
    };
    expect(tintOf('insufficient')).toContain('--color-promo');
    expect(tintOf('lowBalance')).toContain('--hero-tint-low');
  });

  test('宝箱系字标带深棕描边层(稿上的贴纸描边),且副本对无障碍不可见', () => {
    for (const v of ['insufficient', 'lowBalance'] as const) {
      const { container, unmount } = render(<UpsellHero variant={v} />);
      const strokes = [...container.querySelectorAll('.hero-wordart-stroke')];
      expect(strokes).toHaveLength(2);
      for (const s of strokes) expect(s.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  test('完整订阅弹窗的 hero 用自己的实景素材(不再回落宝箱)', () => {
    const { container } = render(<UpsellHero variant="upgradeForMore" />);
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('upgrade-lab'))).toBe(true);
    expect(srcs.some((s) => s.includes('chest'))).toBe(false);
  });

  test('变体标在容器上供上层定位;children 渲染在装饰层之上(关闭按钮等)', () => {
    const { container } = render(<UpsellHero variant="lowBalance"><button type="button">close</button></UpsellHero>);
    expect(container.querySelector('[data-hero="lowBalance"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'close' })).toBeTruthy();

    const up = render(<UpsellHero variant="upgradeForMore"><button type="button">x</button></UpsellHero>);
    expect(up.container.querySelector('[data-hero="upgradeForMore"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'x' })).toBeTruthy();
  });
});
