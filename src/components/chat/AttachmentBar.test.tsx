import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AttachmentBar from './AttachmentBar';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 }, assets: [] }));
afterEach(cleanup);

test('无引用无附件 → 不渲染', () => {
  const { container } = render(<AttachmentBar />);
  expect(container.firstChild).toBeNull();
});

test('草稿含可提及资产的 @key → 显示资产名 chip,移除后草稿清空', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: '/bg.png' } }],
    composer: { draft: '@k1', attachments: [], baseLines: 2 },
  });
  render(<AttachmentBar />);
  expect(screen.getByText('背景图')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Remove reference' }).click();
  expect(useStore.getState().composer.draft).toBe('');
});

test('资产引用有预览图 → 显示缩略图(走共享 AssetChip)', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: '/bg.png' } }],
    composer: { draft: '@k1', attachments: [], baseLines: 2 },
  });
  const { container } = render(<AttachmentBar />);
  expect(container.querySelector('img[src="/bg.png"]')).not.toBeNull();
});

test('草稿含未就绪资产的 @key → 不显示引用 chip(不可提及)', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
    composer: { draft: '@k1', attachments: [], baseLines: 2 },
  });
  const { container } = render(<AttachmentBar />);
  expect(container.firstChild).toBeNull();
});

test('就绪图片附件 chip 显示缩略图与文件名,可移除', () => {
  useStore.setState({ composer: { draft: '', attachments: [{ id: 'a1', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png' }], baseLines: 2 } });
  const { container } = render(<AttachmentBar />);
  expect(screen.getByText('a.png')).toBeInTheDocument();
  expect(container.querySelector('img[src="http://x/a.png"]')).not.toBeNull();
  screen.getByRole('button', { name: 'Remove attachment' }).click();
  expect(useStore.getState().composer.attachments).toEqual([]);
});

test('上传中附件显示 spinner', () => {
  useStore.setState({ composer: { draft: '', attachments: [{ id: 'u', name: 'b.png', mime: 'image/png', kind: 'image', status: 'uploading' }], baseLines: 2 } });
  render(<AttachmentBar />);
  expect(screen.getByRole('status', { name: 'Uploading' })).toBeInTheDocument();
});
