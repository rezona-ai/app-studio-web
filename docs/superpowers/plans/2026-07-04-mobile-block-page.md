# 移动端拦截提醒页 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UA 判定为移动端（含平板）的用户访问时，硬拦截并展示「不支持移动端」提醒页，不加载三栏工作台。

**Architecture:** `page.tsx` 改为 server component，读 `headers()` 的 user-agent 经纯函数 `isMobileUA` 分发：命中渲染 `MobileBlockPage`（client 组件、自带 I18nProvider），未命中渲染 `WorkspaceEntry`（原 page 客户端内容平移）。iPadOS Safari 伪装桌面 UA，由 `WorkspaceEntry` 内 `useSyncExternalStore`（server snapshot 恒 false，无 hydration mismatch）补判。

**Tech Stack:** Next.js 16 App Router（server component + `headers()`）、react-i18next 六语、Vitest + Testing Library。

**设计稿:** `docs/superpowers/specs/2026-07-04-mobile-block-page-design.md`

## Global Constraints

- 颜色只用 CSS 变量令牌（`--color-surface-2` / `--color-ink` / `--color-muted`），禁止硬编码色值。
- 图标用 `FigIcon`（`src/components/ui/figma.tsx`），logo 用 `figAsset.logo`（tone 已注册为 original）。
- 文案六语齐全（en/zh/fr/ru/ja/vi），en 为单一真相源；其余 locale 标注 `: Messages` 缺 key 编译期报错。
- 硬拦截：不提供「继续访问」入口，不监听 resize/旋转。
- commit message 中文一句话；代码注释中文、解释「为什么」。
- 测试与源码同目录；跑 `pnpm exec vitest run <file>` 验证。

---

### Task 1: UA 判定纯函数 `isMobileUA`

**Files:**
- Create: `src/lib/mobile-ua.ts`
- Test: `src/lib/mobile-ua.test.ts`

**Interfaces:**
- Produces: `isMobileUA(ua: string): boolean`（Task 4 的 server component 消费）

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/mobile-ua.test.ts
import { describe, expect, test } from 'vitest';
import { isMobileUA } from './mobile-ua';

const MOBILE = [
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['Android 手机 Chrome', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'],
  ['Android 平板 Chrome(无 Mobile 标记)', 'Mozilla/5.0 (Linux; Android 13; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'],
  ['iPad 明示 UA', 'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'],
  ['微信内嵌 WebView', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44'],
  ['Windows Phone', 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15254'],
] as const;

const DESKTOP = [
  ['macOS Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'],
  ['macOS Safari(iPadOS 伪装同款,由客户端补判)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
  ['Windows Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'],
  ['Windows Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0'],
  ['空 UA', ''],
] as const;

describe('isMobileUA', () => {
  test.each(MOBILE)('移动端命中: %s', (_name, ua) => { expect(isMobileUA(ua)).toBe(true); });
  test.each(DESKTOP)('桌面端放行: %s', (_name, ua) => { expect(isMobileUA(ua)).toBe(false); });
});
```

注意 Android 平板用例：Chrome 平板 UA **不含** `Mobile` 标记，靠 `Android` 命中——这是正则里保留 `android` 的原因。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/mobile-ua.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/lib/mobile-ua.ts
// 移动端 UA 判定:工作台为固定桌面三栏布局,移动端(含平板)硬拦截。
// 只看 UA 不看视口宽度——桌面缩窄窗口不应触发拦截。
// 注意:android 平台的平板 Chrome UA 不带 Mobile 标记,靠 android 关键字覆盖;
// iPadOS Safari 默认伪装桌面 Mac UA,服务端识别不到,由 WorkspaceEntry 客户端补判。
const MOBILE_UA_RE = /android|iphone|ipad|ipod|windows phone|opera mini|mobile/i;

export function isMobileUA(ua: string): boolean {
  return MOBILE_UA_RE.test(ua);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/mobile-ua.test.ts`
Expected: PASS（11 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/lib/mobile-ua.ts src/lib/mobile-ua.test.ts
git commit -m "feat: 移动端 UA 判定纯函数 isMobileUA"
```

### Task 2: 六语文案 `mobileBlock`

**Files:**
- Modify: `src/i18n/locales/en.ts`（顶层追加 `mobileBlock` 段）
- Modify: `src/i18n/locales/zh.ts` / `fr.ts` / `ru.ts` / `ja.ts` / `vi.ts`（同位置追加译文）

**Interfaces:**
- Produces: i18n key `mobileBlock.title` / `mobileBlock.desc`（Task 3 消费）

- [ ] **Step 1: en.ts 追加词条**

在 `en` 对象顶层（`library` 段之后、`} as const` 之前）追加：

```ts
  mobileBlock: {
    title: 'Desktop only',
    desc: 'This page is not supported on mobile devices. Please open it in a desktop browser.',
  },
```

- [ ] **Step 2: 其余五语追加同结构译文**

各 locale 文件同位置追加（形状由 `: Messages` 约束，缺 key 编译期报错）：

```ts
// zh.ts
  mobileBlock: {
    title: '暂不支持移动端',
    desc: '当前页面不支持移动端设备访问,请使用桌面端浏览器打开。',
  },
// fr.ts
  mobileBlock: {
    title: 'Ordinateur requis',
    desc: "Cette page n'est pas prise en charge sur mobile. Veuillez l'ouvrir dans un navigateur de bureau.",
  },
// ru.ts
  mobileBlock: {
    title: 'Только для компьютера',
    desc: 'Эта страница не поддерживается на мобильных устройствах. Откройте её в браузере на компьютере.',
  },
// ja.ts
  mobileBlock: {
    title: 'モバイル非対応',
    desc: 'このページはモバイル端末に対応していません。デスクトップのブラウザでご利用ください。',
  },
// vi.ts
  mobileBlock: {
    title: 'Chỉ hỗ trợ máy tính',
    desc: 'Trang này không hỗ trợ thiết bị di động. Vui lòng mở bằng trình duyệt trên máy tính.',
  },
```

- [ ] **Step 3: 类型检查验证六语齐全**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（漏加任一 locale 会报缺 `mobileBlock`）

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/
git commit -m "feat: 移动端拦截页六语文案 mobileBlock"
```

### Task 3: 提醒页组件 `MobileBlockPage`

**Files:**
- Create: `src/components/workspace/MobileBlockPage.tsx`
- Test: `src/components/workspace/MobileBlockPage.test.tsx`

**Interfaces:**
- Consumes: i18n key `mobileBlock.title` / `mobileBlock.desc`（Task 2）；`FigIcon` / `figAsset`（既有）
- Produces: `<MobileBlockPage />`（无 props，client 组件、自带 I18nProvider；Task 4 的 server 分发与 iPadOS 补判两条路径共用）

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/workspace/MobileBlockPage.test.tsx
import { render, screen, act } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import MobileBlockPage from './MobileBlockPage';
import i18n from '@/i18n';

beforeEach(() => { document.documentElement.lang = ''; void i18n.changeLanguage('en'); });

test('渲染标题与说明文案(en)', async () => {
  await act(async () => { render(<MobileBlockPage />); });
  expect(screen.getByRole('heading', { name: 'Desktop only' })).toBeInTheDocument();
  expect(screen.getByText(/not supported on mobile devices/)).toBeInTheDocument();
});

test('自带 I18nProvider:按 <html lang> 出中文', async () => {
  document.documentElement.lang = 'zh-CN';
  await act(async () => { render(<MobileBlockPage />); });
  expect(screen.getByRole('heading', { name: '暂不支持移动端' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/workspace/MobileBlockPage.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现组件**

先确认 `src/components/ui/figma.tsx` 的导出名（`FigIcon` / `figAsset`，如有出入以实际为准）。

```tsx
// src/components/workspace/MobileBlockPage.tsx
'use client';
import { useTranslation } from 'react-i18next';
import I18nProvider from '@/components/i18n/I18nProvider';
import { FigIcon, figAsset } from '@/components/ui/figma';

// 移动端硬拦截提醒页:UA 判定命中(server 分发)或 iPadOS 客户端补判命中时全屏渲染,
// 替代整个工作台。自带 I18nProvider——server 分发路径外层没有 provider。
function Content() {
  const { t } = useTranslation();
  return (
    <main className="grid h-dvh place-items-center bg-[var(--color-surface-2)] px-8">
      <div className="anim-media-in flex flex-col items-center gap-4 text-center">
        <FigIcon src={figAsset.logo} size={48} tone="original" alt="Taluna" />
        <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{t('mobileBlock.title')}</h1>
        <p className="max-w-[320px] text-[14px] leading-relaxed text-[var(--color-muted)]">{t('mobileBlock.desc')}</p>
      </div>
    </main>
  );
}

export default function MobileBlockPage() {
  return (
    <I18nProvider>
      <Content />
    </I18nProvider>
  );
}
```

注意：`FigIcon` 若无 `alt` prop 则按其实际接口传（如 `aria-label` 或省略），以 `figma.tsx` 签名为准。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/workspace/MobileBlockPage.test.tsx`
Expected: PASS（2 个用例）

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/MobileBlockPage.tsx src/components/workspace/MobileBlockPage.test.tsx
git commit -m "feat: 移动端拦截提醒页组件 MobileBlockPage"
```

### Task 4: 入口分发 —— server 判定 + iPadOS 客户端补判

**Files:**
- Create: `src/components/workspace/WorkspaceEntry.tsx`
- Modify: `src/app/page.tsx`（整体替换为 server component）
- Test: `src/components/workspace/WorkspaceEntry.test.tsx`

**Interfaces:**
- Consumes: `isMobileUA(ua: string): boolean`（Task 1）、`<MobileBlockPage />`（Task 3）、既有 `Workspace` / `I18nProvider`
- Produces: 无下游消费方（最终装配）

- [ ] **Step 1: 写 WorkspaceEntry 的失败测试**

iPadOS 补判用 `useSyncExternalStore`：server/hydration snapshot 恒 `false`（首帧与 SSR 一致、无 hydration mismatch），client snapshot 读 `navigator`。测试直接 mock navigator 属性：

```tsx
// src/components/workspace/WorkspaceEntry.test.tsx
import { render, screen, act } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import WorkspaceEntry from './WorkspaceEntry';

// Workspace 拉起连接/轮询等副作用,单测只关心分发,mock 成占位
vi.mock('@/components/workspace/Workspace', () => ({ default: () => <div data-testid="workspace" /> }));

function mockNavigator(maxTouchPoints: number, ua: string) {
  vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(maxTouchPoints);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

afterEach(() => { vi.restoreAllMocks(); });

test('桌面 Mac(无触点)→ 渲染工作台', async () => {
  mockNavigator(0, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByTestId('workspace')).toBeInTheDocument();
});

test('iPadOS 伪装桌面 UA(多触点 Mac)→ 渲染拦截页', async () => {
  mockNavigator(5, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByRole('heading', { name: 'Desktop only' })).toBeInTheDocument();
  expect(screen.queryByTestId('workspace')).toBeNull();
});

test('Windows 触屏笔记本(多触点非 Mac)→ 渲染工作台', async () => {
  mockNavigator(10, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36');
  await act(async () => { render(<WorkspaceEntry />); });
  expect(screen.getByTestId('workspace')).toBeInTheDocument();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/workspace/WorkspaceEntry.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 WorkspaceEntry**

```tsx
// src/components/workspace/WorkspaceEntry.tsx
'use client';
import { useSyncExternalStore } from 'react';
import Workspace from '@/components/workspace/Workspace';
import I18nProvider from '@/components/i18n/I18nProvider';
import MobileBlockPage from '@/components/workspace/MobileBlockPage';

// iPadOS Safari 默认伪装桌面 Mac UA,server 侧 isMobileUA 放行——在此客户端补判。
// 用 useSyncExternalStore:server/水合快照恒 false(与 SSR 首帧一致,不触发 hydration
// mismatch——本项目 mismatch 会整树重渲抹掉 <html data-theme>),真 iPad 上水合后切拦截页。
const subscribeNoop = () => () => {};
const isIpadOs = () => navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent);

export default function WorkspaceEntry() {
  const blocked = useSyncExternalStore(subscribeNoop, isIpadOs, () => false);
  if (blocked) return <MobileBlockPage />;
  return (
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/workspace/WorkspaceEntry.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 5: page.tsx 改为 server component 分发**

整体替换 `src/app/page.tsx`：

```tsx
import { headers } from 'next/headers';
import { isMobileUA } from '@/lib/mobile-ua';
import MobileBlockPage from '@/components/workspace/MobileBlockPage';
import WorkspaceEntry from '@/components/workspace/WorkspaceEntry';

// 工作台即应用入口(landing 由主站提供)。server 侧按 UA 分发:移动端(含平板)硬拦截,
// 完全不下发工作台(不建 WS/轮询);桌面渲染三栏工作台(原客户端入口平移至 WorkspaceEntry,
// 外部 ?remix=/prelude 参仍由其内 useProjectBootstrap 挂载时分发)。
export default async function Page() {
  const ua = (await headers()).get('user-agent') ?? '';
  if (isMobileUA(ua)) return <MobileBlockPage />;
  return <WorkspaceEntry />;
}
```

注意：Next 16 的 `headers()` 为 async；若实际版本为同步签名，去掉 `await` 并以编译结果为准。

- [ ] **Step 6: 全量验证**

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: 三项全部通过（`headers()` 使页面动态渲染，本项目跑自定义 server 运行时渲染，build 不受影响）。

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/components/workspace/WorkspaceEntry.tsx src/components/workspace/WorkspaceEntry.test.tsx
git commit -m "feat: 入口按 UA 分发移动端拦截页(server 判定+iPadOS 补判)"
```

### Task 5: 运行态验证（真实浏览器 UA 模拟）

**Files:** 无代码变更，验证步骤。

- [ ] **Step 1: 起 dev server 并用 Playwright 模拟移动端 UA**

起 `pnpm dev`（注意端口勿与其他 worktree 冲突），用 Playwright MCP：
1. 默认桌面 UA 打开 `http://localhost:3000` → 应渲染三栏工作台（或其 loading 态）；
2. 设 iPhone UA（`browser_navigate` 前经 CDP/context 配 UA，或 `browser_resize` + `browser_run_code_unsafe` 不可改 UA 时改用 `curl -A "<iPhone UA>" http://localhost:3000` 断言响应 HTML 含拦截页标题文案且不含工作台骨架）→ 应渲染拦截页；
3. 截图确认拦截页视觉（居中 logo + 标题 + 说明、深浅主题下均正常）。

Expected: 移动 UA 只出拦截页；桌面 UA 不受影响。

- [ ] **Step 2: 如有问题回修并补交 commit；全部通过后结束**
