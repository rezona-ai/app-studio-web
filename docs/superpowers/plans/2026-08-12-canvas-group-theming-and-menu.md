# 实现计划:分组框统一主题色 + 右键菜单

spec:`docs/superpowers/specs/2026-08-12-canvas-group-theming-and-menu.md`
分支:`feat/canvas-group-theming-menu`(worktree `.orca/worktrees/feat+canvas-group-theming-menu`)

拆两个任务:各自可独立测试、独立评审、独立提交。任务 1 是纯收敛(删机制),任务 2 是加机制,两者无耦合,顺序做。

---

## 任务 1:框色统一为品牌青,删掉调色板

**目标**:分组框的边框 / label / 柔光底一律 teal;`Group.color` 与 `GROUP_COLORS`/`nextGroupColor` 从前端彻底消失;drop / leave 两态改按边型 + 底色浓度区分。

**改动点**

1. `src/lib/canvas-group.ts`:删 `GROUP_COLORS`、`nextGroupColor`。
2. `src/lib/canvas-group.test.ts`:删 `describe('nextGroupColor')`。
3. `src/store/types.ts`:`Group` 删 `color?: string`。
4. `src/lib/pgc/map.ts`:`toGroup` 删 `...(g.color ? { color: g.color } : {})` 与那两行注释;同目录测试若断言 color 一并清。
5. `src/store/actions.ts`:删 `nextGroupColor` import、`createGroupFromSelection` 里的 `const color = ...` 与建框请求体的 `color`。
6. `src/components/canvas/nodes/GroupNode.tsx`:
   - `const color = group.color ?? 'var(--color-teal)'` → 直接用 `var(--color-teal)`(常量,连同注释说明「框色不再由数据驱动」)。
   - 三态:常态 `border` + `color-mix(teal 6%)`;drop `border-2` + `--color-teal-soft`;leave `border-2 border-dashed opacity-50` + 常态底。
   - label 文字色保持跟框色一致(即 teal)。

**测试**(先改测试再改实现,红 → 绿)

- `GroupNode.test.tsx`:fixture 去掉 `color`;删「无 color 时回落品牌青」用例,换成「边框与 label 恒为 `var(--color-teal)`」;drop 用例断言 `border-2` + `--color-teal-soft`;新增/补 leave 用例断言 `border-dashed` + `opacity-50` 且**底色与常态相同**。
- `canvas-group.test.ts` / `map` 测试:删对应断言后仍全绿。

**验证**:`pnpm exec vitest run src/lib/canvas-group.test.ts src/components/canvas/nodes/GroupNode.test.tsx src/lib/pgc` + `tsc --noEmit`(类型层能兜住「还有谁在读 `Group.color`」)。

**提交**:`refactor(canvas): 分组框色统一品牌青并删掉五色调色板`

---

## 任务 2:分组右键菜单(重命名 / 删除框)

**目标**:标题条与框体空白处右键 → 光标处两项菜单;标题条不再有 trash 按钮;右键分组不再污染选区。

**改动点**

1. `src/store/index.ts`(UIState + Actions):
   - `groupMenu: { gid: string; x: number; y: number } | null`,action `openGroupMenu`。
   - `groupRenameId: string | null`,action `startGroupRename(gid | null)`。
   - **互斥**:`openGroupMenu` 同一次 `set` 里清 `contextMenu` / `assetDetail`;`openContextMenu` / `openAssetDetail` 反向清 `groupMenu`(沿用现有两者互清的写法)。
   - 两个字段都是瞬态,**不进 persist 白名单**。
2. `src/components/canvas/ContextMenuShell.tsx`(新,抽壳):遮罩(`onClick`/`onWheel` 关闭)+ `.anim-pop-in origin-top-left` 浮层 + item 行渲染;`ContextMenu.tsx` 改为用它,行样式与 `POPOVER_SHADOW` 一并搬进壳里,行为零变化。
3. `src/components/canvas/GroupContextMenu.tsx`(新):订阅 `groupMenu`,两项:
   - `重命名` → `startGroupRename(gid)` + 关菜单;
   - `删除框` → `deleteGroup(gid)` + 关菜单。
   - 框已不存在(被删 / 切项目)→ 整个菜单不渲染(与 `ContextMenu` 的 `selected.length === 0` 守卫同款)。
4. `src/components/workspace/Workspace.tsx`:`<ContextMenu />` 旁挂 `<GroupContextMenu />`(屏幕像素口径,不需要 RF context)。
5. `src/components/canvas/AssetCanvas.tsx`:
   - `onNodeContextMenu` 开头分流 `if (n.type === 'group') { e.preventDefault(); openGroupMenu({ gid: n.id, x: e.clientX, y: e.clientY }); return; }` —— 在 `contextTargetFor` **之前**,顺带修掉 group id 进选区那个 bug。
   - `onPaneClick` 一并 `openGroupMenu(null)`。
6. `src/components/canvas/nodes/GroupNode.tsx`:
   - 删 trash `IconButton` + `Tooltip` + 相关 import(`IconButton` / `Tooltip` / `figAsset` 若无它用)。
   - `editing` 本地 state 改由 store 驱动:`editing = groupRenameId === group.id`;进入(双击标题 / 菜单)都走 `startGroupRename`,`commit` / Esc 走 `startGroupRename(null)`;`draft` 仍是本地 state,在 `editing` 变 true 时同步为 `group.name`。
7. i18n 11 个 locale 加 `canvas.group.rename`(zh「重命名」;`delete` 复用现有「删除框」)。

**测试**

- `GroupContextMenu.test.tsx`(新):两项渲染;点重命名 → `groupRenameId` 被设为该框;点删除 → 框从 `groups` 消失且 Toast 带 undo token;遮罪 `onWheel` 关闭;`groupMenu.gid` 不在 `groups` 里 → 不渲染。
- `ContextMenu.test.tsx`:抽壳后原样全绿(不改断言,壳的正确性由它守)。
- `GroupNode.test.tsx`:断言标题条内**没有**删除按钮;`groupRenameId` 置为本框 id → 输入框出现且文字被全选;双击标题 → `groupRenameId` 被设置。
- `AssetCanvas` 侧:右键分组节点 → `groupMenu` 被打开、`selectedIds` 不含 group id、`assetDetail` 仍为 null(现有 AssetCanvas 测试的 RF 桩方式跟着抄)。

**验证**:相关测试文件 + `pnpm lint` + `pnpm exec tsc --noEmit` + `pnpm test` 全量 + `pnpm build`。

**提交**:`feat(canvas): 分组删除入口改右键菜单并补重命名项`

---

## 每个任务后

派干净上下文子代理按 commit 范围评审(只给 spec + diff);Critical / Important 修完才继续,Minor 记录留终审。两个任务都完成 → 全分支终审 → `--no-ff` 合回 dev → 合并结果上重跑完整验证 → `/walkthrough`。

## 已知风险

- **抽 `ContextMenuShell` 会碰到已在用的 `ContextMenu`**:壳只搬样式与遮罩行为,不动 items 构造逻辑;`ContextMenu.test.tsx` 一个断言都不改,是这次重构的安全网。
- **RF 对 `pointerEvents: 'none'` 节点是否派发 `onNodeContextMenu`**:框体子元素是 `pointer-events: auto`,contextmenu 从子元素冒泡到 RF 的 node wrapper,理论上会触发 —— 但这是本任务的地基,实现时必须**真机确认**(而不是只看单测),不成立则退回「在 GroupNode 内部自己接 `onContextMenu` 调 store」。
