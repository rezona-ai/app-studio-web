import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AssetChip, { MediaThumb } from './AssetChip';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';

afterEach(cleanup);

function seedAsset(a: Partial<Asset>): Asset {
  return {
    id: 'id1', key: 'k1', label: '角色 A', kind: 'image', source: 'generated',
    status: 'ready', position: { x: 0, y: 0 }, ...a,
  };
}

test('有 preview → 贴片显示缩略图', () => {
  useStore.setState({ assets: [seedAsset({ key: 'k1', preview: { src: '/x.png' } })] });
  const { container } = render(<AssetChip assetKey="k1" />);
  expect(container.querySelector('img[src="/x.png"]')).not.toBeNull();
  expect(screen.getByText('角色 A')).toBeInTheDocument();
});

test('无 preview → 回退类型图标(audio=waveform),仍显示标签', () => {
  useStore.setState({ assets: [seedAsset({ key: 'k2', label: '音轨', kind: 'audio' })] });
  const { container } = render(<AssetChip assetKey="k2" />);
  // 类型图标现以 CSS mask 着色(随主题翻转),渲染为带 mask url 的元素而非 <img>
  expect(container.querySelector('[style*="waveform.svg"]')).not.toBeNull();
  expect(screen.getByText('音轨')).toBeInTheDocument();
});

test('视频引用 → 复用封面(渲染 <video> 首帧,而非 <img>)', () => {
  useStore.setState({ assets: [seedAsset({ key: 'v1', label: '过场动画', kind: 'video', preview: { src: '/clip.mp4' } })] });
  const { container } = render(<AssetChip assetKey="v1" />);
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video?.getAttribute('src')).toContain('/clip.mp4');
  expect(container.querySelector('img')).toBeNull(); // 视频 URL 不再塞进 <img>
  expect(screen.getByText('过场动画')).toBeInTheDocument();
});

test('查不到资产 → 回退展示 key', () => {
  useStore.setState({ assets: [] });
  render(<AssetChip assetKey="missing-key" />);
  expect(screen.getByText('missing-key')).toBeInTheDocument();
});

test('传 onRemove → 渲染移除按钮并触发回调', () => {
  const onRemove = vi.fn();
  useStore.setState({ assets: [seedAsset({ key: 'k1' })] });
  render(<AssetChip assetKey="k1" onRemove={onRemove} />);
  screen.getByRole('button', { name: 'Remove reference' }).click();
  expect(onRemove).toHaveBeenCalledOnce();
});

test('MediaThumb 图片渲染 <img>(原 src)', () => {
  const { container } = render(<MediaThumb kind="image" src="http://x/a.png" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('http://x/a.png');
});

test('MediaThumb 视频渲染 <video> 首帧(#t=0.001)', () => {
  const { container } = render(<MediaThumb kind="video" src="http://x/a.mp4" />);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('http://x/a.mp4#t=0.001');
});

test('MediaThumb 音频不渲染 video(回退图标)', () => {
  const { container } = render(<MediaThumb kind="audio" src="http://x/a.mp3" />);
  expect(container.querySelector('video')).toBeNull();
});

test('MediaThumb 图片带懒加载与异步解码属性(B4)', () => {
  const { container } = render(<MediaThumb kind="image" src="http://x/a.png" />);
  const img = container.querySelector('img');
  expect(img?.getAttribute('loading')).toBe('lazy');
  expect(img?.getAttribute('decoding')).toBe('async');
});
