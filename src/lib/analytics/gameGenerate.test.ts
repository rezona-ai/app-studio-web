import { describe, it, expect } from 'vitest';
import { gameFailReason, pickNewVersion, runDurationMs } from './gameGenerate';
import type { ServerEvent } from '@/koubou/protocol';
import type { Version } from '@/store/types';

const ev = (type: string, payload: Record<string, unknown> = {}): ServerEvent =>
  ({ type, session_id: 's', payload } as ServerEvent);
const ver = (id: string, index: number): Version =>
  ({ id, index, label: '', summary: '', createdAt: '', current: false, status: 'ready', assetKeys: [], game: { title: '', palette: '' } });

describe('gameFailReason', () => {
  it('build.failed / interrupted → build_error', () => {
    expect(gameFailReason(ev('build.failed'))).toBe('build_error');
    expect(gameFailReason(ev('run.interrupted'))).toBe('build_error');
  });
  it('run.finished 带 error → 按 message 映射,否则 server_error', () => {
    expect(gameFailReason(ev('run.finished', { error: { message: 'insufficient credit' } }))).toBe('insufficient_credit');
    expect(gameFailReason(ev('run.finished', { error: { type: 'OrphanedRun' } }))).toBe('server_error');
  });
});

describe('pickNewVersion', () => {
  it('返回 after 中不在 beforeIds 的版本', () => {
    expect(pickNewVersion(['v1'], [ver('v1', 1), ver('v2', 2)])?.id).toBe('v2');
  });
  it('无新增 → undefined', () => {
    expect(pickNewVersion(['v1', 'v2'], [ver('v1', 1), ver('v2', 2)])).toBeUndefined();
  });
});

describe('runDurationMs', () => {
  it('两端 ISO 相减得 ms;任一缺失 → 0', () => {
    expect(runDurationMs('2026-07-09T00:00:00.000Z', '2026-07-09T00:00:03.000Z')).toBe(3000);
    expect(runDurationMs(null, '2026-07-09T00:00:03.000Z')).toBe(0);
    expect(runDurationMs('2026-07-09T00:00:00.000Z', null)).toBe(0);
  });
});
