# 入口页（Landing / StudioPage）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 1:1 还原 Figma 的纯前端入口着陆页（支持亮/暗主题），从入口页经 Next 路由进入现有工作台。

**Architecture:** App Router 双路由（`/`=入口页、`/studio`=工作台，Workspace 零改动）。入口页复用现有主题系统（`store.theme`+`useTheme`+`globals.css` 变量）随 `data-theme` 翻转。CTA 经 `next/navigation` router 跳转；prompt 走 store `composer.draft` 传参；Remix 带 `?project=<id>` 复用现有 URL 最高优先级加载；Play 原地弹本地 state 驱动的预览 modal。

**Tech Stack:** Next.js 16 App Router、React 19、Zustand、Tailwind v4、Vitest+jsdom、next/font。

**设计依据：** `docs/superpowers/specs/2026-06-15-landing-page-design.md`（暗稿 Figma `357:657`、亮稿 `357:2208`）。

---

## 文件结构

**新建：**
- `src/app/studio/page.tsx` — 工作台路由（渲染 `Workspace`）
- `src/app/fonts.ts` — Sekuya + IBM Plex Mono 字体加载
- `src/components/landing/games.ts` — 6 条硬编码 mock + `PopularGame` 类型
- `src/components/landing/LandingPage.tsx` — 壳：TopBar+居中列+背景光晕+持有 preview modal state
- `src/components/landing/LandingTopBar.tsx` — 字标+主题/帮助/余额/账户（`357:658`）
- `src/components/landing/HeroSection.tsx` — 标题+副标题+Open creation tool（`357:707`）
- `src/components/landing/PromptBox.tsx` — 输入框+⊕+Surprise me+Generate（`357:712`）
- `src/components/landing/PopularGames.tsx` — 标题+2×3 网格（`357:720`）
- `src/components/landing/GameCard.tsx` — 单卡+hover Remix（`357:723`）
- `src/components/landing/GamePreviewModal.tsx` — Play 预览 modal
- `src/components/landing/games.test.ts` — mock 数据测试
- `src/components/landing/LandingPage.test.tsx` — CTA 导航行为测试

**修改：**
- `src/app/page.tsx` — 改为渲染 `LandingPage`
- `src/app/layout.tsx` — 挂载字体 CSS 变量
- `src/app/globals.css` — 新增入口页卡片底色双值变量 + Sekuya 字体类
- `src/components/ui/figma.tsx` — 登记新图标到 `figAsset`

**资产重命名**（`public/figma/icons/` 下哈希名 → 语义名）：
| 哈希文件 | 目标 |
|---|---|
| `2700079d1ddba449e4b92de30bb95f107de46749.svg` | `wordmark.svg` |
| `6560c1716bf949b3ba452c9a53814f3b625461dc.svg` | `theme.svg`（太阳放射） |
| `15ebde9bafabcae0ea626ada014b0b05edfab33b.svg` | `help.svg`（圆圈问号） |
| `c4e8107180db0c923794fb976ff9b84270a84eb1.svg` | `coin.svg`（积分） |
| `8fe14e311d0b7e46a04dd4f79c5af1c415356632.png` | `public/games/game-thumb-1.png` |
| `b639d4f766c53b5f5b1b71f7a19acd99dd6aaf35.png` | `public/games/game-thumb-2.png` |
| `2a5d1db6688aee70550d2b3434342159b9ca2d24.png` | `public/games/landing-glow.png` |
| `69dc0d6baa80c5a7f171e7cd9d9d35e0ad653412.png` | `public/games/landing-footer-glow.png` |

复用现有：`plus.svg`、`repeat.svg`、`chevron-down.svg`（无需重命名）。

---

## Task 1: 资产重命名

**Files:**
- Rename in: `public/figma/icons/` 与新建 `public/games/`

- [ ] **Step 1: 重命名图标 + 移动图片到 public/games/**

```bash
cd /Users/nickhopps/Documents/taluna/game-create-platform/public/figma/icons
git mv 2700079d1ddba449e4b92de30bb95f107de46749.svg wordmark.svg
git mv 6560c1716bf949b3ba452c9a53814f3b625461dc.svg theme.svg
git mv 15ebde9bafabcae0ea626ada014b0b05edfab33b.svg help.svg
git mv c4e8107180db0c923794fb976ff9b84270a84eb1.svg coin.svg
mkdir -p ../../games
git mv 8fe14e311d0b7e46a04dd4f79c5af1c415356632.png ../../games/game-thumb-1.png
git mv b639d4f766c53b5f5b1b71f7a19acd99dd6aaf35.png ../../games/game-thumb-2.png
git mv 2a5d1db6688aee70550d2b3434342159b9ca2d24.png ../../games/landing-glow.png
git mv 69dc0d6baa80c5a7f171e7cd9d9d35e0ad653412.png ../../games/landing-footer-glow.png
```

注：`git mv` 失败（文件未被 git 跟踪）时改用普通 `mv`。剩余未用的哈希名 SVG（chevron/plus 已有同义文件）保持不动。

- [ ] **Step 2: 确认结果**

Run: `ls public/figma/icons/*.svg | grep -E 'wordmark|theme|help|coin' && ls public/games/`
Expected: 4 个语义名 SVG + 4 个 PNG 存在

- [ ] **Step 3: Commit**

```bash
git add -A public/
git commit -m "chore: 入口页 Figma 资产按节点语义重命名"
```

---

## Task 2: 字体加载

**Files:**
- Create: `src/app/fonts.ts`
- Modify: `src/app/layout.tsx`、`src/app/globals.css`

- [ ] **Step 1: 创建 fonts.ts**

Sekuya 字体文件暂未到位，先用 `next/font/google` 的 IBM Plex Mono；Sekuya 走 CSS 变量 + Inter fallback（文件到位后再切 `next/font/local`）。

```ts
// src/app/fonts.ts
import { IBM_Plex_Mono } from 'next/font/google';

// 等宽:余额数字「2,847」与账户「EN」
export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// Sekuya(字标/大标题/Popular games):商业字体,文件未到位前用 fallback。
// 文件到位后改为 next/font/local 加载 public/fonts/Sekuya-Regular.woff2,导出同名 variable。
```

- [ ] **Step 2: layout.tsx 挂载字体变量**

`src/app/layout.tsx` 把 `plexMono.variable` 加到 `<html className>`，并定义 `--font-sekuya` fallback。改动 `<html>` 那行：

```tsx
import { plexMono } from './fonts';
// ...
<html lang="en" className={`${inter.variable} ${plexMono.variable}`} suppressHydrationWarning>
```

- [ ] **Step 3: globals.css 定义 Sekuya fallback 类与变量**

在 `@theme` 后追加：

```css
/* Sekuya 字体(字标/大标题):商业字体文件到位前用 Inter 加粗 + 负字间距近似展示感 */
:root {
  --font-sekuya: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}
.font-display {
  font-family: var(--font-sekuya);
  font-weight: 700;
  letter-spacing: -0.025em;
}
```

- [ ] **Step 4: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add src/app/fonts.ts src/app/layout.tsx src/app/globals.css
git commit -m "feat: 入口页字体加载(IBM Plex Mono + Sekuya fallback)"
```

---

## Task 3: 路由迁移（工作台移到 /studio）

**Files:**
- Create: `src/app/studio/page.tsx`
- Modify: `src/app/page.tsx`（暂时占位,Task 9 改渲染 LandingPage）

- [ ] **Step 1: 创建 studio 路由**

```tsx
// src/app/studio/page.tsx
'use client';
import Workspace from '@/components/workspace/Workspace';
export default function StudioPage() { return <Workspace />; }
```

- [ ] **Step 2: 根路由暂时也渲染 Workspace（占位，Task 9 替换）**

`src/app/page.tsx` 保持现状不动（仍渲染 Workspace），待 LandingPage 完成后在 Task 9 替换。本步无改动，仅确认 `/studio` 可访问。

- [ ] **Step 3: 启动验证**

Run: `pnpm dev`，浏览器访问 `http://localhost:3000/studio`
Expected: 工作台正常渲染（与根路径一致）

- [ ] **Step 4: Commit**

```bash
git add src/app/studio/page.tsx
git commit -m "feat: 工作台新增 /studio 路由"
```

---

## Task 4: mock 数据（games.ts）

**Files:**
- Create: `src/components/landing/games.ts`
- Test: `src/components/landing/games.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/components/landing/games.test.ts
import { describe, it, expect } from 'vitest';
import { POPULAR_GAMES, SURPRISE_PROMPTS } from './games';

describe('POPULAR_GAMES', () => {
  it('恰好 6 条', () => {
    expect(POPULAR_GAMES).toHaveLength(6);
  });
  it('每条含必填字段', () => {
    for (const g of POPULAR_GAMES) {
      expect(g.id).toBeTruthy();
      expect(g.title).toBeTruthy();
      expect(g.author).toBeTruthy();
      expect(g.thumb).toMatch(/\/games\//);
      expect(g.previewUrl).toBeTruthy();
      expect(['Play', 'Remix']).toContain(g.ctaLabel);
    }
  });
  it('第一行 Play、第二行 Remix', () => {
    expect(POPULAR_GAMES.slice(0, 3).every((g) => g.ctaLabel === 'Play')).toBe(true);
    expect(POPULAR_GAMES.slice(3, 6).every((g) => g.ctaLabel === 'Remix')).toBe(true);
  });
  it('id 唯一', () => {
    expect(new Set(POPULAR_GAMES.map((g) => g.id)).size).toBe(6);
  });
});

describe('SURPRISE_PROMPTS', () => {
  it('至少 3 条非空点子', () => {
    expect(SURPRISE_PROMPTS.length).toBeGreaterThanOrEqual(3);
    expect(SURPRISE_PROMPTS.every((p) => p.trim().length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm exec vitest run src/components/landing/games.test.ts`
Expected: FAIL（`games` 模块不存在）

- [ ] **Step 3: 写实现**

```ts
// src/components/landing/games.ts
import { assetPath } from '@/lib/basePath';

export interface PopularGame {
  id: string;
  title: string;
  author: string;
  thumb: string;       // 缩略图(经 assetPath 补 basePath)
  previewUrl: string;  // Play 弹窗 iframe src(mock)
  projectId?: number;  // Remix 跳工作台带 ?project=<id>;无则不带参
  ctaLabel: 'Play' | 'Remix';
}

const THUMB_1 = assetPath('/games/game-thumb-1.png');
const THUMB_2 = assetPath('/games/game-thumb-2.png');

// 6 条硬编码 mock:第一行(Play)、第二行(Remix),与设计 357:730/357:752 对齐。
// previewUrl 暂用占位公开页;projectId 留空(mock 无真实项目),Remix 退化为不带参跳转。
export const POPULAR_GAMES: PopularGame[] = [
  { id: 'bullet-ballet', title: 'BULLET BALLET', author: '@talunagame team', thumb: THUMB_1, previewUrl: 'about:blank', ctaLabel: 'Play' },
  { id: 'trike-rotocol', title: 'TRIKE ROTOCOL', author: '@talunagame team', thumb: THUMB_2, previewUrl: 'about:blank', ctaLabel: 'Play' },
  { id: 'pixel-pals', title: 'PIXEL PALS', author: '@talunagame team', thumb: THUMB_1, previewUrl: 'about:blank', ctaLabel: 'Play' },
  { id: 'neon-drift', title: 'NEON DRIFT', author: '@talunagame team', thumb: THUMB_2, previewUrl: 'about:blank', ctaLabel: 'Remix' },
  { id: 'cyber-bloom', title: 'CYBER BLOOM', author: '@talunagame team', thumb: THUMB_1, previewUrl: 'about:blank', ctaLabel: 'Remix' },
  { id: 'echo-realm', title: 'ECHO REALM', author: '@talunagame team', thumb: THUMB_2, previewUrl: 'about:blank', ctaLabel: 'Remix' },
];

// Surprise me 随机点子池
export const SURPRISE_PROMPTS: string[] = [
  'A cozy farming sim where crops sing when harvested',
  'A neon cyberpunk runner dodging holographic traffic',
  'A puzzle platformer where gravity flips on every jump',
  'A roguelike dungeon built from your typed words',
  'A peaceful fishing game on a floating sky island',
];
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm exec vitest run src/components/landing/games.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add src/components/landing/games.ts src/components/landing/games.test.ts
git commit -m "feat: 入口页 Popular Games mock 数据 + Surprise 点子池"
```

---

## Task 5: globals.css 入口页卡片底色变量

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 追加双值语义变量**

入口页卡片两行底色在现有变量无对应项,新增 `[data-theme]` 双值变量。在 `:root` 块追加亮色值、`[data-theme="dark"]` 块追加暗色值：

```css
/* :root 块内(亮稿:卡片浅灰二级面) */
--color-card-1: #e6e6e6;
--color-card-2: #ececec;
```

```css
/* [data-theme="dark"] 块内(暗稿 357:723/357:746) */
--color-card-1: #2c2c2c;
--color-card-2: #1e1e1e;
```

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: 入口页卡片底色双主题变量"
```

---

## Task 6: HeroSection 组件

**Files:**
- Create: `src/components/landing/HeroSection.tsx`

设计依据 `357:707`：标题 42px/行高47px/字间距-1.05px，副标题 15px/行高25.5px，段间距 24px，顶部 padding 36px。主 CTA「Open creation tool」青渐变 pill（`#1fd4cf→#033744`，边框 `#01f1ff`）。

- [ ] **Step 1: 写组件**

```tsx
// src/components/landing/HeroSection.tsx
'use client';

// Hero(357:707):大标题 + 副标题 + 主 CTA。主 CTA 青渐变恒定(跨主题不变)。
export default function HeroSection({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 pt-9 pb-16">
      <h1 className="font-display max-w-[640px] text-center text-[42px] leading-[47px] tracking-[-1.05px] text-[var(--color-ink)]">
        Create any game you can imagine
      </h1>
      <p className="max-w-[620px] text-center text-[15px] leading-[25.5px] text-[var(--color-muted)]">
        Start with a single sentence. AI Agents generate assets, write code, and produce a playable version—in hours, not weeks.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="relative flex h-9 items-center justify-center overflow-hidden rounded-full px-5 text-[14px] font-semibold tracking-[-0.28px] text-[#fcfcfc] transition hover:brightness-110"
        style={{
          background: 'linear-gradient(to left, #033744, #1fd4cf)',
          boxShadow: '0 2px 4px -1px rgba(13,13,13,0.5), 0 0 0 1px #344054, inset 0 0.5px 1px 0 rgba(255,255,255,0.15), inset 0 -1px 1.2px 0.35px rgba(20,184,166,0.5)',
        }}
      >
        Open creation tool
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 截图核对（实现 LandingPage 后统一做）**

标记待办：Task 9 接好后用 `get_screenshot` 取 `357:707` 与本地 Hero 区块比对（亮/暗各一遍）。

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/HeroSection.tsx
git commit -m "feat: 入口页 Hero 区块(标题+副标题+主CTA)"
```

---

## Task 7: PromptBox 组件

**Files:**
- Create: `src/components/landing/PromptBox.tsx`

设计依据 `357:712`：边框 `#01f1ff`，圆角 24px，外发光 `rgba(12,136,122,0.3)`；上 padding 16px、行间距 31px；占位「Describe your game ideas, we make it a reality…」。左下 ⊕ + Surprise me（`repeat` 图标）；右下 Generate my game（青渐变，空草稿 `opacity-30` disabled）。

- [ ] **Step 1: 写组件**

```tsx
// src/components/landing/PromptBox.tsx
'use client';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { SURPRISE_PROMPTS } from './games';

// PromptBox(357:712):输入框 + ⊕ + Surprise me + Generate my game。
// draft 写入 store.composer(持久化),Generate 跳工作台后由现有 Composer 读到。
export default function PromptBox({ onGenerate }: { onGenerate: () => void }) {
  const draft = useStore((s) => s.composer.draft);
  const composerSet = useStore((s) => s.composerSet);
  const canGenerate = draft.trim().length > 0;

  // Surprise me:取一条随机点子填入(用长度取模避免依赖 Math.random 的可测性差异由调用方决定)
  const surprise = () => {
    const i = Math.floor(Math.random() * SURPRISE_PROMPTS.length);
    composerSet({ draft: SURPRISE_PROMPTS[i] });
  };

  return (
    <div
      className="w-full rounded-3xl border border-[#01f1ff] bg-[var(--color-surface)] pt-4"
      style={{ boxShadow: '0 4px 19px 0 rgba(12,136,122,0.3)' }}
    >
      <div className="flex items-center px-3">
        <textarea
          value={draft}
          onChange={(e) => composerSet({ draft: e.target.value })}
          rows={1}
          placeholder="Describe your game ideas, we make it a reality…"
          className="w-full resize-none bg-transparent text-[15px] leading-[25.5px] text-[var(--color-ink)] placeholder:text-[var(--color-muted)] outline-none"
        />
      </div>
      <div className="mt-[31px] flex items-start justify-between p-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Add" className="flex size-10 items-center justify-center rounded-full bg-[var(--color-fill)]">
            <FigIcon src={figAsset.plus} size={20} />
          </button>
          <button
            type="button"
            onClick={surprise}
            className="flex h-10 items-center gap-2 rounded-full bg-[var(--color-fill)] px-5 text-[12px] font-semibold tracking-[-0.12px] text-[var(--color-ink)]"
          >
            Surprise me
            <FigIcon src={figAsset.repeat} size={16} />
          </button>
        </div>
        <button
          type="button"
          disabled={!canGenerate}
          onClick={onGenerate}
          className="relative flex h-9 items-center justify-center overflow-hidden rounded-full px-5 text-[14px] font-semibold tracking-[-0.28px] text-[#fcfcfc] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
          style={{
            background: 'linear-gradient(to left, #033744, #1fd4cf)',
            boxShadow: '0 2px 4px -1px rgba(13,13,13,0.5), 0 0 0 1px #344054, inset 0 0.5px 1px 0 rgba(255,255,255,0.15), inset 0 -1px 1.2px 0.35px rgba(20,184,166,0.5)',
          }}
        >
          Generate my game
        </button>
      </div>
    </div>
  );
}
```

注：`figAsset.plus`/`figAsset.repeat` 在现有 `figma.tsx` 已存在，直接可用，本 Task 无新增图标依赖。（Task 9 的 LandingTopBar 需要新增的 `theme`/`help`/`coin`，见 Task 11——务必在 Task 9 之前完成。）

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/PromptBox.tsx
git commit -m "feat: 入口页 PromptBox(输入框+Surprise me+Generate)"
```

---

## Task 8: GameCard + GamePreviewModal

**Files:**
- Create: `src/components/landing/GameCard.tsx`、`src/components/landing/GamePreviewModal.tsx`

设计依据卡片 `357:723`：底 `--color-card-1/2`，圆角 16px，缩略图 324×215 圆角16，卡片内 padding 上4/下8/左右4。hover(`357:725`)：缩略图叠 `rgba(0,0,0,0.5)` + 居中浮现青渐变 Remix。footer：标题(`#f5f5f5` 粗体) + 作者 + Play/Remix 按钮。Play=raised 浅灰、Remix=青渐变(边框`#40c4aa`)。

- [ ] **Step 1: 写 GameCard**

```tsx
// src/components/landing/GameCard.tsx
'use client';
import type { PopularGame } from './games';

const CYAN_GRAD = 'linear-gradient(to right, #1fd4cf, #033744)';

// 卡片(357:723):缩略图 + hover 浮现 Remix + footer(标题/作者 + CTA)。
// row 决定底色变量(第一行 card-1、第二行 card-2)。onPlay 原地预览,onRemix 跳工作台。
export default function GameCard({
  game, row, onPlay, onRemix,
}: { game: PopularGame; row: 0 | 1; onPlay: () => void; onRemix: () => void }) {
  const bg = row === 0 ? 'var(--color-card-1)' : 'var(--color-card-2)';
  return (
    <div className="group flex flex-col gap-2 rounded-2xl pt-1 pb-2 px-1" style={{ background: bg }}>
      {/* 缩略图 + hover 浮层 */}
      <div className="relative flex h-[215px] w-[324px] items-center justify-center overflow-hidden rounded-2xl">
        <img src={game.thumb} alt={game.title} className="absolute inset-0 size-full object-cover" draggable={false} />
        <div className="absolute inset-0 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100" />
        <button
          type="button"
          onClick={onRemix}
          className="relative flex items-center justify-center rounded-xl border border-[#40c4aa] px-4 py-2.5 text-[14px] font-semibold tracking-[-0.28px] text-[#f3f3f3] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: CYAN_GRAD }}
        >
          Remix
        </button>
      </div>
      {/* footer */}
      <div className="flex items-start justify-between px-2">
        <div className="flex min-w-0 flex-col text-[14px] leading-[1.5]">
          <span className="truncate font-bold text-[#f5f5f5]">{game.title}</span>
          <span className="truncate text-[var(--color-muted)]">{game.author}</span>
        </div>
        {game.ctaLabel === 'Play' ? (
          <button
            type="button"
            onClick={onPlay}
            className="btn-raised flex items-center justify-center rounded-xl px-4 py-2.5 text-[14px] font-semibold tracking-[-0.28px]"
          >
            Play
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemix}
            className="flex items-center justify-center rounded-xl border border-[#40c4aa] px-4 py-2.5 text-[14px] font-semibold tracking-[-0.28px] text-[#f3f3f3]"
            style={{ background: CYAN_GRAD }}
          >
            Remix
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 GamePreviewModal**

沿用 `MediaLightbox` 交互(bg-black/75、右上关闭、Esc 关闭、点遮罩关闭、内容 stopPropagation)。

```tsx
// src/components/landing/GamePreviewModal.tsx
'use client';
import { useEffect } from 'react';
import type { PopularGame } from './games';

// Play 原地预览(本地 state 驱动,独立于工作台 store)。沿用 MediaLightbox 交互约定。
export default function GamePreviewModal({ game, onClose }: { game: PopularGame | null; onClose: () => void }) {
  useEffect(() => {
    if (!game) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [game, onClose]);

  if (!game) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-8" role="dialog" aria-modal="true" aria-label={game.title} onClick={onClose}>
      <button
        type="button" onClick={onClose} aria-label="Close"
        className="absolute right-5 top-5 z-10 grid size-10 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
      <iframe
        src={game.previewUrl}
        title={game.title}
        sandbox="allow-scripts allow-same-origin"
        onClick={(e) => e.stopPropagation()}
        className="aspect-[282/519] h-[85%] max-w-[90%] rounded-lg bg-black shadow-2xl"
      />
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/components/landing/GameCard.tsx src/components/landing/GamePreviewModal.tsx
git commit -m "feat: 入口页 GameCard(hover Remix) + Play 预览 modal"
```

---

## Task 9: PopularGames + LandingTopBar + LandingPage 组装

**Files:**
- Create: `src/components/landing/PopularGames.tsx`、`LandingTopBar.tsx`、`LandingPage.tsx`
- Modify: `src/app/page.tsx`

设计：内容列宽 920px 居中、TopBar 高 56px、背景青色光晕装饰层。导航用 `next/navigation` 的 `useRouter`，Remix 用 `withProjectParam` 拼 `?project`。

- [ ] **Step 1: 写 PopularGames（网格）**

```tsx
// src/components/landing/PopularGames.tsx
'use client';
import type { PopularGame } from './games';
import { POPULAR_GAMES } from './games';
import GameCard from './GameCard';

// Popular games(357:720):标题 + 2×3 网格(列距16/行距24)。
export default function PopularGames({
  onPlay, onRemix,
}: { onPlay: (g: PopularGame) => void; onRemix: (g: PopularGame) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-[15px] text-white">Popular games</h2>
      <div className="flex flex-col gap-6">
        {[0, 1].map((row) => (
          <div key={row} className="flex gap-4">
            {POPULAR_GAMES.slice(row * 3, row * 3 + 3).map((g) => (
              <GameCard key={g.id} game={g} row={row as 0 | 1} onPlay={() => onPlay(g)} onRemix={() => onRemix(g)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写 LandingTopBar**

```tsx
// src/components/landing/LandingTopBar.tsx
'use client';
import { useStore } from '@/store';
import { assetPath } from '@/lib/basePath';
import { figAsset, FigIcon } from '@/components/ui/figma';

// TopBar(357:658):字标(青色 original) + 主题切换 + 帮助 + 余额 chip + 账户 EN。
// 主题/帮助图标走 FigIcon 主题翻转;字标青色不翻转。余额/积分为占位静态。
export default function LandingTopBar() {
  const toggleTheme = useStore((s) => s.toggleTheme);
  return (
    <div className="flex h-14 items-center gap-1.5 pl-6 pr-5">
      <img src={assetPath('/figma/icons/wordmark.svg')} alt="taluna" className="h-4" draggable={false} />
      <span className="font-display text-[16px] tracking-[-1.05px] text-[var(--color-ink)]">game STudio</span>
      <div className="flex-1" />
      <button type="button" aria-label="切换主题" onClick={toggleTheme} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-fill)]">
        <FigIcon src={figAsset.theme} size={16} tone="secondary" />
      </button>
      <button type="button" aria-label="帮助" className="grid size-8 place-items-center rounded-lg hover:bg-[var(--color-fill)]">
        <FigIcon src={figAsset.help} size={16} tone="secondary" />
      </button>
      <div className="flex items-center gap-[7px] rounded-full border border-white/[0.07] bg-[#494949] py-[7px] pl-3 pr-3.5">
        <FigIcon src={figAsset.coin} size={14} tone="original" />
        <span className="font-mono text-[13px] font-bold tracking-[-0.13px] text-[#14b8a6]">2,847</span>
        <span className="font-mono text-[10.5px] text-[#f3f3f3]">积分</span>
      </div>
      <div className="flex items-center gap-[7px] rounded-full py-1 pl-1 pr-2">
        <span className="grid size-[30px] place-items-center rounded-[15px] border border-white/[0.07] bg-[#494949] font-mono text-[11px] text-[#b3b3b3]">EN</span>
        <FigIcon src={figAsset.chevronDown} size={12} tone="secondary" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 写 LandingPage（组装 + 导航）**

```tsx
// src/components/landing/LandingPage.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';
import { assetPath } from '@/lib/basePath';
import { withProjectParam } from '@/lib/project-url';
import type { PopularGame } from './games';
import LandingTopBar from './LandingTopBar';
import HeroSection from './HeroSection';
import PromptBox from './PromptBox';
import PopularGames from './PopularGames';
import GamePreviewModal from './GamePreviewModal';

// 入口页壳(357:657):TopBar + 居中 920px 列(Hero/Prompt/PopularGames) + 背景光晕。
export default function LandingPage() {
  const router = useRouter();
  const draft = useStore((s) => s.composer.draft);
  const [preview, setPreview] = useState<PopularGame | null>(null);

  // Remix:带 projectId 跳工作台(复用 URL ?project 最高优先级);无 id 则不带参。
  const remix = (g: PopularGame) =>
    router.push('/studio' + (g.projectId != null ? withProjectParam('', g.projectId) : ''));

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--color-canvas)]">
      <LandingTopBar />
      {/* 背景青色光晕装饰层(357:703):pointer-events-none,垫在内容下 */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[420px] z-0 flex justify-center">
        <img src={assetPath('/games/landing-glow.png')} alt="" className="w-[1240px] max-w-none opacity-50" />
      </div>
      <div className="relative z-10 mx-auto w-[920px] max-w-full px-6 pb-24">
        <HeroSection onOpen={() => router.push('/studio')} />
        <PromptBox onGenerate={() => router.push('/studio')} />
        <div className="mt-12">
          <PopularGames onPlay={setPreview} onRemix={remix} />
        </div>
      </div>
      <GamePreviewModal game={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
```

注：`draft` 已由 PromptBox 写入 store,Generate 直接 `push('/studio')`,工作台 Composer 自动读到草稿,故此处无需再 `composerSet`。

- [ ] **Step 4: 替换 page.tsx**

```tsx
// src/app/page.tsx
'use client';
import LandingPage from '@/components/landing/LandingPage';
export default function Page() { return <LandingPage />; }
```

- [ ] **Step 5: 类型检查 + lint + 构建**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 双路由 `/`、`/studio` 正常产出,无错误

- [ ] **Step 6: 截图核对（亮/暗各一遍）**

`pnpm dev` 后用 `get_screenshot` 取 `357:657`(暗)、`357:2208`(亮),与本地 `/` 渲染逐块比对：TopBar、Hero、PromptBox、卡片网格、背景光晕。偏差就地修正。

- [ ] **Step 7: Commit**

```bash
git add src/components/landing/ src/app/page.tsx
git commit -m "feat: 入口页组装(TopBar+Hero+Prompt+PopularGames+光晕)并替换根路由"
```

---

## Task 10: CTA 导航行为测试

**Files:**
- Test: `src/components/landing/LandingPage.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
// src/components/landing/LandingPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LandingPage from './LandingPage';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
});

describe('LandingPage CTA', () => {
  it('Open creation tool 跳 /studio', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getByText('Open creation tool'));
    expect(push).toHaveBeenCalledWith('/studio');
  });

  it('Generate 在有草稿时跳 /studio', () => {
    render(<LandingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Describe your game/), { target: { value: 'a fun game' } });
    fireEvent.click(screen.getByText('Generate my game'));
    expect(push).toHaveBeenCalledWith('/studio');
  });

  it('Play 打开预览 modal,不跳转', () => {
    render(<LandingPage />);
    // 第一行第一张为 Play
    fireEvent.click(screen.getAllByText('Play')[0]);
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Remix(无 projectId)跳 /studio 不带参', () => {
    render(<LandingPage />);
    fireEvent.click(screen.getAllByText('Remix')[0]);
    expect(push).toHaveBeenCalledWith('/studio');
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `pnpm exec vitest run src/components/landing/LandingPage.test.tsx`
Expected: PASS（4 用例）。若 Play 因 mock 缩略图 `about:blank` iframe 报错,在测试里 stub 不影响断言。

- [ ] **Step 3: Commit**

```bash
git add src/components/landing/LandingPage.test.tsx
git commit -m "test: 入口页 CTA 导航行为(Open/Generate/Play/Remix)"
```

---

## Task 11: figma.tsx 登记新图标（⚠️ 前置：须在 Task 7 之前执行）

**Files:**
- Modify: `src/components/ui/figma.tsx`

> **执行顺序：** 本 Task 虽编号 11，但 Task 7（PromptBox 引用 `figAsset.plus/repeat`，已存在）与 Task 9（LandingTopBar 引用 `figAsset.theme/help/coin/chevronDown`，后三者需新增）依赖它。**请在 Task 6 完成后、Task 7 之前先做本 Task**，否则 `tsc` 会在 Task 9 报 `figAsset.theme` 不存在。资产文件由 Task 1 已重命名就位。

- [ ] **Step 1: 在 figAsset 追加新图标**

`src/components/ui/figma.tsx` 的 `figAsset` 对象内追加：

```ts
  wordmark: `${F}/wordmark.svg`,
  theme: `${F}/theme.svg`,
  help: `${F}/help.svg`,
  coin: `${F}/coin.svg`,
```

并在 `ICON_TONE` 表登记 `theme`/`help` 为 `secondary`、`coin` 为 `original`：

```ts
  [figAsset.theme]: 'secondary',
  [figAsset.help]: 'secondary',
  [figAsset.coin]: 'original',
```

注：此 Task 实际是 Task 7/9 的前置依赖（组件引用了 `figAsset.theme` 等）。执行顺序上应在编写引用这些图标的组件**之前**完成，或与之同批提交。

- [ ] **Step 2: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/figma.tsx
git commit -m "feat: figAsset 登记入口页图标(wordmark/theme/help/coin)"
```

---

## Task 12: 收尾验证

- [ ] **Step 1: 全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 全绿

- [ ] **Step 2: 双主题人工核对**

`pnpm dev`,在 `/` 点主题切换按钮,确认亮/暗两态都与对应 Figma 稿一致；逐一点击 CTA：Open/Generate 进工作台、Play 弹预览、Remix 进工作台。

- [ ] **Step 3: 提示用户放置 Sekuya 字体**

告知 Nick：把 `Sekuya-Regular.woff2` 放入 `public/fonts/` 后，将 `fonts.ts` 改用 `next/font/local` 加载并导出 `--font-sekuya`，字标/大标题即切换为真实字体（当前为 Inter fallback）。

---

## Self-Review 覆盖检查

- 路由(spec §2)→ Task 3/9 ✓
- CTA 行为(spec §2)→ Task 6/7/9/10 ✓
- prompt 传参 store.composer(spec §2)→ Task 7 ✓
- Remix 带 projectId(spec §2)→ Task 9 ✓
- Play 预览 modal(spec §2)→ Task 8 ✓
- 主题翻转/卡片变量(spec §3)→ Task 5/9 ✓
- 背景光晕(spec §3)→ Task 1/9 ✓
- 组件拆分(spec §4)→ Task 6/7/8/9 ✓
- 字体(spec §5)→ Task 2/12 ✓
- 图标重命名+登记(spec §6)→ Task 1/11 ✓
- 验证(spec §7)→ Task 9/10/12 ✓
