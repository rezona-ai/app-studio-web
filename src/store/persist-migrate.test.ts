import { expect, test } from 'vitest';
import { migratePersistedState } from './index';

// v3(spec 2026-10-19 第二阶段):画布退役后无读方的五个键在迁移时删掉,其余原样保留
const RETIRED = { visibleKinds: ['image'], alignEnabled: false, listOpen: true, listWidth: 320, viewportByProject: { '1': { x: 0, y: 0, zoom: 1 } } };

test('v2 快照:五个画布键被删,其余字段原样保留', () => {
  const out = migratePersistedState({ ...RETIRED, currentProjectId: 7, selectedModel: 'm' }, 2) as Record<string, unknown>;
  for (const k of Object.keys(RETIRED)) expect(out).not.toHaveProperty(k);
  expect(out).toMatchObject({ currentProjectId: 7, selectedModel: 'm' });
});

test('更老的快照(v0)同样清理', () => {
  const out = migratePersistedState({ ...RETIRED }, 0) as Record<string, unknown>;
  expect(Object.keys(out)).toEqual([]);
});

test('已是 v3 的快照不动', () => {
  const snap = { listOpen: true };
  expect(migratePersistedState(snap, 3)).toEqual({ listOpen: true });
});

test('残缺快照(非对象)原样返回不抛错', () => {
  expect(migratePersistedState(null, 0)).toBeNull();
  expect(migratePersistedState({}, 0)).toEqual({});
});
