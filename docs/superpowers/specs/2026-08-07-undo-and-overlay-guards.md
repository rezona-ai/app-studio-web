# 撤销与浮层的五道护栏：别让安全网自己骗人

> 状态：设计稿 · 2026-08-07
> 分支：`fix/undo-and-overlay-guards`（P2 第一批 / 共三批）
> 来源：2026-08-07 对 179 个未推送提交的 21 功能全量评审，五条**均已逐条对着代码核实**
> 前置：P0 四回合已收尾（A/C/D 合并，B 取消）

## 目的

撤销是「敢不敢动」的信任底座。而现在它在三处**自己骗人**：点了撤销撤到别的东西上、
撤完不告诉你撤了什么、撤回来的卡位置对了归属却错了。另加两处浮层缺陷，同属「点了没反应 / 反了」。

五条的共性是：**用户以为系统做了 A，系统实际做了 B**，而每条都只需要小改。

### 缺陷 1 · 撤销 Toast 的按钮不绑 token，会撤错东西

`ToastMessage.action` 是无参描述符 `{ type: 'undo' }`，`Toast.tsx:77` 点击时调
`useStore.getState().undo()` —— 而 `undo()` 弹的是**栈顶**。

删除后的 6 秒窗口内，只要再做**任何**一个入栈操作（拖一张卡、方向键微调、重命名、一键整理、删框），
栈顶就不再是那条删除。此时点 Toast 上的「撤销」→ 撤掉那个**新**操作，而被删的卡照常在窗口到点后删掉。

`2026-08-03-canvas-undo.md` 明写的不变式是「**Toast 在 ⟺ 可撤销**」「撤销按钮存在 ⟺ 真的还能撤销，
不留假入口」。该不变式在单条 Toast 内成立，**与其他操作叠加时不成立**；
`pending-delete.test.ts` 只覆盖了「两次删除叠加」，没覆盖「删除 + 非删除叠加」。

### 缺陷 2 · 点那个按钮时，「已撤销：X」的反馈被自己吞掉

`Toast.tsx:76-79` 是 `undo(); clearToast();`。而 `undo()` 内部每条分支都会
`setSuccess({ code: 'UNDO_*' })` 写一条新 Toast —— 紧跟的 `clearToast()` 把它清成 null。

于是 spec 成功标准 6（「Toast 报出撤销了什么」）**只在 ⌘Z 路径成立**，按钮这条主路径没有任何反馈。

### 缺陷 3 · positions 撤销不还原 `groupId`

`persistDraggedNodes`（`AssetCanvas.tsx`）在拖卡入框 / 出框时**同时**改了坐标与 `groupId`，
两者在同一条 item 里回写（分组那轮的约束 2）。但入栈的 `UndoEntry.positions` 只带坐标，
`undo()` 也只 `setAssetPositions` + 不带 `groupChanges` 的回写。

结果：撤销后卡片**视觉上回到框内，归属却是空的**（或反之）。这正是 `assignGroup` 注释自己警告的
「几何是真相 vs 归属投影打架」——成员数错、`moveGroup` 带不带它错、删框解绑错。
全仓没有「按几何重算归属」的兜底（`groupHitFor` 只在拖停与缩放两处调）。

### 缺陷 4 · 属性面板把「生成中 N」药丸整块盖住

`AssetInspector.tsx` 是 `absolute bottom-24 right-5 top-16 z-10 w-[280px]`，
`GenTaskBadge.tsx` 是 `absolute right-5 top-16 z-10` —— **同锚点、同 z**，且面板在 `AssetCanvas`
里后渲染。`inspectorOpen` 是**持久化偏好**，开着就一直盖着。

而「在面板里点再生成一段视频」正是最可能同时发生的操作：用户点完看不到任何在途反馈，
药丸连点都点不到。任务可见性那轮 spec 里「右上是唯一空位」的判断，被后一轮的面板推翻了。

### 缺陷 5 · 删框的延迟窗口没有关页兜底

`usePendingDeleteFlush` 只调 `flushAllPendingDeletes`（卡片）；`flushAllPendingGroupDeletes`
仅在 `selectProject` / `switchProjectSession` 调用，且签名不接 `keepalive`。

于是删框后 6 秒内刷新 / 关页 → 框**复活**。而卡片删除同样场景是「照常删除」——
`2026-08-03-canvas-undo.md` 把「删除是承诺，只是给了几秒后悔」列为边界之一，删框这条漏了。

## 约束

1. **不扩大撤销覆盖面**。本轮只修「已入栈的操作撤销时行为不对」，**不**把「拖卡入框 / 出框」
   本身纳入撤销栈 —— 那是评审 f02 单列的「白名单式入栈」议题（建框、入出框、丢弃失败卡、生成、
   导入都不可撤销），值得单独一轮，塞进来会让回合边界糊掉。
2. **撤销栈存数据不存闭包**（`2026-08-03-canvas-undo.md` 的既有原则）：token 与归属都是可序列化数据。
3. **不新增 UI 种类**：浮层让位靠既有布局量，不新增组件、不新增 z 档位（CLAUDE.md 的 z 阶梯不得插新值）。
4. **不改后端契约**。
5. 铁律：每条先写复现它的失败测试。

## 方案

### 1. `action` 带上 token，按钮撤指定那条（缺陷 1）

```ts
// ToastMessage
action?: { type: 'undo'; token?: string };   // token 有值 ⟹ 只撤这一条,不动栈顶
```

`undo()` 增可选入参 `undo(token?: string)`：

- **不传**（⌘Z 路径）→ 沿用现状：弹栈顶。
- **传了**（Toast 按钮路径）→ 在栈里按 `token` 精确定位那条 `delete` / `deleteGroup` entry，
  **只把它摘出来执行**，其余 entry 原样留在栈里；找不到（已真删 / 已被撤过）→ 安全 no-op，不谎报成功。

发起处把 token 一并放进 Toast：`requestDeleteAssets` 与 `deleteGroup` 已经手里就有 token。

> 为什么不选「入栈时先 `clearToast()`」这个更小的改法：那只是让旧 Toast 消失，
> 用户失去的是**本来还能撤销的能力**（entry 还在栈里，只是没入口了）。
> 绑 token 才让「按钮存在 ⟺ 撤的就是它」真正成立。

### 2. 按钮不再自己清 Toast（缺陷 2）

`Toast.tsx` 的 `onClick` 只调 `undo(token)`；`undo()` 写的「已撤销：X」自然顶掉旧的那条
（`toast` 是单槽，`set` 即替换）。**不需要**再 `clearToast()`。

⚠️ 若 `undo()` 走了 no-op 分支（token 找不到），它不会写新 Toast —— 此时旧 Toast 继续挂到自己的
`durationMs`，与「窗口已过」的事实一致，可接受。

### 3. `positions` entry 带上归属快照（缺陷 3）

```ts
| { type: 'positions'; op: 'move' | 'tidy'; pid: number;
    positions: { id: string; x: number; y: number }[];
    // 撤销时一并还原的归属(仅在本次操作真的改过归属时才带)。
    // 不带 = 这次操作没碰归属,撤销也不该碰
    groups?: { id: string; groupId: string | null }[];
    viewport?: Viewport }
```

- **入栈侧**：`persistDraggedNodes` 已经算出了 `groupChanges`（哪些卡换了框），
  入栈时把**变更前**的归属一并记下。`tidyCanvas` 不碰归属（框内成员不参与整理），不带该字段。
- **撤销侧**：`undo()` 的 `positions` 分支在 `setAssetPositions` 之后，若 `entry.groups` 有值，
  本地还原归属并走**归属自己的回写路径** `assignGroup` —— 不塞进 `persistAssetPositions`：
  分组那轮的约束 3 明确「归属失败与坐标失败要分开报」，混进去 Toast 文案就是错的。

### 4. 面板开着时药丸让位（缺陷 4）

`GenTaskBadge` 的 `right-5` 改为按 `inspectorOpen` 让开面板宽度（面板 `w-[280px]` + `right-5` 间距）：

```tsx
// 属性面板同锚同层(right-5 top-16 z-10)且后渲染,开着时会把药丸整块盖住 ——
// 而「在面板里点再生成」正是最容易同时发生的操作。让位而不是改 z:
// z 阶梯是全局约定(CLAUDE.md),画布 UI 一律 z-10,不为一个药丸插新值
className={`absolute top-16 z-10 ... ${inspectorOpen ? 'right-[316px]' : 'right-5'}`}
```

316 = 280（面板宽）+ 20（`right-5`）+ 16（间隙）。**不改 z、不新增组件**。

### 5. 删框的关页兜底（缺陷 5）

`flushAllPendingGroupDeletes` 接 `{ keepalive?: boolean }`（与卡片那份同签名），
`usePendingDeleteFlush` 的 `flush` 里一并调用。

## 成功标准

1. 删一张卡 → 6 秒窗口内**拖动另一张卡**（入栈）→ 点 Toast 上的「撤销」→ **被删的卡回来**，
   而那次拖动**不受影响**（此前：撤掉拖动、卡照删）。
2. ⌘Z 路径行为不回退：不传 token 时仍撤栈顶。
3. token 指向的 entry 已不在栈里（窗口已过 / 已撤过）→ 点击安全 no-op，不谎报成功、不撤错别的。
4. 点 Toast 的「撤销」后能看到「已撤销：X」（此前只有 ⌘Z 路径有）。
5. 拖卡**入框**后 ⌘Z → 坐标与**归属**一起回到拖动前；拖卡**出框**后 ⌘Z 同理。
6. 不碰归属的拖动（框外拖到框外）撤销时**不发**归属回写请求（`entry.groups` 不带）。
7. 一键整理的撤销行为不回退（不带 `groups`，只还原坐标 + 视口）。
8. `inspectorOpen` 为真时「生成中 N」药丸完整可见且可点；为假时位置与现在一致。
9. 删框后 6 秒内刷新 / 关页 → 框**照常删除**，不复活（与卡片删除同语义）。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 明确不做

- **把「入框 / 出框」本身纳入撤销栈** —— 见约束 1，属「扩大撤销覆盖面」的独立议题。
- **redo（⌘⇧Z）** —— 撤销那轮的既定决策，不在本轮翻案。
- **Toast 多槽 / 队列** —— 单槽是既有设计；本轮靠 token 让「被顶掉的那条仍可用 ⌘Z 撤」，
  而不是让两条 Toast 并存。
- **给撤销加可见入口（工具条按钮）** —— 评审 f02 提过（`figAsset.undo` 图标已在注册表但无入口），
  属 UI 新增，另议。
- **按几何重算归属的全局兜底** —— 缺陷 3 只修「撤销这条路径自己造成的不一致」，
  不引入一个会在别处改变行为的新机制。
