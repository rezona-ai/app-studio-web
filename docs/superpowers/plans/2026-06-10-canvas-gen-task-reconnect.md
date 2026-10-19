# 画布生成任务刷新重连 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手动刷新 / 重新进入页面后,自动恢复 video / model3d 生成任务的轮询直到完成,并对永远完不成的任务做超时 / 连续失败兜底。

**Architecture:** 把内存 `genTasks` 按项目持久化到 `genTasksByProject`(沿用 `koubouByProject` 范式);所有增删经 `commitGenTasks` 集中。项目载入路径(`selectProject` / `loadProjects` 直载分支)在 `loadCanvas` 之后调 `restoreGenTasks`,用最新 assets 对账恢复仍 `generating` 的任务;`useCanvasPolling` 自动接管。`pollGenTasks` 增「先轮询后判超时 + 连续失败上限」状态机。

**Tech Stack:** TypeScript、zustand(persist 中间件)、vitest。

设计文档:`docs/superpowers/specs/2026-06-10-canvas-gen-task-reconnect-design.md`

---

## File Structure

- `src/store/types.ts` — `GenTask` 增 `startedAt` / `fails?`;`ServerState` 增 `genTasksByProject`;`createInitialServerState` 初始化。
- `src/store/index.ts` — `partialize` 白名单增 `genTasksByProject`。
- `src/store/actions.ts` — 新增常量 `DEADLINE_MS` / `MAX_FAILS` 与 helper `commitGenTasks` / `restoreGenTasks` / `failGenTask`;改 `startAsyncGen` / `pollGenTasks` / `deleteCanvasItem` / `deleteProject`;`selectProject` 与 `loadProjects` 直载分支调用 `restoreGenTasks`。
- `src/store/actions.test.ts` — 补存量 fixture 的 `startedAt`;新增重连 / 兜底 / 持久化 / 删除清理用例。
- `src/client/useCanvasPolling.ts` — 无需改动(`genTasks.length > 0` 即自动启动)。

测试命令:`npm test`(= `vitest run`)。单文件:`npx vitest run src/store/actions.test.ts`。

---

## Task 1: 扩展 GenTask 与 ServerState 类型

**Files:**
- Modify: `src/store/types.ts:68`(GenTask)、`src/store/types.ts:70-86`(ServerState + createInitialServerState)

- [ ] **Step 1: 修改 GenTask 接口**

把 `src/store/types.ts:68` 一行替换为:

```typescript
// 画布异步生成任务(video/model3d)的轮询登记。
// startedAt 持久化用于超时判定;fails 为会话内连续 poll 失败计数,恢复时重置。
export interface GenTask { itemId: string; kind: 'video' | 'model3d'; taskId: string; startedAt: number; fails?: number; }
```

- [ ] **Step 2: 给 ServerState 增加 genTasksByProject 字段**

在 `src/store/types.ts` 的 `ServerState` 接口里,`koubouByProject` 一行下方新增:

```typescript
  genTasksByProject: Record<string, GenTask[]>;   // 按项目持久化生成任务,刷新后重连轮询用
```

- [ ] **Step 3: 在 createInitialServerState 初始化**

把 `createInitialServerState` 的 return 对象补上 `genTasksByProject: {}`(放在 `koubouByProject: {}` 之后):

```typescript
export function createInitialServerState(): ServerState {
  return { projects: [], currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], pendingVersionId: null, buildingVersion: null, lastError: null, koubouByProject: {}, genTasksByProject: {}, importedByProject: {} };
}
```

- [ ] **Step 4: 编译校验(此时存量测试 fixture 会因缺 startedAt 报类型错,下一 Task 修复)**

Run: `npx tsc --noEmit 2>&1 | grep -E "types.ts|actions.ts" | head`
Expected: `types.ts` 无错(`actions.ts:132` 可能因 startedAt 缺失报错,Task 3 修)。

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts
git commit -m "feat: GenTask 增 startedAt/fails 并新增 genTasksByProject 持久化字段"
```

---

## Task 2: persist 白名单纳入 genTasksByProject

**Files:**
- Modify: `src/store/index.ts:193-200`(partialize)

- [ ] **Step 1: 在 partialize 增加 genTasksByProject**

在 `src/store/index.ts` 的 `partialize` 返回对象里,`koubouByProject: s.koubouByProject,` 一行下方新增:

```typescript
        genTasksByProject: s.genTasksByProject,
```

- [ ] **Step 2: Commit**

```bash
git add src/store/index.ts
git commit -m "feat: persist 持久化 genTasksByProject"
```

---

## Task 3: commitGenTasks helper + startAsyncGen 带 startedAt(并修存量测试 fixture)

**Files:**
- Modify: `src/store/actions.ts`(新增 helper、改 startAsyncGen、改 deleteCanvasItem、改 deleteProject)
- Modify: `src/store/actions.test.ts`(补存量 4 处 fixture 的 startedAt)

- [ ] **Step 1: 在 createServerActions 内、loadCanvas 之前新增常量与 commitGenTasks**

在 `src/store/actions.ts` 的 `export function createServerActions(set, get) {` 之后、`// ---- 项目 ----` 之前插入:

```typescript
  // 异步生成任务兜底常量(可调):超时上限 / 连续 poll 失败上限
  const DEADLINE_MS = 10 * 60 * 1000;
  const MAX_FAILS = 5;

  // genTasks 单一写入口:同步内存工作切片与按项目持久化映射,保证刷新后可重连
  const commitGenTasks = (next: GenTask[]) => {
    const pid = get().currentProjectId;
    set({ genTasks: next, ...(pid != null ? { genTasksByProject: { ...get().genTasksByProject, [String(pid)]: next } } : {}) });
  };
```

- [ ] **Step 2: 改 startAsyncGen 用 commitGenTasks 且带 startedAt**

把 `src/store/actions.ts:130-133`(startAsyncGen 的 set 调用)替换为:

```typescript
    set({ assets: [...get().assets, asset] });
    commitGenTasks([...get().genTasks, { itemId: task.item.item_id, kind, taskId: task.task_id, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
```

- [ ] **Step 3: 改 deleteCanvasItem 用 commitGenTasks**

把 `src/store/actions.ts:159-162`(deleteCanvasItem 的 set 调用)替换为:

```typescript
    set({ assets: get().assets.filter((a) => a.id !== itemId) });
    commitGenTasks(get().genTasks.filter((t) => t.itemId !== itemId));
```

- [ ] **Step 4: 改 deleteProject 清理 genTasksByProject 映射**

把 `src/store/actions.ts:86-95` 的 deleteProject 中 `set({ projects: rest });` 一行替换为(剪除该 pid 的持久化条目,无论是否当前项目):

```typescript
    const { [String(id)]: _removed, ...restGenTasks } = get().genTasksByProject;
    set({ projects: rest, genTasksByProject: restGenTasks });
```

并把同函数末尾 `else set({ currentProjectId: null, ... genTasks: [], ... });` 中的 `genTasks: []` 保留不变(当前项目被删且无其它项目时清空内存切片;持久化映射已在上面剪除)。

- [ ] **Step 5: 补存量测试 fixture 的 startedAt**

`src/store/actions.test.ts` 中现有 4 处 `genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1' }]`(约 219/234/247/263 行),逐一在 `taskId: 't1'` 后补 `, startedAt: Date.now()`,即:

```typescript
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }],
```

- [ ] **Step 6: 运行存量测试确认未破坏**

Run: `npx vitest run src/store/actions.test.ts`
Expected: 全绿(类型错消失,既有轮询断言仍通过)。

- [ ] **Step 7: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: genTasks 经 commitGenTasks 持久化并记录 startedAt"
```

---

## Task 4: restoreGenTasks 对账 + 在项目载入路径调用

**Files:**
- Modify: `src/store/actions.ts`(新增 restoreGenTasks;在 selectProject、loadProjects 直载分支调用;导出)
- Modify: `src/store/actions.test.ts`(新增重连对账用例)

- [ ] **Step 1: 写失败测试 — 刷新主路径重连**

在 `src/store/actions.test.ts` 的 `describe('画布轮询 pollGenTasks', ...)` 之后新增:

```typescript
describe('genTasks 刷新重连 restoreGenTasks', () => {
  test('loadProjects 直载分支:持久化任务对应 item 仍 generating 时恢复 genTasks', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [],
      genTasksByProject: { '7': [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now() }] },
    });
    api.listProjects.mockResolvedValue({ items: [{ id: 7, name: 'A', cover_url: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' }], total: 1, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().genTasks).toHaveLength(1);
    expect(useStore.getState().genTasks[0].taskId).toBe('t1');
  });

  test('持久化任务对应 item 已 ready 或已删则不恢复,并从映射剪除', async () => {
    useStore.setState({
      currentProjectId: 7, assets: [], versions: [], activeVersionId: null,
      genTasksByProject: { '7': [
        { itemId: 'vid-done', kind: 'video', taskId: 't1', startedAt: Date.now() },
        { itemId: 'vid-gone', kind: 'video', taskId: 't2', startedAt: Date.now() },
      ] },
    });
    api.listCanvasItems.mockResolvedValue({ items: [{ id: 1, item_id: 'vid-done', type: 'video', status: 'ready', url: '/p/v.mp4' }], total: 1 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().selectProject(7);
    expect(useStore.getState().genTasks).toHaveLength(0);
    expect(useStore.getState().genTasksByProject['7']).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/store/actions.test.ts -t "刷新重连"`
Expected: FAIL(restoreGenTasks 未实现,genTasks 仍为空 / 映射未剪除)。

- [ ] **Step 3: 实现 restoreGenTasks**

在 `src/store/actions.ts` 的 `commitGenTasks` 之后新增:

```typescript
  // 刷新 / 切项目后用最新 assets 对账:仅恢复仍 generating 的任务(fails 重置),顺带剪除已完成/已删的持久化残留
  const restoreGenTasks = (pid: number) => {
    if (get().currentProjectId !== pid) return;   // await 期间已切项目
    const saved = get().genTasksByProject[String(pid)] ?? [];
    const assetsById = new Map(get().assets.map((a) => [a.id, a]));
    const live = saved
      .filter((t) => assetsById.get(t.itemId)?.status === 'generating')
      .map((t) => ({ ...t, fails: 0 }));
    commitGenTasks(live);
  };
```

- [ ] **Step 4: 在 selectProject 末尾调用**

把 `src/store/actions.ts:60` 的 `await Promise.all([loadCanvas(), loadVersions()]);` 替换为:

```typescript
    await Promise.all([loadCanvas(), loadVersions()]);
    restoreGenTasks(id);
```

- [ ] **Step 5: 在 loadProjects 直载分支调用**

把 `src/store/actions.ts:70` 的直载分支:

```typescript
    else if (pick != null && get().assets.length === 0) await Promise.all([loadCanvas(), loadVersions()]);
```

替换为:

```typescript
    else if (pick != null && get().assets.length === 0) { await Promise.all([loadCanvas(), loadVersions()]); restoreGenTasks(pick); }
```

(注:`pick === cur` 分支才是刷新主路径;`selectProject` 分支已在 Step 4 覆盖,无需重复。)

- [ ] **Step 6: 导出 restoreGenTasks(供测试 / 完整性)**

在 `src/store/actions.ts` 末尾 return 对象中,`pollGenTasks` 附近加入 `restoreGenTasks`。同步更新 `ServerActions` 类型(若该文件显式列出方法签名,新增 `restoreGenTasks: (pid: number) => void;`)。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run src/store/actions.test.ts -t "刷新重连"`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 刷新后用 restoreGenTasks 对账恢复生成任务轮询"
```

---

## Task 5: pollGenTasks 增超时 / 连续失败兜底

**Files:**
- Modify: `src/store/actions.ts:198-220`(pollGenTasks)
- Modify: `src/store/actions.test.ts`(新增兜底用例)

- [ ] **Step 1: 写失败测试 — 超时与连续失败兜底**

在 `src/store/actions.test.ts` 顶部确保 `vi` 已导入(已存在)。在 `describe('画布轮询 pollGenTasks', ...)` 内新增:

```typescript
  test('poll 后仍 generating 且超过 DEADLINE 时标 error 并移除任务', async () => {
    const old = Date.now() - 11 * 60 * 1000;   // 11 分钟前,超过 10min 上限
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 }, pinned: false }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: old }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 't1', status: 'in_progress', item: { id: 1, item_id: 'vid-1', type: 'video', status: 'generating', url: null } });
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('连续 poll 失败达 MAX_FAILS 时标 error 并移除;未达上限仅累加 fails', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 }, pinned: false }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now(), fails: 4 }],
    });
    api.pollVideo.mockRejectedValue(new Error('boom'));
    await useStore.getState().pollGenTasks();   // fails 4 -> 5 = MAX_FAILS
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('error');
    expect(useStore.getState().genTasks).toHaveLength(0);
  });

  test('poll 失败未达上限时保留任务并累加 fails', async () => {
    useStore.setState({
      currentProjectId: 42,
      assets: [{ id: 'vid-1', key: 'vid-1', label: 'x', kind: 'video', source: 'generated', status: 'generating', position: { x: 0, y: 0 }, pinned: false }],
      genTasks: [{ itemId: 'vid-1', kind: 'video', taskId: 't1', startedAt: Date.now(), fails: 0 }],
    });
    api.pollVideo.mockRejectedValue(new Error('boom'));
    await useStore.getState().pollGenTasks();
    expect(useStore.getState().assets.find((a) => a.id === 'vid-1')?.status).toBe('generating');
    expect(useStore.getState().genTasks[0].fails).toBe(1);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/store/actions.test.ts -t "pollGenTasks"`
Expected: 新增 3 例 FAIL(兜底未实现)。

- [ ] **Step 3: 新增 failGenTask helper**

在 `src/store/actions.ts` 的 `restoreGenTasks` 之后新增:

```typescript
  // 把指定任务对应资产标 error 并从 genTasks 移除(超时 / 连续失败兜底)
  const failGenTask = (itemId: string, taskId: string) => {
    set({ assets: get().assets.map((a) => (a.id === itemId ? { ...a, status: 'error' as const } : a)) });
    commitGenTasks(get().genTasks.filter((g) => g.taskId !== taskId));
  };
```

- [ ] **Step 4: 改写 pollGenTasks 主体**

把 `src/store/actions.ts:198-220` 的整个 `pollGenTasks` 替换为:

```typescript
  // 轮询一轮:推进所有 generating 任务,含超时 / 连续失败兜底
  const pollGenTasks = async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const now = Date.now();
    for (const t of [...get().genTasks]) {
      try {
        const task = t.kind === 'video' ? await pgcApi.pollVideo(pid, t.taskId) : await pgcApi.pollModel3d(pid, t.taskId);
        if (get().currentProjectId !== pid) return;   // await 期间已切项目:停止把旧项目任务结果写回
        if (!task.item) continue;
        const asset = canvasItemToAsset(task.item);
        // 仅当本地已 pin(用户拖拽过)才保留本地坐标,否则采用服务端 reference.position
        set({ assets: get().assets.map((a) => (a.id === t.itemId
          ? { ...a, ...asset,
              position: a.pinned ? a.position : asset.position,
              pinned: a.pinned || asset.pinned,
              parentId: a.parentId ?? asset.parentId,
              source: a.parentId ? 'derived' : asset.source }
          : a)) });
        if (asset.status === 'ready' || asset.status === 'error') {
          commitGenTasks(get().genTasks.filter((g) => g.taskId !== t.taskId));
        } else if (now - t.startedAt > DEADLINE_MS) {
          failGenTask(t.itemId, t.taskId);   // 仍 generating 且超时:兜底标 error
        }
      } catch {
        // 单个任务轮询失败:累加 fails,达上限则标 error 兜底(防 taskId 失效后无限重试)
        if (get().currentProjectId !== pid) return;
        const fails = (t.fails ?? 0) + 1;
        if (fails >= MAX_FAILS) failGenTask(t.itemId, t.taskId);
        else commitGenTasks(get().genTasks.map((g) => (g.taskId === t.taskId ? { ...g, fails } : g)));
      }
    }
  };
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run src/store/actions.test.ts`
Expected: 全绿(含新增兜底 3 例与既有用例)。

- [ ] **Step 6: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: pollGenTasks 增超时与连续失败兜底"
```

---

## Task 6: 持久化往返 + 全量回归

**Files:**
- Modify: `src/store/actions.test.ts`(新增持久化用例)

- [ ] **Step 1: 新增 partialize 持久化断言**

在 `src/store/actions.test.ts` 末尾新增:

```typescript
describe('genTasksByProject 持久化', () => {
  test('startAsyncGen 后 genTasksByProject 按当前项目登记任务', async () => {
    useStore.setState({ currentProjectId: 7, assets: [], genTasks: [], genTasksByProject: {} });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    api.genVideo.mockResolvedValue({ task_id: 't9', status: 'queued', item: { id: 1, item_id: 'vid-9', type: 'video', status: 'generating', url: null } });
    await useStore.getState().generateVideo({ prompt: 'x' });
    expect(useStore.getState().genTasksByProject['7']).toHaveLength(1);
    expect(useStore.getState().genTasksByProject['7'][0].taskId).toBe('t9');
  });
});
```

注:此用例需 mock `genVideo`,确认 `src/store/actions.test.ts` 顶部 `vi.mock` 的 `pgcApi` 对象已含 `genVideo: vi.fn()`,若无则补上。

- [ ] **Step 2: 运行全量测试**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add src/store/actions.test.ts
git commit -m "test: 补 genTasksByProject 持久化登记用例"
```

---

## 自审记录

- **Spec 覆盖**:类型(T1)、持久化(T2)、commit 集中 + startedAt(T3)、restore 对账 + 调用点(T4)、超时/失败兜底(T5)、持久化往返(T6)。设计文档各节均有对应 Task。
- **先轮询后判超时**:T5 Step 4 中超时判定置于 poll 成功且仍 generating 的分支内,符合 spec「避免误杀关闭期间已完成任务」。
- **不改 loadCanvas**:restore 仅在 selectProject(T4 S4)与 loadProjects 直载分支(T4 S5)调用,未触碰 useKoubouConnection 的中途刷新路径。
- **类型一致**:`commitGenTasks(next: GenTask[])`、`restoreGenTasks(pid: number)`、`failGenTask(itemId, taskId)` 在各 Task 中签名一致;`fails?` 读取统一 `?? 0`。
