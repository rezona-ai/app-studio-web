# 未登录不报错,直接跳转登录 设计稿

> 日期：2026-06-17 · 状态：待评审 · 关联：[2026-06-16-workspace-login-redirect-design](./2026-06-16-workspace-login-redirect-design.md)

## 背景与目标

[登录态校验 + 跳转登录](./2026-06-16-workspace-login-redirect-design.md) 落地后,未登录进入 Workspace 时:401 经 `guard()` **同时**写了 `lastError`(→ 底部 Toast,红色报错样式)与 `authRequired`(→ 跳转)。导致:

- **生产**:跳转 sign-in 前底部会**闪一帧红色报错**(Toast z-100 盖在加载层 z-50 之上),且会停留到整页导航生效。未登录本是正常态,不该以报错形式呈现。
- **localhost**:`useAuthGuard` 故意清 `authRequired`(撤加载层),**靠那条红色 Toast** 提示更新 `DEV_COOKIE`(commit `acb4c68`)。提示本身要保留,但红色「报错」口吻不合适。

**目标**:未登录(401)不再以报错形式呈现。

- **生产**:静默整页跳转 sign-in,底部不再出现报错条。
- **localhost**:保留提示,但改为**非报错口吻的友好提示**(notice),引导更新 `DEV_COOKIE`。

非 401 的 `PgcError`(403 无权限、500 等)仍照常红色报错(不变)。

## 现状(事实依据)

- `src/store/actions.ts` 的 `guard()`:`PgcError` → `set({ lastError, ...(status===401 ? { authRequired:true } : {}) })`。即 401 既写 `lastError` 又置 `authRequired`。
- `src/client/useAuthGuard.ts`:监听 `authRequired`;localhost 分支 `clearAuthRequired()` 后**不**额外做任何事——提示完全依赖 `guard` 写下的那条 `lastError`(其文案就是后端 401 的 `code/message`,并非显式的 DEV_COOKIE 文案)。
- `src/components/ui/Toast.tsx`:订阅 `lastError`,把 `code` 渲染成**硬编码 `text-red-600`**,4s 自动消失。
- `src/store/types.ts`:`lastError: { code: string; message: string } | null`,属瞬态(不在 persist 白名单)。
- `lastError` 的其它写入方:`store/index.ts` 的 agent error 事件 `{ code:'AGENT', message }`(真错误,保持红色)。

## 方案概述

两点改动 + 一个轻量扩展:

1. **`guard()` 401 分支不再写 `lastError`**——只置 `authRequired`。报错条从「所有 401」彻底解耦。
2. **底部提示条引入 severity**——`lastError` 载荷加可选 `kind?: 'error' | 'notice'`(默认 `'error'`)。`Toast` 仅 `error` 时红色,`notice` 用中性色。字段名仍叫 `lastError`,避免大面积改名。
3. **localhost 提示改由 `useAuthGuard` 显式下发 notice**——清 `authRequired` 后 `setError({ code, message, kind:'notice' })`,文案明确指向 DEV_COOKIE。

### 数据流

```
loadProjects()（经 guard）未登录 → PGC 401
  └─ guard：set({ authRequired: true })          // 不再写 lastError
       └─ useAuthGuard 监听 authRequired
            ├─ 非 localhost → window.location.assign(sign-in)   // 静默跳转,底部无报错
            └─ localhost → clearAuthRequired() + setError({ kind:'notice', ... })  // 友好提示
```

## 详细设计

### 1. `lastError` 加 severity(`src/store/types.ts`)

```ts
lastError: { code: string; message: string; kind?: 'error' | 'notice' } | null;
```

- `kind` 可选,缺省视为 `'error'`(现有所有写入方无需改动即保持红色)。
- `setError` 签名同步放宽(`src/store/index.ts`)。

### 2. `Toast` 按 severity 着色(`src/components/ui/Toast.tsx`)

- `code` 文案颜色:`error`(含缺省)→ `text-red-600`;`notice` → `var(--color-muted)`(中性,不报错)。
- 其余结构(位置、4s 自动消失、关闭按钮)不变。

### 3. `guard()` 401 分支去掉 `lastError`(`src/store/actions.ts`)

```ts
async function guard(set: Set, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (e) {
    if (e instanceof PgcError) {
      // 401 = 未登录:只置 authRequired 触发跳转/本地提示,不当报错弹 Toast;其余 PgcError 照常写 lastError
      if (e.status === 401) set({ authRequired: true });
      else set({ lastError: { code: e.code, message: e.message } });
    } else throw e;
  }
}
```

### 4. localhost 改弹 notice(`src/client/useAuthGuard.ts`)

```ts
const setError = useStore((s) => s.setError);
// ...
if (isLocalhost(hostname)) {
  // 本地靠 DEV_COOKIE 鉴权,不跳转(跳了也因 cookie 跨域死循环);清标志撤加载层,改弹非报错口吻的提示引导更新 DEV_COOKIE
  clearAuthRequired();
  setError({ code: '未登录', message: '本地未鉴权,请更新 DEV_COOKIE 后刷新', kind: 'notice' });
  return;
}
```

- 生产分支(`window.location.assign`)不变,且因 `guard` 不再写 `lastError`,跳转前底部干净。

## 范围边界(YAGNI)

- 不新增独立的 notice 组件 / store 字段——复用现有底部 Toast + `lastError`,加一个 `kind` 即可,代价最小。
- 不改 notice 的自动消失时长(沿用 4s,与现状一致)。
- 不动 403/500 等非 401 报错路径。

## 测试计划

- `src/store/actions.test.ts`(改现有用例):
  - **401** → `authRequired === true` 且 **`lastError === null`**(新契约:401 不再写报错)。
  - 原「PgcError → 写 lastError 不抛出」用例改用**非 401**(如 500)状态,继续验证通用兜底。
  - **403** → `authRequired === false` 且 `lastError.code === 'FORBIDDEN'`(不变)。
- `src/client/useAuthGuard.test.tsx`(扩展现有 localhost 用例):
  - localhost → `authRequired` 被清 **且** `lastError?.kind === 'notice'`。
- 生产跳转(`window.location.assign`)仍不在 jsdom 测(不实现导航),由手动验证覆盖。

## 影响文件

| 文件 | 变更 |
|---|---|
| `src/store/types.ts` | `lastError` 载荷加可选 `kind` |
| `src/store/index.ts` | `setError` 签名同步放宽 |
| `src/components/ui/Toast.tsx` | 按 `kind` 着色(notice 中性色) |
| `src/store/actions.ts` | `guard` 401 分支只置 `authRequired`,不写 `lastError` |
| `src/client/useAuthGuard.ts` | localhost 分支清标志后下发 `notice` 提示 |
| `src/store/actions.test.ts` | 改 401 / 通用 PgcError 用例 |
| `src/client/useAuthGuard.test.tsx` | localhost 用例加 notice 断言 |
