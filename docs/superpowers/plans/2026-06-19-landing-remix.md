# Landing Page Remix 恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Landing 游戏卡支持 Remix——经 `POST /api/remixes` 把公开游戏 fork 成当前用户的新项目，并在新标签页打开工作台编辑。

**Architecture:** Landing 侧本地 handler 调 `pgcApi.createRemix`（薄 PGC client）；为绕开「await 后 `window.open` 被弹窗拦截」，点击时同步抓空白标签句柄，resolve 后重定向到 `/studio?project=<新public_id>`，由工作台 `loadProjects` 自动选中 fork。错误完全复用既有 `guard` 约定（401→`authRequired`/`useAuthGuard`，其余 PgcError→Toast，非 PgcError 照抛）。GameCard 还原 Figma 的 hover 压暗 + 青渐变 Remix 浮层，footer 保留 Play 预览。

**Tech Stack:** Next.js 16 / React 19 / TypeScript、zustand store、Vitest + jsdom + Testing Library、Tailwind（CSS 变量令牌）。

**设计稿：** `docs/superpowers/specs/2026-06-19-landing-remix-design.md`

## Global Constraints

- 代码注释 / commit message 一律用**中文**；commit 一句话总结。
- 颜色走 CSS 变量 / 既有常量，**禁止硬编码色值**；Remix 青渐变复用 `src/components/landing/styles.ts` 的 `REMIX_GRAD`（`linear-gradient(to right, #1fd4cf, #033744)`）+ 边框 `#40c4aa` + 文字 `#f3f3f3`（跨主题恒定品牌色）。
- 动效复用现有 `transition` + `group-hover` 写法与既有 spinner，**禁止新增一次性 keyframes**；新动态须在 `prefers-reduced-motion: reduce` 下退化（本计划无新增 keyframes，沿用即可）。
- 图标走 `FigIcon`；按钮走既有 `.btn-raised`，**不自造按钮组件 / toast**（复用全局 `Toast`）。
- 自身绝对路径必经 `pagePath()`/`apiPath()`（部署 basePath `/game`）；`createRemix` 经 `pgcApi`（已带 `apiPath`）。
- 不吞未知错误：`try/catch` 只认 `PgcError`，其余 `throw`。
- `source_code` 取 `game.id`（public_id / play code，如 `DakkYXUy`）；`version_id`/`name` 省略，由后端取默认。
- 测试与源码同目录（`*.test.ts(x)`）。

---

### Task 1: PGC client 新增 createRemix + 类型

**Files:**
- Modify: `src/lib/pgc/types.ts`（在 §请求体类型区追加，约 `CreateProjectRequest`/`UpdateProjectRequest` 附近）
- Modify: `src/lib/pgc/client.ts:6`（import 追加新类型）、`src/lib/pgc/client.ts:79`（`pgcApi` 内追加方法）
- Test: `src/lib/pgc/client.test.ts`

**Interfaces:**
- Consumes: 既有 `ProjectData`（`types.ts:11`，含 `public_id: string`）、`pgc<T>()` 私有发请求函数、`PREFIX = apiPath('/api/pgc')`。
- Produces:
  - `interface CreateRemixRequest { source_code: string; version_id?: string | null; name?: string | null }`
  - `interface RemixProjectData { project: ProjectData; source_code: string; source_version_id: string; target_version_id: string; play_url: string; working_preview_url: string }`
  - `pgcApi.createRemix: (body: CreateRemixRequest) => Promise<RemixProjectData>` —— `POST` 上游 `/api/remixes`（fetch URL 实为 `/api/pgc/api/remixes`）。

- [ ] **Step 1: 写失败测试**

在 `src/lib/pgc/client.test.ts` 的 `describe('pgcApi 信封拆解', ...)` 内追加：

```ts
  test('createRemix POST /api/remixes 带 source_code,返回 data.project', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({
      success: true, code: 'OK', message: 'OK',
      data: {
        project: { id: 9, public_id: 'NEWcode', name: 'X remix', cover_url: null, cover_source: null, current_version_id: 'v1', status: 'draft', created_at: '', updated_at: '' },
        source_code: 'DakkYXUy', source_version_id: 'v5', target_version_id: 'v1',
        play_url: 'https://x/play/NEWcode', working_preview_url: 'https://x/pv/NEWcode/v1/dist/index.html',
      },
    }));
    const d = await pgcApi.createRemix({ source_code: 'DakkYXUy' });
    expect(d.project.public_id).toBe('NEWcode');
    expect(f).toHaveBeenCalledWith('/api/pgc/api/remixes', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source_code: 'DakkYXUy' }),
    }));
  });

  test('createRemix 源未开放时抛 PgcError(REMIX_NOT_AVAILABLE)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'REMIX_NOT_AVAILABLE', message: '未开放', data: null }, true, 200),
    );
    await expect(pgcApi.createRemix({ source_code: 'x' })).rejects.toMatchObject({ code: 'REMIX_NOT_AVAILABLE' });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts -t createRemix`
Expected: FAIL —— `pgcApi.createRemix is not a function`。

- [ ] **Step 3: 加类型**

在 `src/lib/pgc/types.ts` 的请求体类型区（`UpdateProjectRequest` 之后）追加：

```ts
// Remix:基于公开源游戏 fork 一份当前用户的新可编辑项目(POST /api/remixes)
export interface CreateRemixRequest { source_code: string; version_id?: string | null; name?: string | null; }
export interface RemixProjectData {
  project: ProjectData;        // 新 fork 项目,寻址用 public_id
  source_code: string;
  source_version_id: string;
  target_version_id: string;
  play_url: string;
  working_preview_url: string;
}
```

- [ ] **Step 4: 加 client 方法**

`src/lib/pgc/client.ts` 第 6 行的类型 import 列表末尾追加 `CreateRemixRequest, RemixProjectData,`。

在 `pgcApi` 对象内（`// 项目` 段，`deleteProject` 之后）追加：

```ts
  // Remix:fork 公开源游戏成当前用户新项目(路径相对 PREFIX → 上游 /api/remixes)
  createRemix: (body: CreateRemixRequest) => pgc<RemixProjectData>('POST', '/api/remixes', body),
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS（含原有用例）。

- [ ] **Step 6: 提交**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: PGC client 新增 createRemix(POST /api/remixes)"
```

---

### Task 2: games.ts 移除死字段 ctaLabel

**Files:**
- Modify: `src/components/landing/games.ts`
- Test: `src/components/landing/games.test.ts`

**Interfaces:**
- Produces: `PopularGame` 不再含 `ctaLabel`，字段为 `{ id; title; author; thumb; previewUrl }`（`id` = public_id，兼作 `source_code` 与 React key）。

- [ ] **Step 1: 改测试（去掉 ctaLabel 断言）**

`src/components/landing/games.test.ts`：
- 删除「每条含必填字段」用例里的 `expect(['Play', 'Remix']).toContain(g.ctaLabel);` 这一行。
- 删除整个「均为 Play(Remix 暂停,后端未完成)」用例（第 20–22 行那段 `it(...)`）。
- 其余（恰好 3 条、必填字段其余项、id 唯一、SURPRISE_PROMPTS）保留。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/landing/games.test.ts`
Expected: 此步测试本身已不引用 ctaLabel；但 `games.ts` 仍有 `ctaLabel` 字段不影响测试通过——故本步主要确认改后测试仍 PASS（红灯来自下步类型/编译）。若 PASS 直接进 Step 3。

- [ ] **Step 3: 改 games.ts 删除 ctaLabel**

`src/components/landing/games.ts`：
- 接口删除 `ctaLabel: 'Play' | 'Remix';` 行。
- 三条 `POPULAR_GAMES` 各删除末尾 `, ctaLabel: 'Play'`。
- 注释更新：把「Remix 恢复时直接用 id」改为「id(public_id)兼作 Remix 的 source_code 与 React key」。

改后接口：

```ts
export interface PopularGame {
  id: string;          // public_id:React key + Remix 的 source_code(/play|/pv 同一 opaque 标识)
  title: string;
  author: string;
  thumb: string;       // 线上 cover_url 直链
  previewUrl: string;  // Play 弹窗 iframe src(线上 preview_url)
}
```

- [ ] **Step 4: 跑类型 + 测试确认通过**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components/landing/games.test.ts`
Expected: tsc 无错（确认无其它文件仍读 `ctaLabel`——当前 GameCard 仅注释引用，不报错）；测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/landing/games.ts src/components/landing/games.test.ts
git commit -m "refactor: landing 移除死字段 ctaLabel(三卡统一 hover Remix + footer Play)"
```

---

### Task 3: GameCard 还原 hover Remix 浮层 + footer Play + pending

**Files:**
- Modify: `src/components/landing/GameCard.tsx`（整体重写）
- Test: `src/components/landing/GameCard.test.tsx`（新建）

**Interfaces:**
- Consumes: `PopularGame`（Task 2，无 `ctaLabel`）、`REMIX_GRAD`（`src/components/landing/styles.ts`）。
- Produces: `GameCard` props = `{ game: PopularGame; onPlay: () => void; onRemix: () => void; remixing: boolean }`。
  - footer 含一个 `Play` 按钮（点击 `onPlay`）。
  - 缩略图区含一个 `Remix` 按钮（点击 `onRemix`）；`remixing` 为真时该按钮 `disabled` 且 `aria-busy="true"`。

- [ ] **Step 1: 写失败测试（新建 GameCard.test.tsx）**

`src/components/landing/GameCard.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameCard from './GameCard';
import type { PopularGame } from './games';

const game: PopularGame = { id: 'DakkYXUy', title: '猫咪模拟器3D', author: '@taluna-admin', thumb: 'https://x/c.png', previewUrl: 'https://x/p.html' };

describe('GameCard', () => {
  it('footer Play 与缩略图 Remix 按钮都在 DOM', () => {
    render(<GameCard game={game} onPlay={() => {}} onRemix={() => {}} remixing={false} />);
    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remix 猫咪模拟器3D/ })).toBeInTheDocument();
  });

  it('点 Play 调 onPlay,点 Remix 调 onRemix', () => {
    const onPlay = vi.fn(); const onRemix = vi.fn();
    render(<GameCard game={game} onPlay={onPlay} onRemix={onRemix} remixing={false} />);
    fireEvent.click(screen.getByText('Play'));
    fireEvent.click(screen.getByRole('button', { name: /Remix 猫咪模拟器3D/ }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onRemix).toHaveBeenCalledTimes(1);
  });

  it('remixing 时 Remix 按钮 disabled + aria-busy', () => {
    render(<GameCard game={game} onPlay={() => {}} onRemix={() => {}} remixing />);
    const btn = screen.getByRole('button', { name: /Remix 猫咪模拟器3D/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/landing/GameCard.test.tsx`
Expected: FAIL —— 当前 GameCard 无 Remix 按钮 / 无 `onRemix`/`remixing` props。

- [ ] **Step 3: 重写 GameCard**

`src/components/landing/GameCard.tsx` 整体替换为：

```tsx
// src/components/landing/GameCard.tsx
'use client';
import type { PopularGame } from './games';
import { REMIX_GRAD } from './styles';

// 卡片(357:723):缩略图(hover 压暗 + 居中青渐变 Remix 浮层) + footer(标题/作者 + Play)。
// 单横排,card-1 底色;flex-1 + min-w-0 让一排卡片均分行宽;缩略图按 324:215 自适应。
// Remix = fork 源游戏进工作台(onRemix);Play = 原地预览(onPlay)。remixing 时 Remix 转圈禁用。
export default function GameCard({
  game, onPlay, onRemix, remixing,
}: { game: PopularGame; onPlay: () => void; onRemix: () => void; remixing: boolean }) {
  return (
    // 卡片整体 hover:轻微上浮 + 暗投影叠青色辉光,300ms 顺滑过渡。
    <div
      className="group flex min-w-0 flex-1 flex-col gap-2 rounded-2xl pt-1 pb-2 px-1 transition-[transform,box-shadow] duration-300 ease-out motion-safe:hover:-translate-y-1 hover:shadow-[0_18px_34px_-18px_rgba(0,0,0,0.4),0_0_24px_-14px_rgba(31,212,207,0.45)]"
      style={{ background: 'var(--color-card-1)' }}
    >
      {/* 缩略图区:hover(或 remixing 进行中)压暗 + 居中浮现青渐变 Remix。
          图片 hover 轻微放大;压暗层与 Remix 按钮用 group-hover 控制透明度,remixing 时强制可见(不随鼠标移出消失)。 */}
      <div className="relative flex aspect-[324/215] w-full items-center justify-center overflow-hidden rounded-2xl">
        <img
          src={game.thumb}
          alt={game.title}
          draggable={false}
          className="absolute inset-0 size-full object-cover transition-transform duration-[450ms] ease-out motion-safe:group-hover:scale-[1.06]"
        />
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-black/45 transition-opacity duration-300 group-hover:opacity-100 ${remixing ? 'opacity-100' : 'opacity-0'}`}
        />
        <button
          type="button"
          onClick={onRemix}
          disabled={remixing}
          aria-busy={remixing}
          aria-label={`Remix ${game.title}`}
          className={`relative flex items-center justify-center gap-2 rounded-xl border border-[#40c4aa] px-4 py-2.5 text-[14px] font-semibold tracking-[-0.28px] text-[#f3f3f3] transition-opacity duration-300 ease-out group-hover:opacity-100 disabled:cursor-default ${remixing ? 'opacity-100' : 'opacity-0'}`}
          style={{ background: REMIX_GRAD }}
        >
          {remixing && (
            <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
          )}
          Remix
        </button>
      </div>
      {/* footer:标题/作者 + Play(原地预览)。Play 沿用 .btn-raised 物理触感。 */}
      <div className="flex items-start justify-between px-2">
        <div className="flex min-w-0 flex-col text-[14px] leading-[1.5]">
          <span className="truncate font-bold text-[var(--color-ink)]">{game.title}</span>
          <span className="truncate text-[var(--color-muted)]">{game.author}</span>
        </div>
        <button
          type="button"
          onClick={onPlay}
          className="btn-raised flex items-center justify-center rounded-xl px-4 py-2.5 text-[14px] font-semibold tracking-[-0.28px] transition-[transform,filter] duration-200 ease-out will-change-transform motion-safe:hover:-translate-y-0.5 active:translate-y-px active:scale-[0.97]"
        >
          Play
        </button>
      </div>
    </div>
  );
}
```

> 说明：`animate-spin` 是 Tailwind 内置（非一次性 keyframes），`prefers-reduced-motion` 下 Tailwind 默认仍转（spinner 是状态指示，可接受）；不新增自定义动画。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/landing/GameCard.test.tsx`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/components/landing/GameCard.tsx src/components/landing/GameCard.test.tsx
git commit -m "feat: GameCard 还原 hover 青渐变 Remix 浮层 + footer Play(含 remixing 转圈)"
```

---

### Task 4: PopularGames 透传 + LandingPage remix 流程 + Toast/鉴权

**Files:**
- Modify: `src/components/landing/PopularGames.tsx`
- Modify: `src/components/landing/LandingPage.tsx`
- Test: `src/components/landing/LandingPage.test.tsx`

**Interfaces:**
- Consumes: `pgcApi.createRemix`（Task 1）、`PgcError`（`@/lib/pgc/client`）、`GameCard` 的 `{ onRemix, remixing }`（Task 3）、`PopularGame`（Task 2）、`useStore`（`s.setError`）、`useAuthGuard`、`pagePath`、`withProjectParam`、全局 `Toast`。
- Produces:
  - `PopularGames` props = `{ onPlay: (g) => void; onRemix: (g) => void; remixingId: string | null }`。
  - `LandingPage` 的 `remix(game)` 异步 handler 与 `remixingId` 本地态。

- [ ] **Step 1: 写失败测试（改 LandingPage.test.tsx）**

`src/components/landing/LandingPage.test.tsx`：

1. 顶部 mock 数据去掉 `ctaLabel`，并补 mock `pgcApi.createRemix`：

```tsx
vi.mock('./games', () => ({
  POPULAR_GAMES: [
    { id: 'DakkYXUy', title: 'CAT SIM', author: '@t', thumb: 'https://x/a.png', previewUrl: 'about:blank' },
    { id: 'ikQGtsXv', title: 'LIBRARY', author: '@t', thumb: 'https://x/b.png', previewUrl: 'about:blank' },
  ],
  SURPRISE_PROMPTS: ['idea one'],
}));

const createRemix = vi.fn();
vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return { ...actual, pgcApi: { ...actual.pgcApi, createRemix: (...a: unknown[]) => createRemix(...a) } };
});
```

2. `beforeEach` 末尾追加：`createRemix.mockReset();` 并复位鉴权态 `useStore.setState({ authRequired: false, lastError: null });`

3. 把现有「Play 打开预览 modal」用例的取按钮方式确认仍可用（footer 仍有 `Play`，缩略图按钮是 `Remix`，互不冲突）。

4. 追加 Remix 用例（注意 mock 数据为模块级，需在 `vi.mock` 工厂里定义假句柄；这里用 `window.open` spy 返回假句柄）：

```tsx
describe('LandingPage Remix', () => {
  function fakeWin() { return { location: { href: '' }, close: vi.fn() } as unknown as Window; }

  it('Remix 成功:同步抓句柄 → createRemix → 句柄重定向到 /studio?project=<新id>', async () => {
    const win = fakeWin();
    open.mockReturnValue(win);
    createRemix.mockResolvedValue({ project: { public_id: 'NEWcode' } });
    render(<LandingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Remix / })[0]);
    expect(open).toHaveBeenCalledWith('', '_blank');          // 同步抓空白句柄
    expect(createRemix).toHaveBeenCalledWith({ source_code: 'DakkYXUy' });
    await screen.findByRole('button', { name: /^Remix / });    // 等微任务
    await vi.waitFor(() => expect((win as Window).location.href).toBe('/studio?project=NEWcode'));
  });

  it('句柄被拦(open 返回 null):当前页 location.assign 兜底', async () => {
    open.mockReturnValue(null);
    createRemix.mockResolvedValue({ project: { public_id: 'NEWcode' } });
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    render(<LandingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Remix / })[0]);
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/studio?project=NEWcode'));
  });

  it('非 401 PgcError:close 句柄 + 写 lastError(Toast)', async () => {
    const win = fakeWin();
    open.mockReturnValue(win);
    const { PgcError } = await import('@/lib/pgc/client');
    createRemix.mockRejectedValue(new PgcError('REMIX_NOT_AVAILABLE', '未开放', 200));
    render(<LandingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Remix / })[0]);
    await vi.waitFor(() => expect(useStore.getState().lastError?.code).toBe('REMIX_NOT_AVAILABLE'));
    expect((win as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
  });

  it('401 PgcError:置 authRequired(不写 lastError),交 useAuthGuard', async () => {
    open.mockReturnValue(fakeWin());
    const { PgcError } = await import('@/lib/pgc/client');
    createRemix.mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    render(<LandingPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Remix / })[0]);
    await vi.waitFor(() => expect(useStore.getState().authRequired).toBe(true));
    expect(useStore.getState().lastError).toBeNull();
  });
});
```

> 既有用例（Open/Generate 新页签、空草稿 disabled、主题 postMessage）保持不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/landing/LandingPage.test.tsx`
Expected: FAIL —— `LandingPage` 尚无 Remix 按钮 / handler，新用例红灯。

- [ ] **Step 3: 改 PopularGames 透传 onRemix + remixingId**

`src/components/landing/PopularGames.tsx` 整体替换为：

```tsx
// src/components/landing/PopularGames.tsx
'use client';
import type { PopularGame } from './games';
import { POPULAR_GAMES } from './games';
import GameCard from './GameCard';

// Popular games(357:720):标题 + 一横排 3 个(列距16,卡片 flex 均分行宽)。
// onPlay 原地预览;onRemix fork 进工作台;remixingId 标记哪张卡正在 Remix(转圈)。
export default function PopularGames({
  onPlay, onRemix, remixingId,
}: { onPlay: (g: PopularGame) => void; onRemix: (g: PopularGame) => void; remixingId: string | null }) {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="font-display text-[15px] text-[var(--color-ink)]">Popular games</h2>
      <div className="flex gap-4">
        {POPULAR_GAMES.slice(0, 3).map((g) => (
          <GameCard
            key={g.id}
            game={g}
            onPlay={() => onPlay(g)}
            onRemix={() => onRemix(g)}
            remixing={remixingId === g.id}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 改 LandingPage 加 remix handler + Toast + useAuthGuard**

`src/components/landing/LandingPage.tsx` 整体替换为：

```tsx
// src/components/landing/LandingPage.tsx
'use client';
import { useState } from 'react';
import { pagePath } from '@/lib/basePath';
import { withProjectParam } from '@/lib/project-url';
import { useHostConfig } from '@/client/useHostConfig';
import { useAuthGuard } from '@/client/useAuthGuard';
import { useStore } from '@/store';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import type { PopularGame } from './games';
import LandingGlow from './LandingGlow';
import HeroSection from './HeroSection';
import PromptBox from './PromptBox';
import PopularGames from './PopularGames';
import GamePreviewModal from './GamePreviewModal';
import Toast from '@/components/ui/Toast';

// 入口页壳(357:657):居中 920px 列(Hero/Prompt/PopularGames) + 背景光晕。
// TopBar 由主站提供(本应用为分站);主题由主站决定。
export default function LandingPage() {
  // 主题由主站决定:首屏靠防白闪脚本,运行期靠主站 postMessage 下发,故挂 useHostConfig 监听。
  useHostConfig();
  // 未登录(401)由 useAuthGuard 处理:生产跳 sign-in、本地清标志 + notice(与全局鉴权一致)。
  useAuthGuard();
  const [preview, setPreview] = useState<PopularGame | null>(null);
  // remixingId:正在 Remix 的卡 id,驱动该卡 Remix 按钮转圈;同时充当并发锁。
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const setError = useStore((s) => s.setError);

  // 主 CTA 在新页签打开工作台;window.open 写绝对路径不会被 Next 自动加 basePath,故经 pagePath。
  const openStudio = () => window.open(pagePath('/studio'), '_blank', 'noopener');

  // Remix:fork 源游戏成当前用户新项目,再新标签打开工作台。
  // createRemix 异步,await 后再 window.open 会被弹窗拦截 → 用户手势内先同步抓空白标签句柄,resolve 后重定向。
  const remix = async (g: PopularGame) => {
    if (remixingId) return;                  // 并发锁:一次只 Remix 一张
    const win = window.open('', '_blank');    // 同步抓句柄(手势内不被拦)
    setRemixingId(g.id);
    try {
      const data = await pgcApi.createRemix({ source_code: g.id });
      const url = pagePath('/studio') + withProjectParam('', data.project.public_id);
      if (win) win.location.href = url;       // 重定向预开的新标签
      else window.location.assign(url);       // 句柄被拦 → 当前页兜底
    } catch (e) {
      win?.close();
      // 与 store guard 一致:401=未登录只置 authRequired(交 useAuthGuard);其余 PgcError → Toast;非 PgcError 照抛。
      if (e instanceof PgcError) {
        if (e.status === 401) useStore.setState({ authRequired: true });
        else setError({ code: e.code, message: e.message });
      } else throw e;
    } finally {
      setRemixingId(null);
    }
  };

  return (
    // 整页固定 100vh 且裁溢出:内容区在整屏内垂直居中(无顶栏)。
    <div className="relative flex h-screen flex-col overflow-hidden bg-[var(--color-canvas)]">
      <div className="relative flex-1 overflow-hidden">
        {/* 背景青色光晕(357:2381):SVG,跨主题通用,垂直居中随内容,亮边贴 prompt box 下沿。 */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 z-0 flex -translate-y-[42px] justify-center">
          <LandingGlow className="h-auto w-[1240px] max-w-none" />
        </div>
        {/* 内容滚动层:m-auto 垂直居中(矮屏回退为可滚动顶部可达)。 */}
        <div className="relative z-10 flex h-full flex-col overflow-y-auto">
          <div className="m-auto w-[920px] max-w-full px-6 py-4">
            <HeroSection onOpen={openStudio} />
            <PromptBox onGenerate={openStudio} />
            <div className="mt-12">
              <PopularGames onPlay={setPreview} onRemix={remix} remixingId={remixingId} />
            </div>
          </div>
        </div>
      </div>
      <GamePreviewModal game={preview} onClose={() => setPreview(null)} />
      {/* 全局 Toast:Remix 远程错误经 setError → lastError 在此呈现。 */}
      <Toast />
    </div>
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/landing/LandingPage.test.tsx`
Expected: PASS（新 4 个 Remix 用例 + 既有用例全绿）。

- [ ] **Step 6: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm exec vitest run src/components/landing src/lib/pgc/client.test.ts`
Expected: tsc 无错、lint 通过、相关测试全绿。

- [ ] **Step 7: 提交**

```bash
git add src/components/landing/PopularGames.tsx src/components/landing/LandingPage.tsx src/components/landing/LandingPage.test.tsx
git commit -m "feat: landing 恢复 Remix(fork 源游戏新标签进工作台,含弹窗规避与鉴权兜底)"
```

---

## Self-Review

**Spec coverage：**
- §2 接口契约 + lib/pgc 改动 → Task 1。
- §4 games.ts 移除 ctaLabel → Task 2；GameCard 还原 hover Remix + footer Play + pending → Task 3；PopularGames 透传 + LandingPage handler + Toast → Task 4。
- §3 防弹窗拦截流程（同步句柄 → 重定向 / `location.assign` 兜底）→ Task 4 Step 4 + 测试 Step 1。
- §5 错误处理（401→authRequired/useAuthGuard，其余→Toast，非 PgcError 照抛）→ Task 4 Step 4 + 测试。
- §6 视觉（REMIX_GRAD、复用动效）→ Task 3 Step 3（Global Constraints 约束）。
- §7 测试 → 各 Task 的测试步骤全覆盖（client、games、GameCard、LandingPage）。
- §9 假设（不预检可用性、source_code=public_id）→ Task 1/2/4 取值与注释体现。

**Placeholder 扫描：** 无 TBD/TODO；每个改码步骤均给出完整代码与精确命令。

**类型一致性：** `CreateRemixRequest`/`RemixProjectData`/`createRemix`（Task 1）↔ Task 4 调用一致；`GameCard` props `{ game,onPlay,onRemix,remixing }`（Task 3）↔ PopularGames 透传（Task 4 Step 3）一致；`PopularGame` 去 `ctaLabel`（Task 2）↔ GameCard/games.test/LandingPage.test mock 一致；`remixingId`（LandingPage）→ `remixing={remixingId===g.id}`（PopularGames）一致。

**风险点提示给执行者：**
- Task 4 测试用 `vi.mock('@/lib/pgc/client', ...)` 部分覆盖 `pgcApi.createRemix` 同时保留 `PgcError`；`window.location.assign` 在 jsdom 需 `vi.spyOn` mock（勿真实赋值 `href`）。
- 若执行中发现后端未登录返回的不是 HTTP 401（而是代理收敛的 502 信封），则 `e.status===401` 分支不命中——此时会落到红色 Toast 分支（透传 code/message），不致命；如需对齐再按实际 status 调整（勿臆测，按实际响应改）。
