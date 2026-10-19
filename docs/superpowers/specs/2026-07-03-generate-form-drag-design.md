# 生成弹窗支持拖动 设计稿

日期：2026-07-03

## 背景

画布生成弹窗（`src/components/canvas/GenerateForm.tsx`）目前由触发点坐标（`x/y`）锚定左上角并夹取进视口，无坐标时 CSS 居中。弹窗可能遮住画布上用户正要参考的素材，需要支持按住拖动重新定位。

## 目标

- 在卡片**空白处**（padding、间隙等非交互区域）按住即可拖动整个弹窗。
- 交互控件（textarea、按钮、pill、下拉、chip 移除等）行为不变，按下不触发拖拽。
- 不新增视觉元素（无拖动条），不改设计稿布局。

## 方案

自研指针拖拽，约 30 行，无新依赖，与 `Workspace.tsx` 分隔条同一模式：

1. **启动判定**：外层定位 `div` 挂 `onPointerDown`。若 `e.target` 命中交互元素——`closest('textarea, button, input, select, a, [role="button"], [role="listbox"], [role="option"], [role="dialog"] [tabindex]')` 范围内的可交互节点——则不启动拖拽，事件正常冒泡给控件。
2. **统一定位为受控 left/top**：现有 `pos` state 仅在有 `x/y` 时生效；首次拖动时若 `pos` 为空（居中回退态），先用 `getBoundingClientRect()` 把当前位置转成 left/top 写入 `pos`，之后统一走受控定位（居中用的 `left-1/2 top-1/2 -translate-*` 类在 `pos` 非空后不再应用）。
3. **拖拽过程**：`setPointerCapture` + `pointermove` 按「按下点相对卡片左上角的偏移」更新 `pos`；`pointerup` / `pointercancel` 结束。每次更新沿用现有 12px 边距逻辑夹取进视口。
4. **体验细节**：拖拽中卡片加 `select-none` 防止选中文本，光标 `cursor-grabbing`；不加新动画类。
5. **落点跟随弹窗**：`spawnAt` 是打开时按触发点换算好的画布坐标；弹窗被拖动后，提交时应以弹窗**当前位置**重算落点，否则占位卡仍落在最初的双击点。做法：
   - `src/lib/viewport.ts` 新增注册项 `screenToCanvas`（由 `AssetCanvas` 挂载时注册 `screenToFlowPosition`，卸载注销），与既有 `getViewportCenter` / `ensureVisible` 同一模式。
   - `GenerateForm` 记录「本次是否发生过拖动」；提交时若拖动过，用卡片当前左上角屏幕坐标经 `screenToCanvas` 重算 `spawnAt` 覆盖入参；未拖动则沿用原 `spawnAt`（保持现有语义与测试不变）。
   - 居中回退态（原本无 `spawnAt`，如 EmptyStateChips 已传视口中心）同样适用：拖动过即重算。
   - `sourceItemId`（加号派生树形落位）优先级不变，本条只影响 `spawnAt` 路径。
6. **不持久化**：位置仅本次打开有效，重新打开按触发点 / 居中重算。
7. **backdrop 不变**：点遮罩仍 `requestClose`；拖拽只发生在卡片上，互不影响。

## 不做

- 不引入 `react-draggable` 等依赖。
- 不复用 @xyflow 拖拽（弹窗在画布外的 fixed 层）。
- 不加显式拖动条 / handle。
- 不记忆上次拖动位置。

## 测试

`GenerateForm.test.tsx` 补用例：

- 卡片空白处 `pointerdown` + `pointermove` 后 `style.left/top` 随位移变化。
- 在 `textarea` 上 `pointerdown` + `pointermove` 不改变定位。
- 拖到视口外时位置被夹取在 12px 边距内。
- 居中回退态（无 `x/y`）拖动后转为受控 left/top 且可继续拖。
- 拖动后提交：`generate*` 收到的 `spawnAt` 为按弹窗当前位置经 `screenToCanvas` 重算的坐标（注入假转换函数断言）。
- 未拖动提交：`spawnAt` 与入参一致，不重算。
