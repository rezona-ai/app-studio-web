import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';
import MentionPopover from './MentionPopover';

// 默认工厂:就绪 + 有 preview.src(可提及),覆盖 status/preview 即可造出不可提及场景
const asset = (over: Partial<Asset> = {}): Asset =>
  ({ id: 'a1', key: 'sky.png', label: 'Sky', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://x/sky.png' }, ...over } as Asset);

afterEach(cleanup);

describe('MentionPopover 空态反馈', () => {
  test('无任何资产:显示引导文案', () => {
    useStore.setState({ assets: [] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/files the agent generates or you attach/i)).toBeInTheDocument();
  });
  test('有资产但 query 无匹配:显示 No matches', () => {
    useStore.setState({ assets: [asset()] });
    render(<MentionPopover query="zzz" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('匹配项超过 8 个:全部列出,不被硬截断(靠滚动区容纳)', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      asset({ id: `a${i}`, key: `img${i}.png`, label: `Img ${i}`, preview: { src: `https://x/img${i}.png` } }),
    );
    useStore.setState({ assets: many });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(12);
  });
});

describe('MentionPopover 候选过滤(eligibility)', () => {
  test('未就绪资产不进候选', () => {
    useStore.setState({ assets: [asset({ status: 'generating' })] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('无 preview.src 的资产不进候选', () => {
    useStore.setState({ assets: [asset({ preview: undefined })] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('就绪且有 preview.src 的资产进候选', () => {
    useStore.setState({ assets: [asset()] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText('Sky')).toBeInTheDocument();
  });
});
