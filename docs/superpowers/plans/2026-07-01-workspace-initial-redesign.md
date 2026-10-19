# 工作台初始界面对齐 Figma 实现计划

> **For agentic workers:** 用 superpowers:executing-plans 逐任务实现；步骤用 `- [ ]`。

**Goal:** 按 Figma `1105-26050` 重做工作台初始界面：资产库占位按钮、右下过滤按钮触发类型过滤、底部工具栏保留 minimap、空态快捷 pill、预览账户条(credit+头像)、空版本隐藏 Compare。

**Architecture:** 6 个隔离 UI 单元 + 一层用户信息数据(PGC `/auth/me` + `/credits/balance` → store 瞬态 → `useUserInfo` → `UserInfo` 组件)。配色全走既有 `--color-*` 令牌；新增 UI 复用既有基础组件/动效类。

**Tech Stack:** Next 16 / React 19 / zustand / @xyflow/react / react-i18next(6 语) / vitest+jsdom。

## Global Constraints

- 注释/commit/plan 用中文。
- 颜色走 CSS 变量,禁硬编码色值;复用 `FigIcon`/`IconButton`/`Button`/`Tooltip`/`Toast`/既有 `.anim-*`。
- 仅取后端 snake_case 文档字段,不臆测兜底。瞬态不持久化。
- 自身绝对路径经 `apiPath()`/`assetPath()`。
- i18n: en 为源,新增键补齐 en/zh/fr/ru/ja/vi 全 6 语。
- 测试与源码同目录 `*.test.ts(x)`;纯逻辑 TDD。
- **所有文件操作走 worktree 绝对路径** `.claude/worktrees/feat-workspace-initial-redesign/`。

---

### Task 1: 登记 3 个新图标

**Files:** Modify `src/components/ui/figma.tsx`(figAsset 注册表 + ICON_TONE)

**Produces:** `figAsset.assetLibrary`、`figAsset.filter`、`figAsset.credit`(指向 `/figma/icons/{asset-library,filter,credit}.svg`)。tone: assetLibrary/filter = primary(随主题);credit = primary(用处包 teal 文字)。

- [ ] 在 figAsset 注册三键(沿用既有命名/路径写法)。
- [ ] tsc 通过;无测试(纯注册)。

---

### Task 2: PGC 用户/余额类型 + client 方法

**Files:** Modify `src/lib/pgc/types.ts`、`src/lib/pgc/client.ts`;Test `src/lib/pgc/client.test.ts`(若无则新建,沿用既有 fetch mock 风格)

**Produces:**
- `CurrentUser { id:number; username:string; display_name?:string|null; email?:string|null; group?:string|null; role?:number|null; status?:number|null }`
- `BalanceData { balance:number; held:number; spendable:number }`
- `pgcApi.getCurrentUser(): Promise<CurrentUser>` → `GET /api/auth/me`
- `pgcApi.getBalance(): Promise<BalanceData>` → `GET /api/credits/balance`

- [ ] 写失败测试:mock fetch 返回标准信封 `{success,code,message,data}`,断言两方法解出 `data`。
- [ ] 跑测试看失败。
- [ ] 加类型 + 两方法(复用 `pgc<T>('GET', path)`)。
- [ ] 跑测试通过。
- [ ] commit `feat: PGC 当前用户/余额接口`。

---

### Task 3: user-display 纯逻辑(TDD)

**Files:** Create `src/lib/user-display.ts` + `src/lib/user-display.test.ts`

**Produces:**
- `userInitial(user: CurrentUser | null): string` —— display_name||username 首个有效字符大写;空/缺/全空白回退 `'?'`。
- `formatCredit(n: number | null | undefined): string` —— `Number.isFinite` 时整数串,否则 `'0'`。

- [ ] 写测试:`userInitial`(有 display_name→首字母大写 / 仅 username / 二者空→'?' / 前导空白) ;`formatCredit`(0→'0' / 1234→'1234' / null→'0')。
- [ ] 跑测试看失败。
- [ ] 实现。
- [ ] 跑测试通过。
- [ ] commit `feat: 用户展示纯逻辑(首字母头像/credit 格式化)`。

---

### Task 4: store 用户信息状态 + loadUserInfo

**Files:** Modify `src/store/types.ts`(ServerState + ServerActions 签名)、`src/store/index.ts`(初始值)、`src/store/actions.ts`(createServerActions 加 loadUserInfo)

**Consumes:** Task2 的 `pgcApi.getCurrentUser/getBalance`、`CurrentUser`/`BalanceData`。
**Produces:** state `userInfo: CurrentUser|null`、`credit: BalanceData|null`(初始 null,**不进 persist 白名单**);action `loadUserInfo(): Promise<void>`(`Promise.allSettled` 并发,各自成功 set,失败静默,无 Toast)。

- [ ] 写测试(`actions` 既有测试风格):loadUserInfo 成功后 state 写入;一方失败仍写另一方且不 setError。
- [ ] 跑测试看失败。
- [ ] 实现(注意:不在 persist partialize 里加这两个字段)。
- [ ] 跑测试通过。
- [ ] commit `feat: store 接入用户信息/余额(瞬态)`。

---

### Task 5: useUserInfo hook + 接入 Workspace

**Files:** Create `src/client/useUserInfo.ts` + `src/client/useUserInfo.test.tsx`;Modify `src/components/workspace/Workspace.tsx`(并列调用)

**Consumes:** Task4 `loadUserInfo`。

- [ ] 写测试:挂载触发一次 `loadUserInfo`;失败不抛(渲染不崩)。
- [ ] 跑测试看失败。
- [ ] 实现 hook(挂载 effect 调 `loadUserInfo`;遵循仓库 effect-setState lint 约束);Workspace 加 `useUserInfo()`。
- [ ] 跑测试通过。
- [ ] commit `feat: useUserInfo 挂载拉取用户信息`。

---

### Task 6: UserInfo 组件(credit + 头像)

**Files:** Create `src/components/preview/UserInfo.tsx`(可并 test 进 PreviewPanel.test)

**Consumes:** store `userInfo`/`credit`、Task3 `userInitial`/`formatCredit`、`figAsset.credit`。

- [ ] 实现:credit(`<span class="text-[var(--color-teal)]"><FigIcon src={figAsset.credit} tone="primary" size=...></span>` + `formatCredit` 数字 teal + "credit" 灰文案);头像(32px 圆、`border-[0.8px] border-white`、首字母居中)。aria-label。
- [ ] 测试(并入 Task7):渲染首字母与 credit 数。

---

### Task 7: PreviewPanel 账户条 + 条件版本控制行

**Files:** Modify `src/components/preview/PreviewPanel.tsx`;Test `src/components/preview/PreviewPanel.test.tsx`

**Consumes:** Task6 `UserInfo`、既有 `SharePopover`/`share` 图标。

- [ ] 写测试:账户条常驻渲染 credit+头像;`versions=0` 不渲染 Draft/Live/Publish 行;`>0` 渲染 Publish。
- [ ] 跑测试看失败。
- [ ] 实现:顶部账户条行(左 forward/分享 IconButton 复用 share + SharePopover,无 shareUrl 禁用;右 `<UserInfo/>`);把原 Draft名+Live+Publish 抽为「版本控制行」,`{hasGame && (...)}` 条件渲染;tab 行不动。
- [ ] 跑测试通过。
- [ ] commit `feat: 预览区账户条(credit+头像)与条件版本控制行`。

---

### Task 8: VersionTimeline 空态隐藏 Compare

**Files:** Modify `src/components/preview/VersionTimeline.tsx`;Test `src/components/preview/VersionTimeline.test.tsx`

- [ ] 写测试:`versions=0` 无 Compare;`=1` 有但 disabled;`≥2` 可用。
- [ ] 跑测试看失败。
- [ ] 实现:`{versions.length > 0 && <Compare.../>}`。
- [ ] 跑测试通过。
- [ ] commit `feat: 版本区空态隐藏 Compare 按钮`。

---

### Task 9: KindLegend 受控 popover + 右下 FilterButton

**Files:** Modify `src/components/canvas/KindLegend.tsx`(改受控)、`src/components/canvas/AssetCanvas.tsx`(filterOpen 本地态 + FilterButton 内联 + 渲染 KindLegend popover);Test `src/components/canvas/KindLegend.test.tsx`(若需)

**Produces:** `KindLegend` props `{ open:boolean; onClose:()=>void }`,popover 形态。

- [ ] 写/改测试:点 FilterButton 开/关 popover;过滤激活时按钮 active 态。
- [ ] 跑测试看失败。
- [ ] 实现:KindLegend 改为受控浮层(`.anim-pop-in origin-bottom-right` + `--color-pop`/`--shadow-popover`/backdrop-blur,遮罩 onWheel 关闭);AssetCanvas `Inner` 加 `filterOpen` state、内联 `FilterButton`(`bottom-5 right-5`,`filter` 图标,`isKindFilterActive` 时 raised-active),移除原 hover 热区。
- [ ] 跑测试通过。
- [ ] commit `feat: 画布右下过滤按钮触发类型过滤 popover`。

---

### Task 10: 画布左上资产库占位按钮

**Files:** Modify `src/components/canvas/AssetCanvas.tsx`(内联 `AssetLibraryButton`)

- [ ] 实现:`absolute left-4 top-4 z-10` IconButton(bordered,size-10,surface-2),`asset-library` 图标,Tooltip+aria「资产库(即将推出)」,onClick no-op。
- [ ] 测试(并入 canvas 测试):按钮存在、aria 正确。
- [ ] commit `feat: 画布左上资产库占位按钮`。

---

### Task 11: 画布空态快捷 pill + 接通

**Files:** Modify `src/components/canvas/AssetCanvas.tsx`(`CanvasEmptyState` 加 pill 行 + 上传 input)

**Consumes:** store `openGenForm`/`uploadAsset`/`setError`、`validateUpload`/`UPLOAD_POLICY`、视口中心换算。

- [ ] 写测试:点 image pill 调 `openGenForm({kind:'image',...})`;点 Upload 触发 file input → `uploadAsset`。
- [ ] 跑测试看失败。
- [ ] 实现:pill 行(`pointer-events-auto` 子层,5 个胶囊);四类生成 → `openGenForm({kind, x:屏幕中心, y, spawnAt:画布中心})`;Upload → 隐藏 input → 校验 → `uploadAsset`。
- [ ] 跑测试通过。
- [ ] commit `feat: 画布空态快捷生成/上传 pill`。

---

### Task 12: i18n 键补齐 6 语

**Files:** Modify `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Keys:** `canvas.assetLibrary`(+soon)、`canvas.filter`;`preview.credit`(+account aria)。pill 复用既有 `canvas.assetKind.*` 与 `canvas.addMenu.upload`。

- [ ] 各 UI 任务实现时即时加 en 键;本任务收尾确保 6 语齐、无缺键(扫 i18n config 测试)。
- [ ] commit(若独立)`feat: 补齐工作台初始界面 i18n 文案`。

---

### Task 13: 收尾验证

- [ ] `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。
- [ ] 用 dev server + playwright 截图核对深色稿初始界面(资产库左上、过滤右下、账户条、空态 pill、无 Compare)。
- [ ] 合回 dev、清理 worktree。

## Self-Review

- 覆盖:spec 六单元 + 数据层 + i18n + 测试,逐条对应 Task1–13。✓
- 无 TODO/占位;跨任务类型一致(CurrentUser/BalanceData/loadUserInfo/userInitial/formatCredit/KindLegend props)。✓
- i18n 键与 spec 一致;pill 复用既有键避免冗余。✓
