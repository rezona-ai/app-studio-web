# 对话输入区模型选择组件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在对话输入区右下角(send 左侧)加模型选择器:从 Koubou `/models` 拉列表、默认取首项、本地持久化用户选择、建连带 `?model=`、运行中切换发 `session.set_model`。

**Architecture:** 纯逻辑(展示名派生 / 默认解析)下沉到 `lib/koubou/models.ts`;`/models` 拉取走 `koubouApi.listModels`;状态进唯一 zustand store(`availableModels` 瞬态 / `selectedModel` 持久化);建连参数经 `buildWsUrl` → `createKoubouClient`;切换经 `client.setModel` 发 WS 帧。UI 复用 `GenerateForm` 的「胶囊 + 上拉下拉」语言。

**Tech Stack:** Next 16 / React 19 / zustand(persist)/ vitest(jsdom)/ @testing-library/react / Tailwind(CSS 变量主题)。

## Global Constraints

- 运行环境 Node 22 + pnpm 11;测试与源码**同目录**(`*.test.ts(x)`),vitest 用 `@`→`src` 别名。
- 代码注释 / commit message 一律**中文**;commit 一句话总结。
- **只取文档约定字段**:`/models` 仅读 `data.models`,不臆测别名兜底。
- 自身绝对路径必经 `apiPath()`/`assetPath()`(`koubouApi` 的 `PREFIX = apiPath('/api/koubou')` 已满足,本计划无新增裸路径)。
- persist key `taluna-v4` 被 `layout.tsx` 防白闪脚本硬编码引用,但该脚本只读 `theme` 字段;新增 `selectedModel` 到 partialize **不影响**该脚本,无需同步改动。
- 后端契约(已核实,apifox 项目 8405123 / Koubou Agent):`GET /models?backend=cc` → `{ code, message, data: { backend, default_model: string|null, models: string[] } }`;默认模型取 `models[0]`;WS 建连参数 `?model=<id>`;切换帧 `{ type: 'session.set_model', payload: { model } }`。

---

### Task 1: `modelLabel` / `resolveSelectedModel` 纯函数

**Files:**
- Create: `src/lib/koubou/models.ts`
- Test: `src/lib/koubou/models.test.ts`

**Interfaces:**
- Produces:
  - `modelLabel(id: string): string` —— 由模型 ID 派生展示名。
  - `resolveSelectedModel(models: string[], current: string | null): string | null` —— 解析选中模型(沿用有效旧选 / 否则首项 / 空列表 null)。

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/koubou/models.test.ts
import { describe, expect, test } from 'vitest';
import { modelLabel, resolveSelectedModel } from './models';

describe('modelLabel', () => {
  test('claude-* 派生族名 + 点号版本', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(modelLabel('claude-fable-5')).toBe('Fable 5');
    expect(modelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
  });
  test('丢弃末尾日期戳', () => {
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });
  test('非 claude- 前缀 / 空串原样回退', () => {
    expect(modelLabel('gpt-image-2')).toBe('gpt-image-2');
    expect(modelLabel('')).toBe('');
  });
});

describe('resolveSelectedModel', () => {
  test('无选择取首项', () => {
    expect(resolveSelectedModel(['claude-opus-4-8', 'claude-fable-5'], null)).toBe('claude-opus-4-8');
  });
  test('已选且在列表则保留', () => {
    expect(resolveSelectedModel(['a', 'b'], 'b')).toBe('b');
  });
  test('已选不在列表回落首项', () => {
    expect(resolveSelectedModel(['a', 'b'], 'gone')).toBe('a');
  });
  test('空列表为 null', () => {
    expect(resolveSelectedModel([], 'a')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/koubou/models.test.ts`
Expected: FAIL —— `Failed to resolve import './models'`。

- [ ] **Step 3: 实现**

```ts
// src/lib/koubou/models.ts
// 模型 ID → 展示名 + 默认选中解析(纯函数,无副作用)

// 规则:仅美化 claude-* —— 去前缀 → 丢末尾纯数字日期戳(≥6 位)→ 首段族名 Title case
//      → 其余数字段用 "." 连接接在族名后。非 claude-* 或无法解析者原样回退。
export function modelLabel(id: string): string {
  if (!id || !id.startsWith('claude-')) return id;
  const parts = id.slice('claude-'.length).split('-').filter(Boolean);
  while (parts.length > 1 && /^\d{6,}$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return id;
  const [family, ...rest] = parts;
  const nums = rest.filter((p) => /^\d+$/.test(p));
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return nums.length ? `${name} ${nums.join('.')}` : name;
}

// 建连/展示用选中模型:用户已选且仍在列表则沿用,否则取列表首项;空列表为 null
export function resolveSelectedModel(models: string[], current: string | null): string | null {
  if (current && models.includes(current)) return current;
  return models[0] ?? null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/koubou/models.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/koubou/models.ts src/lib/koubou/models.test.ts
git commit -m "feat: 模型 ID 展示名派生与默认选中解析纯函数"
```

---

### Task 2: `koubouApi.listModels`

**Files:**
- Modify: `src/lib/koubou/client.ts`(`koubouApi` 对象,约 58-70 行)
- Test: `src/lib/koubou/client.test.ts`(追加 describe)

**Interfaces:**
- Consumes: 既有内部 `koubou<T>(method, path)`(信封拆解,`code!==0` 抛 `KoubouError`)。
- Produces: `koubouApi.listModels(): Promise<string[]>` —— `GET /models?backend=cc`,返回 `data.models`。

- [ ] **Step 1: 写失败测试**(追加到 `src/lib/koubou/client.test.ts` 末尾,文件级 `beforeEach`/`mockJson` 已存在)

```ts
describe('koubouApi.listModels', () => {
  test('返回 data.models,GET 命中 /models?backend=cc', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ code: 0, message: 'ok', data: { backend: 'cc', default_model: 'claude-opus-4-8', models: ['claude-opus-4-8', 'claude-fable-5'] } }));
    const d = await koubouApi.listModels();
    expect(d).toEqual(['claude-opus-4-8', 'claude-fable-5']);
    expect(f).toHaveBeenCalledWith('/api/koubou/models?backend=cc', expect.objectContaining({ method: 'GET' }));
  });
  test('code 非 0 抛 KoubouError', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockJson({ code: 400, message: 'backend not supported', data: null }, false, 400));
    await expect(koubouApi.listModels()).rejects.toBeInstanceOf(KoubouError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/koubou/client.test.ts -t listModels`
Expected: FAIL —— `koubouApi.listModels is not a function`。

- [ ] **Step 3: 实现**(在 `koubouApi` 对象内,`listSessions` 之后追加一项)

```ts
  // 可用模型列表(GET /models),仅取契约约定的 data.models;backend 本期固定 cc
  listModels: () =>
    koubou<{ backend: string; default_model: string | null; models: string[] }>('GET', '/models?backend=cc')
      .then((d) => d.models),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/koubou/client.test.ts`
Expected: PASS(含原 listSessions/listEvents 用例)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/koubou/client.ts src/lib/koubou/client.test.ts
git commit -m "feat: koubouApi.listModels 拉取可用模型列表"
```

---

### Task 3: `buildWsUrl` 支持 `model` 查询参数

**Files:**
- Modify: `src/koubou/protocol.ts:163-173`(`buildWsUrl`)
- Test: `src/koubou/protocol.test.ts`(追加到 `describe('buildWsUrl')`)

**Interfaces:**
- Produces: `buildWsUrl(base, projectId, opts)` 的 `opts` 新增可选 `model?: string | null`;有值时追加 `&model=<id>`(在 `ws_ticket`、`after_sequence` 之后)。

- [ ] **Step 1: 写失败测试**(追加到 `describe('buildWsUrl', ...)` 内)

```ts
  test('带 model 追加 model 参数', () => {
    expect(buildWsUrl('ws://h', '2', { ticket: 'tk', model: 'claude-opus-4-8' }))
      .toBe('ws://h/projects/2/ws?ws_ticket=tk&model=claude-opus-4-8');
  });
  test('恢复会话同时带 after_sequence 与 model', () => {
    expect(buildWsUrl('ws://h', '2', { sessionId: 's1', afterSequence: 7, ticket: 'tk', model: 'claude-fable-5' }))
      .toBe('ws://h/projects/2/sessions/s1/ws?ws_ticket=tk&after_sequence=7&model=claude-fable-5');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts -t buildWsUrl`
Expected: FAIL —— 实际 URL 缺 `&model=...`。

- [ ] **Step 3: 实现**(替换 `buildWsUrl` 签名与函数体)

```ts
export function buildWsUrl(
  base: string,
  projectId: string,
  opts: { sessionId?: string | null; afterSequence?: number | null; ticket: string; model?: string | null },
): string {
  const root = base.replace(/\/$/, '');
  const path = opts.sessionId ? `/projects/${projectId}/sessions/${opts.sessionId}/ws` : `/projects/${projectId}/ws`;
  const params = new URLSearchParams({ ws_ticket: opts.ticket });
  if (opts.sessionId && opts.afterSequence != null) params.set('after_sequence', String(opts.afterSequence));
  if (opts.model) params.set('model', opts.model);
  return `${root}${path}?${params.toString()}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts`
Expected: PASS(原「新建/恢复/续传」三例不变,新增两例通过)。

- [ ] **Step 5: 提交**

```bash
git add src/koubou/protocol.ts src/koubou/protocol.test.ts
git commit -m "feat: buildWsUrl 支持 model 查询参数"
```

---

### Task 4: `createKoubouClient` 透传 model + `setModel`

**Files:**
- Modify: `src/koubou/client.ts`(`KoubouClientOpts`、`KoubouClient`、`connect` 的 `buildWsUrl` 调用 `:55`、返回对象 `:95-103`)
- Test: `src/koubou/client.test.ts`(追加到 `describe('createKoubouClient')`)

**Interfaces:**
- Consumes: Task 3 的 `buildWsUrl(..., { ..., model })`。
- Produces:
  - `KoubouClientOpts` 新增可选 `model?: string | null`。
  - `KoubouClient` 新增 `setModel(model: string): void` —— 发 `session.set_model` 帧。

- [ ] **Step 1: 写失败测试**(追加到 `describe('createKoubouClient', ...)` 内;`setup({ ...over })` 已支持透传 opts)

```ts
  test('setModel 组装 session.set_model envelope', async () => {
    const { client, created } = setup();
    await flush();
    created[0].onopen?.();
    client.setModel('claude-fable-5');
    expect(JSON.parse(created[0].sent[0])).toEqual({ type: 'session.set_model', payload: { model: 'claude-fable-5' } });
  });
  test('opts.model 透传到建连 URL', async () => {
    const { created } = setup({ model: 'claude-opus-4-8' });
    await flush();
    expect(created[0].url).toBe('ws://h/projects/2/ws?ws_ticket=tk&model=claude-opus-4-8');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/client.test.ts -t "setModel|透传到建连"`
Expected: FAIL —— `client.setModel is not a function` / URL 缺 model。

- [ ] **Step 3: 实现**(三处改动)

`KoubouClientOpts` 接口新增字段(在 `afterSequence?` 之后):
```ts
  model?: string | null;
```

`KoubouClient` 接口新增方法(在 `answerQuestion` 之后):
```ts
  setModel: (model: string) => void;
```

`connect()` 内的 `buildWsUrl` 调用(`:55`)改为带上 model:
```ts
    const url = buildWsUrl(opts.wsBaseUrl, opts.projectId, { sessionId, afterSequence, ticket, model: opts.model });
```

返回对象内新增方法(在 `answerQuestion` 之后、`close` 之前):
```ts
    setModel: (model) => send({ type: 'session.set_model', payload: { model } }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/koubou/client.test.ts`
Expected: PASS(原全部用例 + 新增两例)。

- [ ] **Step 5: 提交**

```bash
git add src/koubou/client.ts src/koubou/client.test.ts
git commit -m "feat: KoubouClient 建连带 model 并支持 setModel 热切换"
```

---

### Task 5: store 模型状态 + actions + 持久化

**Files:**
- Modify: `src/store/index.ts`(`UIState` 接口 `:25-36`、`Actions` 接口 `:38-72`、初始值 `:90`、action 实现 `:156` 附近、`partialize` `:227-234`、顶部 import)
- Test: `src/store/model-selection.test.ts`(新建)

**Interfaces:**
- Consumes: Task 1 的 `resolveSelectedModel`。
- Produces(store 上):
  - 状态 `availableModels: string[]`(初始 `[]`,瞬态)、`selectedModel: string | null`(初始 `null`,持久化)。
  - action `setAvailableModels(models: string[]): void`(内部用 `resolveSelectedModel` 解析默认选中)。
  - action `setSelectedModel(id: string): void`。

- [ ] **Step 1: 写失败测试**

```ts
// src/store/model-selection.test.ts
import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ availableModels: [], selectedModel: null }));

test('setAvailableModels 无选择时默认取首项', () => {
  useStore.getState().setAvailableModels(['claude-opus-4-8', 'claude-fable-5']);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
  expect(useStore.getState().availableModels).toHaveLength(2);
});
test('已选且仍在列表 → 保留', () => {
  useStore.setState({ selectedModel: 'claude-fable-5' });
  useStore.getState().setAvailableModels(['claude-opus-4-8', 'claude-fable-5']);
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
});
test('已选但不在新列表 → 回落首项', () => {
  useStore.setState({ selectedModel: 'gone-model' });
  useStore.getState().setAvailableModels(['claude-opus-4-8']);
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
});
test('setSelectedModel 写入选择', () => {
  useStore.setState({ availableModels: ['a', 'b'] });
  useStore.getState().setSelectedModel('b');
  expect(useStore.getState().selectedModel).toBe('b');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/model-selection.test.ts`
Expected: FAIL —— `setAvailableModels is not a function`。

- [ ] **Step 3: 实现**(`src/store/index.ts` 五处改动)

顶部 import 区追加:
```ts
import { resolveSelectedModel } from '@/lib/koubou/models';
```

`UIState` 接口内追加(`composer: ComposerState;` 之后):
```ts
  availableModels: string[];
  selectedModel: string | null;
```

`Actions` 接口内追加(任意处,建议 `setConn` 之后):
```ts
  setAvailableModels: (models: string[]) => void;
  setSelectedModel: (id: string) => void;
```

create() 初始值区追加(`composer: { draft: '', refs: [], attachments: [] },` 之后):
```ts
      availableModels: [],
      selectedModel: null,
```

action 实现区追加(`setConn` 实现之后):
```ts
      // 写可用模型列表,并解析默认选中(沿用有效旧选 / 否则首项)
      setAvailableModels: (models) =>
        set((s) => ({ availableModels: models, selectedModel: resolveSelectedModel(models, s.selectedModel) })),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
```

`partialize` 返回对象追加(`composer: {...}` 之后):
```ts
        selectedModel: s.selectedModel,
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/model-selection.test.ts`
Expected: PASS(四例)。

- [ ] **Step 5: 提交**

```bash
git add src/store/index.ts src/store/model-selection.test.ts
git commit -m "feat: store 维护可用模型与选中模型并持久化选择"
```

---

### Task 6: `useModelList` 拉取 hook

**Files:**
- Create: `src/client/useModelList.ts`
- Test: `src/client/useModelList.test.tsx`

**Interfaces:**
- Consumes: Task 2 `koubouApi.listModels`、Task 5 `useStore.getState().setAvailableModels`。
- Produces: `useModelList(): void` —— 挂载时拉一次模型列表写入 store,失败静默。

- [ ] **Step 1: 写失败测试**

```tsx
// src/client/useModelList.test.tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useModelList } from './useModelList';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

beforeEach(() => useStore.setState({ availableModels: [], selectedModel: null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test('挂载拉取模型写入 store,默认选首项', async () => {
  vi.spyOn(koubouApi, 'listModels').mockResolvedValue(['claude-opus-4-8', 'claude-fable-5']);
  renderHook(() => useModelList());
  await waitFor(() => expect(useStore.getState().availableModels).toHaveLength(2));
  expect(useStore.getState().selectedModel).toBe('claude-opus-4-8');
});

test('拉取失败静默,列表保持空', async () => {
  vi.spyOn(koubouApi, 'listModels').mockRejectedValue(new Error('down'));
  renderHook(() => useModelList());
  await waitFor(() => expect(koubouApi.listModels).toHaveBeenCalled());
  expect(useStore.getState().availableModels).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useModelList.test.tsx`
Expected: FAIL —— `Failed to resolve import './useModelList'`。

- [ ] **Step 3: 实现**

```ts
// src/client/useModelList.ts
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

// 挂载时拉一次可用模型列表写入 store(setAvailableModels 内解析默认选中)。
// 全局一次性;失败静默 —— 列表保持空,ModelSelector 不渲染。
export function useModelList() {
  useEffect(() => {
    let aborted = false;
    void koubouApi.listModels()
      .then((models) => { if (!aborted) useStore.getState().setAvailableModels(models); })
      .catch(() => { /* 静默:无模型时选择器不渲染 */ });
    return () => { aborted = true; };
  }, []);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useModelList.test.tsx`
Expected: PASS(两例)。

- [ ] **Step 5: 提交**

```bash
git add src/client/useModelList.ts src/client/useModelList.test.tsx
git commit -m "feat: useModelList 挂载拉取可用模型列表"
```

---

### Task 7: 接线 —— Workspace 挂载 hook + 建连传 model

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`(import + hook 调用区 `:36-40`)
- Modify: `src/client/useKoubouConnection.ts`(`createKoubouClient` 调用 `:55-77`)

**Interfaces:**
- Consumes: Task 6 `useModelList`、Task 5 `selectedModel`、Task 4 `createKoubouClient` 的 `model` opt。
- Produces: 无导出 API 变化;使「建连带当前选中模型」与「应用挂载即拉模型」生效。

> 本任务为应用接线(effect/连接层,既有 `useKoubouConnection`/`Workspace` 无单测),以 `tsc` + `lint` + 既有测试不回归 + Task 10 手动冒烟验证,无独立单测。

- [ ] **Step 1: Workspace 挂载 `useModelList`**

`src/components/workspace/Workspace.tsx` import 区追加:
```ts
import { useModelList } from '@/client/useModelList';
```
hook 调用区(`useHostConfig();` 之后)追加:
```ts
  useModelList();
```

- [ ] **Step 2: `useKoubouConnection` 建连传 model**

`src/client/useKoubouConnection.ts` 的 `createKoubouClient({ ... })` 调用内,在 `afterSequence,` 之后追加一行(建连时读取当前选中,不进 effect deps,避免默认解析时抖动重连):
```ts
        model: useStore.getState().selectedModel,
```

- [ ] **Step 3: 类型 + lint 校验**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: 均无错误。

- [ ] **Step 4: 既有连接相关测试不回归**

Run: `pnpm exec vitest run src/koubou/client.test.ts src/client`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/components/workspace/Workspace.tsx src/client/useKoubouConnection.ts
git commit -m "feat: Workspace 挂载模型拉取,建连携带选中模型"
```

---

### Task 8: `ModelSelector` 组件

**Files:**
- Create: `src/components/chat/ModelSelector.tsx`
- Test: `src/components/chat/ModelSelector.test.tsx`

**Interfaces:**
- Consumes: Task 1 `modelLabel`、Task 5 store(`availableModels`/`selectedModel`/`setSelectedModel`)、Task 4 `client.setModel`。
- Produces: `default ModelSelector({ client: React.RefObject<KoubouClient | null> })` —— 胶囊 + 上拉下拉;空列表 / 无选中渲染 `null`。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/chat/ModelSelector.test.tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import ModelSelector from './ModelSelector';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';

function makeClient() {
  const setModel = vi.fn();
  const ref = { current: { setModel } } as unknown as React.RefObject<KoubouClient | null>;
  return { ref, setModel };
}

beforeEach(() => {
  useStore.setState({ availableModels: [], selectedModel: null });
  document.documentElement.dataset.theme = 'light';
});
afterEach(cleanup);

test('无可选模型时不渲染', () => {
  const { ref } = makeClient();
  const { container } = render(<ModelSelector client={ref} />);
  expect(container.firstChild).toBeNull();
});

test('显示当前模型展示名(由 ID 派生)', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8' });
  const { ref } = makeClient();
  render(<ModelSelector client={ref} />);
  expect(screen.getByRole('button', { name: 'Model: Opus 4.8' })).toBeTruthy();
});

test('展开选择 → 写 store 且发 set_model', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-fable-5'], selectedModel: 'claude-opus-4-8' });
  const { ref, setModel } = makeClient();
  render(<ModelSelector client={ref} />);
  act(() => { fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 4.8' })); });
  act(() => { fireEvent.click(screen.getByText('Fable 5')); });
  expect(useStore.getState().selectedModel).toBe('claude-fable-5');
  expect(setModel).toHaveBeenCalledWith('claude-fable-5');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ModelSelector.test.tsx`
Expected: FAIL —— `Failed to resolve import './ModelSelector'`。

- [ ] **Step 3: 实现**(复用 `GenerateForm` 的胶囊 + 上拉下拉语言;选择器在 send 左侧,下拉 `right-0` 对齐右缘;chevron 旋转 180° 上扬以契合上拉)

```tsx
// src/components/chat/ModelSelector.tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { modelLabel } from '@/lib/koubou/models';
import type { KoubouClient } from '@/koubou/client';

// 对话输入区模型选择器(Figma 424:3595 / 33:463):胶囊显示当前模型名 + 上扬 chevron,
// 点击向上弹出列表;选择写持久化(setSelectedModel)并发 session.set_model 热切换(不重连)。
export default function ModelSelector({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const models = useStore((s) => s.availableModels);
  const selected = useStore((s) => s.selectedModel);
  const setSelectedModel = useStore((s) => s.setSelectedModel);
  const [open, setOpen] = useState(false);

  // Esc 收起下拉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // 无可选模型(未加载 / 拉取失败)不渲染
  if (models.length === 0 || !selected) return null;

  const pick = (id: string) => {
    setSelectedModel(id);
    client.current?.setModel(id);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-label={`Model: ${modelLabel(selected)}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 max-w-full items-center gap-2 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-[10px] shadow-[inset_0_0_2px_0_#fff] transition hover:brightness-[0.98]"
      >
        <span className="truncate text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{modelLabel(selected)}</span>
        <FigIcon src={figAsset.chevronDown} size={16} className="shrink-0 rotate-180 opacity-70" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className="absolute bottom-[calc(100%+6px)] right-0 z-[56] flex min-w-[180px] flex-col rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
            {models.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => pick(id)}
                className={`flex h-9 items-center gap-2 rounded-[12px] px-2 text-left transition-colors hover:bg-[var(--color-fill)] ${id === selected ? 'bg-[var(--color-fill)]' : ''}`}
              >
                <span className="flex-1 text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{modelLabel(id)}</span>
                {id === selected && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ModelSelector.test.tsx`
Expected: PASS(三例)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/ModelSelector.tsx src/components/chat/ModelSelector.test.tsx
git commit -m "feat: ModelSelector 模型选择胶囊组件"
```

---

### Task 9: Composer 集成 ModelSelector

**Files:**
- Modify: `src/components/chat/Composer.tsx`(import + 底部按钮行 `:123-167`)
- Modify: `src/components/chat/Composer.test.tsx`(`beforeEach` 重置 + 新增渲染用例)

**Interfaces:**
- Consumes: Task 8 `ModelSelector`(接收 Composer 既有的 `client` 引用)。
- Produces: 无新导出;选择器落位于底部行右侧分组(send/stop 左侧)。

- [ ] **Step 1: 写失败测试**

`Composer.test.tsx` 的 `beforeEach` 改为同时重置模型态(避免跨用例泄漏):
```ts
beforeEach(() => {
  useStore.setState({ composer: { draft: '', refs: [], attachments: [] }, runStatus: 'idle', assets: [], availableModels: [], selectedModel: null });
  document.documentElement.dataset.theme = 'light';
});
```
新增用例(置于文件末尾):
```ts
test('有可选模型时在 send 左侧渲染模型选择器', () => {
  useStore.setState({ availableModels: ['claude-opus-4-8'], selectedModel: 'claude-opus-4-8' });
  render(<Composer client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Model: Opus 4.8' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx -t 模型选择器`
Expected: FAIL —— 找不到 `Model: Opus 4.8` 按钮(尚未集成)。

- [ ] **Step 3: 实现**(`Composer.tsx` 两处改动)

import 区追加:
```ts
import ModelSelector from './ModelSelector';
```

底部按钮行:把原先直接作为 `justify-between` 第二子节点的「run 中 Stop / 否则 Send」条件块,包进右侧分组并在其左侧放 `ModelSelector`。即将 `:146-166` 的条件块替换为:
```tsx
          <div className="flex items-center gap-2">
            <ModelSelector client={client} />
            {runStatus === 'running' ? (
              <IconButton
                variant={submitVariant(true, dark)}
                className="size-10 rounded-[10px]"
                aria-label="Stop"
                onClick={() => client.current?.interrupt()}
              >
                {/* 方块随按钮文字色:浅色按钮→深、深色按钮→白 */}
                <Square size={14} />
              </IconButton>
            ) : (
              <IconButton
                variant={submitVariant(canSend, dark)}
                className={`size-10 ${canSend ? 'rounded-[10px]' : 'rounded-[12px]'}`}
                aria-label="Send"
                onClick={send}
              >
                {/* 箭头随按钮文字色:可发送(深色按钮)→白,未输入(浅色按钮)→深 */}
                <FigIcon src={figAsset.arrowUp} size={20} />
              </IconButton>
            )}
          </div>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: PASS(原 7 例 + 新 1 例;原 Send/Stop 用例因 aria-label 不变而不回归)。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: Composer 输入区集成模型选择器"
```

---

### Task 10: 全量校验 + 手动冒烟

**Files:** 无(仅验证)

- [ ] **Step 1: 全量 CI 等价校验**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 四步全过(lint 无错、tsc 无错、vitest 全绿、next build 成功)。

- [ ] **Step 2: 手动冒烟**(`pnpm dev`,需后端可达)

验证:
- 输入卡右下角、send 左侧出现模型胶囊,显示首项模型展示名(如 "Opus 4.8")。
- 点击向上弹出列表,列出 `/models` 全部模型,当前项高亮带圆点。
- 切换模型 → 胶囊更新;Network/WS 帧应见 `session.set_model`;刷新页面后选择被持久化(localStorage `taluna-v4` 含 `selectedModel`)。
- 切换项目 / 刷新后新建 WS 连接 URL 携带 `model=<选中>` 查询参数。
- 后端 `/models` 不可达时:选择器不渲染,输入区其余功能正常。

- [ ] **Step 3: 收尾提交**(如手动冒烟需微调样式/文案才提交,否则跳过)

```bash
git add -A && git commit -m "fix: 模型选择器冒烟微调"
```

## 自检(spec 覆盖)

- ✅ `/models` 拉取 → Task 2/6;默认取首项 → Task 1(`resolveSelectedModel`)/5。
- ✅ 本地持久化用户选择 → Task 5(partialize `selectedModel`)。
- ✅ 建连带 model → Task 3/4/7。
- ✅ 运行中切换发 `session.set_model` → Task 4/8。
- ✅ 展示名由 ID 派生 → Task 1/8。
- ✅ 空列表不渲染 → Task 8。
- ✅ UI 落位(send 左侧、上拉下拉)→ Task 8/9。
- 类型一致性:`setAvailableModels`/`setSelectedModel`/`setModel`/`modelLabel`/`resolveSelectedModel`/`listModels` 在定义任务与消费任务中签名一致,已核对。
