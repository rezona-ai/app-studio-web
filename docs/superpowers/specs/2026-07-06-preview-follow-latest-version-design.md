# 修改后预览默认切到最新版本 — 设计稿

日期:2026-07-06
关联 Story:待关联(修改后预览默认到最新版本)

## 背景与问题

当前 `loadVersions`(`src/store/actions.ts`)刷新版本列表时,`activeVersionId` 沿用旧值:

```ts
activeVersionId: cleared ? pending : (get().activeVersionId ?? current?.id ?? null),
```

因此 agent 修改游戏并产出新版本后(`run.finished` 触发版本刷新),右侧预览仍停留在用户此前查看的旧版本,用户需要手动去时间线点最新版本才能看到修改效果,与「改完立刻看效果」的直觉相悖。

## 需求决策

- **切换时机:出新版本就切(已与 Nick 确认)。** 只要刷新后版本列表出现此前没有的新版本,预览无条件切到最新版本 —— 即使用户正停留在某个旧版本查看,也会被切走。
- 对比(compare)模式**不豁免**,同样切换(对比视图激活侧本就跟随 `activeVersionId`)。

## 方案

**在 `loadVersions` 内做增量 diff(源头分流)**:

- 刷新时对比「旧版本 id 集合」与「新返回列表」;若出现此前没有的新版本 **且旧列表非空**(排除冷启动首载),将 `activeVersionId` 切到返回列表中最新的一个版本,并同步 `versions[].current` 标记(与 `setActiveVersion` 行为一致)。
- 所有出新版本的路径(agent `run.finished` 后刷新、构建轮询 `pollGenTasks` 兜底刷新、手动刷新)都汇经 `loadVersions`,单点改动天然全覆盖,不在各触发点分别贴逻辑。

### 与现有逻辑的关系

- **pending 流程保留且优先**:`pendingVersionId` 构建完成(出现在返回列表)时仍前进到 pending 版本;diff 切最新仅在非 pending 清算分支生效。二者结果通常一致(pending 版本即最新)。
- **冷启动不受影响**:首载旧列表为空,不做 diff 切换,仍走现有 `activeVersionId ?? current ?? null` 回退。
- **无新版本的刷新**:保持用户当前选择不变(不吸附服务端 `current`,避免任意轮询冲掉手动选择)。

### 排除的备选

- 在 `run.finished` hook 显式调 `setActiveVersion`:逻辑散在触发点,漏掉其他刷新路径。
- 每次刷新吸附服务端 `current`:会把用户手动选的版本随轮询冲掉,超出需求本意。

## 改动范围

- `src/store/actions.ts` — `loadVersions`(约 133–149 行)加 diff 判断,唯一生产代码改动。
- `src/store/actions.test.ts` — 补测试。

## 测试

1. 刷新后出现新版本(旧列表非空)→ `activeVersionId` 自动切到最新,`current` 标记同步。
2. 刷新无新版本 → 保持用户当前选中的旧版本不变。
3. 冷启动首载(旧列表为空)→ 走 `current`/末位回退,不误判「全是新版本」。
4. pending 版本清算路径不回归:pending 出现时仍前进到 pending 版本。
