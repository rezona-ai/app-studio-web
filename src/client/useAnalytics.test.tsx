import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { useAnalytics } from './useAnalytics';
import { useStore } from '@/store';

const track = vi.fn();
const setUserId = vi.fn();
vi.mock('@/lib/analytics/gtag', () => ({
  track: (...a: unknown[]) => track(...a),
  setUserId: (...a: unknown[]) => setUserId(...a),
}));

function Probe() { useAnalytics(); return null; }

describe('useAnalytics', () => {
  beforeEach(() => { track.mockClear(); setUserId.mockClear(); useStore.setState({ userInfo: null }); });

  it('挂载只发一次 page_view(含 StrictMode 双挂载)', () => {
    render(<StrictMode><Probe /></StrictMode>);
    expect(track.mock.calls.filter((c) => c[0] === 'page_view')).toHaveLength(1);
  });

  it('userInfo 到达 → setUserId(id)', () => {
    const { rerender } = render(<Probe />);
    useStore.setState({ userInfo: { id: 9, username: 'n' } });
    rerender(<Probe />);
    expect(setUserId).toHaveBeenCalledWith(9);
  });
});
