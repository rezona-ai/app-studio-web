import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShareTopBar from './ShareTopBar';
import { STUDIO_GAME_HREF } from '@/lib/share-page';

describe('ShareTopBar', () => {
  test('开放 Remix:按钮是可点的链接,指向工作台 fork 入口', () => {
    render(<ShareTopBar remixHref="/game/?remix=DaKkJMXU" />);
    const remix = screen.getByRole('link', { name: 'Remix' });
    expect(remix).toHaveAttribute('href', '/game/?remix=DaKkJMXU');
  });

  test('未开放 Remix:整个按钮不渲染,不留置灰残影', () => {
    render(<ShareTopBar remixHref={null} />);
    expect(screen.queryByText('Remix')).toBeNull();
    // 顶栏此时只剩品牌与 Create 两条链接
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  test('Create your game 恒指主站落地页(不经 basePath)', () => {
    render(<ShareTopBar remixHref="/?remix=abc123" />);
    const create = screen.getByRole('link', { name: /Create/ });
    expect(create).toHaveAttribute('href', STUDIO_GAME_HREF);
  });

  test('两档配色都取既有类:Create 是品牌橙键帽,Remix 是恒浅色 raised', () => {
    // 顶栏不自造按钮样式 —— 类名换了就是有人在这里另起了一套,该被这条挡住
    render(<ShareTopBar remixHref="/?remix=abc123" />);
    expect(screen.getByRole('link', { name: /Create/ })).toHaveClass('btn-brand-key');
    expect(screen.getByRole('link', { name: 'Remix' })).toHaveClass('btn-raised');
  });

  test('左侧品牌区是指向主站的链接,并有无障碍名', () => {
    render(<ShareTopBar remixHref="/?remix=abc123" />);
    const brand = screen.getByRole('link', { name: 'Rezona Lab' });
    expect(brand).toHaveAttribute('href', STUDIO_GAME_HREF);
  });

  test('窄屏短文案与宽屏长文案同时在 DOM 里,由断点类决定可见性', () => {
    render(<ShareTopBar remixHref="/?remix=abc123" />);
    expect(screen.getByText('Create your game')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });
});
