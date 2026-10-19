# 游戏生成新版本后自动展开最大宽度预览 — 设计稿

日期：2026-07-25

## 背景

游戏生成完成并产出新版本后，`loadVersions` 会把时间线切到最新版本，但右侧预览仍保持用户此前的窄宽度。用户需要再移动到预览边缘并点击“最大宽度”，才能充分查看刚生成的游戏。

当前预览宽度由 `Workspace` 组件本地状态拥有：

- `previewW` 控制 spacer 与预览 overlay 的宽度；
- `maxPreviewWidth()` 根据当前视口、Chat 宽度和 16:9 舞台比例计算最大宽度；
- `lastNormalPreviewW` 记录展开前宽度，供边缘把手恢复；
- `workspace.previewWidth` 在 `localStorage` 中持久化用户选择。

版本列表则来自唯一 zustand store。`loadVersions` 已通过旧、新版本 ID 的差异识别新版本，并把 `activeVersionId` 切到最新版本。

## 目标

- 已有版本列表新增版本后，预览自动展开到当前允许的最大宽度。
- 展开前记住普通宽度，用户点击恢复把手时回到该宽度。
- 自动展开后的宽度沿用现有持久化规则，刷新后保持。
- 冷启动首次加载版本、无新增版本的刷新、失败或未产出版本的回合均不误展开。
- 不改变 Compare / Files 的既有覆盖模式；它们退出后，普通预览保持本次自动展开得到的最大宽度。

## 方案比较

### 方案 A：`Workspace` 比较版本 ID 快照（推荐）

`Workspace` 订阅 `versions`，以 ref 保存上一次版本 ID 集合。旧集合非空且新列表出现陌生 ID 时，调用现有最大宽度逻辑。

优点：

- 直接响应“新版本已经进入 store”这一可见事实；
- 冷启动、失败回合和成功但未产出版本天然不会触发；
- 版本来源无关，实时 WS、REST 回填、构建轮询和本地调试模式都能覆盖；
- 不新增只为单个组件服务的 store 事件字段。

代价：

- `Workspace` 需要维护一份仅用于边缘检测的版本 ID ref。

### 方案 B：在 `loadVersions` 写入瞬态展开请求

新增 `previewExpandRequest` 递增值，`loadVersions` 发现新版本时写入，`Workspace` 订阅并消费。

优点：触发意图显式。

缺点：宽度仍由 `Workspace` 本地拥有，却要为一次性通知扩充 store 状态与 action；还要处理初始化、消费和不持久化边界，复杂度高于行为本身。

### 方案 C：在 `useKoubouConnection` 的 `run.finished` 回调中展开

优点：靠近实时生成完成事件。

缺点：成功回合不保证产出版本；会漏掉 REST 回填、构建轮询和本地版本来源；同时把 UI 布局控制耦合进连接副作用层。

## 详细设计

1. `Workspace` 订阅 `versions`。
2. 首次渲染时以当前版本列表初始化 ID 集合，避免挂载即把已有版本判作新增。
3. 每次 `versions` 引用变化时：
   - 先比较旧集合与新列表；
   - 再立即更新 ref，保证宽度状态引起的重渲染不会重复触发；
   - 仅当旧集合非空且存在新 ID 时请求展开。
4. 展开函数复用 `maxPreviewWidth(window.innerWidth, window.innerHeight, chatW)`：
   - 已处于最大宽度时不写状态；
   - 否则把当前 `previewW` 写入 `lastNormalPreviewW`；
   - 更新 `previewW` 并持久化 `workspace.previewWidth`。
5. 手动把手继续沿用现有恢复语义，不新增按钮、文案或动画。

## 成功标准

- 从已有 `v1` 刷新到 `v1 + v2` 后，预览宽度变为当前最大值并写入 `localStorage`。
- 初次从空列表加载 `v1` 时保持默认或已保存宽度。
- 相同版本列表刷新时保持当前宽度。
- 自动展开后点击恢复把手，回到展开前宽度。
- `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build` 全部通过。
