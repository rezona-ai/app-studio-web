import { describe, it, expect, beforeEach, vi } from 'vitest';
import { track, setUserId } from './gtag';
import { initFromPage } from './context';
import { useStore } from '@/store';

describe('gtag.track', () => {
  beforeEach(() => {
    initFromPage('');
    useStore.setState({ projects: [], currentProjectId: null, userInfo: null });
    delete (window as unknown as { gtag?: unknown }).gtag;
  });
  it('无 gtag 时静默 no-op,不抛错', () => {
    expect(() => track('page_view', {})).not.toThrow();
  });
  it('有 gtag 时:合并公共参数 + 专有参数发出 event', () => {
    const spy = vi.fn();
    (window as unknown as { gtag: typeof spy }).gtag = spy;
    track('model_switch', { model_from: 'a', model_to: 'b' });
    expect(spy).toHaveBeenCalledWith('event', 'model_switch',
      expect.objectContaining({ product: 'gamestudio', page_name: 'editor', model_from: 'a', model_to: 'b' }));
  });
  it('setUserId(null) 发 gtag set user_id=null;数值转字符串', () => {
    const spy = vi.fn();
    (window as unknown as { gtag: typeof spy }).gtag = spy;
    setUserId(null); expect(spy).toHaveBeenCalledWith('set', { user_id: null });
    setUserId(42); expect(spy).toHaveBeenCalledWith('set', { user_id: '42' });
  });
});
