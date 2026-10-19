# 折叠把手液体粘连跟随 — 实现计划

设计稿：`docs/superpowers/specs/2026-08-18-edge-handle-liquid-follow.md`
分支：`feat/edge-handle-liquid-follow`（worktree `.orca/worktrees/edge-handle-liquid`）

前两版实现已 `git reset --hard dev` 清零，本计划从干净基线重做。纯逻辑 TDD。

---

## 任务 1：位移场几何（`src/lib/edge-handle.ts`）

在既有 `HANDLE_W/H/D/CLIP` 之后追加。**静态轮廓的采样在模块加载时算一次**（`BASE_POINTS`），每帧只做位移 + 重建。

- `sampleOutline()`：把静态轮廓四段（曲线 / 凸边直线 / 曲线 / 贴边直线）按段采样成 64 个点，每段取 `[0,1)` 避免端点重复。
- `tension(dx, dy)`：`hypot > HANDLE_REACH` 或 `dx < −(HANDLE_W+12)` → `null`；否则 `tx = HANDLE_W + clamp(dx, 0, REACH)`、`ty = clamp(HANDLE_H/2 + dy, 0, HANDLE_H)`。
- `liquidPath(tx, ty, strength, side)`：按 spec 的位移场逐点位移 → 闭合 Catmull-Rom 重建 → path 字符串；`side==='right'` 时 `x → LIQUID_W − x`。
- `liquidHitPath(...)`：上者 + 指针处半径 `HIT_R` 的圆（四段贝塞尔），拼成复合 path。

**先写的失败测试**：
1. `strength=0` 时路径**逐点经过** `BASE_POINTS`（Catmull-Rom 插值过所有采样点）→ 静态等价由构造保证。
2. 贴边那条线的点横向恒不动：任意 `tx/ty/strength` 下，路径所有 x ≥ 0；且 `BASE_POINTS` 中 `x=0` 的点位移后 x 仍为 0。
3. 牵引点落在凸边范围内（`e=1`，`ty∈[36,96]`）时，轮廓最外点 x **精确等于** `tx` —— 头部到位（守护 spec 坑 5 那个负瓣公式）。
4. 上下两端会内收：`ty` 居中、拉满时，存在非零 x 的点小于其静态 x（整体在变，不是只有中段动）。
5. 贴边线会朝牵引点收缩：`ty` 居中时，静态 `(0,0)` 那点的 y 位移 > 0（向下），`(0,132)` 那点 < 0（向上）。
6. 单调性：`tx` 越大轮廓最外点越靠外。
7. 脱手：超 `REACH` / 退回边栏内侧够深 → `null`；边界值不脱手。
8. 镜像：`right` 版是 `left` 版的 `x → LIQUID_W − x`（逐值断言，沿用 `HANDLE_CLIP` 镜像单测的做法）。
9. `liquidHitPath` 比 `liquidPath` 多一个闭合子路径，且该子路径覆盖牵引点（用点在多边形内的粗判或直接断言圆心与半径落点）。
10. `strength` 为负时位移反向（内凹），且轮廓 x 仍 ≥ 0。

**验证**：`pnpm exec vitest run src/lib/edge-handle.test.ts`

---

## 任务 2：状态机（`src/client/useLiquidFollow.ts`）

- state：`{ tx, ty, strength } | null`。
- `onPointerEnter`（挂在②按钮上）：reduce-motion 门控 → 缓存 rect → 挂 `window` 的 `pointermove`（passive，只读坐标）→ 起 rAF。
- 每帧：`tension()` 有值就以 `strength = 1` 写入（**不做 lerp**，见 spec）；返回 `null` 转 released。
- released：停监听，`strength = recoilAt(1, p)`（`p` 按 320ms 时间驱动，`easeOutBack` 取 `1 −` 进度、下限 −0.08），跑完 `stop()`。
- `recoilAt` 拆成导出的纯函数并单测（v2 在这里踩过：把进度当剩余量，脱手瞬间形变直接归零）。
- 卸载 / 点击 → `stop()` 清监听与 rAF。

**验证**：`recoilAt` 单测 + `tsc`。

---

## 任务 3：三层渲染（`Workspace.tsx` 的 `EdgeHandle`）

按 spec 的层次插入，**② 一个字都不改尺寸/位置/图标**，只加：
- `onPointerEnter`
- 活性态 `bg` 转透明 + 强制 `opacity-100`（它被③盖住收不到 `:hover`）

①③ 两个 div 就地内联（各自只有 clipPath + 定位），几何全部来自 lib。③ 带 `cursor-pointer` 与 `onClick={() => { stop(); onClick(); }}`。

**验证**：Playwright 在真实应用里逐条对照 spec 的 10 条成功标准，重点是要求 3——**在指针已远离原 24px 区域时点击，断言折叠真的发生**。

---

## 任务 4：全量验证

`pnpm lint` / `tsc` / `pnpm test` / `pnpm build`；目视复核左右两侧 / 深浅两稿 / Chat 收起常显态；数值若调整回写 spec。
