# 问答栏与画布支持直接粘贴资产实现计划

> 设计稿：`docs/superpowers/specs/2026-07-25-paste-assets-design.md`
> 日期：2026-07-25

每个任务独立可测、独立提交。验证命令一律在仓库根执行。

## 任务 1：剪贴板解析纯函数（TDD）

**文件**：新增 `src/lib/clipboard-assets.ts` + `src/lib/clipboard-assets.test.ts`

导出：

- `filesFromClipboard(data: DataTransfer | null): File[]`
  - `data` 为空 → `[]`
  - `data.files` 非空 → 取它（不再合并 `items`，防同一文件两次）
  - 否则遍历 `data.items` 取 `kind === 'file'` 的 `getAsFile()`（过滤 null）
  - 文件名为空 → 按 `type` 子类型补 `pasted.<ext>`（`image/png` → `pasted.png`；`image/jpeg` → `pasted.jpg`；无 type → `pasted`）
- `isEditableTarget(el: EventTarget | null): boolean` —— INPUT / TEXTAREA / `isContentEditable`

**测试用例**：`files` 优先；`items` 兜底且跳过 string 项；`getAsFile()` 返回 null 跳过；空名补名（png/jpeg/无 type）；已有名不改；null 输入；`isEditableTarget` 四种输入。

**验证**：`pnpm exec vitest run src/lib/clipboard-assets.test.ts`

## 任务 2：`canvas-keys` 复用编辑态判定

**文件**：`src/lib/canvas-keys.ts`（改）

把内联的 tagName/isContentEditable 判定换成 `isEditableTarget`，行为不变。

**验证**：`pnpm exec vitest run src/lib/canvas-keys.test.ts src/lib/clipboard-assets.test.ts`

## 任务 3：对话栏粘贴（TDD）

**文件**：`src/components/chat/Composer.tsx`（改）、`src/components/chat/Composer.test.tsx`（加用例）

- 抽出 `addFiles(files: File[])`：既有 `validateUpload(files, UPLOAD_POLICY.chat, attachments.length)` + `rejectMessage` Toast + `uploadChatAttachment` 逐个上传；`onFiles`（input change）改为调它。
- textarea 加 `onPaste`：`filesFromClipboard(e.clipboardData)` 有文件 → `e.preventDefault()` + `addFiles(files)`；无文件 → 不拦截（原生文本粘贴）。

**测试用例**：粘贴含 image File → `uploadChatAttachment` 收到该文件且 draft 不变；粘贴纯文本 → 不调用上传且 `defaultPrevented === false`；粘贴超限额文件 → 出 UPLOAD Toast 文案且不上传。

**验证**：`pnpm exec vitest run src/components/chat/Composer.test.tsx`

## 任务 4：画布粘贴 hook（TDD）+ 挂载

**文件**：新增 `src/client/useCanvasPaste.ts` + `src/client/useCanvasPaste.test.tsx`；`src/components/canvas/AssetCanvas.tsx`（挂 hook）

- hook：`useEffect` 挂 window `paste`；`isEditableTarget(e.target)` 为真直接返回；`filesFromClipboard` 无文件返回；否则 `preventDefault` + `validateUpload(files, UPLOAD_POLICY.canvas)` + `rejectMessage` Toast + 逐个 `void uploadAsset(f)`（不传 `spawnAt`，视口中心兜底）。
- `AssetCanvas` 顶部调用 `useCanvasPaste()`。

**测试用例**：window 派发含 image File 的 paste → `uploadAsset` 按文件数被调用、`defaultPrevented === true`；`target` 为 textarea → 不调用且未 preventDefault；纯文本 paste → 不调用；被拒文件 → Toast（`lastError.code === 'UPLOAD'`）且不上传；卸载后不再响应。

**验证**：`pnpm exec vitest run src/client/useCanvasPaste.test.tsx`

## 任务 5：完成门禁

**验证**（全部需本轮实跑输出）：

```
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

另做一次运行态确认：起 dev/prod server，截图对话栏粘贴截图 → 附件出现、画布粘贴截图 → 资产卡出现（无后端时按记忆用 Playwright route mock PGC 信封）。

## 提交划分

- `docs:` 设计稿 + 本计划（一次）
- `feat:` 任务 1+2（纯函数与判定复用）
- `feat:` 任务 3（对话栏）
- `feat:` 任务 4（画布）
