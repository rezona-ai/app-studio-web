import { expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioPlayer from './AudioPlayer';

beforeEach(() => {
  // jsdom 未实现 HTMLMediaElement.play,打桩后才能断言播放意图
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

const audioOf = (c: HTMLElement) => c.querySelector('audio') as HTMLAudioElement;

test('渲染自有播放器:隐藏的 audio 带 src 且不用原生 controls', () => {
  const { container } = render(<AudioPlayer src="http://x/bgm.mp3" />);
  const audio = audioOf(container);
  expect(audio).toHaveAttribute('src', 'http://x/bgm.mp3');
  expect(audio).not.toHaveAttribute('controls');
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
});

test('点播放 → 调用 play,播放中按钮转为 Pause', () => {
  const { container } = render(<AudioPlayer src="http://x/bgm.mp3" />);
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  fireEvent.play(audioOf(container));
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
});

test('元数据就绪 → 显示 m:ss 总时长;播放进度更新当前时长', () => {
  const { container } = render(<AudioPlayer src="http://x/bgm.mp3" />);
  const audio = audioOf(container);
  Object.defineProperty(audio, 'duration', { value: 65, configurable: true });
  fireEvent.loadedMetadata(audio);
  expect(screen.getByText('1:05')).toBeInTheDocument();
  Object.defineProperty(audio, 'currentTime', { value: 9, configurable: true });
  fireEvent.timeUpdate(audio);
  expect(screen.getByText('0:09')).toBeInTheDocument();
});

test('同一时刻只允许一个播放器出声:新播放器 play 会暂停旧的', () => {
  const first = render(<AudioPlayer src="http://x/a.mp3" />);
  const second = render(<AudioPlayer src="http://x/b.mp3" />);
  fireEvent.play(audioOf(first.container));
  fireEvent.play(audioOf(second.container));
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});
