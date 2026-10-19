import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import GameFrame from './GameFrame';
import { useStore } from '@/store';
import type { Version } from '@/store/types';

describe('GameFrame 预览自适应', () => {
  it('预览框满幅方角贴合舞台(桌面端游戏,无固定比例/圆角/边距)', () => {
    useStore.setState({ previewVersionById: vi.fn(async () => null) });
    const { container } = render(<GameFrame version={null} />);
    const stage = container.firstElementChild as HTMLElement;
    const frame = stage.firstElementChild as HTMLElement;
    expect(stage.className).not.toContain('py-2');
    expect(frame.style.aspectRatio).toBe('');
    expect(frame.className).toContain('h-full');
    expect(frame.className).toContain('w-full');
    expect(frame.className).not.toContain('rounded');
  });

  it('宽度封顶舞台高 × 16/9:两栏下预览列不再限宽,超宽时信箱化而不是横向拉伸', () => {
    useStore.setState({ previewVersionById: vi.fn(async () => null) });
    const { container } = render(<GameFrame version={null} />);
    const stage = container.firstElementChild as HTMLElement;
    const frame = stage.firstElementChild as HTMLElement;
    // jsdom 不算布局,只钉住约束本身:舞台是 size 容器且居中,框以 cqh 封顶
    expect(stage.className).toContain('[container-type:size]');
    expect(stage.className).toContain('justify-center');
    expect(frame.className).toContain('max-w-[calc(100cqh*16/9)]');
  });

  // 设备档(spec 2026-10-19-preview-mobile-device)
  it('移动档:竖屏 282:519 圆角框,宽取 min(舞台宽, 舞台高 × 282/519),舞台补内边距', () => {
    useStore.setState({ previewVersionById: vi.fn(async () => null) });
    const { container } = render(<GameFrame version={null} device="mobile" />);
    const stage = container.firstElementChild as HTMLElement;
    const frame = stage.firstElementChild as HTMLElement;
    expect(stage.getAttribute('data-device')).toBe('mobile');
    expect(stage.className).toContain('p-3');
    expect(frame.className).toContain('aspect-[282/519]');
    expect(frame.className).toContain('w-[min(100%,calc(100cqh*282/519))]');
    expect(frame.className).toContain('rounded-[10px]');
    expect(frame.className).not.toContain('max-w-[calc(100cqh*16/9)]');
  });

  it('切换设备档不重建 iframe:游戏运行态保活,只换外框尺寸', async () => {
    const version: Version = {
      id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: true,
      status: 'ready', assetKeys: [], game: { title: '', palette: '' },
    };
    useStore.setState({ previewVersionById: vi.fn(async () => 'https://pgc.local/preview/v1/index.html') });
    const { container, rerender } = render(<GameFrame version={version} device="desktop" />);
    await act(async () => {});
    const before = container.querySelector('iframe');
    expect(before).not.toBeNull();

    rerender(<GameFrame version={version} device="mobile" />);
    const after = container.querySelector('iframe');
    expect(after).toBe(before);
    expect(after!.parentElement!.className).toContain('aspect-[282/519]');
  });
});
