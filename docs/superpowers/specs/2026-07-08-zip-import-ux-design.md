# 项目压缩包导入体验优化设计

- 日期：2026-07-08
- 关联：Meegle Story 13370489 迭代；基础功能见 `2026-07-08-project-zip-import-design.md`
- 范围：取消（二次确认 + 中断请求）、文件区拖放、导入中步骤/进度展示

## 需求决策（已与 Nick 确认）

| 决策点 | 结论 |
|---|---|
| 取消范围 | 仅**上传阶段**可取消（abort 请求，项目未建成，干净回滚）；后端返回后（项目已建成、切项目/落素材阶段）不可取消 |
| 进度展示 | 步骤文案 + 上传阶段**真实进度百分比**（XHR onProgress，复刻 `uploadCanvasItem` 先例）+ 素材阶段 n/m 计数 |
| 二次确认形态 | 弹窗底部**行内确认**（「继续导入 / 确认取消」），不叠第二层模态；导入中 Esc 同样先走确认，遮罩点击不关闭 |
| 拖放 | 文件区改虚线框 + 上传图标，支持拖放；drop 按扩展名校验，非法 Toast |

## 设计

### 1. client 层（`src/lib/pgc/client.ts`）

`importProjectArchive(file: File, name: string, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<ImportProjectData>` 从 fetch 改为 XHR（结构复刻 `uploadCanvasItem`）：

- `xhr.upload.onprogress` → `onProgress(e.loaded / e.total)`（0..1，仅字节上传阶段可观测）；
- `signal` abort → `xhr.abort()` → reject `PgcError('ABORTED', 'Upload aborted', 0)`；
- 网络错误 → `PgcError('NETWORK', ...)`；信封判定复用 `resolveEnvelope`。

### 2. store（`src/store/types.ts` + `src/store/actions.ts`）

- **ServerState 新增瞬态**（不持久化，不入 persist partialize）：

```ts
importArchiveStatus: {
  step: 'uploading' | 'creating' | 'importing_assets';
  progress: number;   // 0..1,仅 uploading 阶段有意义
  done: number;       // 已落画布素材数,仅 importing_assets 阶段
  total: number;      // 素材总数
} | null
```

- **action `importProjectArchive(file, name)`** 改造：
  - 起始 `set({ importArchiveStatus: { step: 'uploading', progress: 0, done: 0, total: 0 } })`，新建 `AbortController` 存 action 闭包模块级变量；
  - onProgress 节流更新 `progress`（复用 `throttleRatio` 思路或直接 set，频率低可直接 set）；
  - 后端返回后置 `step: 'creating'` → `selectProject`；素材循环前置 `step: 'importing_assets', total`，每条成功 `done + 1`；
  - 结束（成功/失败/中止）统一清 `importArchiveStatus: null`、清 controller；
  - **ABORTED 静默**：catch 到 `PgcError('ABORTED')` 时不写 lastError，不弹 Toast，照样 rethrow（弹窗据此回表单态）；其余失败语义不变（guardRethrow）。
- **新增 action `cancelImportArchive()`**：仅当 `importArchiveStatus?.step === 'uploading'` 时调 `controller.abort()`；其余阶段 no-op（UI 层该按钮已隐藏，双保险）。

### 3. 弹窗 UI（`src/components/chat/ImportProjectModal.tsx`）

三个互斥视图态（由本地 `phase: 'form' | 'confirm-cancel'` + store `importArchiveStatus` 联合驱动）：

- **表单态**（`importArchiveStatus == null`）：
  - 文件区改为**虚线框拖放区**：`border-dashed`，内容为 FigIcon `upload`（tone secondary）+ `chooseFile` 文案（已选文件时显示文件名，色转 ink）；点击仍触发隐藏 file input；
  - 拖放：`onDragOver`（preventDefault + 高亮态：边框转 `--color-teal`）、`onDragLeave` 取消高亮、`onDrop` 取第一个文件按扩展名（`.zip/.tar/.tar.gz/.tgz`）校验——非法 `setError({ code: 'IMPORT_BAD_TYPE', message: t('chat.importGame.dropRejected') })`，合法则设文件 + 默认名；
  - 底部「Cancel / Import」逻辑不变。
- **导入态**（`importArchiveStatus != null`）：
  - 表单区替换为：spinner（复用 `Loader2 animate-spin`）+ 步骤文案——`stepUploading`（附 `Math.round(progress*100)%`）/ `stepCreating` / `stepImportingAssets`（附 `done/total`）；
  - 底部仅在 `step === 'uploading'` 显示「取消」按钮；`creating`/`importing_assets` 阶段无按钮（几秒内自然完成）；
  - 遮罩点击不关闭；Esc 与点「取消」同路径 → 进入行内确认。
- **行内确认态**（导入中触发取消）：
  - 底部就地切换为 `confirmCancelText`（「确定要取消导入吗？」）+「继续导入」（返回导入态）/「确认取消」（红色语义，调 `cancelImportArchive()`）；
  - 确认取消后：action reject ABORTED → 弹窗回**表单态**，保留已选文件与名称，可直接重试。
- 导入成功仍自动 `requestClose()`；非 ABORTED 失败回表单态 + Toast（既有行为）。

### 4. i18n（`chat.importGame.*` 追加，六语）

`dropRejected`（拖放文件类型不支持）、`cancelImport`（取消）、`confirmCancelText`（确定要取消导入吗？）、`keepImporting`（继续导入）、`confirmCancel`（确认取消）、`stepUploading`（正在上传压缩包… {{percent}}%）、`stepCreating`（正在创建项目…）、`stepImportingAssets`（正在导入素材 ({{done}}/{{total}})…）。

### 5. 测试

- client：onProgress 回调透传、abort → `PgcError('ABORTED')`、成功信封解析（FakeXHR 样板复用 `uploadCanvasItem` 测试）；
- action：状态机推进（uploading→creating→importing_assets→null）、progress/done 更新、`cancelImportArchive` 仅 uploading 生效、ABORTED 静默不写 lastError 且 rethrow、结束清态；
- Modal：拖放合法/非法、导入态步骤渲染、上传阶段才有取消按钮、取消→行内确认→确认后回表单态且文件保留、Esc 导入中走确认。

## 不在本期范围

- 阶段 B 的取消/回滚（删项目）；
- 上传断点续传/分片；
- 拖放多文件（只取第一个）。
