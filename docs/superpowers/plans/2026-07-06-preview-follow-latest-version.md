# 修改后预览默认切到最新版本 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 版本列表刷新出现新版本时,预览自动切到最新版本,不再停留在用户此前查看的旧版本。

**Architecture:** 单点改动 `src/store/actions.ts` 的 `loadVersions`:刷新时对比旧版本 id 集合做增量 diff,出现新版本(且旧列表非空,排除冷启动)则把 `activeVersionId` 切到返回列表末位(最新)并同步 `versions[].current`。pending 版本清算分支保留且优先。所有出新版本的刷新路径(run.finished / 构建轮询 / 手动刷新)都汇经此函数,源头分流全覆盖。

**Tech Stack:** TypeScript + zustand store + Vitest(jsdom,测试与源码同目录)。

## Global Constraints

- 代码注释 / commit message 一律用中文;注释解释「为什么」不解释「做什么」。
- 状态更新不可变(返回新对象);`await` 后已有 `currentProjectId !== pid` 校验,保留勿动。
- 无新版本的刷新**不得**改动用户当前 `activeVersionId`(不吸附服务端 `current`)。
- 验证命令:`pnpm exec vitest run src/store/actions.test.ts` 与 `pnpm exec tsc --noEmit`。
- 按用户约定:在 worktree `feat/preview-follow-latest-version` 中开发,完成后回合 `dev`(--no-ff,message 含分支名)并清理 worktree。

---

### Task 1: loadVersions 增量 diff 切最新版本

**Files:**
- Modify: `src/store/actions.ts:133-149`(`loadVersions`)
- Test: `src/store/actions.test.ts`(「版本 actions」describe 块内追加)

**Interfaces:**
- Consumes: `pgcApi.listVersions(pid)` 返回 `{ items: VersionData[], total }`;`versionsToVersions` 映射为 `Version[]`(按 seq 升序,末位最新);store 现有字段 `versions` / `activeVersionId` / `pendingVersionId`。
- Produces: 无新导出;仅改变 `loadVersions` 的 `set` 行为。

- [ ] **Step 1: 写失败测试(3 例追加到「版本 actions」describe)**

```ts
  test('刷新出现新版本时自动切到最新并同步 current 标记', async () => {
    useStore.setState({
      currentProjectId: 42,
      activeVersionId: 'v1',
      versions: [
        { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: true, assetKeys: [], game: { title: 'V1', palette: 'neon' } },
      ],
    });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: false },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: true },
    ], total: 2 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().activeVersionId).toBe('v2');
    expect(useStore.getState().versions.find((v) => v.id === 'v2')?.current).toBe(true);
    expect(useStore.getState().versions.find((v) => v.id === 'v1')?.current).toBe(false);
  });

  test('刷新无新版本时保持用户手动选中的旧版本', async () => {
    useStore.setState({
      currentProjectId: 42,
      activeVersionId: 'v1',
      versions: [
        { id: 'v1', index: 1, label: 'V1', summary: '', createdAt: '', current: false, assetKeys: [], game: { title: 'V1', palette: 'neon' } },
        { id: 'v2', index: 2, label: 'V2', summary: '', createdAt: '', current: true, assetKeys: [], game: { title: 'V2', palette: 'neon' } },
      ],
    });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: false },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: true },
    ], total: 2 });
    await useStore.getState().loadVersions();
    expect(useStore.getState().activeVersionId).toBe('v1');
  });

  test('冷启动首载(旧列表为空)走 current 回退,不触发 diff 切换', async () => {
    useStore.setState({ currentProjectId: 42, versions: [], activeVersionId: null });
    api.listVersions.mockResolvedValue({ items: [
      { version_id: 'v1', seq: 1, title: 'V1', status: 'ready', is_current: true },
      { version_id: 'v2', seq: 2, title: 'V2', status: 'ready', is_current: false },
    ], total: 2 });
    await useStore.getState().loadVersions();
    // 回退到服务端 current(v1),而非被误判「全是新版本」切到末位 v2
    expect(useStore.getState().activeVersionId).toBe('v1');
  });
```

说明:第 3 例特意让 `is_current` 落在**非末位**版本上,以区分「current 回退」与「diff 切末位」两条路径;若两者同值该测试无鉴别力。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "刷新出现新版本"`
Expected: FAIL,`activeVersionId` 仍为 `'v1'`(现逻辑沿用旧值)。另两例此时应 PASS(现有行为已满足)——它们是防回归护栏。

- [ ] **Step 3: 实现 loadVersions 的增量 diff**

将 `src/store/actions.ts` 的 `loadVersions` 改为:

```ts
  const loadVersions = async () => {
    const pid = get().currentProjectId;
    if (pid == null) return;
    const data = await pgcApi.listVersions(pid);
    if (get().currentProjectId !== pid) return;   // 同上:await 期间已切项目则丢弃
    const versions = versionsToVersions(data.items);
    const current = versions.find((v) => v.current) ?? versions[versions.length - 1] ?? null;
    const pending = get().pendingVersionId;
    // listVersions 只返回 ready 版本(时间线恒 ready),故 pending 版本一旦出现即表示构建完成,可清占位
    const cleared = !!pending && versions.some((v) => v.id === pending);
    // 出新版本(旧列表非空,排除冷启动首载)→ 预览无条件切到最新:改完立刻看效果,即使用户正停留在旧版本
    const prev = get().versions;
    const prevIds = new Set(prev.map((v) => v.id));
    const hasNew = prev.length > 0 && versions.some((v) => !prevIds.has(v.id));
    const latest = versions[versions.length - 1] ?? null;
    const nextActive = cleared ? pending
      : hasNew ? latest?.id ?? null
      : (get().activeVersionId ?? current?.id ?? null);
    set({
      versions: versions.map((v) => ({ ...v, current: v.id === nextActive })),
      activeVersionId: nextActive,
      ...(cleared ? { pendingVersionId: null, buildingVersion: null } : {}),
    });
  };
```

注意:`versions[].current` 改为跟随 `nextActive` 统一标记(与 `setActiveVersion` 行为一致),不再原样透传服务端 `is_current` —— 否则 diff 切换后时间线高亮与预览不一致。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: 全部 PASS,含既有 4 例版本测试(重点回归:「pending 版本构建完成后前进并清占位」「映射进 versions 标记 current」)。

若「loadVersions 映射进 versions,标记 current」因 current 标记改为跟随 nextActive 而失败,检查该例语义:首载 `is_current: true` 的 v1 应回退为 active 且标记 current,新实现结果一致,不应失败;失败则说明实现有误,修实现而非改旧测试。

- [ ] **Step 5: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 均通过(exit 0)。

- [ ] **Step 6: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 版本刷新出新版本时预览自动切到最新"
```
