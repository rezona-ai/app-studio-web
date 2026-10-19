# 主站 postMessage 实时主题 / 语言更新 设计稿

> 日期：2026-06-17 · 范围：仅主题 + lang 管线（不引入 i18n 框架）

## 背景

本应用是部署在主站同域名 `/game/*` 下的**分站**，不自管主题，配置由主站写入。当前实现：

- 主站把配置存于同源 `localStorage['taluna-config']`（JSON，含 `theme: 'dark'|'light'`）。
- `src/app/layout.tsx` 的防白闪内联脚本在水合前读该配置，写到 `<html data-theme>`（缺省深色）；`<html lang="en">` 当前**写死**。
- `src/client/useIsDark.ts` 经 `useSyncExternalStore` 读 `data-theme`，但 `subscribe` 是 **no-op**——主题**运行期不会变**。
- 项目**无任何 i18n 框架**（无 next-intl / message catalog），UI 文案是散落组件里的英文字面量。

主站在切换主题 / 语言时会通过 `postMessage` 通知分站，消息格式：

```js
{
  type: 'taluna-config',
  key: 'taluna-config',
  config: { lang, theme },
}
```

本设计实现对该事件的处理，使**主题**在运行期实时响应，并把 **lang** 接收、同步到 `<html lang>` 作为后续 i18n 接入的种子。真正的文案翻译留到以后单独立项，本次不做。

**localStorage 完全由主站管理**：分站只把配置应用到 DOM，**不回写** `localStorage['taluna-config']`。刷新后的初始值（无白闪）依赖主站已持久化的 localStorage，由防白闪脚本读取。

## 目标与非目标

**目标**
- 监听主站 `taluna-config` postMessage，实时更新主题（亮 / 暗）。
- 接收 `lang`，同步到 `<html lang>` / `document.documentElement.lang` 作为后续 i18n 接入的种子。
- 校验来源（同源），对非法 / 畸形消息容错跳过。

**非目标（YAGNI）**
- 不引入 i18n 框架、不抽取文案、不做可见文案翻译。
- 不回写 localStorage —— `taluna-config` 完全由主站管理。
- 不新增无消费者的 `useLang` 之类 hook（会成 dead code，违反项目反模式）。

## 方案选型

核心轴：主题如何做到运行期响应。当前主题真相源就是 `<html data-theme>`（不在 store 里）。

- **方案 A（采纳）— DOM 属性为单一真相源 + MutationObserver**：postMessage hook 写 `<html data-theme/lang>`（不回写 localStorage，由主站管理）；`useIsDark` 的 `subscribe` 改为监听 `data-theme` 的 `MutationObserver`。改动最小、与现状一致、写读解耦。
- 方案 B — 收进 zustand store：theme 本不在 store，会与 `data-theme`（防白闪仍需）形成双真相源，`useIsDark` 与组件读法都要改，churn 大。否决。
- 方案 C — 自定义事件总线：`data-theme` 本身即天然变更信道，再造 ad-hoc 通道冗余。否决。

## 架构与数据流

```
主站 ──postMessage{type:'taluna-config',config:{lang,theme}}──▶ window('message')
  └─ useHostConfig（src/client，副作用）
       │  try/catch 跳过非法帧
       ├─ parseHostConfig(data, event.origin, location.origin)  ← 纯函数（src/lib）
       │     └─ 校验 origin===self & type==='taluna-config' & config 形状 → { theme, lang? } | null
       ├─ 写 documentElement.dataset.theme（仅当变化）──观察──▶ useIsDark(MutationObserver) ─▶ 组件重渲染
       └─ 写 documentElement.lang（仅当变化）
              （不回写 localStorage —— 由主站管理）
```

分层遵循项目约定：**解析 / 归一是无副作用纯函数下沉 `lib/`，监听 / DOM / IO 隔离在 `client/` hook**。

## 组件设计

### 1. `src/lib/host-config.ts`（新，纯函数）

- `parseHostConfig(data: unknown, origin: string, selfOrigin: string): { theme: 'light' | 'dark'; lang?: string } | null`
  - `origin !== selfOrigin` → `null`（同源校验，承载方式为同源 `/game` 路径页）。
  - `data` 非对象或 `data.type !== 'taluna-config'` → `null`。
  - `config` 非对象 → `null`。
  - `theme` 归一**沿用现有防白闪逻辑**：`config.theme === 'light' ? 'light' : 'dark'`（其余 / 缺省 / 异常一律深色）。
  - `lang`：仅当为非空字符串时带上 `lang` 字段，否则省略（不污染既有 lang）。

### 2. `src/client/useHostConfig.ts`（新，副作用 hook）

- 挂载：`window.addEventListener('message', handler)`。
- `handler`：`try/catch` 包裹（沿用"非法 WS 帧 try/catch 跳过"哲学）；调用 `parseHostConfig(e.data, e.origin, location.origin)`，`null` 直接返回。
- 应用（仅写 DOM，不碰 localStorage）：
  - `theme`：仅当 `documentElement.dataset.theme !== next` 时写入（避免无谓 mutation 触发空转重渲染）。
  - `lang`：仅当存在且 `documentElement.lang !== lang` 时写入。
- 卸载：`removeEventListener`。

### 3. `src/client/useIsDark.ts`（改）

- `subscribe` 由 no-op 改为对 `document.documentElement` 的 `MutationObserver`（`{ attributes: true, attributeFilter: ['data-theme'] }`），变更时调用回调；返回 disconnect 清理函数。
- `getSnapshot` / `getServerSnapshot` 不变。
- 更新文件头注释：从"运行期不切换"改为"由主站 postMessage 实时切换，本 hook 监听 data-theme 变更"。

### 4. `src/app/layout.tsx`（改）

- 防白闪内联脚本在设 `data-theme` 之外，同步从 `config.lang` 设 `document.documentElement.lang`（仅当为非空字符串时）。
- `<html lang="en">` 默认保留，由脚本在运行期覆盖；`<html>` 已有 `suppressHydrationWarning`，与 `data-theme` 同样处理，无水合告警。
- 更新内联注释，说明同时处理 theme 与 lang，且运行期可由 postMessage 实时变更。

### 5. `src/components/workspace/Workspace.tsx`（改）

- 与其它全局 hook 并列调用一次 `useHostConfig()`。

## 错误处理

- **来源校验**：`origin !== location.origin` 的消息一律忽略（同源承载）。
- **畸形消息**：`parseHostConfig` 对类型 / 形状全部防御，整体非法返回 `null`；hook 再包 `try/catch` 兜底，不抛出。
- **幂等**：theme / lang 仅在值变化时写 DOM，避免 MutationObserver 空转。

## 测试（TDD，同目录 `*.test.ts`）

- `src/lib/host-config.test.ts`
  - 错误 origin → `null`；错误 / 缺失 `type` → `null`；`config` 非对象 → `null`。
  - theme 归一：`'light'→'light'`；`'dark'` / 缺省 / 非法 → `'dark'`。
  - lang：非空字符串被带上；空串 / 非字符串被丢弃（结果无 `lang`）。
- `src/client/useIsDark.test.ts`（已存在，补充）
  - 改 `documentElement.dataset.theme` 后，hook 快照随之更新（验证 MutationObserver 订阅生效）。
- `src/client/useHostConfig.test.tsx`（新）
  - 派发合法同源 `MessageEvent`：`data-theme` / `lang` 被更新。
  - 派发异源 / 畸形 `MessageEvent`：DOM 不变。
  - 卸载后再派发：监听已移除，无副作用。

## 影响面

仅前端，无后端 / 协议 / 代理 / localStorage 改动（localStorage 由主站管理）。改动文件：`src/lib/host-config.ts`（新）、`src/client/useHostConfig.ts`（新）、`src/client/useIsDark.ts`、`src/app/layout.tsx`、`src/components/workspace/Workspace.tsx`，及对应测试。
