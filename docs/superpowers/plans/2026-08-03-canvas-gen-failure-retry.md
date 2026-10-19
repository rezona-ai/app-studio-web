# 实现计划：生成失败卡保留与原地重试

> 设计稿：`docs/superpowers/specs/2026-08-03-canvas-gen-failure-retry.md`
> 分支：`feat/canvas-gen-failure-retry`

五个任务。先做「看得见」（UI 收敛），再做「留得下」（失败不删卡），最后接重试 —— 每步系统保持可运行。

---

## T1 统一失败卡组件（UI 收敛，行为不变）

先把三份重复实现与硬编码色值收拾干净，此时失败卡仍只有派生路径能触发，行为无变化 —— 纯重构，风险最低。

**改动**
- 新建 `src/components/canvas/nodes/GenErrorBody.tsx`
  - 入参 `{ failure, kind, className }`；渲染 danger 底 + danger 文字 + `failure?.message`（缺失回退 `t('canvas.genError')`）。
  - 色值走 `--color-danger` / `--color-danger-soft`，**不留任何字面色值**。
  - 文案区限高 + `.scrollbar-none`：后端 message 可能长，不许撑变形卡片。
  - 本任务**先不含重试按钮**（T4 加），保持"纯重构"边界。
- `AudioNode.tsx` / `VideoNode.tsx` / `ThreeDNode.tsx` —— 删除各自的 `ErrorBody`，改用新组件。
- `ImageNode.tsx` —— **补上缺失的 `status === 'error'` 分支**。

**测试** 新建 `src/components/canvas/nodes/GenErrorBody.test.tsx`
- 有 `failure.message` → 显示后端原文。
- 无 `failure` → 显示通用文案 `Generation failed`。
- 不含任何硬编码色值（断言 `className` / `style` 里出现 `--color-danger`，且不出现 `#ef4444` / `#b91c1c`）。
- 四种节点在 `status='error'` 时都渲染出失败体（在各 Node 的测试里各加一条，尤其 `ImageNode` 是新增能力）。

**验证**
```bash
pnpm exec vitest run src/components/canvas/nodes/
grep -rn "#ef4444\|#b91c1c" src/   # 应无输出
```

---

## T2 同步生成失败：占位卡就地转失败态

**改动**
- `src/store/actions.ts` `runGen` catch 分支
  - `ABORTED` 仍静默返回（用户主动取消不是失败）。
  - 其余错误：不再 `removeGenPlaceholders`，改调新增的 `markPlaceholdersFailed(placeholderIds, failure)` —— 把这些占位卡标 `status:'error'` + 挂 `failure`（取 `PgcError.failure`，无则 `null`）。仍照抛给 `guard` 弹 Toast（约束 6）。
  - 切项目后不写（`get().currentProjectId !== pid` 早返回，沿用既有防线）。

**测试** 新建 `src/store/gen-failure.test.ts`
- 图像生成失败：占位卡**留在** assets、`status==='error'`、`failure` 挂上；Toast 仍弹。
- `PgcError` 带 `failure`（内容审核 422）→ 卡上 failure 与之相等。
- `ABORTED` → 卡被移除（用户取消语义不变），不留失败卡。
- 失败后切项目 → 不往新项目写失败卡。
- 批量 `n=4` 中途失败 → 四张占位卡都转失败态（不是只标第一张）。

**验证**
```bash
pnpm exec vitest run src/store/gen-failure.test.ts src/store/actions.assetgen.test.ts
```

---

## T3 异步失败：failGenTask 不再删卡

**改动**
- `src/store/actions.ts` `failGenTask` —— 去掉本地删卡，改标失败态；`deleteRemote` 仍清服务端残留（服务端那份没用了，但本地卡要留给用户看原因）。
- `settleDerivedFailure` —— 确认 `failure` 落到卡上（现状已保留卡，可能只需补 failure 传递）。
- 复核 `pollGenTasks` 的超时 / 连续失败兜底路径也走同一出口，不绕过。

**测试** `src/store/gen-failure.test.ts` 追加
- 视频任务级失败 → 卡留下且 `status='error'`、`failure` 来自 `task.failure`。
- item 级失败 → 同上。
- 派生（rig3d）失败 → 卡留下且带 failure（回归）。
- 轮询超时兜底 → 卡留下（不是静默消失）。
- 服务端残留仍被清（`deleteCanvasItem` 被调）。

**验证**
```bash
pnpm exec vitest run src/store/gen-failure.test.ts src/store/actions.test.ts
```

---

## T4 重试参数注册表 + 两个 action + 卡上按钮

**改动**
- `src/store/actions.ts`
  - 闭包 `retrySpecs = new Map<string, RetrySpec>()`，有界上限 50（防长会话膨胀）。
  - `runGen` 落占位卡时登记；成功替换后删键；占位卡被真实 item 原位替换时**迁移键**（否则异步失败时找不到 spec）。
  - `retryGeneration(assetId)`：取 spec → 移除失败卡 → 按 kind 分派既有 `generate*`，`opts.spawnAt` = 失败卡当前坐标（原位变回 generating）。无 spec → 降级 `openGenForm`。
  - `openRetryForm(assetId)`：`openGenForm` + `prefill`。
- `src/components/canvas/GenerateForm.tsx` —— 新增可选 `prefill`（prompt / model / params），无则空表单（现状）。
- `src/store/index.ts` —— `GenFormState` 增 `prefill?`。
- `GenErrorBody` —— 加重试按钮：`retryable !== false` → 「重试」调 `retryGeneration`；`=== false` → 「修改后重试」调 `openRetryForm`。
- i18n × 11 —— `canvas.retry` / `canvas.retryAfterEdit`。

**测试** `src/store/gen-failure.test.ts` 追加 + `GenErrorBody.test.tsx` 追加
- 失败后 `retryGeneration` → 原参数重发（断言 `genImage` 收到与首次相同的 body）、失败卡被移除、新占位卡落在原坐标。
- 无 spec（模拟刷新）→ 不发请求，改开 `genForm`。
- `retryable === false` → 卡上按钮文案是「修改后重试」，点击开 `genForm` 且带 `prefill`。
- `retryable !== false` → 按钮文案「重试」，点击调 `retryGeneration`。
- 注册表上限 50：超出丢最旧。

**验证**
```bash
pnpm exec vitest run src/store/gen-failure.test.ts src/components/canvas/nodes/GenErrorBody.test.tsx src/components/canvas/GenerateForm.test.tsx
```

---

## T5 全量验证与真实环境验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真实环境（`pnpm dev`，端口避开 3000）走 spec 成功标准 1–9。
  **触发真实失败的办法**：用必然被内容审核拒绝的 prompt 走一次图像生成（同步、最快、`retryable=false` 分支也能验到）；异步路径用视频生成配同类 prompt。⚠️ 会消耗少量积分 —— 先跟 Nick 确认再跑，或改用可控的失败注入（临时把 `PGC_BASE_URL` 指向不可达地址触发 NETWORK 错误，验「保留卡 + 通用文案 + 重试」这条主干，`retryable=false` 分支留给单测）。
- 验收后删测试项目、删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每个任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
