# 外部页 Remix 跳转(进入即 fork)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让外部页带 `?remix=<public_id>` 跳进 `/studio` 时,工作台进入即 fork 该项目为当前用户的新可编辑项目并加载。

**Architecture:** 镜像现有 studio-prelude 三层分工——纯解析函数(`lib/studio-prelude.ts`)+ 副作用 ServerAction(`store/actions.ts`)+ bootstrap 三选一(`client/useProjectBootstrap.ts`)。复用已落地的 `pgcApi.createRemix`,不改接口、不改 Landing。

**Tech Stack:** Next.js 16 + React 19 + zustand;Vitest + jsdom(测试同目录 `*.test`)。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**;commit 一句话总结。
- 不臆测后端字段:只取 `data.project`;`createRemix` 只传 `{ source_code }`,不传 `name`/`version_id`。
- 错误兜底走现有 `guard`:401 → `authRequired`(交 `useAuthGuard`);其余 `PgcError` → `lastError`(Toast);非 `PgcError` 照抛。
- 重复 fork 防护:仅靠 bootstrap 的 `ran` once 守护 + 成功后即剥 URL,两者缺一不可。
- 不绕过 basePath(本计划只读 `location.search`,无新增自身绝对路径)。

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/lib/studio-prelude.ts` | 外部页经 /studio URL 进参的纯解析 | 新增 `parseRemixSource` |
| `src/lib/studio-prelude.test.ts` | 上者单测 | 追加 `parseRemixSource` 用例 |
| `src/store/actions.ts` | 服务端编排(PGC REST 驱动) | 新增 ServerAction `applyStudioRemix` + 导入 `withProjectParam` |
| `src/store/studio-remix.test.ts` | `applyStudioRemix` 单测 | **新建** |
| `src/client/useProjectBootstrap.ts` | 挂载时入口分发 | 二选一 → 三选一(remix 优先) |
| `src/client/useProjectBootstrap.test.tsx` | bootstrap 单测 | 追加 remix 分支用例 + mock 补 `createRemix` |

---

### Task 1: `parseRemixSource` 纯解析函数

**Files:**
- Modify: `src/lib/studio-prelude.ts`(末尾追加导出 + 无新增 import)
- Test: `src/lib/studio-prelude.test.ts`(顶部 import 补 `parseRemixSource`,末尾追加 3 个 test)

**Interfaces:**
- Produces: `export function parseRemixSource(search: string): string | null` —— 解析 `?remix=<public_id>`,空/缺省返回 `null`,非空原样返回(作 `createRemix` 的 `source_code`)。

- [ ] **Step 1: 写失败测试**

在 `src/lib/studio-prelude.test.ts` 末尾追加:

```ts
test('parseRemixSource:?remix=<public_id> → 返回 code', () => {
  expect(parseRemixSource(search({ remix: 'DakkYXUy' }))).toBe('DakkYXUy');
});

test('parseRemixSource:无 remix / 空串 → null', () => {
  expect(parseRemixSource('')).toBeNull();
  expect(parseRemixSource(search({ remix: '' }))).toBeNull();
  expect(parseRemixSource(search({ foo: 'bar' }))).toBeNull();
});

test('parseRemixSource:与 prelude 参共存 → 各自独立解析', () => {
  const s = search({ remix: 'DakkYXUy', model: 'claude-x' });
  expect(parseRemixSource(s)).toBe('DakkYXUy');
  expect(parseStudioPrelude(s)).toEqual({ model: 'claude-x', assets: [] });
});
```

并把第 2 行 import 改为(补 `parseRemixSource`):

```ts
import { parseStudioPrelude, parseRemixSource, assetSeedLabel } from './studio-prelude';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: FAIL —— `parseRemixSource is not a function` / 未导出。

- [ ] **Step 3: 写最小实现**

在 `src/lib/studio-prelude.ts` 末尾(`assetSeedLabel` 之后)追加:

```ts
// 解析 ?remix=<public_id>(外部页带 fork 跳转);空/缺省返回 null。public_id 直接作 createRemix 的 source_code
export function parseRemixSource(search: string): string | null {
  const v = new URLSearchParams(search).get('remix');
  return v && v.trim() ? v : null; // 空串视为缺省
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: PASS（含原有 prelude/assetSeedLabel 用例不回归）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/studio-prelude.ts src/lib/studio-prelude.test.ts
git commit -m "feat: 新增 parseRemixSource 解析外部页 ?remix= 跳转参"
```

---

### Task 2: `applyStudioRemix` ServerAction

**Files:**
- Modify: `src/store/actions.ts`(导入补 `withProjectParam`;在 `downloadActiveVersion` 之后、`return {` 之前新增 `applyStudioRemix`;`return {` 对象补 `applyStudioRemix`)
- Test: `src/store/studio-remix.test.ts`(**新建**)

**Interfaces:**
- Consumes: 本地闭包 `guard`、`selectProject`、`loadProjects`;`pgcApi.createRemix({ source_code })`(已存在,返回 `RemixProjectData`,见 `src/lib/pgc/types.ts`);`withProjectParam(search, id)`(见 `src/lib/project-url.ts`)。
- Produces: ServerAction `applyStudioRemix(sourceCode: string): Promise<void>` —— 经 `ReturnType<typeof createServerActions>` 自动并入 `ServerActions`/`AppStore`,Task 3 由 `useStore((s) => s.applyStudioRemix)` 取用。

- [ ] **Step 1: 写失败测试(新建测试文件)**

新建 `src/store/studio-remix.test.ts`,镜像 `src/store/studio-prelude.test.ts` 的 mock/重置范式(但 mock 改为 `createRemix` + `listProjects`):

```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError 供 instanceof),仅替换 api 方法为 mock(沿用 studio-prelude.test.ts 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      createRemix: vi.fn(), listProjects: vi.fn(),
      listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
    },
  };
});

import { useStore } from './index';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from './types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const proj = (id: number) => ({
  id, public_id: `p${id}`, name: 'P', cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
});
// createRemix 返回 RemixProjectData;本计划只用 data.project,其余字段填占位
const remixData = (id: number) => ({
  project: proj(id), source_code: 'SRC', source_version_id: 'sv', target_version_id: 'tv',
  play_url: '', working_preview_url: '',
});

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    composer: { draft: '', refs: [], attachments: [] }, selectedModel: null, availableModels: [],
  });
  vi.clearAllMocks();
  api.updateCanvasReference.mockResolvedValue({});
  api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
  api.listVersions.mockResolvedValue({ items: [], total: 0 });
  window.history.replaceState(null, '', '/studio?remix=DakkYXUy');
});
afterEach(() => vi.restoreAllMocks());

test('applyStudioRemix:fork 源项目 + 入列选中 + 剥离 remix 参', async () => {
  api.createRemix.mockResolvedValue(remixData(9));
  await useStore.getState().applyStudioRemix('DakkYXUy');
  const s = useStore.getState();
  expect(api.createRemix).toHaveBeenCalledWith({ source_code: 'DakkYXUy' }); // 只传 source_code
  expect(s.currentProjectId).toBe(9);
  expect(s.projects[0].id).toBe(9);                  // fork 入列头
  expect(window.location.search).toBe('?project=p9'); // remix 参被剥,仅留 ?project=<fork public_id>
  expect(s.booting).toBe(false);                      // remix 分支不经 loadProjects 的 finally,自行撤加载层
  expect(api.listProjects).not.toHaveBeenCalled();    // 成功不兜底
});

test('applyStudioRemix:fork 失败(REMIX_NOT_AVAILABLE)→ Toast + 兜底 loadProjects', async () => {
  api.createRemix.mockRejectedValue(new PgcError('REMIX_NOT_AVAILABLE', 'not available', 400));
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  await useStore.getState().applyStudioRemix('x');
  const s = useStore.getState();
  expect(s.lastError?.code).toBe('REMIX_NOT_AVAILABLE'); // guard 透传后端 code
  expect(api.listProjects).toHaveBeenCalled();           // 兜底拉用户项目
  expect(s.currentProjectId).toBe(1);                    // 落在自己的项目,非空工作台
  expect(s.booting).toBe(false);
});

test('applyStudioRemix:fork 失败 401 → 置 authRequired,不写 lastError', async () => {
  api.createRemix.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401));
  api.listProjects.mockRejectedValue(new PgcError('UNAUTH', 'login required', 401)); // 兜底同样 401
  await useStore.getState().applyStudioRemix('x');
  const s = useStore.getState();
  expect(s.authRequired).toBe(true);
  expect(s.lastError).toBeNull(); // 401 只置 authRequired,不弹红色报错
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/studio-remix.test.ts`
Expected: FAIL —— `applyStudioRemix is not a function`。

- [ ] **Step 3: 写最小实现**

在 `src/store/actions.ts` 顶部 import(第 2 行)补 `withProjectParam`:

```ts
import { readProjectIdFromSearch, syncProjectToUrl, withProjectParam } from '@/lib/project-url';
```

在 `downloadActiveVersion` 定义之后、`return {` 之前新增:

```ts
  // 外部页经 ?remix=<public_id> 进入:fork 源项目为当前用户的新项目并选中,最后剥离 URL 上的 remix 参;
  // fork 失败(源未开放 / 网络 / 401)兜底 loadProjects,避免空工作台。bootstrap 仅在挂载时调一次(ran 守护 + 剥 URL 防重复 fork)
  const applyStudioRemix = async (sourceCode: string) => {
    await guard(set, async () => {
      const data = await pgcApi.createRemix({ source_code: sourceCode }); // 不传 name/version_id,后端取默认
      set({ projects: [data.project, ...get().projects] });
      await selectProject(data.project.id); // 落地 currentProjectId + 同步 URL + loadCanvas/loadVersions
    });
    const pid = get().currentProjectId;
    if (pid != null) {
      // fork 成功:剥掉 ?remix=,仅留 ?project=<fork public_id>(selectProject 内 syncProjectToUrl 用 withProjectParam 会保留旧 remix 参,故从空串重写)
      if (typeof window !== 'undefined') {
        const publicId = get().projects.find((p) => p.id === pid)?.public_id ?? null;
        const next = withProjectParam('', publicId);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
      }
      set({ booting: false }); // remix 分支不经 loadProjects 的 finally,自行撤加载层
    } else {
      // fork 失败(guard 已置 lastError/authRequired):兜底载入用户自己的项目,避免空工作台;loadProjects 自己撤 booting + 纠正 URL(覆盖 ?remix=)
      await loadProjects();
    }
  };
```

在 `return {` 对象里追加 `applyStudioRemix`(与 `importGeneratedAsset` 同行或新增一行):

```ts
  return {
    loadProjects, selectProject, createProject, renameProject, deleteProject,
    loadCanvas, loadVersions, generateImage, generateAudio, generateVideo, generateModel3d,
    uploadAsset, deleteCanvasItem, persistAssetPosition, pollGenTasks, restoreGenTasks,
    publishVersion, pollVersions, previewVersionById, downloadActiveVersion,
    importGeneratedAsset, applyStudioRemix,
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/studio-remix.test.ts`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（`applyStudioRemix` 经 `ReturnType` 自动并入 `ServerActions`/`AppStore`）。

- [ ] **Step 6: 提交**

```bash
git add src/store/actions.ts src/store/studio-remix.test.ts
git commit -m "feat: 新增 applyStudioRemix —— 进入即 fork 源项目并兜底回退"
```

---

### Task 3: bootstrap 二选一 → 三选一(remix 优先)

**Files:**
- Modify: `src/client/useProjectBootstrap.ts`
- Test: `src/client/useProjectBootstrap.test.tsx`(mock 补 `createRemix`;追加 remix 分支用例)

**Interfaces:**
- Consumes: `parseRemixSource`(Task 1)、`applyStudioRemix`(Task 2,经 `useStore((s) => s.applyStudioRemix)`)。

- [ ] **Step 1: 写失败测试**

把 `src/client/useProjectBootstrap.test.tsx` 顶部 mock 块的 `pgcApi` 补 `createRemix`:

```ts
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(), createRemix: vi.fn(),
      listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
    },
```

在文件末尾追加用例:

```ts
test('URL 带 remix → 进入即 fork,不预填/不拉列表', async () => {
  api.createRemix.mockResolvedValue({
    project: proj(9), source_code: 's', source_version_id: 'sv', target_version_id: 'tv',
    play_url: '', working_preview_url: '',
  });
  window.history.replaceState(null, '', '/studio?remix=DakkYXUy');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.createRemix).toHaveBeenCalledWith({ source_code: 'DakkYXUy' }));
  expect(api.listProjects).not.toHaveBeenCalled(); // remix 优先,不走 loadProjects
  expect(api.createProject).not.toHaveBeenCalled(); // 也不走 prelude 新建
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx`
Expected: FAIL —— remix URL 下未调 `createRemix`（当前 hook 不识别 `?remix=`,会走 `loadProjects`）。

- [ ] **Step 3: 写实现**

把 `src/client/useProjectBootstrap.ts` 整体替换为:

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { parseStudioPrelude, parseRemixSource } from '@/lib/studio-prelude';

// 挂载时三选一:① ?remix=<public_id>(外部页 fork 跳转)→ 进入即 fork;② prelude(模型/提示词/资产)→ 新建预填;③ 否则拉项目列表选定当前项目。
// remix 优先(外部 remix 页只带 ?remix=);自动登录由服务端代理处理。
export function useProjectBootstrap() {
  const loadProjects = useStore((s) => s.loadProjects);
  const applyStudioPrelude = useStore((s) => s.applyStudioPrelude);
  const applyStudioRemix = useStore((s) => s.applyStudioRemix);
  const ran = useRef(false);
  useEffect(() => {
    // StrictMode 双挂载 / 重复 bootstrap 下只跑一次(remix/prelude 会新建项目,绝不可重复执行);
    // ran 在 effect 内置位(非渲染期),符合仓库 hooks 约束
    if (ran.current) return;
    ran.current = true;
    const remix = parseRemixSource(window.location.search);
    if (remix) { void applyStudioRemix(remix); return; } // 进入即 fork(成功后剥 URL,刷新不再重复 fork)
    const prelude = parseStudioPrelude(window.location.search);
    if (prelude) void applyStudioPrelude(prelude);
    else void loadProjects();
  }, [loadProjects, applyStudioPrelude, applyStudioRemix]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx`
Expected: PASS（新 remix 用例 + 原 prelude/loadProjects 两用例均不回归）。

- [ ] **Step 5: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/lib/studio-prelude.test.ts src/store/studio-remix.test.ts src/client/useProjectBootstrap.test.tsx`
Expected: 类型 / lint / 三个测试文件全绿。

- [ ] **Step 6: 提交**

```bash
git add src/client/useProjectBootstrap.ts src/client/useProjectBootstrap.test.tsx
git commit -m "feat: bootstrap 增加 remix 分支 —— ?remix= 进入即 fork(优先于 prelude)"
```

---

## Self-Review(对照 spec)

**Spec 覆盖**:
- §「接口契约」复用 `createRemix`、只传 `source_code`、不传 name/version → Task 2 Step 3 + 测试断言 `toHaveBeenCalledWith({ source_code })`。✓
- §「架构 1」`parseRemixSource` 纯函数 → Task 1。✓
- §「架构 2」`applyStudioRemix`(fork → 选中 → 剥 URL → 失败兜底)→ Task 2。✓
- §「架构 3」bootstrap 三选一 remix 优先 → Task 3。✓
- §「错误处理」401→authRequired / 其余→lastError / 兜底 loadProjects → Task 2 后两个测试。✓
- §「消费一次」成功后 URL = `?project=` → Task 2 测试断言 `?project=p9`。✓
- §「测试」三处测试点全覆盖。✓

**占位符扫描**:无 TBD/TODO;每个代码步骤给出完整可粘贴代码与确切命令。✓

**类型一致性**:`parseRemixSource(search): string|null`(Task1 定义 ↔ Task3 消费一致);`applyStudioRemix(sourceCode: string)`(Task2 定义 ↔ Task3 消费一致);`createRemix({ source_code })` 与 `RemixProjectData.project` 形状一致(Task2/Task3 mock 与断言一致)。✓
