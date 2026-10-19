# 模型侧不可重试失败 → 引导切换模型 — 实现计划

> spec：`docs/superpowers/specs/2026-09-03-model-switch-on-fatal-error.md`。每个任务先写失败测试再实现，可独立评审。
>
> ⚠️ **本计划对应第一版（独立换模型卡），已按 spec 顶部「方案变更（2026-09-03 二）」整体退役**：`ModelSwitchCard` / `lib/model-switch.ts` / `switchDismissed` / `dismissModelSwitch` 均已删除。当前实现 = `AgentErrorBubble` 内嵌提示 + Switch model → `requestModelMenu()` → `ModelSelector` 经 `Select.openRequest` 展开。以下任务清单仅作历史记录。

## 任务 1：reducer 记事实

- `AgentError` 加 `retryable?: false` / `switchDismissed?: true`（`src/store/types.ts`）。
- `pushAgentError` 在 `f.retryable === false` 时写 `retryable: false`；其余不写字段（形状一致）。
- 测试 `apply-koubou.test.ts`：`retryable:false` 的 error 事件 → `agentError.retryable === false`；`retryable:true` 耗尽 / 缺失 → 无该字段。

## 任务 2：纯函数 + selector

- `src/lib/model-switch.ts`：`defaultSwitchTarget(models, current)`，单测。
- `src/store/selectors.ts`：`selectModelSwitchOffer`，单测覆盖 5 条否定分支（dismissed / 无 lastSend / 自愈中 / running / 门禁 / 单模型）。

## 任务 3：action `dismissModelSwitch`

- store：`agentError` 存在时置 `switchDismissed: true`。单测。

## 任务 4：i18n

- 11 个 locale 加 `chat.modelSwitch.{title,keep,change}`；`i18n.test.ts` 既有的键一致性测试守护。

## 任务 5：组件

- `ModelSelector.tsx` 导出 `modelOptions(models, t)`，`ModelSelector` 自身改用。
- 新建 `ModelSwitchCard.tsx` + 测试（渲染门控、Change model 调 setModel + 进入自愈、Keep 退回红色气泡）。
- `AgentErrorBubble` 在 offer 为真时不渲染（补测试）。
- `ChatPanel` 固定槽挂 `<ModelSwitchCard client={client} />`。

## 任务 6：验证与收口

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test`。
- 子代理干净上下文评审 diff。
- 合入 dev（`--no-ff`），登记 `scripts/release-board/epics.json`。
