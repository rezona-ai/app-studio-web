# 实现计划：聊天滚顶翻页的用户意图门控

对应设计稿：`docs/superpowers/specs/2026-07-22-chat-scrolltop-history-guard.md`（方案 A）。

## 任务 1：失败测试（TDD）

`src/components/chat/ChatPanel.test.tsx` 新增三例（store 注入 `loadOlderMessages` spy + `historyHasMore:true`，对滚动容器派发事件）：

1. 无用户交互 → scroll(scrollTop=0) 不触发翻页；
2. wheel 交互后 → 同样的 scroll 触发翻页；
3. 程序性滚底（runStatus 翻转触发 scrollToBottom）后未再交互 → scroll 不触发。

验证：`pnpm exec vitest run src/components/chat/ChatPanel.test.tsx`（新例应以"spy 被误调/未调"失败）。

## 任务 2：实现

`src/components/chat/ChatPanel.tsx`：

- 新增 `userIntentRef = useRef(false)`；
- 滚动容器绑 `onWheel` / `onPointerDown` / `onKeyDown` / `onTouchMove` → 置 true；
- `scrollToBottom()` 首行置 false；
- `onScroll` 翻页分支追加 `userIntentRef.current` 条件（贴底/showJump 维护不变）。

验证：任务 1 测试转绿 + 全量 `pnpm test` + `pnpm exec tsc --noEmit`。

## 任务 3：提交与回合

`docs:` 与 `feat:` 成对提交；`--no-ff` 回合 dev 后删分支、清理 worktree。
