# 实现计划：慢异步生成的两处修正

> 设计稿：`docs/superpowers/specs/2026-08-06-gen-task-deadline-and-placeholder.md`
> 分支：`fix/gen-task-deadline-and-placeholder`（worktree `.orca/worktrees/feat+agent-provenance`，复用以省一次 install）

两个缺陷都先写**复现测试**（铁律 1）。缺陷 B 是主体，A 是一行常量。

---

## 任务 1 · 整表替换保住在飞占位卡（TDD）

**改动**（`src/store/actions.ts` 的 `loadCanvas`）
- 映射完服务端 items 后，把「仍被 `genTasks` 引用的 `pending_*` 卡」接回 `assets`。
- `pending_` 前缀已散落多处（`addGenPlaceholders` / `tidyLayout` / 本处），顺手抽成一处常量或复用既有判定，
  避免第四处字面量。

**测试**（`src/store/actions.test.ts`，`loadCanvas` 既有 describe 内）
1. **复现**：有 GenTask 指向 `pending_x` 且该占位卡在 assets 里 → `loadCanvas` 后它**仍在**（改前必红）
2. 服务端返回的真实卡与被保留的占位卡并存、不重复（成功标准 3）
3. 用户已删除生成中的卡（GenTask 已摘、assets 里也没有）→ `loadCanvas` **不复活**（成功标准 4）
4. 无 GenTask 引用的孤立 `pending_` 卡（例如同步生成在飞）→ 仍按现状被抹掉（约束 4 的边界，钉住不越界）
5. 既有行为不回退：`doomed`（延迟删除窗口内）仍被过滤；坐标/血缘/溯源/归属的本地保留仍生效
   —— **由既有测试覆盖，本轮不新增**（`pending-delete.test.ts` 钉 doomed 过滤、`lib/pgc/map.test.ts` 钉本地保留）

## 任务 2 · 超时就地转失败卡（TDD，跨模块）

**改动**：无（由任务 1 顺带满足）——但必须有测试钉住整条链，否则将来谁改回去无人发现。

**测试**（`src/store/actions.test.ts`）
1. 占位卡 + GenTask → 触发一次 `loadCanvas`（模拟 `run.finished` 后台刷）→ 再让 `pollGenTasks` 撞上超时
   → 该卡 `status === 'error'` 且带 `failure`，**不是消失**（改前必红：卡已被抹，无处可标）
2. Toast 仍照旧弹（不回退）

## 任务 3 · DEADLINE_MS 对齐契约

**改动**：`DEADLINE_MS` 10 → 35 分钟，注释引用 pgc 契约与耦合说明。

**测试**
1. 已等 11 分钟（旧阈值之后、新阈值之前）→ 任务**仍在** `genTasks` 里、卡仍 generating（改前必红）
2. 已等 36 分钟 → 走超时兜底转失败（新阈值生效）

用假时钟推进（既有测试已有 `vi.useFakeTimers` / 手写 `startedAt` 的先例，照抄）。

## 任务 4 · 验证与回合

- 四道闸门（`lint` / `tsc` / `test` / `build`）实跑结果：

```
pnpm exec vitest run   → Test Files 252 passed (252) / Tests 2884 passed (2884)   退出码=0
pnpm exec tsc --noEmit → 无输出                                                    退出码=0
pnpm lint              → ✖ 8 problems (0 errors, 8 warnings)  = 基线               退出码=0
pnpm build             → 路由表正常产出                                             退出码=0
```

（8 个 warning 全为既有：loadtest 匿名导出 ×2、`Workspace.tsx` 冗余 disable ×1、`actions.ts` 的 `_removed*` 占位形参 ×5。）
- 派干净上下文子代理按 commit 范围评审；Critical / Important 修完才继续。
- 真机验收：**难点是要一个慢任务**。计划用「让 agent 再生成一次 3D」复现（上次约 20 分钟才终态，
  正好落在新旧阈值之间）；若上游这次很快返回，则该场景**记为未验到**，不假装通过。
  可稳定验的部分：占位卡在一次后台 `loadCanvas` 之后仍在画布上。
- `--no-ff` 合并回 dev，在合并结果上重跑全量。清理动作先问 Nick。
