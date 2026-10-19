# 资产重命名弹窗设计

## 背景

资产卡片右键菜单(`src/components/canvas/ContextMenu.tsx`)的 Rename 项当前用浏览器原生
`prompt()` 收集新名字,代码里留有 `// TODO(U10): 换内联编辑/modal`。原生 `prompt()`
样式无法与产品设计语言统一,需要替换成独立的弹窗组件。

项目已有现成的弹窗范式 `src/components/chat/CreateGameModal.tsx`(圆角卡 + backdrop +
Esc 关闭 + Enter 提交),本设计复用同一视觉语言。重命名是纯本地 store 变更,store action
`renameAsset(id, label)` 已存在,无后端同步。

## 目标

- 用独立弹窗组件替换 `prompt()`,视觉与 `CreateGameModal` 一致。
- 移除 `prompt()` 调用与 `TODO(U10)` 注释。

## 非目标

- 不抽取通用 Modal 外壳(YAGNI,仅两处弹窗,重复可接受)。
- 不改 `renameAsset` 行为,不引入后端同步。
- 不做内联编辑。

## 架构与数据流

```
ContextMenu (点 Rename)
   └─ openRenameModal(asset.id)   // 写 store
   └─ close(null)                  // 关掉右键菜单

Workspace
   └─ {renameTarget && <RenameAssetModal />}   // 订阅 store 挂载

RenameAssetModal
   ├─ 读 renameTarget.id → 从 assets 找到 asset,预填 label
   ├─ 提交 → renameAsset(id, name.trim()) + closeRenameModal()
   └─ Esc / backdrop / Cancel → closeRenameModal()
```

弹窗开关状态放在 zustand store,与现有 `contextMenu` 模式一致;ContextMenu 不持有本地
state,只负责触发。

## Store 改动 (`src/store/index.ts`)

- 新增状态字段 `renameTarget: { id: string } | null`,初始 `null`。
- 新增 action `openRenameModal(id: string)` → `set({ renameTarget: { id } })`。
- 新增 action `closeRenameModal()` → `set({ renameTarget: null })`。
- `renameAsset` 复用现有实现,不改动。

类型在 store 的接口定义中同步声明(参照现有 `contextMenu` / `openContextMenu` 的声明位置)。

## 新组件 (`src/components/canvas/RenameAssetModal.tsx`)

结构参照 `CreateGameModal`:

- 从 store 读 `renameTarget`,据 `renameTarget.id` 在 `assets` 中查找当前 asset。
- 找不到 asset(异常态)直接渲染 `null`。
- `useState` 初始化为当前 `asset.label`(预填)。
- 输入框 `autoFocus`,挂载时全选文本(`onFocus` 调 `e.target.select()`),方便直接覆写。
- Enter 提交、Esc 关闭(`useEffect` 监听 `keydown`,与 `CreateGameModal` 一致)。
- backdrop 点击关闭、Cancel 按钮关闭。
- 校验:`name.trim().length > 0` 才能提交,空名禁用确认按钮(复用 `submitVariant`)。
- 标题文案 "Rename"。
- 提交动作:`renameAsset(asset.id, name.trim())` 后调 `closeRenameModal()`。
- 允许提交与原名相同的值(作为 no-op,不额外拦截)。

重命名为同步本地操作,无 `busy` 异步态(与 `CreateGameModal` 的 `createProject` 不同,
后者是 async)。

## ContextMenu 改动 (`src/components/canvas/ContextMenu.tsx`)

- 引入 `openRenameModal`(替换对 `renameAsset` 的直接依赖,若 Rename 是唯一用到
  `renameAsset` 的地方则移除该依赖)。
- Rename 项 `onClick` 改为:`openRenameModal(asset.id); close(null);`
- 删除 `prompt()` 调用与 `// TODO(U10): 换内联编辑/modal` 注释。

## 组件挂载 (`src/components/workspace/Workspace.tsx`)

在现有 `<ContextMenu />` 附近新增条件挂载 `{renameTarget && <RenameAssetModal />}`,
`renameTarget` 从 store 读取。

## 测试

新建 `src/components/canvas/RenameAssetModal.test.tsx`:

- 预填当前资产名(渲染后输入框 value 等于 asset.label)。
- 空名禁用提交(清空输入后确认按钮 disabled)。
- Enter 提交调用 `renameAsset(id, 新名)` 并关闭弹窗。
- Esc 调用 `closeRenameModal`。
- backdrop 点击关闭。

`ContextMenu` 无现存测试文件,本次不新增其测试。

## 验证

- `pnpm test` 通过。
- `pnpm lint` 通过。
