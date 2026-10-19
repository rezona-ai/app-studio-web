# 无项目时自动建默认项目 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `loadProjects` 拉到空列表、或 `deleteProject` 删光最后一个项目时,自动建一个默认项目,使 `currentProjectId` 恒非空 → WS 连上 → ws-ticket 发起,消灭「无项目死工作台」。

**Architecture:** 改动集中在单文件 `src/store/actions.ts`,复用既有 `createProject` action(建项目 → `selectProject` 置 `currentProjectId` + 同步 URL + 拉画布/版本)。新增默认名常量与一个闭包级并发重入护卫(应对 StrictMode 下 `loadProjects` 双触发)。

**Tech Stack:** TypeScript · zustand store(`createServerActions` 闭包工厂)· Vitest(jsdom + globals,`*.test.ts` 同目录)。

设计稿:`docs/superpowers/specs/2026-06-16-auto-create-default-project-design.md`

---

## 文件结构

- 修改:`src/store/actions.ts`
  - `createServerActions` 顶部:新增 `DEFAULT_PROJECT_NAME` 常量与 `loadingProjects` 重入标志。
  - `loadProjects`:加重入护卫;空列表分支由「置 null」改为「自动建默认项目」。
  - `deleteProject`:删光分支由「手动重置 + 清 URL」改为「自动建默认项目」。
- 测试:`src/store/actions.test.ts`(同目录,既有文件,追加用例)

---

### Task 1: boot 路径自动建项目 + 并发重入护卫

**Files:**
- Modify: `src/store/actions.ts`(`createServerActions` 顶部约 34-37 行;`loadProjects` 约 125-146 行)
- Test: `src/store/actions.test.ts`(追加用例)

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 的 `describe('项目 actions', () => {` 块内追加三个用例(放在既有 `loadProjects` 用例之后):

```ts
  test('loadProjects 拉到空列表 → 自动以默认名建项目并落地 currentProjectId', async () => {
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    api.createProject.mockResolvedValue({ id: 99, name: 'Untitled game', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.createProject).toHaveBeenCalledWith('Untitled game');
    expect(useStore.getState().currentProjectId).toBe(99);
    expect(useStore.getState().projects).toEqual([expect.objectContaining({ id: 99 })]);
  });

  test('并发两次 loadProjects(空列表)→ 只建一个项目(重入护卫)', async () => {
    api.listProjects.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100 });
    api.createProject.mockResolvedValue({ id: 99, name: 'Untitled game', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await Promise.all([useStore.getState().loadProjects(), useStore.getState().loadProjects()]);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(useStore.getState().projects).toHaveLength(1);
  });

  test('loadProjects 拉到非空列表 → 不触发自动建项目', async () => {
    api.listProjects.mockResolvedValue({ items: [{ id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' }], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(api.createProject).not.toHaveBeenCalled();
    expect(useStore.getState().currentProjectId).toBe(7);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "自动以默认名建项目"`
Expected: FAIL —— 空列表当前走 `set({ currentProjectId: null })`,`api.createProject` 未被调用,`currentProjectId` 为 `null`。

- [ ] **Step 3: 实现 —— 新增常量与重入标志**

在 `src/store/actions.ts` 中,把:

```ts
export function createServerActions(set: Set, get: Get) {
  // 异步生成任务兜底常量(可调):超时上限 / 连续 poll 失败上限
  const DEADLINE_MS = 10 * 60 * 1000;
```

改为:

```ts
export function createServerActions(set: Set, get: Get) {
  // 无项目时自动建项目的默认名(维持「平台恒有 ≥1 项目」不变式;用户/agent 可后续改名)
  const DEFAULT_PROJECT_NAME = 'Untitled game';
  // loadProjects 并发重入护卫:StrictMode 双挂载/重复 bootstrap 下,防第二个并发调用回灌覆盖刚建出的项目或重复建项目(瞬态控制态,不入 store)
  let loadingProjects = false;

  // 异步生成任务兜底常量(可调):超时上限 / 连续 poll 失败上限
  const DEADLINE_MS = 10 * 60 * 1000;
```

- [ ] **Step 4: 实现 —— loadProjects 加护卫 + 空列表自动建项目**

把 `loadProjects`(约 125-146 行)整体替换:

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
      // 上方 await 期间用户可能已通过 UI 切到别的项目:此时 pick 已过期,写回会造成 URL ↔ store 失配,故先校验再写
      if (get().currentProjectId !== pick) return;
      // 无论来源,选定结果写回本页签 URL(URL 中非法/已删除的 id 由此被纠正)
      syncProjectToUrl(pick);
    } finally {
      set({ booting: false });   // 首拉结束(成功或失败)即撤全局加载层
    }
  });
```

替换为:

```ts
  const loadProjects = async () => {
    // 并发重入护卫:已在途则直接返回(检查—置位间无 await,原子);避免 StrictMode 双挂载下回灌覆盖与重复建项目
    if (loadingProjects) return;
    loadingProjects = true;
    try {
      await guard(set, async () => {
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
          // 无任何项目(新用户/删光):自动建默认项目,使 currentProjectId 落地 → WS 连上 → ws-ticket 发起,否则死工作台
          else if (pick == null) await createProject(DEFAULT_PROJECT_NAME);
          // 其余情况:当前项目未变且已有数据,跳过重复拉取
          // 上方 await 期间用户可能已通过 UI 切到别的项目:此时 pick 已过期,写回会造成 URL ↔ store 失配,故先校验再写
          // (自动建项目后 currentProjectId=新id≠pick(null),此处提前返回跳过 syncProjectToUrl(null);URL 已由 createProject 内 selectProject 同步)
          if (get().currentProjectId !== pick) return;
          // 无论来源,选定结果写回本页签 URL(URL 中非法/已删除的 id 由此被纠正)
          syncProjectToUrl(pick);
        } finally {
          set({ booting: false });   // 首拉结束(成功或失败)即撤全局加载层
        }
      });
    } finally {
      loadingProjects = false;
    }
  };
```

> 说明:`createProject` 虽在 `loadProjects` 之后定义,但同属 `createServerActions` 闭包内的 `const`,`loadProjects` 仅在运行时被调用,引用合法(无 TDZ 问题)。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: 新增三个用例全 PASS,既有用例不回归。

- [ ] **Step 6: 类型检查 + 提交**

```bash
pnpm exec tsc --noEmit
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 无项目时 loadProjects 自动建默认项目,并加并发重入护卫"
```

---

### Task 2: 删光最后一个项目时自动建项目

**Files:**
- Modify: `src/store/actions.ts`(`deleteProject` 约 159-172 行)
- Test: `src/store/actions.test.ts`(追加用例)

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 的 `describe('项目 actions', ...)` 块内追加:

```ts
  test('deleteProject 删掉最后一个项目 → 自动建默认项目维持 ≥1 不变式', async () => {
    useStore.setState({ projects: [{ id: 5, name: 'Only', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' }], currentProjectId: 5 });
    api.deleteProject.mockResolvedValue({ id: 5 });
    api.createProject.mockResolvedValue({ id: 100, name: 'Untitled game', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().deleteProject(5);
    expect(api.createProject).toHaveBeenCalledWith('Untitled game');
    expect(useStore.getState().currentProjectId).toBe(100);
    expect(useStore.getState().projects).toEqual([expect.objectContaining({ id: 100 })]);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "删掉最后一个项目"`
Expected: FAIL —— 当前删光走 `set({ currentProjectId: null, ... })`,`api.createProject` 未被调用,`currentProjectId` 为 `null`。

- [ ] **Step 3: 实现 —— deleteProject 删光分支改为自动建项目**

在 `src/store/actions.ts` 的 `deleteProject` 中,把:

```ts
      if (next != null) await selectProject(next);
      else {
        set({ currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], buildingVersion: null, pendingVersionId: null });
        syncProjectToUrl(null);
      }
```

替换为:

```ts
      if (next != null) await selectProject(next);
      // 删光最后一个项目:维持「平台恒有 ≥1 项目」不变式,自动建默认项目(否则 currentProjectId 置 null 又回到死工作台)。
      // createProject 接管 projects/currentProjectId/URL/画布/版本 的落地,旧的手动重置被完全覆盖
      else await createProject(DEFAULT_PROJECT_NAME);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "删掉最后一个项目"`
Expected: PASS。

- [ ] **Step 5: 全量校验 + 提交**

```bash
pnpm exec vitest run src/store/actions.test.ts
pnpm exec tsc --noEmit
pnpm lint
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 删光最后一个项目时自动建默认项目,维持平台恒有项目不变式"
```

---

## Self-Review

- **Spec coverage:**
  - boot 空列表自动建项目 → Task 1 Step 3/4 ✓
  - 并发重入护卫(StrictMode)→ Task 1 Step 3/4 + 并发用例 ✓
  - 防空态闪屏(`createProject` 在 `try` 内 await,`booting=false` 仍在 `finally`)→ Task 1 Step 4 保留结构 ✓
  - 删光路径自动建项目 → Task 2 ✓
  - 错误处理(`createProject` 自带 `guard`,401 回落 gate)→ 复用既有 `createProject`,无需额外改动 ✓
  - 不做项(不派生名/不自动发送/不改落地页)→ 计划未触及,符合 ✓
- **Placeholder scan:** 无 TBD/TODO;每个改码步骤均含完整代码块。
- **Type consistency:** 常量名 `DEFAULT_PROJECT_NAME`、标志 `loadingProjects` 两个任务一致;`ProjectData` mock 形状与既有用例一致(`id/name/cover_url/current_version_id/status/created_at/updated_at`)。
