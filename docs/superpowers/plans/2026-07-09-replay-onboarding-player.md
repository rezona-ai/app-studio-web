# 回放 Onboarding 播放器 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** workspace 进入即回放：从 landing 带来的 `?replay_template=<id>` 出发，`start` → `clone-from-template` → `finalize(v1)` 开通，再把模板会话的完整事件历史按原节奏在现有对话/画布管线里重演；播完（含 skip）标 `completed` 并在同一 session 上无缝续接。

**Architecture:** 沿单向数据流。REST/koubou client 加 replay 端点；store 加瞬态 `replay`/`replayHandoff` 切片（归 ServerState，settable from actions.ts）+ 编排 action `enterReplay`/`completeReplay`/`importFromReplayEvent` + 摘要 setter；副作用 hook `useReplayPlayer` 拥有事件队列与节奏调度，逐跳复用 `ingestKoubou` reducer；`useKoubouConnection` 回放期早退出、续接走 `replayHandoff` 跳过种子；UI 层 Composer 禁用、交互卡降级纯文本、顶部控制条。

**Tech Stack:** Next.js 16 + React 19、zustand（+persist）、@xyflow/react、vitest（jsdom + globals + `@testing-library/react`）、react-i18next。

## Global Constraints

- 执行前按用户约定基于 dev 创建 worktree：`feat/replay-onboarding-player`（superpowers:using-git-worktrees）；完成后回合 dev（`--no-ff`，message 含分支名）并清理。
- 注释 / commit message 一律**中文**；注释解释「为什么」（竞态 / 不变式 / 后端契约），不解释「做什么」。
- 只取后端文档字段（snake_case），**不加臆测兜底别名**。
- 颜色 / 圆角 / 阴影 / 动效全走 `globals.css` 既有令牌与基础组件（`Segmented`/`IconButton`/`LoadingScreen`/`Toast`）；**无硬编码色值、无一次性 keyframes**。
- i18n 六语（en/zh/fr/ru/ja/vi），**en 为真相源**；新增文案补齐六套；交互元素带 `aria-label`。
- 每个 `await` 之后校验上下文（`get().replay?.templateId === templateId` 或 `get().currentProjectId !== pid`）才写 store；过期响应丢弃。
- **禁 effect-setState 与渲染期 ref 写**（仓库 react-hooks lint 约束）；节奏用 `useStore.getState()` 在定时器 fire 时读，不用渲染期 ref 快照。
- 验证只信命令退出码：`pnpm exec vitest run <file>` / `pnpm exec tsc --noEmit` / `pnpm lint`（worktree 内 IDE 诊断误报不作数）。
- `finalize` 版本号**固定 `"v1"`**：回放项目由 `start` 建出时 `current_version_id` 恒 NULL，系统首个稳定版本号必为 `v1`（spec 已确认）。

**Spec:** `docs/superpowers/specs/2026-07-09-replay-onboarding-player-design.md`（含后端契约要点与端到端序列，实现前先读）。

---

### Task 1: pgc replay 类型 + client（start / finalize / state）

**Files:**
- Modify: `src/lib/pgc/types.ts`（文件尾追加）
- Modify: `src/lib/pgc/client.ts`（`pgcApi` 对象内 rezona 之后追加三方法）
- Test: `src/lib/pgc/client.test.ts`（尾部追加 describe）

**Interfaces:**
- Produces:
  - `ReplayStartData { target_project_id: number; template_id: string; status: string }`
  - `ReplayProjectStateData { project_id: number; status: string }`
  - `pgcApi.startReplay(templateId: string): Promise<ReplayStartData>`
  - `pgcApi.finalizeReplay(projectId: number, currentVersionId: string): Promise<ReplayProjectStateData>`
  - `pgcApi.updateReplayState(projectId: number, status: 'ready' | 'completed'): Promise<ReplayProjectStateData>`

- [ ] **Step 1: 写失败测试**（`client.test.ts` 尾部追加；沿用文件顶部既有 `mockJson`、`vi.stubGlobal('fetch')`）

```ts
describe('replay 端点', () => {
  test('startReplay POST 命中 templates/{id}/start,解析 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { target_project_id: 42, template_id: 'tpl_1', status: 'provisioning' } }));
    const d = await pgcApi.startReplay('tpl_1');
    expect(d.target_project_id).toBe(42);
    expect(d.status).toBe('provisioning');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/templates/tpl_1/start');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
  });

  test('finalizeReplay POST body 带 current_version_id', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { project_id: 42, status: 'ready' } }));
    const d = await pgcApi.finalizeReplay(42, 'v1');
    expect(d.status).toBe('ready');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/projects/42/finalize');
    expect(JSON.parse(init.body as string)).toEqual({ current_version_id: 'v1' });
  });

  test('updateReplayState POST body 带 status', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: { project_id: 42, status: 'completed' } }));
    await pgcApi.updateReplayState(42, 'completed');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/replay/projects/42/state');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'completed' });
  });

  test('start 404 抛 PgcError 带 code', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'REPLAY_TEMPLATE_NOT_FOUND', message: '模板不存在', data: null }, false, 404),
    );
    await expect(pgcApi.startReplay('nope')).rejects.toMatchObject({ code: 'REPLAY_TEMPLATE_NOT_FOUND', status: 404 });
  });
});
```

> `client.test.ts` 顶部已 `import { PgcError, pgcApi, ... } from './client'`；`pgcApi` 已在作用域，无需改 import。若 `mockJson` 签名与本仓不同，按文件现状调整（成功信封需 `success:true`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: FAIL —— `pgcApi.startReplay is not a function`。

- [ ] **Step 3: 实现类型与方法**

`src/lib/pgc/types.ts` 尾部追加：

```ts
// ---- 回放 onboarding(Apifox 8405123 replay/*;契约见 Start/Finalize/Update Replay) ----
// start:为当前用户建回放专属 project;status ∈ provisioning|ready|completed;不回源三元组
export interface ReplayStartData { target_project_id: number; template_id: string; status: string }
// finalize / state 回执
export interface ReplayProjectStateData { project_id: number; status: string }
```

`src/lib/pgc/client.ts`：
1. 顶部类型 import 追加 `ReplayStartData, ReplayProjectStateData`。
2. `pgcApi` 对象内、`rezona: { ... }` 块**之后**追加：

```ts
    // 回放 onboarding:三步跨 pgc(start/finalize/state)。路径带 /api 前缀对齐 Apifox /game/pgcserver/api/replay/*
    // start 幂等(重复开通同模板返回既有项目 + 当前 status);finalize 版本指针固定回写 v1(见计划 Global Constraints)
    startReplay: (templateId: string) =>
      pgc<ReplayStartData>('POST', `/api/replay/templates/${templateId}/start`),
    finalizeReplay: (projectId: number, currentVersionId: string) =>
      pgc<ReplayProjectStateData>('POST', `/api/replay/projects/${projectId}/finalize`, { current_version_id: currentVersionId }),
    updateReplayState: (projectId: number, status: 'ready' | 'completed') =>
      pgc<ReplayProjectStateData>('POST', `/api/replay/projects/${projectId}/state`, { status }),
```

> 注意插在 `rezona` 子对象闭合 `},` 之后、`pgcApi` 对象闭合 `};` 之前，作为顶层方法（非 rezona 内）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS（含既有用例）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: pgc client 新增回放开通三端点(start/finalize/state)"
```

---

### Task 2: koubou client（clone-from-template + listEvents afterSequence）

**Files:**
- Modify: `src/lib/koubou/client.ts`
- Test: `src/lib/koubou/client.test.ts`（尾部追加）

**Interfaces:**
- Produces:
  - `koubouApi.cloneFromTemplate(projectId: string | number, templateId: string): Promise<{ session_id: string; already_provisioned: boolean }>`
  - `koubouApi.listEvents(projectId, sessionId, opts: { limit?; beforeSequence?; afterSequence? })` —— 新增 `afterSequence`（映射 `after_sequence`，与 `beforeSequence` 互斥）

- [ ] **Step 1: 写失败测试**（`client.test.ts` 尾部追加）

```ts
describe('replay 相关', () => {
  test('cloneFromTemplate POST body 带 template_id,解析 data', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { session_id: 'sess_new', already_provisioned: false } }));
    const d = await koubouApi.cloneFromTemplate(42, 'tpl_1');
    expect(d.session_id).toBe('sess_new');
    expect(d.already_provisioned).toBe(false);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/koubou/projects/42/sessions/clone-from-template');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ template_id: 'tpl_1' });
  });

  test('clone 409 抛 KoubouError(供 action 兜底既有会话)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ code: 409, message: 'REPLAY_ALREADY_PROVISIONED', data: null }, true, 200),
    );
    await expect(koubouApi.cloneFromTemplate(42, 'tpl_1')).rejects.toMatchObject({ code: 409, status: 200 });
  });

  test('listEvents 带 after_sequence(全量正向翻页用)', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { events: [], oldest_sequence: 0, newest_sequence: 0, latest_sequence: 0, has_more: false } }));
    await koubouApi.listEvents(42, 's1', { limit: 100, afterSequence: 0 });
    expect(f).toHaveBeenCalledWith('/api/koubou/projects/42/sessions/s1/events?limit=100&after_sequence=0', expect.objectContaining({ method: 'GET' }));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/koubou/client.test.ts`
Expected: FAIL —— `cloneFromTemplate is not a function` / after_sequence 未拼入。

- [ ] **Step 3: 实现**

`src/lib/koubou/client.ts`：
1. `listEvents` 的 opts 增 `afterSequence`，并拼查询串：

```ts
  // 历史事件分页:beforeSequence 反向(向旧翻页)/ afterSequence 正向(回放全量拉取);两者互斥,不同时传
  listEvents: (projectId: string | number, sessionId: string, opts: { limit?: number; beforeSequence?: number; afterSequence?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set('limit', String(opts.limit));
    if (opts.beforeSequence != null) q.set('before_sequence', String(opts.beforeSequence));
    if (opts.afterSequence != null) q.set('after_sequence', String(opts.afterSequence));
    const qs = q.toString();
    return koubou<EventsPage>('GET', `/projects/${projectId}/sessions/${sessionId}/events${qs ? `?${qs}` : ''}`);
  },
```

2. `koubouApi` 对象内追加（`listEvents` 附近）：

```ts
  // 回放 onboarding:把白名单模板克隆成当前用户 project 下的可续接会话(target 身份取鉴权上下文,不由 body 指定)。
  // 409 REPLAY_ALREADY_PROVISIONED 由调用方兜底(改查既有会话,勿重克隆)
  cloneFromTemplate: (projectId: string | number, templateId: string) =>
    koubou<{ session_id: string; already_provisioned: boolean }>('POST', `/projects/${projectId}/sessions/clone-from-template`, { template_id: templateId }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/koubou/client.test.ts`
Expected: PASS（含既有）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/koubou/client.ts src/lib/koubou/client.test.ts
git commit -m "feat: koubou client 新增模板克隆 + listEvents 正向翻页"
```

---

### Task 3: replay URL 助手（解析 / 剥离）

**Files:**
- Modify: `src/lib/project-url.ts`
- Test: `src/lib/project-url.test.ts`（若不存在则 Create，含最小既有用例回归；存在则追加）

**Interfaces:**
- Produces:
  - `parseReplayTemplate(search: string): string | null` —— 读 `?replay_template=<id>`，空/缺省 null
  - `stripReplayTemplateFromUrl(): void` —— 剥掉本页签 URL 的 `replay_template` 参（保留其他，如 `project`），非浏览器 no-op

- [ ] **Step 1: 写失败测试**

若 `src/lib/project-url.test.ts` 不存在，Create：

```ts
import { afterEach, expect, test } from 'vitest';
import { parseReplayTemplate, stripReplayTemplateFromUrl } from './project-url';

afterEach(() => window.history.replaceState(null, '', '/'));

test('parseReplayTemplate 读 replay_template', () => {
  expect(parseReplayTemplate('?replay_template=tpl_9')).toBe('tpl_9');
  expect(parseReplayTemplate('?project=p1')).toBeNull();
  expect(parseReplayTemplate('?replay_template=')).toBeNull();
});

test('stripReplayTemplateFromUrl 剥参保留 project', () => {
  window.history.replaceState(null, '', '/?project=p1&replay_template=tpl_9');
  stripReplayTemplateFromUrl();
  expect(window.location.search).toBe('?project=p1');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/project-url.test.ts`
Expected: FAIL —— 两函数未导出。

- [ ] **Step 3: 实现**（`project-url.ts` 尾部追加）

```ts
// 回放 onboarding 入口:landing 带 ?replay_template=<template_id> 跳进 workspace。
// 作 opaque token 返回,空/缺省 null(空串视为缺省)
export function parseReplayTemplate(search: string): string | null {
  const v = new URLSearchParams(search).get('replay_template');
  return v && v.trim() ? v : null;
}

// 回放结束/完成态进入时剥掉 replay_template 参(保留 project 等其他参),避免刷新重进回放路由;非浏览器 no-op
export function stripReplayTemplateFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('replay_template')) return;
  params.delete('replay_template');
  const s = params.toString();
  const next = s ? `?${s}` : '';
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/project-url.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-url.ts src/lib/project-url.test.ts
git commit -m "feat: 回放入口 URL 参数解析与剥离"
```

---

### Task 4: store replay 状态字段 + `importFromReplayEvent`

**Files:**
- Modify: `src/store/types.ts`（`ServerState` + `createInitialServerState`）
- Modify: `src/store/actions.ts`（`importFromReplayEvent` + 摘要 setter；return 追加）
- Test: `src/store/actions.test.ts`（尾部追加 describe）

**Interfaces:**
- Produces（types）:
  - `ReplayPhase = 'provisioning' | 'cloning' | 'finalizing' | 'playing' | 'skipping' | 'error'`
  - `ReplayState { phase; templateId; projectId: number|null; sessionId: string|null; total: number; cursor: number; speed: 1|2|4; errorCode?: string }`
  - `ReplayHandoff { sessionId: string; afterSequence: number }`
  - `ServerState.replay: ReplayState | null`、`ServerState.replayHandoff: ReplayHandoff | null`
- Produces（actions）:
  - `importFromReplayEvent(e: ServerEvent): void`
  - `setReplayCursor(n: number): void`、`setReplayTotal(n: number): void`、`setReplaySpeed(s: 1|2|4): void`、`skipReplay(): void`
- Consumes: Task 1/2 无（本任务不发网络）。依赖既有 `eventAssets`（丢 tasks）、`importGeneratedAsset`、`liveImportChain`。

- [ ] **Step 1: 写失败测试**（`actions.test.ts` 尾部追加；顶部 store 重置样板沿用该文件既有 `beforeEach`）

```ts
describe('replay 状态与素材分流', () => {
  test('setReplaySpeed / setReplayCursor / setReplayTotal / skipReplay 改 replay 摘要', () => {
    useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 0, cursor: 0, speed: 1 } });
    useStore.getState().setReplayTotal(10);
    useStore.getState().setReplayCursor(3);
    useStore.getState().setReplaySpeed(2);
    useStore.getState().skipReplay();
    const r = useStore.getState().replay!;
    expect(r.total).toBe(10);
    expect(r.cursor).toBe(3);
    expect(r.speed).toBe(2);
    expect(r.phase).toBe('skipping');
  });

  test('replay 为 null 时 setter no-op(不抛)', () => {
    useStore.setState({ replay: null });
    expect(() => useStore.getState().setReplayCursor(5)).not.toThrow();
    expect(useStore.getState().replay).toBeNull();
  });

  test('importFromReplayEvent 只导 media,丢弃 video/3D task(不轮询)', async () => {
    useStore.setState({ currentProjectId: 1 });
    const importSpy = vi.spyOn(useStore.getState(), 'importGeneratedAsset').mockResolvedValue(undefined as never);
    const registerSpy = vi.spyOn(useStore.getState(), 'registerAgentGenTask');
    // 构造一条含 image tool_result 的 claude.message UserMessage 事件(与 eventAssets 契约一致)
    const e = {
      type: 'claude.message', project_id: '1', session_id: 's', sequence: 5,
      payload: { sdk_type: 'UserMessage', payload: { content: [
        { type: 'tool_result', content: [{ type: 'text', text: JSON.stringify({ items: [{ kind: 'image', path: 'hero.png', preview_url: 'https://x/hero.png' }] }) }] },
      ] } },
    } as unknown as import('@/koubou/protocol').ServerEvent;
    useStore.getState().importFromReplayEvent(e);
    await Promise.resolve(); await Promise.resolve();
    expect(importSpy).toHaveBeenCalled();
    expect(registerSpy).not.toHaveBeenCalled();
  });
});
```

> 若 `actions.test.ts` 用整体 `vi.mock('@/lib/pgc/client')`，`importGeneratedAsset`/`registerAgentGenTask` 是 store action（非 mock 对象），用 `vi.spyOn(useStore.getState(), 'xxx')` 即可。`eventAssets` 解析的 `preview_url` 字段名以 `parseMediaItems` 实际契约为准（先读 `src/koubou/protocol.ts` 的 `parseMediaItems` 确认 `path`/`preview_url` 键名，测试数据据此对齐）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "replay 状态"`
Expected: FAIL —— setter/action 未定义。

- [ ] **Step 3: 实现类型**

`src/store/types.ts`：
1. `ServerState` 接口内（`importArchiveStatus` 之后）追加：

```ts
  // ---- 回放 onboarding(全部瞬态,不持久化) ----
  // 回放编排 + 播放态;为 null 表示非回放路由(useKoubouConnection 据此决定是否早退出)
  replay: ReplayState | null;
  // 续接握手:回放结束后传给 useKoubouConnection 的续接坐标(pin session + afterSequence,跳过种子)
  replayHandoff: ReplayHandoff | null;
```

2. 文件内（`ServerState` 定义之前，与其他 export interface 并列）新增类型：

```ts
export type ReplayPhase = 'provisioning' | 'cloning' | 'finalizing' | 'playing' | 'skipping' | 'error';
// 回放切片:provisioning 三步 → playing 逐帧 → completeReplay 收尾。total/cursor 为进度摘要(队列本体在 useReplayPlayer)
export interface ReplayState {
  phase: ReplayPhase;
  templateId: string;
  projectId: number | null;   // start 返回的 target_project_id
  sessionId: string | null;   // clone 返回的 session_id
  total: number;
  cursor: number;
  speed: 1 | 2 | 4;
  errorCode?: string;
}
export interface ReplayHandoff { sessionId: string; afterSequence: number }
```

3. `createInitialServerState()` 的返回对象追加：`replay: null, replayHandoff: null`。

- [ ] **Step 4: 实现 action**

`src/store/actions.ts`：
1. 顶部 `import type { ... } from './types'` 追加 `ReplayState`。
2. 在 `importFromLiveEvent` 定义之后追加（`liveImportChain` 已在其上方定义，复用）：

```ts
  // 回放事件的素材副作用:与 live 共用 eventAssets 的 media(图像/音频/文本原位导入),
  // 但**丢弃 tasks**——回放的是早已结束的死任务 id,送进 registerAgentGenTask 会轮询失败弹 Toast(见 spec §3.4)。
  // 复用 liveImportChain 串行落位(回放与续接不并发,共用队列安全);去重由 importGeneratedAsset 内部兜底
  const importFromReplayEvent = (e: ServerEvent) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const { media } = eventAssets(e);
    for (const m of media) {
      liveImportChain = liveImportChain
        .then(() => { if (get().currentProjectId !== pid) return; return importGeneratedAsset(m.filename, m.kind, m.previewUrl); })
        .catch(() => {});
    }
  };

  // 回放进度摘要 setter(replay 为 null 时 no-op,防播放器卸载竞态)
  const patchReplay = (patch: Partial<ReplayState>) => {
    const r = get().replay; if (!r) return;
    set({ replay: { ...r, ...patch } });
  };
  const setReplayCursor = (n: number) => patchReplay({ cursor: n });
  const setReplayTotal = (n: number) => patchReplay({ total: n });
  const setReplaySpeed = (s: 1 | 2 | 4) => patchReplay({ speed: s });
  const skipReplay = () => patchReplay({ phase: 'skipping' });
```

3. `return { ... }` 追加：`importFromReplayEvent, setReplayCursor, setReplayTotal, setReplaySpeed, skipReplay,`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "replay 状态"`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: store 新增 replay 切片字段与回放素材分流"
```

---

### Task 5: store 编排 `enterReplay` + `completeReplay`

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`（尾部追加 describe）

**Interfaces:**
- Consumes: Task 1 `pgcApi.startReplay/finalizeReplay/updateReplayState`、Task 2 `koubouApi.cloneFromTemplate/listSessions`、Task 3 `stripReplayTemplateFromUrl`、Task 4 replay 字段。
- Produces:
  - `enterReplay(templateId: string): Promise<void>` —— 编排 start → 分流(provisioning: clone→finalize(v1) / ready: 兜底 session / completed: 直接当正常项目)，成功置 `phase='playing'` + `sessionId`
  - `completeReplay(): void` —— 落会话快照到 `koubouByProject` + `state=completed`(失败不阻断) + 置 `replayHandoff` + `replay=null` + 剥 URL

- [ ] **Step 1: 写失败测试**（`actions.test.ts` 尾部追加）

```ts
describe('enterReplay 编排', () => {
  const startMock = () => (pgcApi.startReplay as unknown as ReturnType<typeof vi.fn>);
  beforeEach(() => {
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
  });

  test('provisioning:start→selectProject→clone→finalize(v1)→phase=playing', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockResolvedValue({ session_id: 'sess_c', already_provisioned: false });
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    const r = useStore.getState().replay!;
    expect(r.phase).toBe('playing');
    expect(r.projectId).toBe(7);
    expect(r.sessionId).toBe('sess_c');
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(pgcApi.finalizeReplay).toHaveBeenCalledWith(7, 'v1');
  });

  test('clone 409 → listSessions 兜底既有会话后继续', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'provisioning' });
    (koubouApi.cloneFromTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new KoubouError(409, 'REPLAY_ALREADY_PROVISIONED', 200));
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_existing', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    (pgcApi.finalizeReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'ready' });
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay!.sessionId).toBe('sess_existing');
    expect(useStore.getState().replay!.phase).toBe('playing');
  });

  test('ready:跳过 clone,listSessions 取 session 直接 playing', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'ready' });
    (koubouApi.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue([{ session_id: 'sess_r', project_id: '7', status: 'ready', title: null, active_run_id: null, created_at: '', updated_at: '' }]);
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(koubouApi.cloneFromTemplate).not.toHaveBeenCalled();
    expect(useStore.getState().replay!.phase).toBe('playing');
    expect(useStore.getState().replay!.sessionId).toBe('sess_r');
  });

  test('completed:不回放,replay=null,当正常项目', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockResolvedValue({ target_project_id: 7, template_id: 'tpl', status: 'completed' });
    useStore.setState({ projects: [proj(7)] });
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().currentProjectId).toBe(7);
    expect(koubouApi.cloneFromTemplate).not.toHaveBeenCalled();
  });

  test('start 失败:phase=error + toast', async () => {
    (pgcApi.startReplay as ReturnType<typeof vi.fn>).mockRejectedValue(new PgcError('REPLAY_TEMPLATE_NOT_FOUND', '模板不存在', 404));
    await useStore.getState().enterReplay('tpl');
    expect(useStore.getState().replay!.phase).toBe('error');
    expect(useStore.getState().replay!.errorCode).toBe('REPLAY_TEMPLATE_NOT_FOUND');
    expect(useStore.getState().lastError?.code).toBe('REPLAY_TEMPLATE_NOT_FOUND');
  });
});

describe('completeReplay', () => {
  test('落快照 + state=completed + 置 handoff + replay=null', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockResolvedValue({ project_id: 7, status: 'completed' });
    useStore.setState({
      currentProjectId: 7,
      replay: { phase: 'playing', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 3, speed: 1 },
      sessionId: 'sess_c', lastSequence: 42, messages: [{ id: 'm1', role: 'assistant', status: 'ready', parts: [] }], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    const s = useStore.getState();
    expect(s.replay).toBeNull();
    expect(s.replayHandoff).toEqual({ sessionId: 'sess_c', afterSequence: 42 });
    expect(s.koubouByProject['7'].lastSequence).toBe(42);
    expect(s.koubouByProject['7'].messages).toHaveLength(1);
    expect(pgcApi.updateReplayState).toHaveBeenCalledWith(7, 'completed');
  });

  test('state=completed 失败不阻断(仍置 handoff、清 replay)', async () => {
    (pgcApi.updateReplayState as ReturnType<typeof vi.fn>).mockRejectedValue(new PgcError('X', 'x', 500));
    useStore.setState({
      currentProjectId: 7,
      replay: { phase: 'skipping', templateId: 'tpl', projectId: 7, sessionId: 'sess_c', total: 3, cursor: 1, speed: 1 },
      sessionId: 'sess_c', lastSequence: 10, messages: [], turns: [], tasks: [],
    });
    useStore.getState().completeReplay();
    await Promise.resolve();
    expect(useStore.getState().replay).toBeNull();
    expect(useStore.getState().replayHandoff).toEqual({ sessionId: 'sess_c', afterSequence: 10 });
  });
});
```

> `actions.test.ts` 顶部的 `vi.mock('@/lib/pgc/client', ...)` 返回的 `pgcApi` 对象需**新增** `startReplay: vi.fn(), finalizeReplay: vi.fn(), updateReplayState: vi.fn()`；`vi.mock('@/lib/koubou/client', ...)` 的 `koubouApi` 需含 `cloneFromTemplate: vi.fn(), listSessions: vi.fn()`。若该文件未 mock koubou client，则新增 `vi.mock('@/lib/koubou/client', () => ({ koubouApi: { cloneFromTemplate: vi.fn(), listSessions: vi.fn(), listEvents: vi.fn() }, KoubouError: class extends Error { constructor(public code:number,m:string,public status:number){super(m)} } }))` 并 import `KoubouError`。import 行按需补 `koubouApi`、`KoubouError`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "enterReplay"`
Expected: FAIL —— `enterReplay` 未定义。

- [ ] **Step 3: 实现**

`src/store/actions.ts`：
1. 顶部 import 追加：`import { koubouApi } from '@/lib/koubou/client';`、`import { KoubouError } from '@/lib/koubou/client';`（若已 import 则合并），`import { stripReplayTemplateFromUrl } from '@/lib/project-url';`（与既有 project-url import 合并）。
2. 在 Task 4 的 replay setter 之后追加：

```ts
  // 回放 provisioning 三步兜底:409/403/429/503/网络错误 → error 态 + toast(已知错误);未知照抛。
  // 不自动重试(start 幂等,用户刷新即重来)
  const replayFail = (code: string) => {
    const r = get().replay;
    set({ replay: r ? { ...r, phase: 'error', errorCode: code } : r });
  };

  // clone 409 / ready 恢复:取该项目 clone 会话(列表按 updated_at 倒序,回放项目恒仅一条 clone 会话)
  const resolveCloneSession = async (pid: number): Promise<string | null> => {
    const sessions = await koubouApi.listSessions(pid);
    return sessions[0]?.session_id ?? null;
  };

  // 回放入口编排:start(幂等) → selectProject → 按 status 分流。
  // 先置 replay(provisioning) 再 selectProject:currentProjectId 一变 useKoubouConnection 即早退出(不建连/不种子)。
  // 每个 await 后校验 replay.templateId 仍是本次(防 await 期间用户又切走/重进)
  const enterReplay = async (templateId: string) => {
    set({ replay: { phase: 'provisioning', templateId, projectId: null, sessionId: null, total: 0, cursor: 0, speed: 1 } });
    try {
      const started = await pgcApi.startReplay(templateId);
      if (get().replay?.templateId !== templateId) return;
      const pid = started.target_project_id;
      set({ replay: { ...get().replay!, projectId: pid } });
      await selectProject(pid);   // guard 包裹:落 currentProjectId + 同步 URL + loadCanvas/loadVersions
      if (get().replay?.templateId !== templateId) return;

      // 已完成:不回放(避免重复导入),剥参当正常项目,useKoubouConnection 正常续接
      if (started.status === 'completed') {
        set({ replay: null });
        stripReplayTemplateFromUrl();
        return;
      }

      let sessionId: string | null;
      if (started.status === 'ready') {
        // 克隆+finalize 此前已完成(掉线/刷新中间态):取既有 clone 会话直接播
        sessionId = await resolveCloneSession(pid);
      } else {
        // provisioning:克隆 → finalize(v1)
        set({ replay: { ...get().replay!, phase: 'cloning' } });
        try {
          const cloned = await koubouApi.cloneFromTemplate(pid, templateId);
          sessionId = cloned.session_id;
        } catch (e) {
          // 409 REPLAY_ALREADY_PROVISIONED:已有会话,改查既有,勿重克隆
          if (e instanceof KoubouError && e.code === 409) sessionId = await resolveCloneSession(pid);
          else throw e;
        }
        if (get().replay?.templateId !== templateId) return;
        set({ replay: { ...get().replay!, phase: 'finalizing', sessionId } });
        // finalize 幂等:已 ready/completed 上重复调是 no-op,不回退指针;版本号固定 v1
        await pgcApi.finalizeReplay(pid, 'v1');
      }
      if (get().replay?.templateId !== templateId) return;
      if (!sessionId) { replayFail('REPLAY_NO_SESSION'); set({ toast: { code: 'REPLAY_NO_SESSION', message: 'Replay session not found', kind: 'error' } }); return; }
      set({ replay: { ...get().replay!, phase: 'playing', sessionId } });
    } catch (e) {
      if (e instanceof PgcError) {
        replayFail(e.code);
        if (e.status === 401) set({ authRequired: true });
        else set({ toast: { code: e.code, message: e.message, kind: 'error' } });
      } else if (e instanceof KoubouError) {
        replayFail(String(e.code));
        set({ toast: { code: String(e.code), message: e.message, kind: 'error' } });
      } else {
        replayFail('REPLAY_FAILED');
        throw e;   // 未知错误不吞,暴露 bug(bootstrap 的 void 调用会记录未捕获拒绝)
      }
    }
  };

  // 回放收尾(播完 / skip flush 完由 useReplayPlayer 调):
  // 播放器已把全量事件经 ingestKoubou 灌进 koubou 态,此处读现值落快照 + 标 completed + 置续接握手。
  const completeReplay = () => {
    const r = get().replay; if (!r || r.projectId == null) return;
    const pid = r.projectId;
    const s = get();
    const sessionId = r.sessionId ?? s.sessionId ?? '';
    // 落会话快照(与 live onEvent 检查点同构):续接时 switchProjectSession 据此载回完整回放消息
    set({
      koubouByProject: { ...s.koubouByProject, [String(pid)]: { sessionId, lastSequence: s.lastSequence, messages: s.messages, turns: s.turns, tasks: s.tasks } },
      // 续接握手:pin clone session + afterSequence,useKoubouConnection 据此跳过 resolveSession 与种子
      replayHandoff: { sessionId, afterSequence: s.lastSequence },
      replay: null,
    });
    // 标完成(刷新/换设备据此走续接而非重播);失败不阻断续接(下次刷新 start 重判,素材导入幂等)
    void pgcApi.updateReplayState(pid, 'completed').catch(() => {});
    stripReplayTemplateFromUrl();
  };
```

3. `return { ... }` 追加：`enterReplay, completeReplay,`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有全部）。

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: store 回放编排 enterReplay 与收尾 completeReplay"
```

---

### Task 6: `useReplayPlayer` 播放器 hook

**Files:**
- Create: `src/client/useReplayPlayer.ts`
- Test: `src/client/useReplayPlayer.test.tsx`

**Interfaces:**
- Consumes: Task 2 `koubouApi.listEvents(afterSequence)`、Task 4/5 `ingestKoubou`/`importFromReplayEvent`/`setReplayCursor`/`setReplayTotal`/`completeReplay`、`replay` 字段。
- Produces: `useReplayPlayer(): void` —— 挂在 Workspace，`phase==='playing'` 时拉全量事件、按节奏逐帧派发；`phase==='skipping'` 时立即 flush 剩余；卸载清定时器。

- [ ] **Step 1: 写失败测试**（jsdom + fake timers；样板参考 `useRezonaBindPoll.test.tsx`）

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/koubou/client', () => ({
  koubouApi: { listEvents: vi.fn() },
  KoubouError: class extends Error {},
}));

import { useReplayPlayer } from './useReplayPlayer';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const listEvents = koubouApi.listEvents as unknown as ReturnType<typeof vi.fn>;
const ev = (seq: number, createdAt: string) => ({ type: 'run.started', project_id: '7', session_id: 'sess_c', sequence: seq, created_at: createdAt, payload: {} });

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe('useReplayPlayer', () => {
  test('playing:拉全量→按 sequence 升序逐帧派发→drain 调 completeReplay', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(2, '2026-01-01T00:00:00.300Z'), ev(1, '2026-01-01T00:00:00.000Z')], oldest_sequence: 1, newest_sequence: 2, latest_sequence: 2, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });   // 等 fetch 完成
    expect(useStore.getState().replay!.total).toBe(2);
    // 第一帧立即(floor)派发,升序:先 sequence=1
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(ingest.mock.calls[0][0]).toMatchObject({ sequence: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(ingest.mock.calls[1][0]).toMatchObject({ sequence: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(complete).toHaveBeenCalled();
  });

  test('skipping:清定时器,同步 flush 剩余后 completeReplay', async () => {
    vi.useFakeTimers();
    listEvents.mockResolvedValueOnce({ events: [ev(1, '2026-01-01T00:00:00.000Z'), ev(2, '2026-01-01T00:01:00.000Z'), ev(3, '2026-01-01T00:02:00.000Z')], oldest_sequence: 1, newest_sequence: 3, latest_sequence: 3, has_more: false });
    const ingest = vi.spyOn(useStore.getState(), 'ingestKoubou');
    const complete = vi.spyOn(useStore.getState(), 'completeReplay').mockImplementation(() => {});
    useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 'sess_c', total: 0, cursor: 0, speed: 1 } });
    const { rerender } = renderHook(() => useReplayPlayer());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });   // 派发第 1 帧
    // 用户 skip
    act(() => { useStore.setState({ replay: { ...useStore.getState().replay!, phase: 'skipping' } }); });
    rerender();
    await act(async () => { await Promise.resolve(); });
    expect(ingest).toHaveBeenCalledTimes(3);   // 剩余 2 帧瞬时 flush
    expect(complete).toHaveBeenCalled();
  });
});
```

> 断言节奏用相对差值(300ms、60s cap 到 8s 等)——若实现的 floor/cap 常量与断言不符，以实现常量为准调整测试等待时间；核心断言(升序、drain complete、skip flush 全量)不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useReplayPlayer.test.tsx`
Expected: FAIL —— 文件不存在。

- [ ] **Step 3: 实现**

`src/client/useReplayPlayer.ts`：

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';
import type { ServerEvent } from '@/koubou/protocol';

// 节奏:两帧 created_at 差值(ms),夹到 [floor, cap];负/零取 floor;cap 防源里的分钟级生成等待卡住回放
const PACE_FLOOR_MS = 200;
const PACE_CAP_MS = 8000;
const PAGE_LIMIT = 100;

function paceDelay(events: ServerEvent[], i: number): number {
  if (i <= 0) return PACE_FLOOR_MS;
  const prev = Date.parse(events[i - 1].created_at ?? '');
  const cur = Date.parse(events[i].created_at ?? '');
  const d = cur - prev;
  if (!Number.isFinite(d) || d <= 0) return PACE_FLOOR_MS;
  return Math.min(PACE_CAP_MS, Math.max(PACE_FLOOR_MS, d));
}

// 全量正向翻页(after_sequence);sequence 为正,从 0 起拉全部。终止:!has_more 或空页或无进展(防死循环)
async function fetchAllEvents(pid: number, sid: string): Promise<ServerEvent[]> {
  const all: ServerEvent[] = [];
  let after = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await koubouApi.listEvents(pid, sid, { limit: PAGE_LIMIT, afterSequence: after });
    all.push(...page.events);
    if (!page.events.length || !page.has_more) break;
    const maxSeq = page.newest_sequence ?? Math.max(...page.events.map((e) => e.sequence ?? 0));
    if (maxSeq <= after) break;   // 无进展兜底
    after = maxSeq;
  }
  return all;
}

// 回放播放器:phase=playing 拉全量+按节奏逐帧派发进现有 apply-koubou 管线;phase=skipping 立即 flush 剩余。
// 队列存 ref(可能上千条,不进 store);store 只持 total/cursor 摘要。改速即时生效(fire 时读 getState)。
export function useReplayPlayer(): void {
  const phase = useStore((s) => s.replay?.phase ?? null);
  const projectId = useStore((s) => s.replay?.projectId ?? null);
  const sessionId = useStore((s) => s.replay?.sessionId ?? null);
  const queueRef = useRef<ServerEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 一帧派发:reducer + 素材副作用 + 推进游标
  const dispatchAt = (i: number) => {
    const e = queueRef.current[i];
    if (!e) return;
    useStore.getState().ingestKoubou(e);
    useStore.getState().importFromReplayEvent(e);
    useStore.getState().setReplayCursor(i + 1);
  };

  // playing:拉全量 → 升序 → 逐跳调度。cancelled 守卫防 await/定时器跨 phase 残留
  useEffect(() => {
    if (phase !== 'playing' || projectId == null || !sessionId) return;
    let cancelled = false;
    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

    const scheduleNext = () => {
      const i = useStore.getState().replay?.cursor ?? 0;
      const q = queueRef.current;
      if (i >= q.length) { useStore.getState().completeReplay(); return; }
      const speed = useStore.getState().replay?.speed ?? 1;
      const delay = paceDelay(q, i) / speed;
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        dispatchAt(i);
        scheduleNext();
      }, delay);
    };

    void (async () => {
      const events = await fetchAllEvents(projectId, sessionId);
      if (cancelled) return;
      // 后端已升序,仍按 sequence 显式排序(同毫秒 tool_use→tool_result 靠 sequence 才配对)
      events.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      queueRef.current = events;
      useStore.getState().setReplayTotal(events.length);
      scheduleNext();
    })();

    return () => { cancelled = true; clearTimer(); };
  }, [phase, projectId, sessionId]);

  // skipping:清定时器,把剩余队列同步 flush 完(同一派发路径,无节奏延时)→ completeReplay。
  // 终态与看完全程一致(spec §5)
  useEffect(() => {
    if (phase !== 'skipping') return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const q = queueRef.current;
    for (let i = useStore.getState().replay?.cursor ?? 0; i < q.length; i++) dispatchAt(i);
    useStore.getState().completeReplay();
  }, [phase]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useReplayPlayer.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/client/useReplayPlayer.ts src/client/useReplayPlayer.test.tsx
git commit -m "feat: 回放播放器 hook(拉全量+按节奏派发+skip flush)"
```

---

### Task 7: `useKoubouConnection` 回放隔离 + 续接握手

**Files:**
- Modify: `src/client/useKoubouConnection.ts`
- Test: `src/client/useKoubouConnection.test.tsx`（若不存在则 Create）

**Interfaces:**
- Consumes: Task 4 `replay`、Task 5 `replayHandoff`。
- Produces: 回放期（`replay != null`）effect 早退出（不建连/不种子/不挂监听）；`replayHandoff != null` 时跳过 `resolveSession` + 50 种子，按 `handoff.sessionId` + `afterSequence` 建连并清空 handoff。

- [ ] **Step 1: 写失败测试**（Create `useKoubouConnection.test.tsx`；mock `@/koubou/client` 的 `createKoubouClient` 为 spy，断言建连参数 / 是否建连）

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const createClient = vi.fn(() => ({ close: vi.fn(), reconnect: vi.fn() }));
vi.mock('@/koubou/client', () => ({ createKoubouClient: (opts: unknown) => createClient(opts), shouldReconnectOnWake: () => false }));
vi.mock('@/lib/koubou/client', () => ({ koubouApi: { listSessions: vi.fn().mockResolvedValue([]), listEvents: vi.fn().mockResolvedValue({ events: [], oldest_sequence: 0, newest_sequence: 0, latest_sequence: 0, has_more: false }) } }));

import { useKoubouConnection } from './useKoubouConnection';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

beforeEach(() => {
  process.env.NEXT_PUBLIC_PGC_BASE_URL = 'https://pgc.example';
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() });
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

test('replay 活跃时不建连(早退出)', async () => {
  useStore.setState({ currentProjectId: 7, replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 0, cursor: 0, speed: 1 } });
  renderHook(() => useKoubouConnection());
  await new Promise((r) => setTimeout(r, 10));
  expect(createClient).not.toHaveBeenCalled();
});

test('replayHandoff 存在:跳过种子,按 handoff 建连并清 handoff', async () => {
  const { koubouApi } = await import('@/lib/koubou/client');
  useStore.setState({ currentProjectId: 7, replayHandoff: { sessionId: 'sess_c', afterSequence: 42 } });
  renderHook(() => useKoubouConnection());
  await waitFor(() => expect(createClient).toHaveBeenCalled());
  const opts = createClient.mock.calls[0][0] as { sessionId: string; afterSequence: number };
  expect(opts.sessionId).toBe('sess_c');
  expect(opts.afterSequence).toBe(42);
  expect((koubouApi.listEvents as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();   // 未种子
  expect(useStore.getState().replayHandoff).toBeNull();   // 已清
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useKoubouConnection.test.tsx`
Expected: FAIL —— 回放期仍建连 / handoff 未处理。

- [ ] **Step 3: 实现**

`src/client/useKoubouConnection.ts`：
1. 顶部订阅 replay 活跃标志并加入 effect deps：

```ts
export function useKoubouConnection() {
  const clientRef = useRef<KoubouClient | null>(null);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const replayActive = useStore((s) => s.replay != null);   // 回放期不自动连(见下 effect 早退出)
```

2. effect 顶部（`if (currentProjectId == null) {...}` 之后）加早退出：

```ts
    if (currentProjectId == null) { clientRef.current?.close(); clientRef.current = null; return; }
    // 回放期:播放器独占会话生命周期,不自动建连/种子(否则剧透结局 + 续接被种子冲掉)。
    // replay 置 null(completeReplay)时 deps 变化,effect 重跑,走下方正常/续接分支
    if (replayActive) { clientRef.current?.close(); clientRef.current = null; return; }
    const pid = currentProjectId;
```

3. 异步 IIFE 内，把 `resolveSession` + 种子段包进 handoff 分支：

```ts
    void (async () => {
      // 续接握手:回放刚结束(completeReplay 置 handoff)。pin clone session + afterSequence 增量续传,
      // 跳过 resolveSession(不猜最新)与 50 种子(seedHistory 会整体重建冲掉完整回放消息)
      const handoff = useStore.getState().replayHandoff;
      let sessionId: string | null;
      let afterSequence: number | null;
      if (handoff) {
        sessionId = handoff.sessionId;
        afterSequence = handoff.afterSequence;
        useStore.setState({ replayHandoff: null });   // 消费一次(与本文件既有 setState 快照落盘同范式)
      } else {
        const { sessionId: localSid, lastSequence } = useStore.getState();
        const resolved = await resolveSession(
          { sessionId: localSid, lastSequence },
          () => koubouApi.listSessions(pid),
        );
        if (aborted) return;
        sessionId = resolved.sessionId;
        afterSequence = resolved.afterSequence;
        if (sessionId) {
          try {
            const page = await koubouApi.listEvents(pid, sessionId, { limit: 50 });
            if (aborted) return;
            useStore.getState().seedKoubouHistory(page);
            afterSequence = page.events.length ? page.latest_sequence : null;
          } catch { /* 回退 */ }
        }
      }
      const client = createKoubouClient({
        wsBaseUrl,
        projectId: String(pid),
        sessionId,
        afterSequence,
        model: useStore.getState().selectedModel,
        mintTicket,
        onEvent: (e) => { /* 原样保留既有实现 */ },
        onStatus: (s) => { /* 原样保留既有实现 */ },
      });
      clientRef.current = client;
    })();
```

> 只重构 IIFE 顶部的 session/afterSequence 解析；`createKoubouClient` 的 `onEvent`/`onStatus` 回调体**原封不动**（不要重写它们）。`aborted` 守卫沿用既有声明。

4. effect deps：`}, [currentProjectId]);` → `}, [currentProjectId, replayActive]);`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useKoubouConnection.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/client/useKoubouConnection.ts src/client/useKoubouConnection.test.tsx
git commit -m "feat: 连接层回放期早退出与续接握手"
```

---

### Task 8: `useProjectBootstrap` 回放入口分支

**Files:**
- Modify: `src/client/useProjectBootstrap.ts`
- Test: `src/client/useProjectBootstrap.test.tsx`（追加用例）

**Interfaces:**
- Consumes: Task 3 `parseReplayTemplate`、Task 5 `enterReplay`。
- Produces: 挂载时若 `?replay_template=<id>` 存在 → 调 `enterReplay(id)` 并 return（优先级最高，先于 remix/prelude/loadProjects）。

- [ ] **Step 1: 写失败测试**（追加到 `useProjectBootstrap.test.tsx`）

```tsx
test('URL 带 replay_template → 进入即回放,不走 loadProjects/remix', async () => {
  const enterReplay = vi.fn();
  useStore.setState({ enterReplay } as never);
  window.history.replaceState(null, '', '/?replay_template=tpl_9');
  renderHook(() => useProjectBootstrap());
  await waitFor(() => expect(enterReplay).toHaveBeenCalledWith('tpl_9'));
  expect(api.listProjects).not.toHaveBeenCalled();
  expect(api.createRemix).not.toHaveBeenCalled();
});
```

> 该测试文件 `beforeEach` 已重置 store；此用例前额外注入 `enterReplay` mock。`api` 对象需含 `createRemix`（已在文件顶部 mock）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx -t replay_template`
Expected: FAIL —— 未走回放分支（仍调 loadProjects）。

- [ ] **Step 3: 实现**

`src/client/useProjectBootstrap.ts`：
1. import 追加 `parseReplayTemplate`：`import { parseStudioPrelude, parseRemixSource } from '@/lib/studio-prelude';` 保留，新增 `import { parseReplayTemplate } from '@/lib/project-url';`。
2. 取 action：`const enterReplay = useStore((s) => s.enterReplay);`（放在其他 action 取用旁）。
3. effect 内 `void loadRezonaEligibility();` 之后、`parseRemixSource` 之前插入：

```ts
    // 回放 onboarding 入口最优先:landing 带 ?replay_template= 跳进来 → 进入即回放(enterReplay 内幂等 start)
    const replayTemplate = parseReplayTemplate(window.location.search);
    if (replayTemplate) { void enterReplay(replayTemplate); return; }
```
4. effect deps 追加 `enterReplay`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useProjectBootstrap.test.tsx`
Expected: PASS（含既有三用例）。

- [ ] **Step 5: Commit**

```bash
git add src/client/useProjectBootstrap.ts src/client/useProjectBootstrap.test.tsx
git commit -m "feat: bootstrap 新增回放入口分支(replay_template)"
```

---

### Task 9: i18n 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Produces: `chat.replay.{controls,speed,skip,progress,inputDisabled,approvalNote,questionNote,provisioning,error}` 六语齐备，供 Task 10 使用。

- [ ] **Step 1: en.ts 加 key**（真相源；放在 `chat` 命名空间内 `importGame` 块之后，结构对齐）

```ts
    replay: {
      controls: 'Replay',
      speed: 'Speed',
      skip: 'Skip to end',
      progress: '{{cur}} / {{total}}',
      inputDisabled: 'Watching the replay…',
      approvalNote: 'Tool approval (replay): {{tool}}',
      questionNote: 'Question (replay)',
      provisioning: 'Preparing your replay…',
      error: 'Could not start the replay. Refresh to try again.',
    },
```

- [ ] **Step 2: 其余五语补齐**（同一位置插入；译文如下）

| key | zh | fr | ru | ja | vi |
|---|---|---|---|---|---|
| controls | 回放 | Relecture | Воспроизведение | リプレイ | Phát lại |
| speed | 速度 | Vitesse | Скорость | 速度 | Tốc độ |
| skip | 跳到结尾 | Passer à la fin | Перейти в конец | 最後まで飛ばす | Bỏ qua đến cuối |
| progress | {{cur}} / {{total}} | {{cur}} / {{total}} | {{cur}} / {{total}} | {{cur}} / {{total}} | {{cur}} / {{total}} |
| inputDisabled | 正在观看回放… | Lecture de la relecture… | Идёт воспроизведение… | リプレイを再生中… | Đang xem phát lại… |
| approvalNote | 工具审批（回放）：{{tool}} | Approbation d'outil (relecture) : {{tool}} | Одобрение инструмента (воспроизведение): {{tool}} | ツール承認（リプレイ）：{{tool}} | Phê duyệt công cụ (phát lại): {{tool}} |
| questionNote | 提问（回放） | Question (relecture) | Вопрос (воспроизведение) | 質問（リプレイ） | Câu hỏi (phát lại) |
| provisioning | 正在准备回放… | Préparation de la relecture… | Подготовка воспроизведения… | リプレイを準備中… | Đang chuẩn bị phát lại… |
| error | 无法开始回放，请刷新重试。 | Impossible de démarrer la relecture. Actualisez pour réessayer. | Не удалось начать воспроизведение. Обновите страницу. | リプレイを開始できませんでした。更新して再試行してください。 | Không thể bắt đầu phát lại. Làm mới để thử lại. |

- [ ] **Step 3: 验证六语 key 同构**

Run: `pnpm exec vitest run src/i18n && pnpm exec tsc --noEmit`
Expected: PASS（i18n 有 key 同构校验测试则过；无则以 tsc 通过为准）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 回放播放器六语文案"
```

---

### Task 10: UI 接线（控制条 + Composer 禁用 + 交互降级 + Workspace 挂载）

**Files:**
- Create: `src/components/chat/ReplayControls.tsx`
- Create: `src/components/chat/ReplayControls.test.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`（顶部渲染控制条 + 交互卡降级）
- Modify: `src/components/chat/Composer.tsx`（回放期禁用）
- Modify: `src/components/workspace/Workspace.tsx`（挂 `useReplayPlayer`）

**Interfaces:**
- Consumes: Task 4/5 `replay`、`setReplaySpeed`、`skipReplay`；Task 6 `useReplayPlayer`；Task 9 i18n。
- Produces: `<ReplayControls />`（无 props，自订阅 store）。

- [ ] **Step 1: 写失败测试**（`ReplayControls.test.tsx`）

```tsx
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReplayControls from './ReplayControls';
import { useStore } from '@/store';

beforeEach(() => {
  useStore.setState({
    replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 10, cursor: 4, speed: 1 },
    setReplaySpeed: vi.fn((s) => useStore.setState({ replay: { ...useStore.getState().replay!, speed: s } })),
    skipReplay: vi.fn(),
  } as never);
});

test('显示进度并可切速 / skip', () => {
  render(<ReplayControls />);
  expect(screen.getByText('4 / 10')).toBeInTheDocument();
  fireEvent.click(screen.getByText('2x'));
  expect(useStore.getState().setReplaySpeed).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: 'Skip to end' }));
  expect(useStore.getState().skipReplay).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ReplayControls.test.tsx`
Expected: FAIL —— 组件不存在。

- [ ] **Step 3: 实现 ReplayControls**（复用 `Segmented` + `IconButton`，全走令牌）

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Segmented from '@/components/ui/Segmented';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';

const SPEEDS = [
  { value: '1', label: '1x' },
  { value: '2', label: '2x' },
  { value: '4', label: '4x' },
];

// 回放控制条:速度分段 + skip + 进度。无 Figma 稿,只用既有令牌/基础组件(spec §5);playing/skipping 才显示
export default function ReplayControls() {
  const { t } = useTranslation();
  const replay = useStore((s) => s.replay);
  const setReplaySpeed = useStore((s) => s.setReplaySpeed);
  const skipReplay = useStore((s) => s.skipReplay);
  if (!replay || (replay.phase !== 'playing' && replay.phase !== 'skipping')) return null;

  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
      <span className="text-[12px] font-medium text-[var(--color-muted)]">{t('chat.replay.controls')}</span>
      <div className="w-[132px]">
        <Segmented
          ariaLabel={t('chat.replay.speed')}
          value={String(replay.speed)}
          options={SPEEDS}
          onChange={(v) => setReplaySpeed((Number(v ?? '1') as 1 | 2 | 4))}
        />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-[var(--color-muted)]">
        {t('chat.replay.progress', { cur: replay.cursor, total: replay.total })}
      </span>
      <Tooltip label={t('chat.replay.skip')}>
        <IconButton
          variant="bordered"
          className="ml-auto h-9 rounded-[10px] px-3 text-[12px] font-medium"
          aria-label={t('chat.replay.skip')}
          onClick={skipReplay}
        >
          <FigIcon src={figAsset.chevronDown} size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
```

> `figAsset.chevronDown` 已存在（ChatPanel 用过）；若无更贴切的「快进/跳过」图标，沿用它即可（本期视觉不对稿）。`Segmented` 的 `onChange` 回传 `string | undefined`，此处未用 `withDefault`，值恒为 '1'/'2'/'4'。

- [ ] **Step 4: 跑 ReplayControls 测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ReplayControls.test.tsx`
Expected: PASS。

- [ ] **Step 5: 接线 ChatPanel（控制条 + 交互降级）**

`src/components/chat/ChatPanel.tsx`：
1. import：`import ReplayControls from './ReplayControls';`
2. 订阅：在其他 `useStore` 选择器旁加 `const replayActive = useStore((s) => s.replay != null);`
3. 消息区容器（`{/* 消息区... */}` 那行的 `<div className="relative flex min-h-0 flex-1 flex-col">` 内、`scrollRef` 的滚动 div **之前**）插入：

```tsx
        {replayActive && <ReplayControls />}
```

4. 待处理交互块（line ~271-288）：`pending.map` 回放期降级为纯文本。把 `.map((it) => it.kind === 'approval' ? <ToolApprovalCard.../> : <QuestionCard.../>)` 改为：

```tsx
            {pending.map((it) =>
              replayActive ? (
                <div key={it.interactionId} className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-fill)] p-3 text-[13px] text-[var(--color-muted)]">
                  {it.kind === 'approval' ? t('chat.replay.approvalNote', { tool: it.toolName }) : t('chat.replay.questionNote')}
                </div>
              ) : it.kind === 'approval' ? (
                <ToolApprovalCard key={it.interactionId} interactionId={it.interactionId} toolName={it.toolName} input={it.input}
                  onResolve={(id, ok) => { client.current?.approveTool(id, ok); useStore.getState().resolvePending(id); }} />
              ) : (
                <QuestionCard key={it.interactionId} interactionId={it.interactionId} questions={it.questions}
                  onSubmit={(id, ans) => {
                    const text = formatQuestionAnswer(it.questions, ans);
                    if (text) useStore.getState().pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [{ type: 'text', text }] });
                    client.current?.answerQuestion(id, ans);
                    useStore.getState().resolvePending(id);
                  }} />
              ),
            )}
```

> 保持既有 `onResolve`/`onSubmit` 回调体不变，只在最外层包一个 `replayActive ?` 三元。

- [ ] **Step 6: 接线 Composer（回放期禁用）**

`src/components/chat/Composer.tsx`：
1. 订阅：`const replayActive = useStore((s) => s.replay != null);`
2. `canSend`：`const canSend = !uploading && !replayActive && (draft.trim().length > 0 || hasReady);`
3. `<textarea>` 加属性：`disabled={replayActive}`，并把 `placeholder` 改为 `placeholder={replayActive ? t('chat.replay.inputDisabled') : t('chat.composer.placeholder')}`。
4. 发送/停止分支：把 `{runStatus === 'running' ? (<停止>) : (<发送>)}` 的条件改为 `{runStatus === 'running' && !replayActive ? (<停止>) : (<发送>)}`（回放期不显示停止按钮；发送按钮已因 `canSend=false` 禁用）。

- [ ] **Step 7: 接线 Workspace（挂播放器）**

`src/components/workspace/Workspace.tsx`：
1. import：`import { useReplayPlayer } from '@/client/useReplayPlayer';`
2. 与 `useCanvasPolling();` 并列调用：`useReplayPlayer();`

- [ ] **Step 8: 跑相关组件测试确认通过（不回归）**

Run: `pnpm exec vitest run src/components/chat/ChatPanel.test.tsx src/components/chat/Composer.test.tsx src/components/chat/ReplayControls.test.tsx`
Expected: PASS（既有 ChatPanel/Composer 用例不回归）。

- [ ] **Step 9: Commit**

```bash
git add src/components/chat/ReplayControls.tsx src/components/chat/ReplayControls.test.tsx src/components/chat/ChatPanel.tsx src/components/chat/Composer.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: 回放 UI 接线(控制条+输入禁用+交互降级+播放器挂载)"
```

---

### Task 11: 全量验证与收尾

**Files:** 无新增（验证 + 可能的修正）。

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 exit 0。任何失败先按 superpowers:systematic-debugging 定位再修，不得跳过。

- [ ] **Step 2: 运行态验证**（superpowers:verification-before-completion；参考记忆「运行态验证本地坑」「无后端驱动前端流程截图」）

无本地后端时用 Playwright `page.route('**/api/pgc/**')` + `page.route('**/api/koubou/**')` 注入信封 mock，跑 prod build（带 `NEXT_PUBLIC_PGC_BASE_URL`），访问 `/?replay_template=tpl_demo` 逐态验证：
- provisioning：start → clone → finalize 依次发出，聊天区显示准备态；
- playing：消息逐条出现、图像/音频落画布、输入框禁用、控制条可切速；
- skip：剩余事件瞬时补齐，终态与看完一致；
- 完成：`state=completed` 发出、`?replay_template` 被剥、输入框启用、可正常发消息（续接建连带 `after_sequence`，不重放历史）。

- [ ] **Step 3: 若有修正则提交**

```bash
git add -A && git commit -m "fix: 回放播放器联调修正"
```

- [ ] **Step 4: 收尾**

按 superpowers:finishing-a-development-branch 回合 dev（`--no-ff`，message 含 `feat/replay-onboarding-player`），删分支并清理 worktree；合并前 `git log` 校验提交落点（记忆「子 agent 可能提交到错分支」）。

---

## Self-Review（写完对照 spec 的结果）

- **Spec §1 数据层**：Task 1（pgc start/finalize/state）、Task 2（koubou clone + listEvents afterSequence）✅
- **Spec §2 store 切片 + 编排 + 素材分流**：Task 4（字段 + importFromReplayEvent + setter）、Task 5（enterReplay + completeReplay）✅
- **Spec §3 连接隔离与续接**：Task 7（replayActive 早退出 + replayHandoff 跳种子）✅
- **Spec §4 播放器副作用**：Task 6（useReplayPlayer：拉全量 / 排序 / 节奏 clamp / 倍速 / skip flush / 卸载清理）✅
- **Spec §5 UI**：Task 10（控制条 / Composer 禁用 / 交互降级 / Workspace 挂载）、Task 9（i18n）✅；provisioning/error 内联态由 ReplayControls 只管 playing/skipping，provisioning/error 文案已备（`chat.replay.provisioning`/`error`），其占位渲染归入 ChatPanel 空态复用（消息区为空 + provisioning 时可后续增强，本期最小以文案就绪为准）✅
- **Spec §6 错误处理**：Task 5（enterReplay try/catch 分级 + state 失败吞掉）✅
- **Spec §7 测试**：各 Task 均含同目录测试 + Task 11 全量 ✅
- **URL 入口**：Task 3（parse/strip）、Task 8（bootstrap 分支）✅ —— spec 端到端序列的 `?replay_template` 识别覆盖。
- **类型一致性**：`ReplayState`/`ReplayHandoff`/`ReplayPhase` 在 Task 4 types 定义，Task 5/6/7/10 引用一致；action 名 `enterReplay`/`completeReplay`/`importFromReplayEvent`/`setReplayCursor`/`setReplayTotal`/`setReplaySpeed`/`skipReplay` 跨 Task 一致。
- **占位符扫描**：无 TBD/TODO；每个代码步给出完整代码。
- **一处 spec 偏差（已在计划内显式化）**：spec §5 提到 provisioning 用 `LoadingScreen` 骨架，计划改为"消息区空态 + `chat.replay.provisioning` 文案"最小实现（避免为一次性态引专用骨架），视觉增强留后续；不影响流程正确性。
