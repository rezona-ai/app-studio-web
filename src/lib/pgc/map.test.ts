import { afterEach, describe, expect, test, vi } from 'vitest';
import { canvasItemToAsset, canvasItemsToAssets, assetReference, versionToVersion, versionCreditsMap } from './map';
import type { CanvasItemData, VersionData } from './types';
import type { Asset } from '@/store/types';
import { fallbackGridPosition } from '@/lib/card-layout';

afterEach(() => vi.unstubAllEnvs());

describe('canvasItemToAsset', () => {
  // 后端 canvas.py 的 CanvasItemData.created_at 是必填(建卡时间,UTC tz-aware),
  // 其字段注释写明就是为「列表按时间排序」加的 —— 前端此前契约层漏了这一行
  test('created_at 映射到 Asset.createdAt', () => {
    const it: CanvasItemData = {
      id: 9, item_id: 'img-9', type: 'image', status: 'ready', url: null,
      created_at: '2026-08-08T03:04:05Z',
    };
    expect(canvasItemToAsset(it).createdAt).toBe('2026-08-08T03:04:05Z');
  });

  test('model3d → 3d;status ready;坐标取自 reference.position', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://h');
    const it: CanvasItemData = {
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'm3d-1', type: 'model3d', name: '宝箱', url: '/preview/42/canvas/a.glb',
      status: 'ready', reference: { position: { x: 10, y: 20 } },
    };
    const a = canvasItemToAsset(it);
    expect(a.kind).toBe('3d');
    expect(a.id).toBe('m3d-1');
    expect(a.label).toBe('宝箱');
    expect(a.status).toBe('ready');
    expect(a.position).toEqual({ x: 10, y: 20 });
    expect(a.preview?.src).toBe('http://h/game/pgcserver/preview/42/canvas/a.glb');
  });

  test('generating → status generating;无 reference → 位置 0', () => {
    const it: CanvasItemData = { id: 2, created_at: '2026-08-08T00:00:00Z', item_id: 'vid-1', type: 'video', status: 'generating', url: null };
    const a = canvasItemToAsset(it);
    expect(a.kind).toBe('video');
    expect(a.status).toBe('generating');
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.preview).toBeUndefined();
  });

  test('failed → status error', () => {
    const it: CanvasItemData = { id: 3, created_at: '2026-08-08T00:00:00Z', item_id: 'm3d-2', type: 'model3d', status: 'failed' };
    expect(canvasItemToAsset(it).status).toBe('error');
  });

  test('audio → audio(守护:不可兜底成 image)', () => {
    const it: CanvasItemData = { id: 4, created_at: '2026-08-08T00:00:00Z', item_id: 'aud-1', type: 'audio', status: 'ready', url: '/preview/42/canvas/a.mp3' };
    expect(canvasItemToAsset(it).kind).toBe('audio');
  });

  test('type=text 映射为 kind text', () => {
    const a = canvasItemToAsset({ id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'i1', type: 'text', status: 'ready', name: 'n', url: '/preview/1/canvas/n.md' } as CanvasItemData);
    expect(a.kind).toBe('text');
  });

  test('文本 item 的 content 内联写入 preview.text', () => {
    const a = canvasItemToAsset({ id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 't1', type: 'text', status: 'ready', content: '# hi', text_format: 'markdown' } as CanvasItemData);
    expect(a.kind).toBe('text');
    expect(a.preview).toEqual({ text: '# hi' });
  });

  test('thumbnail_url 归一为 preview.poster(3D 缩略图 sidecar,海报态快照)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://h');
    const it: CanvasItemData = {
      id: 9, created_at: '2026-08-08T00:00:00Z', item_id: 'm3d-9', type: 'model3d', status: 'ready',
      url: '/preview/42/canvas/a.glb', thumbnail_url: '/preview/42/canvas/a.png',
    };
    const a = canvasItemToAsset(it);
    expect(a.preview?.poster).toBe('http://h/game/pgcserver/preview/42/canvas/a.png');
    expect(a.preview?.src).toBe('http://h/game/pgcserver/preview/42/canvas/a.glb');
  });

  test('无 thumbnail_url 时 preview 不带 poster', () => {
    const a = canvasItemToAsset({ id: 9, created_at: '2026-08-08T00:00:00Z', item_id: 'i9', type: 'image', status: 'ready', url: 'https://x/y.png' } as CanvasItemData);
    expect(a.preview?.poster).toBeUndefined();
  });

  test('content 为 null 时 preview 不带 text(维持原行为)', () => {
    const a = canvasItemToAsset({ id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'i1', type: 'image', status: 'ready', url: 'https://x/y.png', content: null } as CanvasItemData);
    expect(a.preview?.text).toBeUndefined();
    expect(a.preview?.src).toBeTruthy();
  });
});

describe('canvasItemToAsset 引用连线', () => {
  const base: CanvasItemData = { id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'i1', type: 'image', status: 'ready' };
  test('reference.parent_id → parentId 且 source=derived', () => {
    const a = canvasItemToAsset({ ...base, reference: { parent_id: 'p1' } });
    expect(a.parentId).toBe('p1');
    expect(a.source).toBe('derived');
  });
  test('无 parent_id → parentId undefined 且 source=generated', () => {
    const a = canvasItemToAsset({ ...base });
    expect(a.parentId).toBeUndefined();
    expect(a.source).toBe('generated');
  });
  test('rig3d + reference.links → 3d 动画资产、父子连线与 failure', () => {
    const failure = { code: 'RIG_FAILED', category: 'provider', message: '失败', retryable: true };
    const a = canvasItemToAsset({
      id: 2, created_at: '2026-08-08T00:00:00Z', item_id: 'rig-task', type: 'rig3d', status: 'failed', failure,
      reference: { links: [{ to: 'm3d-source', kind: 'rigged_from' }] },
      metadata: { rig: { animations: ['preset:walk', 'preset:idle'] } },
    });
    expect(a).toMatchObject({ kind: '3d', threeDType: 'rig3d', rigAnimations: ['preset:walk', 'preset:idle'], parentId: 'm3d-source', source: 'derived', failure });
    expect(assetReference(a).links).toEqual([{ to: 'm3d-source', kind: 'rigged_from' }]);
  });

  test('非法 rig metadata 不进入 Asset', () => {
    const a = canvasItemToAsset({
      id: 3, created_at: '2026-08-08T00:00:00Z', item_id: 'rig-bad', type: 'rig3d', status: 'ready',
      metadata: { rig: { animations: ['walk', 7] } },
    });
    expect(a.rigAnimations).toBeUndefined();
  });
});

describe('assetReference', () => {
  test('合并 position + parent_id + source_filename', () => {
    const a: Asset = { id: 'c1', key: 'c1', label: 'x', kind: 'image', source: 'derived', status: 'ready', position: { x: 1, y: 2 }, parentId: 'p1', sourceFilename: 'hero.png' };
    // objectContaining:本例关注的是这三项合并,source/provenance 等其余字段各有专测,不在此处重复约束
    expect(assetReference(a)).toMatchObject({ position: { x: 1, y: 2 }, parent_id: 'p1', source_filename: 'hero.png' });
  });
  test('无 parent_id/source_filename 时不带这两项', () => {
    const a: Asset = { id: 'c2', key: 'c2', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 3, y: 4 } };
    const ref = assetReference(a);
    expect(ref).toMatchObject({ position: { x: 3, y: 4 } });
    expect(ref).not.toHaveProperty('parent_id');
    expect(ref).not.toHaveProperty('source_filename');
  });

  test('reference.ref_item_ids 读写往返', () => {
    const it = {
      item_id: 'i1', type: 'image', status: 'ready', url: null, name: 'n',
      reference: { position: { x: 1, y: 2 }, ref_item_ids: ['r1', 'r2'] },
    } as unknown as CanvasItemData;
    const asset = canvasItemToAsset(it);
    expect(asset.refIds).toEqual(['r1', 'r2']);
    expect(assetReference(asset).ref_item_ids).toEqual(['r1', 'r2']);
  });

  test('无 refIds 时 reference 不带 ref_item_ids 键', () => {
    const asset = canvasItemToAsset({
      item_id: 'i2', type: 'image', status: 'ready', url: null, name: 'n', reference: {},
    } as unknown as CanvasItemData);
    expect(asset.refIds).toBeUndefined();
    expect('ref_item_ids' in assetReference(asset)).toBe(false);
  });
});

describe('versionToVersion', () => {
  test('映射 version_id/seq/title/is_current', () => {
    const v: VersionData = { version_id: 'v2', seq: 2, title: '重制版', status: 'ready', is_current: true, created_at: '2026-06-01T00:00:00Z' };
    const out = versionToVersion(v);
    expect(out.id).toBe('v2');
    expect(out.index).toBe(2);
    expect(out.label).toBe('重制版');
    expect(out.current).toBe(true);
    expect(out.createdAt).toBe('2026-06-01T00:00:00Z');
  });
  test('status 原样带上(发布前预检「已 build」要用)', () => {
    const ready: VersionData = { version_id: 'v2', seq: 2, title: 'X', status: 'ready' };
    expect(versionToVersion(ready).status).toBe('ready');
    const building: VersionData = { version_id: 'v3', seq: 3, title: 'Y', status: 'building' };
    const out = versionToVersion(building);
    expect(out.status).toBe('building');
    expect(out.summary).toBe('Building…');
  });
  test('title 为空时回退 Version {seq}', () => {
    const v: VersionData = { version_id: 'v1', seq: 1, title: '', status: 'ready' };
    expect(versionToVersion(v).label).toBe('Version 1');
  });
  test('cover_url 映射为 cover(绝对地址直传)', () => {
    const v: VersionData = { version_id: 'v3', seq: 3, title: 'X', status: 'ready', cover_url: 'https://x/cover.png' };
    expect(versionToVersion(v).cover).toBe('https://x/cover.png');
  });
  test('无 cover_url 时 cover 为 undefined', () => {
    const v: VersionData = { version_id: 'v1', seq: 1, title: '', status: 'ready' };
    expect(versionToVersion(v).cover).toBeUndefined();
  });
});

// 版本消耗积分改由独立端点 /versions/credits 供数(设计稿 2026-08-31-version-credits-breakdown)。
// 段按定稿时刻切,前端只采信 total_credits —— 下面每条都是不可回退的口径。
describe('versionCreditsMap', () => {
  test('正常段按 version_id 收成 total_credits 映射', () => {
    const m = versionCreditsMap([
      { version_id: 'v1', asset_credits: 200, llm_credits: 100, total_credits: 300 },
      { version_id: 'v2', asset_credits: 100, llm_credits: 20, total_credits: 120 },
    ]);
    expect(m).toEqual({ v1: 300, v2: 120 });
  });

  // 后端在计费未启用 / 首创免费额度 / 流水拉不完等情形下把 total 置 null 且**不编数**。
  // 此时回落 asset_credits 等于把「不含对话消费」的数字冒充全量,比不显示更坏。
  test('total_credits 为 null 的段整段丢弃,不回落 asset_credits', () => {
    expect(versionCreditsMap([{ version_id: 'v1', asset_credits: 200, llm_credits: null, total_credits: null }])).toEqual({});
  });
  test('total_credits 缺失同样丢弃', () => {
    expect(versionCreditsMap([{ version_id: 'v1', asset_credits: 200 }])).toEqual({});
  });

  // 末段「在途」:尚未构建成下一版的消费,没有版本行可挂(设计稿决策:不展示)
  test('version_id 为 null 的在途段丢弃,即使 total_credits 有值', () => {
    expect(versionCreditsMap([
      { version_id: 'v1', total_credits: 50 },
      { version_id: null, from: '2026-08-31T00:00:00Z', to: null, total_credits: 999 },
    ])).toEqual({ v1: 50 });
  });

  test('total_credits 为 0 保留(确实没花钱 ≠ 无数据)', () => {
    expect(versionCreditsMap([{ version_id: 'v1', asset_credits: 0, llm_credits: 0, total_credits: 0 }])).toEqual({ v1: 0 });
  });

  test('空 items → 空映射', () => {
    expect(versionCreditsMap([])).toEqual({});
  });
});

describe('canvasItemToAsset 位置优先级', () => {
  const base: CanvasItemData = { id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'i1', type: 'image', status: 'ready' };

  test('reference.position 优先(拖拽权威),即使有 canvas_x/y', () => {
    const a = canvasItemToAsset({ ...base, canvas_x: 5, canvas_y: 6, reference: { position: { x: 30, y: 40 } } });
    expect(a.position).toEqual({ x: 30, y: 40 });
  });
  test('无 reference.position 时退到 canvas_x/canvas_y', () => {
    const a = canvasItemToAsset({ ...base, canvas_x: 100, canvas_y: 110 });
    expect(a.position).toEqual({ x: 100, y: 110 });
  });
  test('都没有时回落 (0,0)', () => {
    const a = canvasItemToAsset({ ...base });
    expect(a.position).toEqual({ x: 0, y: 0 });
  });
  test('读出 reference.source_filename 到 sourceFilename', () => {
    const a = canvasItemToAsset({ ...base, reference: { source_filename: 'hero.png' } });
    expect(a.sourceFilename).toBe('hero.png');
  });
});

describe('canvasItemsToAssets 历史资产兜底网格', () => {
  test('无任何坐标的历史资产:按列表序原点铺兜底网格,已有坐标者不受影响', () => {
    const items: CanvasItemData[] = [
      { id: 0, created_at: '2026-08-08T00:00:00Z', item_id: 'a', type: 'image', name: 'a', status: 'ready', url: null, reference: null },
      { id: 0, created_at: '2026-08-08T00:00:00Z', item_id: 'b', type: 'image', name: 'b', status: 'ready', url: null, reference: { position: { x: 9, y: 9 } } },
      { id: 0, created_at: '2026-08-08T00:00:00Z', item_id: 'c', type: 'image', name: 'c', status: 'ready', url: null, reference: null },
    ];
    const [a, b, c] = canvasItemsToAssets(items);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(b.position).toEqual({ x: 9, y: 9 });
    // 兜底网格第 2 张(b 有坐标不占号):与首张相距一整格,互不重叠(旧实现 40px 对角级联会叠成一摞)
    expect(c.position).toEqual(fallbackGridPosition({ x: 0, y: 0 }, 1));
  });
});

describe('canvasItemsToAssets 过滤 chat_attachment', () => {
  test('canvasItemsToAssets 过滤掉 reference.chat_attachment 的 item', () => {
    const items: CanvasItemData[] = [
      { id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'keep', type: 'image', status: 'ready', url: '/p/a.png', reference: { position: { x: 1, y: 2 } } },
      { id: 2, created_at: '2026-08-08T00:00:00Z', item_id: 'hide', type: 'image', status: 'ready', url: '/p/b.png', reference: { chat_attachment: true } },
    ];
    expect(canvasItemsToAssets(items).map((a) => a.id)).toEqual(['keep']);
  });
});

describe('canvasItemsToAssets 单项容错(不一坏全崩)', () => {
  test('数组混入 null 脏项:跳过坏项,其余资产照常映射', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = [
      { id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'a', type: 'image', status: 'ready', url: null, reference: { position: { x: 1, y: 2 } } },
      null,  // 后端脏数据:整项为 null,访问 it.reference 会抛
      { id: 2, created_at: '2026-08-08T00:00:00Z', item_id: 'b', type: 'image', status: 'ready', url: null, reference: { position: { x: 3, y: 4 } } },
    ] as unknown as CanvasItemData[];
    // 修复前:.map 遇 null 抛 TypeError → 整表失败(assets 一个都进不来 → 整块画布不加载)
    expect(canvasItemsToAssets(items).map((a) => a.id)).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalled();  // 坏项留痕供排查,不静默吞
    warn.mockRestore();
  });
});

// 创作溯源(spec 2026-08-03-canvas-provenance):生成参数落在 reference.provenance。
// ⚠️ assetReference 是从 Asset 已知字段**从头重建**的(未知键一律丢),而它挂在每次坐标回写上 ——
// 所以 provenance 必须走「读入 → 吐回」完整链路,否则用户拖一下卡片就没了
describe('provenance 读写往返', () => {
  const prov = {
    kind: 'image' as const,
    req: { prompt: '一只猫', model: 'gpt-image-2', quality: 'high' },
    at: '2026-08-03T12:00:00.000Z',
  };

  test('canvasItemToAsset 从 reference.provenance 读回', () => {
    const a = canvasItemToAsset({
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready',
      reference: { position: { x: 0, y: 0 }, provenance: prov },
    } as CanvasItemData);
    expect(a.provenance).toEqual(prov);
  });

  test('无 provenance 时为 undefined,不臆造', () => {
    const a = canvasItemToAsset({
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready', reference: { position: { x: 0, y: 0 } },
    } as CanvasItemData);
    expect(a.provenance).toBeUndefined();
  });

  test('assetReference 把 provenance 吐回去——坐标回写不会把它冲掉', () => {
    const asset = {
      id: 'img-1', key: 'img-1', label: 'x', kind: 'image', source: 'generated',
      status: 'ready', position: { x: 7, y: 8 }, provenance: prov,
    } as Asset;
    expect(assetReference(asset)).toMatchObject({ position: { x: 7, y: 8 }, provenance: prov });
  });

  test('往返一致:读进来再吐回去,provenance 逐字节不变', () => {
    const item = {
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready',
      reference: { position: { x: 3, y: 4 }, provenance: prov },
    } as CanvasItemData;
    expect(assetReference(canvasItemToAsset(item)).provenance).toEqual(prov);
  });

  test('后端将来在顶层给 provenance 时优先于 reference(字段缺失即回落,上线自动生效)', () => {
    const backend = { ...prov, req: { ...prov.req, prompt: '后端权威版本' } };
    const a = canvasItemToAsset({
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready',
      reference: { position: { x: 0, y: 0 }, provenance: prov },
      provenance: backend,
    } as CanvasItemData & { provenance: unknown });
    expect(a.provenance).toEqual(backend);
  });

  // agent 判别器(spec 2026-08-06-agent-asset-provenance 成功标准 8):provenanceOf 是**逐字段重建**的白名单,
  // 漏了 agent 就会在每次读回时被静默吃掉 —— 于是 agent 卡按前端口径解析,模型显示成 koubou 别名
  test('agent 判别器经 reference 往返不被吃掉', () => {
    const agentProv = { ...prov, req: { prompt: '一只猫', model: 'gemini-flash-image' }, agent: true as const };
    const a = canvasItemToAsset({
      id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready',
      reference: { position: { x: 0, y: 0 }, provenance: agentProv },
    } as CanvasItemData);
    expect(a.provenance?.agent).toBe(true);
    // 再吐回去仍在:坐标回写不会把判别器冲掉
    expect(assetReference(a).provenance).toEqual(agentProv);
  });

  test('agent 为非严格 true 的脏值(字符串 / 数字 / 对象)时不采信,读回无该键', () => {
    for (const dirty of ['yes', 1, {}] as unknown[]) {
      const a = canvasItemToAsset({
        id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready',
        reference: { position: { x: 0, y: 0 }, provenance: { ...prov, agent: dirty } },
      } as CanvasItemData);
      expect(a.provenance).toBeDefined();
      expect(a.provenance).not.toHaveProperty('agent');
    }
  });
});

// 整表替换赶在 fire-and-forget 回写之前(run.finished 后台 loadCanvas)时,服务端那份 reference 还没有
// provenance —— 直取服务端会让刚落卡的溯源消失。与坐标 / 血缘 / 归属同款的「仅服务端缺失时取本地」
// (spec 2026-08-06-agent-asset-provenance 成功标准 7;异步 agent 路径最容易撞上)
describe('canvasItemsToAssets 保留前端所有的 provenance', () => {
  const prov = { kind: 'image' as const, req: { prompt: 'x' }, at: '2026-08-06T00:00:00.000Z', agent: true as const };
  const local = {
    id: 'img-1', key: 'img-1', label: 'x', kind: 'image', source: 'generated',
    status: 'ready', position: { x: 5, y: 6 }, provenance: prov,
  } as Asset;
  const item = (ref: Record<string, unknown>): CanvasItemData => ({
    id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready', canvas_x: 5, canvas_y: 6, reference: ref,
  } as CanvasItemData);

  test('服务端 reference 无 provenance 而本地有 → 保留本地那份', () => {
    const [a] = canvasItemsToAssets([item({ position: { x: 5, y: 6 } })], [local]);
    expect(a.provenance).toEqual(prov);
  });

  test('服务端 reference 有 provenance → 以服务端为准,本地旧值不得挡住新值', () => {
    const server = { kind: 'image' as const, req: { prompt: '服务端权威' }, at: '2026-08-06T01:00:00.000Z' };
    const [a] = canvasItemsToAssets([item({ position: { x: 5, y: 6 }, provenance: server })], [local]);
    expect(a.provenance).toEqual(server);
  });

  // 保留条件必须对着「mapped 的最终来源」判,不能只看 reference:provenanceOf 读的是
  // 顶层 ?? reference 两个来源。只看 reference 会让后端将来上线的顶层字段被本地旧值盖掉,
  // 与 map.test.ts 既有那条「顶层优先,上线自动生效」自相矛盾(评审 Important 1)
  test('服务端在顶层给 provenance + 本地有旧值 → 取服务端那份', () => {
    const top = { kind: 'image' as const, req: { prompt: '服务端顶层权威' }, at: '2026-08-06T02:00:00.000Z' };
    const it = { ...item({ position: { x: 5, y: 6 } }), provenance: top } as CanvasItemData & { provenance: unknown };
    const [a] = canvasItemsToAssets([it], [local]);
    expect(a.provenance).toEqual(top);
  });

  test('两边都无 → 仍是 undefined,不造空对象', () => {
    const bare = { ...local, provenance: undefined } as Asset;
    const [a] = canvasItemsToAssets([item({ position: { x: 5, y: 6 } })], [bare]);
    expect(a.provenance).toBeUndefined();
  });
});

// source 此前从不持久化,每次 loadCanvas 都现推 parentId ? 'derived' : 'generated' ——
// 于是上传的图片、手写的便签刷新后统统变成「生成」。以前没人显示这个字段所以没露馅,
// 属性面板把它摆上台面后就成了明摆着的错(spec 2026-08-03-canvas-provenance)
describe('source 读写往返', () => {
  const item = (over: Partial<CanvasItemData> = {}): CanvasItemData => ({
    id: 1, created_at: '2026-08-08T00:00:00Z', item_id: 'x-1', type: 'image', status: 'ready',
    reference: { position: { x: 0, y: 0 } }, ...over,
  });

  test('reference.source 优先于「按 parentId 现推」', () => {
    const a = canvasItemToAsset(item({ reference: { position: { x: 0, y: 0 }, source: 'uploaded' } }));
    expect(a.source).toBe('uploaded');
  });

  test('缺 source 时沿用旧推导(历史资产不回归)', () => {
    expect(canvasItemToAsset(item()).source).toBe('generated');
    expect(canvasItemToAsset(item({ reference: { position: { x: 0, y: 0 }, parent_id: 'p1' } })).source).toBe('derived');
  });

  // 导入卡的 source 是前端在建卡那一刻定的(reference / uploaded),靠后端原样回显才活得下来。
  // 整表刷新(run.finished 后台 loadCanvas / 切走再切回)时若服务端那份没带上,mapped 会现推成
  // generated —— 面板退回「Generated」,用户拖一下卡 assetReference 再把这个错值固化进服务端。
  // 与同函数里 position/parentId/refIds/provenance 的兜底同款(终审 M1)
  test('服务端漏回显 source 时保住本地那份(导入卡刷新后不退回 generated)', () => {
    const local = { id: 'x-1', key: 'x-1', label: 'x', kind: 'image', source: 'reference', status: 'ready', position: { x: 5, y: 6 } } as Asset;
    const [a] = canvasItemsToAssets([item({ reference: { position: { x: 5, y: 6 } } })], [local]);
    expect(a.source).toBe('reference');
  });

  test('服务端回显了 source:以服务端为准(本地旧值不挡新值)', () => {
    const local = { id: 'x-1', key: 'x-1', label: 'x', kind: 'image', source: 'reference', status: 'ready', position: { x: 5, y: 6 } } as Asset;
    const [a] = canvasItemsToAssets([item({ reference: { position: { x: 5, y: 6 }, source: 'manual' } })], [local]);
    expect(a.source).toBe('manual');
  });

  test('血缘的 derived 优先于本地兜底(按 parentId 现推,与回没回显无关)', () => {
    const local = { id: 'x-1', key: 'x-1', label: 'x', kind: 'image', source: 'reference', status: 'ready', position: { x: 5, y: 6 } } as Asset;
    const [a] = canvasItemsToAssets([item({ reference: { position: { x: 5, y: 6 }, parent_id: 'p1' } })], [local]);
    expect(a.source).toBe('derived');
  });

  test('assetReference 把 source 吐回去', () => {
    const asset = {
      id: 'x-1', key: 'x-1', label: 'x', kind: 'text', source: 'manual',
      status: 'ready', position: { x: 1, y: 2 },
    } as Asset;
    expect(assetReference(asset)).toMatchObject({ source: 'manual' });
  });

  test('往返一致:手写便签刷新后仍是「手动创建」而非「生成」', () => {
    const asset = {
      id: 't-1', key: 't-1', label: '便签', kind: 'text', source: 'manual',
      status: 'ready', position: { x: 0, y: 0 },
    } as Asset;
    const roundTripped = canvasItemToAsset(item({ item_id: 't-1', type: 'text', reference: assetReference(asset) }));
    expect(roundTripped.source).toBe('manual');
  });

  test('非法 source 不采信,回落推导', () => {
    const a = canvasItemToAsset(item({ reference: { position: { x: 0, y: 0 }, source: '乱写的' } }));
    expect(a.source).toBe('generated');
  });
});

// seq:服务端数字主键(自增),列表视图按它排「创建顺序」。
// created_at 后来也进了契约,但它给的是**刻度**(相对时间 / 按天分组),顺序仍用 seq ——
// 两者语义重叠,不做成第二个排序维度(spec 2026-08-08-canvas-time-dimension)
describe('seq(创建顺序)', () => {
  test('从 it.id 读入', () => {
    const a = canvasItemToAsset({
      id: 42, created_at: '2026-08-08T00:00:00Z', item_id: 'img-1', type: 'image', status: 'ready', reference: { position: { x: 0, y: 0 } },
    } as CanvasItemData);
    expect(a.seq).toBe(42);
  });

  test('不进 assetReference —— 服务端自有主键,回写无意义', () => {
    const asset = {
      id: 'img-1', key: 'img-1', label: 'x', kind: 'image', source: 'generated',
      status: 'ready', position: { x: 0, y: 0 }, seq: 42,
    } as Asset;
    expect(assetReference(asset)).not.toHaveProperty('seq');
  });
});
