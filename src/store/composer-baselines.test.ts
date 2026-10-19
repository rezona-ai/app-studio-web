import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './index';

describe('composer.baseLines', () => {
  beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 } }));

  it('默认 2,可经 composerSet 更新', () => {
    expect(useStore.getState().composer.baseLines).toBe(2);
    useStore.getState().composerSet({ baseLines: 5 });
    expect(useStore.getState().composer.baseLines).toBe(5);
  });

  it('resetComposer 清草稿但保留 baseLines', () => {
    useStore.getState().composerSet({ draft: 'x', baseLines: 4 });
    useStore.getState().resetComposer();
    const c = useStore.getState().composer;
    expect(c.draft).toBe('');
    expect(c.baseLines).toBe(4);
  });
});
