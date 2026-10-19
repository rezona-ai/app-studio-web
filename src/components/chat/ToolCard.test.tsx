import { expect, test } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCard from './ToolCard';
import type { Part } from '@/store/types';
import type { FileDiff } from '@/koubou/protocol';
import { useStore } from '@/store';

const sampleDiff: FileDiff = {
  type: 'update', filePath: 'src/game/player.ts', additions: 2, deletions: 1,
  hunks: [{ lines: [
    { kind: 'del', text: 'foo();' },
    { kind: 'add', text: 'bar();' },
    { kind: 'add', text: 'baz();' },
  ] }],
};

const tool = (over: Partial<Extract<Part, { type: 'tool' }>>): Extract<Part, { type: 'tool' }> =>
  ({ type: 'tool', id: 't', name: 'Bash', input: { command: 'ls' }, status: 'ready', ...over });

test('运行中 → 显示旋转指示器(role=status),不显示裸状态字', () => {
  render(<ToolCard part={tool({ status: 'generating' })} />);
  expect(screen.getByRole('status', { name: 'Running' })).toBeInTheDocument();
  expect(screen.queryByText('generating')).not.toBeInTheDocument();
});

test('已完成 → 不显示转圈,改显 品牌橙 check 状态图标(不再显示状态字)', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready' })} />);
  expect(screen.queryByRole('status', { name: 'Running' })).not.toBeInTheDocument();
  expect(container.querySelector('[data-tool-status="done"]')).toBeInTheDocument();
  expect(screen.queryByText('ready')).not.toBeInTheDocument();
});

test('运行中 → 默认展开,显示参数', () => {
  render(<ToolCard part={tool({ status: 'generating' })} />);
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
});

test('已完成 → 默认折叠,不显示参数', () => {
  render(<ToolCard part={tool({ status: 'ready' })} />);
  expect(screen.queryByText(/"command":"ls"/)).not.toBeInTheDocument();
});

test('输出完成(generating → ready)→ 自动折叠,参数从可见变隐藏', () => {
  const { rerender } = render(<ToolCard part={tool({ status: 'generating' })} />);
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
  rerender(<ToolCard part={tool({ status: 'ready' })} />);
  expect(screen.queryByText(/"command":"ls"/)).not.toBeInTheDocument();
});

test('已折叠的完成卡片 → 点击标题可手动展开', () => {
  render(<ToolCard part={tool({ status: 'ready' })} />);
  fireEvent.click(screen.getByRole('button', { name: /Bash/ }));
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
});

test('折叠态下生成的媒体仍然可见', () => {
  render(
    <ToolCard
      part={tool({
        status: 'ready',
        media: [{ kind: 'image', path: 'p.png', previewUrl: 'http://x/p.png' }],
      })}
    />,
  );
  // 完成态默认折叠(参数隐藏),但单张媒体预览应全尺寸常驻、无缩略图带
  expect(screen.queryByText(/"command":"ls"/)).not.toBeInTheDocument();
  expect(screen.getByAltText('p.png')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'p.png' })).not.toBeInTheDocument();
});

test('多项就绪 media(≥2)→ 每项一格缩略图带,默认展开首项', () => {
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
    { kind: 'image', path: 'b.png', previewUrl: 'http://x/b.png' },
    { kind: 'image', path: 'c.png', previewUrl: 'http://x/c.png' },
  ] })} />);
  // 带里三格都在(按文件名可达),不再把其余项压成 +N
  expect(screen.getByRole('button', { name: 'a.png' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'b.png' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'c.png' })).toBeInTheDocument();
  expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  // 展开位默认是首项
  expect(screen.getByTestId('media-inline').querySelector('img')).toHaveAttribute('src', 'http://x/a.png');
});

test('多项就绪 media → 点击第 3 格,展开位切到该项', () => {
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
    { kind: 'image', path: 'b.png', previewUrl: 'http://x/b.png' },
    { kind: 'image', path: 'c.png', previewUrl: 'http://x/c.png' },
  ] })} />);
  fireEvent.click(screen.getByRole('button', { name: 'c.png' }));
  expect(screen.getByTestId('media-inline').querySelector('img')).toHaveAttribute('src', 'http://x/c.png');
  expect(screen.getByRole('button', { name: 'c.png' })).toHaveAttribute('aria-pressed', 'true');
});

test('音频排在首位 → 展开位是可见的音频控件(不再被 w-fit 挤成 0 宽)', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'audio', path: 'bgm.mp3', previewUrl: 'http://x/bgm.mp3' },
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
  ] })} />);
  const inline = screen.getByTestId('media-inline');
  const audio = inline.querySelector('audio');
  expect(audio).toHaveAttribute('src', 'http://x/bgm.mp3');
  // 自绘播放器(非原生 controls)
  expect(audio).not.toHaveAttribute('controls');
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  // 展开位自身占整行,不套在 w-fit 的按钮里
  expect(container.querySelector('button.w-fit')).toBeNull();
});

test('3D 项进入缩略图带,并用画布同名资产的 poster 当缩略图', () => {
  useStore.setState({ assets: [{
    id: 'm1', key: 'm1', label: 'ship', kind: '3d', source: 'generated', status: 'ready', position: { x: 0, y: 0 },
    preview: { src: 'https://pgc/canvas/ship.glb', poster: 'https://pgc/canvas/ship.preview.webp' },
  }] });
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
    { kind: 'model3d', path: 'assets/ship.glb', previewUrl: 'http://x/ship.glb' },
  ] })} />);
  const cell = screen.getByRole('button', { name: 'ship.glb' });
  expect(cell.querySelector('img')).toHaveAttribute('src', 'https://pgc/canvas/ship.preview.webp');
});

test('3D 项画布查不到缩略图 → 仍占一格(不再静默吞掉),回退类型占位图', () => {
  useStore.setState({ assets: [] });
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
    { kind: 'model3d', path: 'assets/ship.glb', previewUrl: 'http://x/ship.glb' },
  ] })} />);
  const cell = screen.getByRole('button', { name: 'ship.glb' });
  expect(cell.querySelector('img')).toHaveAttribute('src', '/assets/generating/3d.jpg');
});

test('视频/音频格用各自的类型占位图(previewUrl 是媒体流,不能当图)', () => {
  useStore.setState({ assets: [] });
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'video', path: 'intro.mp4', previewUrl: 'http://x/intro.mp4' },
    { kind: 'audio', path: 'bgm.mp3', previewUrl: 'http://x/bgm.mp3' },
  ] })} />);
  expect(screen.getByRole('button', { name: 'intro.mp4' }).querySelector('img')).toHaveAttribute('src', '/assets/generating/video.jpg');
  expect(screen.getByRole('button', { name: 'bgm.mp3' }).querySelector('img')).toHaveAttribute('src', '/assets/generating/audio.jpg');
});

test('无预览直链的就绪 media 项不渲染图片', () => {
  render(<ToolCard part={tool({ status: 'ready', media: [{ kind: 'image', path: 'np.png', previewUrl: null }] })} />);
  expect(screen.queryByAltText('np.png')).not.toBeInTheDocument();
});

test('无 previewUrl 且画布查不到 poster 的项不进带(不留点不开的死格)', () => {
  useStore.setState({ assets: [] });
  render(<ToolCard part={tool({ status: 'ready', media: [
    { kind: 'image', path: 'a.png', previewUrl: 'http://x/a.png' },
    { kind: 'image', path: 'b.png', previewUrl: 'http://x/b.png' },
    { kind: 'model3d', path: 'ghost.glb', previewUrl: null },
  ] })} />);
  expect(screen.getByRole('button', { name: 'a.png' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'ghost.glb' })).not.toBeInTheDocument();
});

test('有 diff(完成态)→ 头部显示文件名与 +N -M 统计,折叠态也可见', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'src/game/player.ts' }, diff: sampleDiff })} />);
  expect(screen.getByText('player.ts')).toBeInTheDocument();
  expect(screen.getByText('+2')).toBeInTheDocument();
  expect(screen.getByText('-1')).toBeInTheDocument();
  expect(screen.queryByText('foo();')).not.toBeInTheDocument();
});

test('展开 diff → 渲染 diff 行,且不显示原始结果文本', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts' }, result: 'The file has been updated.', diff: sampleDiff })} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.getByText('bar();')).toBeInTheDocument();
  expect(screen.queryByText('The file has been updated.')).not.toBeInTheDocument();
});

test('有 diff 时不渲染参数 JSON(即便展开)', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts', old_string: 'foo' }, diff: sampleDiff })} />);
  fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
  expect(screen.queryByText(/old_string/)).not.toBeInTheDocument();
  expect(screen.getByText('bar();')).toBeInTheDocument();
});

test('userModified → 显示「用户已改」角标', () => {
  render(<ToolCard part={tool({ status: 'ready', name: 'Edit', input: { file_path: 'a.ts' }, diff: { ...sampleDiff, userModified: true } })} />);
  expect(screen.getByText('Edited by user')).toBeInTheDocument();
});

test('失败 → 不显示红色 error 状态字(弱化),也不再内联展示错误体(result 整体不渲染)', () => {
  render(<ToolCard part={tool({ status: 'error', result: 'boom: command not found' })} />);
  // 弱化展示:去掉头部红色 error 状态字
  expect(screen.queryByText('error')).not.toBeInTheDocument();
  // result 不再展示:Error 标签与错误体均不渲染(output 只作中间处理)
  expect(screen.queryByText('Error')).not.toBeInTheDocument();
  expect(screen.queryByText('boom: command not found')).not.toBeInTheDocument();
});

test('失败 → 默认折叠,不显示参数(与完成态一致)', () => {
  render(<ToolCard part={tool({ status: 'error' })} />);
  expect(screen.queryByText(/"command":"ls"/)).not.toBeInTheDocument();
});

test('运行中失败(generating → error)→ 自动折叠,参数从可见变隐藏', () => {
  const { rerender } = render(<ToolCard part={tool({ status: 'generating' })} />);
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
  rerender(<ToolCard part={tool({ status: 'error', result: 'failed' })} />);
  // 失败不再默认展开:参数隐藏,result(错误体)也不渲染
  expect(screen.queryByText(/"command":"ls"/)).not.toBeInTheDocument();
  expect(screen.queryByText('failed')).not.toBeInTheDocument();
});

test('失败折叠态 → 点击标题仍可手动展开查看参数', () => {
  render(<ToolCard part={tool({ status: 'error' })} />);
  fireEvent.click(screen.getByRole('button', { name: /Bash/ }));
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
});

test('完成态展开 → 仍显示 Input,但不显示 Output(result 不渲染)', () => {
  render(<ToolCard part={tool({ status: 'ready', result: 'some tool output' })} />);
  fireEvent.click(screen.getByRole('button', { name: /Bash/ }));
  // Input 保留
  expect(screen.getByText(/"command":"ls"/)).toBeInTheDocument();
  // Output 区块整体移除:标签与结果文本均不渲染
  expect(screen.queryByText('Output')).not.toBeInTheDocument();
  expect(screen.queryByText('some tool output')).not.toBeInTheDocument();
});

test('失败 → 显示 danger warning 状态图标', () => {
  const { container } = render(<ToolCard part={tool({ status: 'error' })} />);
  expect(container.querySelector('[data-tool-status="error"]')).toBeInTheDocument();
});

test('有正文 → 右侧渲染折叠箭头,点击切换 aria-expanded', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready' })} />);
  expect(container.querySelector('[data-collapse-arrow]')).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: /Bash/ });
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
});

test('无正文(无 diff 无参数)→ 不渲染折叠箭头', () => {
  const { container } = render(<ToolCard part={tool({ status: 'ready', input: undefined })} />);
  expect(container.querySelector('[data-collapse-arrow]')).toBeNull();
});

test('任务工具渲染极简 pill:本地化标签,无展开箭头', () => {
  render(<ToolCard part={{ type: 'tool', id: 't1', name: 'TaskCreate', input: { subject: 'x' }, status: 'ready' }} />);
  expect(screen.getByText('Updated plan')).toBeInTheDocument();
  expect(screen.queryByText('TaskCreate')).toBeNull();
  expect(document.querySelector('[data-collapse-arrow]')).toBeNull();
});
