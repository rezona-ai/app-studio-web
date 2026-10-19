import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import FullscreenPreview from './FullscreenPreview';
import { resolvePreviewUrl } from '@/lib/pgc/preview-url';

vi.mock('@/lib/pgc/preview-url', () => ({ resolvePreviewUrl: vi.fn() }));
const resolve = vi.mocked(resolvePreviewUrl);

// 冲洗挂载时的 resolvePreviewUrl 异步 setState
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => { vi.clearAllMocks(); });

describe('FullscreenPreview', () => {
  test('首帧即显示带版本名的加载态(不等 URL 解析,页签不再空白)', () => {
    resolve.mockReturnValue(new Promise(() => {}));   // 永不 resolve:停在解析中
    render(<FullscreenPreview pid={535} vid="ver_9" seq={3} />);
    expect(screen.getByRole('status', { name: 'Loading V3…' })).toBeInTheDocument();
    expect(screen.queryByTitle('preview')).not.toBeInTheDocument();
  });

  test('缺 seq 时退化为通用加载文案', () => {
    resolve.mockReturnValue(new Promise(() => {}));
    render(<FullscreenPreview pid={535} vid="ver_9" seq={null} />);
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  });

  test('解析成功:iframe 指向预览地址,加载完成后撤掉加载层', async () => {
    resolve.mockResolvedValue('https://cdn.example/v3/index.html');
    render(<FullscreenPreview pid={535} vid="ver_9" seq={3} />);
    await flush();
    expect(resolve).toHaveBeenCalledWith({ pid: 535, vid: 'ver_9', seq: 3 });
    const frame = screen.getByTitle('preview');
    expect(frame).toHaveAttribute('src', 'https://cdn.example/v3/index.html');
    // 旧行为是顶层文档直出,游戏本可自行全屏 / 自动播放;包进跨源 iframe 后须显式放行
    expect(frame).toHaveAttribute('allow', 'fullscreen; autoplay; gamepad');
    // iframe 就绪前仍有加载层盖住（游戏自身加载期也不白屏）
    expect(screen.getByRole('status', { name: 'Loading V3…' })).toBeInTheDocument();
    fireEvent.load(frame);
    expect(screen.queryByRole('status', { name: 'Loading V3…' })).not.toBeInTheDocument();
  });

  // 全屏页是「纯净铺满、退出=关页签」的形态,除了游戏没有别的可操作对象 ——
  // 键盘事件却默认落在顶层文档,用户得先点一下画面才能按方向键,而页面上根本没有提示要点
  test('iframe 就绪后把键盘焦点交给游戏(不必先点一下画面)', async () => {
    resolve.mockResolvedValue('https://cdn.example/v3/index.html');
    render(<FullscreenPreview pid={535} vid="ver_9" seq={3} />);
    await flush();
    const frame = screen.getByTitle('preview') as HTMLIFrameElement;
    const focus = vi.fn();
    // jsdom 的 iframe contentWindow 存在但 focus 不做事;换成探针看是否真的调了
    Object.defineProperty(frame, 'contentWindow', { value: { focus }, configurable: true });
    fireEvent.load(frame);
    expect(focus).toHaveBeenCalled();
  });

  test('解析失败:显示不可用提示而非白屏', async () => {
    resolve.mockRejectedValue(new Error('boom'));
    render(<FullscreenPreview pid={535} vid="ver_9" seq={3} />);
    await flush();
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading V3…' })).not.toBeInTheDocument();
  });
});
