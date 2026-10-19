# 右边栏（Preview 栏）空态对齐 Figma 设计稿 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让右栏（Preview）空态/初始界面逐项对齐 Figma 节点 1527-40709，并把暗色主题令牌校准到设计稿中性灰阶。

**Architecture:** 两类改动——(A) `globals.css` 的 `[data-theme="dark"]` 面/填充灰阶（全局，主题自适配）；(B) 右栏空态组件的结构/间距/描边/图标（`PreviewPanel.tsx` + `PreviewTabs` + `VersionTimeline.tsx`，新增 `forward` 图标）。颜色全部走既有语义令牌，组件不写主题分支。

**Tech Stack:** Next.js 16 / React 19 / Tailwind v4（`@theme` + CSS 变量）/ Vitest + Testing Library / `FigIcon`（CSS mask 重着色）。

## Global Constraints

- 颜色一律走 CSS 变量（`bg-[var(--color-*)]`），禁止硬编码色值（沿用既有令牌）。
- 仅改 `[data-theme="dark"]` 块；light 主题不动。不改 persist 配置（`taluna-v4`/`theme` 被 `layout.tsx` 防白闪脚本硬编码引用）。
- 图标一律 `FigIcon`，`src` 取自 `figAsset` 注册表；新图标先放 `public/figma/icons/` 再登记。
- 描边一律用既有令牌；右栏分隔线用 `--color-line-strong`（`#494949`）。
- 字号用精确 px（`text-[14px]`），圆角沿用既有档位（控件 8/10、卡片 12/16）。
- 所有交互元素配 `aria-label` 或包 `Tooltip`。
- 注释/commit message 用中文；commit message 以 `Claude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw` 结尾。
- 验证命令在 worktree 根运行：`pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm test`、`pnpm build`。

## File Structure

- `src/app/globals.css` — 修改：`[data-theme="dark"]` 的 canvas/surface/surface-2/fill/pop 值（Task 1）
- `public/figma/icons/forward.svg` — 新建：转发曲线箭头图标（Task 2）
- `src/components/ui/figma.tsx` — 修改：`figAsset` 登记 `forward`（Task 2）
- `src/components/preview/PreviewPanel.tsx` — 修改：根容器/账户条/分享按钮/tab 行容器/下载刷新按钮/舞台空态/分隔线（Task 3）；`PreviewTabs` 仅图标 + Tooltip（Task 4）
- `src/components/preview/UserInfo.tsx` — 修改：credit 单位字距微调（Task 3）
- `src/components/preview/PreviewPanel.test.tsx` — 修改：新增「tab 仅图标」断言（Task 4）
- `src/components/preview/VersionTimeline.tsx` — 修改：Versions 头部间距 + 分隔线（Task 5）

> 说明（分隔线策略）：保持现网 4 条分隔线的**视觉位置**不变，仅把颜色由 `--color-line` 改为 `--color-line-strong`，并新增「Versions 头部下方」一条。即：账户条 `border-b`、tab 行 `border-b`、VersionTimeline 根 `border-t` 三处**仅改色**，避免移动 border 造成双线（spec §5.4 允许「视觉位置一致 + 颜色 line-strong」）。

---

### Task 1: 全局暗色令牌灰阶校准

**Files:**
- Modify: `src/app/globals.css`（`[data-theme="dark"]` 块，约 105–118 行）

**Interfaces:**
- Produces: 暗色语义令牌新值 `--color-canvas:#171717`、`--color-surface:#202020`、`--color-surface-2:#262626`、`--color-fill:#2e2e2e`、`--color-pop:#1a1a1a`。后续 Task 3/4 的 `bg-[var(--color-*)]` 依赖这些值呈现设计稿灰阶。

- [ ] **Step 1: 改 5 个面/填充令牌值（含注释对位 Figma grey）**

把 `[data-theme="dark"]` 块内这 5 行：

```css
  --color-surface: #232627;
  /* Surface/02:Chat/Preview 面板 */
  --color-surface-2: #2c2c2e;
  /* Surface/03 */
  --color-fill: #313335;
  /* Surface/03:hover/填充,比 surface 浅 */
  --color-canvas: #141718;
  /* Surface/01:画布中心 / 页面底 */
  /* 弹层浮面压暗:比 surface(#232627)更深,浮层读作下沉的深色菜单,与同色面板拉开层次,不再显亮 */
  --color-pop: #1c1e1f;
```

改为（对齐 Figma dark 灰阶 grey/900..700，fill/pop 为维持灰阶连续的插值）：

```css
  --color-surface: #202020;
  /* Figma grey/800 background/grey-800:Chat/Preview 面板 */
  --color-surface-2: #262626;
  /* Figma grey/700:浮面 / 按钮底（如分享按钮） */
  --color-fill: #2e2e2e;
  /* hover/填充:插值,比 surface-2 略浅以保留 hover 可感（右栏未直接用） */
  --color-canvas: #171717;
  /* Figma grey/900 background/grey:画布中心 / 页面底 / 右栏根底 */
  /* 浮层:插值,略深于 surface + 模糊读作浮层（右栏未直接用） */
  --color-pop: #1a1a1a;
```

- [ ] **Step 2: 类型检查 + 全量测试（确认未破坏现有断言）**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: tsc 退出码 0；测试 99 文件 / 814 用例全过（令牌改动不影响行为类断言）。

- [ ] **Step 3: 目视确认骨架微光仍可见**

人工核对：`--color-skeleton-hi`（`#45484b`）与新 `--color-fill`（`#2e2e2e`）明度差足够（45 vs 2e），骨架微光仍肉眼可见。若不可见再微调（本次预期无需改）。

- [ ] **Step 4: 提交**

```bash
git add src/app/globals.css
git commit -m "$(printf 'feat: 暗色令牌灰阶对齐 Figma(canvas/surface/surface-2/fill/pop)\n\nClaude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw')"
```

---

### Task 2: 新增 `forward` 转发箭头图标并登记

**Files:**
- Create: `public/figma/icons/forward.svg`
- Modify: `src/components/ui/figma.tsx`（`figAsset` 对象）

**Interfaces:**
- Produces: `figAsset.forward`（字符串路径，`${F}/forward.svg`）。Task 3 的分享按钮以 `<FigIcon src={figAsset.forward} flipX>` 引用；`forward` 不入 `ICON_TONE` 表 → 默认 `primary`（随 currentColor 翻转）。

- [ ] **Step 1: 写入图标 SVG（取自设计稿节点 1527:33327，实心转发箭头）**

新建 `public/figma/icons/forward.svg`，内容（fill 用 currentColor，配合 `FigIcon` 的 mask 重着色；mask 取形状 alpha，实心填充即可）：

```svg
<svg width="16" height="16" viewBox="0 0 14.6667 12.0001" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6.93977 0.0585183C7.17926 0.166064 7.33333 0.40415 7.33333 0.666678V3.32386C7.49274 3.32882 7.67411 3.33885 7.87286 3.35692C8.60919 3.42386 9.60433 3.60301 10.6092 4.05977C11.6192 4.51886 12.6447 5.2616 13.4139 6.45034C14.1833 7.63939 14.6667 9.22902 14.6667 11.3333C14.6667 11.6633 14.4254 11.9435 14.0991 11.9926C13.774 12.0415 13.462 11.8461 13.3638 11.5326L13.3636 11.5319L13.3633 11.5311C13.3598 11.5205 13.3444 11.4751 13.3149 11.4038C13.2755 11.3086 13.2113 11.1673 13.1162 10.9976C12.9257 10.6574 12.6157 10.2104 12.1416 9.79101C11.2803 9.02905 9.80765 8.29546 7.33333 8.57902V11.3333C7.33333 11.5959 7.17926 11.834 6.93977 11.9415C6.70028 12.049 6.41997 12.006 6.22376 11.8316L0.223757 6.49828C0.0814319 6.37177 0 6.19044 0 6.00001C0 5.80959 0.0814319 5.62825 0.223757 5.50174L6.22376 0.168405C6.41997 -0.00600874 6.70028 -0.049028 6.93977 0.0585183Z" fill="#000"/>
</svg>
```

- [ ] **Step 2: 登记 `figAsset.forward`**

在 `src/components/ui/figma.tsx` 的 `figAsset` 对象内、`share` 行下方新增一行：

```ts
  share: `${F}/share.svg`,
  forward: `${F}/forward.svg`,
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 退出码 0（`figAsset.forward` 可被引用）。

- [ ] **Step 4: 提交**

```bash
git add public/figma/icons/forward.svg src/components/ui/figma.tsx
git commit -m "$(printf 'feat: 登记 forward 转发箭头图标(右栏分享按钮用)\n\nClaude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw')"
```

---

### Task 3: PreviewPanel 空态结构 / 颜色 / 分隔线对齐

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`（根容器 91、账户条 93、分享按钮 94–104、tab 行容器 128、下载/刷新按钮 133–163、空态舞台 179）
- Modify: `src/components/preview/UserInfo.tsx`（credit 单位字距）
- Test: `src/components/preview/PreviewPanel.test.tsx`（现有断言须保持绿，本任务不新增）

**Interfaces:**
- Consumes: Task 1 的令牌新值；Task 2 的 `figAsset.forward`。
- Produces: 分享按钮可及名仍为 `Share`（aria-label 不变）；下载/刷新按钮可及名不变（`Download ZIP` / `Refresh preview`）；空态提示文案不变（`preview.emptyHint`）。

- [ ] **Step 1: 改根容器底色与左描边**

`PreviewPanel.tsx` 第 91 行，根 `<div>`：

```tsx
    <div className="flex h-full flex-col border-l border-[var(--color-line)] bg-[var(--color-surface)]">
```

改为：

```tsx
    <div className="flex h-full flex-col border-l border-[var(--color-line-strong)] bg-[var(--color-canvas)]">
```

- [ ] **Step 2: 账户条分隔线改色 + 分享按钮对齐设计稿**

第 93 行账户条容器分隔线由 `--color-line` 改 `--color-line-strong`：

```tsx
      <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
```
→
```tsx
      <div className="flex items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-2">
```

第 94–104 行分享按钮（去边框 ghost + surface-2 底 + rounded-8 + px-4 py-2 + forward 图标镜像 16px）：

```tsx
        <Tooltip>
          <IconButton
            variant="bordered"
            className="rounded-[10px] bg-[var(--color-surface-2)] p-1.5"
            aria-label={t('preview.share')}
            disabled={!hasGame || !shareUrl}
            onClick={() => setShareOpen(true)}
          >
            <FigIcon src={figAsset.share} size={18} />
          </IconButton>
        </Tooltip>
```
改为：
```tsx
        <Tooltip>
          <IconButton
            variant="ghost"
            className="rounded-[8px] bg-[var(--color-surface-2)] px-4 py-2"
            aria-label={t('preview.share')}
            disabled={!hasGame || !shareUrl}
            onClick={() => setShareOpen(true)}
          >
            <FigIcon src={figAsset.forward} size={16} flipX />
          </IconButton>
        </Tooltip>
```

- [ ] **Step 3: tab 行容器间距 + 分隔线改色**

第 128 行 tab 行内层 `<div>`：

```tsx
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] px-4 py-2">
```
改为：
```tsx
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-3">
```

- [ ] **Step 4: 下载 / 刷新按钮去边框 + surface 底 + rounded-10 + 16px 图标**

第 132–151 行下载按钮：`variant="bordered"`→`"ghost"`，`rounded-[12px] bg-[var(--color-surface-2)]`→`rounded-[10px] bg-[var(--color-surface)]`，spinner `size-5`→`size-4`，`FigIcon ... size={20}`→`size={16}`：

```tsx
                <IconButton
                  variant="ghost"
                  className="rounded-[10px] bg-[var(--color-surface)] p-2"
                  aria-label={t('preview.downloadZip')}
                  aria-busy={downloading}
                  disabled={!hasGame}
                  onClick={() => void handleDownload()}
                >
                  {downloading ? (
                    <span
                      role="status"
                      aria-label={t('preview.downloading')}
                      className="block size-4 animate-spin rounded-full border-2 border-current/25 border-t-current"
                    />
                  ) : (
                    <FigIcon src={figAsset.download} size={16} />
                  )}
                </IconButton>
```

第 153–163 行刷新按钮同样处理：

```tsx
                <IconButton
                  variant="ghost"
                  className="rounded-[10px] bg-[var(--color-surface)] p-2"
                  aria-label={t('preview.refresh')}
                  disabled={!hasGame}
                  onClick={() => setRefreshNonce((n) => n + 1)}
                >
                  <FigIcon src={figAsset.refresh} size={16} />
                </IconButton>
```

- [ ] **Step 5: 空态舞台底色改 surface + 提示语改 muted + 限宽 206px**

第 178–182 行空态分支：

```tsx
              <div className="flex h-full items-center justify-center bg-[var(--color-canvas)] px-8 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
                {t('preview.emptyHint')}
              </div>
```
改为：
```tsx
              <div className="flex h-full items-center justify-center bg-[var(--color-surface)] px-8 text-center">
                <span className="max-w-[206px] text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-muted)]">
                  {t('preview.emptyHint')}
                </span>
              </div>
```

- [ ] **Step 6: UserInfo credit 单位字距微调**

`UserInfo.tsx` 第 23 行 credit 单位 `<span>`，加 `tracking-[0.18px]`：

```tsx
        <span className="text-[12px] leading-[18px] text-[var(--color-ink)]">{t('preview.credit')}</span>
```
→
```tsx
        <span className="text-[12px] leading-[18px] tracking-[0.18px] text-[var(--color-ink)]">{t('preview.credit')}</span>
```

- [ ] **Step 7: 类型检查 + 全量测试（现有断言保持绿）**

Run: `pnpm exec tsc --noEmit && pnpm test src/components/preview/PreviewPanel.test.tsx`
Expected: tsc 退出码 0；PreviewPanel 测试全过（分享/下载/刷新可及名不变，账户条 credit/头像断言不受影响）。

- [ ] **Step 8: 提交**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/UserInfo.tsx
git commit -m "$(printf 'feat: 右栏空态结构对齐设计稿(根底/分隔线 line-strong/分享 forward/舞台 surface/提示语 muted)\n\nClaude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw')"
```

---

### Task 4: PreviewTabs 改为仅图标 + Tooltip

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`（`PreviewTabs` 函数，30–50 行）
- Test: `src/components/preview/PreviewPanel.test.tsx`（新增「仅图标」断言）

**Interfaces:**
- Consumes: `Tooltip`（已 import）；`label` 优先于子元素 `aria-label`，二者均设为 `tab.label`。
- Produces: tab 按钮可及名仍为 `Preview` / `Files`（aria-label）；按钮**无可见文字**（仅 `FigIcon`）。

- [ ] **Step 1: 写失败测试（tab 为仅图标，无可见文字）**

在 `PreviewPanel.test.tsx` 末尾追加：

```tsx
test('Preview/Files tab 为仅图标(无可见文字, 走 aria-label)', async () => {
  render(<PreviewPanel />);
  await flush();
  // 可及名来自 aria-label
  const preview = screen.getByRole('button', { name: 'Preview' });
  expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  // 按钮内无可见文字标签(仅图标)
  expect(preview).toHaveTextContent('');
  expect(screen.queryByText('Files')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/components/preview/PreviewPanel.test.tsx -t "仅图标"`
Expected: FAIL —— 现状 tab 按钮含可见文字 `Preview`/`Files`，`toHaveTextContent('')` 与 `queryByText('Files')` 断言不满足。

- [ ] **Step 3: 实现仅图标 + Tooltip（改 `PreviewTabs` 渲染 + tab 容器底色 + 激活态底色/间距）**

把 `PreviewTabs` 第 29–50 行的 `return`：

```tsx
  return (
    <div className="inline-flex items-center gap-1 rounded-[12px] bg-[var(--color-canvas)] p-1">
      {tabs.map((tab) => {
        const active = previewTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={active}
            onClick={() => setPreviewTab(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[14px] font-semibold transition-[background-color,color] duration-150 ${
              active
                ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            <FigIcon src={tab.icon} size={16} tone={active ? 'primary' : 'secondary'} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
```

改为（容器底 `canvas`→`surface`；激活底 `surface-2`→`line-strong`；`py-2`→`py-1`；去文字、加 `aria-label`、包 `Tooltip`）：

```tsx
  return (
    <div className="inline-flex items-center gap-1 rounded-[12px] bg-[var(--color-surface)] p-1">
      {tabs.map((tab) => {
        const active = previewTab === tab.key;
        return (
          <Tooltip key={tab.key} label={tab.label}>
            <button
              type="button"
              aria-label={tab.label}
              aria-pressed={active}
              onClick={() => setPreviewTab(tab.key)}
              className={`inline-flex items-center justify-center rounded-[8px] px-4 py-1 transition-[background-color,color] duration-150 ${
                active
                  ? 'bg-[var(--color-line-strong)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <FigIcon src={tab.icon} size={16} tone={active ? 'primary' : 'secondary'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
```

- [ ] **Step 4: 跑测试确认通过（新增 + 既有 tab 断言）**

Run: `pnpm test src/components/preview/PreviewPanel.test.tsx`
Expected: PASS —— 「仅图标」新测试过；既有「下载与刷新按钮在 Preview/Files tab 行」(按可及名 `Preview`/`Files`) 仍过。

- [ ] **Step 5: 提交**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/PreviewPanel.test.tsx
git commit -m "$(printf 'feat: Preview/Files tab 改为仅图标+Tooltip(对齐设计稿),激活底 line-strong\n\nClaude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw')"
```

---

### Task 5: VersionTimeline 头部间距 + 分隔线

**Files:**
- Modify: `src/components/preview/VersionTimeline.tsx`（根 32、头部 34）
- Test: `src/components/preview/VersionTimeline.test.tsx`（现有断言保持绿，不新增）

**Interfaces:**
- Consumes: `--color-line-strong`。
- Produces: 视觉——舞台/版本区分隔线、Versions 头部下方分隔线均为 `#494949`。

- [ ] **Step 1: 根容器顶描边改 line-strong**

第 32 行：

```tsx
    <div className="flex min-h-0 flex-[3] flex-col border-t border-[var(--color-line)]">
```
改为：
```tsx
    <div className="flex min-h-0 flex-[3] flex-col border-t border-[var(--color-line-strong)]">
```

- [ ] **Step 2: Versions 头部间距 px-3 + 下方分隔线**

第 34 行头部行：

```tsx
      <div className="flex h-12 shrink-0 items-center justify-between px-4 py-3">
```
改为（`px-4`→`px-3`，加 `border-b border-[var(--color-line-strong)]`）：
```tsx
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-3">
```

- [ ] **Step 3: 类型检查 + VersionTimeline 测试**

Run: `pnpm exec tsc --noEmit && pnpm test src/components/preview/VersionTimeline.test.tsx`
Expected: tsc 退出码 0；3 个用例全过（Compare 空态/单版本禁用/双版本可用，间距与描边改动不影响）。

- [ ] **Step 4: 提交**

```bash
git add src/components/preview/VersionTimeline.tsx
git commit -m "$(printf 'feat: Versions 头部间距 px-3 + 分隔线 line-strong(对齐设计稿)\n\nClaude-Session: https://claude.ai/code/session_01VpoCLf6pUNuNbUJY7ykxXw')"
```

---

### Task 6: 全量验证 + 目视核对 + 清理

**Files:** 无（仅验证与清理）

- [ ] **Step 1: 全量自动化门禁**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 四项全过（tsc 0；lint 无 error；测试 99+ 文件全过含新增用例；build 成功）。

- [ ] **Step 2: 目视核对（best-effort，dev server + 截图）**

启动 dev（后台）：`pnpm dev`（端口 3000，需本地 env；无后端时右栏仍以空 store 渲染空态）。
用 Playwright 打开 `http://localhost:3000`，切换 dark 主题（`localStorage` 写 `taluna-v4` 的 `theme:"dark"` 或页面切换），截右栏空态。
逐项比对 Figma 节点 1527-40709 截图：① 根底 `#171717` ② 舞台 `#202020` ③ 4 条分隔线 `#494949` 清晰可见 ④ 空提示语 `#7b7b7b` 居中限宽 ⑤ tab 仅图标、激活 pill `#494949` ⑥ 右侧 2 个无边框图标按钮 `#202020`、16px 图标 ⑦ 分享按钮 forward 镜像箭头。
若 dev 因无后端无法进入工作台，则降级为：按 spec §5 逐项 code-review 确认 className 值无误（自动化门禁已覆盖行为）。

- [ ] **Step 3: 核对其它面板未被全局令牌改动破坏**

人工/截图核对 Chat、Canvas、有版本态：面更扁平更深符合设计稿语汇，无对比度异常、无不可见文字/控件。

- [ ] **Step 4: 清理临时图标导出目录（主仓，非 worktree）**

```bash
rm -rf /Users/nickhopps/Documents/taluna/game-create-platform/.figma-tmp
```

- [ ] **Step 5: 确认 worktree 状态干净**

Run: `git status --short`
Expected: 无未提交改动（所有任务已分别提交）。

---

## Self-Review

**1. Spec coverage（逐条核对 spec → 任务）：**
- §4 全局令牌（canvas/surface/surface-2/fill/pop） → Task 1 ✓
- §5.1 根容器 bg-canvas / border-l line-strong → Task 3 Step 1 ✓
- §5.2 账户条分隔线 + 分享按钮 forward/ghost/rounded-8/px-4 py-2 + credit 字距 → Task 3 Step 2/6 ✓（头像边框按 §6 偏差保留）
- §5.3 tab 行间距/分隔线、tab 容器 surface、激活 line-strong、仅图标+Tooltip、下载刷新 surface/rounded-10/16px、不加 Tap → Task 3 Step 3/4 + Task 4 ✓
- §5.4 舞台 surface + 提示语 muted + 限宽 206 + 分隔线 → Task 3 Step 5 + Task 5 ✓（分隔线策略见 File Structure 说明）
- §5.5 Versions 头部 px-3 + border-b → Task 5 ✓（Compare 现状保留）
- §7 新增 forward.svg + 登记 → Task 2 ✓
- §8 验收（tsc/lint/test/build + 目视 + light 不受影响 + 防白闪无需改） → Task 6 ✓
- 新增 `forward` 图标的 ICON_TONE：未入表 → 默认 `primary`，符合 §7「随 currentColor 翻转」。

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整 before/after 代码与确切命令。✓

**3. Type consistency:** `figAsset.forward`（Task 2 定义 → Task 3 引用）一致；`--color-line-strong`/`--color-surface`/`--color-canvas` 令牌名跨任务一致；测试可及名 `Preview`/`Files`/`Share`/`Download ZIP`/`Refresh preview` 与现有用例一致。✓
