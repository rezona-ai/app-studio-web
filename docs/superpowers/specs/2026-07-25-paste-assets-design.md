# 问答栏与画布支持直接粘贴资产设计稿

> 日期：2026-07-25
> 状态：待实现

## 背景

当前上传资产只有「点按钮开文件选择器」一条路：

- 对话栏：`Composer` 的隐藏 `<input type="file" multiple>` → `validateUpload(files, UPLOAD_POLICY.chat, attachments.length)` → `uploadChatAttachment(file)`（`src/components/chat/Composer.tsx:144`）。
- 画布：`AddAssetMenu` / `EmptyStateChips` 的隐藏 `<input type="file">` → `validateUpload([f], UPLOAD_POLICY.canvas)` → `uploadAsset(file, { spawnAt })`（`src/components/canvas/AddAssetMenu.tsx:54`）。

两处已共用 `UPLOAD_POLICY`（`src/lib/upload-policy.ts`，2026-07-25 已把 image/video/audio/text/3D 五类白名单与限额抽为共享基底）。但用户手上最常见的资产来源——截图（Cmd+Shift+4 直接进剪贴板）、网页里复制的图片、Finder 里 Cmd+C 的文件——都必须先存盘再走文件选择器，多两步。

剪贴板事件本身两处都还没接：全仓 `onPaste` / `clipboardData` 零命中，仅 `ImportProjectModal` 接了拖放（`dataTransfer`）。

## 目标

- 对话栏：光标在输入框内 Cmd/Ctrl+V，剪贴板里的文件直接变成对话附件（走既有 `uploadChatAttachment`）。
- 画布：焦点不在输入类元素时 Cmd/Ctrl+V，剪贴板里的文件直接变成画布资产卡（走既有 `uploadAsset`）。
- 校验、限额、拒绝提示完全复用 `UPLOAD_POLICY` + `rejectMessage`，两面行为与文件选择器一致（含 3D 扩展名兜底、chat 5 个附件上限）。
- 零新增文案（拒绝提示复用既有 11 语 key），零新增后端字段，不动 Koubou 协议。

## 非目标（本次明确不做）

- **画布粘贴纯文本不建文本卡**（Nick 决策）：画布粘贴只处理剪贴板中的文件；纯文本走既有双击菜单 → Text。
- **对话栏图文混合只收文件**（Nick 决策）：剪贴板同时含文件与文本时，只上传文件、不把 `text/plain` 插入草稿（与主流 AI 输入框一致，避免粘进一堆 HTML 转义文本）。剪贴板无文件时完全放行浏览器默认行为（原生文本粘贴不受影响）。
- 不做粘贴图片 URL 后端抓取（跨域 + 需新端点，YAGNI）。
- 不做拖放上传（另一需求，不在本次范围）。

## 成功标准

1. 在对话输入框粘贴含图片的剪贴板 → 附件栏出现该附件，草稿文本不变；粘贴纯文本 → 不触发上传、不 `preventDefault`。
2. 在画布区域（焦点不在 input/textarea/contentEditable）粘贴含图片的剪贴板 → 画布出现占位卡并走上传；焦点在任一输入类元素时画布不响应（同一次粘贴不会两面同时收）。
3. 超出白名单 / 超限额 / 超 chat 数量上限的粘贴文件，走 `rejectMessage` 的既有 Toast 文案（含文件名与限额）。
4. 剪贴板文件名缺失（部分浏览器 `getAsFile()` 给空名）时按 MIME 补 `pasted.<ext>`，使 `kindFromFile` 的扩展名兜底与后端类型推断仍成立。
5. 新增测试先以预期原因失败，再由最小实现转绿；`pnpm lint`、`tsc --noEmit`、`vitest run`、`build` 全绿。

## 约束

- 剪贴板解析是纯逻辑 → 下沉 `src/lib/` 并单测；window 事件监听是副作用 → 放 `src/client/` hook。
- 画布落位仍走既有 `placeTarget`/`avoidOverlap`，**不新增落位算法**。
- 组件不直连上传接口，一律经 store action。
- 不为「防重复触发」引入任何簿记（去重集合 / 标志位）：靠「事件目标是否输入类元素」这一处源头分流，天然互斥。

## 方案比较

### 方案一：两个组件各自写 paste handler

`Composer` 加 `onPaste`，`AssetCanvas` 加 window `paste` 监听，各自就地解析 `clipboardData`。

优点：改动集中。缺点：`DataTransfer` 解析（`files` 与 `items` 两条来源、空文件名补名）会重复两份，是最容易漂移的部分；且画布的监听逻辑塞进已有 762 行的 `AssetCanvas` 里无法单测（该组件目前无测试，测它要连 ReactFlow 一起渲染）。

### 方案二：共享纯函数 + 画布侧独立 hook（推荐）

- 新增 `src/lib/clipboard-assets.ts`：`filesFromClipboard(data)` 从 `DataTransfer` 取文件（`files` 优先、`items` 兜底、跳过 `kind==='string'`、空名补 `pasted.<ext>`）；`isEditableTarget(el)` 判定输入类元素。
- 新增 `src/client/useCanvasPaste.ts`：window `paste` 监听 + 源头分流（目标是输入类元素则不接）+ 校验 + `uploadAsset`。坐标不需要 ReactFlow——不传 `spawnAt`，由 `placeTarget` 的视口中心兜底 + `avoidOverlap` 自然铺开。
- `Composer` 抽出 `addFiles(files)`（文件选择器与粘贴共用），`onPaste` 里有文件才 `preventDefault`。
- 顺带把 `src/lib/canvas-keys.ts` 里内联的「焦点在输入类元素」判定改为复用 `isEditableTarget`，同一语义只留一份。

优点：解析与分流判定都是纯函数可单测；hook 不依赖 ReactFlow，可 `renderHook` 直接测；两面共用同一套校验；无新落位逻辑、无新文案。缺点：多两个小文件。

### 方案三：把粘贴收进一个全局 hook 按「当前焦点」分派

一个 `usePasteAssets()` 挂在 `Workspace`，内部判断焦点在 composer 就当附件、否则当画布资产。

优点：只有一个入口。缺点：把「附件」与「画布资产」两种语义耦合进一个分派器，且要反向猜测焦点归属（composer 之外还有搜索框、弹窗输入框），比让 composer 自己接 `onPaste`（浏览器已经把事件投递给焦点元素了）更绕——等于用簿记替代浏览器已有的分流。

**取推荐方案二。**

## 交互与落位细节

| 场景 | 行为 |
|---|---|
| 对话输入框内粘贴，剪贴板含 1..N 个文件 | `preventDefault`；按 `UPLOAD_POLICY.chat`（含已暂存数）校验；放行的逐个 `uploadChatAttachment` |
| 对话输入框内粘贴，剪贴板只有文本 | 不拦截，浏览器原生插入文本 |
| 画布（焦点在 body / 卡片）粘贴含文件 | `preventDefault`；按 `UPLOAD_POLICY.canvas` 校验；放行的逐个 `uploadAsset(file)` |
| 画布粘贴只有文本 | 无反应（明确非目标） |
| 焦点在任一 input/textarea/contentEditable | 画布监听直接返回（对话栏由自己的 `onPaste` 处理，其余输入框保持原生粘贴） |

落位：画布粘贴不传 `spawnAt` → `placeTarget` 取 `getViewportCenter()`，`addGenPlaceholders` 对无 `spawnAt` 的占位卡过 `avoidOverlap`，多文件粘贴自然不重叠且恒在视口内。之所以不取「鼠标最后位置」：粘贴是键盘动作，指针可能停在 Chat 栏或预览栏上，换算出的画布坐标会落到视口外（"创建了找不到"）；视口中心可预测且复用既有兜底，零新代码。

## 风险与对策

- **同一次粘贴被两面同时接**：靠 `isEditableTarget` 源头分流——composer 的 textarea 是输入类元素，window 监听直接跳过；不需要 `stopPropagation` 或去重标志。
- **弹窗打开时焦点落在按钮上粘贴，仍会进画布**：与既有 Delete/Backspace 删除卡片（`shouldTriggerCanvasDelete` 同样只判输入类元素）行为一致，保持同一口径，不额外引入「弹窗是否打开」的状态耦合。
- **`clipboardData.items` 在部分浏览器与 `files` 重复**：`files` 有内容时优先取它，不合并两路，避免同一文件上传两次。
