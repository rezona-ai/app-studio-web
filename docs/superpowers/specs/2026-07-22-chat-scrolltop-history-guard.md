# 聊天滚顶翻页误触发修复（刷新恢复期"上拉刷新"卡死）

日期：2026-07-22

## 问题

agent 响应过程中刷新页面，有概率进入"不停请求历史 events、聊天停在历史里不动、WS 迟迟不恢复"的卡死态。

## 根因

`ChatPanel.onScroll` 的滚顶翻页条件只看 `scrollTop <= 60 && historyHasMore`（`ChatPanel.tsx:102`），**不区分用户主动上滑与被动/程序性滚动**。刷新恢复链路会天然制造"被动到顶"：

1. 挂载先渲染 localStorage 快照的完整消息并瞬时滚底；
2. 随后 REST 种子化（`listEvents limit 50`）经 `seedKoubouHistory` **整体替换** messages——响应中的最近 50 条事件大半是 tool/stream 帧，可见消息骤减 → 内容高度骤缩 → 浏览器把 `scrollTop` 钳到 0（钳制本身会派发 scroll 事件），且此时 `historyHasMore=true`；
3. `smooth` 滚底动画途经 0–60px 区间时同样派发 scroll 事件。

两者都会误触发 `loadOlderMessages`。该 action 一次手势最多串行拉 50 页，每页对全量事件日志整体 rebuild（O(n²)）并整列表重渲 → 主线程冻结（"卡住"）；冻结拖垮 `mintTicket`（10s 超时）连续失败 5 次后连接进 `stalled` 放弃自动重连（"不重连"）；手势结束后 scrollTop 仍在顶部附近，下一个 scroll 事件再开一轮（"一直请求历史"）。

## 方案

### 方案 A（推荐）：用户交互意图门控（源头分流）

翻页只在"用户自上次程序性滚底之后与滚动区有过交互"时允许：

- `ChatPanel` 增加 `userIntentRef`（boolean ref）：
  - 滚动容器上的 `wheel` / `pointerdown` / `keydown` / `touchmove` 置 true（覆盖滚轮、触控板、拖拽原生滚动条、键盘翻页）；
  - `scrollToBottom()`（程序性滚底，含瞬时与 smooth）置 false。
- `onScroll` 翻页条件追加 `userIntentRef.current`。

被动到顶（种子化钳制、smooth 滚底路过顶区）没有用户输入 → 不翻页；用户真实上滑 → 任何输入通路都先经交互事件 → 正常翻页。零新状态、无计时器、纯 ref，不引发重渲。

### 方案 B（否决）：翻页改挂 wheel 事件

只响应 `wheel deltaY<0`。否决：拖原生滚动条、键盘翻页到顶将永远无法加载更早历史，属功能回归。

### 方案 C（否决）：节流/去抖 loadOlderMessages

不修根因，只是把风暴变慢；被动触发依旧存在，视口仍会被甩进历史。

## 不做的事（YAGNI）

- 不改 `loadOlderMessages` 的 50 页/手势循环与 rebuild 成本：误触发消除后，该循环只在用户真实翻长历史时工作，属既有设计（Bug #13426934 的死区兜底）。
- 不改连接层 `stalled` 语义：主线程不再被冻结，ticket 连败路径不复现。

## 成功标准

- 无用户交互时派发 scroll(scrollTop=0) 事件 → `loadOlderMessages` 不被调用；
- 用户 wheel/pointerdown 后同样的 scroll 事件 → 正常触发；
- 程序性滚底后（未再交互）路过顶区 → 不触发；
- 既有 ChatPanel 测试全绿，`tsc --noEmit` 通过。
