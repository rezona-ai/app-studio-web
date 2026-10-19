# 实现计划：画布交互打磨第二波（2026-08-12）

对应 spec：`docs/superpowers/specs/2026-08-12-canvas-ux-refinements-2.md`

开发隔离：worktree `.orca/worktrees/canvas-ux-refinements-2`，分支 `feat/canvas-ux-refinements-2`（自 `dev` 起）。
每个任务一个提交，提交后派干净上下文子代理基于该 commit 范围独立评审（只给 spec + diff）；Critical/Important 修完才进下一任务，Minor 记录给终审。

任务顺序把 bug 修复放最前 —— 它与三条 UI 零耦合，且是当前线上可复现的功能失效。

---

## 任务 1：修成组坐标浮点（spec §4）

**为什么第一个**：唯一的功能性 bug，改动面最小（一个纯函数 + 一处断言），与其余三条不共文件。

### 1.1 先写失败测试

`src/lib/canvas-group.test.ts` 新增：

- 输入卡片 `position: { x: 12.7, y: -8.3 }`（模拟关闭对齐后自由拖拽），断言 `boundingBoxOf` 返回的四个字段全部 `Number.isInteger`。
- 断言**外扩方向**：整数框恒包含浮点框 —— `canvas_x <= 浮点 left - padding`、`canvas_x + width >= 浮点 right + padding`（同理 y/height）。这条是 floor/ceil 而非 round 的存在理由，必须被测试钉住，否则后人「统一成 round」时测试不会响。
- 断言整数输入时输出**逐字节不变**（回归保护：吸附开启的既有路径不能被这次改动挪动一个像素）。

`src/store/actions.test.ts` 在既有 `createGroupFromSelection` 用例旁新增：

- 卡片摆在非整数坐标 → 调用 `createGroupFromSelection`，断言 `pgcApi.createCanvasGroup` 收到的请求体 `canvas_x / canvas_y / width / height` 均为整数。
- 断言乐观落地的本地 `groups[0]` 的 `x/y/w/h` 与请求体**同值**（spec §4 的「同一个值」不变式）。

跑测试确认红。

### 1.2 实现

`src/lib/canvas-group.ts` 的 `boundingBoxOf`：`canvas_x/canvas_y` 走 `Math.floor`，`width/height` 走 `Math.ceil`（对 floor 后的原点重算，不是对原宽高 ceil —— 否则左边界左移的那部分会被吃掉）。注释写明为什么不是 `Math.round`（round 双端内缩会把贴边卡挤出框，`groupHitFor` 按中心点判定会让它掉组）。

### 1.3 验证

`pnpm exec vitest run src/lib/canvas-group.test.ts src/store/actions.test.ts` 全绿；手动复核 `clampGroupSize` / `translateGroup` 不因整数化产生新的边界行为。

**提交**：`fix(canvas): 成组包围盒取整,修放开对齐后建框失败`

---

## 任务 2：Toast 撤销按钮化（spec §1）

### 2.1 测试

`src/components/ui/Toast.test.tsx`：

- 现有断言（点 Undo 调 `undo(token)`、不调 `clearToast`）必须继续通过 —— 这是行为不变的证据，**不改这些用例**。
- 新增：Undo 元素带 `btn-raised` 类（钉住「复用 Button 而非自写样式」这个决策，防止后人改回下划线或另造一套）。

### 2.2 实现

`src/components/ui/Toast.tsx`：把 Undo 的 `<button>` 换成 `import Button from './Button'`，传 `className="shrink-0 px-2.5 py-1 text-[13px]"`。删掉原有的 `underline decoration-... hover:bg-[rgba(0,0,0,0.06)]` 一串局部样式（`.btn-raised` 自带 hover）。`onClick` 与注释原样保留。

关闭按钮（✕）不动 —— 它是图标按钮，不属于「带文字按钮」那一类。

### 2.3 验证

`pnpm exec vitest run src/components/ui/Toast.test.tsx`；实机在浅色/深色两个主题下各看一次（按钮在深色稿仍浅色、文字仍深色可读）。

**提交**：`fix(ui): Toast 撤销入口改用 Button 实心按钮`

---

## 任务 3：资产列表挪到左下角（spec §3）

### 3.1 测试

`src/components/canvas/AssetListDrawer.test.tsx`：断言容器 className 含 `bottom-5` 且**不含** `top-1/2` / `-translate-y-1/2`（钉住基线，防回归）。高度夹取的既有用例保持通过。

### 3.2 实现

`src/components/canvas/AssetListDrawer.tsx:289`：

- `left-5 top-1/2 -translate-y-1/2` → `left-5 bottom-5`。
- `max-h` / `min-h` 的可用高度基准从「上下各让 6rem」改为「只让顶部搜索栏 + 底部自身留边」：底部不再需要为工具条留空间（现在同基线）。具体值按顶部搜索栏实测 60px + 留边算，写进注释。
- 更新文件头注释：面板不再「与右侧属性面板左右对称居中」（右侧常驻面板上一波已删），描述改为「贴左下角、与工具条同基线、向上生长」，并写明**已知代价**（窄画布与工具条重叠，用户已认可）。

### 3.3 验证

`pnpm exec vitest run src/components/canvas/AssetListDrawer.test.tsx`；实机拖 Chat 分隔条到最宽 + 展开预览列，确认重叠表现如 spec 所述（是已认可的代价，不是新 bug）。

**提交**：`fix(canvas): 资产列表面板改贴左下角`

---

## 任务 4：生成弹窗积分三态（spec §2）

改动面最大，拆两个提交：先换 hook 契约（纯逻辑 + 副作用层），再改 UI。这样评审能分别对着「时序正确性」和「视觉/文案」两件事看。

### 4.1 提交 A：`useGenEstimate` 三态契约

**测试先行** —— `src/client/useGenEstimate.test.tsx`：

- 挂载后**不等 debounce** 即断言 `pgcApi.estimateGenerate` 已被调用一次（这一条与现有「未到点不发」用例直接冲突，**改写**该用例：首次立即发，改参数才 debounce）。
- 挂载瞬间 `status === 'loading'`；报价落定后 `status === 'ready'`。
- 改参数期间 `status` **保持 `'ready'` 且值为旧价**（不退回 loading）；新价到达后替换。
- 请求失败 → `status === 'none'`；`billable: false` → `status === 'none'`。
- 切 `kind` → 立刻不再返回旧 kind 的价（现有归属校验用例保持通过）。
- 「每帧新建 params/refs 对象不重复发请求」的现有用例必须继续通过（`signature` 摘要机制不能被这次改动破坏）。

**实现** `src/client/useGenEstimate.ts`：

- 导出类型 `EstimateState = { status: 'loading' } | { status: 'ready'; value: Estimate } | { status: 'none' }`。
- 首次跳过 debounce：用一个 ref 标记「本 hook 是否已发过至少一次请求」，未发过则 `delay = 0`。**不能用 `held == null` 判首次** —— 请求失败后 `held` 也可能是空值语义，会让每次失败后的下一次改参都跳过 debounce。
- 三态由 `held` 派生：`held == null` → loading；`held.value == null` → none；否则 ready。归属校验（`held.kind !== kind`）落回 loading 而非 none —— 刚切类型时新价确实在路上，显示 spinner 才诚实。
- 保留 `signature` 依赖、`AbortController` 取消、失败静默（不弹 Toast、不进 `lastError`）这三条既有决策。

**验证**：`pnpm exec vitest run src/client/useGenEstimate.test.tsx`

**提交**：`refactor(canvas): 估价 hook 返回三态并首帧即发请求`

### 4.2 提交 B：UI + i18n

**i18n**：11 个 locale 各加一条 `canvas.gen.estimateUnavailable`（「无法估算」/「Unavailable」等）。`estimateExact` / `estimateRange` 的**词条保留但不再用于渲染主体** —— 改为只提供数字部分：新增 `estimateRangeValue: '{{min}}–{{max}}'`（纯数字，无单位，无需逐语翻译但仍走词条以保持一致），`exact` 直接渲染格式化后的数字。
⚠️ 若最终不需要 `estimateExact/estimateRange` 了，**删掉**它们（反模式：不留 dead code），而不是留着不用。

**测试** `src/components/canvas/GenerateForm.test.tsx`：

- loading 态渲染 spinner（用一个 `data-testid="gen-estimate-loading"` 定位，`aria-hidden` 的旋转 div 不该靠 class 断言）。
- ready/exact → 文本含格式化数字（如 `54,000`）且**不含**「credits」字样。
- ready/range → 文本含 `min–max`。
- none → 渲染 `—` 且带 `title`（不再是「整块不渲染」，现有断言若期待不渲染需**改写**）。
- 三态下提交按钮均在位（`aria-label` 可查到）。

**实现** `src/components/canvas/GenerateForm.tsx:466`：

- 抽一个同文件内的小组件 `EstimateChip({ state })`，三态各自渲染，保持 `shrink-0` 与行内 `items-center`。
- 图标：`<FigIcon src={figAsset.credit} size={14} tone="primary" />` 套 `text-[var(--color-teal)]` 的 `inline-flex`（与 `UserInfo.tsx:32-34` 逐字同款）。
- 数字沿用 `font-mono text-[12px]`；颜色决策——数字跟随 `--color-muted`（保持「辅助信息」的层级，不与提交按钮抢注意力），只有图标是 teal。这一条我自行判定，spec 未明确；若实机看着弱可再调。
- spinner：`size-3.5 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]`（复用 `toolPill.tsx` 惯例），套 `aria-hidden`。
- 占位符：`—` + `title={t('canvas.gen.estimateUnavailable')}` + 同文 `aria-label`。

**验证**：`pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`；实机四个 kind 各开一次弹窗看三态。

**提交**：`feat(canvas): 生成弹窗积分改闪电+数字并补加载/无价态`

---

## 收尾

1. 全量验证：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四条命令的完整输出与退出码贴给 Nick。
2. 终审：干净上下文子代理审全分支 diff（spec + 全量 diff），含各任务累积的 Minor。
3. `--no-ff` 合并回 `dev`，在合并结果上**重跑**全量验证。
4. 跑 `/walkthrough` 生成本回合走读并更新 `docs/FEATURE-MAP.md`。
5. worktree 清理与分支删除**先问 Nick**。

## 风险与已知代价

- **任务 4.1 改写现有测试用例**（「未到点不发」）：这是决策变更的必然结果，不是测试将就实现。评审时需明确说明这一条，避免被读成「为了让实现通过而改测试」。
- **窄画布下列表面板与工具条重叠**：用户已认可，不加躲避逻辑，但要写进注释与走读，免得下一轮当 bug 修。
- **占位符 `—` 可能被读成「免费」**：用户已认可，`title` 是唯一缓解。
- `boundingBoxOf` 整数化会让分组框比浮点包围盒**最多大 1px**，`groupHitFor` 的成员判定因此略微宽松。方向是安全的（宁可多收不可漏收）。
