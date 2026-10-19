# GA4 埋点集成实现计划（game 站 · §4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 game 站（taluna-game）从零接入 GA4，覆盖设计稿《2026-07-09-ga4-analytics-design.md》§4 的 14 个事件与公共参数。

**Architecture:** 纯逻辑下沉 `src/lib/analytics/`（config/events/context/failReason/gameGenerate/gtag，全部无 DOM 副作用或带 SSR 守卫）；副作用绑定在 `src/client/useAnalytics.ts` 与既有触发点；gtag 由 `layout.tsx` 注入。调用点只传专有参数，6 个公共参数由 `track()` 经 `getCommonParams()` 自动补齐。

**Tech Stack:** Next.js 16 + React 19 + zustand + vitest(jsdom)；GA4 gtag.js。

## Global Constraints

- 事件名 / 参数名一律 **小写 snake_case**；布尔一律 `0`/`1`（设计稿 §0-6）。
- **公共参数（6 项）自动注入，业务处不重复传**：`product`='gamestudio' / `env` / `page_name`='editor' / `from_page` / `is_login` / `user_id`。`project_id` / `game_id` **不是**公共参数，按事件表**显式传**（均取 `project.public_id`）。
- **不上报任何任务 id**（不自造 uuid，不传 job_id/run_id/request_id）；success 只带产物实体 id（设计稿 §0-3）。
- **幂等**：同一次生成只报一次 success 或 fail。
- GA4 property：PROD `G-P8ZW92PW19` / TEST `G-H4SNKB0DCX`。`NEXT_PUBLIC_APP_ENV==='prod'` → PROD，其余 → TEST + `debug_mode`。
- 中文注释 / commit message；测试与源码同目录 `*.test.ts(x)`；每个 Task 结束提交一次（中文 message，含 `Claude-Session:` trailer）。
- 代码风格：无副作用纯函数下沉 `lib/`；`await` 后按需 `if (get().currentProjectId !== pid) return`；不新增 UI 令牌/组件。

---

## 文件结构

**新增**
- `src/lib/analytics/config.ts` — `resolveGa4()`：env → { measurementId, env, debug }
- `src/lib/analytics/events.ts` — 事件名联合 + 每事件专有参数类型（真相源）
- `src/lib/analytics/failReason.ts` — `mapFailReason(code?)`：后端 code → `FailReason`
- `src/lib/analytics/gameGenerate.ts` — `gameFailReason(type,payload)` / `pickNewVersion(beforeIds,after)`
- `src/lib/analytics/context.ts` — `parseFromPage` / `initFromPage` / `projectPublicId` / `getCommonParams`
- `src/lib/analytics/gtag.ts` — `track` / `trackAndWait` / `setUserId`（SSR/无 gtag 守卫）
- `src/lib/analytics/index.ts` — barrel（re-export）
- `src/client/useAnalytics.ts` — page_view + from_page 锁定 + user_id 订阅
- 各 `*.test.ts(x)`

**改动**
- `src/app/layout.tsx`、`src/components/workspace/Workspace.tsx`
- `src/components/chat/Composer.tsx`、`src/components/chat/ModelSelector.tsx`
- `src/client/useKoubouConnection.ts`
- `src/store/actions.ts`、`src/store/types.ts`（GenTask 扩展）
- `src/components/canvas/`（无需改 GenerateForm）
- `src/components/preview/FileMenu.tsx`、`SharePopover.tsx`、`RezonaPublishModal.tsx`
- `src/components/ui/CreditModal.tsx`
- `deploy/dockerfile`、`.github/workflows/_deploy.yml`、`.env.example`

---

## Task 1: 配置解析 + 事件类型目录

**Files:**
- Create: `src/lib/analytics/config.ts`, `src/lib/analytics/events.ts`
- Test: `src/lib/analytics/config.test.ts`

**Interfaces:**
- Produces: `resolveGa4(appEnv?): { measurementId: string; env: 'prod'|'test'; debug: boolean }`；`Ga4Config`；`GA4EventName`、`GA4EventParams`、`Modality`、`FailReason`、`UploadKind`。

- [ ] **Step 1: 写失败测试** `src/lib/analytics/config.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { resolveGa4 } from './config';

describe('resolveGa4', () => {
  it('prod → PROD property，不开 debug', () => {
    expect(resolveGa4('prod')).toEqual({ measurementId: 'G-P8ZW92PW19', env: 'prod', debug: false });
  });
  it('test → TEST property + debug', () => {
    expect(resolveGa4('test')).toEqual({ measurementId: 'G-H4SNKB0DCX', env: 'test', debug: true });
  });
  it('未设 / 未知值 → 回退 TEST', () => {
    expect(resolveGa4(undefined)).toEqual({ measurementId: 'G-H4SNKB0DCX', env: 'test', debug: true });
    expect(resolveGa4('develop')).toEqual({ measurementId: 'G-H4SNKB0DCX', env: 'test', debug: true });
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run src/lib/analytics/config.test.ts`，预期 FAIL（模块不存在）。

- [ ] **Step 3: 写 `config.ts`**

```ts
// GA4 环境解析:两个 measurement id 是公开常量(本就随客户端 bundle 下发),硬编码入表。
// 生产部署设 NEXT_PUBLIC_APP_ENV=prod → PROD property;develop/stage/本地(未设)→ TEST property + debug_mode。
const GA4_ID_PROD = 'G-P8ZW92PW19';
const GA4_ID_TEST = 'G-H4SNKB0DCX';

export interface Ga4Config { measurementId: string; env: 'prod' | 'test'; debug: boolean }

export function resolveGa4(appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): Ga4Config {
  return appEnv === 'prod'
    ? { measurementId: GA4_ID_PROD, env: 'prod', debug: false }
    : { measurementId: GA4_ID_TEST, env: 'test', debug: true };
}
```

- [ ] **Step 4: 写 `events.ts`**（类型目录,无运行时逻辑,强制 snake_case 与取值枚举）

```ts
// GA4 事件目录:事件名 + 每事件"专有参数"类型(公共 6 参由 track 自动补齐,不在此列)。
// 集中真相源,调用点在编译期即锁定参数名/取值,满足设计稿 §5.1 自测口径。
export type Modality = 'image' | 'video' | 'audio' | '3d';
export type FailReason = 'build_error' | 'timeout' | 'insufficient_credit' | 'server_error' | 'content_blocked';
export type UploadKind = 'image' | 'video' | 'audio' | 'text';

export interface GA4EventParams {
  page_view: Record<string, never>;
  chat_message_submit: { model?: string; project_id?: string };
  model_switch: { model_from: string; model_to: string };
  game_generate_success: { version_id: string; version: number; game_id?: string; generate_duration: number; project_id?: string };
  game_generate_fail: { fail_reason: FailReason; game_id?: string; project_id?: string };
  asset_generate_submit: { modality: Modality; model?: string; project_id?: string };
  asset_generate_success: { modality: Modality; model?: string; asset_id: string; generate_duration: number; project_id?: string };
  asset_generate_fail: { modality: Modality; model?: string; fail_reason: FailReason; project_id?: string };
  asset_upload: { kind: UploadKind; project_id?: string };
  game_share_click: { target: 'link' | 'rezona'; project_id?: string };
  game_link_copy: { game_id?: string; project_id?: string };
  game_export_submit: { target: 'rezona'; project_id?: string; version_id: string };
  out_of_credits_show: { trigger: string };
  out_of_credits_recharge_click: { trigger: string };
}
export type GA4EventName = keyof GA4EventParams;
```

- [ ] **Step 5: 运行确认通过** — `pnpm exec vitest run src/lib/analytics/config.test.ts`，预期 PASS。
- [ ] **Step 6: 提交**

```bash
git add src/lib/analytics/config.ts src/lib/analytics/config.test.ts src/lib/analytics/events.ts
git commit -m "feat: GA4 环境解析与事件类型目录"
```

---

## Task 2: 失败原因映射 + game_generate 纯逻辑

**Files:**
- Create: `src/lib/analytics/failReason.ts`, `src/lib/analytics/gameGenerate.ts`
- Test: `src/lib/analytics/failReason.test.ts`, `src/lib/analytics/gameGenerate.test.ts`

**Interfaces:**
- Consumes: `FailReason`（Task 1 `events.ts`）；`Version`（`@/store/types`）；`ServerEvent`（`@/koubou/protocol`）。
- Produces: `mapFailReason(code?: string): FailReason`；`gameFailReason(e: ServerEvent): FailReason`；`pickNewVersion(beforeIds: string[], after: Version[]): Version | undefined`；`runDurationMs(startedAt: string|null, finishedAt: string|null): number`。

- [ ] **Step 1: 写失败测试** `src/lib/analytics/failReason.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { mapFailReason } from './failReason';

describe('mapFailReason', () => {
  it('积分类 → insufficient_credit', () => {
    expect(mapFailReason('CREDIT_INSUFFICIENT')).toBe('insufficient_credit');
    expect(mapFailReason('insufficient_credit')).toBe('insufficient_credit');
  });
  it('内容合规类 → content_blocked', () => {
    expect(mapFailReason('INPUT_MODERATION_REJECTED')).toBe('content_blocked');
    expect(mapFailReason('PROVIDER_CONTENT_POLICY_VIOLATION')).toBe('content_blocked');
  });
  it('超时类 → timeout', () => {
    expect(mapFailReason('TIMEOUT')).toBe('timeout');
    expect(mapFailReason('DEADLINE_EXCEEDED')).toBe('timeout');
  });
  it('缺省 / 未知 → server_error', () => {
    expect(mapFailReason(undefined)).toBe('server_error');
    expect(mapFailReason('SOMETHING_ELSE')).toBe('server_error');
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run src/lib/analytics/failReason.test.ts`，预期 FAIL。

- [ ] **Step 3: 写 `failReason.ts`**

```ts
import type { FailReason } from './events';

// 后端未定稿失败码(canvas failure.code / PgcError.code)→ GA4 fail_reason 枚举,按关键字模糊归类。
// 枚举"以实装为准",落点后同步数据团队核对(设计稿 §10)。
export function mapFailReason(code?: string): FailReason {
  const c = (code ?? '').toLowerCase();
  if (/credit|insufficient|balance/.test(c)) return 'insufficient_credit';
  if (/moderation|content|policy|blocked|nsfw/.test(c)) return 'content_blocked';
  if (/timeout|deadline|expired/.test(c)) return 'timeout';
  return 'server_error';
}
```

- [ ] **Step 4: 写失败测试** `src/lib/analytics/gameGenerate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { gameFailReason, pickNewVersion, runDurationMs } from './gameGenerate';
import type { ServerEvent } from '@/koubou/protocol';
import type { Version } from '@/store/types';

const ev = (type: string, payload: Record<string, unknown> = {}): ServerEvent =>
  ({ type, session_id: 's', payload } as ServerEvent);
const ver = (id: string, index: number): Version =>
  ({ id, index, label: '', summary: '', createdAt: '', current: false, assetKeys: [], game: { title: '', palette: '' } });

describe('gameFailReason', () => {
  it('build.failed / interrupted → build_error', () => {
    expect(gameFailReason(ev('build.failed'))).toBe('build_error');
    expect(gameFailReason(ev('run.interrupted'))).toBe('build_error');
  });
  it('run.finished 带 error → 按 message 映射,否则 server_error', () => {
    expect(gameFailReason(ev('run.finished', { error: { message: 'insufficient credit' } }))).toBe('insufficient_credit');
    expect(gameFailReason(ev('run.finished', { error: { type: 'OrphanedRun' } }))).toBe('server_error');
  });
});

describe('pickNewVersion', () => {
  it('返回 after 中不在 beforeIds 的版本', () => {
    expect(pickNewVersion(['v1'], [ver('v1', 1), ver('v2', 2)])?.id).toBe('v2');
  });
  it('无新增 → undefined', () => {
    expect(pickNewVersion(['v1', 'v2'], [ver('v1', 1), ver('v2', 2)])).toBeUndefined();
  });
});

describe('runDurationMs', () => {
  it('两端 ISO 相减得 ms;任一缺失 → 0', () => {
    expect(runDurationMs('2026-07-09T00:00:00.000Z', '2026-07-09T00:00:03.000Z')).toBe(3000);
    expect(runDurationMs(null, '2026-07-09T00:00:03.000Z')).toBe(0);
    expect(runDurationMs('2026-07-09T00:00:00.000Z', null)).toBe(0);
  });
});
```

- [ ] **Step 5: 运行确认失败** — `pnpm exec vitest run src/lib/analytics/gameGenerate.test.ts`，预期 FAIL。

- [ ] **Step 6: 写 `gameGenerate.ts`**

```ts
import type { ServerEvent } from '@/koubou/protocol';
import type { Version } from '@/store/types';
import type { FailReason } from './events';
import { mapFailReason } from './failReason';

// run 终态 → fail_reason:build.failed / 用户中断统一归 build_error;run.finished 失败帧按内嵌 error 文本映射。
// "中断"归类等最终枚举与数据侧对齐(设计稿 §10)。
export function gameFailReason(e: ServerEvent): FailReason {
  if (e.type === 'build.failed' || e.type === 'run.interrupted') return 'build_error';
  const err = e.payload.error as { type?: string; message?: string } | undefined;
  return err ? mapFailReason(err.type || err.message) : 'server_error';
}

// 刷新版本后,挑出相较刷新前新增的那个版本(game_generate_success 仅在产出新版本时上报)。
export function pickNewVersion(beforeIds: string[], after: Version[]): Version | undefined {
  const before = new Set(beforeIds);
  return after.find((v) => !before.has(v.id));
}

// generate_duration:run.started.created_at → run.finished.created_at 相减(ms);任一缺失回退 0。
export function runDurationMs(startedAt: string | null, finishedAt: string | null): number {
  if (!startedAt || !finishedAt) return 0;
  const d = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(d) && d > 0 ? d : 0;
}
```

- [ ] **Step 7: 运行确认通过** — `pnpm exec vitest run src/lib/analytics/failReason.test.ts src/lib/analytics/gameGenerate.test.ts`，预期 PASS。
- [ ] **Step 8: 提交**

```bash
git add src/lib/analytics/failReason.ts src/lib/analytics/failReason.test.ts src/lib/analytics/gameGenerate.ts src/lib/analytics/gameGenerate.test.ts
git commit -m "feat: GA4 失败原因映射与 game_generate 纯逻辑"
```

---

## Task 3: 公共参数上下文（context.ts）

**Files:**
- Create: `src/lib/analytics/context.ts`
- Test: `src/lib/analytics/context.test.ts`

**Interfaces:**
- Consumes: `useStore`（`@/store`，读 `projects`/`currentProjectId`/`userInfo`）；`resolveGa4`（Task 1）。
- Produces: `parseFromPage(search: string): string`；`initFromPage(search: string): void`；`projectPublicId(): string | undefined`；`getCommonParams(): CommonParams`。

- [ ] **Step 1: 写失败测试** `src/lib/analytics/context.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { parseFromPage, initFromPage, getCommonParams, projectPublicId } from './context';
import { useStore } from '@/store';

describe('parseFromPage', () => {
  it('读 ?from_page;缺失/空 → direct', () => {
    expect(parseFromPage('?from_page=game_studio')).toBe('game_studio');
    expect(parseFromPage('')).toBe('direct');
    expect(parseFromPage('?from_page=')).toBe('direct');
  });
});

describe('getCommonParams / projectPublicId', () => {
  beforeEach(() => {
    initFromPage('?from_page=film_studio');
    useStore.setState({
      projects: [{ id: 7, public_id: 'AbCd', name: 'g', cover_url: null, cover_source: null, current_version_id: null, status: 'ok', created_at: '', updated_at: '' }],
      currentProjectId: 7,
      userInfo: { id: 42, username: 'nick' },
    });
  });
  it('游客(无 userInfo):is_login=0,无 user_id', () => {
    useStore.setState({ userInfo: null });
    const p = getCommonParams();
    expect(p).toMatchObject({ product: 'gamestudio', page_name: 'editor', from_page: 'film_studio', is_login: 0 });
    expect('user_id' in p).toBe(false);
  });
  it('登录:is_login=1 + user_id', () => {
    expect(getCommonParams()).toMatchObject({ is_login: 1, user_id: 42 });
  });
  it('projectPublicId 由 currentProjectId → public_id', () => {
    expect(projectPublicId()).toBe('AbCd');
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run src/lib/analytics/context.test.ts`，预期 FAIL。

- [ ] **Step 3: 写 `context.ts`**

```ts
import { useStore } from '@/store';
import { resolveGa4 } from './config';

// from_page 会话级锁定:入站时读一次 URL(早于 bootstrap 剥参),整个会话不变(设计稿 §0-2)。
let fromPage = 'direct';

export function parseFromPage(search: string): string {
  const v = new URLSearchParams(search).get('from_page');
  return v && v.trim() ? v : 'direct';
}
export function initFromPage(search: string): void {
  fromPage = parseFromPage(search);
}

// project_id / game_id 口径:当前项目的对外 public_id(与分享/游玩直链一致)。
export function projectPublicId(): string | undefined {
  const s = useStore.getState();
  return s.projects.find((p) => p.id === s.currentProjectId)?.public_id;
}

export interface CommonParams {
  product: 'gamestudio';
  env: 'prod' | 'test';
  page_name: 'editor';
  from_page: string;
  is_login: 0 | 1;
  user_id?: number;
}
// 6 公共参数(设计稿 §0-1):user_id 登录后带、游客不传;page_name 本站单场景恒 editor。
export function getCommonParams(): CommonParams {
  const s = useStore.getState();
  const uid = s.userInfo?.id;
  return {
    product: 'gamestudio',
    env: resolveGa4().env,
    page_name: 'editor',
    from_page: fromPage,
    is_login: s.userInfo ? 1 : 0,
    ...(uid != null ? { user_id: uid } : {}),
  };
}
```

- [ ] **Step 4: 运行确认通过** — `pnpm exec vitest run src/lib/analytics/context.test.ts`，预期 PASS。
- [ ] **Step 5: 提交**

```bash
git add src/lib/analytics/context.ts src/lib/analytics/context.test.ts
git commit -m "feat: GA4 公共参数上下文(from_page/project_id/公共参数)"
```

---

## Task 4: gtag 发送封装（track / trackAndWait / setUserId）+ barrel

**Files:**
- Create: `src/lib/analytics/gtag.ts`, `src/lib/analytics/index.ts`
- Test: `src/lib/analytics/gtag.test.ts`

**Interfaces:**
- Consumes: `getCommonParams`（Task 3）；`GA4EventName`/`GA4EventParams`（Task 1）。
- Produces: `track<E>(event, params?)`；`trackAndWait<E>(event, params?, timeoutMs?)`；`setUserId(id: number|null)`。`index.ts` re-export 上述 + `projectPublicId`/`initFromPage` + 类型。

- [ ] **Step 1: 写失败测试** `src/lib/analytics/gtag.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { track, setUserId } from './gtag';
import { initFromPage } from './context';
import { useStore } from '@/store';

describe('gtag.track', () => {
  beforeEach(() => {
    initFromPage('');
    useStore.setState({ projects: [], currentProjectId: null, userInfo: null });
    delete (window as unknown as { gtag?: unknown }).gtag;
  });
  it('无 gtag 时静默 no-op,不抛错', () => {
    expect(() => track('page_view', {})).not.toThrow();
  });
  it('有 gtag 时:合并公共参数 + 专有参数发出 event', () => {
    const spy = vi.fn();
    (window as unknown as { gtag: typeof spy }).gtag = spy;
    track('model_switch', { model_from: 'a', model_to: 'b' });
    expect(spy).toHaveBeenCalledWith('event', 'model_switch',
      expect.objectContaining({ product: 'gamestudio', page_name: 'editor', model_from: 'a', model_to: 'b' }));
  });
  it('setUserId(null) 发 gtag set user_id=null;数值转字符串', () => {
    const spy = vi.fn();
    (window as unknown as { gtag: typeof spy }).gtag = spy;
    setUserId(null); expect(spy).toHaveBeenCalledWith('set', { user_id: null });
    setUserId(42); expect(spy).toHaveBeenCalledWith('set', { user_id: '42' });
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run src/lib/analytics/gtag.test.ts`，预期 FAIL。

- [ ] **Step 3: 写 `gtag.ts`**

```ts
import { getCommonParams } from './context';
import type { GA4EventName, GA4EventParams } from './events';

type GtagFn = (...args: unknown[]) => void;

// SSR(无 window)与 gtag 未就绪时一律 no-op;不抛错。gtag 由 layout 内联脚本立即定义(入队 dataLayer),
// 异步库加载后消费队列,故水合后 track 立即可用(设计稿 §地基/gtag 加载)。
function getGtag(): GtagFn | null {
  if (typeof window === 'undefined') return null;
  const g = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof g === 'function' ? g : null;
}

// params 恒为必传(不给默认值):事件的必填专有参数在编译期被强制,page_view 等空参事件显式传 {}。
export function track<E extends GA4EventName>(event: E, params: GA4EventParams[E]): void {
  const g = getGtag();
  if (!g) return;
  g('event', event, { ...getCommonParams(), ...params });
}

// 整页跳转 / 新标签前触发的事件保证送达(设计稿 §0-5):等 event_callback 或超时兜底。
export function trackAndWait<E extends GA4EventName>(
  event: E, params: GA4EventParams[E], timeoutMs = 800,
): Promise<void> {
  const g = getGtag();
  if (!g) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, timeoutMs);
    g('event', event, { ...getCommonParams(), ...params, event_callback: () => { clearTimeout(timer); finish(); } });
  });
}

// 原生 User-ID:登录后设、登出置 null(设计稿 §0-1)。
export function setUserId(id: number | null): void {
  const g = getGtag();
  if (!g) return;
  g('set', { user_id: id == null ? null : String(id) });
}
```

- [ ] **Step 4: 写 `index.ts`**（barrel）

```ts
export { track, trackAndWait, setUserId } from './gtag';
export { projectPublicId, initFromPage, parseFromPage, getCommonParams } from './context';
export { resolveGa4 } from './config';
export type { GA4EventName, GA4EventParams, Modality, FailReason, UploadKind } from './events';
```

- [ ] **Step 5: 运行确认通过** — `pnpm exec vitest run src/lib/analytics/gtag.test.ts`，预期 PASS。
- [ ] **Step 6: 提交**

```bash
git add src/lib/analytics/gtag.ts src/lib/analytics/gtag.test.ts src/lib/analytics/index.ts
git commit -m "feat: GA4 track/trackAndWait/setUserId 封装与守卫"
```

---

## Task 5: gtag 脚本注入 + 环境变量接线

**Files:**
- Modify: `src/app/layout.tsx`, `deploy/dockerfile`, `.github/workflows/_deploy.yml`, `.env.example`

**Interfaces:**
- Consumes: `resolveGa4`（Task 1）。
- Produces: 页面加载后 `window.gtag` 已定义并 `config`（`send_page_view:false`），gtag.js 异步加载。

- [ ] **Step 1: 改 `src/app/layout.tsx`** — 顶部加 import 与配置解析：

```tsx
import Script from 'next/script';
import { resolveGa4 } from '@/lib/analytics/config';
```

在 `export default function RootLayout` 内、`return (` 之前加：

```tsx
  const ga4 = resolveGa4();
```

在 `<head>` 内、已有防白闪 `<script>` 之后，追加 GA4 内联初始化（立即定义 `window.gtag` 入队 dataLayer，保证水合后 `track` 可用）：

```tsx
        {/* GA4:内联定义 gtag(入队 dataLayer)并 config——关闭自动 page_view(改由 useAnalytics 带公共参数手动发);
            非 prod 开 debug_mode 供 DebugView。异步库见 <body> 末尾 <Script>。property 四端共用,PROD/TEST 按环境。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4.measurementId}',{send_page_view:false${ga4.debug ? ",debug_mode:true" : ""}});`,
          }}
        />
```

在 `<body>` 内 `<div id="__app">{children}</div>` 之后，追加异步加载库：

```tsx
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4.measurementId}`} strategy="afterInteractive" />
```

- [ ] **Step 2: 改 `deploy/dockerfile`** — build 层（第 16–20 行区）加 `NEXT_PUBLIC_APP_ENV`：

```dockerfile
# NEXT_PUBLIC_* 必须在构建期烘进客户端 bundle（Koubou WS 由 PGC 基址派生，无需单独变量）
ARG NEXT_PUBLIC_BASE_PATH=""
ARG NEXT_PUBLIC_PGC_BASE_URL=""
ARG NEXT_PUBLIC_APP_ENV=""
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH} \
    NEXT_PUBLIC_PGC_BASE_URL=${NEXT_PUBLIC_PGC_BASE_URL} \
    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV}
```

- [ ] **Step 3: 改 `.github/workflows/_deploy.yml`** — `build-args`（第 108–110 行）追加一行，按 environment 派生（production→prod，其余→test）：

```yaml
          build-args: |
            NEXT_PUBLIC_BASE_PATH=/game
            NEXT_PUBLIC_PGC_BASE_URL=${{ inputs.public_pgc_base_url }}
            NEXT_PUBLIC_APP_ENV=${{ inputs.environment == 'production' && 'prod' || 'test' }}
```

- [ ] **Step 4: 改 `.env.example`** — 末尾追加：

```
# GA4 环境:prod → PROD property(G-P8ZW92PW19);其余/未设 → TEST property(G-H4SNKB0DCX)+ debug_mode。
# 本地自测走 TEST + GA4 DebugView(设计稿 §5)。生产部署由 CI 自动设 prod。
NEXT_PUBLIC_APP_ENV=test
```

- [ ] **Step 5: 类型检查 + 构建校验**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 均无报错（`layout.tsx` 使用 `next/script` 与 `resolveGa4` 通过）。

- [ ] **Step 6: 提交**

```bash
git add src/app/layout.tsx deploy/dockerfile .github/workflows/_deploy.yml .env.example
git commit -m "feat: 注入 GA4 gtag 脚本并接线 NEXT_PUBLIC_APP_ENV"
```

---

## Task 6: useAnalytics（page_view + from_page + user_id 订阅）

**Files:**
- Create: `src/client/useAnalytics.ts`
- Test: `src/client/useAnalytics.test.tsx`
- Modify: `src/components/workspace/Workspace.tsx`

**Interfaces:**
- Consumes: `track`/`setUserId`（Task 4）；`initFromPage`（Task 3）；`useStore`。
- Produces: `useAnalytics(): void`。

- [ ] **Step 1: 写失败测试** `src/client/useAnalytics.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { useAnalytics } from './useAnalytics';
import { useStore } from '@/store';

const track = vi.fn();
const setUserId = vi.fn();
vi.mock('@/lib/analytics/gtag', () => ({
  track: (...a: unknown[]) => track(...a),
  setUserId: (...a: unknown[]) => setUserId(...a),
}));

function Probe() { useAnalytics(); return null; }

describe('useAnalytics', () => {
  beforeEach(() => { track.mockClear(); setUserId.mockClear(); useStore.setState({ userInfo: null }); });

  it('挂载只发一次 page_view(含 StrictMode 双挂载)', () => {
    render(<StrictMode><Probe /></StrictMode>);
    expect(track.mock.calls.filter((c) => c[0] === 'page_view')).toHaveLength(1);
  });

  it('userInfo 到达 → setUserId(id)', () => {
    const { rerender } = render(<Probe />);
    useStore.setState({ userInfo: { id: 9, username: 'n' } });
    rerender(<Probe />);
    expect(setUserId).toHaveBeenCalledWith(9);
  });
});
```

- [ ] **Step 2: 运行确认失败** — `pnpm exec vitest run src/client/useAnalytics.test.tsx`，预期 FAIL。

- [ ] **Step 3: 写 `src/client/useAnalytics.ts`**

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { initFromPage } from '@/lib/analytics/context';
import { track, setUserId } from '@/lib/analytics/gtag';

// GA4 会话级副作用:① 挂载时锁定 from_page 并发一次 page_view(本站单场景 editor);
// ② 订阅 userInfo,登录/登出时同设原生 User-ID。StrictMode 双挂载 / HMR 用 ref 去重。
export function useAnalytics(): void {
  const ran = useRef(false);
  const userId = useStore((s) => s.userInfo?.id ?? null);
  const lastUid = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (ran.current) return;           // ref 在 effect 内置位(非渲染期),符合仓库 hooks 约束
    ran.current = true;
    initFromPage(window.location.search);   // 早于 useProjectBootstrap 剥 URL
    track('page_view', {});
  }, []);

  useEffect(() => {
    if (lastUid.current === userId) return;
    lastUid.current = userId;
    setUserId(userId);
  }, [userId]);
}
```

- [ ] **Step 4: 运行确认通过** — `pnpm exec vitest run src/client/useAnalytics.test.tsx`，预期 PASS。

- [ ] **Step 5: 挂载到 `Workspace.tsx`** — import 后在其余 hooks 旁调用：

在 import 区加：
```tsx
import { useAnalytics } from '@/client/useAnalytics';
```
在 `useUserInfo();`（第 59 行）之后加：
```tsx
  useAnalytics();
```

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS（0 failures）。

- [ ] **Step 7: 提交**

```bash
git add src/client/useAnalytics.ts src/client/useAnalytics.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: useAnalytics 发送 page_view 与 user_id 并挂载 Workspace"
```

---

## Task 7: chat_message_submit + model_switch

**Files:**
- Modify: `src/components/chat/Composer.tsx`, `src/components/chat/ModelSelector.tsx`

**Interfaces:**
- Consumes: `track`、`projectPublicId`（`@/lib/analytics`）；`useStore`。

- [ ] **Step 1: 改 `ModelSelector.tsx`** — import 后，在 `onChange` 内切换实际发生时上报：

import 区加：
```tsx
import { track } from '@/lib/analytics';
```
把第 23 行 `onChange` 改为：
```tsx
      onChange={(id) => {
        if (id !== selected) track('model_switch', { model_from: selected, model_to: id });
        setSelectedModel(id);
        client.current?.setModel(id);
      }}
```

- [ ] **Step 2: 改 `Composer.tsx`** — import `track`/`projectPublicId`；在 `send()` 空内容拦截（第 112 行 `if (!bubbleText && ready.length === 0) return;`）之后、构造 `mediaParts`（第 114 行）之前插入：

import 区加：
```tsx
import { track, projectPublicId } from '@/lib/analytics';
```
插入：
```tsx
    // 发消息驱动 agent 造游戏(steer/首发/landing 自动发送三路径合一处上报)
    track('chat_message_submit', { model: useStore.getState().selectedModel ?? undefined, project_id: projectPublicId() });
```

- [ ] **Step 3: 校验** — 若 Composer 未 import `useStore`，改用组件内已订阅的 selectedModel；否则用 `useStore.getState()`。

Run: `grep -n "useStore" src/components/chat/Composer.tsx | head -1`
Expected: 已存在 `useStore` import（否则在 import 区补 `import { useStore } from '@/store';`）。

- [ ] **Step 4: 写行为测试** `src/components/chat/ModelSelector.test.tsx`

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModelSelector from './ModelSelector';
import { useStore } from '@/store';

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), projectPublicId: () => 'AbCd' }));

describe('ModelSelector 埋点', () => {
  beforeEach(() => {
    track.mockClear();
    useStore.setState({ availableModels: ['m1', 'm2'], selectedModel: 'm1' });
  });
  it('切换模型上报 model_switch(from→to)', () => {
    const ref = { current: { setModel: vi.fn() } } as unknown as React.RefObject<never>;
    render(<ModelSelector client={ref} />);
    fireEvent.click(screen.getByRole('button'));        // 打开下拉
    fireEvent.click(screen.getByText('m2'));            // 选 m2
    expect(track).toHaveBeenCalledWith('model_switch', { model_from: 'm1', model_to: 'm2' });
  });
});
```

> 注：`Select` 的下拉打开/选项文本渲染方式若与上例不符，按其实际 DOM 调整选择器（保留断言 `track('model_switch', { model_from:'m1', model_to:'m2' })`）。

- [ ] **Step 5: 运行测试** — `pnpm exec vitest run src/components/chat/ModelSelector.test.tsx`，预期 PASS。
- [ ] **Step 6: 类型检查** — `pnpm exec tsc --noEmit`，预期无报错。
- [ ] **Step 7: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/ModelSelector.tsx src/components/chat/ModelSelector.test.tsx
git commit -m "feat: 埋点 chat_message_submit 与 model_switch"
```

---

## Task 8: game_generate_success / game_generate_fail

**Files:**
- Modify: `src/client/useKoubouConnection.ts`

**Interfaces:**
- Consumes: `track`、`projectPublicId`（`@/lib/analytics`）；`gameFailReason`/`pickNewVersion`/`runDurationMs`（Task 2）。

- [ ] **Step 1: 改 `useKoubouConnection.ts`** — import 区加：

```tsx
import { track, projectPublicId } from '@/lib/analytics';
import { gameFailReason, pickNewVersion, runDurationMs } from '@/lib/analytics/gameGenerate';
```

模块顶部（`mintTicket` 之前）加幂等集合：

```tsx
// game_generate 幂等:同一 run 的 success/fail 只报一次(§0-3)。跨重连/重放去重。
const reportedRuns = new Set<string>();
function markRunReported(runId: string | null): boolean {
  if (!runId) return true;            // 无 run_id 时不做去重(build.failed 可能缺 run_id),仍允许上报
  if (reportedRuns.has(runId)) return false;
  reportedRuns.add(runId);
  return true;
}
```

把 `onEvent` 里第 84–88 行的成功分支：

```tsx
          // run 成功结束 → 以 PGC 为准刷新画布/版本
          if (e.type === 'run.finished' && (e.payload as { status?: string }).status === 'succeeded') {
            void useStore.getState().loadCanvas().catch(() => {});
            void useStore.getState().loadVersions().catch(() => {});
          }
```

替换为（覆盖成功 + 失败/中断/构建失败三终态 + game_generate 上报）：

```tsx
          // run 终态:成功刷新画布/版本并按"是否产出新版本"上报 game_generate_success;失败/中断/构建失败上报 game_generate_fail
          if (e.type === 'run.finished' || e.type === 'run.interrupted' || e.type === 'build.failed') {
            const s0 = useStore.getState();
            const runId = ((e.payload as { run_id?: string }).run_id) ?? e.run_id ?? s0.activeRunId ?? null;
            const succeeded = e.type === 'run.finished' && (e.payload as { status?: string }).status === 'succeeded';
            if (succeeded) {
              void useStore.getState().loadCanvas().catch(() => {});
              const beforeIds = useStore.getState().versions.map((v) => v.id);
              void useStore.getState().loadVersions()
                .then(() => {
                  const fresh = pickNewVersion(beforeIds, useStore.getState().versions);
                  if (!fresh) return;   // 仅答疑/改画布未出新版本:不上报(设计稿 §4.1)
                  if (!markRunReported(runId)) return;
                  const turn = useStore.getState().turns.find((t) => t.runId === runId);
                  track('game_generate_success', {
                    version_id: fresh.id, version: fresh.index,
                    game_id: projectPublicId(), project_id: projectPublicId(),
                    generate_duration: runDurationMs(turn?.startedAt ?? null, turn?.finishedAt ?? e.created_at ?? null),
                  });
                })
                .catch(() => {});
            } else if (markRunReported(runId)) {
              track('game_generate_fail', { fail_reason: gameFailReason(e), game_id: projectPublicId(), project_id: projectPublicId() });
            }
          }
```

- [ ] **Step 2: 类型检查** — `pnpm exec tsc --noEmit`，预期无报错。

- [ ] **Step 3: 不新建断言空的测试文件**

`onEvent` 是 `useKoubouConnection` 内的闭包回调,无法在不重建整个 WS/连接栈的前提下隔离单测;**不要**为凑测试写断言空的用例（如 `expect(true).toBe(true)`）。本 Task 的**纯判定逻辑**（`gameFailReason` / `pickNewVersion` / `runDurationMs`）已在 Task 2 以真实断言覆盖;此处的接线正确性由以下验收：
- 既有 `src/client/useKoubouConnection.test.ts`（若存在）**零回归**；
- `pnpm exec tsc --noEmit` 通过（新分支类型正确）；
- 收尾阶段 GA4 DebugView 手动核对 game_generate_success/fail。

如你（实现者）能在**不 mock 掉被测逻辑本身**的前提下，用既有测试范式真实驱动 `onEvent` 并断言 `track` 调用，则欢迎补充真实测试；否则**不新增测试文件**，按上述验收即可。

- [ ] **Step 4: 运行类型检查 + 全量测试** — `pnpm exec tsc --noEmit && pnpm test`，预期 PASS（0 failures；既有 useKoubouConnection 测试不回归）。
- [ ] **Step 5: 提交**

```bash
git add src/client/useKoubouConnection.ts
git commit -m "feat: 埋点 game_generate_success/fail(新增失败/中断/构建失败分支)"
```

---

## Task 9: asset_generate_submit / success / fail（画布单资产生成）

**Files:**
- Modify: `src/store/types.ts`（GenTask 扩展）, `src/store/actions.ts`

**Interfaces:**
- Consumes: `track`、`projectPublicId`（`@/lib/analytics`）；`mapFailReason`（Task 2）；`PgcError`（`@/lib/pgc/client`，actions.ts 已引入）。
- Produces: `GenTask` 增加可选 `gaModality?: Modality; gaModel?: string`（仅用户画布生成设置，区分 agent 注册任务）。

- [ ] **Step 1: 改 `src/store/types.ts`** — 扩展 `GenTask`（第 108 行）：

```ts
// 画布异步生成任务(video/model3d)的轮询登记。
// startedAt 持久化用于超时判定;fails 为会话内连续 poll 失败计数,恢复时重置。
// ga*:仅"用户画布生成"(startAsyncGen)设置,供 asset_generate_* 异步终态上报;agent 注册任务不设(据此区分)。
export interface GenTask {
  itemId: string; kind: 'video' | 'model3d'; taskId: string; startedAt: number; fails?: number;
  gaModality?: 'video' | '3d'; gaModel?: string;
}
```

- [ ] **Step 2: 改 `src/store/actions.ts`** — import 区加：

```ts
import { track, projectPublicId } from '@/lib/analytics';
import { mapFailReason } from '@/lib/analytics/failReason';
```

- [ ] **Step 3: `failGenTask` 内补 asset_generate_fail** — 在移除任务前查任务、按 ga 字段上报（仅用户画布生成）。将第 107–117 行替换为：

```ts
  const failGenTask = (itemId: string, taskId: string, deleteRemote = false, failure?: CanvasGenFailure | null) => {
    const pid = get().currentProjectId;
    // 异步终态失败:仅用户画布生成(带 ga 标记)上报,agent 注册任务不报(§4.2)
    const gt = get().genTasks.find((g) => g.taskId === taskId);
    if (gt?.gaModality) {
      track('asset_generate_fail', { modality: gt.gaModality, model: gt.gaModel, fail_reason: mapFailReason(failure?.code), project_id: projectPublicId() });
    }
    set({
      assets: get().assets.filter((a) => a.id !== itemId),
      toast: failure?.message
        ? { code: failure.code || 'GEN_FAILED', message: failure.message, kind: 'error' }
        : { code: 'GEN_FAILED', message: 'Generation failed, please try again', kind: 'error' },
    });
    commitGenTasks(get().genTasks.filter((g) => g.taskId !== taskId));
    if (deleteRemote && pid != null) void pgcApi.deleteCanvasItem(pid, itemId).catch(() => {});
  };
```

- [ ] **Step 4: `startAsyncGen` 接收 model 并写 ga 字段** — 将第 401–410 行改为（新增 `model` 形参 + GenTask ga 字段）：

```ts
  const startAsyncGen = (kind: 'video' | 'model3d', task: CanvasGenTask, pid: number, placeholderIds: string[], opts?: GenPlacement, model?: string) => {
    if (!task.item) {
      removeGenPlaceholders(placeholderIds);
      set({ toast: { code: 'GEN_FAILED', message: 'Generation failed, please try again', kind: 'error' } });
      return;
    }
    settleGenPlaceholders(pid, placeholderIds, [canvasItemToAsset(task.item)], opts);
    commitGenTasks([...get().genTasks, {
      itemId: task.item.item_id, kind, taskId: task.task_id, startedAt: Date.now(), fails: 0,
      gaModality: kind === 'model3d' ? '3d' : 'video', gaModel: model,
    } satisfies GenTask]);
  };
```

- [ ] **Step 5: 四个 generate 动作补 submit/success/fail** — 分别改为：

`generateImage`（第 378–389 行）：
```ts
  const generateImage = async (req: CanvasGenImageRequest, opts?: GenPlacement) => guard(set, async () => {
    const t0 = Date.now();
    track('asset_generate_submit', { modality: 'image', model: req.model ?? undefined, project_id: projectPublicId() });
    try {
      await runGen('image', req.n ?? 1, opts, async (pid, placeholderIds) => {
        const { sourceItemId, promptPrefix } = await resolveTextRef(opts);
        const body = { ...req, prompt: promptPrefix + req.prompt, ...(sourceItemId ? { source_item_id: sourceItemId } : {}) };
        const data = await pgcApi.genImage(pid, body);
        if (get().currentProjectId !== pid) return;
        settleGenPlaceholders(pid, placeholderIds, canvasItemsToAssets(data.items), opts);
        for (const it of data.items) {
          track('asset_generate_success', { modality: 'image', model: req.model ?? undefined, asset_id: it.item_id, generate_duration: Date.now() - t0, project_id: projectPublicId() });
        }
      });
    } catch (e) {
      track('asset_generate_fail', { modality: 'image', model: req.model ?? undefined, fail_reason: mapFailReason(e instanceof PgcError ? e.code : undefined), project_id: projectPublicId() });
      throw e;
    }
  });
```

`generateAudio`（第 392–398 行）：
```ts
  const generateAudio = async (req: CanvasGenAudioRequest, opts?: GenPlacement) => guard(set, async () => {
    const t0 = Date.now();
    track('asset_generate_submit', { modality: 'audio', project_id: projectPublicId() });
    try {
      await runGen('audio', 1, opts, async (pid, placeholderIds) => {
        const item = await pgcApi.genAudio(pid, req);
        if (get().currentProjectId !== pid) return;
        settleGenPlaceholders(pid, placeholderIds, [canvasItemToAsset(item)], opts);
        track('asset_generate_success', { modality: 'audio', asset_id: item.item_id, generate_duration: Date.now() - t0, project_id: projectPublicId() });
      });
    } catch (e) {
      track('asset_generate_fail', { modality: 'audio', fail_reason: mapFailReason(e instanceof PgcError ? e.code : undefined), project_id: projectPublicId() });
      throw e;
    }
  });
```

> 注：`CanvasGenAudioRequest` 无 `model` 字段（后端不收），故 audio 事件不带 `model`；数据侧核对项见设计稿 §10。

`generateVideo`（第 413–421 行）：
```ts
  const generateVideo = async (req: CanvasGenVideoRequest, opts?: GenPlacement) => guard(set, async () => {
    track('asset_generate_submit', { modality: 'video', model: req.model ?? undefined, project_id: projectPublicId() });
    try {
      await runGen('video', 1, opts, async (pid, placeholderIds) => {
        const { sourceItemId, promptPrefix } = await resolveTextRef(opts);
        const body = { ...req, prompt: promptPrefix + req.prompt, ...(sourceItemId ? { source_item_id: sourceItemId } : {}) };
        const task = await pgcApi.genVideo(pid, body);
        if (get().currentProjectId !== pid) return;
        startAsyncGen('video', task, pid, placeholderIds, opts, req.model ?? undefined);
      });
    } catch (e) {
      track('asset_generate_fail', { modality: 'video', model: req.model ?? undefined, fail_reason: mapFailReason(e instanceof PgcError ? e.code : undefined), project_id: projectPublicId() });
      throw e;
    }
  });
```

`generateModel3d`（第 423–431 行）：
```ts
  const generateModel3d = async (req: CanvasGenModel3DRequest, opts?: GenPlacement) => guard(set, async () => {
    track('asset_generate_submit', { modality: '3d', model: req.model_version ?? undefined, project_id: projectPublicId() });
    try {
      await runGen('3d', 1, opts, async (pid, placeholderIds) => {
        const { sourceItemId, promptPrefix } = await resolveTextRef(opts);
        const body = { ...req, prompt: promptPrefix + req.prompt, ...(sourceItemId ? { source_item_id: sourceItemId } : {}) };
        const task = await pgcApi.genModel3d(pid, body);
        if (get().currentProjectId !== pid) return;
        startAsyncGen('model3d', task, pid, placeholderIds, opts, req.model_version ?? undefined);
      });
    } catch (e) {
      track('asset_generate_fail', { modality: '3d', model: req.model_version ?? undefined, fail_reason: mapFailReason(e instanceof PgcError ? e.code : undefined), project_id: projectPublicId() });
      throw e;
    }
  });
```

- [ ] **Step 6: 异步 success（pollGenTasks ready 分支）** — 在第 759–760 行 `if (asset.status === 'ready') { commitGenTasks(...) }` 内、清任务前上报（仅用户画布生成）：

```ts
        if (asset.status === 'ready') {
          if (t.gaModality) {
            track('asset_generate_success', { modality: t.gaModality, model: t.gaModel, asset_id: t.itemId, generate_duration: Date.now() - t.startedAt, project_id: projectPublicId() });
          }
          commitGenTasks(get().genTasks.filter((g) => g.taskId !== t.taskId));
        } else if (now - t.startedAt > DEADLINE_MS) {
          failGenTask(t.itemId, t.taskId);   // 仍 generating 且超时:兜底删卡
        }
```

- [ ] **Step 7: 类型检查** — `pnpm exec tsc --noEmit`，预期无报错（`startAsyncGen` 新形参、GenTask ga 字段均通过）。

- [ ] **Step 8: 写真实行为测试** `src/store/actions.assetgen.test.ts`

**先读** `src/store/actions.test.ts`，复用其既有 store 初始化 + `pgcApi` mock 搭建范式（`vi.mock('@/lib/pgc/client', ...)` 等），照此驱动真实的 `generateImage`，断言 `track` 的真实调用序列。**mock 掉的是 `@/lib/analytics` 的 `track`（用于断言）与 `pgcApi`（避免真网络）——不 mock 被测的 actions 逻辑本身**。至少覆盖：

- 图片同步成功：`asset_generate_submit`（`modality:'image'`）先于 `asset_generate_success`（`modality:'image'`、`asset_id` = 产物 item_id）；
- 图片同步失败（`pgcApi.genImage` reject PgcError）：`asset_generate_fail`（`modality:'image'`、`fail_reason` 按 code 映射），且**不**再发 success（幂等）。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
// 其余 import（store 工厂、pgcApi mock、PgcError）按 src/store/actions.test.ts 既有范式补齐

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), projectPublicId: () => 'AbCd' }));

describe('asset_generate 埋点', () => {
  beforeEach(() => track.mockClear());

  it('图片同步成功:submit 先于 success,success.asset_id=产物 id', async () => {
    // 1) 按 actions.test.ts 搭建 store + mock pgcApi.genImage 返回 { items:[{ item_id:'img_1', ... }] }
    // 2) await store.getState().generateImage({ prompt:'x', model:'gpt-image' }, undefined)
    expect(track).toHaveBeenNthCalledWith(1, 'asset_generate_submit', expect.objectContaining({ modality: 'image', model: 'gpt-image' }));
    expect(track).toHaveBeenCalledWith('asset_generate_success', expect.objectContaining({ modality: 'image', asset_id: 'img_1' }));
  });

  it('图片同步失败:只发 fail,不发 success', async () => {
    // mock pgcApi.genImage reject new PgcError('SERVER_ERROR', ...);await generateImage(...)
    expect(track).toHaveBeenCalledWith('asset_generate_fail', expect.objectContaining({ modality: 'image', fail_reason: expect.any(String) }));
    expect(track.mock.calls.some((c) => c[0] === 'asset_generate_success')).toBe(false);
  });
});
```

> 异步（video/3d）终态经 `pollGenTasks`/`failGenTask`，若能以既有范式驱动则一并补；否则以全量测试不回归 + DebugView 核对（在报告中注明哪些异步分支未覆盖单测）。**不写断言空的占位用例。**

- [ ] **Step 9: 运行全量测试** — `pnpm test`，预期 PASS。
- [ ] **Step 10: 提交**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.assetgen.test.ts
git commit -m "feat: 埋点 asset_generate_submit/success/fail(同步+异步,幂等)"
```

---

## Task 10: asset_upload（Add source 上传源素材）

**Files:**
- Modify: `src/store/actions.ts`

**Interfaces:**
- Consumes: `track`、`projectPublicId`；`UploadKind`（`@/lib/analytics`）。

- [ ] **Step 1: 改 `doUploadAsset`（第 439–466 行）** — 文本文件分支与媒体分支各在"成功落画布"后上报；手写文本便签（`saveTextAsset`→`createTextAsset`，不经本函数）天然不报（§4.2）。

文本分支（第 442–446 行）改为：
```ts
    if (TEXT_MIMES.includes(file.type)) {
      const content = await file.text();
      await createTextAsset(content, opts, file.name.replace(/\.[^.]+$/, ''));
      if (get().currentProjectId === pid) track('asset_upload', { kind: 'text', project_id: projectPublicId() });
      return;
    }
```

媒体分支成功处（第 458 行 `adoptAgentItem(...)` 之后）加：
```ts
      adoptAgentItem(pid, phId, { ...uploaded, source: 'uploaded' });
      track('asset_upload', { kind: kindFromMime(file.type) as UploadKind, project_id: projectPublicId() });
```

import 区补 `UploadKind`（若 Task 9 已 import `track`/`projectPublicId`，此处仅追加类型）：
```ts
import type { UploadKind } from '@/lib/analytics';
```

- [ ] **Step 2: 校验 `kindFromMime` 取值域** — 确认其返回 `'image'|'video'|'audio'`（媒体分支不含 text，text 走上一分支）。

Run: `grep -n "kindFromMime" src/store/actions.ts src/lib/*.ts | head`
Expected: 返回值为 AssetKind 子集，媒体上传仅 image/video/audio；如类型不兼容 `UploadKind`，用 `as UploadKind` 收窄（已在代码中）。

- [ ] **Step 3: 类型检查 + 全量测试** — `pnpm exec tsc --noEmit && pnpm test`，预期 PASS。
- [ ] **Step 4: 提交**

```bash
git add src/store/actions.ts
git commit -m "feat: 埋点 asset_upload(媒体/文本文件上传,排除手写便签)"
```

---

## Task 11: game_share_click / game_link_copy / game_export_submit

**Files:**
- Modify: `src/components/preview/FileMenu.tsx`, `src/components/preview/SharePopover.tsx`, `src/components/preview/RezonaPublishModal.tsx`

**Interfaces:**
- Consumes: `track`、`projectPublicId`（`@/lib/analytics`）。

- [ ] **Step 1: 改 `FileMenu.tsx`** — import 后，在两个 onClick 内上报：

import 区加：
```tsx
import { track, projectPublicId } from '@/lib/analytics';
```
第 25 行按钮：
```tsx
        <button type="button" className={itemCls} onClick={() => { track('game_share_click', { target: 'link', project_id: projectPublicId() }); onShareGame(); onClose(); }}>
```
第 29 行按钮：
```tsx
          <button type="button" className={itemCls} onClick={() => { track('game_share_click', { target: 'rezona', project_id: projectPublicId() }); onShareToRezona(); onClose(); }}>
```

- [ ] **Step 2: 改 `SharePopover.tsx`** — import 后，在 `copy()` 复制成功（第 29 行 `setCopied(true)` 之后）上报：

import 区加：
```tsx
import { track, projectPublicId } from '@/lib/analytics';
```
```tsx
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track('game_link_copy', { game_id: projectPublicId(), project_id: projectPublicId() });
```

- [ ] **Step 3: 改 `RezonaPublishModal.tsx`** — import 后，在 `submit()` 版本校验（第 136 行）之后、`setStep('posting')`（第 137 行）之前上报确认提交：

import 区加：
```tsx
import { track, projectPublicId } from '@/lib/analytics';
```
```tsx
    if (!version) { setWarning({ code: 'VERSION_NOT_FOUND', message: t('preview.rezona.noVersion') }); return; }
    track('game_export_submit', { target: 'rezona', project_id: projectPublicId(), version_id: version.id });
    setStep('posting');
```

- [ ] **Step 4: 写行为测试** `src/components/preview/SharePopover.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SharePopover from './SharePopover';

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), projectPublicId: () => 'AbCd' }));

describe('SharePopover 埋点', () => {
  beforeEach(() => {
    track.mockClear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });
  it('复制成功上报 game_link_copy', async () => {
    render(<SharePopover url="https://x/pv/AbCd/v1/dist/index.html" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(track).toHaveBeenCalledWith('game_link_copy', { game_id: 'AbCd', project_id: 'AbCd' }));
  });
});
```

- [ ] **Step 5: 运行测试** — `pnpm exec vitest run src/components/preview/SharePopover.test.tsx`，预期 PASS。
- [ ] **Step 6: 类型检查** — `pnpm exec tsc --noEmit`，预期无报错。
- [ ] **Step 7: 提交**

```bash
git add src/components/preview/FileMenu.tsx src/components/preview/SharePopover.tsx src/components/preview/SharePopover.test.tsx src/components/preview/RezonaPublishModal.tsx
git commit -m "feat: 埋点 game_share_click/game_link_copy/game_export_submit"
```

---

## Task 12: out_of_credits_show / out_of_credits_recharge_click

**Files:**
- Modify: `src/components/ui/CreditModal.tsx`

**Interfaces:**
- Consumes: `track`、`trackAndWait`（`@/lib/analytics`）。

- [ ] **Step 1: 改 `CreditModal.tsx`** — import；挂载即上报 show；充值跳转补 §0-2 参数并保证送达。

import 区加：
```tsx
import { track, trackAndWait } from '@/lib/analytics';
```
把充值路径常量（第 11 行）改为带跳转参数（§0-2 / §4.3）：
```tsx
// 主 CTA 新标签打开主站充值页(外部路径,不经 apiPath);跳转须带 source_product/source_trigger/from_page(§0-2)
const RECHARGE_PATH = '/studio/settings?section=recharge&source_product=gamestudio&source_trigger=insufficient&from_page=editor';
```
在既有 `useEffect`（Esc 监听，第 18–22 行）之后新增挂载上报（组件仅在打开时挂载，一处覆盖所有触发源）：
```tsx
  // 弹窗出现即上报(组件条件渲染,挂载=出现)。trigger 在 game 站恒为生成/构建触发,取常量 generate,数据侧核对(§10)。
  useEffect(() => { track('out_of_credits_show', { trigger: 'generate' }); }, []);
```
把 `recharge`（第 24–27 行）改为先保证送达再跳转：
```tsx
  const recharge = async () => {
    await trackAndWait('out_of_credits_recharge_click', { trigger: 'generate' });
    window.open(window.location.origin + RECHARGE_PATH, '_blank');
    requestClose();
  };
```
按钮 onClick（第 50 行）改为：
```tsx
          <Button autoFocus onClick={() => void recharge()} className="h-10 px-4 text-[13px]">{t('creditModal.recharge')}</Button>
```

- [ ] **Step 2: 写行为测试** `src/components/ui/CreditModal.test.tsx`

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreditModal from './CreditModal';

const track = vi.fn();
const trackAndWait = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => track(...a), trackAndWait: (...a: unknown[]) => trackAndWait(...a) }));

describe('CreditModal 埋点', () => {
  beforeEach(() => { track.mockClear(); trackAndWait.mockClear(); window.open = vi.fn(); });
  it('挂载上报 out_of_credits_show', () => {
    render(<CreditModal />);
    expect(track).toHaveBeenCalledWith('out_of_credits_show', { trigger: 'generate' });
  });
  it('点 Recharge:先 trackAndWait 再新标签跳转(URL 带 §0-2 参数)', async () => {
    render(<CreditModal />);
    fireEvent.click(screen.getByText((_, el) => el?.textContent === 'creditModal.recharge' || /recharge/i.test(el?.textContent ?? '')));
    await waitFor(() => expect(trackAndWait).toHaveBeenCalledWith('out_of_credits_recharge_click', { trigger: 'generate' }));
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('source_product=gamestudio&source_trigger=insufficient&from_page=editor'), '_blank');
  });
});
```

> 注：按钮文案经 i18n（`t('creditModal.recharge')`），测试环境若返回 key 原文，用 key 匹配；否则按渲染文本调整选择器（保留断言不变）。

- [ ] **Step 3: 运行测试** — `pnpm exec vitest run src/components/ui/CreditModal.test.tsx`，预期 PASS。
- [ ] **Step 4: 类型检查 + 全量测试** — `pnpm exec tsc --noEmit && pnpm test`，预期 PASS（0 failures）。
- [ ] **Step 5: 提交**

```bash
git add src/components/ui/CreditModal.tsx src/components/ui/CreditModal.test.tsx
git commit -m "feat: 埋点 out_of_credits_show/recharge_click 并补充值跳转参数"
```

---

## 收尾校验（全部 Task 后）

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` 全绿。
- [ ] 本地起 dev（`NEXT_PUBLIC_APP_ENV` 缺省→TEST），走 GA4 DebugView 逐事件核对：事件名、6 公共参数、专有参数取值（设计稿 §5.1）。
- [ ] 枚举取值（`model`/`fail_reason`/`trigger`/`target`）清单同步数据团队定稿（设计稿 §5.2、§10）。

---

## 自审对照（spec coverage）

| 设计稿要素 | 覆盖 Task |
|---|---|
| 地基:gtag 加载 + env(NEXT_PUBLIC_APP_ENV) + property | T1, T5 |
| 公共参数(6)自动注入 + user_id/is_login + from_page | T3, T4, T6 |
| page_view(editor,单次) | T6 |
| chat_message_submit / model_switch | T7 |
| game_generate_success/fail(+失败分支,幂等,duration) | T2, T8 |
| asset_generate_submit/success/fail(同步+异步,幂等) | T2, T9 |
| asset_upload(媒体/文本文件,排除便签) | T10 |
| game_share_click/game_link_copy/game_export_submit | T11 |
| out_of_credits_show/recharge_click(+§0-2 跳转参数) | T12 |
| 不上报任务 id / 布尔 0-1 / snake_case | 全局约束 + T1(类型) |
| project_id/game_id=public_id | T3(projectPublicId) |
