# 实现计划：画布搜索跳转

> 设计稿：`docs/superpowers/specs/2026-08-03-canvas-search-jump.md`
> 分支：`worktree-feat+canvas-search-jump`

四个任务，每个可独立评审、一次提交。纯逻辑先 TDD。

---

## T1 搜索纯逻辑模块（命中集 / 排序 / 游标 / 跳转缩放）

先把全部纯逻辑落地并测透，后续任务只做接线。

**改动**
- 新建 `src/lib/canvas-search.ts`
  - `matchesQuery(asset, q)` —— 命中判定（`(label + key).toLowerCase().includes(q)`），成为**唯一口径**。
  - `searchHits(assets, q)` —— 命中 id 列表，按画布空间序（y 升序、同 y 按 x 升序）。**注意入参已是「可见卡」**，可见性过滤由调用方做（约束 3 落在调用点，纯函数不碰 `visibleKinds` 业务态）。
  - `stepCursor(hits, currentId, dir)` —— 回环推进；空集 → `null`；`currentId` 不在集内（搜索词刚变）→ 取首/末项。
  - `MIN_JUMP_ZOOM` + `resolveJumpZoom(current)` —— 低于下限提到下限，否则原值。
- `src/lib/rf-nodes.ts` —— `matchState` 改调 `matchesQuery`，消除重复口径（行为不变，纯重构）。

**测试（先写，确认按预期失败）** `src/lib/canvas-search.test.ts`
- `matchesQuery`：命中 label / 命中 key / 大小写不敏感 / 空词返回 false（空词由调用方短路，函数本身不该谎报全命中）。
- `searchHits`：排序为 y 优先 x 次之；同坐标稳定；零命中返回 `[]`。
- `stepCursor`：前进 / 后退 / 两端回环 / `currentId=null` 取首项 / `currentId` 不在集内取首项 / 空集返回 `null`。
- `resolveJumpZoom`：低于下限提到下限 / 等于下限不动 / 高于下限原值返回（含 2.0 上限不被拉回）。

**验证**
```bash
pnpm exec vitest run src/lib/canvas-search.test.ts src/lib/rf-nodes.test.ts
```

---

## T2 搜索光标态并入节点构建

**改动**
- `src/lib/rf-nodes.ts`
  - `buildRfNodes(assets, selectedIds, q, cache, cursorId)` 增第五参；`CacheEntry` 增 `isCursor`。
  - 新增模块级 `CURSOR_STYLE`（teal 描边 + teal 柔光环，比 `MATCH_STYLE` 更重），引用稳定。
  - **绝不因 cursorId 写 `selected` 字段**（spec 约束 2）。
- `src/components/canvas/AssetCanvas.tsx` —— sync effect 传入 `cursorId`。

**测试** `src/lib/rf-nodes.test.ts` 追加
- `cursorId` 命中的节点拿到 `CURSOR_STYLE`，其余命中仍是 `MATCH_STYLE`。
- `cursorId` 不影响 `selected` 字段。
- **缓存仍生效**：只有光标态变化的那两个节点产出新引用，其余节点保持原引用（守护成功标准 10 / 审计 B1）。

**验证**
```bash
pnpm exec vitest run src/lib/rf-nodes.test.ts
```

---

## T3 搜索栏计数 + Enter 跳转接线

**改动**
- `src/components/canvas/AssetCanvas.tsx`
  - `Inner` 内新增 `const [cursorId, setCursorId] = useState<string | null>(null)`（瞬态本地态，与 `query` 同生命周期）。
  - `hits` 用 `useMemo` 从「可见卡 + query」算：`searchHits(assets.filter(a => visibleKinds.includes(a.kind)), q)`。可见卡过滤已在 sync effect 里做过一次，抽成共用的 `visibleAssets` memo，避免两处口径漂移。
  - `query` 变化时 `setCursorId(null)`（游标重置）。
  - `jump(dir)`：`stepCursor` → `setCursorId` → `setCenter(卡中心, { zoom: resolveJumpZoom(getViewport().zoom), duration: 300 })`。卡中心按 `cardSize(kind)` 取，不用 `CARD_W/H` 兜底值硬算。
  - Esc 分支追加 `setCursorId(null)`。
- `src/components/canvas/CanvasSearchBar`（同文件内组件）
  - 增 `hits` / `cursorIndex` / `onJump` prop；渲染 `n/m` chip（`font-mono`）；有词时 `⌘ K` chip 换成 `↵`。
  - `onKeyDown` 接 Enter / Shift+Enter，`isImeComposing` 门控。

**测试** 新建 `src/components/canvas/CanvasSearchBar.test.tsx`
（把 `CanvasSearchBar` 从 `AssetCanvas.tsx` 提取为独立文件以便单测——它已是纯展示组件，提取无副作用）
- 无搜索词：不渲染计数，显示 `⌘ K`。
- 有词有命中：显示 `2/5`；chip 换成 `↵`。
- 有词零命中：显示 `0/0`，不是 `1/0`。
- Enter 调 `onJump(1)`；Shift+Enter 调 `onJump(-1)`；IME 组合中的 Enter 不调。

**验证**
```bash
pnpm exec vitest run src/components/canvas/CanvasSearchBar.test.tsx
```

---

## T4 全量验证与真实环境验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真实环境（`pnpm dev`，端口避开 3000）逐条走 spec 成功标准 1–10：
  建一次性项目 + 若干文本卡（免费，不耗积分），坐标故意拉开到跨屏，验证跳转真的改变视口、光标态可辨、Delete 不误删、类型过滤器隐藏的卡不被跳到。
- 验收后删测试项目、删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每个任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
