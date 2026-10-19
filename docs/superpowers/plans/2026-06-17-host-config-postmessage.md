# 主站 postMessage 实时主题 / 语言更新 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 监听主站经 postMessage 下发的 `taluna-config` 配置帧，运行期实时更新主题（亮/暗），并把 `lang` 同步到 `<html lang>` 作为后续 i18n 接入的种子。

**Architecture:** 纯函数 `parseHostConfig`（`lib/`）做来源校验 + 形状归一；副作用 hook `useHostConfig`（`client/`）监听 `message` 并把结果写 `<html data-theme/lang>`（不回写 localStorage，由主站管理）；`useIsDark` 的 `subscribe` 改为 `data-theme` 的 `MutationObserver`，组件自动重渲染。

**Tech Stack:** Next 16 / React 19 / TypeScript / Vitest（jsdom + globals）/ `@testing-library/react`。

设计稿：`docs/superpowers/specs/2026-06-17-host-config-postmessage-design.md`

---

## 文件结构

- **新增** `src/lib/host-config.ts` —— 纯函数 `parseHostConfig`，无副作用，单测覆盖。
- **新增** `src/lib/host-config.test.ts` —— `parseHostConfig` 单测。
- **新增** `src/client/useHostConfig.ts` —— 副作用 hook，监听 `message`、写 DOM。
- **新增** `src/client/useHostConfig.test.tsx` —— hook 行为测试（jsdom 派发 `MessageEvent`）。
- **改** `src/client/useIsDark.ts` —— `subscribe` 改为 `MutationObserver`。
- **改** `src/client/useIsDark.test.ts` —— 补响应性测试。
- **改** `src/app/layout.tsx` —— 防白闪脚本同步设 `document.documentElement.lang`。
- **改** `src/components/workspace/Workspace.tsx` —— 挂载 `useHostConfig()`。

---

## Task 1: `parseHostConfig` 纯函数（解析 / 归一）

**Files:**
- Create: `src/lib/host-config.ts`
- Test: `src/lib/host-config.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/host-config.test.ts`：

```ts
import { expect, test } from 'vitest';
import { parseHostConfig } from './host-config';

const SELF = 'https://app.taluna.ai';
// 主站消息格式:{ type:'taluna-config', key:'taluna-config', config:{ lang, theme } }
const msg = (config: unknown, type = 'taluna-config') => ({ type, key: 'taluna-config', config });

test('异源消息被拒(返回 null)', () => {
  expect(parseHostConfig(msg({ theme: 'light' }), 'https://evil.com', SELF)).toBeNull();
});

test('type 非 taluna-config 被拒', () => {
  expect(parseHostConfig(msg({ theme: 'light' }, 'other'), SELF, SELF)).toBeNull();
});

test('config 非对象 / 缺失被拒', () => {
  expect(parseHostConfig(msg(null), SELF, SELF)).toBeNull();
  expect(parseHostConfig({ type: 'taluna-config' }, SELF, SELF)).toBeNull();
});

test('data 非对象被拒', () => {
  expect(parseHostConfig('nope', SELF, SELF)).toBeNull();
  expect(parseHostConfig(null, SELF, SELF)).toBeNull();
});

test('theme=light → light', () => {
  expect(parseHostConfig(msg({ theme: 'light' }), SELF, SELF)).toEqual({ theme: 'light' });
});

test('theme=dark / 缺省 / 非法 → dark', () => {
  expect(parseHostConfig(msg({ theme: 'dark' }), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({}), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({ theme: 'wat' }), SELF, SELF)).toEqual({ theme: 'dark' });
});

test('lang 非空字符串被带上', () => {
  expect(parseHostConfig(msg({ theme: 'light', lang: 'zh' }), SELF, SELF)).toEqual({ theme: 'light', lang: 'zh' });
});

test('lang 空串 / 非字符串被丢弃', () => {
  expect(parseHostConfig(msg({ theme: 'dark', lang: '' }), SELF, SELF)).toEqual({ theme: 'dark' });
  expect(parseHostConfig(msg({ theme: 'dark', lang: 123 }), SELF, SELF)).toEqual({ theme: 'dark' });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/host-config.test.ts`
Expected: FAIL —— `parseHostConfig` 未定义 / 无法导入。

- [ ] **Step 3: 写最小实现**

`src/lib/host-config.ts`：

```ts
// 解析主站经 postMessage 下发的配置帧(taluna-config),校验来源与形状并归一。
// 纯函数、无副作用:仅做解析 / 归一,DOM 与监听由 src/client/useHostConfig.ts 负责。
// 分站不回写 localStorage —— taluna-config 完全由主站管理。

export interface HostConfig {
  theme: 'light' | 'dark';
  lang?: string;
}

// 主站消息格式:{ type:'taluna-config', key:'taluna-config', config:{ lang, theme } }
// origin 必须等于自身 origin —— 分站部署在主站同源 /game 路径下。
export function parseHostConfig(data: unknown, origin: string, selfOrigin: string): HostConfig | null {
  if (origin !== selfOrigin) return null; // 来源校验:仅接受同源
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; config?: unknown };
  if (msg.type !== 'taluna-config') return null;
  if (typeof msg.config !== 'object' || msg.config === null) return null;
  const config = msg.config as { theme?: unknown; lang?: unknown };
  // theme 归一沿用防白闪脚本逻辑:仅 'light' 走浅色,其余 / 缺省 / 异常一律深色
  const result: HostConfig = { theme: config.theme === 'light' ? 'light' : 'dark' };
  if (typeof config.lang === 'string' && config.lang) result.lang = config.lang;
  return result;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/host-config.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/host-config.ts src/lib/host-config.test.ts
git commit -m "feat: parseHostConfig 解析主站 taluna-config 帧(同源校验+theme/lang 归一)"
```

---

## Task 2: `useIsDark` 改为 MutationObserver 响应

**Files:**
- Modify: `src/client/useIsDark.ts`
- Test: `src/client/useIsDark.test.ts`（已存在，补充）

- [ ] **Step 1: 写失败测试**

在 `src/client/useIsDark.test.ts` 顶部调整两行 import（合并进既有 vitest 导入，避免 `no-duplicate-imports`），并追加一条响应性测试：

把第 1 行
```ts
import { beforeEach, expect, test } from 'vitest';
```
改为
```ts
import { beforeEach, expect, test, vi } from 'vitest';
```

把第 2 行
```ts
import { renderHook } from '@testing-library/react';
```
改为
```ts
import { act, renderHook } from '@testing-library/react';
```

在文件末尾追加：
```ts
test('运行期改 data-theme → 快照随之更新(MutationObserver)', async () => {
  const { result } = renderHook(() => useIsDark());
  expect(result.current).toBe(true); // 缺省深色
  act(() => { document.documentElement.dataset.theme = 'light'; });
  // MutationObserver 异步投递,等回调触发 store 通知后重渲染
  await vi.waitFor(() => expect(result.current).toBe(false));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useIsDark.test.ts`
Expected: 新增用例 FAIL —— 当前 `subscribe` 为 no-op，改 `data-theme` 后快照不更新，`result.current` 仍为 `true`，`waitFor` 超时失败。

- [ ] **Step 3: 改实现**

把 `src/client/useIsDark.ts` 整文件替换为：

```ts
'use client';
import { useSyncExternalStore } from 'react';

// 主题由主站写入 <html data-theme>:首屏由 layout.tsx 内联脚本读 localStorage 设置;
// 运行期由主站经 postMessage 下发,useHostConfig 更新 data-theme(见 src/client/useHostConfig.ts)。
// 本 hook 监听 data-theme 变更,组件据此挑选明 / 暗样式分支并自动重渲染。
// SSR 与首帧均按默认深色渲染,挂载后读取真实 data-theme;用 useSyncExternalStore
// 保证 SSR 安全(服务端取 server 快照,水合后再切到客户端真实值,不报 hydration mismatch)。
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
};
const getSnapshot = () => document.documentElement.dataset.theme !== 'light';
const getServerSnapshot = () => true; // 服务端 / 首帧默认深色

export function useIsDark() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useIsDark.test.ts`
Expected: PASS（原有 3 条 + 新增 1 条）。

- [ ] **Step 5: 提交**

```bash
git add src/client/useIsDark.ts src/client/useIsDark.test.ts
git commit -m "feat: useIsDark 改用 MutationObserver 监听 data-theme,支持运行期主题切换"
```

---

## Task 3: `useHostConfig` 副作用 hook

**Files:**
- Create: `src/client/useHostConfig.ts`
- Test: `src/client/useHostConfig.test.tsx`

- [ ] **Step 1: 写失败测试**

`src/client/useHostConfig.test.tsx`：

```tsx
import { beforeEach, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHostConfig } from './useHostConfig';

// jsdom 下 window.location.origin 即自身 origin,用它构造合法同源消息
const SELF = window.location.origin;
const post = (data: unknown, origin = SELF) =>
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, origin })); });

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
});

test('合法同源消息 → 更新 data-theme 与 lang', () => {
  renderHook(() => useHostConfig());
  post({ type: 'taluna-config', key: 'taluna-config', config: { theme: 'light', lang: 'zh' } });
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(document.documentElement.lang).toBe('zh');
});

test('只带 theme 的消息 → 仅更新 data-theme', () => {
  renderHook(() => useHostConfig());
  post({ type: 'taluna-config', config: { theme: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.lang).toBe(''); // lang 缺省未被改动
});

test('异源消息 → DOM 不变', () => {
  renderHook(() => useHostConfig());
  post({ type: 'taluna-config', config: { theme: 'light' } }, 'https://evil.com');
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test('畸形消息(type 不符) → DOM 不变', () => {
  renderHook(() => useHostConfig());
  post({ type: 'other', config: { theme: 'light' } });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

test('卸载后再发消息 → 无副作用', () => {
  const { unmount } = renderHook(() => useHostConfig());
  unmount();
  post({ type: 'taluna-config', config: { theme: 'light' } });
  expect(document.documentElement.dataset.theme).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useHostConfig.test.tsx`
Expected: FAIL —— `useHostConfig` 未定义 / 无法导入。

- [ ] **Step 3: 写最小实现**

`src/client/useHostConfig.ts`：

```ts
'use client';
import { useEffect } from 'react';
import { parseHostConfig } from '@/lib/host-config';

// 监听主站经 postMessage 下发的配置帧(taluna-config),实时把主题 / 语言应用到 <html>。
// 分站不回写 localStorage —— taluna-config 完全由主站管理(刷新后由防白闪脚本读取)。
// 仅在值变化时写 DOM,避免无谓 mutation 触发 useIsDark 的 MutationObserver 空转。
export function useHostConfig() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        const config = parseHostConfig(e.data, e.origin, window.location.origin);
        if (!config) return;
        const root = document.documentElement;
        if (root.dataset.theme !== config.theme) root.dataset.theme = config.theme;
        if (config.lang && root.lang !== config.lang) root.lang = config.lang;
      } catch {
        // 非法帧跳过(沿用"非法 WS 帧 try/catch 跳过"哲学)
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useHostConfig.test.tsx`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/client/useHostConfig.ts src/client/useHostConfig.test.tsx
git commit -m "feat: useHostConfig 监听主站 taluna-config 帧,实时写 <html> data-theme/lang"
```

---

## Task 4: 接线（防白闪脚本补 lang + Workspace 挂载）

> 本任务为集成接线，与既有 `layout.tsx`（内联脚本，不单测）一致，不写单测；以 tsc / lint / 全量测试 / build 作为验证门。

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/components/workspace/Workspace.tsx`

- [ ] **Step 1: 防白闪脚本同步设 lang**

`src/app/layout.tsx`：把现有内联脚本与其上方注释替换。

注释（第 14-17 行附近）替换为：
```tsx
        {/* 水合前读取主站写入 localStorage 的配置并设置 <html>,避免白闪。
            本应用为分站,不自管配置:主站把配置存于 'taluna-config'(JSON,含 theme:'dark'|'light' 与 lang,
            完全由主站管理);仅 theme==='light' 走浅色,其余 / 缺省 / 解析失败均回退深色;lang 为非空字符串时设到 <html lang>。
            运行期由主站经 postMessage 下发变更,见 src/client/useHostConfig.ts。 */}
```

内联脚本 `__html` 字符串替换为：
```ts
            __html: `(function(){try{var c=JSON.parse(localStorage.getItem('taluna-config')||'{}');document.documentElement.dataset.theme=c.theme==='light'?'light':'dark';if(typeof c.lang==='string'&&c.lang)document.documentElement.lang=c.lang;}catch(e){document.documentElement.dataset.theme='dark';}})();`,
```

- [ ] **Step 2: Workspace 挂载 hook**

`src/components/workspace/Workspace.tsx`：

在 import 区（`import { useAuthGuard } from '@/client/useAuthGuard';` 之后）加：
```tsx
import { useHostConfig } from '@/client/useHostConfig';
```

在组件体内与其它全局 hook 并列（`useAuthGuard();` 之后）加：
```tsx
  useHostConfig();
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: 无错误。

- [ ] **Step 5: 全量测试**

Run: `pnpm test`
Expected: 全绿（含本计划新增的 3 个测试文件）。

- [ ] **Step 6: 构建确认**

Run: `pnpm build`
Expected: 构建成功。

- [ ] **Step 7: 提交**

```bash
git add src/app/layout.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: 防白闪脚本同步 lang,Workspace 挂载 useHostConfig 接入实时配置"
```

---

## 验证清单（全部完成后）

- [ ] `pnpm test` 全绿
- [ ] `pnpm exec tsc --noEmit` 无错误
- [ ] `pnpm lint` 无错误
- [ ] `pnpm build` 成功
- [ ] 设计稿目标逐条对应：主题实时响应（Task 2+3）、lang 接收并同步 `<html lang>`（Task 1+3+4）、来源校验与畸形容错（Task 1+3）、不回写 localStorage（Task 3 实现 + Task 4 脚本只读）
