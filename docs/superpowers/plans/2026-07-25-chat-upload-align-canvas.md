# 对话栏文件上传对齐画布实施计划

> 日期：2026-07-25  
> 对应设计：`docs/superpowers/specs/2026-07-25-chat-upload-align-canvas-design.md`

## 任务一：用测试锁定五种文件类型策略

涉及文件：

- `src/lib/upload-policy.test.ts`

步骤：

1. 把 chat 3D 拒绝用例改为放行标准 MIME、空 MIME和 octet-stream 的 GLB/glTF。
2. 增加 chat 3D 100 MB 边界和超限用例。
3. 扩充 chat/canvas 对齐断言，覆盖 image、video、audio、text、3D 的白名单、扩展名和按 kind 限额。
4. 运行目标测试，确认因 chat 缺少 3D 配置而失败。

验证命令：

```bash
pnpm exec vitest run src/lib/upload-policy.test.ts
```

完成后提交：

```text
test: 补充对话栏五种文件类型上传策略测试
```

## 任务二：实现共享策略并转绿

涉及文件：

- `src/lib/upload-policy.ts`

步骤：

1. 抽取 image、video、audio、text、3D 的共享 MIME 和扩展名配置。
2. 让 chat 与 canvas 都使用共享五种类型配置及相同的按 kind 限额。
3. 保留 chat 独有的 PDF 与数量限制。
4. 运行策略测试并执行 `git diff --check`。

验证命令：

```bash
pnpm exec vitest run src/lib/upload-policy.test.ts
git diff --check
```

完成后提交：

```text
feat: 对齐对话栏与画布的五类文件上传策略
```

## 任务三：用测试锁定 3D 类型推断

涉及文件：

- `src/store/chat-attachment-text.test.ts`

步骤：

1. 增加 octet-stream GLB 对话附件上传用例。
2. 断言附件进入 uploading 后最终为 ready，且 `kind` 为 `3d`。
3. 断言继续调用既有上传端点及 `chat_attachment` 标记。
4. 运行目标测试，确认现状因 MIME 推断而得到错误的 image 类型。

验证命令：

```bash
pnpm exec vitest run src/store/chat-attachment-text.test.ts
```

完成后提交：

```text
test: 补充对话栏 3D 附件类型推断测试
```

## 任务四：统一附件类型推断并转绿

涉及文件：

- `src/store/index.ts`

步骤：

1. 让 `uploadChatAttachment` 复用 `kindFromFile`。
2. 移除不再需要的 MIME-only 类型推断导入。
3. 运行附件测试、策略测试与相关 Composer 测试。

验证命令：

```bash
pnpm exec vitest run src/store/chat-attachment-text.test.ts src/lib/upload-policy.test.ts src/components/chat/Composer.test.tsx
git diff --check
```

完成后提交：

```text
feat: 正确识别对话栏 3D 上传附件
```

## 任务五：完整验证

步骤：

1. 检查 worktree diff 与提交落点。
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
- 目标分支为 `feat/chat-upload-align-canvas`；
- 仅包含本需求文档、测试和实现；
- 五种文件类型策略在 chat/canvas 间一致，现有 PDF 附件能力未回归。
