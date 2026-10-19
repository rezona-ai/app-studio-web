# 设计稿：聊天滚动 / @ 引用 / 画布落位 三处交互修复

> 日期：2026-06-18
> 来源：一次实机测试暴露的三个交互问题，逐个定位根因并修复。三者相互独立，可分别实现与回滚。

## 背景

实机测试提出三个问题：

1. Agent 流式输出时，用户向上滚动聊天记录会被持续强制拽回底部。
2. 画布无资产时，输入框的 `@` 功能让人不明用途，且点击后毫无反馈，像是坏了。
3. 画布双击空白处创建图片，当点击点附近拥挤时图片被挪到很远的下方，甚至视野之外，用户找不到。

三个问题都已定位到明确根因，属于交互打磨而非架构改动。

---

## 问题 1：聊天被强制滚到底部

### 现象
流式输出过程中向上翻看历史，下一个 token 一到又被拉回最底部，无法停留。

### 根因
`src/components/chat/ChatPanel.tsx:62-65` 的自动滚底 effect 依赖 `[messages, awaiting]`：

```ts
useEffect(() => {
  if (skipBottomScrollRef.current) { skipBottomScrollRef.current = false; return; }
  endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}, [messages, awaiting]);
```

流式输出**每来一个 token 就整体重建 `messages` 数组**（`applyKoubou` 不可变更新），于是每个 token 都无条件触发一次滚底。唯一的抑制开关 `skipBottomScrollRef` 仅在"向上翻页加载历史"场景被设过（`50-59` 行），流式期间恒为 `false`——**完全没有"用户是否在底部"的判断**。

### 方案：贴底检测 + 回到最新按钮（仅改 `ChatPanel.tsx`）

1. **贴底状态**：新增 `stickToBottomRef`（是否贴底，初始 `true`）与 `showJump` 状态（按钮是否可见）。
2. **扩展现有 `onScroll`**（已用于翻页）：每次滚动计算
   `atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD`（`BOTTOM_THRESHOLD = 80`，阈值足够大以容忍 smooth 动画途中的抖动）；写入 `stickToBottomRef.current = atBottom`，并 `setShowJump(!atBottom)`。
3. **自动滚底 effect 加守卫**：在 `skipBottomScrollRef` 判断后追加 `if (!stickToBottomRef.current) return;`。用户上滑后不再被拽回；滚回底部（`atBottom` 恢复 `true`）后自动恢复跟随。
4. **发送自己的消息强制回底**：用 `prevLastUserIdRef` 记录上一次尾部的 user 消息 id；当尾部出现新的 `user` 消息（用户刚发送）时，无视当前 stick 状态强制 `stickToBottomRef.current = true` 并滚到底——符合"我刚发完就该看到回复"的预期。
5. **「回到最新」浮动按钮**：消息滚动区右下角绝对定位，`showJump === true` 时显示。点击 = smooth 滚到底 + `stickToBottomRef.current = true` + `setShowJump(false)`。图标用 `figAsset.chevronDown`，样式走 token（`--color-pop` 背景 + 阴影），与既有浮层视觉一致。

> 不引入第三方 stick-to-bottom 库，自实现以贴合仓库既有惯例。

---

## 问题 2：`@` 引用无说明、无反馈

### 现象
画布无资产时点 `@`，看起来"不可点 / 坏了"，也不知道这功能是干嘛的。

### 根因（两处叠加）
- `src/components/chat/Composer.tsx:134-144`：`@` 按钮**永远可点**，点击仅在文本末尾插一个 `@`，无 tooltip、无用途说明。
- `src/components/chat/MentionPopover.tsx:16`：`if (list.length === 0) return null;`——资产为空或无匹配时弹层**直接不渲染**。用户点了 `@`、插入了符号却什么都看不到，自然觉得功能失效。

`@` 的本意是引用画布已有资产（`refs.ts` 把资产折进消息文本传给后端），但该意图从未在 UI 表达。

### 方案：按钮置灰 + tooltip + 弹层永远有反馈（两者结合）

**`Composer.tsx`**：
- 计算 `canMention = assets.length > 0`。
- `@` 按钮在 `!canMention` 时 `disabled`（`IconButton` 已有 `disabled:opacity-30` 置灰样式），且 `startMention` 在禁用态 no-op。
- 因原生 `title` 在 `disabled` 按钮上 hover 不一定触发，用 `<span title={...}>` 外包按钮承载 tooltip（UI 默认英文，文案用英文）：
  - 无资产：`Generate assets on the canvas first to @mention them`。
  - 有资产：`Mention an asset`。

**`MentionPopover.tsx`**：
- 去掉 `if (list.length === 0) return null;`，改为永远渲染容器，按状态给空态文案：
  - 无任何资产（`assets.length === 0`）：显示引导文案 `No assets yet — generate some on the canvas to @mention them`（覆盖用户手动键入 `@` 触发 mention 的边界场景）。
  - 有资产但 `query` 无匹配：显示 `No matches`。
- 空态文案用 `--color-muted` 弱化样式，置于既有弹层容器内。

---

## 问题 3：双击创建的图片跑到视野外

### 现象
画布双击空白处创建图片，点击点附近拥挤时图片被挪到很远的下方，甚至屏幕外，用户找不到。

### 根因（两处叠加）
- `src/lib/card-layout.ts:30-38` 的 `avoidOverlap` **只向下推**：与已有卡片重叠时每次 `y += CARD_H + GAP_Y`（190px），最多 50 次（≈9500px）。方向单一且无限向下，点击点附近一拥挤就被顶到很远下方。
- 碰撞余量很大（`abs(dx) < 260 && abs(dy) < 190`，含间距）：即使双击的像素是空的，180×150 卡片以点击点为中心展开后，只要离邻卡够近就算重叠 → 触发下推。表现为"点了空白，卡却跳走"。
- 落位后**无任何视口跟随**（`src/store/actions.ts:226-234` 落位后不调 `setCenter`/`fitView`），卡片落到视野外就彻底看不见。

### 方案：就近螺旋避让 + 越界才平移入视野

**A. `avoidOverlap` 重写为就近环形搜索（`src/lib/card-layout.ts`，纯函数）**
- 从 `target` 起按"扩展环"枚举候选点，找离 `target` 最近的非重叠空位即返回：
  - 半径 `r = 0, 1, 2, …`（Chebyshev 环），每环上的候选点 = `target + (dx * STEP_X, dy * STEP_Y)`，其中 `STEP_X = CARD_W + GAP_X`、`STEP_Y = CARD_H + GAP_Y`（保证相邻候选点本身不互相重叠，命中即真正空闲）。
  - 复用既有重叠判定 `abs(o.x - pos.x) < CARD_W + GAP_X && abs(o.y - pos.y) < CARD_H + GAP_Y`。
  - 命中第一个空位返回；超过 `MAX_RING` 上限兜底返回 target（保持"永不抛错"）。
- 行为变化：不再单向无限向下，而是就近向四周扩散，落点尽量贴近点击处。

**B. `viewport.ts` 扩展 ensure-visible 注册（镜像现有中心注册）**
```ts
let ensureVisibleFn: ((pos: XY) => void) | null = null;
export function registerEnsureVisible(fn: ((pos: XY) => void) | null) { ensureVisibleFn = fn; }
export function ensureVisible(pos: XY) { ensureVisibleFn?.(pos); }
```

**C. `AssetCanvas.Inner` 注册 `ensureVisible`（`src/components/canvas/AssetCanvas.tsx`）**
- 用 `useReactFlow().getViewport()` 与容器 `getBoundingClientRect()` 算当前可视的画布坐标范围。
- 给定卡片左上角 `pos`，若卡片矩形（`pos` ~ `pos + (CARD_W, CARD_H)`）落在可视区外，则 `setCenter(pos.x + CARD_W/2, pos.y + CARD_H/2, { duration })` 平移带入；已在视口内则不动（"越界才平移"）。
- 挂载时 `registerEnsureVisible`，卸载时注销 `null`。

**D. 落位后调用（`src/store/actions.ts`）**
- 在 `addGenPlaceholder` 落位算出 `position` 后调用 `ensureVisible(position)`——覆盖双击创建、右键画布生成、派生生成；**不触及** agent 自动导入路径（`useCanvasAutoImport` 不经此函数），避免 agent 批量生成时画布乱跳。

---

## 测试

- **`src/lib/card-layout.test.ts`**（TDD，纯函数）：
  - 目标点空闲 → `avoidOverlap` 原样返回。
  - 目标点被占 → 返回离目标最近的空位，且**不再是无限向下**（验证可向上/左/右扩散）。
  - 密集占用 → 在合理环数内找到空位，超限兜底返回 target 不抛错。
- 视情况补 `MentionPopover` 组件测试：空资产渲染引导态、无匹配渲染"无匹配项"、有匹配渲染列表（不再 `null`）。
- `ChatPanel` 贴底守卫逻辑以纯函数/手测为主（DOM 滚动度量在 jsdom 下不可靠，不强求组件测试）。

## 影响范围与边界（不做的事）

- 不改 Koubou 协议层、不改 PGC 映射、不动持久化字段。
- 不引入第三方滚动库。
- `avoidOverlap` 的改动对所有调用者（`addGenPlaceholder` / `placeAndLink`）统一生效；`ensureVisible` 仅接到 `addGenPlaceholder`，不影响重连/轮询落位（位置仍归前端所有，不被覆盖）。
- 视口平移仅在卡片"越界"时触发，避免每次生成都打断用户当前视角。
