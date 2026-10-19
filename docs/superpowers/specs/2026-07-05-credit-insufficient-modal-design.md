# 积分不足改模态提醒并引导充值 — 设计稿

日期：2026-07-05

## 背景与目标

当前「积分不足」错误有两条冒泡路径，均以普通报错呈现：

1. **PGC 生成侧**：生成图片/音频/视频/3D 等 REST 调用失败 → `guard()` 把 `PgcError` 写入 `lastError` → 全局 Toast。
2. **Koubou 对话侧**：WS 下发 `credit.insufficient` 事件 → `applyKoubou` 追加一条 `CREDIT_INSUFFICIENT` 错误气泡到聊天。

目标：两条路径命中积分不足时**不再走普通报错**，改为弹出模态框提醒「积分不足」，并提供「去充值」按钮跳转主站充值页 `/studio/settings?section=recharge`。

## 决策记录

| 决策点 | 结论 |
|---|---|
| PGC 侧积分错误码 | apifox 未文档化。采用**模糊匹配**：`code` 或 `failure?.code` 不区分大小写含 `CREDIT` 或 `INSUFFICIENT` 即视为积分不足 |
| 充值页打开方式 | **新标签页** `window.open`，同域主站路径，不丢创作现场 |
| 对话侧原错误气泡 | **删除**，只弹模态，聊天记录不再出现积分不足条目 |

## 总体方案：源头分流

不在 Toast/气泡出口拦截，而是在两个错误**入口**处识别积分不足并改道进模态开关，其余错误链路零改动。

### 识别规则（纯函数）

新增 `src/lib/credit-error.ts`：

```ts
// PgcError 形态的积分不足判定：code / failure.code 含 CREDIT 或 INSUFFICIENT（忽略大小写）
export function isCreditError(e: { code: string; failure?: { code: string } | null }): boolean
```

下沉 `lib/` 单测覆盖：命中 `CREDIT_INSUFFICIENT` / `insufficient_credits` / `NoCredit` 等变体；不命中普通码。

### Store

- `UIState` 新增 `creditModalOpen: boolean`（**瞬态，不持久化**）。
- Action `setCreditModalOpen(open: boolean)`。

### 触发点 ①：PGC guard 分流

`src/store/actions.ts` 的 `guard` / `guardRethrow`：捕获 `PgcError` 时（401 分支之后）先判 `isCreditError`——命中则 `set({ creditModalOpen: true })`，**不写 `lastError`**（不弹 Toast）；未命中走原逻辑。`guardRethrow` 命中后仍照抛（保留其「调用方感知失败」契约）。

### 触发点 ②：Koubou live 帧分流

- `src/store/index.ts` 的 `ingestKoubou` action：交给 reducer 前检查 `event.type === 'credit.insufficient'` 且 `event.sequence` 不在当前 `koubou.seenSequences`（防重连重放二次弹窗）→ `set({ creditModalOpen: true })`。
- `src/koubou/apply-koubou.ts`：删除 `case 'credit.insufficient'` 的 `pushErrorBubble` 分支（改为 return state，不留气泡）。
- 冷启动历史重建（`session.ready.visible_state.messages`）在 reducer 内部重放，不经过 `ingestKoubou` 的逐帧判断，天然不弹模态。

### 模态 UI

新组件 `src/components/ui/CreditModal.tsx`，挂在 `Workspace`，订阅 `creditModalOpen`：

- 复用既有模态范式：遮罩 `.modal-backdrop` + 面板 `.modal-pop`、`rounded-[24px]`、`useExitTransition` 播退场再卸载、z-index 沿用 Modal 阶梯（遮罩 z-40）。
- 颜色/阴影/圆角全走 CSS 变量令牌，主 CTA 用 `Button`（`.btn-raised`），次按钮用既有次级样式；交互元素带 `aria-label`。
- 内容：标题「积分不足」+ 说明文案 + 「取消」（关闭）+ 主 CTA「去充值」。
- 「去充值」：`window.open(window.location.origin + '/studio/settings?section=recharge', '_blank')` 后关闭模态。主站页面属外部路径，**不经** `apiPath()`/`assetPath()`（那只用于本服务自身路径）。

### i18n

六语（en/zh/fr/ru/ja/vi）新增模态文案键（标题/说明/取消/去充值），en 为单一真相源。原 `errors.koubou.creditInsufficient` 键随气泡删除一并清理（不留 dead key）。

## 测试

| 目标 | 用例 |
|---|---|
| `isCreditError` | 命中各命名变体（含 failure.code）；不命中普通码 |
| `applyKoubou` | 更新既有 `credit.insufficient` 用例：不再产气泡（state 不变） |
| store actions | guard 遇 credit 类 `PgcError` → `creditModalOpen=true` 且 `lastError` 为 null；普通错误仍走 Toast |
| `ingestKoubou` | live `credit.insufficient` 帧 → 模态开；重复 sequence 重放不二次触发 |
| `CreditModal` | 开关渲染、取消关闭、「去充值」调用 `window.open` 正确 URL |

## 明确不做

- 不做余额预检（发起前查 `spendable` 拦截）——以后端错误为准。
- 不做充值完成后的余额自动刷新/轮询。
- 不改 `credit`（余额条）相关既有逻辑。
