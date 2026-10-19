# Studio Prelude(外部页面传参进入工作台)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让外部页面通过 `/studio` 的 URL query 传入「模型 / 提示词 / 多个资产」,进入工作台时新建项目并把三者分别预填到模型选择器、对话输入框、输入框上方的附件区(随提示词一起发送)。

**Architecture:** 纯解析(`lib/studio-prelude.ts`)+ store 编排 action(`applyStudioPrelude`)+ bootstrap 二选一分支(`useProjectBootstrap`),严格镜像现有 `lib/host-config.ts` + `client/useHostConfig.ts` 的"纯逻辑 / 副作用"分层。资产复用现有 `composer.attachments`(预置为 `ready` 且带现成 url、无 `itemId`),发送链路零改动。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Zustand(persist)/ Vitest + jsdom + @testing-library/react。

## Global Constraints

- 代码注释 / commit message 一律用**中文**(项目约定)。
- 不引入新机制:三个槽位全部落到现有 store 字段(`selectedModel` / `composer.draft` / `composer.attachments`),不改 `Composer.send()` 与 koubou 发送链路。
- **lib 层不依赖 store**:`lib/studio-prelude.ts` 不得 import `@/store/*` 的运行时值;`ChatAttachment` 的拼装放在 store 层(沿用 `lib/refs.ts` 自定义最小形状的约定)。
- 资产 `url` 必须**公网可达**(koubou 后端要能直接取;见 koubou WS `user.message` 契约:仅 text/image 块、图片 URL 须公网可达)。本前端只透传,不校验可达性。
- `AssetKind = 'image' | 'video' | 'audio' | '3d' | 'doc'`(`@/lib/asset-kind`);校验用 `KIND_ORDER`(同源全集)。
- 资产 id 用 `newId('att')`(与现有 `uploadChatAttachment` 一致)。
- 测试与源码**同目录**(`*.test.ts(x)`);mock `@/lib/pgc/client` 时保留真实导出(`PgcError` 供 `instanceof`),仅替换 `pgcApi` 方法,沿用 `src/store/actions.test.ts` 的写法。
- 类型检查命令:`pnpm exec tsc --noEmit`;单测命令:`pnpm exec vitest run <file>`。

---

## File Structure

- **Create** `src/lib/studio-prelude.ts` —— 纯解析:`parseStudioPrelude(search)` + `assetSeedLabel(seed)` + 类型 `AssetSeed` / `StudioPrelude`。
- **Create** `src/lib/studio-prelude.test.ts` —— 解析与 label 兜底的单测。
- **Modify** `src/store/actions.ts` —— 把 `DEFAULT_PROJECT_NAME` 从工厂内局部常量提升为**模块级 export**(供 store action 复用)。
- **Modify** `src/store/index.ts` —— 新增 `applyStudioPrelude` action(接口声明 + 实现 + 三处 import)。
- **Create** `src/store/studio-prelude.test.ts` —— `applyStudioPrelude` 的 store 层测试。
- **Modify** `src/client/useProjectBootstrap.ts` —— 挂载时二选一:有 prelude → `applyStudioPrelude`,否则 → `loadProjects`。
- **Create** `src/client/useProjectBootstrap.test.tsx` —— bootstrap 分支的 hook 测试。

---

## Task 1: 纯解析层 `lib/studio-prelude.ts`

**Files:**
- Create: `src/lib/studio-prelude.ts`
- Test: `src/lib/studio-prelude.test.ts`

**Interfaces:**
- Consumes: `AssetKind`, `KIND_ORDER`(`@/lib/asset-kind`)。
- Produces:
  - `interface AssetSeed { url: string; kind: AssetKind; name?: string }`
  - `interface StudioPrelude { model?: string; prompt?: string; assets: AssetSeed[] }`
  - `function parseStudioPrelude(search: string): StudioPrelude | null`
  - `function assetSeedLabel(seed: AssetSeed): string`

- [ ] **Step 1: 写失败测试**

Create `src/lib/studio-prelude.test.ts`:

```ts
import { expect, test } from 'vitest';
import { parseStudioPrelude, assetSeedLabel } from './studio-prelude';

// 用 URLSearchParams 构造 search,确保编码/解码闭环与生产侧一致
const search = (params: Record<string, string>) => '?' + new URLSearchParams(params).toString();
const assetsParam = (arr: unknown) => search({ assets: JSON.stringify(arr) });

test('model + prompt + assets 齐全 → 全部解析', () => {
  const s = search({
    model: 'claude-x',
    prompt: 'make a platformer',
    assets: JSON.stringify([{ url: 'https://cdn/a.png', kind: 'image', name: 'A' }]),
  });
  expect(parseStudioPrelude(s)).toEqual({
    model: 'claude-x',
    prompt: 'make a platformer',
    assets: [{ url: 'https://cdn/a.png', kind: 'image', name: 'A' }],
  });
});

test('仅 model', () => {
  expect(parseStudioPrelude(search({ model: 'claude-x' }))).toEqual({ model: 'claude-x', assets: [] });
});

test('仅 prompt', () => {
  expect(parseStudioPrelude(search({ prompt: 'hi' }))).toEqual({ prompt: 'hi', assets: [] });
});

test('仅 assets', () => {
  expect(parseStudioPrelude(assetsParam([{ url: 'https://cdn/a.mp4', kind: 'video' }]))).toEqual({
    assets: [{ url: 'https://cdn/a.mp4', kind: 'video' }],
  });
});

test('空 search / 三者皆空 → null', () => {
  expect(parseStudioPrelude('')).toBeNull();
  expect(parseStudioPrelude('?')).toBeNull();
  expect(parseStudioPrelude(search({ foo: 'bar' }))).toBeNull();
  expect(parseStudioPrelude(search({ model: '', prompt: '' }))).toBeNull();
});

test('assets 非法 JSON → 回退空数组(无 model/prompt 则整体 null)', () => {
  expect(parseStudioPrelude(search({ assets: 'not-json' }))).toBeNull();
  expect(parseStudioPrelude(search({ model: 'm', assets: 'not-json' }))).toEqual({ model: 'm', assets: [] });
});

test('assets 含非法条目 → 丢弃该条,保留合法条目', () => {
  const arr = [
    { url: 'https://cdn/ok.png', kind: 'image' }, // 合法
    { url: 'https://cdn/bad.png', kind: 'gif' },  // kind 不在枚举
    { kind: 'image' },                            // 缺 url
    { url: '', kind: 'image' },                   // 空 url
    'nope',                                        // 非对象
  ];
  expect(parseStudioPrelude(assetsParam(arr))).toEqual({
    assets: [{ url: 'https://cdn/ok.png', kind: 'image' }],
  });
});

test('assets 顶层非数组 → 空', () => {
  expect(parseStudioPrelude(search({ assets: JSON.stringify({ url: 'x', kind: 'image' }) }))).toBeNull();
});

test('assetSeedLabel:有 name 用 name', () => {
  expect(assetSeedLabel({ url: 'https://cdn/x.png', kind: 'image', name: 'Hero' })).toBe('Hero');
});

test('assetSeedLabel:无 name → 从 url 取文件名(去 query/hash)', () => {
  expect(assetSeedLabel({ url: 'https://cdn/path/hero.png?v=1#frag', kind: 'image' })).toBe('hero.png');
});

test('assetSeedLabel:无文件名可取 → 回退整个 url', () => {
  expect(assetSeedLabel({ url: 'https://cdn', kind: 'image' })).toBe('https://cdn');
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: FAIL —— `parseStudioPrelude` / `assetSeedLabel` 未定义(模块解析报错)。

- [ ] **Step 3: 实现 `src/lib/studio-prelude.ts`**

```ts
// 解析外部页面经 /studio URL query 传入的预填参数(模型 / 提示词 / 资产),校验并归一。
// 纯函数、无副作用、不依赖 store —— 副作用(新建项目/写 store/剥离 URL)由 store action applyStudioPrelude 负责。
import { KIND_ORDER, type AssetKind } from './asset-kind';

// 资产种子:外部页传来的已入库资产,仅 url(公网可达)必填;kind 决定缩略图与发送路由;name 仅作 chip 标签
export interface AssetSeed { url: string; kind: AssetKind; name?: string }
export interface StudioPrelude { model?: string; prompt?: string; assets: AssetSeed[] }

// assets 参数:encodeURIComponent(JSON.stringify(AssetSeed[]));逐条校验,非法条目丢弃,解析失败回退空数组
function parseAssets(raw: string | null): AssetSeed[] {
  if (!raw) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return []; } // 非法 JSON:整体回退空(沿用"非法帧跳过"哲学)
  if (!Array.isArray(arr)) return [];
  const out: AssetSeed[] = [];
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const { url, kind, name } = item as { url?: unknown; kind?: unknown; name?: unknown };
    if (typeof url !== 'string' || !url) continue;                       // url 必填且非空
    if (typeof kind !== 'string' || !KIND_ORDER.includes(kind as AssetKind)) continue; // kind 须在枚举内
    out.push({ url, kind: kind as AssetKind, ...(typeof name === 'string' && name ? { name } : {}) });
  }
  return out;
}

// 解析 location.search;model/prompt 皆空且 assets 为空 → 返回 null(视为无 prelude)
export function parseStudioPrelude(search: string): StudioPrelude | null {
  const params = new URLSearchParams(search);
  const model = params.get('model') || undefined;   // 空串视为缺省
  const prompt = params.get('prompt') || undefined; // URLSearchParams 已解码;空串视为缺省
  const assets = parseAssets(params.get('assets'));
  if (!model && !prompt && assets.length === 0) return null;
  return { ...(model ? { model } : {}), ...(prompt ? { prompt } : {}), assets };
}

// 附件 chip 标签:优先 name,否则取 url 文件名(去 query/hash),再否则回退整个 url
export function assetSeedLabel(seed: AssetSeed): string {
  if (seed.name) return seed.name;
  const last = seed.url.split('/').pop()?.split('?')[0]?.split('#')[0];
  return last || seed.url;
}
```

- [ ] **Step 4: 运行测试,确认通过 + 类型检查**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: PASS(全部用例)。
Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/lib/studio-prelude.ts src/lib/studio-prelude.test.ts
git commit -m "feat: studio-prelude 纯解析(URL query → 模型/提示词/资产 + label 兜底)"
```

---

## Task 2: store 编排 action `applyStudioPrelude`

**Files:**
- Modify: `src/store/actions.ts`(提升 `DEFAULT_PROJECT_NAME` 为模块级 export)
- Modify: `src/store/index.ts`(新增 action:接口 + 实现 + import)
- Test: `src/store/studio-prelude.test.ts`

**Interfaces:**
- Consumes:`parseStudioPrelude` 产出的 `StudioPrelude`(Task 1);现有 actions `createProject` / `setSelectedModel` / `composerSet`;`assetSeedLabel`(Task 1);`withProjectParam`(`@/lib/project-url`);`DEFAULT_PROJECT_NAME`(本任务从 actions.ts 导出);`newId`、`ChatAttachment`(index.ts 已 import)。
- Produces:`applyStudioPrelude: (prelude: StudioPrelude) => Promise<void>`(store action)。

- [ ] **Step 1: 写失败测试**

Create `src/store/studio-prelude.test.ts`:

```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// 保留真实导出(PgcError 供 instanceof),仅替换 api 方法为 mock(沿用 actions.test.ts 写法)
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      createProject: vi.fn(), listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
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

beforeEach(() => {
  // 须连 composer/selectedModel 一并重置(不在 koubou/server initial 内)
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    composer: { draft: '', refs: [], attachments: [] }, selectedModel: null, availableModels: [],
  });
  vi.clearAllMocks();
  api.updateCanvasReference.mockResolvedValue({});
  api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
  api.listVersions.mockResolvedValue({ items: [], total: 0 });
  window.history.replaceState(null, '', '/studio?model=m&prompt=p&assets=x');
});
afterEach(() => vi.restoreAllMocks());

test('applyStudioPrelude:新建项目 + 预填模型/输入框/资产 + 剥离 URL', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({
    model: 'claude-x',
    prompt: 'make a game',
    assets: [
      { url: 'https://cdn/hero.png?v=1', kind: 'image', name: 'Hero' },
      { url: 'https://cdn/clip.mp4', kind: 'video' },
    ],
  });
  const s = useStore.getState();
  expect(api.createProject).toHaveBeenCalledWith('Untitled game'); // 强制新建(默认名)
  expect(s.currentProjectId).toBe(9);
  expect(s.selectedModel).toBe('claude-x');
  expect(s.composer.draft).toBe('make a game');
  expect(s.composer.attachments).toHaveLength(2);
  expect(s.composer.attachments[0]).toMatchObject({ kind: 'image', status: 'ready', url: 'https://cdn/hero.png?v=1', name: 'Hero' });
  expect(s.composer.attachments[0].itemId).toBeUndefined(); // 无 itemId → 移除不会误删 PGC
  expect(s.composer.attachments[1]).toMatchObject({ kind: 'video', status: 'ready', name: 'clip.mp4' }); // 文件名兜底
  // URL 收敛:prelude 参数被剥离,仅留 ?project=<public_id>
  expect(window.location.search).toBe('?project=p9');
  expect(s.booting).toBe(false); // prelude 分支不经 loadProjects 的 finally,须自行撤加载层
});

test('applyStudioPrelude:model 缺省 → 不改 selectedModel', async () => {
  api.createProject.mockResolvedValue(proj(9));
  await useStore.getState().applyStudioPrelude({ prompt: 'hi', assets: [] });
  expect(useStore.getState().selectedModel).toBeNull();
  expect(useStore.getState().composer.draft).toBe('hi');
});

test('applyStudioPrelude:createProject 失败 → 不预填,置 lastError,撤加载层', async () => {
  api.createProject.mockRejectedValue(new PgcError('INTERNAL', 'boom', 500));
  await useStore.getState().applyStudioPrelude({
    model: 'claude-x', prompt: 'hi', assets: [{ url: 'https://x/a.png', kind: 'image' }],
  });
  const s = useStore.getState();
  expect(s.currentProjectId).toBeNull();
  expect(s.composer.draft).toBe('');
  expect(s.composer.attachments).toEqual([]);
  expect(s.selectedModel).toBeNull();
  expect(s.lastError?.code).toBe('INTERNAL');
  expect(s.booting).toBe(false);
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm exec vitest run src/store/studio-prelude.test.ts`
Expected: FAIL —— `applyStudioPrelude` 不是函数 / 未定义。

- [ ] **Step 3a: 提升 `DEFAULT_PROJECT_NAME` 为模块级 export(`src/store/actions.ts`)**

把工厂内的局部常量改为模块级导出。找到:

```ts
export function createServerActions(set: Set, get: Get) {
  // 无项目时自动建项目的默认名(维持「平台恒有 ≥1 项目」不变式;用户/agent 可后续改名)
  const DEFAULT_PROJECT_NAME = 'Untitled game';
```

改为(常量移到函数外、加 export;函数体内引用不变):

```ts
// 无项目时自动建项目的默认名(维持「平台恒有 ≥1 项目」不变式;用户/agent 可后续改名);studio-prelude 新建项目亦复用
export const DEFAULT_PROJECT_NAME = 'Untitled game';

export function createServerActions(set: Set, get: Get) {
```

(其余对 `DEFAULT_PROJECT_NAME` 的引用——`loadProjects`、`deleteProject` 内——保持原样,现引用模块级常量。)

- [ ] **Step 3b: 加 import + 接口声明 + 实现(`src/store/index.ts`)**

(1) 改 actions import(第 13 行)带上 `DEFAULT_PROJECT_NAME`:

```ts
import { createServerActions, DEFAULT_PROJECT_NAME, type ServerActions } from './actions';
```

(2) 新增两条 import(放在其他 `@/lib/*` import 附近,如 `newId` import 之后):

```ts
import { withProjectParam } from '@/lib/project-url';
import { assetSeedLabel, type StudioPrelude } from '@/lib/studio-prelude';
```

(3) `Actions` 接口里,在 `setSelectedModel: (id: string) => void;` 之后加一行:

```ts
  applyStudioPrelude: (prelude: StudioPrelude) => Promise<void>;
```

(4) 在 store 实现对象里(与其他 action 平级,放在 `setSelectedModel` 实现之后)加实现:

```ts
      // 外部页面经 URL 传参进入:强制新建项目承载本次会话,再预填模型/输入框/资产,最后剥离 URL 上的 prelude 参数。
      applyStudioPrelude: async (prelude) => {
        try {
          // 强制新建(不复用最近项目);createProject 经 guard,失败时 currentProjectId 不落地
          await get().createProject(DEFAULT_PROJECT_NAME);
          const pid = get().currentProjectId;
          if (pid == null) return; // 新建失败:跳过预填(lastError 已由 guard 置)
          if (prelude.model) get().setSelectedModel(prelude.model);
          get().composerSet({
            draft: prelude.prompt ?? '',
            // 资产已在 PGC 入库、传 url:预置为 ready 附件(无 itemId → 移除仅本地丢弃、不删 PGC),
            // AttachmentBar 在输入框上方渲染、Composer.send 已有路径随消息发送
            attachments: prelude.assets.map((a): ChatAttachment => ({
              id: newId('att'), name: assetSeedLabel(a), mime: '', kind: a.kind, status: 'ready', url: a.url,
            })),
          });
          // 收敛 URL:剥掉 model/prompt/assets,仅留 ?project=<public_id>
          // (createProject 内 syncProjectToUrl 用 withProjectParam 会保留旧参数,故须显式重写)
          if (typeof window !== 'undefined') {
            const publicId = get().projects.find((p) => p.id === pid)?.public_id ?? null;
            const next = withProjectParam('', publicId);
            window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
          }
        } finally {
          set({ booting: false }); // 撤全局加载层(prelude 分支不经 loadProjects 的 finally)
        }
      },
```

- [ ] **Step 4: 运行测试,确认通过 + 类型检查**

Run: `pnpm exec vitest run src/store/studio-prelude.test.ts`
Expected: PASS(3 个用例)。
Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS(确认 `DEFAULT_PROJECT_NAME` 提升未破坏既有项目 actions 测试)。
Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/index.ts src/store/studio-prelude.test.ts
git commit -m "feat: applyStudioPrelude —— 新建项目并预填模型/提示词/资产 + 剥离 URL"
```

---

## Task 3: bootstrap 二选一分支 `useProjectBootstrap`

**Files:**
- Modify: `src/client/useProjectBootstrap.ts`
- Test: `src/client/useProjectBootstrap.test.tsx`

**Interfaces:**
- Consumes:`parseStudioPrelude`(Task 1);store actions `loadProjects` / `applyStudioPrelude`(Task 2)。
- Produces:无新导出(改造现有 `useProjectBootstrap`,签名不变)。

- [ ] **Step 1: 写失败测试**

Create `src/client/useProjectBootstrap.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: {
      listProjects: vi.fn(), createProject: vi.fn(),
      listCanvasItems: vi.fn(), listVersions: vi.fn(), updateCanvasReference: vi.fn(),
    },
  };
});

import { useProjectBootstrap } from './useProjectBootstrap';
import { useStore } from '@/store';
import { pgcApi } from '@/lib/pgc/client';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const api = pgcApi as unknown as Record<string, ReturnType<typeof vi.fn>>;
const proj = (id: number) => ({
  id, public_id: `p${id}`, name: 'P', cover_url: null, cover_source: null,
  current_version_id: null, status: 'draft', created_at: '', updated_at: '',
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
});
afterEach(() => vi.restoreAllMocks());

test('URL 带 prelude → 新建项目并预填,不拉项目列表', async () => {
  api.createProject.mockResolvedValue(proj(9));
  const assets = encodeURIComponent(JSON.stringify([{ url: 'https://cdn/a.png', kind: 'image' }]));
  window.history.replaceState(null, '', `/studio?model=claude-x&prompt=hi&assets=${assets}`);
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.createProject).toHaveBeenCalledWith('Untitled game'));
  expect(api.listProjects).not.toHaveBeenCalled();
  expect(useStore.getState().selectedModel).toBe('claude-x');
  expect(useStore.getState().composer.draft).toBe('hi');
  expect(useStore.getState().composer.attachments).toHaveLength(1);
});

test('URL 无 prelude → 走 loadProjects', async () => {
  api.listProjects.mockResolvedValue({ items: [proj(1)], total: 1, page: 1, page_size: 100 });
  window.history.replaceState(null, '', '/studio');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(api.listProjects).toHaveBeenCalled());
  expect(api.createProject).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx`
Expected: FAIL —— 现有 `useProjectBootstrap` 无条件调 `loadProjects`,prelude 用例里 `createProject` 不会被调用 / `listProjects` 反被调用。

- [ ] **Step 3: 改造 `src/client/useProjectBootstrap.ts`**

整文件替换为:

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { parseStudioPrelude } from '@/lib/studio-prelude';

// 挂载时二选一:URL 带 prelude(外部页传 模型/提示词/资产)→ 新建项目并预填;否则拉项目列表选定当前项目。
// 自动登录由服务端代理处理。
export function useProjectBootstrap() {
  const loadProjects = useStore((s) => s.loadProjects);
  const applyStudioPrelude = useStore((s) => s.applyStudioPrelude);
  const ran = useRef(false);
  useEffect(() => {
    // StrictMode 双挂载 / 重复 bootstrap 下只跑一次(prelude 会新建项目,绝不可重复执行);
    // ran 在 effect 内置位(非渲染期),符合仓库 hooks 约束
    if (ran.current) return;
    ran.current = true;
    const prelude = parseStudioPrelude(window.location.search);
    if (prelude) void applyStudioPrelude(prelude);
    else void loadProjects();
  }, [loadProjects, applyStudioPrelude]);
}
```

- [ ] **Step 4: 运行测试,确认通过 + 类型检查 + lint**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx`
Expected: PASS(2 个用例)。
Run: `pnpm exec tsc --noEmit`
Expected: 无错误。
Run: `pnpm lint`
Expected: 无错误(确认 `ran` 的 effect 内置位不触犯 react-hooks 规则)。

- [ ] **Step 5: 提交**

```bash
git add src/client/useProjectBootstrap.ts src/client/useProjectBootstrap.test.tsx
git commit -m "feat: bootstrap 按 URL prelude 二选一(新建预填项目 / 拉项目列表)"
```

---

## Task 4: 全量校验

**Files:** 无新增,只跑全套检查。

- [ ] **Step 1: 全量类型 + 测试 + 构建**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。
Run: `pnpm test`
Expected: 全绿(含新增 3 个测试文件)。
Run: `pnpm lint`
Expected: 无错误。
Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 2:(无新文件需提交;若前序遗漏改动则补提交)**

```bash
git status --short   # 应为空
```

---

## 生产侧契约(交付给外部页面团队,不在本计划实现)

外部页面用 `pagePath('/studio')`(`@/lib/basePath`,补 basePath 前缀)拼 URL,query 形如:

```
/studio?model=<id>&prompt=<text>&assets=<json>
```

- `assets` = `encodeURIComponent(JSON.stringify([{ url, kind, name? }, ...]))`,或用 `URLSearchParams.set('assets', JSON.stringify(arr))` 自动编码。
- `url` 须**公网可达**(koubou 后端直接取;勿传 `/api/pgc/asset` 同源代理地址)。
- `kind ∈ { image, video, audio, 3d, doc }`;`image` 走 image 内容块,其余折进文本 `@url`。
- 三参数均可选;全缺则 `/studio` 走原有项目选定逻辑。

---

## Self-Review(对照 spec)

**1. Spec 覆盖**
- URL schema(model/prompt/assets + AssetSeed)→ Task 1 `parseStudioPrelude`。✓
- 资产落 `composer.attachments`(ready/url/无 itemId)→ Task 2 `applyStudioPrelude`。✓
- 进入时新建项目(不复用)→ Task 2 `createProject(DEFAULT_PROJECT_NAME)`。✓
- 模型预填 + 异步列表时序 → Task 2 `setSelectedModel`(`resolveSelectedModel` 在 `useModelList` 到达时自动调和,无需本计划改动)。✓
- 消费一次 + URL 剥离(仅留 ?project)→ Task 2 URL 重写。✓
- bootstrap 二选一、避免双建(`ran` 守护)→ Task 3。✓
- booting 撤层 → Task 2 finally。✓
- 不自动发送(只预填)→ 全程无 `send`/`sendUserMessage` 调用。✓
- 测试:解析全/缺/非法 + label;action 层新建+预填+剥离+失败兜底;bootstrap 分支 → Task 1/2/3。✓

**2. 占位符扫描**:无 TBD / "类似上文" / 空泛"加错误处理";每个代码步骤含完整代码。✓

**3. 类型一致性**:`AssetSeed`/`StudioPrelude` 跨任务一致;`applyStudioPrelude` 签名(接口声明 ↔ 实现 ↔ 调用 ↔ 测试)一致;`assetSeedLabel`/`DEFAULT_PROJECT_NAME`/`withProjectParam` 引用名与定义一致。✓
