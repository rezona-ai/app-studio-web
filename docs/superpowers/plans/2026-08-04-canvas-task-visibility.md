# 实现计划：画布任务可见性

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-task-visibility.md`
> 分支：`feat/canvas-task-visibility`

先纯逻辑，再药丸，最后接到卡上。每任务一次提交。

---

## T1 时长格式化与任务行派生（纯逻辑）

**改动** 新建 `src/lib/gen-progress.ts`
- `SHOW_ELAPSED_AFTER_MS = 10_000`、`SLOW_AFTER_MS = 5 * 60_000`。
- `formatElapsed(ms)` → `m:ss`（超过一小时给 `h:mm:ss`，虽然 10 分钟就会被判失败，但格式化本身不该假设上限）。
- `elapsedTone(ms)` → `'normal' | 'warn'`。
- `taskRows(genTasks, assets, now)` → `{ itemId, kind, elapsedMs, tone, label }[]`，按已等时长**倒序**（等最久的在最上）。

**测试** 新建 `src/lib/gen-progress.test.ts`
- `formatElapsed`：0 → `0:00`；9s → `0:09`；65s → `1:05`；600s → `10:00`；3661s → `1:01:01`。
- `elapsedTone`：4:59 → normal；5:00 → warn。
- `taskRows`：按时长倒序；label 取自资产（缺资产的任务跳过）；空任务 → 空数组。
- 边界：`startedAt` 在未来（时钟漂移）→ 时长按 0 处理，不出负数。

**验证**
```bash
pnpm exec vitest run src/lib/gen-progress.test.ts
```

---

## T2 「生成中 N」药丸 + 展开列表

**改动**
- 新建 `src/components/canvas/GenTaskBadge.tsx`
  - 订阅 `genTasks` / `assets`；无任务直接 `return null`（**此时不注册定时器**，成功标准 8）。
  - 有任务时 `setInterval(1s)` 驱动重渲；卸载清理。
  - 药丸：`absolute right-5 top-16 z-10`，`.anim-pop-in`，形制沿用 `NewAssetsBadge`。
  - 展开：点击切换列表；每行「类型图标 + 名称 + 已等 m:ss（warn 时转警示色 + 标『较慢』）」，点行 `setCenter` 飞过去。
  - 列表位置用既有 `clampPopover` 夹进视口。
- `AssetCanvas.tsx` 挂载它。
- i18n × 11：`canvas.tasks.badge`（带 count）、`canvas.tasks.slow`、`canvas.tasks.waiting`。

**测试** 新建 `src/components/canvas/GenTaskBadge.test.tsx`（mock `@xyflow/react` 的 `useReactFlow`，同 `NewAssetsBadge` 的做法）
- 无任务 → 不渲染，且**没有注册定时器**（`vi.useFakeTimers` + 断言 timer 数）。
- 两个任务 → 文案含 2；点开列出两行，等最久的在最上。
- 超过 5 分钟的行标「较慢」。
- 点行 → `setCenter` 被调用。
- 任务结束（`genTasks` 变空）→ 不渲染且定时器被清理。

**验证**
```bash
pnpm exec vitest run src/components/canvas/GenTaskBadge.test.tsx
```

---

## T3 卡上「已等 X」

**改动**
- `GeneratingPlaceholder.tsx` 接一个可选 `elapsedMs`：`< SHOW_ELAPSED_AFTER_MS` 不显示；否则在骨架上叠一行时长（warn 时转色）。
  **组件不自己计时** —— 由上层按秒 tick 传入，避免每张卡一个定时器。
- `AssetCanvas.tsx` / 节点渲染层把对应 `GenTask.startedAt` 传下去（沿用 `buildRfNodes` 那条数据通路，避免破坏节点复用）。

**测试** `GeneratingPlaceholder.test.tsx` 追加
- 不传 / < 10s → 不出现时长文本。
- 12s → 出现 `0:12`。
- 6 分钟 → 文本带警示色类。

**验证**
```bash
pnpm exec vitest run src/components/canvas/nodes/GeneratingPlaceholder.test.tsx
```

---

## T4 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–9，重点四条**只有真机能验**的：
  1. 空闲画布上确实没有秒级定时器在跑（DevTools Performance 或断点确认）
  2. 提交真实视频生成 → 药丸出现、计时递增、卡上 10 秒后出现时长
  3. 点列表行飞到卡
  4. 任务完成后药丸消失
- ⚠️ **本组要验完整链路必须跑一次真实视频 / 3D 生成，会消耗积分**。若不想花，退而用
  `registerAgentGenTask` 或直接往 `genTasks` 塞一条来驱动 UI，并在验收记录里写明用的是哪种。
- 验收后删 `.env` 副本、停 dev、清理验收产生的资产。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
