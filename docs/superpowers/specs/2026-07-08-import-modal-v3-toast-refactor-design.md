# 导入弹窗 v3 + Toast 语义化重构设计

- 日期：2026-07-08
- 关联：Meegle Story 13370489 第三轮迭代；前序见 `2026-07-08-project-zip-import-design.md`、`2026-07-08-zip-import-ux-design.md`
- 设计稿：Figma `TALUNA DEVELOPER SITE` node 955-49013（Choose File 按钮）

## 需求决策（已与 Nick 确认）

| 决策点 | 结论 |
|---|---|
| 项目名 | 去掉输入框，恒取文件名去扩展名（`.tar.gz` 双段剥离），不可编辑 |
| 触发上传 | 选中文件（点击选择或拖放）后**立即**开始上传，无确认步骤 |
| 取消入口 | 去掉底部按钮；上传中点右上角 x（或 Esc）→ 行内二次确认 → 确认后 abort 回表单态 |
| 落素材阶段 | x disabled（Esc 同样不响应）；不可取消语义不变 |
| 完成反馈 | 上传完成（项目创建成功）→ success Toast「新项目已创建」；素材全部处理完 → 弹窗内「导入已完成」完成态，停留 1.2s 自动关闭 |
| Toast 语义 | 借机重构：按 kind 提供语义化方法，杜绝 setError 发非错误提示 |

## Part A：Toast 系统语义化重构（先行）

- **字段重命名**：`ServerState.lastError: ToastMessage | null` → `toast: ToastMessage | null`（瞬态不持久化，persist partialize 本就不含）。`ToastMessage.kind: ToastKind` 改**必填**。
- **UIState actions**（`src/store/index.ts`）：
  - `setError(msg: { code: string; message: string })` → 写 `toast`，kind 固定 `'error'`
  - `setSuccess(msg)` → kind 固定 `'success'`
  - `setWarning(msg)` → kind 固定 `'warning'`
  - `clearToast()` → `toast: null`（替代 `setError(null)`；`setError` 等方法不再接受 null）
- **迁移**：
  - `src/store/actions.ts` 内所有 `set({ lastError: ... })` 均为错误语义 → `set({ toast: { ..., kind: 'error' } })`；
  - 各组件 `setError(...)` 调用按真实语义归位（现有借 `kind: 'success' | 'warning'` 传参的调用点分别迁 `setSuccess` / `setWarning`；`setError(null)` 迁 `clearToast()`）；
  - `Toast.tsx` 订阅 `s.toast`，展示逻辑不变；相关测试同步。
- 备注：`lastError` 属历史命名，本次一并根治，不留双轨。

## Part B：导入弹窗 v3

### 表单态（初始）

- 移除 Game name 输入框与底部 Cancel/Import 按钮。
- 拖放区拉高至约 200px：虚线框 + 上传图标 + `chooseFile` 提示文案 + **显式上传按钮**。
- 上传按钮对齐 Figma 955-49013：teal 胶囊——`bg-[var(--color-teal)]`、`rounded-[360px]`、`px-[32px] py-[16px]`（含文字实测高 32px 视觉，按稿走）、Inter Bold `text-[15px]`、字距 0.257px、文字恒深色 `#171717`（与 `.btn-raised` 同属「恒色 CTA」例外语义，深色主题不翻转）；文案 key `chat.importGame.chooseFileButton`（en: `Choose File`）。
- 弹窗右上角 **x 关闭按钮**：标题行右侧，`IconButton` ghost + 既有 close/x 图标（`figAsset` 无则先登记），`aria-label` 走 i18n。
- 选中文件（input change 或 drop）即调 `importProjectArchive(file, defaultName(file.name))`；拖放非法扩展名仍 `setError` 提示。
- 表单态点 x / Esc / 点遮罩（无脏状态概念，文件选中即上传）→ 直接关闭。

### 上传阶段（`step === 'uploading'`）

- 内容区沿用 spinner + `stepUploading`（百分比）；**无底部按钮**。
- 点 x 或 Esc → 底部行内二次确认（`confirmCancelText` + `keepImporting` / `confirmCancel`，样式沿用现状）→ 确认后 `cancelImportArchive()`，弹窗回表单态。
- 上传 resolve（项目创建成功）后 action 调 `setSuccess({ code: 'PROJECT_IMPORTED', message: t 文案「新项目已创建」 })`——注：action 层无 i18n 上下文，文案按仓库现状用英文字面值（同 `IMPORT_ASSETS_PARTIAL` 先例），key 记 `PROJECT_IMPORTED`。

### 落素材阶段（`creating` / `importing_assets`）

- x 按钮 `disabled`（置灰），Esc 不响应；步骤文案照旧。

### 完成态（新增 `step: 'done'`）

- `importArchiveStatus.step` 联合类型增加 `'done'`；素材循环结束后 action 置 `step: 'done'`，**延迟 1.2s** 后清 null 并 resolve。
- 弹窗据 `done` 渲染完成态：✓ 图标（teal）+ `importDone`（「导入已完成」）文案；resolve 后组件 `requestClose()` 正常退场。
- 取消 / 失败路径不变：清状态回表单态（失败 Toast 由 action 分流）。

### i18n（`chat.importGame.*` 增删，六语）

- 新增：`chooseFileButton`（Choose File）、`importDone`（Import complete）、`closeModal`（Close，x 的 aria-label；若 `common` 已有等价 key 则复用）。
- 移除不再使用：`namePlaceholder`、`import`、`cancelImport`。
- action 层 Toast 文案（英文字面值）：`PROJECT_IMPORTED` → `New project created`。

## 测试

- store：三个语义方法 + clearToast 写入正确 kind；`done` 态推进与 1.2s 延迟清态（fake timers）；上传成功触发 success toast。
- 弹窗：选文件即上传、x 三态（表单直接关 / 上传中确认 / 素材阶段 disabled）、Esc 同构、完成态渲染与延迟关闭。
- 全量回归：所有 `lastError` / `setError` 触点迁移后测试绿。

## 不在本期范围

- Toast 多条队列 / 手动关闭；
- `#e5484d` 危险色令牌化（另行处理）。
