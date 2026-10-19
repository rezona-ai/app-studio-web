# 未登录不报错,直接跳转登录 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未登录(PGC 401)不再以红色报错条呈现——生产静默跳转 sign-in,localhost 改弹非报错口吻的 notice 提示。

**Architecture:** 三步:① 给底部提示条载荷加 `kind?: 'error' | 'notice'`(默认 error)并让 `Toast` 按 severity 着色;② `guard()` 的 401 分支只置 `authRequired`、不再写 `lastError`;③ `useAuthGuard` localhost 分支清标志后显式下发一条 notice。

**Tech Stack:** Next.js 16 / React 19 / zustand / Vitest(jsdom + globals)/ Tailwind。

设计稿:`docs/superpowers/specs/2026-06-17-unauthenticated-no-error-toast-design.md`

---

## 文件结构

| 文件 | 责任 / 变更 |
|---|---|
| `src/store/types.ts` | 新增共享类型 `ToastMessage`,`ServerState.lastError` 改用它 |
| `src/store/index.ts` | `setError` 签名改用 `ToastMessage` |
| `src/components/ui/Toast.tsx` | `code` 文案按 `kind` 着色(notice 中性色) |
| `src/store/actions.ts` | `guard` 401 分支只置 `authRequired`,不写 `lastError` |
| `src/client/useAuthGuard.ts` | localhost 分支清标志后下发 `notice` |
| `src/store/actions.test.ts` | 改 401 / 通用 PgcError 用例(新契约) |
| `src/client/useAuthGuard.test.tsx` | localhost 用例加 notice 断言 |

---

## Task 1: 给底部提示条引入 severity(`ToastMessage` + Toast 着色)

预备性结构改动:加可选 `kind` 字段(默认按 error 处理,现有写入方零改动),`Toast` 据此着色。纯展示 + 类型,靠 `tsc` 与后续任务的测试覆盖,本任务不单列行为测试。

**Files:**
- Modify: `src/store/types.ts`(新增 `ToastMessage`,改 `lastError` 类型)
- Modify: `src/store/index.ts:6`(导入)、`src/store/index.ts:68`(`setError` 签名)
- Modify: `src/components/ui/Toast.tsx:20`(着色)

- [ ] **Step 1: 在 `types.ts` 新增 `ToastMessage` 类型**

在 `src/store/types.ts` 的 `export interface ServerState {`(第 77 行)**之前**插入:

```ts
// 底部提示条载荷:kind 缺省视为 error(红色报错);notice 为非报错口吻(中性色),用于未登录等正常态提示
export type ToastMessage = { code: string; message: string; kind?: 'error' | 'notice' };
```

- [ ] **Step 2: 把 `ServerState.lastError` 改用 `ToastMessage`**

`src/store/types.ts` 第 88 行:

```ts
  lastError: ToastMessage | null;
```

- [ ] **Step 3: `index.ts` 导入 `ToastMessage` 并改 `setError` 签名**

`src/store/index.ts` 第 6 行的 import 加入 `type ToastMessage`:

```ts
import { createInitialKoubouState, createInitialServerState, type KoubouState, type ServerState, type ToastMessage, type Version, type Message, type PersistedSession } from './types';
```

`src/store/index.ts` 第 68 行:

```ts
  setError: (e: ToastMessage | null) => void;
```

- [ ] **Step 4: `Toast` 按 `kind` 着色**

`src/components/ui/Toast.tsx` 第 20 行,把恒红的 `code` 文案改为按 `kind` 着色:

```tsx
        <span className={`font-semibold ${error.kind === 'notice' ? 'text-[var(--color-muted)]' : 'text-red-600'}`}>{error.code}</span>
```

- [ ] **Step 5: 类型检查 + lint**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均通过,无报错。

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/index.ts src/components/ui/Toast.tsx
git commit -m "feat: 底部提示条加 kind(error/notice)severity,notice 用中性色"
```

---

## Task 2: `guard()` 401 解耦报错条(TDD)

新契约:**401 只置 `authRequired`、不写 `lastError`**(未登录不报错);非 401 的 `PgcError` 照常写 `lastError`。

**Files:**
- Modify: `src/store/actions.test.ts:117-128`(改两个用例)
- Modify: `src/store/actions.ts:23-32`(`guard`)

- [ ] **Step 1: 改测试表达新契约**

`src/store/actions.test.ts` 把「通用 PgcError」用例(原第 117-121 行,用的是 401)改成**非 401**,并把 401 用例(原第 123-128 行)改成「不写 lastError」:

```ts
  test('action 抛非 401 PgcError 时写 lastError 不抛出', async () => {
    api.listProjects.mockRejectedValue(new PgcError('INTERNAL', '服务器错误', 500));
    await useStore.getState().loadProjects();
    expect(useStore.getState().lastError?.code).toBe('INTERNAL');
  });

  test('loadProjects 遇 401 只置 authRequired,不写 lastError(未登录不报错)', async () => {
    api.listProjects.mockRejectedValue(new PgcError('UNAUTHORIZED', '未授权', 401));
    await useStore.getState().loadProjects();
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().lastError).toBeNull();
  });
```

(原第 130-135 行的 403 用例保持不变。)

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "401"`
Expected: FAIL —— 现有 `guard` 在 401 时仍写 `lastError`,故 `expect(lastError).toBeNull()` 不通过。

- [ ] **Step 3: 改 `guard` 让 401 不写 lastError**

`src/store/actions.ts` 第 23-32 行整体替换为:

```ts
// 统一错误兜底:401(未登录)只置 authRequired 触发跳转/本地提示,不当报错;其余 PgcError 写 lastError(→Toast),非 PgcError 照抛(便于发现 bug)
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) {
      // 401 = 未登录:只置 authRequired(见 useAuthGuard:生产跳转、本地弹 notice 提示),不弹红色报错 Toast
      if (e.status === 401) set({ authRequired: true });
      else set({ lastError: { code: e.code, message: e.message } });
    } else throw e;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS(401 / 非 401 / 403 三个用例均通过)。

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: guard 401 只置 authRequired 不写 lastError,未登录不再红色报错"
```

---

## Task 3: `useAuthGuard` localhost 弹 notice(TDD)

`guard` 不再写 lastError 后,localhost 失去 DEV_COOKIE 提示来源;改由 `useAuthGuard` 在清标志后显式下发一条 notice。

**Files:**
- Modify: `src/client/useAuthGuard.test.tsx:12-16`(加 notice 断言)
- Modify: `src/client/useAuthGuard.ts:8-23`(下发 notice)

- [ ] **Step 1: 改测试,断言 localhost 弹 notice**

`src/client/useAuthGuard.test.tsx` 把现有 localhost 用例(第 12-16 行)替换为:

```tsx
  test('localhost 下 authRequired 被清且弹 notice 提示(非报错),不跳转', () => {
    useStore.setState({ authRequired: true });   // 模拟检测到未登录
    act(() => { render(<Probe />); });            // jsdom 默认 hostname=localhost → 走清标志分支
    expect(useStore.getState().authRequired).toBe(false);
    expect(useStore.getState().lastError?.kind).toBe('notice');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useAuthGuard.test.tsx`
Expected: FAIL —— 现有 localhost 分支只清标志、不写 `lastError`,故 `lastError?.kind` 为 `undefined`。

- [ ] **Step 3: localhost 分支下发 notice**

`src/client/useAuthGuard.ts` 第 8-23 行的 `useAuthGuard` 整体替换为:

```ts
export function useAuthGuard(): void {
  const authRequired = useStore((s) => s.authRequired);
  const clearAuthRequired = useStore((s) => s.clearAuthRequired);
  const setError = useStore((s) => s.setError);
  const fired = useRef(false);
  useEffect(() => {
    if (!authRequired || fired.current) return;
    const { hostname, origin, href } = window.location;
    if (isLocalhost(hostname)) {
      // 本地靠 DEV_COOKIE 鉴权,不跳转(跳了也因 cookie 跨域死循环);清标志撤加载层,改弹非报错口吻的 notice 引导更新 DEV_COOKIE
      clearAuthRequired();
      setError({ code: '未登录', message: '本地未鉴权,请更新 DEV_COOKIE 后刷新', kind: 'notice' });
      return;
    }
    fired.current = true;                // 防重复跳转
    window.location.assign(buildSignInUrl(origin, href));
  }, [authRequired, clearAuthRequired, setError]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useAuthGuard.test.tsx`
Expected: PASS。

- [ ] **Step 5: 全量校验**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 类型检查通过,全量测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/client/useAuthGuard.ts src/client/useAuthGuard.test.tsx
git commit -m "feat: 本地未登录改弹 notice 提示更新 DEV_COOKIE,替代红色报错"
```

---

## 手动验证(非 jsdom 覆盖项)

- **生产路径**(`window.location.assign` 跳转)jsdom 不实现导航,不在自动化测试内。部署到 tlndev 后,未登录进入 `/game` 应:底部**无**红色报错条,直接整页跳到 `…/sign-in?redirect=…`。
- **localhost**:清掉 `DEV_COOKIE`(或后端拒绝)后进入 workspace,底部应出现**中性色**的「未登录 / 本地未鉴权,请更新 DEV_COOKIE 后刷新」提示,而非红色报错。
