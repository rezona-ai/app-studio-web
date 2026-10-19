# 移动端拦截提醒页 · 设计稿

日期：2026-07-04

## 背景与目标

工作台是固定桌面三栏布局（Chat | Canvas | Preview），无移动端断点，手机/平板上不可用。当判定用户是移动端设备时，展示一个错误提醒页，说明当前页面不支持移动端。

已确认的决策：

- **判定方式**：UA 判定（不看视口宽度，桌面缩窄窗口不受影响）。
- **平板**：iPad 等平板同样拦截。
- **拦截强度**：硬拦截，不提供「仍要继续访问」入口；移动端完全不加载工作台（不建 WS、不轮询）。

## 方案

服务端 UA 判定为主 + 客户端 iPadOS 补判。

### 判定逻辑（纯函数，`src/lib/mobile-ua.ts`）

```ts
isMobileUA(ua: string): boolean
```

正则匹配移动端 UA 标记：`Android`、`iPhone`、`iPad`、`iPod`、`Mobile`、`Windows Phone` 等（大小写不敏感）。同目录单测覆盖：

- 命中：iPhone Safari、Android Chrome（手机）、Android 平板、明示 UA 的 iPad、微信/移动端内嵌 WebView。
- 不误伤：桌面 Chrome / Safari / Firefox / Edge（注意 Firefox 桌面 UA 不含 `Mobile`，Chrome 桌面 UA 不含以上标记）。

### 入口改造（`src/app/page.tsx`）

`page.tsx` 改为 **server component**：

1. `headers()` 读 `user-agent`；
2. `isMobileUA(ua)` 命中 → 渲染 `<MobileBlockPage />`；
3. 未命中 → 渲染现有客户端入口（原 page 内容平移为 `'use client'` 组件 `src/components/workspace/WorkspaceEntry.tsx`：`I18nProvider` + `Workspace`）。

服务端决定渲染哪棵树，不存在 hydration mismatch（本项目 mismatch 会连带抹掉 `<html data-theme>`，必须避免）。

### iPadOS 补判（客户端）

iPadOS Safari 默认伪装桌面 Mac UA，服务端识别不到。在 `WorkspaceEntry` 顶部做客户端补判：

- 条件：`navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)`；
- 实现遵守仓库 hooks lint 约束（禁 effect-setState），用渲染期 guard 切换渲染 `MobileBlockPage`，避免首帧闪工作台；
- SSR 首帧与客户端首帧保持一致（首帧按桌面渲染，仅真 iPad 上补判后切提醒页——该切换发生在极少数设备上，可接受一次替换渲染）。

### 提醒页 UI（`src/components/workspace/MobileBlockPage.tsx`）

- 全屏居中竖排：产品 logo（`FigIcon`，tone `original`）+ 标题 + 一句说明（请在桌面端浏览器访问）。
- 无按钮、无交互、不监听 resize/旋转。
- 样式全走设计令牌：底 `--color-surface-2`、标题 `--color-ink`、说明 `--color-muted`；字体沿用既有令牌；不引入硬编码色值与新动效。
- 组件需服务端/客户端两端可渲染（server 路径与 iPadOS 补判路径共用）。
- 文案走 react-i18next，六语（en/zh/fr/ru/ja/vi）各补一套 key，en 为单一真相源。注意：server component 渲染路径拿不到客户端 i18n runtime，提醒页文案的取法需在实现时统一（方案：提醒页自身为 client 组件挂 `I18nProvider`，server 侧仅做条件分发，不直接渲染文案）。

## 不做的事（YAGNI）

- 不做「继续访问」放行入口。
- 不做视口宽度判定、resize/旋转监听。
- 不做移动端适配的预告/引导文案。
- 不引入 middleware / 新路由。

## 测试

- `mobile-ua.test.ts`：UA 纯函数判定矩阵（见上）。
- 组件测试：`MobileBlockPage` 渲染标题/说明文案与 aria 结构。
- 入口分发逻辑以纯函数 + UA 矩阵为主；server component 分发本身逻辑极薄，不强行为其造测试。
