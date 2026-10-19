# Workspace 登录态校验 + 跳转登录 设计稿

> 日期：2026-06-16 · 状态：待评审

## 背景与目标

用户进入 Workspace（`/studio`，`StudioPage → <Workspace/>`）时需先校验登录态：

- **已登录**：照常加载项目 / 画布 / 版本。
- **未登录**：跳转到环境的 sign-in 页，登录完成后回跳到原页面（含 `?project=` 等查询）。
- **本地开发（localhost:3000）**：与环境 sign-in 跨域，**不跳转**，沿用服务端注入的 `DEV_COOKIE` 鉴权。

跳转地址形如：`https://tlndev.taluna.ai/sign-in?redirect=<登录后回跳的完整地址>`。

## 现状（事实依据）

- 鉴权是 cookie 制（biz-api 统一鉴权）。浏览器 `/api/*` 请求带 `credentials:'include'`，Next 代理透传 cookie 给上游，未登录时上游回 **HTTP 401**（`server/pgc/proxy.test.ts` 验证代理原样透传 401）。
- `src/lib/pgc/client.ts` 的 `unwrap` 见 `!res.ok` 即抛 `PgcError(code, message, status)`，401 时 `status===401`。
- `src/store/actions.ts` 的 `guard()` 是 PGC 调用的统一错误漏斗：捕获 `PgcError` → 写 `lastError`（→ Toast），其余照抛。现有用例 `store/actions.test.ts` 已断言 `loadProjects` 401 → `lastError`。
- 进入 Workspace 时 `useProjectBootstrap → loadProjects()`（经 `guard`）是第一个鉴权请求。
- 生产部署：本应用与主站**同源**（`*.taluna.ai/game` ↔ 主站 `*.taluna.ai/sign-in`）；本地为 `localhost:3000`，浏览器拿不到 `.taluna.ai` cookie，故服务端用 `DEV_COOKIE` 兜底。
- `lastError` / `booting` 均在 `ServerState`（`createInitialServerState()`），属瞬态，不在 persist 白名单。

## 方案概述

复用现有「PGC 401 → `guard` 漏斗」这一鉴权边界：401 即判未登录，置一个瞬态标志 `authRequired`；一个 `client/` hook 监听该标志，在非 localhost 环境执行整页跳转到 sign-in。纯逻辑（localhost 判定、sign-in URL 拼接）下沉到 `lib/auth.ts` 单测覆盖，hook 仅薄胶水。

### 数据流

```
loadProjects()（进入 Workspace 首个鉴权请求，经 guard）
  └─ 未登录 → PGC 401 → PgcError(status:401)
       └─ guard 捕获：set({ lastError, authRequired: true })
            └─ useAuthGuard（挂在 Workspace）监听 authRequired
                 ├─ isLocalhost → 不跳转（靠 DEV_COOKIE；lastError 走 Toast 提示更新 cookie）
                 └─ 否则 window.location.assign(`${origin}/sign-in?redirect=<href>`)
```

## 详细设计

### 1. 状态：`ServerState.authRequired`

- `src/store/types.ts`：`ServerState` 新增 `authRequired: boolean`（注释：检测到未登录，触发跳转 sign-in；瞬态不持久化）。
- `createInitialServerState()` 初始 `authRequired: false`。
- `src/store/index.ts` 的 `partialize` **不**加入该字段（保持瞬态，刷新即重置）。
- 不随切项目重置（全局鉴权态，非项目维度）。

### 2. 触发：扩展 `guard()`（`src/store/actions.ts`）

```ts
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) {
      // 401 = 未登录：置 authRequired 触发跳转(本地不跳,lastError 仍弹 Toast 提示)
      set({ lastError: { code: e.code, message: e.message }, ...(e.status === 401 ? { authRequired: true } : {}) });
    } else throw e;
  }
}
```

- `guard` 的 `Set` 类型为 `Partial<StoreSlice>`（`KoubouState & ServerState`），`authRequired` 归 `ServerState` 故可直接 set，无需放宽类型。
- 仅 `status===401` 置位；403（已登录但无权限）等其余 `PgcError` 不置位，只写 `lastError`。

### 3. 纯逻辑：`src/lib/auth.ts`（TDD，先写测试）

```ts
/** localhost 判定:本地开发不跳转 sign-in(跨域 + cookie 落 .taluna.ai 读不到会死循环) */
export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname.endsWith('.localhost');
}

/** 拼 sign-in 跳转地址。origin 取当前 window.location.origin(生产与主站同源,自动适配 tlndev/prod);
    sign-in 在主站根,不带 basePath。returnHref 用完整 href(含 basePath 与 ?project=),登录后原样回跳。 */
export function buildSignInUrl(origin: string, returnHref: string): string {
  return `${origin}/sign-in?redirect=${encodeURIComponent(returnHref)}`;
}
```

### 4. 副作用：`src/client/useAuthGuard.ts`

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isLocalhost, buildSignInUrl } from '@/lib/auth';

// 监听未登录标志,非 localhost 环境整页跳转到 sign-in(登录后回跳原页面)。
// 逻辑全在 lib/auth(可单测),此处仅做副作用胶水。
export function useAuthGuard(): void {
  const authRequired = useStore((s) => s.authRequired);
  const fired = useRef(false);
  useEffect(() => {
    if (!authRequired || fired.current) return;
    const { hostname, origin, href } = window.location;
    if (isLocalhost(hostname)) return;   // 本地靠 DEV_COOKIE,不跳转
    fired.current = true;                // 防重复跳转
    window.location.assign(buildSignInUrl(origin, href));
  }, [authRequired]);
}
```

- 在 `src/components/workspace/Workspace.tsx` 顶部与其它 hooks 一并挂载 `useAuthGuard()`，使该 gate 仅作用于 `/studio`。

### 5. 防闪屏

`Workspace` 的全局加载层判定由 `booting` 改为 `booting || authRequired`：401 跳转前继续显示 `LoadingScreen`，避免未登录用户看到一帧空工作台。

## 范围边界（YAGNI）

- **仅纳入 PGC 401**。Koubou 的 ws-ticket 签发 / `listSessions` / WS `4401` 等 401 路径**不纳入 v1**——它们只在 `loadProjects` 成功（已登录）后才发起；`authRequired` 标志通用，未来若要让 Koubou 401 也触发跳转，加一处 `set({ authRequired: true })` 即可。
- sign-in base **从 origin 派生**，不引入 `NEXT_PUBLIC_SIGN_IN_URL` env，不硬编码 `tlndev`。
- 不做 Next middleware 服务端 gate（cookie 仅存在不等于会话有效；客户端调用真实校验会话，且天然处理 localhost 与 basePath）。

## 测试计划

- `src/lib/auth.test.ts`（TDD 先行）：
  - `isLocalhost`：`localhost` / `127.0.0.1` / `0.0.0.0` / `app.localhost` → true；`tlndev.taluna.ai` / `taluna.ai` → false。
  - `buildSignInUrl`：正确拼接 `origin + /sign-in?redirect=`，`redirect` 经 `encodeURIComponent`（含 `:`、`/`、`?`、`=` 的 href 被正确编码）。
- `src/store/actions.test.ts`（扩展现有）：
  - `loadProjects` 401 → `authRequired === true` 且 `lastError.code` 正确。
  - `loadProjects` 403 → `authRequired === false`，仅 `lastError`。
- `useAuthGuard` 为薄胶水（决策逻辑都在纯 lib），由 lib 测试 + 手动验证覆盖；不在 jsdom 里测 `window.location.assign`（jsdom 不实现导航）。

## 影响文件

| 文件 | 变更 |
|---|---|
| `src/store/types.ts` | `ServerState` 加 `authRequired`，初始 `false` |
| `src/store/actions.ts` | `guard` 在 `PgcError.status===401` 时置 `authRequired` |
| `src/lib/auth.ts` | 新增：`isLocalhost` / `buildSignInUrl` |
| `src/lib/auth.test.ts` | 新增：纯逻辑单测 |
| `src/client/useAuthGuard.ts` | 新增：监听 `authRequired` → 跳转 |
| `src/components/workspace/Workspace.tsx` | 挂 `useAuthGuard()`；加载层判定加 `authRequired` |
| `src/store/actions.test.ts` | 扩展 401/403 用例 |
