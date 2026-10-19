# Agent 对话消息复制与编辑实施计划

> 日期：2026-07-25
> 对应设计：`docs/superpowers/specs/2026-07-25-chat-message-copy-edit-design.md`

## 任务一：用测试锁定消息操作行为

涉及文件：

- `src/components/chat/MessageItem.test.tsx`
- `src/components/chat/Composer.test.tsx`

步骤：

1. 增加用户消息复制测试，断言复制引用剥离前的原始输入。
2. 增加用户消息编辑测试，断言草稿被替换且现有附件保留。
3. 增加回合文本聚合 selector 测试，锁定多 text/tool 消息只在回合末尾生成一份原始 Markdown。
4. 增加 ChatPanel 回合级复制测试，断言中间正文无操作栏、回合末尾只有一个复制按钮。
5. 增加纯工具回合无复制按钮、剪贴板失败走 Warning Toast 的测试。
6. 增加 Composer 收到编辑聚焦请求后聚焦并把光标移到草稿末尾的测试。
7. 运行目标测试，确认因按钮、action、回合聚合与聚焦请求尚不存在而失败。

验证命令：

```bash
pnpm exec vitest run src/components/chat/MessageItem.test.tsx src/components/chat/Composer.test.tsx
```

完成后提交：

```text
test: 补充对话消息复制与编辑行为测试
```

## 任务二：实现 store 编辑请求与 Composer 聚焦

涉及文件：

- `src/store/index.ts`
- `src/components/chat/Composer.tsx`

步骤：

1. 增加不持久化的 `composerFocusRequest` 瞬态状态。
2. 增加 `editComposerDraft(draft)` action，原子替换草稿并递增聚焦请求，保留现有附件与输入框基准高度。
3. Composer 订阅聚焦请求，在请求变化后自行聚焦并把光标移到草稿末尾。
4. 运行 Composer 与 store 相关测试。

验证命令：

```bash
pnpm exec vitest run src/components/chat/Composer.test.tsx src/store/composer-baselines.test.ts src/store/composer-mention.test.ts
git diff --check
```

完成后提交：

```text
feat: 支持历史输入回填到对话编辑器
```

## 任务三：实现消息复制与编辑操作栏

涉及文件：

- `src/components/chat/MessageActions.tsx`
- `src/components/chat/MessageItem.tsx`
- `src/components/chat/ChatPanel.tsx`
- `src/store/selectors.ts`
- `src/components/ui/figma.tsx`
- `src/i18n/locales/*.ts`

步骤：

1. 从用户消息派生原始可复制文本。
2. 以结束回合锚点聚合该轮全部助手原始文本。
3. 抽出复用既有基础组件的消息操作栏。
4. 用户消息接入 hover 复制和 `editComposerDraft`，使用固定占位避免 hover 布局跳动。
5. ChatPanel 只在已结束回合末尾渲染一个始终可见的助手复制操作。
6. 加入复制成功的短暂勾选反馈与 timer 清理。
7. 剪贴板失败复用全局 Warning Toast。
8. 为所有 locale 增加消息复制、已复制、编辑词条。
9. 运行 selector、ChatPanel、MessageItem、Composer 与 i18n 相关测试。

验证命令：

```bash
pnpm exec vitest run src/components/chat/MessageItem.test.tsx src/components/chat/Composer.test.tsx src/i18n
git diff --check
```

完成后提交：

```text
feat: 增加对话消息复制与输入编辑操作
```

## 任务四：完整验证

步骤：

1. 检查 worktree diff、提交分组与分支落点。
2. 运行与 CI 一致的全部本地门。

验证命令：

```bash
git status --short --branch
git diff --check
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
git log --oneline --decorate -8
```

通过标准：

- 所有命令退出码为 0；
- 目标分支为 `feat/chat-message-copy-edit`；
- 仅包含本需求文档、测试和实现；
- 用户输入支持复制与回填编辑，助手文本支持原始 Markdown 复制；
- 消息历史、附件状态与 Koubou 协议未被改写。
