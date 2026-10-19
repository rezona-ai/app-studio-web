import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import SharePage from './SharePage';
import ShareNotFound from './ShareNotFound';

afterEach(cleanup);

const props = { gameUrl: 'https://lab.rezona.ai/game/pgcserver/pv/DaKkJMXU/v8/dist/index.html', remixHref: '/game/?remix=DaKkJMXU' };

const frame = () => document.querySelector('iframe');

describe('SharePage', () => {
  test('渲染游戏 iframe,并放行全屏 / 自动播放 / 手柄', () => {
    render(<SharePage {...props} />);
    const f = frame()!;
    expect(f).toHaveAttribute('src', props.gameUrl);
    // 跨源子文档默认没有这些权限,不显式放行会是相对旧的顶层文档直出的功能回归
    expect(f.getAttribute('allow')).toContain('fullscreen');
    expect(f.getAttribute('allow')).toContain('autoplay');
    expect(f.getAttribute('allow')).toContain('gamepad');
  });

  test('顶栏与游戏并存,顶栏在文档序上先于 iframe', () => {
    const { container } = render(<SharePage {...props} />);
    const header = container.querySelector('header')!;
    expect(header).toBeInTheDocument();
    expect(header.compareDocumentPosition(frame()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('加载态先在,iframe onLoad 后撤除', () => {
    // 必须先按住 readyState:jsdom 默认 complete,兜底 effect 会在挂载时就把层撤了,
    // 测不到 onLoad 这条路径(真实浏览器上「文档 complete」本就意味着含 iframe 都已加载完)
    const spy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<SharePage {...props} />);
    expect(screen.getByText('Loading game…')).toBeInTheDocument();
    fireEvent.load(frame()!);
    expect(screen.queryByText('Loading game…')).toBeNull();
    spy.mockRestore();
  });

  test('iframe 的可见性不受 onLoad 左右:加载层在它下面一层,游戏画上就盖住', () => {
    // src 是 SSR 就有的,命中缓存时 iframe 会在 hydration 前加载完,而 load 不冒泡、
    // React 直接绑定 —— 那一发收不到。若可见性绑在 frameLoaded 上,游戏跑起来了却被永久盖住。
    const spy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<SharePage {...props} />);
    const f = frame()!;
    expect(f.className).not.toContain('opacity-0');
    // 取加载层本体而非 `.absolute.inset-0`(那个选择器同时命中 LoadingScreen 内部的
    // brand-backdrop,靠文档序碰巧选对)
    const loading = screen.getByText('Loading game…').closest('.absolute')!;
    // 加载层在文档序上先于 iframe(在其下层)
    expect(loading.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    spy.mockRestore();
  });

  test('上游不可达:不渲染 iframe,给一句提示 —— 但顶栏照常,访客仍有 Create your game 这个出口', () => {
    render(<SharePage {...props} unavailable />);
    expect(frame()).toBeNull();
    expect(screen.getByText("This game can't be opened right now")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create/ })).toBeInTheDocument();
  });

  test('未开放 Remix 时顶栏不渲染该按钮(判据由外层传入,本组件只透传)', () => {
    render(<SharePage {...props} remixHref={null} />);
    expect(screen.queryByText('Remix')).toBeNull();
  });

  test('onLoad 丢失也能撤层:挂载时文档已 complete 即在下一帧撤', async () => {
    // 层序保证了它盖不住游戏,但撤不掉仍会把一个 role="status" 节点与无限 spinner
    // 整场留在无障碍树里 —— 而 onLoad 收不到正是缓存命中时的常态路径
    const spy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    render(<SharePage {...props} />);
    await waitFor(() => expect(screen.queryByText('Loading game…')).toBeNull());
    spy.mockRestore();
  });

  test('文档尚未 complete 时等顶层 load(iframe 完成才会触发)', () => {
    const spy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<SharePage {...props} />);
    expect(screen.getByText('Loading game…')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('load')); });
    expect(screen.queryByText('Loading game…')).toBeNull();
    spy.mockRestore();
  });
});

describe('ShareNotFound', () => {
  test('404 页与错误页同形:顶栏照常 + 一句说明,不把访客丢在无出口的默认 404 上', () => {
    render(<ShareNotFound />);
    expect(screen.getByText('This shared game is no longer available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create/ })).toBeInTheDocument();
    // code 未知(参数可能本就非法),故不给 Remix 入口
    expect(screen.queryByText('Remix')).toBeNull();
  });
});
