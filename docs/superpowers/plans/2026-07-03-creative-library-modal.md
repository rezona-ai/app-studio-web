# 素材库弹窗(Creative Library)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复画布左上角资产库按钮,点击打开像素级还原设计稿的「Creative Library」弹窗,浏览全局素材库并 Use 导入当前项目画布。

**Architecture:** 弹窗打开态进 zustand store(`libraryOpen`),列表数据是弹窗局部态;新增 `pgcApi.listLibraryAssets` 走既有 `/api/pgc` 代理;Use 复用 `writeCanvasItemFromUrl` 导入通路(新增 ServerAction `importLibraryAsset`)。视觉恒深色,颜色以 `--lib-*` 令牌集中进 `globals.css`。

**Tech Stack:** Next.js 16 + React 19、zustand、vitest + testing-library(jsdom)、react-i18next。

**Spec:** `docs/superpowers/specs/2026-07-03-creative-library-modal-design.md`(以其为准)。

## Global Constraints

- 代码注释/commit message 一律中文;注释解释「为什么」。
- 颜色不写字面值散落组件——本功能专属色统一收进 `globals.css` 的 `--lib-*` 令牌(恒定,不进 `[data-theme]` 分支)。
- 后端字段严格 snake_case,不加臆测别名;`canvas_x/y` 取整传 int。
- action 内每个 `await` 后校验 `get().currentProjectId !== pid` 则丢弃。
- 自身绝对路径必经 `apiPath()`(pgc client 已封装,勿绕过)。
- 测试与源码同目录;跑 `pnpm exec vitest run <file>`。
- i18n:en 是真相源,新键六语(en/zh/fr/ru/ja/vi)都补。

---

### Task 1: PGC client 增加素材库列表接口

**Files:**
- Modify: `src/lib/pgc/types.ts`(文件尾部追加)
- Modify: `src/lib/pgc/client.ts`(`pgcApi` 对象内追加)
- Test: `src/lib/pgc/client.test.ts`(追加用例)

**Interfaces:**
- Produces: `LibraryAssetData`、`LibraryAssetListData`、`LibraryAssetQuery` 类型;`pgcApi.listLibraryAssets(params?: LibraryAssetQuery): Promise<LibraryAssetListData>`。

- [ ] **Step 1: 写失败测试**

在 `src/lib/pgc/client.test.ts` 追加(参考同文件既有 fetch mock 惯例,若已有 `mockFetch` 辅助则复用):

```ts
describe('listLibraryAssets', () => {
  it('拼装 query 并解包信封', async () => {
    const items = [{ id: 1, key: 'k1', type: 'image', media_kind: 'image', url: 'https://x/1.png' }];
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(
      { success: true, code: 'OK', message: '', data: { items, total: 1 }, request_id: 'r' },
    )));
    const data = await pgcApi.listLibraryAssets({ type: 'image', q: 'cat', offset: 40 });
    expect(spy).toHaveBeenCalledWith(
      '/api/pgc/api/library/assets?type=image&q=cat&sort=curated&limit=40&offset=40',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(data.total).toBe(1);
    expect(data.items[0].key).toBe('k1');
    spy.mockRestore();
  });

  it('缺省参数:不带 type/q,sort=curated,limit=40,offset=0', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(
      { success: true, code: 'OK', message: '', data: { items: [], total: 0 }, request_id: 'r' },
    )));
    await pgcApi.listLibraryAssets();
    expect(spy).toHaveBeenCalledWith(
      '/api/pgc/api/library/assets?sort=curated&limit=40&offset=0',
      expect.anything(),
    );
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: FAIL,`listLibraryAssets is not a function`(或类型错误)。

- [ ] **Step 3: 最小实现**

`src/lib/pgc/types.ts` 尾部追加:

```ts
// ---- 全局素材库(运营预置,所有登录用户同一份;契约见 apifox List Library Assets) ----
export interface LibraryAssetData {
  id: number;
  key: string;
  type: string;         // bgm/sfx/image/video/meme/audio(运营分类,tab 筛选口径)
  media_kind: string;   // 媒体形态,对应画布 import 的 type 取值域
  name?: string | null;
  url: string;          // pgc 自托管,直接交给 /canvas/items/import 的 source_url
  thumbnail_url?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  duration_seconds?: number | null;
  tags?: string[];
  usage?: string | null;
  use_count?: number;
}
export interface LibraryAssetListData { items: LibraryAssetData[]; total: number }
export interface LibraryAssetQuery {
  type?: string; q?: string; sort?: 'curated' | 'popular' | 'recent'; limit?: number; offset?: number;
}
```

`src/lib/pgc/client.ts`:import 列表加上 `LibraryAssetListData, LibraryAssetQuery`;`pgcApi` 内(getCurrentUser 之前)追加:

```ts
  // 全局素材库分页列表;sort 固定 curated(spec 决定,不做排序切换 UI)
  listLibraryAssets: (params: LibraryAssetQuery = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    qs.set('sort', params.sort ?? 'curated');
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return pgc<LibraryAssetListData>('GET', `/api/library/assets?${qs.toString()}`);
  },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS(全文件)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: pgc client 增加全局素材库列表接口 listLibraryAssets"
```

---

### Task 2: store 增加 libraryOpen 开关与 importLibraryAsset 导入 action

**Files:**
- Modify: `src/store/index.ts`(UIState 接口 + 初始值 + action)
- Modify: `src/store/types.ts`(ServerActions 接口)
- Modify: `src/store/actions.ts`(createServerActions 内)
- Test: `src/store/actions.test.ts`(追加用例)

**Interfaces:**
- Consumes: Task 1 的 `pgcApi.listLibraryAssets` 不在此用;用 `pgcApi.writeCanvasItemFromUrl` 与 `LibraryAssetData`。
- Produces: `libraryOpen: boolean`、`setLibraryOpen(v: boolean): void`(UIState/Actions);`importLibraryAsset(item: LibraryAssetData): Promise<void>`(ServerActions)。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 追加(复用同文件对 `pgcApi` 的 `vi.mock` 与 store 重置惯例;`canvasItemToAsset` 已有 mock/真实映射按同文件既有用例写法):

```ts
describe('importLibraryAsset', () => {
  it('调 writeCanvasItemFromUrl 落位导入并并入 assets', async () => {
    useStore.setState({ currentProjectId: 7, assets: [] });
    (pgcApi.writeCanvasItemFromUrl as Mock).mockResolvedValue(fakeItem({ id: 'it1', name: 'Frog' }));
    await useStore.getState().importLibraryAsset({
      id: 1, key: 'lib/frog', type: 'image', media_kind: 'image', name: 'Frog', url: 'https://pgc/frog.png',
    });
    expect(pgcApi.writeCanvasItemFromUrl).toHaveBeenCalledWith(7, expect.objectContaining({
      source_url: 'https://pgc/frog.png',
      type: 'image',
      name: 'Frog',
      reference: { library_key: 'lib/frog' },
      canvas_x: expect.any(Number),
      canvas_y: expect.any(Number),
    }));
    expect(useStore.getState().assets).toHaveLength(1);
  });

  it('media_kind 不在导入取值域时 type 传 null;name 缺省回落 key', async () => {
    useStore.setState({ currentProjectId: 7, assets: [] });
    (pgcApi.writeCanvasItemFromUrl as Mock).mockResolvedValue(fakeItem({ id: 'it2' }));
    await useStore.getState().importLibraryAsset({
      id: 2, key: 'lib/meme1', type: 'meme', media_kind: 'gif', name: null, url: 'https://pgc/m.gif',
    });
    expect(pgcApi.writeCanvasItemFromUrl).toHaveBeenCalledWith(7, expect.objectContaining({ type: null, name: 'lib/meme1' }));
  });

  it('await 后切了项目则丢弃结果不并卡', async () => {
    useStore.setState({ currentProjectId: 7, assets: [] });
    (pgcApi.writeCanvasItemFromUrl as Mock).mockImplementation(async () => {
      useStore.setState({ currentProjectId: 8 });
      return fakeItem({ id: 'it3' });
    });
    await useStore.getState().importLibraryAsset({
      id: 3, key: 'k', type: 'image', media_kind: 'image', url: 'https://pgc/x.png',
    });
    expect(useStore.getState().assets).toHaveLength(0);
  });
});
```

(`fakeItem` 为同文件既有的 CanvasItemData 构造辅助;若命名不同,沿用现名。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: FAIL,`importLibraryAsset is not a function`。

- [ ] **Step 3: 实现**

`src/store/types.ts`:`ServerActions` 接口追加(import `LibraryAssetData` from `@/lib/pgc/types`):

```ts
  importLibraryAsset: (item: LibraryAssetData) => Promise<void>;
```

`src/store/actions.ts`:`createServerActions` 内、`importGeneratedAsset` 之后追加,并在返回对象里导出:

```ts
  // 素材库 Use:视口中心落位 → 复用 /canvas/items/import 通路(后端 server-side 拉 url 字节落库)。
  // 与 importGeneratedAsset 不同:允许同一素材多次导入(每次新卡),不做去重。
  const IMPORT_TYPES = ['image', 'video', 'audio', 'model3d'] as const;
  const importLibraryAsset = async (item: LibraryAssetData) => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const occupied = get().assets.map((a) => a.position);
    const { x, y } = avoidOverlap(getViewportCenter() ?? { x: 0, y: 0 }, occupied);
    const created = await pgcApi.writeCanvasItemFromUrl(pid, {
      source_url: item.url,
      // media_kind 与 import type 取值域一致时直传;域外(如运营新增形态)传 null 由后端按 content-type 推断
      type: (IMPORT_TYPES as readonly string[]).includes(item.media_kind)
        ? (item.media_kind as (typeof IMPORT_TYPES)[number]) : null,
      name: item.name ?? item.key,
      canvas_x: Math.round(x), canvas_y: Math.round(y),
      reference: { library_key: item.key },   // 溯源:后端原样回显
    });
    if (get().currentProjectId !== pid) return;   // await 后切项目:丢弃,画布归目标项目
    set({ assets: [...get().assets, canvasItemToAsset(created)] });
  });
```

(文件顶部 import 追加 `LibraryAssetData`。)

`src/store/index.ts`:
- `UIState` 接口加 `libraryOpen: boolean;`(注释:素材库弹窗打开态,瞬态不持久化);
- `Actions` 接口加 `setLibraryOpen: (v: boolean) => void;`;
- 初始值区加 `libraryOpen: false,`;
- actions 区(openLightbox 附近)加 `setLibraryOpen: (v) => set({ libraryOpen: v }),`。

确认 `partialize`(persist 配置)未包含 `libraryOpen`(其为白名单式,默认即不持久化,无需改)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts && pnpm exec tsc --noEmit`
Expected: PASS,无类型错误。

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: store 增加素材库弹窗开关与 importLibraryAsset 导入通路"
```

---

### Task 3: globals.css 增加 --lib-* 专属令牌

**Files:**
- Modify: `src/app/globals.css`(`@theme` 块内追加一组;不进 `[data-theme="dark"]`)

**Interfaces:**
- Produces: 下列 CSS 变量,Task 5 组件经 `var(--lib-*)` 引用。

- [ ] **Step 1: 追加令牌**

在 `@theme` 块内(既有颜色令牌之后)追加:

```css
  /* 素材库弹窗(Creative Library)专属令牌:设计稿为 liblib 风格恒深色浮层,
     不随主题翻转(Nick 拍板像素级还原),故不进 [data-theme] 分支 */
  --lib-pop: #2a2a2a;                       /* 弹窗底 */
  --lib-line: #1e1e1e;                      /* 弹窗描边 */
  --lib-ink: #f7f7f7;                       /* 主文字/选中 tab 字 */
  --lib-muted: #a8a8a8;                     /* 副文字/未选 tab 字 */
  --lib-fill: #171717;                      /* 搜索框底/缩略图底 */
  --lib-chip-line: rgba(255, 255, 255, 0.12);   /* tab 胶囊描边 */
  --lib-chip-active: rgba(255, 255, 255, 0.1);  /* 选中 tab 底 */
  --lib-input-line: #404040;                /* 搜索框描边 */
  --lib-placeholder: #737373;               /* 搜索 placeholder */
  --lib-accent: #1fd4cf;                    /* Use 按钮/hover 描边(设计稿青色,非项目 accent) */
  --shadow-lib: 0px 10px 21px 0px rgba(0, 0, 0, 0.07), 0px 38px 38px 0px rgba(0, 0, 0, 0.06),
    0px 86px 52px 0px rgba(0, 0, 0, 0.04), 0px 153px 61px 0px rgba(0, 0, 0, 0.01);  /* Depth/Popover */
```

- [ ] **Step 2: 验证构建**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`(任一快速用例,确认 CSS 未炸构建;globals.css 语法错误会在 build 才暴露,故再跑)`pnpm build` 可选,或留到 Task 7 统一验证。此步至少确认 dev 能起:`pnpm lint`。
Expected: lint PASS。

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: 素材库弹窗恒深色专属令牌 --lib-*(像素级还原设计稿,不随主题翻转)"
```

---

### Task 4: 恢复入口按钮并接开关

**Files:**
- Modify: `src/components/canvas/AssetLibraryButton.tsx`
- Modify: `src/components/canvas/AssetCanvas.tsx`(还原 `4cf9b41` 删的两行)
- Test: `src/components/canvas/AssetLibraryButton.test.tsx`(改写)

**Interfaces:**
- Consumes: Task 2 的 `setLibraryOpen`。

- [ ] **Step 1: 写失败测试**

改写 `src/components/canvas/AssetLibraryButton.test.tsx`(沿用其现有 render 辅助/i18n 包装):

```tsx
it('点击置 libraryOpen=true', () => {
  render(<AssetLibraryButton />);
  fireEvent.click(screen.getByRole('button'));
  expect(useStore.getState().libraryOpen).toBe(true);
});
```

删除断言「即将推出」Tooltip 的旧用例。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/AssetLibraryButton.test.tsx`
Expected: FAIL(点击后 libraryOpen 仍 false)。

- [ ] **Step 3: 实现**

`AssetLibraryButton.tsx` 整体改为:

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';

// 画布左上角素材库入口:点击打开 Creative Library 弹窗;与顶部居中搜索框同处 top-4(各贴左/居中不重叠)
export default function AssetLibraryButton() {
  const { t } = useTranslation();
  const setLibraryOpen = useStore((s) => s.setLibraryOpen);
  return (
    <div className="absolute left-4 top-4 z-10">
      <Tooltip label={t('canvas.assetLibrary')}>
        <IconButton
          variant="ghost"
          aria-label={t('canvas.assetLibrary')}
          onClick={() => setLibraryOpen(true)}
          className="size-10 border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-toolbar)]"
        >
          <FigIcon src={figAsset.assetLibrary} size={20} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
```

`AssetCanvas.tsx`:还原两行——import 区加回 `import AssetLibraryButton from './AssetLibraryButton';`(MediaLightbox import 之后),`<CanvasSearchBar .../>` 与 `<CanvasFilterButton />` 之间加回 `<AssetLibraryButton />`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/AssetLibraryButton.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/AssetLibraryButton.tsx src/components/canvas/AssetCanvas.tsx src/components/canvas/AssetLibraryButton.test.tsx
git commit -m "feat: 恢复画布左上角素材库按钮,点击打开 Creative Library 弹窗"
```

---

### Task 5: CreativeLibraryModal 弹窗组件

**Files:**
- Create: `src/components/canvas/CreativeLibraryModal.tsx`
- Modify: `src/components/workspace/Workspace.tsx`(挂载)
- Test: `src/components/canvas/CreativeLibraryModal.test.tsx`

**Interfaces:**
- Consumes: `pgcApi.listLibraryAssets`(Task 1)、`useStore` 的 `libraryOpen/setLibraryOpen/importLibraryAsset/setError`(Task 2)、`--lib-*` 令牌(Task 3)、`useRequestClose`、`FigIcon`(`figAsset.close`/`figAsset.search`)、`.modal-pop`/`.modal-backdrop`/`.skeleton-shimmer`/`.scrollbar-auto`。
- Produces: 默认导出 `CreativeLibraryModal`(无 props,自订阅 store)。

- [ ] **Step 1: 写失败测试**

`src/components/canvas/CreativeLibraryModal.test.tsx`(mock `@/lib/pgc/client` 的 `pgcApi.listLibraryAssets`;IntersectionObserver 在 jsdom 需 stub——setup 若无,测试文件内 `beforeAll` 挂全局假实现记录回调,手动触发模拟触底):

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, type Mock, beforeEach, beforeAll, describe, it, expect } from 'vitest';
import CreativeLibraryModal from './CreativeLibraryModal';
import { useStore } from '@/store';
import { pgcApi } from '@/lib/pgc/client';
import '@/i18n';   // 沿用其他组件测试的 i18n 初始化方式

vi.mock('@/lib/pgc/client', async (orig) => {
  const m = await orig() as object;
  return { ...m, pgcApi: { ...(m as { pgcApi: object }).pgcApi, listLibraryAssets: vi.fn(), writeCanvasItemFromUrl: vi.fn() } };
});

const asset = (i: number, over: Partial<import('@/lib/pgc/types').LibraryAssetData> = {}) => ({
  id: i, key: `k${i}`, type: 'image', media_kind: 'image', name: `A${i}`,
  url: `https://pgc/${i}.png`, thumbnail_url: `https://pgc/${i}_t.png`, ...over,
});

// jsdom 无 IntersectionObserver:stub 记录实例,observed 回调由用例手动触发模拟触底
let ioCallback: IntersectionObserverCallback | null = null;
beforeAll(() => {
  globalThis.IntersectionObserver = class {
    constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ''; thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

beforeEach(() => {
  vi.clearAllMocks(); ioCallback = null;
  useStore.setState({ libraryOpen: true, currentProjectId: 7 });
});

describe('CreativeLibraryModal', () => {
  it('打开即请求首屏并渲染卡片', async () => {
    (pgcApi.listLibraryAssets as Mock).mockResolvedValue({ items: [asset(1), asset(2)], total: 2 });
    render(<CreativeLibraryModal />);
    expect(pgcApi.listLibraryAssets).toHaveBeenCalledWith({ offset: 0, limit: 40 });
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
  });

  it('切 tab 重置并按 type 请求', async () => {
    (pgcApi.listLibraryAssets as Mock).mockResolvedValue({ items: [], total: 0 });
    render(<CreativeLibraryModal />);
    fireEvent.click(screen.getByRole('tab', { name: /BGM/i }));
    await waitFor(() =>
      expect(pgcApi.listLibraryAssets).toHaveBeenLastCalledWith({ type: 'bgm', offset: 0, limit: 40 }));
  });

  it('搜索防抖 300ms 后带 q 请求', async () => {
    vi.useFakeTimers();
    (pgcApi.listLibraryAssets as Mock).mockResolvedValue({ items: [], total: 0 });
    render(<CreativeLibraryModal />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'frog' } });
    expect(pgcApi.listLibraryAssets).toHaveBeenCalledTimes(1);   // 只有首屏
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(pgcApi.listLibraryAssets).toHaveBeenLastCalledWith({ q: 'frog', offset: 0, limit: 40 });
    vi.useRealTimers();
  });

  it('触底且未取完时用 offset=已加载数追加下一页,期间渲染骨架卡', async () => {
    (pgcApi.listLibraryAssets as Mock)
      .mockResolvedValueOnce({ items: Array.from({ length: 40 }, (_, i) => asset(i)), total: 41 })
      .mockResolvedValueOnce({ items: [asset(40)], total: 41 });
    render(<CreativeLibraryModal />);
    await waitFor(() => expect(screen.getByText('A0')).toBeInTheDocument());
    await act(async () => {
      ioCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(pgcApi.listLibraryAssets).toHaveBeenLastCalledWith({ offset: 40, limit: 40 });
    await waitFor(() => expect(screen.getByText('A40')).toBeInTheDocument());
    expect(screen.queryAllByTestId('lib-skeleton')).toHaveLength(0);   // 数据到达后骨架移除
  });

  it('Use 调 importLibraryAsset', async () => {
    const importSpy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ importLibraryAsset: importSpy });
    (pgcApi.listLibraryAssets as Mock).mockResolvedValue({ items: [asset(1)], total: 1 });
    render(<CreativeLibraryModal />);
    await waitFor(() => screen.getByText('A1'));
    fireEvent.click(screen.getByRole('button', { name: /use/i }));
    expect(importSpy).toHaveBeenCalledWith(expect.objectContaining({ key: 'k1' }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/CreativeLibraryModal.test.tsx`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现组件**

`src/components/canvas/CreativeLibraryModal.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import type { LibraryAssetData } from '@/lib/pgc/types';
import { figAsset, FigIcon } from '@/components/ui/figma';

const PAGE = 40;
// tab = All + 后端真实 type(经 Nick 确认,不用设计稿占位文案 Characters/Background)
const TABS = ['image', 'video', 'audio', 'bgm', 'sfx', 'meme'] as const;

// 素材库弹窗:恒深色像素级还原设计稿(--lib-* 令牌),列表数据为弹窗局部态(全局素材,非项目态)
export default function CreativeLibraryModal() {
  const { t } = useTranslation();
  const close = useStore((s) => s.setLibraryOpen);
  const importLibraryAsset = useStore((s) => s.importLibraryAsset);
  const setError = useStore((s) => s.setError);
  const { closing, requestClose } = useRequestClose(() => close(false), 200);

  const [tab, setTab] = useState<string | null>(null);      // null=All
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');                           // 防抖后的生效搜索词
  const [items, setItems] = useState<LibraryAssetData[]>([]);
  const [total, setTotal] = useState<number | null>(null);  // null=首屏未返回
  const [loading, setLoading] = useState(false);
  const [usingKeys, setUsingKeys] = useState<string[]>([]);
  const reqSeq = useRef(0);                                 // 最后一次请求胜出:丢弃过期响应

  // 搜索防抖 300ms
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (offset: number, append: boolean) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const data = await pgcApi.listLibraryAssets({
        ...(tab ? { type: tab } : {}), ...(q ? { q } : {}), offset, limit: PAGE,
      });
      if (seq !== reqSeq.current) return;                   // 已有更新的请求发出:丢弃
      setItems((prev) => (append ? [...prev, ...data.items] : data.items));
      setTotal(data.total);
    } catch (e) {
      if (seq !== reqSeq.current) return;
      const msg = e instanceof PgcError ? e.message : String(e);
      setError({ code: 'LIBRARY_LIST', message: msg, kind: 'error' });
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [tab, q, setError]);

  // 打开/切 tab/搜索词生效:重置回第一页
  useEffect(() => {
    setItems([]); setTotal(null);
    void fetchPage(0, false);
  }, [fetchPage]);

  // 触底哨兵:未在加载且未取完 → 追加下一页
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const itemsLen = items.length;
  const hasMore = total != null && itemsLen < total;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting) && !loading) void fetchPage(itemsLen, true);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, itemsLen, fetchPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const use = async (a: LibraryAssetData) => {
    if (usingKeys.includes(a.key)) return;
    setUsingKeys((ks) => [...ks, a.key]);
    try {
      await importLibraryAsset(a);
      setError({ code: 'LIBRARY_USED', message: t('library.useDone'), kind: 'info' });
    } finally {
      setUsingKeys((ks) => ks.filter((k) => k !== a.key));
    }
  };

  const initialLoading = loading && total == null;
  const skeletons = initialLoading ? 8 : loading && hasMore ? 4 : 0;   // 首屏整两行/翻页一行

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing} role="dialog" aria-modal="true" aria-label={t('library.title')} onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()} data-closing={closing}
        className="modal-pop flex max-h-[85vh] w-[990px] flex-col gap-[9px] rounded-[28px] border border-[var(--lib-line)] bg-[var(--lib-pop)] px-6 py-4 shadow-[var(--shadow-lib)] backdrop-blur-[6px]"
      >
        {/* 头部:标题 + 关闭(设计稿 18/28 SemiBold 白;X 16px 恒白,tone 走 currentColor) */}
        <div className="flex items-center justify-between">
          <span className="text-[18px] font-semibold leading-[28px] tracking-[0.28px] text-[var(--lib-ink)]">{t('library.title')}</span>
          <button type="button" aria-label={t('common.close')} onClick={requestClose}
            className="grid size-6 place-items-center text-[var(--lib-ink)] transition-opacity hover:opacity-70">
            <FigIcon src={figAsset.close} size={16} />
          </button>
        </div>

        {/* 工具行:tab 胶囊流 + 280px 搜索框 */}
        <div className="flex w-full items-center gap-4">
          <div role="tablist" className="scrollbar-none flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-px pr-2">
            {[null, ...TABS].map((key) => {
              const active = tab === key;
              return (
                <button
                  key={key ?? 'all'} type="button" role="tab" aria-selected={active}
                  onClick={() => setTab(key)}
                  className={`shrink-0 rounded-[8px] border border-[var(--lib-chip-line)] px-[13px] py-[7px] text-[13px] leading-[19px] transition-colors ${
                    active ? 'bg-[var(--lib-chip-active)] text-[var(--lib-ink)]' : 'text-[var(--lib-muted)] hover:text-[var(--lib-ink)]'
                  }`}
                >
                  {t(key ? `library.tab.${key}` : 'library.tab.all')}
                </button>
              );
            })}
          </div>
          <div className="flex h-10 w-[280px] shrink-0 items-center rounded-full border border-[var(--lib-input-line)] bg-[var(--lib-fill)] px-[17px]">
            <input
              type="search" role="searchbox" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={t('library.searchPlaceholder')} aria-label={t('library.searchPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-[14px] leading-[22px] text-[var(--lib-ink)] outline-none placeholder:text-[var(--lib-placeholder)]"
            />
            <FigIcon src={figAsset.search} size={14} className="shrink-0 opacity-70" />
          </div>
        </div>

        {/* 网格:4×220 卡片,触底哨兵翻页;骨架卡与真实卡等尺寸避免跳动 */}
        <div className="scrollbar-auto min-h-0 flex-1 overflow-y-auto">
          {total === 0 && !loading ? (
            <div className="grid h-40 place-items-center text-[14px] text-[var(--lib-muted)]">{t('library.empty')}</div>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {items.map((a) => (
                <LibraryCard key={a.key} asset={a} using={usingKeys.includes(a.key)} onUse={() => void use(a)} t={t} />
              ))}
              {Array.from({ length: skeletons }, (_, i) => (
                <div key={`sk${i}`} data-testid="lib-skeleton" className="flex w-[220px] flex-col gap-3 pb-3">
                  <div className="skeleton-shimmer h-[195.75px] w-full rounded-[12px]" />
                  <div className="skeleton-shimmer h-[14px] w-3/4 rounded" />
                  <div className="skeleton-shimmer h-[12px] w-1/2 rounded" />
                </div>
              ))}
              <div ref={sentinelRef} className="col-span-4 h-px" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LibraryCard({ asset, using, onUse, t }: {
  asset: LibraryAssetData; using: boolean; onUse: () => void; t: (k: string) => string;
}) {
  const thumb = asset.thumbnail_url ?? (asset.media_kind === 'image' ? asset.url : null);
  return (
    <div className="group flex w-[220px] flex-col gap-3 pb-3">
      <div className="relative h-[195.75px] w-full overflow-hidden rounded-[12px] bg-[var(--lib-fill)] transition-shadow group-hover:shadow-[inset_0_0_0_3px_var(--lib-accent)]">
        {thumb ? (
          // 素材缩略图为后端托管任意媒体,尺寸未知,不走 next/image
          // eslint-disable-next-line @next/next/no-img-element -- 外源媒体直出,与画布卡一致
          <img src={thumb} alt={asset.name ?? asset.key} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-[12px] uppercase text-[var(--lib-muted)]">{asset.media_kind}</div>
        )}
        {/* hover:65% 黑遮罩 + 青色 Use 胶囊(设计稿 30px 高、Inter Bold 13) */}
        <div className="absolute inset-0 flex items-end justify-center rounded-[12px] bg-black/65 pb-[11px] opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button" onClick={onUse} disabled={using} aria-label={t('library.use')}
            className="mx-[11px] flex h-[30px] w-full items-center justify-center rounded-full bg-[var(--lib-accent)] text-[13px] font-bold leading-6 text-white transition-opacity disabled:opacity-60"
          >
            {using ? t('library.using') : t('library.use')}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[14px] leading-[22px] text-[var(--lib-ink)]">{asset.name ?? asset.key}</span>
        <span className="text-[12px] leading-[18px] text-[var(--lib-muted)]">{t(`library.tab.${asset.type}`)}</span>
      </div>
    </div>
  );
}
```

实现落地时注意(不是照抄即可的点):
- `setError` 的 `kind` 取值以 `ToastMessage` 实际类型为准(看 `src/store/types.ts`;若无 `info` 档,成功提示用现有档位或省略成功 Toast——spec 只要求失败 Toast,成功提示可选)。
- `figAsset.close`/`figAsset.search` 的 `ICON_TONE` 默认色调若与恒深色底冲突(secondary 灰在深底可见,可用),必要时给 FigIcon 传 `tone="primary"` 让其随 currentColor(白)。
- `library.tab.${asset.type}` 对后端未知新 type 会漏译:副标题回落 `asset.type` 原文(`i18n` 的 `t(key, { defaultValue: asset.type })`)。

`Workspace.tsx` 挂载:import `CreativeLibraryModal`,订阅 `const libraryOpen = useStore((s) => s.libraryOpen);`,在 `{renameTarget && <RenameAssetModal />}` 同级追加 `{libraryOpen && <CreativeLibraryModal />}`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/CreativeLibraryModal.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS(i18n 键此时缺失会显示 key 原文,用例按 aria-label/role 断言不受影响;若受影响,Task 6 先行补 en 后回跑)。

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/CreativeLibraryModal.tsx src/components/canvas/CreativeLibraryModal.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: Creative Library 素材库弹窗——tab 筛选/搜索/滚动分页骨架/Use 导入画布"
```

---

### Task 6: i18n 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Produces: `library.*` 键;删除 `canvas.assetLibrarySoon`。

- [ ] **Step 1: en 真相源追加**

`en.ts` 顶层追加 `library` 节(与 `canvas` 同级):

```ts
  library: {
    title: 'Creative Library',
    searchPlaceholder: 'Search',
    use: 'Use',
    using: 'Adding…',
    useDone: 'Added to canvas',
    empty: 'No assets found',
    tab: { all: 'All', image: 'Image', video: 'Video', audio: 'Audio', bgm: 'BGM', sfx: 'SFX', meme: 'Meme' },
  },
```

同时删除 `canvas.assetLibrarySoon`。

- [ ] **Step 2: 其余五语对应追加**

zh:`标题 素材库(界面标题保留英文 Creative Library 亦可——设计稿即英文,按项目其他 modal 标题的翻译惯例走,若其他标题都翻译则译为「创意素材库」)/搜索/使用/添加中…/已添加到画布/暂无素材/全部/图片/视频/音频/BGM/音效/梗图`;fr/ru/ja/vi 逐键对应翻译。每个文件删掉 `assetLibrarySoon`。

- [ ] **Step 3: 校验无遗漏**

Run: `grep -rn "assetLibrarySoon" src/ ; pnpm exec tsc --noEmit`
Expected: grep 无结果(引用已在 Task 4 移除);tsc PASS(zh/fr/ru/ja/vi 类型引 en,缺键会报错)。

- [ ] **Step 4: 回跑弹窗测试**

Run: `pnpm exec vitest run src/components/canvas/CreativeLibraryModal.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 素材库弹窗 library.* 六语文案,删除已下线的 assetLibrarySoon"
```

---

### Task 7: 全量验证 + 运行态核验

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 PASS。

- [ ] **Step 2: 运行态核验(verify)**

起 dev(注意端口勿被其他 worktree 占用,见既有记忆),打开项目页:
1. 画布左上角出现素材库按钮;
2. 点击弹出恒深色弹窗(浅色主题下也恒深),首屏骨架→列表;
3. 切 tab/搜索触发重新请求;滚到底出现一行骨架并追加;
4. 任一卡 hover 出青色 Use,点击后画布视口中心落新卡。
若本地无后端,用 Playwright `page.route('**/api/pgc/**')` 注入信封 mock 逐态截图核验(既有惯例)。对照 Figma 截图逐项核对(尺寸/颜色/圆角/字号),列对照表后再宣称完成。

- [ ] **Step 3: 最终 commit(如有修补)**
