# 实现计划：对话内多资产缩略图带

设计稿：`docs/superpowers/specs/2026-07-27-chat-media-strip-design.md`

验证命令（每个任务完成后跑对应项，收尾跑全量）：

```bash
pnpm exec vitest run src/lib/chat/media-thumb.test.ts
pnpm exec vitest run src/components/chat/ToolCard.test.tsx
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

## 任务 1 · 缩略图来源纯函数（TDD）

**文件**：新增 `src/lib/chat/media-thumb.ts` + `src/lib/chat/media-thumb.test.ts`

- 先写失败测试：image/video 直用 `previewUrl`；3D 按 `basename` 反查 `assets` 拿 `preview.poster`；反查不到只回 `kind` 无 `src`；`kind` 归一走 `mediaKindToAssetKind`（`model3d`→`3d`）。
- 再实现 `mediaThumb(item, assets)`。

**提交**：`feat: 新增对话媒体缩略图来源纯函数`

## 任务 2 · MediaGroup 换成缩略图带（TDD）

**文件**：`src/components/chat/ToolCard.tsx` + `src/components/chat/ToolCard.test.tsx`

- 先按设计稿「测试」节改写 / 新增用例（含音频塌陷、3D 消失两条回归），确认以预期原因失败。
- 再实现：`MediaGroup`（分层 + 本地选中态）、`MediaThumbCell`（方格 + 类型徽章 + 选中态）、`MediaItemView`（补 3D poster 分支）。
- 需要订阅 store：只在 `MediaGroup` 内 `useStore((s) => s.assets)`；`ToolCard` 已 `memo`，且带 media 的卡在一轮里数量极少，扇出可接受（不像 `MessageItem` 是全列表逐条）。

**提交**：`feat: 对话多资产预览改为缩略图带并修音频/3D 缺失`

## 任务 3 · 全量验证与样例

- `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
- 临时预览页 + Playwright 截图（深 / 浅两套），产物不入库，截完删页面与临时媒体。

**提交**：无（验证步骤）
