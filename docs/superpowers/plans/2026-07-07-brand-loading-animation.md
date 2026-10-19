# 品牌化加载动画实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一升级 `LoadingScreen`：默认档换品牌青轨道环 spinner，新增 `variant="brand"` 全屏品牌动效（logo 弹入 + Taluna 字标逐字浮现 + 循环扫光/呼吸），仅 Workspace 启动加载启用 brand 档。

**Architecture:** 单组件双形态——`LoadingScreen` 新增可选 prop `variant?: 'brand' | 'spinner'`（默认 `spinner`）。所有新 keyframes 集中进 `src/app/globals.css` 并补进 `prefers-reduced-motion` 禁用列表。调用方仅 `Workspace.tsx` 一行加参数，其余三处（PreviewPanel 链路的 GameFrame / CompareView）零改动。

**Tech Stack:** React 19 + Tailwind（CSS 变量令牌）+ Vitest/jsdom + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-07-07-brand-loading-animation-design.md`

## Global Constraints

- 颜色只用 CSS 变量：`--color-teal` / `--color-teal-soft` / `--color-ink` / `--color-muted`，禁止字面色值；组件不写主题分支。
- 缓动统一 `cubic-bezier(0.22, 1, 0.36, 1)`；所有新 keyframes 必须加入 `globals.css` 末尾 `@media (prefers-reduced-motion: reduce)` 禁用列表。
- `LoadingScreen` 外层容器**不加 `relative`**（定位由调用方 className 提供，加了会覆盖 fixed/absolute 导致全屏层塌陷——见现有组件注释）。
- Sekuya 字标用 `.font-display`，weight 400，不可合成加粗。
- logo 用 `FigIcon`（`figAsset.logo`，tone 自动解析为 `original`），动画 transform 加在外层 wrapper 上（`original` 档 `<img>` 自身 style 里有 width/height，避免 transform 冲突）。
- 注释 / commit message 用中文；测试与源码同目录。

---

### Task 1: 默认档 spinner 升级为品牌青轨道环 + 组件测试基线

**Files:**
- Create: `src/components/ui/LoadingScreen.test.tsx`
- Modify: `src/components/ui/LoadingScreen.tsx`

**Interfaces:**
- Produces: `LoadingScreen` props 不变（`label?` / `className?` / `closing?`），spinner 视觉改为青色弧线 + 淡青底环；`role="status"` 与 `aria-label` 语义保持。

- [ ] **Step 1: 写失败测试（基线 + 青色环）**

```tsx
// src/components/ui/LoadingScreen.test.tsx
import { render, screen } from '@testing-library/react';
import LoadingScreen from './LoadingScreen';

describe('LoadingScreen 默认档(spinner)', () => {
  it('渲染 role=status 的 spinner,label 同时用于文案与 aria-label', () => {
    render(<LoadingScreen label="Loading workspace" />);
    const spinner = screen.getByRole('status');
    expect(spinner.getAttribute('aria-label')).toBe('Loading workspace');
    expect(screen.getByText('Loading workspace')).toBeTruthy();
  });

  it('spinner 用品牌青轨道环(--color-teal 弧线 + teal-soft 底环)', () => {
    render(<LoadingScreen />);
    const spinner = screen.getByRole('status');
    expect(spinner.className).toContain('border-[var(--color-teal-soft)]');
    expect(spinner.className).toContain('border-t-[var(--color-teal)]');
  });

  it('closing=true 播放淡出动画类', () => {
    const { container } = render(<LoadingScreen closing />);
    expect((container.firstChild as HTMLElement).className).toContain('anim-fade-out');
  });

  it('默认档不渲染品牌字标', () => {
    render(<LoadingScreen />);
    expect(screen.queryByText('Taluna')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: FAIL——第 2 条用例失败（现有 spinner 是 `border-[var(--color-ink)]/15 border-t-[var(--color-ink)]/60`），其余 3 条应已通过。

- [ ] **Step 3: 改 spinner 配色**

`src/components/ui/LoadingScreen.tsx` 中 spinner 的 className 改为：

```tsx
        <span
          role="status"
          aria-label={label ?? "Loading"}
          className="size-7 animate-spin rounded-full border-2 border-[var(--color-teal-soft)] border-t-[var(--color-teal)]"
        />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: PASS（4 条）

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LoadingScreen.tsx src/components/ui/LoadingScreen.test.tsx
git commit -m "feat: LoadingScreen 默认 spinner 升级为品牌青轨道环 + 补组件测试基线"
```

---

### Task 2: brand 档结构（logo + 逐字字标 + 文案）

**Files:**
- Modify: `src/components/ui/LoadingScreen.tsx`
- Modify: `src/components/ui/LoadingScreen.test.tsx`

**Interfaces:**
- Consumes: `FigIcon` / `figAsset`（`src/components/ui/figma.tsx`），`figAsset.logo` tone 自动解析 `original`。
- Produces: `LoadingScreen` 新增 prop `variant?: 'brand' | 'spinner'`（默认 `'spinner'`）；brand 档 DOM：wrapper（class 含 `brand-float`）> `FigIcon(logo, size 48)`，字标 `<span aria-hidden>` 内 6 个 `<span class="brand-letter">`（`animationDelay` 逐字 +50ms），整词容器 class 含 `font-display` 与 `wordmark-sheen`；`role="status"` 移到 brand 容器上保持可访问性。

- [ ] **Step 1: 写失败测试**

在 `LoadingScreen.test.tsx` 追加：

```tsx
describe('LoadingScreen brand 档', () => {
  it('渲染 logo 图片与逐字字标 Taluna', () => {
    const { container } = render(<LoadingScreen variant="brand" label="Loading workspace" />);
    // logo:FigIcon original 档渲染 <img>
    expect(container.querySelector('img[src*="logo"]')).toBeTruthy();
    // 字标逐字拆分,拼起来是 Taluna
    const letters = Array.from(container.querySelectorAll('.brand-letter'));
    expect(letters.map((l) => l.textContent).join('')).toBe('Taluna');
    // 字标用展示字体 + 扫光循环类
    const wordmark = letters[0]!.parentElement!;
    expect(wordmark.className).toContain('font-display');
    expect(wordmark.className).toContain('wordmark-sheen');
    // label 文案与 role=status 仍在
    expect(screen.getByText('Loading workspace')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('brand 档不渲染默认转圈 spinner', () => {
    const { container } = render(<LoadingScreen variant="brand" />);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: FAIL——`variant` prop 不存在，brand 用例全挂。

- [ ] **Step 3: 实现 brand 档**

`src/components/ui/LoadingScreen.tsx` 整文件替换为：

```tsx
import { FigIcon, figAsset } from "@/components/ui/figma";

// 品牌字标逐字拆分:每字独立进场延迟(+50ms),整词容器负责 Sekuya 字体与循环扫光
const WORDMARK = "Taluna".split("");

// 全局加载动画:shimmer 底 + 可选文案;应用启动与预览加载共用,尺寸由 className 决定。
// variant='brand'(仅 Workspace 全屏启动):logo 弹入 + 字标逐字浮现 + 循环呼吸/扫光;
// 默认 'spinner'(预览/对比等小容器):品牌青轨道环,不引入字标。
// closing=true 时播放淡出(配合 useExitTransition 延时卸载);默认挂载淡入。
export default function LoadingScreen({
  label,
  className = "",
  closing = false,
  variant = "spinner",
}: {
  label?: string;
  className?: string;
  closing?: boolean;
  variant?: "brand" | "spinner";
}) {
  return (
    // 外层不加 relative:定位由调用方 className(fixed/absolute)提供;若加 relative,会因 Tailwind 中 .relative 排在 .fixed/.absolute 之后而覆盖它们,导致全屏层塌陷、loading 不显示
    <div className={`grid place-items-center ${closing ? "anim-fade-out" : "anim-media-in"} ${className}`}>
      <div className="skeleton-shimmer absolute inset-0 rounded-[inherit]" aria-hidden />
      {variant === "brand" ? (
        <div role="status" aria-label={label ?? "Loading"} className="relative flex flex-col items-center gap-4">
          {/* transform 动画加在 wrapper 上:FigIcon original 档 <img> 自带 style 尺寸,避免 transform 冲突 */}
          <div className="brand-logo-in brand-float">
            <FigIcon src={figAsset.logo} size={48} />
          </div>
          <span aria-hidden className="font-display wordmark-sheen text-[24px] leading-none text-[var(--color-ink)]">
            {WORDMARK.map((ch, i) => (
              <span key={i} className="brand-letter inline-block" style={{ animationDelay: `${i * 50}ms` }}>
                {ch}
              </span>
            ))}
          </span>
          {label && (
            <span className="text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">{label}</span>
          )}
        </div>
      ) : (
        <div className="relative flex flex-col items-center gap-2.5">
          <span
            role="status"
            aria-label={label ?? "Loading"}
            className="size-7 animate-spin rounded-full border-2 border-[var(--color-teal-soft)] border-t-[var(--color-teal)]"
          />
          {label && (
            <span className="text-[12px] font-medium tracking-[-0.12px] text-[var(--color-muted)]">{label}</span>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx`
Expected: PASS（6 条）

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/LoadingScreen.tsx src/components/ui/LoadingScreen.test.tsx
git commit -m "feat: LoadingScreen 新增 brand 档(logo + Taluna 逐字字标)"
```

---

### Task 3: globals.css 动效 + Workspace 接入 + 全量验证

**Files:**
- Modify: `src/app/globals.css`（`.lib-eq-bar` keyframes 之后、reduced-motion 禁用列表之前插入新段；并在禁用列表内追加新类）
- Modify: `src/components/workspace/Workspace.tsx:133`

**Interfaces:**
- Consumes: Task 2 产出的 class 名——`brand-logo-in` / `brand-float` / `brand-letter` / `wordmark-sheen`（名字必须逐字一致）。
- Produces: 无后续任务依赖。

- [ ] **Step 1: 在 `globals.css` 追加品牌加载动效**

插入位置：`.lib-eq-bar` 的 `@keyframes lib-eq` 段之后、`@media (prefers-reduced-motion: reduce)` 全局禁用列表之前：

```css
/* 品牌加载动画(LoadingScreen variant='brand'):logo 弹入→呼吸浮动+青色光晕,字标逐字浮现→循环扫光。
   进场缓动统一 cubic-bezier(0.22,1,0.36,1);颜色只用 --color-teal(-soft),深浅主题自动适配 */
.brand-logo-in { animation: brand-logo-in 400ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes brand-logo-in {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
/* 呼吸浮动与光晕同周期叠加:上下 3px 浮动 + teal-soft 柔光呼吸;进场结束后接管(延迟=进场时长) */
.brand-float { animation: brand-logo-in 400ms cubic-bezier(0.22, 1, 0.36, 1) both, brand-float 2.6s ease-in-out 400ms infinite; border-radius: 50%; }
@keyframes brand-float {
  0%, 100% { transform: translateY(0); box-shadow: 0 0 0 0 var(--color-teal-soft); }
  50% { transform: translateY(-3px); box-shadow: 0 0 24px 6px var(--color-teal-soft); }
}
.brand-letter { animation: brand-letter-in 350ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes brand-letter-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* 字标扫光:文字裁切渐变,高光带从左扫到右(background-position 驱动),承担"正在加载"感知 */
.wordmark-sheen {
  background: linear-gradient(100deg, var(--color-ink) 42%, var(--color-teal) 50%, var(--color-ink) 58%) 0 0 / 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: wordmark-sheen 2.2s ease-in-out 600ms infinite;
}
@keyframes wordmark-sheen {
  from { background-position: 125% 0; }
  to { background-position: -25% 0; }
}
```

注意：`.brand-float` 同一元素上合并了进场与循环两条 animation（进场 400ms `both` + 循环延迟 400ms 接管），Task 2 的 wrapper 上 `brand-logo-in brand-float` 两类并存时以 `.brand-float` 的合并声明为准（后定义覆盖）——两类都写是为了 reduced-motion 下逐类禁用后仍有语义。

- [ ] **Step 2: 补 reduced-motion 禁用**

在 `globals.css` 末尾全局 `@media (prefers-reduced-motion: reduce)` 块中追加（`.lib-eq-bar` 行后）：

```css
  .brand-logo-in,
  .brand-float,
  .brand-letter,
  .wordmark-sheen { animation: none; }
```

并给 `.wordmark-sheen` 的降级补静态回退（同一媒体查询块内）：

```css
  .wordmark-sheen {
    background: none;
    -webkit-text-fill-color: currentColor;
  }
```

- [ ] **Step 3: Workspace 接入 brand 档**

`src/components/workspace/Workspace.tsx:133` 改为：

```tsx
      {loader.mounted && <LoadingScreen variant="brand" className="fixed inset-0 z-50" label={t('workspace.loading')} closing={loader.closing} />}
```

- [ ] **Step 4: 全量验证**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 全部通过，无类型/由 md 文档引发的 Tailwind 构建问题。

Run: `pnpm build`
Expected: 构建成功（新 CSS 无非法 arbitrary class）。

- [ ] **Step 5: 运行态目检**

启动 dev（若 3000 被占用换端口），进入 workspace 观察：logo 弹入 → 字标逐字浮现 → 循环呼吸/扫光；加载结束淡出无闪烁；切深色主题字标颜色随 `--color-ink` 翻转、扫光仍为青色。预览面板内 loading 为青色轨道环。

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/components/workspace/Workspace.tsx
git commit -m "feat: 品牌加载动效 keyframes + Workspace 启用 brand 档"
```
