# pgc-server REST API 集成 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 pgc-server 的项目/画布/版本 REST API 接入前端，以服务端为唯一真实源，经 Next 服务端代理鉴权。

**Architecture:** 三层——浏览器 `src/lib/pgc`（typed client + 映射）→ 同源 `/api/pgc/*` Next route handler → `src/server/pgc`（token 缓存 + 自动登录 + 转发）→ pgc-server。Zustand store 扩展异步 actions 承载三个域；媒体 img/video/iframe 直连 pgc，GLB/ZIP 走代理。

**Tech Stack:** Next 16（App Router route handler + 自定义 server.ts）、React 19、Zustand 5、vitest（jsdom）。

设计文档：`docs/superpowers/specs/2026-06-08-pgc-server-api-integration-design.md`

**关键约定（实现时反复参照）：**
- 信封 `{ success, code, message, data, request_id }`；失败用字符串 `code`。
- 画布资产**一律以 `item.status` 为准**（ready/generating/failed）。
- 后端 `type` `image|video|model3d` ↔ 前端 `kind` `image|video|3d`。
- 画布坐标存进 `reference.position`（后端本期不开放写 `canvas_x/y`）。
- 测试用 vitest globals（`describe/test/expect/vi`），无需 import。

---

## Phase 1：浏览器 client 层（`src/lib/pgc`）

### Task 1：类型镜像 + .env 配置

**Files:**
- Create: `src/lib/pgc/types.ts`
- Modify: `.env.example`

- [ ] **Step 1: 写类型文件**（纯类型，无测试）

`src/lib/pgc/types.ts`:

```ts
// pgc-server OpenAPI 的 TS 镜像子集(前端用)

export interface ApiResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data: T | null;
  request_id?: string;
}

export interface ProjectData {
  id: number;
  name: string;
  cover_url: string | null;
  current_version_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface ProjectListData { items: ProjectData[]; total: number; page: number; page_size: number; }

export interface CanvasItemData {
  id: number;
  item_id: string;
  type: string;            // image | video | model3d
  name?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  status: string;          // ready | generating | failed
  reference?: unknown | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
}
export interface CanvasItemListData { items: CanvasItemData[]; total: number; }
export interface CanvasGenTask { task_id: string; status: string; progress?: number | null; item?: CanvasItemData | null; }

export interface VersionData {
  version_id: string;
  seq: number;
  title: string;
  status: string;          // 时间线恒 ready;新建占位 building
  preview_url?: string | null;
  source_version_id?: string | null;
  created_at?: string | null;
  is_current?: boolean;
}
export interface VersionListData { items: VersionData[]; total: number; }
export interface CreateVersionData { version_id: string; status: string; }

export interface UserData { id: number; email: string; name: string; }
export interface TokenData { access_token: string; token_type?: string; }

// 请求体
export interface CreateProjectRequest { name: string; }
export interface UpdateProjectRequest { name?: string | null; cover_url?: string | null; current_version_id?: string | null; }
export interface CanvasGenImageRequest { prompt: string; size?: string; quality?: string; n?: number; source_item_id?: string | null; }
export interface CanvasGenVideoRequest { prompt: string; model?: string | null; source_item_id?: string | null; }
export interface CanvasGenModel3DRequest { prompt: string; source_item_id?: string | null; }
export interface CanvasUpdateRequest { reference?: unknown | null; }
```

- [ ] **Step 2: 补 .env.example**

把 `.env.example` 内容改为：

```
PORT=3000

# pgc-server 对接(服务端)
PGC_BASE_URL=http://8.233.87.67
PGC_EMAIL=
PGC_PASSWORD=
# 前端媒体直连用(可与 PGC_BASE_URL 同值)
NEXT_PUBLIC_PGC_BASE_URL=http://8.233.87.67
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/pgc/types.ts .env.example
git commit -m "pgc 集成:新增 REST 类型镜像与 .env 配置项"
```

---

### Task 2：媒体 URL 解析 `url.ts`

**Files:**
- Create: `src/lib/pgc/url.ts`
- Test: `src/lib/pgc/url.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/pgc/url.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveAssetUrl } from './url';

afterEach(() => vi.unstubAllEnvs());

describe('resolveAssetUrl', () => {
  test('null/undefined → undefined', () => {
    expect(resolveAssetUrl(null)).toBeUndefined();
    expect(resolveAssetUrl(undefined)).toBeUndefined();
  });
  test('绝对地址原样返回', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://8.233.87.67');
    expect(resolveAssetUrl('http://x/y.png')).toBe('http://x/y.png');
  });
  test('相对地址补 base 前缀(处理斜杠)', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://8.233.87.67/');
    expect(resolveAssetUrl('/preview/42/canvas/a.png')).toBe('http://8.233.87.67/preview/42/canvas/a.png');
  });
  test('未配置 base 时相对地址原样返回', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', '');
    expect(resolveAssetUrl('/preview/a.png')).toBe('/preview/a.png');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/pgc/url.test.ts`
Expected: FAIL（`resolveAssetUrl` 未定义）

- [ ] **Step 3: 实现**

`src/lib/pgc/url.ts`:

```ts
// 媒体直连:相对 /preview/... 补 pgc 绝对地址前缀(在函数内读 env,便于测试 stub)
export function resolveAssetUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_PGC_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return url;
  return `${base}/${url.replace(/^\//, '')}`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/lib/pgc/url.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/url.ts src/lib/pgc/url.test.ts
git commit -m "pgc 集成:媒体 URL 解析 resolveAssetUrl"
```

---

### Task 3：浏览器 client `client.ts`

**Files:**
- Create: `src/lib/pgc/client.ts`
- Test: `src/lib/pgc/client.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/pgc/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PgcError, pgcApi, uploadCanvasItem, downloadVersion } from './client';

function mockJson(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body), blob: () => Promise.resolve(new Blob()) } as unknown as Response;
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => vi.restoreAllMocks());

describe('pgcApi 信封拆解', () => {
  test('成功返回 data', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 0, page: 1, page_size: 100 } }),
    );
    const d = await pgcApi.listProjects();
    expect(d.total).toBe(0);
  });

  test('GET 列表拼对 URL', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { items: [], total: 0 } }));
    await pgcApi.listCanvasItems(42);
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects/42/canvas/items', expect.objectContaining({ method: 'GET' }));
  });

  test('POST 带 JSON body', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, name: 'a', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' } }));
    await pgcApi.createProject('像素地牢');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/projects', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: '像素地牢' }),
    }));
  });

  test('success=false 抛 PgcError 带 code', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'ARTGEN_DISABLED', message: '未配 key', data: null }, false, 503),
    );
    await expect(pgcApi.genImage(42, { prompt: 'x' })).rejects.toMatchObject({ code: 'ARTGEN_DISABLED', status: 503 });
  });

  test('非 JSON / HTTP 错误抛 PgcError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      { ok: false, status: 500, json: () => Promise.reject(new Error('not json')) } as unknown as Response,
    );
    await expect(pgcApi.listProjects()).rejects.toBeInstanceOf(PgcError);
  });
});

describe('uploadCanvasItem / downloadVersion', () => {
  test('upload 用 FormData,返回 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { id: 1, item_id: 'img-1', type: 'image', status: 'ready' } }));
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const d = await uploadCanvasItem(42, file);
    expect(d.item_id).toBe('img-1');
    const [, init] = f.mock.calls[0];
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  test('download 成功返回 Blob', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({}, true, 200));
    const b = await downloadVersion(42, 'v1');
    expect(b).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/pgc/client.test.ts`
Expected: FAIL（模块未实现）

- [ ] **Step 3: 实现**

`src/lib/pgc/client.ts`:

```ts
import type {
  ApiResponse, ProjectData, ProjectListData, CanvasItemData, CanvasItemListData,
  CanvasGenTask, VersionData, VersionListData, CreateVersionData,
  UpdateProjectRequest, CanvasGenImageRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest,
} from './types';

const PREFIX = '/api/pgc';

export class PgcError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'PgcError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: ApiResponse<T> | null = null;
  try { env = (await res.json()) as ApiResponse<T>; } catch { /* 非 JSON */ }
  if (!res.ok || !env || env.success === false) {
    throw new PgcError(env?.code ?? 'HTTP_ERROR', env?.message ?? `HTTP ${res.status}`, res.status);
  }
  return env.data as T;
}

async function pgc<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return unwrap<T>(await fetch(`${PREFIX}${path}`, init));
}

export const pgcApi = {
  // 项目
  listProjects: (page = 1, pageSize = 100) =>
    pgc<ProjectListData>('GET', `/api/projects?page=${page}&page_size=${pageSize}`),
  createProject: (name: string) => pgc<ProjectData>('POST', '/api/projects', { name }),
  getProject: (id: number) => pgc<ProjectData>('GET', `/api/projects/${id}`),
  updateProject: (id: number, body: UpdateProjectRequest) => pgc<ProjectData>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: number) => pgc<{ id: number }>('DELETE', `/api/projects/${id}`),

  // 画布
  listCanvasItems: (pid: number) => pgc<CanvasItemListData>('GET', `/api/projects/${pid}/canvas/items`),
  updateCanvasReference: (pid: number, itemId: string, reference: unknown) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { reference }),
  deleteCanvasItem: (pid: number, itemId: string) =>
    pgc<CanvasItemData>('DELETE', `/api/projects/${pid}/canvas/items/${itemId}`),
  genImage: (pid: number, body: CanvasGenImageRequest) =>
    pgc<CanvasItemListData>('POST', `/api/projects/${pid}/canvas/items/generate/image`, body),
  genVideo: (pid: number, body: CanvasGenVideoRequest) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/video`, body),
  pollVideo: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/video/${taskId}`),
  genModel3d: (pid: number, body: CanvasGenModel3DRequest) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/model3d`, body),
  pollModel3d: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/model3d/${taskId}`),

  // 版本
  listVersions: (pid: number) => pgc<VersionListData>('GET', `/api/projects/${pid}/versions`),
  createVersion: (pid: number) => pgc<CreateVersionData>('POST', `/api/projects/${pid}/versions`),
  getVersion: (pid: number, vid: string) => pgc<VersionData>('GET', `/api/projects/${pid}/versions/${vid}`),
  previewVersion: (pid: number, vid: string) =>
    pgc<{ preview_url: string }>('GET', `/api/projects/${pid}/versions/${vid}/preview`),
};

// 上传(multipart)
export async function uploadCanvasItem(pid: number, file: File): Promise<CanvasItemData> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${PREFIX}/api/projects/${pid}/canvas/items/upload`, { method: 'POST', body: fd });
  return unwrap<CanvasItemData>(res);
}

// 下载 ZIP(二进制,经代理)
export async function downloadVersion(pid: number, vid: string): Promise<Blob> {
  const res = await fetch(`${PREFIX}/api/projects/${pid}/versions/${vid}/download`);
  if (!res.ok) {
    let env: ApiResponse<unknown> | null = null;
    try { env = await res.json(); } catch { /* */ }
    throw new PgcError(env?.code ?? 'HTTP_ERROR', env?.message ?? `HTTP ${res.status}`, res.status);
  }
  return res.blob();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/lib/pgc/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "pgc 集成:浏览器 client(信封拆解/PgcError/各域方法)"
```

---

### Task 4：数据映射 `map.ts`

**Files:**
- Create: `src/lib/pgc/map.ts`
- Test: `src/lib/pgc/map.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/pgc/map.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { canvasItemToAsset, positionReference, versionToVersion } from './map';
import type { CanvasItemData, VersionData } from './types';

afterEach(() => vi.unstubAllEnvs());

describe('canvasItemToAsset', () => {
  test('model3d → 3d;status ready;坐标取自 reference.position 并 pin', () => {
    vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'http://h');
    const it: CanvasItemData = {
      id: 1, item_id: 'm3d-1', type: 'model3d', name: '宝箱', url: '/preview/42/canvas/a.glb',
      status: 'ready', reference: { position: { x: 10, y: 20 } },
    };
    const a = canvasItemToAsset(it);
    expect(a.kind).toBe('3d');
    expect(a.id).toBe('m3d-1');
    expect(a.label).toBe('宝箱');
    expect(a.status).toBe('ready');
    expect(a.position).toEqual({ x: 10, y: 20 });
    expect(a.pinned).toBe(true);
    expect(a.preview?.src).toBe('http://h/preview/42/canvas/a.glb');
  });

  test('generating → status generating;无 reference → 不 pin、位置 0', () => {
    const it: CanvasItemData = { id: 2, item_id: 'vid-1', type: 'video', status: 'generating', url: null };
    const a = canvasItemToAsset(it);
    expect(a.kind).toBe('video');
    expect(a.status).toBe('generating');
    expect(a.pinned).toBe(false);
    expect(a.position).toEqual({ x: 0, y: 0 });
    expect(a.preview).toBeUndefined();
  });

  test('failed → status error', () => {
    const it: CanvasItemData = { id: 3, item_id: 'm3d-2', type: 'model3d', status: 'failed' };
    expect(canvasItemToAsset(it).status).toBe('error');
  });
});

describe('positionReference', () => {
  test('合并既有 reference,覆盖 position', () => {
    expect(positionReference({ note: 'x' }, { x: 1, y: 2 })).toEqual({ note: 'x', position: { x: 1, y: 2 } });
    expect(positionReference(null, { x: 1, y: 2 })).toEqual({ position: { x: 1, y: 2 } });
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
  test('title 为空时回退 V{seq}', () => {
    const v: VersionData = { version_id: 'v1', seq: 1, title: '', status: 'ready' };
    expect(versionToVersion(v).label).toBe('V1');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/lib/pgc/map.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/lib/pgc/map.ts`:

```ts
import type { CanvasItemData, VersionData } from './types';
import type { Asset, Status, Version } from '@/store/types';
import type { AssetKind } from '@/agent-protocol/messages';
import { resolveAssetUrl } from './url';

const TYPE_TO_KIND: Record<string, AssetKind> = { image: 'image', video: 'video', model3d: '3d' };

function statusOf(s: string): Status {
  if (s === 'ready') return 'ready';
  if (s === 'failed') return 'error';
  return 'generating';
}

export interface CanvasReference {
  position?: { x: number; y: number };
  [k: string]: unknown;
}

export function canvasItemToAsset(it: CanvasItemData): Asset {
  const ref = (it.reference ?? {}) as CanvasReference;
  const hasPos = !!ref.position;
  const src = resolveAssetUrl(it.url);
  return {
    id: it.item_id,
    key: it.item_id,
    label: it.name ?? it.item_id,
    kind: TYPE_TO_KIND[it.type] ?? 'image',
    source: 'generated',
    status: statusOf(it.status),
    position: ref.position ?? { x: 0, y: 0 },
    pinned: hasPos,
    preview: src ? { src } : undefined,
  };
}

export function canvasItemsToAssets(items: CanvasItemData[]): Asset[] {
  return items.map(canvasItemToAsset);
}

// 把 position 合进既有 reference,供 PATCH 回写
export function positionReference(prev: unknown, position: { x: number; y: number }): CanvasReference {
  const base = (prev ?? {}) as CanvasReference;
  return { ...base, position };
}

export function versionToVersion(v: VersionData): Version {
  return {
    id: v.version_id,
    index: v.seq,
    label: v.title || `V${v.seq}`,
    summary: v.status === 'building' ? 'Building…' : '',
    createdAt: v.created_at ?? '',
    current: !!v.is_current,
    assetKeys: [],
    game: { title: v.title || 'GAME', palette: 'neon' },
  };
}

export function versionsToVersions(items: VersionData[]): Version[] {
  return items.map(versionToVersion);
}
```

- [ ] **Step 4: 运行确认通过 + 全量回归**

Run: `pnpm test src/lib/pgc/`
Expected: PASS（url/client/map 全绿）

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "pgc 集成:CanvasItem⇄Asset、Version 映射"
```

---

## Phase 2：服务端代理 + 鉴权（`src/server/pgc`）

### Task 5：token 缓存 + 自动登录 `auth.ts`

**Files:**
- Create: `src/server/pgc/auth.ts`
- Test: `src/server/pgc/auth.test.ts`

- [ ] **Step 1: 写失败测试**

`src/server/pgc/auth.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getToken, invalidateToken, __resetAuthForTest } from './auth';

function loginOk(token: string) {
  return { ok: true, status: 200, json: () => Promise.resolve({ success: true, code: 'OK', message: 'OK', data: { access_token: token } }) } as unknown as Response;
}

beforeEach(() => {
  __resetAuthForTest();
  vi.stubEnv('PGC_BASE_URL', 'http://h');
  vi.stubEnv('PGC_EMAIL', 'a@b.dev');
  vi.stubEnv('PGC_PASSWORD', 'pw');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('getToken', () => {
  test('首次登录并缓存;第二次命中缓存(只 fetch 一次)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(loginOk('T1'));
    expect(await getToken()).toBe('T1');
    expect(await getToken()).toBe('T1');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith('http://h/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  test('invalidate 后重新登录', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(loginOk('T1')).mockResolvedValueOnce(loginOk('T2'));
    expect(await getToken()).toBe('T1');
    invalidateToken();
    expect(await getToken()).toBe('T2');
    expect(f).toHaveBeenCalledTimes(2);
  });

  test('并发去重:同时多次只登录一次', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(loginOk('T1'));
    const [a, b] = await Promise.all([getToken(), getToken()]);
    expect([a, b]).toEqual(['T1', 'T1']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('登录失败抛错', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({ success: false, code: 'INVALID_CREDENTIALS', message: 'x', data: null }) } as unknown as Response);
    await expect(getToken()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/server/pgc/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/server/pgc/auth.ts`:

```ts
// 服务端:pgc token 缓存 + .env 账号自动登录 + 401 失效 + 并发去重
interface Cached { token: string; expiresAt: number; }

let cached: Cached | null = null;
let inflight: Promise<string> | null = null;

const SKEW_MS = 60_000;               // 提前 60s 视为过期
const TTL_MS = 7 * 24 * 3600 * 1000;  // 默认 7 天有效期

function base(): string {
  const b = process.env.PGC_BASE_URL;
  if (!b) throw new Error('PGC_BASE_URL 未配置');
  return b.replace(/\/$/, '');
}

async function login(): Promise<string> {
  const email = process.env.PGC_EMAIL;
  const password = process.env.PGC_PASSWORD;
  if (!email || !password) throw new Error('PGC_EMAIL/PGC_PASSWORD 未配置');
  const res = await fetch(`${base()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const env = (await res.json().catch(() => null)) as { success?: boolean; data?: { access_token?: string } } | null;
  if (!res.ok || !env?.success || !env.data?.access_token) {
    throw new Error(`pgc 登录失败: HTTP ${res.status}`);
  }
  cached = { token: env.data.access_token, expiresAt: Date.now() + TTL_MS - SKEW_MS };
  return cached.token;
}

export async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (inflight) return inflight;
  inflight = login().finally(() => { inflight = null; });
  return inflight;
}

export function invalidateToken(): void {
  cached = null;
}

// 仅测试用:重置内部状态
export function __resetAuthForTest(): void {
  cached = null;
  inflight = null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/server/pgc/auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/pgc/auth.ts src/server/pgc/auth.test.ts
git commit -m "pgc 集成:服务端 token 缓存与自动登录"
```

---

### Task 6：转发 `proxy.ts`（注入 Bearer + 401 重试）

**Files:**
- Create: `src/server/pgc/proxy.ts`
- Test: `src/server/pgc/proxy.test.ts`

- [ ] **Step 1: 写失败测试**

`src/server/pgc/proxy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { proxyFetch } from './proxy';
import { __resetAuthForTest } from './auth';

function loginOk(token: string) {
  return { ok: true, status: 200, json: () => Promise.resolve({ success: true, code: 'OK', message: 'OK', data: { access_token: token } }) } as unknown as Response;
}
function resp(status: number) {
  return { ok: status < 400, status, headers: new Headers(), body: null } as unknown as Response;
}

beforeEach(() => {
  __resetAuthForTest();
  vi.stubEnv('PGC_BASE_URL', 'http://h');
  vi.stubEnv('PGC_EMAIL', 'a@b.dev');
  vi.stubEnv('PGC_PASSWORD', 'pw');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('proxyFetch', () => {
  test('注入 Bearer 并拼 base+path+search', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(loginOk('T1')).mockResolvedValueOnce(resp(200));
    await proxyFetch('GET', '/api/projects', { search: '?page=1' });
    expect(f).toHaveBeenLastCalledWith('http://h/api/projects?page=1', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer T1' }),
    }));
  });

  test('pgc 401 → 失效重登并重试一次', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValueOnce(loginOk('T1'))   // 首次登录
      .mockResolvedValueOnce(resp(401))      // 业务请求 401
      .mockResolvedValueOnce(loginOk('T2'))  // 重登
      .mockResolvedValueOnce(resp(200));     // 重试成功
    const res = await proxyFetch('GET', '/api/projects');
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(4);
    expect(f).toHaveBeenLastCalledWith('http://h/api/projects', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer T2' }),
    }));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/server/pgc/proxy.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

`src/server/pgc/proxy.ts`:

```ts
import { getToken, invalidateToken } from './auth';

function base(): string {
  const b = process.env.PGC_BASE_URL;
  if (!b) throw new Error('PGC_BASE_URL 未配置');
  return b.replace(/\/$/, '');
}

export interface ProxyInit {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
}

// 转发到 pgc,注入 Bearer;pgc 401 → 失效重登并重试一次
export async function proxyFetch(method: string, path: string, init: ProxyInit = {}): Promise<Response> {
  const url = `${base()}${path}${init.search ?? ''}`;
  const doFetch = (token: string) =>
    fetch(url, {
      method,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      body: init.body ?? undefined,
    });

  let res = await doFetch(await getToken());
  if (res.status === 401) {
    invalidateToken();
    res = await doFetch(await getToken());
  }
  return res;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/server/pgc/proxy.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/pgc/proxy.ts src/server/pgc/proxy.test.ts
git commit -m "pgc 集成:服务端转发(注入 Bearer + 401 重试)"
```

---

### Task 7：Next route handler（JSON/ZIP 代理 + GLB 媒体代理）

**Files:**
- Create: `src/app/api/pgc/[...path]/route.ts`
- Create: `src/app/api/pgc/asset/route.ts`

> 说明：route handler 依赖 Next 运行时，不做单测；逻辑已在 `proxy.ts` 覆盖。本任务以 `pnpm build` 通过 + 手动冒烟为验收。

- [ ] **Step 1: 写 catch-all 代理 route**

`src/app/api/pgc/[...path]/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { proxyFetch } from '@/server/pgc/proxy';

export const dynamic = 'force-dynamic';

const PASS_THROUGH = ['content-type', 'content-disposition', 'content-length'];

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = '/' + path.join('/');
  const method = req.method;
  const hasBody = method === 'POST' || method === 'PATCH' || method === 'PUT';

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;

  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined;
  const res = await proxyFetch(method, target, { headers, body, search: req.nextUrl.search });

  const out = new Headers();
  for (const h of PASS_THROUGH) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
```

- [ ] **Step 2: 写 GLB 媒体代理 route**

`src/app/api/pgc/asset/route.ts`:

```ts
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// 仅供 fetch 类媒体(如 GLB)规避跨域;preview 字节无需鉴权
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) return new Response('missing url', { status: 400 });
  const base = (process.env.PGC_BASE_URL ?? '').replace(/\/$/, '');
  const target = /^https?:\/\//i.test(raw) ? raw : `${base}/${raw.replace(/^\//, '')}`;
  const res = await fetch(target);
  const out = new Headers();
  const ct = res.headers.get('content-type');
  if (ct) out.set('content-type', ct);
  return new Response(res.body, { status: res.status, headers: out });
}
```

- [ ] **Step 3: 构建验证**

Run: `pnpm build`
Expected: 构建成功，无类型错误（route handler 编译通过）。

- [ ] **Step 4: 手动冒烟（需 .env 填好 dev 账号）**

```bash
# 终端启动 dev,另开终端 curl 同源代理
pnpm dev   # 略,在 ! 前缀终端运行
curl -s http://localhost:3000/api/pgc/api/projects?page=1 | head -c 300
```
Expected: 返回 `{"success":true,...,"data":{"items":[...]}}` 信封（证明代理 + 自动登录链路通）。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pgc
git commit -m "pgc 集成:Next 代理 route(JSON/ZIP + GLB 媒体)"
```

---

## Phase 3：Zustand store 改造 + 启动/轮询

### Task 8：store 服务端切片与类型

**Files:**
- Modify: `src/store/types.ts`
- Modify: `src/store/index.ts`

> 本任务只加字段与同步 setter，不接异步逻辑（异步 actions 在 Task 9）。

- [ ] **Step 1: 扩展 types.ts**

在 `src/store/types.ts` 末尾追加（保持现有内容不动）：

```ts
import type { ProjectData } from '@/lib/pgc/types';

// 画布异步生成任务(video/model3d)的轮询登记
export interface GenTask { itemId: string; kind: 'video' | 'model3d'; taskId: string; }

// 服务端支撑的数据切片(不进 applyMessage)
export interface ServerState {
  projects: ProjectData[];
  currentProjectId: number | null;
  genTasks: GenTask[];
  pendingVersionId: string | null;     // 已 POST 创建、待 agent 构建完成的版本号
  buildingVersion: Version | null;     // 乐观展示的 building 占位卡
  lastError: { code: string; message: string } | null;
}

export function createInitialServerState(): ServerState {
  return { projects: [], currentProjectId: null, genTasks: [], pendingVersionId: null, buildingVersion: null, lastError: null };
}
```

- [ ] **Step 2: 在 index.ts 接入服务端切片字段（去 SEED 持久化）**

`src/store/index.ts` 修改点：

(a) 顶部 import 增补：

```ts
import { createInitialReducerState, createInitialServerState, type ReducerState, type ServerState, type Version, type Message, type GenTask } from './types';
import type { ProjectData } from '@/lib/pgc/types';
```

(b) `AppStore` 类型加 `ServerState`：

```ts
export type AppStore = ReducerState & ServerState & UIState & Actions;
```

(c) 初始化展开里加入服务端初值（在 `...createInitialReducerState(),` 之后）：

```ts
      ...createInitialServerState(),
```

(d) 持久化白名单改造 —— 把 `partialize` 改为（去掉 assets/versions/activeVersionId，加入 currentProjectId；store name 升到 v4）：

```ts
    {
      name: 'taluna-v4',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        messages: s.messages,
        visibleKinds: s.visibleKinds,
        currentProjectId: s.currentProjectId,
        composer: { draft: s.composer.draft, refs: s.composer.refs, attachments: [] },
      }),
    },
```

- [ ] **Step 3: 在 Actions 接口与实现中加同步 setter**

`Actions` 接口追加：

```ts
  setError: (e: { code: string; message: string } | null) => void;
  setProjects: (projects: ProjectData[]) => void;
  setCurrentProject: (id: number | null) => void;
```

实现（在 `addAsset:` 之后追加）：

```ts
      setError: (lastError) => set({ lastError }),
      setProjects: (projects) => set({ projects }),
      setCurrentProject: (currentProjectId) => set({ currentProjectId }),
```

- [ ] **Step 4: 构建/类型校验**

Run: `pnpm test src/store/ && pnpm lint`
Expected: 现有 store 测试仍全绿，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/index.ts
git commit -m "pgc 集成:store 服务端切片字段 + 去 assets/versions 持久化"
```

---

### Task 9：store 异步 actions（项目/画布/版本）

**Files:**
- Create: `src/store/actions.ts`（异步 thunk 集合，挂到 store）
- Modify: `src/store/index.ts`
- Test: `src/store/actions.test.ts`

> 异步 actions 以 `useStore.getState()`/`setState()` 操作 store，便于在测试里 `vi.mock('@/lib/pgc/client')`。

- [ ] **Step 1: 写失败测试**

`src/store/actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// 保留真实导出(尤其 PgcError 供 instanceof),仅替换 api 方法为 mock
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
      listCanvasItems: vi.fn(), deleteCanvasItem: vi.fn(), genImage: vi.fn(),
      listVersions: vi.fn(), createVersion: vi.fn(),
    },
    uploadCanvasItem: vi.fn(),
    downloadVersion: vi.fn(),
  };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { createInitialReducerState, createInitialServerState } from './types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  useStore.setState({ ...createInitialReducerState(), ...createInitialServerState() });
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('项目 actions', () => {
  test('loadProjects 写入 projects;无当前项目时自动选第一个并拉画布/版本', async () => {
    api.listProjects.mockResolvedValue({ items: [{ id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' }], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().projects).toHaveLength(1);
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(api.listCanvasItems).toHaveBeenCalledWith(7);
  });

  test('createProject 后切到新项目', async () => {
    api.createProject.mockResolvedValue({ id: 9, name: 'New', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().createProject('New');
    expect(useStore.getState().currentProjectId).toBe(9);
    expect(useStore.getState().projects.find((p) => p.id === 9)).toBeTruthy();
  });

  test('deleteProject 移除并切到剩余项目', async () => {
    useStore.setState({ projects: [
      { id: 1, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
      { id: 2, name: 'B', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ], currentProjectId: 1 });
    api.deleteProject.mockResolvedValue({ id: 1 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().deleteProject(1);
    expect(useStore.getState().projects.map((p) => p.id)).toEqual([2]);
    expect(useStore.getState().currentProjectId).toBe(2);
  });

  test('action 抛 PgcError 时写 lastError 不抛出', async () => {
    api.listProjects.mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    await useStore.getState().loadProjects();
    expect(useStore.getState().lastError?.code).toBe('UNAUTHORIZED');
  });
});

describe('画布 actions', () => {
  test('loadCanvas 把服务端项映射进 assets', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'img-1', type: 'image', status: 'ready', url: null }], total: 1 });
    await useStore.getState().loadCanvas();
    expect(useStore.getState().assets.map((a) => a.id)).toEqual(['img-1']);
  });

  test('generateImage 把同步返回的资产并入 assets', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.genImage.mockResolvedValue({ items: [{ id: 1, item_id: 'img-9', type: 'image', status: 'ready', url: '/p/a.png' }], total: 1 });
    await useStore.getState().generateImage({ prompt: '主角立绘' });
    expect(useStore.getState().assets.find((a) => a.id === 'img-9')).toBeTruthy();
  });

  test('deleteCanvasItem 从 assets 移除', async () => {
    useStore.setState({ currentProjectId: 42, assets: [{ id: 'img-1', key: 'img-1', label: 'x', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, pinned: false }] });
    api.deleteCanvasItem.mockResolvedValue({ id: 1, item_id: 'img-1', type: 'image', status: 'deleted' });
    await useStore.getState().deleteCanvasItem('img-1');
    expect(useStore.getState().assets).toHaveLength(0);
  });
});

describe('版本 actions', () => {
  test('loadVersions 映射进 versions,标记 current', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.listVersions.mockResolvedValue({ items: [{ version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true }], total: 1 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().versions[0].id).toBe('v1');
    expect(useStore.getState().activeVersionId).toBe('v1');
  });

  test('publishVersion 创建占位 buildingVersion + pendingVersionId', async () => {
    useStore.setState({ currentProjectId: 42 });
    api.createVersion.mockResolvedValue({ version_id: 'v3', status: 'building' });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().publishVersion();
    expect(useStore.getState().pendingVersionId).toBe('v3');
    expect(useStore.getState().buildingVersion?.id).toBe('v3');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/store/actions.test.ts`
Expected: FAIL（actions 未定义）

- [ ] **Step 3: 实现 actions.ts**

`src/store/actions.ts`:

```ts
import type { StoreApi } from 'zustand';
import { pgcApi, uploadCanvasItem, downloadVersion, PgcError } from '@/lib/pgc/client';
import { canvasItemsToAssets, canvasItemToAsset, positionReference, versionsToVersions, versionToVersion } from '@/lib/pgc/map';
import type { CanvasGenImageRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest, CanvasGenTask } from '@/lib/pgc/types';
import type { AppStore } from './index';
import type { GenTask, Version } from './types';

type Get = StoreApi<AppStore>['getState'];
type Set = StoreApi<AppStore>['setState'];

// 统一错误兜底:PgcError 写 lastError,其余照抛(便于发现 bug)
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) set({ lastError: { code: e.code, message: e.message } });
    else throw e;
  }
}

export function createServerActions(set: Set, get: Get) {
  // ---- 项目 ----
  const loadCanvas = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    const data = await pgcApi.listCanvasItems(pid);
    set({ assets: canvasItemsToAssets(data.items) });
  };

  const loadVersions = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    const data = await pgcApi.listVersions(pid);
    const versions = versionsToVersions(data.items);
    const current = versions.find((v) => v.current) ?? versions[versions.length - 1] ?? null;
    // 若 pending 版本已 ready,清掉占位
    const pending = get().pendingVersionId;
    const cleared = pending && versions.some((v) => v.id === pending);
    set({
      versions,
      activeVersionId: get().activeVersionId ?? current?.id ?? null,
      ...(cleared ? { pendingVersionId: null, buildingVersion: null } : {}),
    });
  };

  const selectProject = async (id: number) => guard(set, async () => {
    set({ currentProjectId: id, assets: [], versions: [], activeVersionId: null, buildingVersion: null, pendingVersionId: null, genTasks: [] });
    await Promise.all([loadCanvas(), loadVersions()]);
  });

  const loadProjects = async () => guard(set, async () => {
    const data = await pgcApi.listProjects();
    set({ projects: data.items });
    const cur = get().currentProjectId;
    const stillThere = cur != null && data.items.some((p) => p.id === cur);
    const pick = stillThere ? cur! : data.items[0]?.id ?? null;
    if (pick != null && pick !== cur) await selectProject(pick);
    else if (pick != null && get().assets.length === 0) await Promise.all([loadCanvas(), loadVersions()]);
    else if (pick == null) set({ currentProjectId: null });
  });

  const createProject = async (name: string) => guard(set, async () => {
    const p = await pgcApi.createProject(name);
    set({ projects: [p, ...get().projects] });
    await selectProject(p.id);
  });

  const renameProject = async (id: number, name: string) => guard(set, async () => {
    const p = await pgcApi.updateProject(id, { name });
    set({ projects: get().projects.map((x) => (x.id === id ? p : x)) });
  });

  const deleteProject = async (id: number) => guard(set, async () => {
    await pgcApi.deleteProject(id);
    const rest = get().projects.filter((p) => p.id !== id);
    set({ projects: rest });
    if (get().currentProjectId === id) {
      const next = rest[0]?.id ?? null;
      if (next != null) await selectProject(next);
      else set({ currentProjectId: null, assets: [], versions: [], activeVersionId: null });
    }
  });

  // ---- 画布 ----
  const generateImage = async (req: CanvasGenImageRequest) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const data = await pgcApi.genImage(pid, req);
    const fresh = canvasItemsToAssets(data.items);
    set({ assets: [...get().assets, ...fresh] });
  });

  const startAsyncGen = async (kind: 'video' | 'model3d', task: CanvasGenTask) => {
    if (!task.item) return;
    const asset = canvasItemToAsset(task.item);
    set({
      assets: [...get().assets, asset],
      genTasks: [...get().genTasks, { itemId: task.item.item_id, kind, taskId: task.task_id } satisfies GenTask],
    });
  };

  const generateVideo = async (req: CanvasGenVideoRequest) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const task = await pgcApi.genVideo(pid, req);
    await startAsyncGen('video', task);
  });

  const generateModel3d = async (req: CanvasGenModel3DRequest) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const task = await pgcApi.genModel3d(pid, req);
    await startAsyncGen('model3d', task);
  });

  const uploadAsset = async (file: File) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const item = await uploadCanvasItem(pid, file);
    set({ assets: [...get().assets, canvasItemToAsset(item)] });
  });

  const deleteCanvasItem = async (itemId: string) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    await pgcApi.deleteCanvasItem(pid, itemId);
    set({ assets: get().assets.filter((a) => a.id !== itemId) });
  });

  const persistAssetPosition = async (itemId: string) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const a = get().assets.find((x) => x.id === itemId); if (!a) return;
    try {
      const item = await pgcApi.updateCanvasReference(pid, itemId, positionReference(undefined, a.position));
      // 不改 assets(位置已在本地),仅静默持久化;忽略 reference 回显
      void item;
    } catch { /* 坐标回写失败不阻塞 UI */ }
  };

  // 轮询一轮:推进所有 generating 任务
  const pollGenTasks = async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    for (const t of [...get().genTasks]) {
      try {
        const task = t.kind === 'video' ? await pgcApi.pollVideo(pid, t.taskId) : await pgcApi.pollModel3d(pid, t.taskId);
        if (!task.item) continue;
        const asset = canvasItemToAsset(task.item);
        set({ assets: get().assets.map((a) => (a.id === t.itemId ? { ...a, ...asset, position: a.position, pinned: a.pinned } : a)) });
        if (asset.status === 'ready' || asset.status === 'error') {
          set({ genTasks: get().genTasks.filter((g) => g.taskId !== t.taskId) });
        }
      } catch { /* 单个任务轮询失败下一轮再试 */ }
    }
  };

  // ---- 版本 ----
  const publishVersion = async () => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const created = await pgcApi.createVersion(pid);
    const placeholder: Version = versionToVersion({ version_id: created.version_id, seq: get().versions.length + 1, title: created.version_id.toUpperCase(), status: 'building' });
    set({ pendingVersionId: created.version_id, buildingVersion: placeholder });
    await loadVersions();
  });

  const pollVersions = async () => {
    if (!get().pendingVersionId) return;
    try { await loadVersions(); } catch { /* 下一轮再试 */ }
  };

  const previewActiveVersion = async (): Promise<string | null> => {
    const pid = get().currentProjectId; const vid = get().activeVersionId;
    if (pid == null || !vid) return null;
    try { return (await pgcApi.previewVersion(pid, vid)).preview_url; }
    catch (e) { if (e instanceof PgcError) set({ lastError: { code: e.code, message: e.message } }); return null; }
  };

  const downloadActiveVersion = async () => guard(set, async () => {
    const pid = get().currentProjectId; const vid = get().activeVersionId;
    if (pid == null || !vid) return;
    const blob = await downloadVersion(pid, vid);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${vid}.zip`; a.click();
    URL.revokeObjectURL(url);
  });

  return {
    loadProjects, selectProject, createProject, renameProject, deleteProject,
    loadCanvas, loadVersions, generateImage, generateVideo, generateModel3d,
    uploadAsset, deleteCanvasItem, persistAssetPosition, pollGenTasks,
    publishVersion, pollVersions, previewActiveVersion, downloadActiveVersion,
  };
}

export type ServerActions = ReturnType<typeof createServerActions>;
```

- [ ] **Step 4: 在 index.ts 挂载 actions + 声明类型**

`src/store/index.ts`：

(a) import 增补：

```ts
import { createServerActions, type ServerActions } from './actions';
```

(b) `AppStore` 类型并入 `ServerActions`：

```ts
export type AppStore = ReducerState & ServerState & UIState & Actions & ServerActions;
```

(c) `create<AppStore>()(persist((set, get) => ({ ... })))` —— 把签名从 `(set)` 改为 `(set, get)`，并在返回对象里展开 actions（放在 `addAsset:` 之后）：

```ts
      ...createServerActions(set, get),
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test src/store/actions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts src/store/index.ts
git commit -m "pgc 集成:store 异步 actions(项目/画布/版本)"
```

---

### Task 10：启动引导 + 轮询 hooks，去 SEED

**Files:**
- Create: `src/client/useProjectBootstrap.ts`
- Create: `src/client/useCanvasPolling.ts`
- Modify: `src/client/useAgentConnection.ts`

- [ ] **Step 1: 写引导 hook**

`src/client/useProjectBootstrap.ts`:

```ts
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';

// 挂载时拉取项目列表并选定当前项目(自动登录由服务端代理处理)
export function useProjectBootstrap() {
  const loadProjects = useStore((s) => s.loadProjects);
  useEffect(() => { void loadProjects(); }, [loadProjects]);
}
```

- [ ] **Step 2: 写轮询 hook**

`src/client/useCanvasPolling.ts`:

```ts
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';

const INTERVAL = 2500;

// 存在生成中任务或待构建版本时,定时推进轮询
export function useCanvasPolling() {
  const genCount = useStore((s) => s.genTasks.length);
  const pending = useStore((s) => s.pendingVersionId);
  const pollGenTasks = useStore((s) => s.pollGenTasks);
  const pollVersions = useStore((s) => s.pollVersions);

  useEffect(() => {
    if (genCount === 0 && !pending) return;
    const t = setInterval(() => {
      if (useStore.getState().genTasks.length) void pollGenTasks();
      if (useStore.getState().pendingVersionId) void pollVersions();
    }, INTERVAL);
    return () => clearInterval(t);
  }, [genCount, pending, pollGenTasks, pollVersions]);
}
```

- [ ] **Step 3: 改造 useAgentConnection（去 SEED + agent 结束后刷新画布）**

把 `src/client/useAgentConnection.ts` 整体替换为：

```ts
'use client';
import { useEffect, useRef } from 'react';
import { createAgentClient, type AgentClient } from './ws-client';
import { useStore } from '@/store';

export function useAgentConnection() {
  const clientRef = useRef<AgentClient | null>(null);
  const ingest = useStore((s) => s.ingest);
  const setConn = useStore((s) => s.setConn);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const client = createAgentClient({
        url: `${proto}://${location.host}/api/agent/ws`,
        onMessage: (msg) => {
          ingest(msg);
          // agent run 结束后,若有当前项目则以服务端为准刷新画布(REST 真实源)
          if (msg.type === 'result' && useStore.getState().currentProjectId != null) {
            void useStore.getState().loadCanvas().catch(() => {});
          }
        },
        onStatus: (s) => {
          setConn(s);
          if (s === 'open') retry = 0;
          if ((s === 'closed' || s === 'error') && !closed) {
            clearTimeout(timer);
            timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
          }
        },
      });
      clientRef.current = client;
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clientRef.current?.close();
    };
  }, [ingest, setConn]);

  return clientRef;
}
```

> 注：删除了原首屏 `SEED` 注水逻辑（资产/版本改由 REST 提供）。`SEED` 与 `src/server/scripts.ts` 的 mock agent 脚本保留不动。

- [ ] **Step 4: 在 Workspace 挂载引导/轮询**

`src/components/workspace/Workspace.tsx`：import 增补并在组件内调用。

import 增补：

```ts
import { useProjectBootstrap } from '@/client/useProjectBootstrap';
import { useCanvasPolling } from '@/client/useCanvasPolling';
```

在 `const client = useAgentConnection();` 下一行加：

```ts
  useProjectBootstrap();
  useCanvasPolling();
```

- [ ] **Step 5: 校验**

Run: `pnpm test src/store/ && pnpm lint`
Expected: 全绿、无 lint 错误。

- [ ] **Step 6: Commit**

```bash
git add src/client/useProjectBootstrap.ts src/client/useCanvasPolling.ts src/client/useAgentConnection.ts src/components/workspace/Workspace.tsx
git commit -m "pgc 集成:启动引导/轮询 hooks,移除 SEED 注水"
```

---

## Phase 4：UI 接线

### Task 11：轻量错误提示 Toast

**Files:**
- Create: `src/components/ui/Toast.tsx`
- Modify: `src/components/workspace/Workspace.tsx`

- [ ] **Step 1: 写 Toast 组件**

`src/components/ui/Toast.tsx`:

```tsx
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';

// 订阅 store.lastError,展示一个 4s 自动消失的错误条
export default function Toast() {
  const error = useStore((s) => s.lastError);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] text-[var(--color-ink)] shadow-[var(--shadow-popover)]">
        <span className="font-semibold text-red-600">{error.code}</span>
        <span className="text-[var(--color-muted)]">{error.message}</span>
        <button type="button" onClick={() => setError(null)} className="ml-2 text-[var(--color-muted)] hover:text-[var(--color-ink)]">✕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 在 Workspace 挂载 Toast**

`src/components/workspace/Workspace.tsx`：import 增补 `import Toast from '@/components/ui/Toast';`，在最外层 `<div className="h-full">` 内、`<ContextMenu .../>` 之后加 `<Toast />`。

- [ ] **Step 3: 校验**

Run: `pnpm lint && pnpm build`
Expected: 构建通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Toast.tsx src/components/workspace/Workspace.tsx
git commit -m "pgc 集成:轻量错误提示 Toast"
```

---

### Task 12：ProjectMenu 接线（项目列表 + 新建/重命名/删除，隐藏复制）

**Files:**
- Modify: `src/components/chat/ProjectMenu.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/components/chat/ProjectMenu.test.tsx`

- [ ] **Step 1: 改测试以匹配新行为**

把 `src/components/chat/ProjectMenu.test.tsx` 内容替换为（先读现有断言，保留风格；下为新断言）：

```tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProjectMenu from './ProjectMenu';
import type { ProjectData } from '@/lib/pgc/types';

const projects: ProjectData[] = [
  { id: 1, name: '像素地牢', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
  { id: 2, name: '太空射击', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
];

describe('ProjectMenu', () => {
  test('渲染项目列表;点击切换调用 onSelect', () => {
    const onSelect = vi.fn();
    render(<ProjectMenu projects={projects} currentId={1} onClose={() => {}} onSelect={onSelect} onAction={() => {}} />);
    fireEvent.click(screen.getByText('太空射击'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  test('不渲染 Duplicate 项', () => {
    render(<ProjectMenu projects={projects} currentId={1} onClose={() => {}} onSelect={() => {}} onAction={() => {}} />);
    expect(screen.queryByText('Duplicate')).toBeNull();
  });

  test('点击 Create/Rename/Delete 触发 onAction', () => {
    const onAction = vi.fn();
    render(<ProjectMenu projects={projects} currentId={1} onClose={() => {}} onSelect={() => {}} onAction={onAction} />);
    fireEvent.click(screen.getByText('Create new game...'));
    expect(onAction).toHaveBeenCalledWith('create');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test src/components/chat/ProjectMenu.test.tsx`
Expected: FAIL（新 props 未实现）

- [ ] **Step 3: 改 ProjectMenu**

把 `src/components/chat/ProjectMenu.tsx` 替换为：

```tsx
'use client';
import { useEffect } from 'react';
import type { ProjectData } from '@/lib/pgc/types';

// 去掉 duplicate(后端无端点)
export type ProjectMenuAction = 'create' | 'rename' | 'delete';

type Item = { action: ProjectMenuAction; label: string; shortcut?: string };

const SECTIONS: Item[][] = [
  [{ action: 'create', label: 'Create new game...', shortcut: '⌘N' }],
  [
    { action: 'rename', label: 'Rename' },
    { action: 'delete', label: 'Delete' },
  ],
];

function Shortcut({ text }: { text: string }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--color-fill)] px-[4px] py-[2px] text-center text-[11px] font-medium leading-[16px] tracking-[-0.11px] text-[var(--color-muted)] shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),inset_0px_0.75px_0px_0px_#fcfcfc,inset_0px_-0.75px_0.5px_0px_rgba(0,0,0,0.25)]">
      {text}
    </span>
  );
}

export default function ProjectMenu({
  projects,
  currentId,
  onClose,
  onSelect,
  onAction,
}: {
  projects: ProjectData[];
  currentId: number | null;
  onClose: () => void;
  onSelect: (id: number) => void;
  onAction: (action: ProjectMenuAction) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pick = (action: ProjectMenuAction) => { onAction(action); onClose(); };
  const choose = (id: number) => { onSelect(id); onClose(); };

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={onClose} />
      <div className="absolute left-[10px] top-[calc(100%-1px)] z-50 flex w-[204px] flex-col items-start overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        {/* 项目列表 */}
        {projects.length > 0 && (
          <div className="flex max-h-[200px] w-full flex-col items-start overflow-auto p-[8px]">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                className={`flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)] ${p.id === currentId ? 'bg-[var(--color-fill)]' : ''}`}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
                  {p.name}
                </span>
                {p.id === currentId && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
              </button>
            ))}
          </div>
        )}
        {/* 操作分组 */}
        {SECTIONS.map((items, si) => (
          <div key={si} className="flex w-full flex-col items-start border-t border-[var(--color-line)] p-[8px]">
            {items.map(({ action, label, shortcut }) => (
              <button
                key={action}
                type="button"
                onClick={() => pick(action)}
                className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
                  {label}
                </span>
                {shortcut && <Shortcut text={shortcut} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test src/components/chat/ProjectMenu.test.tsx`
Expected: PASS

- [ ] **Step 5: 在 ChatPanel 接线 ProjectMenu + 头部项目名**

`src/components/chat/ChatPanel.tsx`：

(a) import 增补：

```ts
import type { ProjectMenuAction } from './ProjectMenu';
```

(b) 组件内增补 store 取值与处理函数（在 `const [menuOpen, ...]` 之后）：

```ts
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const currentName = projects.find((p) => p.id === currentProjectId)?.name ?? 'Project name';

  const onMenuAction = (action: ProjectMenuAction) => {
    if (action === 'create') {
      const name = window.prompt('新游戏名称', 'Untitled');
      if (name) void createProject(name);
    } else if (action === 'rename') {
      if (currentProjectId == null) return;
      const name = window.prompt('重命名项目', currentName);
      if (name) void renameProject(currentProjectId, name);
    } else if (action === 'delete') {
      if (currentProjectId == null) return;
      if (window.confirm(`确定删除「${currentName}」?`)) void deleteProject(currentProjectId);
    }
  };
```

(c) 头部硬编码 `Project name` 改为 `{currentName}`：

```tsx
          <span className="ml-1 truncate text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
            {currentName}
          </span>
```

(d) `<ProjectMenu .../>` 调用改为传全部 props：

```tsx
        {menuOpen && (
          <ProjectMenu
            projects={projects}
            currentId={currentProjectId}
            onClose={() => setMenuOpen(false)}
            onSelect={(id) => void selectProject(id)}
            onAction={onMenuAction}
          />
        )}
```

- [ ] **Step 6: 校验**

Run: `pnpm test src/components/chat/ && pnpm lint`
Expected: PASS、无 lint 错误。

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ProjectMenu.tsx src/components/chat/ProjectMenu.test.tsx src/components/chat/ChatPanel.tsx
git commit -m "pgc 集成:ProjectMenu 项目列表与新建/重命名/删除接线"
```

---

### Task 13：画布 AddAssetMenu 接线（生成表单 + 上传 + 删除）

**Files:**
- Create: `src/components/canvas/GenerateForm.tsx`
- Modify: `src/components/canvas/AddAssetMenu.tsx`
- Modify: `src/components/canvas/ContextMenu.tsx`

> 现状：`AddAssetMenu` 用本地 `addAsset`，`ContextMenu` 用本地 `removeAsset`。改为调 store 异步 actions。生成 image/video/3d 经弹出的小表单填 prompt。

- [ ] **Step 1: 写 GenerateForm 组件**

`src/components/canvas/GenerateForm.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { useStore } from '@/store';
import Button from '@/components/ui/Button';
import type { AssetKind } from '@/agent-protocol/messages';

// 画布生成小表单:image 带数量;video/3d 仅 prompt
export default function GenerateForm({
  kind,
  onClose,
}: {
  kind: Extract<AssetKind, 'image' | 'video' | '3d'>;
  onClose: () => void;
}) {
  const generateImage = useStore((s) => s.generateImage);
  const generateVideo = useStore((s) => s.generateVideo);
  const generateModel3d = useStore((s) => s.generateModel3d);
  const [prompt, setPrompt] = useState('');
  const [n, setN] = useState(1);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      if (kind === 'image') await generateImage({ prompt, n });
      else if (kind === 'video') await generateVideo({ prompt });
      else await generateModel3d({ prompt });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const title = kind === 'image' ? '生成图片' : kind === 'video' ? '生成视频' : '生成 3D 模型';

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-toolbar)]">
        <p className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</p>
        <textarea
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想生成的内容…"
          className="h-24 w-full resize-none rounded-[12px] border border-[var(--color-line)] bg-[var(--color-fill)] p-2 text-[13px] text-[var(--color-ink)] outline-none"
        />
        {kind === 'image' && (
          <label className="flex items-center gap-2 text-[12px] text-[var(--color-muted)]">
            数量
            <input type="number" min={1} max={4} value={n} onChange={(e) => setN(Math.min(4, Math.max(1, Number(e.target.value))))}
              className="w-16 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-fill)] px-2 py-1 text-[var(--color-ink)]" />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-[10px] px-3 py-2 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-fill)]">取消</button>
          <Button onClick={submit} disabled={busy || !prompt.trim()}>{busy ? '生成中…' : '生成'}</Button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: 校验 GenerateForm 可编译**

Run: `pnpm lint`
Expected: 无 lint 错误（组件引用的 `generateImage/generateVideo/generateModel3d` 均在 Task 9 定义）。

- [ ] **Step 3: 改 AddAssetMenu（生成走表单,上传走 store.uploadAsset,移除 Text）**

把 `src/components/canvas/AddAssetMenu.tsx` 替换为：

```tsx
'use client';
import { useRef, useState } from 'react';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import GenerateForm from './GenerateForm';
import type { AssetKind } from '@/agent-protocol/messages';

// 去掉 Text(后端画布无 doc 类型);生成项 → 弹表单
type GenKind = Extract<AssetKind, 'image' | 'video' | '3d'>;
const ITEMS: { kind: GenKind; label: string; icon: string }[] = [
  { kind: 'image', label: 'Image', icon: figAsset.image },
  { kind: 'video', label: 'Video', icon: figAsset.video },
  { kind: '3d', label: '3D World', icon: figAsset.threeD },
];

const row = 'flex h-10 w-full items-center gap-3 rounded-[12px] py-1 pl-1 pr-3 text-left transition-colors hover:bg-[var(--color-fill)]';
const symbol = 'grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)]';
const label = 'text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)]';
const groupLabel = 'text-[12px] font-medium tracking-[-0.12px] text-[#7b7b7b]';

export default function AddAssetMenu({
  x,
  y,
  onClose,
}: {
  x: number;
  y: number;
  flowPos: { x: number; y: number };
  onClose: () => void;
}) {
  const uploadAsset = useStore((s) => s.uploadAsset);
  const fileRef = useRef<HTMLInputElement>(null);
  const [genKind, setGenKind] = useState<GenKind | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void uploadAsset(f);
    onClose();
  };

  if (genKind) return <GenerateForm kind={genKind} onClose={onClose} />;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-50 flex w-[250px] flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-toolbar)]" style={{ left: x, top: y }}>
        <div className="flex flex-col gap-1">
          <p className={groupLabel}>Generate</p>
          {ITEMS.map(({ kind, label: l, icon }) => (
            <button key={kind} className={row} onClick={() => setGenKind(kind)}>
              <span className={symbol}><FigIcon src={icon} size={16} /></span>
              <span className={label}>{l}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <p className={groupLabel}>Add source</p>
          <button className={row} onClick={() => fileRef.current?.click()}>
            <span className={symbol}><FigIcon src={figAsset.upload} size={16} /></span>
            <span className="flex flex-col leading-4">
              <span className={label}>Upload</span>
              <span className="text-[10px] tracking-[-0.1px] text-[#7b7b7b]">Image/ Video/ Audio</span>
            </span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={onFile} />
      </div>
    </>
  );
}
```

> 注：`flowPos` prop 保留在签名里（调用方仍传），但本地生成不再需要它——后端不接受坐标，坐标由 reference.position 在拖拽后回写。

- [ ] **Step 4: 改 ContextMenu 的删除走 store.deleteCanvasItem**

`src/components/canvas/ContextMenu.tsx` 两处改动：

- 取值（约 line 12）：`const removeAsset = useStore((s) => s.removeAsset);` → `const deleteCanvasItem = useStore((s) => s.deleteCanvasItem);`
- 删除按钮回调（约 line 69）：`removeAsset(asset.id);` → `void deleteCanvasItem(asset.id);`

（「派生创作 / 重新生成 / 作为引用 / 重命名」保持不变——其中「重新生成」走 WS agent，即 agent 触发路径。）

- [ ] **Step 5: 校验**

Run: `pnpm lint && pnpm build`
Expected: 构建通过。

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/AddAssetMenu.tsx src/components/canvas/ContextMenu.tsx
git commit -m "pgc 集成:画布生成表单 + 上传/删除接线"
```

---

### Task 14：画布坐标回写（拖拽 pin 后 PATCH reference）

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`

> `setAssetPosition` 在拖拽结束被调用（pin 节点）。在其后追加 best-effort 持久化坐标。

- [ ] **Step 1: 定位拖拽结束回调**

`src/components/canvas/AssetCanvas.tsx` 的 `onNodeDragStop={(_, node) => { ... }}`（约 line 228）当前为：

```ts
        onNodeDragStop={(_, node) => {
          setAssetPosition(node.id, node.position.x, node.position.y, true);
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 0);
        }}
```

- [ ] **Step 2: 追加坐标持久化（best-effort PATCH reference.position）**

把该回调改为（在 `setAssetPosition` 后追加一行；`useStore` 已在 line 14 导入）：

```ts
        onNodeDragStop={(_, node) => {
          setAssetPosition(node.id, node.position.x, node.position.y, true);
          void useStore.getState().persistAssetPosition(node.id);
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 0);
        }}
```

- [ ] **Step 3: 校验**

Run: `pnpm lint && pnpm build`
Expected: 构建通过。

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "pgc 集成:拖拽后回写画布坐标到 reference.position"
```

---

### Task 15：版本接线（Publish / 预览 iframe / 下载 ZIP）

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`
- Modify: `src/components/preview/GameFrame.tsx`
- Modify: `src/components/preview/VersionTimeline.tsx`

- [ ] **Step 1: PreviewPanel 接线 Publish + 下载 + 预览地址**

`src/components/preview/PreviewPanel.tsx` 修改点：

(a) 取值：把 `const saveVersion = useStore((s) => s.saveVersion);` 替换为：

```ts
  const publishVersion = useStore((s) => s.publishVersion);
  const downloadActiveVersion = useStore((s) => s.downloadActiveVersion);
  const previewActiveVersion = useStore((s) => s.previewActiveVersion);
  const activeId = useStore((s) => s.activeVersionId);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
```

并新增 effect（在组件内、return 之前）：

```ts
  useEffect(() => {
    let alive = true;
    if (!activeId) { setPreviewUrl(null); return; }
    void previewActiveVersion().then((u) => { if (alive) setPreviewUrl(u); });
    return () => { alive = false; };
  }, [activeId, previewActiveVersion]);
```

> import 增补 `useEffect`：把首行 `import { useState } from 'react';` 改为 `import { useEffect, useState } from 'react';`

(b) Publish 按钮：`<Button onClick={saveVersion}>Publish</Button>` → `<Button onClick={() => void publishVersion()}>Publish</Button>`

(c) Download 按钮：把 `<IconButton variant="ghost" className="p-2" aria-label="Download ZIP">` 加上 `onClick={() => void downloadActiveVersion()}`。

(d) 预览区把 `<GameFrame version={active} device={device} />` 改为传入 `previewUrl`：

```tsx
            <GameFrame version={active} device={device} previewUrl={previewUrl} />
```

- [ ] **Step 2: GameFrame 用 previewUrl 作 iframe src**

`src/components/preview/GameFrame.tsx`：

(a) 函数签名增加 `previewUrl`：

```tsx
export default function GameFrame({ version, device, previewUrl }: { version: Version | null; device: 'mobile' | 'desktop'; previewUrl?: string | null }) {
```

(b) 在 `useEffect(() => { post(); }, [palette, title]); // eslint-disable-line react-hooks/exhaustive-deps` 之后、`const w = device === 'mobile' ...` 之前，插入短路渲染（hooks 已先行执行，符合 hooks 规则）：

```tsx
  // 有真实版本预览地址时直接 iframe 直连 pgc;其余沿用本地占位作兜底
  if (previewUrl) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--color-preview-bg)] p-4">
        <div className={`${device === 'mobile' ? 'w-[340px]' : 'w-full'} max-w-[360px] overflow-hidden rounded-[28px] border-4 border-black/40 shadow-2xl`}>
          <iframe src={previewUrl} title="preview" className="h-[560px] w-full bg-black" />
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: VersionTimeline 追加 buildingVersion 占位卡**

`src/components/preview/VersionTimeline.tsx`：

(a) 取值增补：

```ts
  const buildingVersion = useStore((s) => s.buildingVersion);
```

(b) 渲染列表时把 building 占位拼进去。把：

```tsx
        {[...versions].reverse().map((v) => {
```
改为：

```tsx
        {[...versions, ...(buildingVersion ? [buildingVersion] : [])].reverse().map((v) => {
```

building 卡片复用现有渲染即可（其 `summary` 为 “Building…”，`current=false`）。

(c) Compare 置灰（本期不接线，spec §2.8）。把：

```tsx
  const canCompare = versions.length > 1;
```
改为：

```tsx
  const canCompare = false; // 版本对比本期不接线(置灰)
```

- [ ] **Step 4: 校验**

Run: `pnpm lint && pnpm build`
Expected: 构建通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/GameFrame.tsx src/components/preview/VersionTimeline.tsx
git commit -m "pgc 集成:Publish 创建版本 + 预览 iframe + 下载 ZIP"
```

---

### Task 16：全量回归 + 手动冒烟

**Files:** 无（验收任务）

- [ ] **Step 1: 全量单测 + lint + 构建**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: 全绿。

- [ ] **Step 2: 手动冒烟（.env 填好 dev 账号后）**

启动 `pnpm dev`，逐项验证：
- 头部下拉显示项目列表，可新建/切换/重命名/删除（删除有确认）。
- 画布右键 → Generate Image 填 prompt 生成，图片出现；Generate Video/3D 出现 generating 占位并在数秒内轮询转 ready。
- 上传图片/视频/音频成功落画布。
- 删除画布资产从画布消失。
- Publish 后时间线出现 building 占位，agent 构建完成后转为 ready 版本。
- 点击版本 → 右侧预览 iframe 显示该版本；Download ZIP 下载成功。
- 任一接口失败时底部出现错误 Toast（code + message）。

- [ ] **Step 3: 最终提交（如有零碎修正）**

```bash
git add -A
git commit -m "pgc 集成:全量回归与冒烟修正"
```

---

## 实现顺序与依赖

1. **Phase 1（Task 1-4）** 浏览器 client 层 —— 纯逻辑、可独立单测，先行。
2. **Phase 2（Task 5-7）** 服务端代理 —— 打通自动登录与转发，Task 7 后可 curl 冒烟。
3. **Phase 3（Task 8-10）** store 改造 —— 把 client 接进状态，去 SEED/持久化。
4. **Phase 4（Task 11-16）** UI 接线 —— 逐个域接线并回归。

Phase 1-2 可独立交付（API 层通）。Phase 3 后数据流通但 UI 仍部分旧样式。Phase 4 完成全部需求。
