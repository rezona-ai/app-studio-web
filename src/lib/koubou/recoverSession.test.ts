import { describe, expect, test, vi } from 'vitest';
import { resolveSession } from './recoverSession';
import type { SessionSummary } from './client';

// created==updated 表示空会话(从未产生消息/run);传 updated 不同则表示有活动
function summary(id: string, created = 't0', updated?: string): SessionSummary {
  return { session_id: id, project_id: 'p1', status: 'ready', title: null, active_run_id: null, created_at: created, updated_at: updated ?? created };
}

describe('resolveSession', () => {
  test('本地有 sessionId → 信任本地续传,不查后端', async () => {
    const listSessions = vi.fn();
    const r = await resolveSession({ sessionId: 'local-1', lastSequence: 7 }, listSessions);
    expect(r).toEqual({ sessionId: 'local-1', afterSequence: 7 });
    expect(listSessions).not.toHaveBeenCalled();
  });

  test('本地无 → 取后端最近一条有活动的会话,冷加载全量(afterSequence=null)', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      async () => [summary('sess-new', 't1', 't2'), summary('sess-old', 't0', 't0')],
    );
    expect(r).toEqual({ sessionId: 'sess-new', afterSequence: null });
  });

  test('最新是空会话(created==updated)→ 跳过,取最近一条有对话的会话(规避空会话遮蔽)', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      // 倒序:空会话在前,有活动的在后(更早 updated 但有历史)
      async () => [summary('empty', 't5', 't5'), summary('has-history', 't1', 't3')],
    );
    expect(r.sessionId).toBe('has-history');
  });

  test('全是空会话 → 回退 data[0](严格不劣于直接取 data[0])', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      async () => [summary('empty-new', 't5', 't5'), summary('empty-old', 't1', 't1')],
    );
    expect(r.sessionId).toBe('empty-new');
  });

  test('本地无且后端无会话 → 新建(sessionId=null)', async () => {
    const r = await resolveSession({ sessionId: null, lastSequence: 0 }, async () => []);
    expect(r).toEqual({ sessionId: null, afterSequence: null });
  });

  test('本地无且查询抛错 → 回退新建,永不更差', async () => {
    const r = await resolveSession({ sessionId: null, lastSequence: 0 }, async () => { throw new Error('网络错误'); });
    expect(r).toEqual({ sessionId: null, afterSequence: null });
  });

  // —— backend 匹配(codex 接入):backend 建会话时固定,恢复错 backend 的会话会导致渲染器错配 ——

  test('只挑 backend 匹配的会话', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      async () => [
        { ...summary('cc-new', 't5', 't6'), backend: 'cc' },
        { ...summary('codex-old', 't1', 't2'), backend: 'codex' },
      ],
      'codex',
    );
    expect(r.sessionId).toBe('codex-old');
  });

  test('目标 backend 无会话 → 新建(不退化到别的 backend)', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      async () => [{ ...summary('cc-only', 't1', 't2'), backend: 'cc' }],
      'codex',
    );
    expect(r).toEqual({ sessionId: null, afterSequence: null });
  });

  test('缺 backend 字段的老会话视作 cc', async () => {
    const r = await resolveSession(
      { sessionId: null, lastSequence: 0 },
      async () => [summary('legacy', 't1', 't2')],
      'cc',
    );
    expect(r.sessionId).toBe('legacy');
  });
});
