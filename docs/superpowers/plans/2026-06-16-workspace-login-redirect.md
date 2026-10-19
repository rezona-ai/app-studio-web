# Workspace 登录态校验 + 跳转登录 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 进入 Workspace（`/studio`）时校验登录态，未登录跳转环境 sign-in 页并登录后回跳；本地开发不跳转。

**Architecture:** 复用现有「PGC 401 → `store/actions.ts` 的 `guard` 漏斗」鉴权边界：401 置瞬态标志 `ServerState.authRequired`；`client/useAuthGuard` hook 监听该标志，在非 localhost 环境整页跳转 `${origin}/sign-in?redirect=<完整 href>`。localhost 判定与 URL 拼接是纯函数，下沉 `lib/auth.ts` 单测覆盖。

**Tech Stack:** Next.js 16 / React 19 / Zustand / Vitest（jsdom + globals，`@`→`src`）。

设计稿：`docs/superpowers/specs/2026-06-16-workspace-login-redirect-design.md`。

---

### Task 1: 纯逻辑 `lib/auth.ts`（localhost 判定 + sign-in URL 拼接）

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/auth.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { isLocalhost, buildSignInUrl } from './auth';

describe('isLocalhost', () => {
  test('本地开发各形态为 true', () => {
    expect(isLocalhost('localhost')).toBe(true);
    expect(isLocalhost('127.0.0.1')).toBe(true);
    expect(isLocalhost('0.0.0.0')).toBe(true);
    expect(isLocalhost('app.localhost')).toBe(true);
  });
  test('环境域名为 false', () => {
    expect(isLocalhost('tlndev.taluna.ai')).toBe(false);
    expect(isLocalhost('taluna.ai')).toBe(false);
  });
});

describe('buildSignInUrl', () => {
  test('拼接 origin + /sign-in,redirect 经 encodeURIComponent', () => {
    const url = buildSignInUrl('https://tlndev.taluna.ai', 'https://tlndev.taluna.ai/game/studio?project=8');
    expect(url).toBe('https://tlndev.taluna.ai/sign-in?redirect=https%3A%2F%2Ftlndev.taluna.ai%2Fgame%2Fstudio%3Fproject%3D8');
  });
  test('sign-in 在主站根,不带 basePath', () => {
    const url = buildSignInUrl('https://tlndev.taluna.ai', 'https://tlndev.taluna.ai/game/studio');
    expect(url.startsWith('https://tlndev.taluna.ai/sign-in?redirect=')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/auth.test.ts`
Expected: FAIL（`isLocalhost`/`buildSignInUrl` is not a function / 模块不存在）

- [ ] **Step 3: 写最小实现**

`src/lib/auth.ts`：

```ts
// 登录跳转的纯逻辑:localhost 判定 + sign-in URL 拼接。副作用(整页跳转)见 client/useAuthGuard。

/** localhost 判定:本地开发不跳转 sign-in(跨域 + 登录后 cookie 落 .taluna.ai,localhost 读不到会死循环) */
export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname.endsWith('.localhost');
}

/** 拼 sign-in 跳转地址。origin 取 window.location.origin(生产本应用与主站同源,自动适配 tlndev/prod);
    sign-in 在主站根,不带 basePath。returnHref 用完整 href(含 basePath 与 ?project=),登录后原样回跳。 */
export function buildSignInUrl(origin: string, returnHref: string): string {
  return `${origin}/sign-in?redirect=${encodeURIComponent(returnHref)}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/auth.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: 登录跳转纯逻辑(isLocalhost/buildSignInUrl)"
```

---

### Task 2: PGC 401 置 `authRequired`（store 状态 + `guard`）

**Files:**
- Modify: `src/store/types.ts`（`ServerState` 接口 + `createInitialServerState`）
- Modify: `src/store/actions.ts:24-30`（`guard`）
- Test: `src/store/actions.test.ts`（扩展，约 line 86 附近）

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 的「项目 actions」describe 内，把现有 401 用例之后追加两个用例（紧跟 line 90 之后）：

```ts
  test('loadProjects 遇 401 置 authRequired(触发跳转 sign-in)', async () => {
    api.listProjects.mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    await useStore.getState().loadProjects();
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().lastError?.code).toBe('UNAUTHORIZED');
  });

  test('loadProjects 遇 403(已登录无权限)不置 authRequired', async () => {
    api.listProjects.mockRejectedValue(new PgcError('FORBIDDEN', '无权限', 403));
    await useStore.getState().loadProjects();
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().lastError?.code).toBe('FORBIDDEN');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "authRequired"`
Expected: FAIL（401 用例期望 `true` 实得 `undefined`；初始 state 无 `authRequired` 字段）

- [ ] **Step 3: 实现——加状态字段**

`src/store/types.ts`：在 `ServerState` 接口内 `lastError` 字段旁新增（保持与 `booting`/`lastError` 同性质：瞬态不持久化）：

```ts
  authRequired: boolean;   // 检测到未登录(PGC 401),触发跳转 sign-in;瞬态不持久化
```

并在 `createInitialServerState()` 返回对象里加 `authRequired: false`（与 `lastError: null` 并列）。

- [ ] **Step 4: 实现——`guard` 401 置位**

`src/store/actions.ts` 把 `guard`（line 24-30）改为：

```ts
// 统一错误兜底:PgcError 写 lastError,其余照抛(便于发现 bug);401(未登录)额外置 authRequired 触发跳转
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) {
      // 401 = 未登录:置 authRequired(本地不跳转,见 useAuthGuard;lastError 仍写,本地靠 Toast 提示)
      set({ lastError: { code: e.code, message: e.message }, ...(e.status === 401 ? { authRequired: true } : {}) });
    } else throw e;
  }
}
```

（`guard` 的 `Set` 类型为 `Partial<StoreSlice>` = `KoubouState & ServerState`，`authRequired` 归 `ServerState`，可直接 set，无需放宽类型。）

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含新增两用例与原有用例全绿）

- [ ] **Step 6: 提交**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: PGC 401 置 authRequired,403 等不置位"
```

---

### Task 3: 副作用 hook `client/useAuthGuard.ts`

**Files:**
- Create: `src/client/useAuthGuard.ts`

- [ ] **Step 1: 创建 hook**

`src/client/useAuthGuard.ts`：

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isLocalhost, buildSignInUrl } from '@/lib/auth';

// 监听未登录标志,非 localhost 环境整页跳转到 sign-in(登录后回跳原页面)。
// 决策逻辑全在 lib/auth(可单测),此处仅做副作用胶水。挂在 Workspace,使 gate 仅作用于 /studio。
export function useAuthGuard(): void {
  const authRequired = useStore((s) => s.authRequired);
  const fired = useRef(false);
  useEffect(() => {
    if (!authRequired || fired.current) return;
    const { hostname, origin, href } = window.location;
    if (isLocalhost(hostname)) return;   // 本地靠 DEV_COOKIE,不跳转(跳了也因 cookie 跨域死循环)
    fired.current = true;                // 防重复跳转
    window.location.assign(buildSignInUrl(origin, href));
  }, [authRequired]);
}
```

- [ ] **Step 2: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 无错误（hook 通过类型检查与 lint）

- [ ] **Step 3: 提交**

```bash
git add src/client/useAuthGuard.ts
git commit -m "feat: useAuthGuard hook,未登录非本地跳转 sign-in"
```

---

### Task 4: 接入 Workspace（挂载 hook + 防闪屏）

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`（import、hook 挂载、加载层判定）

- [ ] **Step 1: 引入 hook**

在 `src/components/workspace/Workspace.tsx` 顶部 import 区（第 7 行 `useCanvasAutoImport` 之后）新增：

```ts
import { useAuthGuard } from '@/client/useAuthGuard';
```

- [ ] **Step 2: 挂载 hook + 订阅 authRequired**

在组件体内：把第 28 行

```ts
  const booting = useStore((s) => s.booting);
```

改为下面两行：

```ts
  const booting = useStore((s) => s.booting);
  const authRequired = useStore((s) => s.authRequired);
```

并在 `useCanvasAutoImport();`（第 35 行）之后新增一行：

```ts
  useAuthGuard();
```

- [ ] **Step 3: 防闪屏——加载层判定加 authRequired**

把第 102 行

```tsx
      {booting && <LoadingScreen className="fixed inset-0 z-50" label="Loading workspace…" />}
```

改为：

```tsx
      {/* 启动加载或检测到未登录(跳转 sign-in 前):全局加载层盖住整个工作区,避免空工作台闪现 */}
      {(booting || authRequired) && <LoadingScreen className="fixed inset-0 z-50" label="Loading workspace…" />}
```

- [ ] **Step 4: 类型检查 + lint + 全量测试 + 构建**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`
Expected: 全部通过（tsc 无错、lint 无错、vitest 全绿、next build 成功）

- [ ] **Step 5: 提交**

```bash
git add src/components/workspace/Workspace.tsx
git commit -m "feat: Workspace 接入登录跳转 gate 并加载层防闪屏"
```

---

## 手动验证（本地，无法被单测覆盖的导航行为）

> jsdom 不实现 `window.location` 导航，hook 的跳转行为靠以下手验。

1. **本地正常登录态**：设好 `DEV_COOKIE`，`pnpm dev` 访问 `http://localhost:3000/studio` → 正常加载工作区，不跳转。
2. **本地未登录**：临时清空 / 写错 `DEV_COOKIE` 重启，访问 `/studio` → 不跳转（localhost 跳过），加载层后弹未授权 Toast。
3. **跳转链路（构造 401）**：临时在 `useAuthGuard` 把 `isLocalhost` 判定短路为 `false`（仅本地试验，勿提交），触发后确认浏览器跳到 `${origin}/sign-in?redirect=<当前完整 href，含 ?project=>`，且 `redirect` 已 URL 编码。验完还原。

---

## Self-Review

- **Spec 覆盖**：状态 `authRequired`（Task 2）· 触发 `guard` 401（Task 2）· 纯逻辑 `lib/auth`（Task 1）· hook `useAuthGuard`（Task 3）· Workspace 挂载 + 防闪屏（Task 4）· 测试计划（Task 1/2 含；hook 手验，见上）。范围边界（仅 PGC 401、origin 派生、不做 middleware）与 spec 一致。
- **占位扫描**：无 TBD/TODO，每步含完整代码与命令。
- **类型一致**：`authRequired:boolean`、`isLocalhost(hostname:string)`、`buildSignInUrl(origin,returnHref)`、`useAuthGuard()` 在各 Task 间签名一致。
