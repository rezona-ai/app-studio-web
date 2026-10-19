# 实现计划：孤儿兜底停止 DELETE + 对称发现

> 设计稿：`docs/superpowers/specs/2026-08-06-orphan-gen-task-no-delete.md`
> 分支：`fix/orphan-gen-task-no-delete`（worktree `.orca/worktrees/feat+agent-provenance`）

改动集中在 `restoreGenTasks` 一个函数，两处独立语义各自先写复现测试（铁律 1）。

---

## 任务 1 · 孤儿兜底不再删服务端 item（TDD）

**先写失败测试**（`src/store/actions.test.ts`，`restoreGenTasks` 既有 describe 内）
1. **复现**：画布上一张 `generating` 的 `img-x`（无任何可恢复任务）→ `restoreGenTasks` 后
   `deleteCanvasItem` **一次都没被调用**（改前必红：现在会调）
2. 该卡**留在画布上**且 `status === 'error'`（改前必红：现在被移除）
3. Toast 仍弹 `GEN_FAILED`（不回退）
4. `pending_*` 占位卡仍不在孤儿之列（既有语义不动）

**改动**：`markAssetsFailed([...orphanIds], null)` 取代「filter 掉 + for 循环 DELETE」。

---

## 任务 2 · 对称发现 vid- / m3d-（TDD）

**先写失败测试**
1. **复现**：`vid-abc123`（`kind: 'video'`、`generating`）+ 无持久化任务 →
   `genTasks` 出现 `{ itemId: 'vid-abc123', kind: 'video', taskId: 'abc123' }`（改前必红）
2. `m3d-abc123`（`threeDType: 'model3d'`）→ `kind: 'model3d'`、`taskId: 'abc123'`（改前必红）
3. `rig-` / `tex-` 不回退（kind 分别 `rig3d` / `retexture`）
4. **不误认**：`tex-x` 不得被认成 `model3d`（它与 `m3d-` 同为 `threeDType: 'model3d'`，
   只看前缀就会错）；`vid-x` 但 `kind !== 'video'` 不认
5. 已有持久化任务的 itemId 不被 `discovered` 重复登记（`restoredIds` 去重仍生效）
6. 发现出来后**不再是孤儿**（不标失败、不删）——与任务 1 的断言合起来钉住整条判定

**改动**：四段 if 换成 `DISCOVERABLE` 表 + 一次 `flatMap`。

---

## 任务 3 · 订正上一份设计稿的暴露面描述

`2026-08-06-gen-task-deadline-and-placeholder.md` 里那段「⚠️ 比这更糟」对 agent 路径不成立
（契约：`gtask-*` 在 `generating` 时无服务端 item）。改为指向本轮设计稿，并说明真正的暴露面是
**用户自发起**的 video / 3D + 持久化任务拿不到。

## 任务 4 · 验证与回合

- 四道闸门实跑结果（分支 HEAD）：

```
pnpm exec vitest run   → Test Files 252 passed (252) / Tests 2892 passed (2892)   退出码=0（连续 3 次）
pnpm exec tsc --noEmit → 无输出                                                    退出码=0
pnpm lint              → ✖ 8 problems (0 errors, 8 warnings)  = 基线               退出码=0
pnpm build             → Compiled successfully                                     退出码=0
```

> ⚠️ **全量偶发红，未澄清**：本轮 8 次全量里有 2 次红，红的是**与本轮无关**的组件测试
> （一次 `I18nProvider.test.tsx` 1 条、一次 `CreativeLibraryModal.test.tsx` 6 条），
> 两个文件单独跑均全过。同期在 dev（无本轮改动）跑 5 次全绿。
> 那 2 次红都发生在机器同时跑变异验证子进程（负载最重）的时段；改动只碰 store 逻辑，
> 红的是带定时器的组件测试，而 vitest 按文件隔离 —— 跨文件影响机制上不通。
> 故**不能证明与本轮有关，也不能完全排除**，如实记录，不当作已澄清。
> 同类偶发本仓此前已有一例（`ws-proxy.test.ts`），值得单独一轮查并行负载下的时序假设。
- 派干净上下文子代理评审；Critical / Important 修完才继续；合并前终审全分支。
- 真机验收：**可稳定复现** —— 无痕窗口（或清 localStorage）打开一个正在生成 video/3D 的项目。
  难点是要有一张在飞的 video/3D 卡（真跑一次要花积分、且要在窗口内操作）。
  退路：用 `evaluate` 把一张真实卡置成 `generating`（服务端那份仍 ready，不动它），
  再调真实 `restoreGenTasks` 观察「不发 DELETE + 标失败 / 被发现」——手法要如实交代。
- `--no-ff` 合并回 dev，在合并结果上重跑全量。清理动作先问 Nick。
