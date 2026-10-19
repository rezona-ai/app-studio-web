# 实现计划：创作溯源落库与资产属性面板

> 设计稿：`docs/superpowers/specs/2026-08-03-canvas-provenance.md`
> 分支：`feat/canvas-provenance`

先落数据（看不见但能验），再切换重试数据源并删旧机制，最后做面板。每步系统保持可运行、每个任务一次提交。

---

## T1 provenance 落库与读回

**改动**
- `src/store/types.ts` —— 新增 `AssetProvenance`；`Asset` 加 `provenance?`，**删掉死字段 `prompt`**。
- `src/lib/pgc/map.ts`
  - `CanvasReference` 加 `provenance?: AssetProvenance`。
  - `assetReference()` 增一行透出 —— **这是约束 2 那个坑的封堵点**。
  - `canvasItemToAsset()` 读入：后端顶层字段优先（当前无，留位），回落 `reference.provenance`。
- `src/store/actions.ts` —— `runGen` 的 `spec` 转成 provenance，在 `settleGenPlaceholders` / `startAsyncGen` 挂到真实 Asset 上；由 `placeAndLink` 既有回写顺带落库（零额外请求）。

**测试** 新建 `src/store/provenance.test.ts`
- 图像生成成功 → 真实卡带 provenance，且 `updateCanvasReference` 的 payload 里含它。
- **坐标回写后 provenance 不丢**（拖拽 → `persistAssetPosition` → 断言 payload 仍含 provenance）。这条是回归防线，最重要。
- `canvasItemToAsset` 能从 `reference.provenance` 读回；无则 `undefined`。
- 后端顶层字段存在时优先于 reference（喂一个假字段验优先级，为将来上线铺路）。
- 异步（video）走 `startAsyncGen` 同样落库。
- 上传 / 素材库导入的资产无 provenance，不误挂。

**验证**
```bash
pnpm exec vitest run src/store/provenance.test.ts src/lib/pgc/map.test.ts
```

---

## T2 重试改读落库 provenance，retrySpecs 退役

**改动**
- `src/store/index.ts` —— `retryGeneration` / `openRetryForm` 改读 `asset.provenance`；无 provenance 仍降级开空表单（成功标准 6 的行为不变）。
- `src/store/actions.ts` —— 删注册表与 `peekRetrySpec` / `takeRetrySpec` / `runRetry`（`runRetry` 的中心点换算逻辑保留，挪进新的落点）；`runGen` 的 `spec` 入参改名/改语义为 provenance 源。
- **删** `src/store/gen-retry.ts` 与 `src/store/gen-retry.test.ts` 中针对注册表生命周期的用例（跨刷新等价用例迁到 `provenance.test.ts`）。
- ⚠️ 保留 `runRetry` 里那条 **`spawnAt` 是卡片中心而非左上角**的逆变换与注释 —— 上一步踩过，别丢。

**测试**
- `provenance.test.ts` 追加：从落库 provenance 重发 → 请求体与首次相同、新卡落回原位。
- **模拟刷新**（重建 store、只保留服务端回包）后重试**仍能原参数重发** —— 这是本任务的核心价值，`retrySpecs` 时代做不到。
- `GenErrorBody` 既有用例全绿（失败卡重试行为不回退）。

**验证**
```bash
pnpm exec vitest run src/store/provenance.test.ts src/components/canvas/nodes/GenErrorBody.test.tsx
grep -rn "retrySpec" src/   # 应无输出
```

---

## T3 面板骨架与开关

**改动**
- `src/store/index.ts` —— `UIState` 加 `inspectorOpen: boolean`；action `toggleInspector`；**进 `partialize` 白名单**（持久化，与 `visibleKinds` 同级）。
- `src/components/canvas/AssetInspector.tsx`（新）—— 本任务只做外壳：浮层容器 + 未选中引导态 + 单选时的名称/类型/来源，暂不含 prompt 与动作区。
- `src/components/canvas/AssetCanvas.tsx` —— 底部工具条加开关按钮（同 minimap 写法）；挂载面板。
- i18n × 11 —— `canvas.inspector.*`（标题 / 空态引导 / 各分区标签）。

**测试** 新建 `src/components/canvas/AssetInspector.test.tsx`
- 关闭时不渲染；开启且未选中显示引导文案；开启且选中显示名称与类型。
- 开关状态进持久化切片（断言 `partialize` 输出含 `inspectorOpen`）。
- 退场走过渡不直接卸载。

**验证**
```bash
pnpm exec vitest run src/components/canvas/AssetInspector.test.tsx src/store/persist-storage.test.ts
```

---

## T4 面板内容：提示词 / 参数 / 血缘 / 再生成

**改动**
- `AssetInspector.tsx` 补齐四个分区：
  - 提示词（可滚 + 一键复制，复用既有 clipboard 与 `setSuccess` 反馈）；`provenance` 缺失**整段不渲染**。
  - 模型与参数：`parseGenPrefill` 反解后按 `GEN_FIELDS` 的 label 列出，只列用户设过的。
  - 来源与血缘：上下游可点跳转（`setSelection` + `ensureVisible`）。
  - 动作：「以相同参数再生成」→ 复用 T2 的 `retryGeneration`。
- 多选态：显示「已选 N 项」+ 类型分布。
- i18n × 11 补齐。

**测试**
- 有 provenance → 显示 prompt 原文、模型名、设过的参数；点复制写入剪贴板。
- 无 provenance（上传/agent 生成/历史资产）→ 提示词段与再生成按钮**都不出现**，其余信息照常。
- 血缘点击 → 选中目标并调 `ensureVisible`。
- 多选 → 显示数量，不只渲染第一张。

**验证**
```bash
pnpm exec vitest run src/components/canvas/AssetInspector.test.tsx
```

---

## T5 全量验证与真实环境验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机（`pnpm dev`，端口避开 3000/3001）走成功标准 1–9，重点两条**只有真机能验**的：
  1. 生成 → **刷新** → 面板仍显示 prompt/模型（落库真的生效）
  2. 刷新后点「以相同参数再生成」确实原参数重发（对比两次请求体）
- 需要真实生成，会消耗积分 —— 开跑前跟 Nick 确认。
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
