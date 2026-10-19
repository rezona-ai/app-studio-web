# 表单弹窗禁止点击遮罩关闭 设计稿

- 日期：2026-07-07
- 需求来源：飞书项目 Story 13354173（标题描述反了：实际诉求是带输入的弹窗**不应**点空白即关）

## 背景与问题

当前所有 `modal-backdrop` 弹窗统一在遮罩上挂 `onClick={requestClose}`，点击空白处即关闭。对带用户输入的表单弹窗（分享到 Rezona、Text 输入等），误点空白会直接丢掉已填内容，损失大且不可恢复。

## 设计原则

按「弹窗内是否承载用户正在编辑、关闭即丢失的内容」划分：

- **表单弹窗**：移除遮罩点击关闭，只保留 Esc、右上角 ✕、Cancel 等明确关闭途径。
- **展示 / 确认 / 浏览类弹窗**：保持点空白即关（符合轻量浮层直觉，无丢失成本）。

Esc 不移除：Esc 是用户明确意图而非误触，且各弹窗已有统一实现。

## 改动范围

### 移除遮罩点击关闭（5 个）

| 弹窗 | 文件 | 输入内容 |
|---|---|---|
| 分享到 Rezona | `src/components/preview/RezonaPublishModal.tsx` | 标题 / 简介 / 封面上传 |
| Text 输入/编辑 | `src/components/canvas/TextEditorModal.tsx` | 文本 textarea |
| 重命名资产 | `src/components/canvas/RenameAssetModal.tsx` | 名称 input |
| 创建游戏 | `src/components/chat/CreateGameModal.tsx` | 名称 input |
| 画布生成表单 | `src/components/canvas/GenerateForm.tsx` | prompt + 生成参数 |

### 保持现状（点空白仍关闭）

DeleteAssetModal（删除确认）、CreditModal（积分展示）、MediaLightbox（媒体预览）、CreativeLibraryModal（素材库浏览）、SharePopover（只读分享链接）。

### 明确不做

- 不引入共享 Modal 抽象组件（超出本需求，一致性靠注释 + 测试守护）。
- 不做「未保存内容时二次确认」交互（Story 未要求）。
- 右键菜单、下拉、Tooltip 等非 `modal-backdrop` 浮层不在范围内，点外部即关是正确交互。

## 实现方式

各弹窗为手写外壳（无共享组件），改动为：

1. 从上述 5 个表单弹窗的 backdrop `div` 上删除 `onClick={requestClose}`。
2. 内容卡片上仅为阻断遮罩关闭而存在的 `onClick={(e) => e.stopPropagation()}` 一并删除（遮罩不再监听点击，冒泡无害）。
3. 每处遮罩留一行中文注释：「表单弹窗：点击遮罩不关闭，防误触丢输入」。
4. GenerateForm 的「画布点选」模式不受影响（点选期遮罩本就 `hidden`）。

## 测试

- 更新 5 个表单弹窗的 `*.test.tsx`：将「点击遮罩关闭」断言反转为「点击遮罩不关闭」；无此用例的补充之。
- 保留并确认 Esc 关闭用例仍通过。
- 展示类弹窗测试不动（行为未变）。

## 迭代（2026-07-07 二期）：仅"有输入"时拦截 + 生成面板补关闭按钮

一期全量拦截误伤了"打开后没输入就想点空白关掉"的场景。二期改为**脏检查拦截**：

- 遮罩点击恢复为默认关闭，仅当弹窗处于「有未保存输入」（dirty）时不关。
- 各弹窗 dirty 判定：
  - RenameAssetModal：输入值 ≠ 资产当前名（预填未动可关）。
  - CreateGameModal：名称非空。
  - TextEditorModal：`content !== original`（新建草稿的空 textarea 视为未输入可关）。
  - GenerateForm：prompt 非空 **或** 已选画布参考（参数 pill 纯选择项不计）。
  - RezonaPublishModal：**不走脏检查**——多步发布流程（扫码绑定/表单/发布中）误触遮罩会打断整个流程，遮罩点击一律不关（三期修正）。
- GenerateForm 卡片右上角新增 ✕ 关闭按钮（IconButton ghost + lucide X），与 Esc 等价。

## 验收标准

- 5 个表单弹窗点击空白遮罩不关闭；Esc / ✕ / Cancel 正常关闭。
- 5 个展示类弹窗点击空白仍关闭。
- `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test` 全绿。
