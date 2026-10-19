# 实现计划：构建中的版本要能自己变 ready

日期：2026-08-31
设计稿：`docs/superpowers/specs/2026-08-31-version-build-polling-design.md`
缺陷：Meegle 14391311（P1）
分支：`fix/version-build-polling`（worktree 隔离开发）

## 推进原则

按「**并存加新 → 原子切换 → 删旧**」推进：T1/T2 期间新旧两套驱动并存、生产行为只增不减；T3 一次性切换并删掉旧机制；T4 补链路验收证据。每个任务内部先写红测试再实现，任务之间可独立评审。

## T1 · 轮询由「列表里存在非 ready 版本」驱动（并存加新）

**目标**：`useCanvasPolling` 在 `versions` 里出现非 ready 行时也启动 2.5s 轮询，并在 5 分钟后自行停轮。此阶段 `pendingVersionId` 路径原样保留。

**红测试**（`src/client/useCanvasPolling.test.tsx`，沿用现有 fake timers + 可见性接管的写法）：
1. `pendingVersionId: null`、`versions` 含一条 `status:'building'` → 推进 2.5s，`pollVersions` 被调用。（当前必红）
2. 列表全 ready → 推进 2.5s，`pollVersions` **不**被调用。
3. 持续非 ready，推进至 5 分钟后再推进若干轮 → `pollVersions` 调用次数不再增长。
4. 非 ready 行消失（列表转全 ready）后再次出现非 ready 行 → 计时重置，重新开始轮询。
5. 切项目（`currentProjectId` 变化）重置封顶标志。

**实现**：
- `useCanvasPolling` 新增选择器 `hasUnreadyVersion = useStore(s => s.versions.some(v => v.status !== 'ready'))`（布尔，`Object.is` 比较天然稳定）。
- 封顶计次（**实现期修正**，原写的 `useRef` + `Date.now()` 计时方案被两条 eslint 规则否掉，详见 spec 决策 3）：`useState<{key, ticks}>`，key = `pid|非 ready 行的 id 集合`；key 变化即在渲染期重置计数（React 官方的「渲染期调整 state」）。tick 自增，`ticks >= 120` 翻转 `active` 拆掉 interval。
  - key 用 **id 集合而非布尔**（评审 Important-3）：布尔的话，一条永不 ready 的行会让 key 恒定、计数永久卡死，此后该项目每次新构建都不再被轮询——本缺陷换个前提复发。
- 门控条件：`active = (hasUnreadyVersion && !capped) || !!pendingVersionId`（**并存**，本任务不动旧路径）。
- `tickVersions` 内的现值复查同步放宽（不能只看 `pendingVersionId`）。
- 常量 `VERSION_POLL_CAP_MS = 5 * 60_000`，与既有 `VERSION_INTERVAL` 并列，注释说明「到点只停轮、不改状态不删版本」。

**验收**：`pnpm exec vitest run src/client/useCanvasPolling.test.tsx`

## T2 · 时间线的构建中形制改由真实 status 驱动

**目标**：`VersionTimeline` 里那套构建中外观（转圈 dot / `disabled` / 不响应 hover / 不显示时间）由 `v.status !== 'ready'` 触发，而不是由 `buildingVersion` 触发。

**红测试**（`src/components/preview/VersionTimeline.test.tsx`）：
- 新增：`versions` 含一条 `status:'building'` 的行 → 该行 `disabled`、无 `aria-current`、不渲染时间戳。（当前必红——现在它是一条可点的普通行）
- 现有 `buildingVersion 行:置顶、禁用、无 aria-current` 用例暂时保留（T3 才删）。

**实现**：`rows` 的 `building` 标志由 `buildingVersion ? true : false` 改为**并集**：`buildingVersion` 那条恒 true，`versions` 里的按 `v.status !== 'ready'` 计算。行序规则不变（构建中的行本就是最新版本，reverse 后自然在顶）。

**验收**：`pnpm exec vitest run src/components/preview/VersionTimeline.test.tsx`

## T3 · 原子切换 + 删旧机制

**目标**：删掉 `publishVersion` / `pendingVersionId` / `buildingVersion` 三件套，并纠正两处错误注释。

**改动**：
- `src/store/actions.ts`：删 `publishVersion`（:2489-2495）与导出（:3049）；`pollVersions` 的守卫从 `!get().pendingVersionId` 改为「列表里无非 ready 行则跳过」；`loadVersions` 删掉 `pending` / `cleared` 分支，`nextActive` 表达式相应简化（`cleared ? pending :` 一支整体去掉）；**删掉 :351 那条错误注释**，换成「`listVersions` 会返回构建中的版本（`status:'building'`、`created_at` 为空），由轮询推进至 ready——见 spec 2026-08-31」。
- `src/store/types.ts`：删 `pendingVersionId` / `buildingVersion` 两个字段（:343-344）及 `createInitialServerState` 里的初值（:426）。
- `src/lib/pgc/types.ts:119`：删「时间线恒 ready」的错误注释，改为说明该端点会返回构建中版本。
- `src/store/actions.ts:394`：`selectProject` 里清空这两个字段的语句一并删除。
- `src/client/useCanvasPolling.ts`：门控条件去掉 `|| !!pendingVersionId`，`tickVersions` 同步。
- `src/components/preview/VersionTimeline.tsx`：删 `buildingVersion` 订阅与 `rows` 里的那一支。
- 删旧测试：`actions.test.ts:1007-1030`（publishVersion 两例）、`VersionTimeline.test.tsx:97`（buildingVersion 行）、`useCanvasPolling.test.tsx` 里对 `pendingVersionId` 的 setState。

**验收**：`grep -rn "publishVersion\|pendingVersionId\|buildingVersion" src` 应无输出；`pnpm exec tsc --noEmit`（字段删除的引用漏网靠它兜）；`pnpm test`。

## T4 · 真实链路测试（补 2026-08-12 spec §4.5 的待办）

**目标**：一条从 `listVersions` 灌入到 CTA 可点的端到端 store 层测试，作为成功标准 1/5 的证据。

**测试**（`src/store/actions.test.ts`）：
1. `listVersions` 首次返回 `[{status:'building', created_at:null, ...}]` → `loadVersions()` → 断言 `versions[0].status === 'building'`、`createdAt === ''`。
2. 同一 mock 改为返回 `status:'ready'` + 合法 `created_at` → 再次 `loadVersions()` → 断言 `status==='ready'`、`createdAt` 非空、`activeVersionId` 仍指向同一 id（id 不变，不应发生 active 漂移）。
3. 配套断言 Rezona CTA 的判据：同一 `Version` 对象喂给 `remixToggleState`（`src/lib/remix-policy.ts`）在两个阶段分别得到 `disabled:true, reason:'notBuilt'` 与非 notBuilt——一条测试同时守住 Rezona CTA 与 Remix 开关这两个共用 `status` 的下游。

**验收**：`pnpm exec vitest run src/store/actions.test.ts`

## 收口

1. 合并前在合并结果上重跑完整验证：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` / `pnpm build`。
2. **实机走查**（成功标准 1，测试替代不了）：dev 环境跑一个会产出新版本的回合，**全程不刷新**，确认时间线那行从转圈自动变成带时间戳、Rezona CTA 自动可点、Remix 开关自动恢复。
3. 派干净上下文的子代理基于 commit 范围独立评审（只给 spec 与 diff）；Critical / Important 才改，Minor 记回 spec。
4. 提交边界：T1–T4 各一条 `fix:` / `test:`，spec 与 plan 的 `docs:` 提交在最前；需求整体用 `--no-ff` merge commit 分组。

## 不在本回合

- 抽「版本是否可对外交付」的 `lib/` 统一判据（Rezona CTA / Remix / APK 共用）——spec 决策 1 已定另开一轮。
- 构建期间 active 指向未 ready 版本导致预览区可能取不到地址——spec 已记为已知假设，待实机观察。
- `VersionData.status` 值域收敛（`failed` 等第三种值的呈现）——待后端明确契约。
