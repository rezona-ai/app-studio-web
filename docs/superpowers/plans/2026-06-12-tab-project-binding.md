# 页签与项目绑定（URL ?project 参数持久化）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「当前项目」绑定到页签 URL（`?project=<id>`），多页签各开各的项目，刷新还原本页签项目；新页签无参数时回退 localStorage 最近使用的项目。

**Architecture:** 新增纯函数模块 `src/lib/project-url.ts`（解析/改写 search 串 + 薄副作用 `replaceState` 包装），在 `src/store/actions.ts` 的 `loadProjects` 中把 URL 参数作为最高优先级项目来源，并在项目选定/切换/删空时把结果写回 URL。不新增路由、不改 persist 配置。

**Tech Stack:** TypeScript、zustand、Vitest（jsdom）。

**设计稿:** `docs/superpowers/specs/2026-06-12-tab-project-binding-design.md`

---

### Task 1: 纯函数模块 `project-url`

**Files:**
- Create: `src/lib/project-url.ts`
- Test: `src/lib/project-url.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/project-url.test.ts
import { describe, expect, test } from 'vitest';
import { readProjectIdFromSearch, withProjectParam } from './project-url';

describe('readProjectIdFromSearch', () => {
  test('解析合法正整数 id', () => {
    expect(readProjectIdFromSearch('?project=123')).toBe(123);
  });
  test('缺失参数返回 null', () => {
    expect(readProjectIdFromSearch('')).toBeNull();
    expect(readProjectIdFromSearch('?foo=1')).toBeNull();
  });
  test('非法值(非正整数/非数字/浮点/负数)返回 null', () => {
    expect(readProjectIdFromSearch('?project=abc')).toBeNull();
    expect(readProjectIdFromSearch('?project=0')).toBeNull();
    expect(readProjectIdFromSearch('?project=-3')).toBeNull();
    expect(readProjectIdFromSearch('?project=1.5')).toBeNull();
    expect(readProjectIdFromSearch('?project=')).toBeNull();
  });
});

describe('withProjectParam', () => {
  test('空 search 写入参数', () => {
    expect(withProjectParam('', 7)).toBe('?project=7');
  });
  test('更新已有参数并保留其他参数', () => {
    expect(withProjectParam('?foo=1&project=2', 9)).toBe('?foo=1&project=9');
  });
  test('id 为 null 时移除参数;移除后无参数返回空串', () => {
    expect(withProjectParam('?project=2', null)).toBe('');
    expect(withProjectParam('?foo=1&project=2', null)).toBe('?foo=1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/project-url.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/lib/project-url.ts
// 页签与项目绑定:当前项目 id 以 ?project=<id> 形式存在本页签 URL 中,
// 多页签互不干扰;只动 query 不动 pathname,天然兼容部署 basePath(/game)。

// 解析 search 串中的 project 参数;非正整数一律视为非法返回 null
export function readProjectIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('project');
  if (raw == null || !/^[1-9]\d*$/.test(raw)) return null;
  return Number(raw);
}

// 返回更新(或 id 为 null 时移除)project 参数后的 search 串;保留其他参数
export function withProjectParam(search: string, id: number | null): string {
  const params = new URLSearchParams(search);
  if (id == null) params.delete('project');
  else params.set('project', String(id));
  const s = params.toString();
  return s ? `?${s}` : '';
}

// 薄副作用包装:把项目 id 写回本页签 URL(replaceState 不产生历史记录);非浏览器环境 no-op
export function syncProjectToUrl(id: number | null): void {
  if (typeof window === 'undefined') return;
  const next = withProjectParam(window.location.search, id);
  if (next === window.location.search) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/project-url.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/project-url.ts src/lib/project-url.test.ts
git commit -m "feat: 新增 project-url 纯函数模块(URL project 参数解析/改写/回写)"
```

---

### Task 2: `loadProjects` 三级优先级 + 选定后写回 URL

**Files:**
- Modify: `src/store/actions.ts:121-135`（`loadProjects`）
- Test: `src/store/actions.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 的 `describe('项目 actions', ...)` 内追加（jsdom 下用 `history.replaceState` 设置页签 URL）：

```ts
  test('loadProjects:URL ?project 优先于持久化的 currentProjectId', async () => {
    window.history.replaceState(null, '', '/?project=8');
    api.listProjects.mockResolvedValue({ items: [
      { id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
      { id: 8, name: 'B', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ], total: 2, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    useStore.setState({ currentProjectId: 7 });   // 持久化恢复的「最近使用」
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(8);
    expect(window.location.search).toBe('?project=8');
  });

  test('loadProjects:URL 项目不在列表中则回退持久化值,并纠正 URL', async () => {
    window.history.replaceState(null, '', '/?project=999');
    api.listProjects.mockResolvedValue({ items: [
      { id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    useStore.setState({ currentProjectId: 7 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(window.location.search).toBe('?project=7');
  });

  test('loadProjects:无 URL 参数时沿用现状(持久化值),并把选定项目写入 URL', async () => {
    window.history.replaceState(null, '', '/');
    api.listProjects.mockResolvedValue({ items: [
      { id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(window.location.search).toBe('?project=7');
  });

  test('loadProjects:项目列表为空时清空 currentProjectId 并移除 URL 参数', async () => {
    window.history.replaceState(null, '', '/?project=8');
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBeNull();
    expect(window.location.search).toBe('');
  });
```

注意：现有用例未重置 URL，新用例每条开头都显式 `replaceState` 设定 URL，避免用例间串扰；同时在文件 `beforeEach` 末尾追加一行兜底复位：

```ts
  window.history.replaceState(null, '', '/');
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: 新增 4 条用例 FAIL（URL 未参与选定/未写回），原有用例 PASS

- [ ] **Step 3: 实现**

`src/store/actions.ts` 顶部加导入：

```ts
import { readProjectIdFromSearch, syncProjectToUrl } from '@/lib/project-url';
```

`loadProjects` 改为（替换 `actions.ts:121-135` 整段）：

```ts
  const loadProjects = async () => guard(set, async () => {
    try {
      const data = await pgcApi.listProjects();
      set({ projects: data.items });
      // 选定优先级:本页签 URL ?project(页签↔项目绑定) > 持久化的最近使用 > 列表第一个
      const fromUrl = typeof window === 'undefined' ? null : readProjectIdFromSearch(window.location.search);
      const urlValid = fromUrl != null && data.items.some((p) => p.id === fromUrl);
      const cur = get().currentProjectId;
      const stillThere = cur != null && data.items.some((p) => p.id === cur);
      const pick = urlValid ? fromUrl : stillThere ? cur! : data.items[0]?.id ?? null;
      if (pick != null && pick !== cur) await selectProject(pick);
      else if (pick != null && get().assets.length === 0) { await Promise.all([loadCanvas(), loadVersions()]); restoreGenTasks(pick); }
      else if (pick == null) set({ currentProjectId: null });
      // 其余情况:当前项目未变且已有数据,跳过重复拉取
      // 无论来源,选定结果写回本页签 URL(URL 中非法/已删除的 id 由此被纠正)
      syncProjectToUrl(pick);
    } finally {
      set({ booting: false });   // 首拉结束(成功或失败)即撤全局加载层
    }
  });
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含原有用例。注:`pick !== cur` 时走 `selectProject`,该函数 Task 3 才写 URL——本 task 的 `syncProjectToUrl(pick)` 在 `loadProjects` 末尾兜底,故 4 条新用例此时即应通过）

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: loadProjects 以 URL ?project 为最高优先级并把选定项目写回 URL"
```

---

### Task 3: `selectProject` / `deleteProject` 同步 URL

**Files:**
- Modify: `src/store/actions.ts:109-119`（`selectProject`）、`src/store/actions.ts:148-158`（`deleteProject`）
- Test: `src/store/actions.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试**

在 `describe('项目 actions', ...)` 内追加：

```ts
  test('selectProject 切换后把项目 id 写入本页签 URL', async () => {
    window.history.replaceState(null, '', '/?project=1');
    useStore.setState({ currentProjectId: 1 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(2);
    expect(window.location.search).toBe('?project=2');
  });

  test('deleteProject 删空全部项目后移除 URL 参数', async () => {
    window.history.replaceState(null, '', '/?project=1');
    useStore.setState({ currentProjectId: 1, projects: [
      { id: 1, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ] });
    api.deleteProject.mockResolvedValue({});
    await useStore.getState().deleteProject(1);
    expect(useStore.getState().currentProjectId).toBeNull();
    expect(window.location.search).toBe('');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: 新增 2 条用例 FAIL

- [ ] **Step 3: 实现**

`selectProject`（`actions.ts:109-119`）在首个 `set` 之后加一行同步 URL：

```ts
  const selectProject = async (id: number) => guard(set, async () => {
    // …原有注释保持不动…
    set({ ...createInitialKoubouState(), currentProjectId: id, assets: [], versions: [], activeVersionId: null, buildingVersion: null, pendingVersionId: null, genTasks: [] });
    syncProjectToUrl(id);   // 页签↔项目绑定:切换立即写回本页签 URL(createProject/deleteProject 回退复用此路径)
    await Promise.all([loadCanvas(), loadVersions()]);
    restoreGenTasks(id);
  });
```

`deleteProject`（`actions.ts:148-158`）的「删空」分支补移除参数：

```ts
      if (next != null) await selectProject(next);
      else {
        set({ currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], buildingVersion: null, pendingVersionId: null });
        syncProjectToUrl(null);
      }
```

（`createProject` 内部走 `selectProject`，无需单独处理。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 全量校验并提交**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 切换/删除项目时同步本页签 URL 的 project 参数"
```

---

### Task 4: 真机验证（手动）

- [ ] `pnpm dev` 起服务，页签 A 打开 `http://localhost:3000`，确认 URL 被补上 `?project=<id>`。
- [ ] 页签 B 打开同地址并切换到另一项目，确认 B 的 URL 变化而 A 的 URL 不变。
- [ ] 刷新页签 A：仍还原 A 自己的项目（不跳到 B 最近打开的）。
- [ ] 手改 URL 为 `?project=999999`（不存在）刷新：回退最近使用项目且 URL 被纠正。
