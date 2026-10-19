# 画布上传资产占位卡 + 真实进度条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布上传本地资产时立即落占位卡并展示真实上传百分比进度条，完成后原位替换、失败移除。

**Architecture:** 复用生成流程的占位卡三件套（`addGenPlaceholders`/`settleGenPlaceholders`/`removeGenPlaceholders`）；底层 `uploadCanvasItem` 从 `fetch` 改 `XMLHttpRequest` 以拿 `xhr.upload.onprogress` 字节进度；`Asset` 加 `progress` 字段驱动 `NodeCard` 统一进度覆盖层。上传同步返回（无 GenTask 轮询）。

**Tech Stack:** Next.js 16 / React 19 / zustand / @xyflow/react / Vitest(jsdom) / react-i18next。

## Global Constraints

- 代码注释 / commit message 一律用**中文**。
- 颜色走 CSS 变量（`--color-accent` 等），**禁止**硬编码色值；动效复用 `globals.css` 既有类，加 `motion-safe:` 且在 `prefers-reduced-motion` 下退化。
- 不臆测后端字段：只用文档约定字段；`canvasItemToAsset(it): Asset` 无 opts，改 `source` 用展开覆盖。
- `guard` 之外不 catch 非预期错误；`PgcError` 由 `guard` 收敛为 `lastError`（→Toast），401 只置 `authRequired`。
- `assets` 不落盘（persist 白名单不含）；瞬态（AbortController map）不进 store、不持久化。
- i18n 六语（en/zh/fr/ru/ja/vi），en 单一真相源；新增文案补齐六套。
- 每个 `await` 后校验 `if (get().currentProjectId !== pid) return`，丢弃过期响应。
- 测试与源码同目录（`*.test.ts(x)`）；`pnpm exec vitest run <file>` 跑单文件。

---

### Task 1: `resolveEnvelope` 抽取 + `uploadCanvasItem` 改 XHR

**Files:**
- Modify: `src/lib/pgc/client.ts`（`unwrap` 抽出 `resolveEnvelope`；重写 `uploadCanvasItem`）
- Test: `src/lib/pgc/client.test.ts`（新增 XHR 上传测试）

**Interfaces:**
- Consumes: 现有 `PgcError`、`ApiResponse<T>`、`CanvasItemData`、`PREFIX`。
- Produces:
  - `function resolveEnvelope<T>(env: ApiResponse<T> | null, ok: boolean, status: number): T`（模块内部，不导出）
  - `export function uploadCanvasItem(pid: number, file: File, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<CanvasItemData>`

- [ ] **Step 1: 写失败测试**（`src/lib/pgc/client.test.ts` 末尾追加）

```ts
// —— XHR 上传:注入 FakeXHR 观测进度 / 解包 / 失败 / 中止 ——
describe('uploadCanvasItem(XHR)', () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];
    upload = { onprogress: null as ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    withCredentials = false;
    method = '';
    url = '';
    aborted = false;
    constructor() { FakeXHR.instances.push(this); }
    open(method: string, url: string) { this.method = method; this.url = url; }
    send(_body: unknown) { /* noop */ }
    abort() { this.aborted = true; this.onabort?.(); }
    emitProgress(loaded: number, total: number) { this.upload.onprogress?.({ lengthComputable: true, loaded, total }); }
    respond(status: number, body: unknown) { this.status = status; this.responseText = JSON.stringify(body); this.onload?.(); }
  }
  beforeEach(() => { FakeXHR.instances = []; vi.stubGlobal('XMLHttpRequest', FakeXHR); });

  test('POST 到 upload 端点,带 withCredentials,回报进度,解出 data', async () => {
    const onProgress = vi.fn();
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'), onProgress);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/pgc/api/projects/42/canvas/items/upload');
    expect(xhr.withCredentials).toBe(true);
    xhr.emitProgress(50, 100);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.respond(200, { success: true, code: 'OK', message: 'OK', data: { item_id: 'up-1', type: 'image', status: 'ready', url: null } });
    await expect(p).resolves.toMatchObject({ item_id: 'up-1' });
  });

  test('失败信封 → 抛 PgcError(带 code/status)', async () => {
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'));
    FakeXHR.instances[0].respond(413, { success: false, code: 'TOO_LARGE', message: '太大', data: null });
    await expect(p).rejects.toMatchObject({ code: 'TOO_LARGE', status: 413 });
  });

  test('signal abort → xhr.abort() 且抛 ABORTED', async () => {
    const ctrl = new AbortController();
    const p = uploadCanvasItem(42, new File(['x'], 'a.png'), undefined, ctrl.signal);
    const xhr = FakeXHR.instances[0];
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts -t "uploadCanvasItem(XHR)"`
Expected: FAIL —— 现有 `uploadCanvasItem` 是 fetch 版，`FakeXHR.instances[0]` 为 undefined / `withCredentials` 断言不通过。

- [ ] **Step 3: 抽 `resolveEnvelope`，重写 `uploadCanvasItem`**

在 `src/lib/pgc/client.ts` 中，把 `unwrap` 的判定逻辑抽成独立函数（`unwrap` 仍用 `res.json()`，行为不变）：

```ts
// 已解析信封(或 null)+ HTTP 状态 → data 或抛 PgcError。fetch/XHR 共用,不重复造判定
function resolveEnvelope<T>(env: ApiResponse<T> | null, ok: boolean, status: number): T {
  if (!ok || !env || env.success === false) {
    throw new PgcError(env?.code ?? 'HTTP_ERROR', env?.message ?? `HTTP ${status}`, status, env?.failure ?? null);
  }
  return env.data as T;
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: ApiResponse<T> | null = null;
  try { env = (await res.json()) as ApiResponse<T>; } catch { /* 非 JSON */ }
  return resolveEnvelope(env, res.ok, res.status);
}
```

把文件末尾的 `uploadCanvasItem`（原 fetch 版，约 107-113 行）整体替换为 XHR 版：

```ts
// 上传(multipart);onProgress 回报「浏览器→同源服务器」字节比例(0..1),仅字节上传阶段可观测;
// signal 中止时 xhr.abort() → 抛 ABORTED(删除占位卡时用)。fetch 无 upload 进度事件,故必须用 XHR。
export function uploadCanvasItem(
  pid: number, file: File,
  onProgress?: (ratio: number) => void, signal?: AbortSignal,
): Promise<CanvasItemData> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PREFIX}/api/projects/${pid}/canvas/items/upload`);
    xhr.withCredentials = true;   // 等价 fetch credentials:'include'(cookie 制鉴权)
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let env: ApiResponse<CanvasItemData> | null = null;
      try { env = JSON.parse(xhr.responseText); } catch { /* 非 JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      try { resolve(resolveEnvelope(env, ok, xhr.status)); }
      catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new PgcError('NETWORK', 'Network error', 0));
    xhr.onabort = () => reject(new PgcError('ABORTED', 'Upload aborted', 0));
    xhr.send(fd);
  });
}
```

- [ ] **Step 4: 跑测试确认通过（含既有回归）**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS —— 新增 3 条 XHR 用例通过，且原有 `pgcApi 信封拆解` 等用例（用 `mockJson` 的 `json()`）不受影响（`unwrap` 仍走 `res.json()`）。

- [ ] **Step 5: commit**

```bash
git add src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: uploadCanvasItem 改 XHR 支持字节进度回调与中止——抽 resolveEnvelope 供 fetch/XHR 共用信封判定"
```

---

### Task 2: `Asset.progress` 字段 + `uploadAsset` 改写（占位卡 + 进度 + 中止）

**Files:**
- Modify: `src/store/types.ts`（`Asset` 加 `progress?: number`）
- Modify: `src/store/actions.ts`（改写 `uploadAsset`；`deleteCanvasItem` pending 分支 abort；新增进度/上传追踪闭包）
- Test: `src/store/actions.test.ts`（扩展 `uploadAsset 落位` describe）

**Interfaces:**
- Consumes: `uploadCanvasItem(pid, file, onProgress?, signal?)`（Task 1）；现有 `addGenPlaceholders(kind, count, opts?)`、`settleGenPlaceholders(pid, ids, fresh, opts?)`、`removeGenPlaceholders(ids)`、`canvasItemToAsset(item)`、`kindFromMime(mime)`、`GenPlacement`、`guard`、`pgcApi.deleteCanvasItem`。
- Produces:
  - `Asset.progress?: number`（0..1，上传字节阶段有值，其余 undefined）
  - `uploadAsset(file: File, opts?: GenPlacement): Promise<void>`（签名新增 `opts`；`ServerActions` 类型由 `ReturnType` 自动更新）

- [ ] **Step 1: 写失败测试**（`src/store/actions.test.ts`，替换现有 `describe('uploadAsset 落位', …)` 整块）

```ts
describe('uploadAsset 占位卡 + 进度', () => {
  // 上传保持挂起,便于检查占位/进度中间态。resolve/reject 经 arrow 包装引用闭包变量
  // (直接 return {resolve} 会拷到 mock 运行前的 undefined —— 闭包晚绑定坑)
  function deferredUpload() {
    let resolve!: (v: unknown) => void, reject!: (e: unknown) => void;
    let signal: AbortSignal | undefined, onProgress: ((r: number) => void) | undefined;
    uploadMock.mockImplementation((_pid, _file, op, sig) => {
      onProgress = op; signal = sig;
      return new Promise((res, rej) => { resolve = res; reject = rej; });
    });
    return {
      resolve: (v: unknown) => resolve(v),
      reject: (e: unknown) => reject(e),
      getSignal: () => signal,
      getOnProgress: () => onProgress!,
    };
  }

  test('落 generating 占位卡且 progress=0', () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    deferredUpload();
    void useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    const ph = useStore.getState().assets[0];
    expect(ph.status).toBe('generating');
    expect(ph.kind).toBe('image');
    expect(ph.progress).toBe(0);
    expect(ph.id.startsWith('pending_')).toBe(true);
  });

  test('进度回调推进 progress,且按整数百分比节流', () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    void useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    const cb = d.getOnProgress();
    cb(0.5);
    expect(useStore.getState().assets[0].progress).toBeCloseTo(0.5);
    cb(0.501);  // 同为 50% → 节流跳过,progress 不变
    expect(useStore.getState().assets[0].progress).toBeCloseTo(0.5);
    cb(0.52);   // 52% → 更新
    expect(useStore.getState().assets[0].progress).toBeCloseTo(0.52);
  });

  test('字节传完(ratio>=1) → progress 置 undefined(回退 spinner),仍 generating', () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    void useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    d.getOnProgress()(1);
    const ph = useStore.getState().assets[0];
    expect(ph.progress).toBeUndefined();
    expect(ph.status).toBe('generating');
  });

  test('成功 → 原位替换为 source:uploaded 真实卡', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    api.updateCanvasReference.mockResolvedValue({});
    const p = useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    d.resolve({ item_id: 'up-1', type: 'image', name: 'a.png', status: 'ready', url: null, reference: null });
    await p;
    const a = useStore.getState().assets.find((x) => x.id === 'up-1')!;
    expect(a).toBeTruthy();
    expect(a.source).toBe('uploaded');
    expect(a.progress).toBeUndefined();
    expect(useStore.getState().assets.some((x) => x.id.startsWith('pending_'))).toBe(false);
  });

  test('失败 → 移除占位卡 + lastError 弹 Toast', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    const p = useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    d.reject(new PgcError('TOO_LARGE', '太大', 413));
    await p;
    expect(useStore.getState().assets).toHaveLength(0);
    expect(useStore.getState().lastError?.code).toBe('TOO_LARGE');
  });

  test('删除进行中占位卡 → abort 且不弹 Toast', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    const p = useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    const phId = useStore.getState().assets[0].id;
    await useStore.getState().deleteCanvasItem(phId);   // pending 分支:本地移除 + abort
    expect(d.getSignal()?.aborted).toBe(true);
    // FakeXHR 未介入(uploadMock 手工控制),显式 reject ABORTED 模拟中止后 promise 落定
    d.reject(new PgcError('ABORTED', 'Upload aborted', 0));
    await p;
    expect(useStore.getState().assets).toHaveLength(0);
    expect(useStore.getState().lastError).toBeNull();
  });

  test('占位卡被 loadCanvas 抹掉后上传才成功 → upsert 落卡,不删服务端 item', async () => {
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    api.updateCanvasReference.mockResolvedValue({});
    const p = useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    const phId = useStore.getState().assets[0].id;
    void phId;
    useStore.setState({ assets: [] });   // 模拟 loadCanvas 整表替换抹掉了占位卡
    d.resolve({ item_id: 'up-9', type: 'image', name: 'a.png', status: 'ready', url: null, reference: null });
    await p;
    const a = useStore.getState().assets.find((x) => x.id === 'up-9')!;
    expect(a).toBeTruthy();                  // 合法上传被 adopt 落卡,未被删
    expect(a.source).toBe('uploaded');
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
  });

  test('loadCanvas 已加载同 item_id 时上传成功 → 原位更新不产生重复卡', async () => {
    // loadCanvas 抢先把真实 item 拉上来(位置 200,200),随后上传 promise 才落定
    const existing = { ...makeAsset('image'), id: 'up-9', key: 'up-9', source: 'uploaded' as const, position: { x: 200, y: 200 } };
    useStore.setState({ currentProjectId: 42, assets: [] });
    const d = deferredUpload();
    const p = useStore.getState().uploadAsset(new File([], 'a.png', { type: 'image/png' }));
    useStore.setState({ assets: [existing] });   // 占位卡被抹掉,真实卡已在
    d.resolve({ item_id: 'up-9', type: 'image', name: 'a.png', status: 'ready', url: null, reference: null });
    await p;
    expect(useStore.getState().assets.filter((x) => x.id === 'up-9')).toHaveLength(1);   // 不重复
    expect(useStore.getState().assets.find((x) => x.id === 'up-9')!.position).toEqual({ x: 200, y: 200 });   // 保留已加载坐标
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "uploadAsset 占位卡"`
Expected: FAIL —— 现 `uploadAsset` 无占位卡（首条 `assets[0]` undefined）、无 `progress`、无 abort。

- [ ] **Step 3: 加 `Asset.progress` 字段**（`src/store/types.ts`，`Asset` 接口内，`sourceFilename` 后）

```ts
  sourceFilename?: string;   // 来源 agent 资产文件名(import 经 reference 回显),仅作溯源;去重由 importedByProject 负责
  progress?: number;         // 上传字节进度 0..1;仅上传占位卡在字节上传阶段有值,其余态为 undefined
```

- [ ] **Step 4: 改写 `uploadAsset` + 追踪闭包 + delete abort**（`src/store/actions.ts`）

在 `createServerActions` 闭包顶部（`guard`/`placeAndLink` 之后、任意 action 之前，例如紧邻 `runGen` 附近）新增追踪工具：

```ts
  // 在飞上传:占位卡 id → AbortController。瞬态(不进 store / 不持久化),用于删卡时中止 XHR
  const uploads = new Map<string, AbortController>();
  const registerUpload = (id: string, c: AbortController) => { uploads.set(id, c); };
  const unregisterUpload = (id: string) => { uploads.delete(id); };
  const abortUpload = (id: string) => { uploads.get(id)?.abort(); uploads.delete(id); };
  // 更新占位卡进度(ratio=undefined 清除进度,回退 spinner)
  const setAssetProgress = (id: string, ratio: number | undefined) =>
    set({ assets: get().assets.map((a) => (a.id === id ? { ...a, progress: ratio } : a)) });
  // 进度节流:仅当取整百分比变化才写 store(≤100 次),避免 xyflow 逐帧重渲;ratio>=1 清进度回退 spinner(=处理中)
  const throttleRatio = (id: string) => {
    let last = -1;
    return (ratio: number) => {
      if (ratio >= 1) { if (last !== 100) { last = 100; setAssetProgress(id, undefined); } return; }
      const pct = Math.round(ratio * 100);
      if (pct !== last) { last = pct; setAssetProgress(id, ratio); }
    };
  };
```

把 `uploadAsset`（约 368-372 行）整体替换：

```ts
  const uploadAsset = async (file: File, opts?: GenPlacement) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const [phId] = addGenPlaceholders(kindFromMime(file.type), 1, opts);
    setAssetProgress(phId, 0);                 // 初始 0%,占位卡立即显示进度条
    const controller = new AbortController();
    registerUpload(phId, controller);
    try {
      const item = await uploadCanvasItem(pid, file, throttleRatio(phId), controller.signal);
      if (get().currentProjectId !== pid) return;   // await 后切项目:丢弃
      // 复用 adoptAgentItem 按 item_id upsert:占位卡在→原位替换;占位卡被 loadCanvas(agent run.finished
      // 触发)抹掉但 item 已加载→原位更新不重复;都没有→落视口中心。成功上传永不被删,不重不丢。
      // canvasItemToAsset 无 opts:展开后覆写 source 为 'uploaded'(不臆造签名)
      adoptAgentItem(pid, phId, { ...canvasItemToAsset(item), source: 'uploaded' });
    } catch (e) {
      if (get().currentProjectId === pid) removeGenPlaceholders([phId]);
      if (e instanceof PgcError && e.code === 'ABORTED') return;   // 主动中止不弹 Toast
      throw e;                                   // 其余交 guard 写 lastError → Toast
    } finally {
      unregisterUpload(phId);
    }
  });
```

在 `deleteCanvasItem` 的 pending 分支（约 378-382 行）里补一行 abort：

```ts
    if (itemId.startsWith('pending_')) {
      abortUpload(itemId);   // 若是在飞上传占位卡,中止 XHR(其 promise 落 ABORTED,静默返回)
      set({ assets: get().assets.filter((a) => a.id !== itemId) });
      commitGenTasks(get().genTasks.filter((t) => t.itemId !== itemId));
      return;
    }
```

确认 `src/store/actions.ts` 顶部已 import `PgcError`（第 1 行已有 `import { pgcApi, uploadCanvasItem, downloadVersion, PgcError } from '@/lib/pgc/client';`）与 `kindFromMime`（若未 import 则从 `@/lib/assets` 补：`import { makeAsset, kindFromMime } from '@/lib/assets';` —— 实施时先 grep 现有 import 再决定是否新增）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS —— `uploadAsset 占位卡 + 进度` 全部通过，其余 actions 用例不受影响。

- [ ] **Step 6: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（`uploadAsset` 签名变化经 `ReturnType<typeof createServerActions>` 自动传导，调用方 `void uploadAsset(f)` 仍合法）。

- [ ] **Step 7: commit**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: uploadAsset 落占位卡+推进上传进度+原位替换——删卡中止 XHR、进度节流、Asset 加 progress 字段"
```

---

### Task 3: `NodeCard` 进度覆盖层 + i18n

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`（新增进度覆盖层）
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`common.uploading`）
- Test: `src/components/canvas/nodes/NodeCard.test.tsx`（新建）

**Interfaces:**
- Consumes: `Asset.progress`（Task 2）；`useStore`、`t('common.uploading')`。
- Produces: `progress != null` 时渲染 `role="progressbar"` 覆盖层。

- [ ] **Step 1: 加 i18n `common.uploading`（六语）**

`src/i18n/locales/en.ts` 的 `common` 对象末尾加 `uploading: 'Uploading'`：

```ts
  common: { close: 'Close', cancel: 'Cancel', generating: 'Generating', loading3d: 'Loading 3D', delete: 'Delete', default: 'Default', uploading: 'Uploading' },
```

其余五套（各自 `common` 对象追加 `uploading`，键顺序对齐 en）：
- `zh.ts`：`uploading: '上传中'`
- `fr.ts`：`uploading: 'Téléversement'`
- `ru.ts`：`uploading: 'Загрузка'`
- `ja.ts`：`uploading: 'アップロード中'`
- `vi.ts`：`uploading: 'Đang tải lên'`

> 实施时先 grep 每个 locale 的 `common:` 行确认字段顺序，把 `uploading` 追加在该对象内（勿改动其余键）。

- [ ] **Step 2: 写失败测试**（新建 `src/components/canvas/nodes/NodeCard.test.tsx`）

```tsx
import { describe, expect, test, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import NodeCard from './NodeCard';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import { makeAsset } from '@/lib/assets';

function renderCard(assetPatch: Partial<ReturnType<typeof makeAsset>>) {
  const asset = { ...makeAsset('image'), ...assetPatch };
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState(), assets: [asset] });
  return render(
    <ReactFlowProvider>
      <NodeCard kind="image" title="t" assetId={asset.id}><div>body</div></NodeCard>
    </ReactFlowProvider>,
  );
}

beforeEach(() => cleanup());

describe('NodeCard 上传进度覆盖层', () => {
  test('progress 有值时渲染 progressbar,aria-valuenow 为百分比', () => {
    renderCard({ status: 'generating', progress: 0.42 });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  test('progress 为 undefined 时无 progressbar', () => {
    renderCard({ status: 'generating', progress: undefined });
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: FAIL —— 尚无 progressbar 渲染。

- [ ] **Step 4: 加进度覆盖层**（`src/components/canvas/nodes/NodeCard.tsx`）

在组件内、`deleting` 订阅之后加对 `progress` 的订阅：

```ts
  // 上传字节进度(仅上传占位卡有值);progress!=null 时覆盖进度条,置 undefined 后回落各节点卡自身 generating spinner
  const progress = useStore((s) => s.assets.find((a) => a.id === assetId)?.progress);
```

在删除中覆盖层 `{deleting && (…)}` 之后、`</div>` 之前，新增进度覆盖层：

```tsx
      {/* 上传进度覆盖层(跨类型统一):半透明黑遮罩 + 居中百分比 + 底部 accent 进度条;
          字节传完后 progress 置 undefined,本层消失,回落到各节点卡自身的 generating spinner(处理中) */}
      {progress != null && (
        <div className="anim-media-in absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[16px] bg-black/35 backdrop-blur-[1px]">
          <span className="font-[var(--font-mono)] text-[13px] font-medium text-white">{Math.round(progress * 100)}%</span>
          <div className="mx-4 h-1 w-[calc(100%-2rem)] overflow-hidden rounded-full bg-white/25">
            <div
              role="progressbar"
              aria-label={t('common.uploading')}
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-full rounded-full bg-[var(--color-accent)] motion-safe:transition-[width] motion-safe:duration-200"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: PASS。

- [ ] **Step 6: i18n 完整性 + 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（六语 `common` 结构一致，`t('common.uploading')` 有键）。

- [ ] **Step 7: commit**

```bash
git add src/components/canvas/nodes/NodeCard.tsx src/components/canvas/nodes/NodeCard.test.tsx src/i18n/locales/
git commit -m "feat: NodeCard 上传进度覆盖层(百分比+accent 进度条)+ common.uploading 六语文案"
```

---

### Task 4: 上传入口透传落位（占位卡落在触发点）

**Files:**
- Modify: `src/components/canvas/AddAssetMenu.tsx`（`onFile` 传 `{ spawnAt }`）
- Modify: `src/components/canvas/EmptyStateChips.tsx`（`onFile` 传 `{ spawnAt: getViewportCenter() }`）
- Test: 复用 Task 2 的 action 测试（落位 opts 由 action 层已覆盖）；本任务为纯接线，手动核对。

**Interfaces:**
- Consumes: `uploadAsset(file, opts?)`（Task 2）；`AddAssetMenu` 已有的 `spawnAt` prop；`EmptyStateChips` 已 import 的 `getViewportCenter`。

- [ ] **Step 1: `AddAssetMenu` 透传 spawnAt**

`src/components/canvas/AddAssetMenu.tsx` 的 `onFile` 里，把 `void uploadAsset(accepted[0]);` 改为：

```ts
    void uploadAsset(accepted[0], { spawnAt });   // 占位卡落在双击点(与生成表单一致)
    onClose();
```

（`spawnAt` 是本组件已有的 prop / 变量；若命名不同，先 grep 组件顶部 props 解构确认实际变量名。）

- [ ] **Step 2: `EmptyStateChips` 透传视口中心**

`src/components/canvas/EmptyStateChips.tsx` 的 `onFile` 里，把 `void uploadAsset(accepted[0]);` 改为：

```ts
    void uploadAsset(accepted[0], { spawnAt: getViewportCenter() ?? undefined });   // 空画布:落在视口中心
```

- [ ] **Step 3: 类型检查 + 相关测试回归**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components/canvas/AddAssetMenu.test.tsx src/components/canvas/EmptyStateChips.test.tsx`
Expected: PASS（若既有测试断言 `uploadAsset` 调用参数，需同步更新为带 opts 的调用；先跑看是否命中）。

- [ ] **Step 4: commit**

```bash
git add src/components/canvas/AddAssetMenu.tsx src/components/canvas/EmptyStateChips.tsx
git commit -m "feat: 上传占位卡落在触发点——AddAssetMenu 透传双击点、EmptyStateChips 透传视口中心"
```

---

### Task 5: 全量验证 + 运行态观测

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试 + lint + 类型 + 构建**

```bash
pnpm exec vitest run
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```
Expected: 全绿。

- [ ] **Step 2: 运行态观测（可选，用 /verify 或 Playwright）**

按 `docs/superpowers` 运行态验证套路：本地 `pnpm dev`（端口冲突见 memory）或 prod 构建后，画布双击 → 上传 → 观测占位卡出现、进度条推进、字节满后转 spinner、完成原位替换；再试删除进行中上传卡验证中止；试上传超限文件验证 Toast。

## Self-Review

**1. Spec coverage：**
- 底层 XHR + resolveEnvelope → Task 1 ✓
- `Asset.progress` → Task 2 ✓
- `uploadAsset` 占位/进度/节流/100% 尾巴/原位替换/失败/切项目守卫/删卡防 ghost → Task 2 ✓
- 删卡 abort → Task 2（deleteCanvasItem pending 分支）✓
- NodeCard 进度覆盖层 + 无障碍 + 降低动态 → Task 3 ✓
- i18n `common.uploading` 六语 → Task 3 ✓
- 上传入口透传落位 → Task 4 ✓
- 全量验证 → Task 5 ✓

**2. Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。「先 grep 确认变量名/import」为实施防错提示，非占位。

**3. Type consistency：** `uploadCanvasItem(pid, file, onProgress?, signal?)` 在 Task 1 定义、Task 2 消费一致；`Asset.progress` Task 2 定义、Task 3 消费一致；`uploadAsset(file, opts?)` Task 2 定义、Task 4 消费一致；`resolveEnvelope`/`setAssetProgress`/`throttleRatio`/`registerUpload`/`abortUpload` 命名前后一致。
