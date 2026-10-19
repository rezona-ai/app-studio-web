# 构建中的版本要能自己变 ready（版本轮询由列表状态驱动）

日期：2026-08-31
状态：待批准（三条决策由 Nick 逐条确认：续拉 + 清理死机制 / 沏用原 building 行形制 / 封顶时长到点停轮）
缺陷：Meegle 14391311（P1）
前置：`2026-08-12-rezona-publish-direct-design`（§4.5 留下的待办正是本回合的起点）

## 目的

线上现象（Nick 报）：游戏构建完成后，版本时间线上那条新版本**没有时间戳**；此时 File → Share to Rezona 里的「Post to Rezona」CTA **置灰不可点**；**刷新一次页面就都正常了**。

两个症状同源：同一个 `Version` 对象的 `createdAt` 为空、`status !== 'ready'`。而这条半成品状态**在前端永远不会被刷新第二次**——用户只能靠手动刷新页面自救。

## 现状与根因（已由现象证实，非假设）

### 后端确实会返回非 ready 的版本行

`2026-08-12-rezona-publish-direct-design.md` §4.5 留过一条待办：

> **待办**：向后端确认 `GET /versions` 是否会返回 `building` 版本——若会，需补一条从 `listVersions` 灌入到 CTA 置灰的真实链路测试。

**答案是「会」，本缺陷即证据**，不需要再向后端求证：

1. `versions` 的唯一来源是 `listVersions`（`src/store/actions.ts:346`）。构建中占位 `buildingVersion` 走 `VersionTimeline.tsx:39` 独立渲染、从不进 `versions`，且生产上恒 `null`（下条）。故**时间线上那条没有时间的行只能来自 `listVersions`**，其 `createdAt` 为空串或非法（`versionToVersion` 的 `v.created_at ?? ''`，`src/lib/pgc/map.ts:216`；`formatVersionTime` 对非法值返回空串、整块不渲染，`VersionTimeline.tsx:10-18,129`）。
2. CTA 置灰的唯一判据是 `version.status === 'ready'`（`RezonaPublishModal.tsx:134` → `PublishForm.tsx:143`）。两个症状同时出现 ⇒ 那条 version 的 `status` 就是非 `ready`。

因此 `loadVersions` 里那条注释——「listVersions 只返回 ready 版本(时间线恒 ready)」（`actions.ts:351`）——是**错的**，`VersionData.status` 的注释「时间线恒 ready」（`src/lib/pgc/types.ts:119`）同错。

### 前端没有任何机制再拉第二次

- 版本轮询的唯一开关是 `pendingVersionId`（`src/client/useCanvasPolling.ts:14,26,31`）。
- 而 `pendingVersionId` / `buildingVersion` 的唯一置位者是 `publishVersion()`（`actions.ts:2489-2494`），**它在 UI 里没有任何调用方**——全仓引用只有 `actions.ts:3049` 的导出与 `actions.test.ts:1007` 的测试。生产链路上 `pendingVersionId` 恒 `null`，**版本轮询从不启动**，`VersionTimeline` 那条 building 行也从不出现。
- `loadVersions` 的其余调用方全是**一次性**的：`selectProject` 冷载（`actions.ts:423`）、`checkpoint.created`（`useKoubouConnection.ts:172`）、`run.finished(succeeded)`（`:187`）、回放收尾（`actions.ts:2982`）。

于是链路闭合：构建结束时 `checkpoint.created` / `run.finished` 触发一次 `loadVersions()`，恰好把这条 `building` 行灌进 `versions` 并因 `hasNew` 设为 active（`actions.ts:356,362`），此后无人再问一次，UI 永久停在构建中快照。刷新 → 重新 `loadVersions` → 后端已 ready → 一切正常。

### 连带症状

同一根因让 **SharePopover 的 Remix 开关也置灰**并显示 `notBuilt` 提示（`src/lib/remix-policy.ts:42`，经 `PreviewPanel.tsx:243` 传入 `active.status`）。本回合修好轮询后自然一并恢复，无需单独处理。

## 约束

- **不臆测后端字段**：判据只用契约已有的 `status`，不新增别名、不本地推导构建进度。
- **不堆叠废弃机制**：新轮询驱动上线后，旧的 `publishVersion` / `pendingVersionId` / `buildingVersion` 三件套整块删除，不与新机制并存（CLAUDE.md 反模式）。
- **不删服务端产物**：轮到封顶也只停轮询、不改状态、不删版本——后端可能仍在跑（呼应「孤儿任务兜底删服务端 item」那条反模式）。
- **fail-closed**：`status` 缺失或出现未知第三种值时按「未就绪」处理（置灰而非放行），服务端 409 `REZONA_VERSION_NOT_BUILT` 兜底保留（`2026-08-12` spec §7.4、§8 已定，本回合不动）。
- **UI 零新增**：不新增令牌、组件、动效类、i18n 文案。
- `useCanvasPolling` 的页面可见性门控（`useVisibilityGatedInterval`）语义不变：切后台即停。

## 决策

### 决策 1：修复边界 = 续拉 + 清理死机制

把版本轮询的驱动条件从 `pendingVersionId` 换成**「`versions` 里存在非 ready 版本」**，切换完成后按「并存加新 → 原子切换 → 删旧」删掉 `publishVersion` / `pendingVersionId` / `buildingVersion` 三件套及其测试。

**不在本回合做**：把「版本是否可对外交付」抽成 `lib/` 纯函数给 Rezona CTA、Remix 开关（`remix-policy.ts:42`）、APK 导出共用。理由——Remix 置灰是同一根因的连带症状，本回合修好轮询它自然就好；抽判据是纯重构，不该和缺陷修复混在一个回合里。`remix-policy.ts:4` 的头注释已经在呼吁这件事，**另开一轮**。

### 决策 2：构建中的行沏用原 building 行的形制

`VersionTimeline` 已经为 building 行画好了外观：转圈 dot、`disabled` 不可点、不响应 hover、不显示时间（`VersionTimeline.tsx:39,85,98,101-107`）。本回合把这套形制的**触发判据从 `buildingVersion` 换成 `v.status !== 'ready'`**，接到真实数据上。设计稿当年就是这么画的，只是从没被真实数据触发过——零新增 UI、零新令牌。

行序规则不变（构建中的行本就是最新版本，reverse 后自然在顶部，不需要额外置顶逻辑）。

### 决策 3：轮询封顶时长，到点停轮

从**首次在列表里看到非 ready 行**起计时，超过上限（**5 分钟**）停止轮询；那条行保持构建中外观、CTA 保持置灰。

- 计数状态放 **`useCanvasPolling` 内部**（`useState` 记「转折点 key + 已轮询次数」，走 React 的渲染期调整 state），**不进 store、不持久化**——属瞬态，且刷新后本就会重新 `loadVersions`、重新给一轮 5 分钟，这正是期望行为。
  - 落点理由：轮询的**门控语义本就归这个 hook 所有**（它已经在算 `genTasks` 计数、算 `active`、经 `useVisibilityGatedInterval` 决定建不建 interval）。若把计时放进 `createServerActions` 闭包，闭包只能让 `pollVersions` 变成空转——interval 仍每 2.5s 触发一次再原地返回，等于没停。封顶必须能翻转 hook 的 `active` 才真正拆掉 interval。
  - 该状态没有第二个消费者，不构成跨组件协调，故不进 store（沿用「瞬态不落 store/不落盘」的既有口径）。
- 切项目（`currentProjectId` 变化）与「列表里已无非 ready 行」两种情形都重置计数。
- **实现期修正：计次而非计时**。原设想用 `Date.now()` 记起始时刻，但它在渲染期属不纯调用（`react-hooks/purity` 直接报 error），且 effect 里 setState 也被 `react-hooks/set-state-in-effect` 禁掉。改为计轮询次数（`5min / 2.5s = 120` 次）：间隔固定故与计时等价，附带收益是后台标签页的空转 tick 不计次——封顶口径从墙钟变成「5 分钟的**有效**轮询」，反而更贴合本意。
- 到点后**不**改版本状态、**不**弹提示、**不**删任何东西。

不设上限的方案被否：用户开着页面放一晚就是一晚的 2.5s 轮询。超时给可见提示的方案也被否：要新增 11 语言文案，而「多久算异常」本身是拍脑袋的。

## 成功标准

1. 构建结束后**不刷新页面**，时间线那条行在构建完成后自动补上时间戳、Rezona CTA 自动可点、Remix 开关自动恢复——全程无需用户干预。
2. 构建期间该行呈现为构建中形制（转圈、不可点），而非一条无时间的普通行。
3. 全仓不再存在 `publishVersion` / `pendingVersionId` / `buildingVersion` 三个符号。
4. 后端持续不返回 ready 时，轮询在 5 分钟后停止，且不产生任何状态改写或删除。
5. 有一条从 `listVersions` 返回 `status:'building'` 灌入、到轮询推进、到 ready 后 CTA 可点的**真实链路测试**——补上 `2026-08-12` spec §4.5 那条待办要求的测试。
6. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` / `pnpm build` 全绿。

## 风险与已知假设

- **active 仍会切到构建中的版本**：`loadVersions` 的 `hasNew` 分支无条件把 active 切到 `latest`（`actions.ts:362`），而 latest 此刻可能正是那条 building 行。于是构建期间预览区指向一个还没 ready 的版本，`previewVersionById` 可能取不到地址。盘问时把「只切到最新的 ready 版本」作为选项摆过，Nick 选择**不改**——「改完立刻看效果」是刻意设计，且构建窗口很短。**记为已知假设**：若实机发现构建期间预览区发白或报错，再单独开一轮处理，不在本回合扩大范围。
- **`status` 值域未在契约中收敛**：`VersionData.status` 是裸 `string`（`types.ts:119`）。若后端引入第三种非 ready 值（如 `failed`），本方案会把它当作「构建中」一直轮到封顶为止。按 fail-closed 原则这是安全的（置灰而非放行），但表现不精确。**待后端明确 status 值域后再收敛**，届时可给失败态单独的呈现。
- **评审 Minor：构建期每 tick 一次外层重渲染**（2026-08-31 评审提出，**决定不改**）。计数落在 `useCanvasPolling` 的 state 里，故构建期间挂载它的 `Workspace` 每 2.5s 重渲染一次，最长 5 分钟。改成 `useRef` 计数、只在跨过封顶时 setState 可以消除，但那要么在渲染期写 ref（正是 `react-hooks/purity` 针对的那类不纯操作），要么把计数拆到 ref 与 state 两处、重置语义变绕。收益是有限时段内的一点渲染开销，不值这个复杂度。若日后构建时长显著拉长或实测卡顿，再回来处理。
- **未做运行态验证**：根因由代码路径与现象双向印证得出，本 spec 撰写期间未在 dev 环境实跑。实现阶段的验收必须包含成功标准 1 的实机走查。
