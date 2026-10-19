import { describe, expect, test } from 'vitest';
import { GET as healthz } from './healthz/route';
import { GET as readyz } from './readyz/route';

// 健康端点必须：返回 200、JSON body、且不依赖上游（这里不 mock 任何 fetch，直接调用即应 200，
// 证明它们不打 pgc/koubou——否则会因无网络/无 env 抛错或非 200）。
describe('健康检查端点', () => {
  test('healthz 返回 200 {ok:true}，不依赖上游', async () => {
    const res = await healthz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('readyz 返回 200 {ok:true,status:ready}，不依赖上游', async () => {
    const res = await readyz();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'ready' });
  });
});
