# 历史消息副作用惰性化 实现计划（onEvent 驱动 · 精简版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 勾选。

**Goal:** 资产导入/视频·3D 任务登记只由「实时 WS 帧」触发；历史（localStorage 快照 / REST /events 分页）不再触发。问答卡做一处后端权威小加固。

**Architecture:** 把导入触发从「扫 `messages` 的 hook」搬进 WS `onEvent`；新增纯函数 `eventAssets(e)` 解析实时 tool_result 帧里的 ready media/submitted task；删除两个扫描 hook 与预填补丁。问答 `onReady` 改「整体替换」。

## Global Constraints

- 中文注释 / 中文 commit（一句话总结）；纯函数不可变更新；`store` 唯一落库入口。
- 测试同目录 `*.test.ts(x)`；单文件 `pnpm exec vitest run <路径>`。类型以 `pnpm exec tsc --noEmit` 为准（worktree IDE 模块诊断是误报）。
- `eslint-disable` 必带 `-- 理由`；不留 dead code。

---

## 文件结构

- Modify `src/lib/media-import.ts` — 新增 `eventAssets`；（T4）删去变死的 `collectReadyMedia` / `pendingImports` 及 `Message` 导入。
- Modify `src/store/actions.ts` — 新增 `importFromLiveEvent(e)`（串行导入链）。
- Modify `src/store/index.ts` / `src/store/types.ts` — 暴露 `importFromLiveEvent`；（T4）删预填补丁与 `collectReadyMedia` 导入。
- Modify `src/client/useKoubouConnection.ts` — `onEvent` 调 `importFromLiveEvent`。
- Delete `src/client/useCanvasAutoImport.ts(+.test.tsx)`、`src/client/useAgentGenTasks.ts(+.test.tsx)`；`src/components/workspace/Workspace.tsx` 去挂载。
- Modify `src/koubou/apply-koubou.ts` — `onReady` 整体替换 pending。
- Tests：`src/lib/media-import.test.ts`（+eventAssets、-死函数）、`src/store/actions.test.ts` 或新建（importFromLiveEvent）、`src/koubou/apply-koubou.test.ts`（onReady 替换）、`src/store/koubou-seed.test.ts`（改写）。

**顺序**：T1 加纯函数 → T2 加 action（暂未接线，hook 仍在，无双导入）→ T3 接线 onEvent + 删 hook（原子替换）→ T4 清预填与死代码 → T5 问答加固 → T6 全量+运行时校验。

---

### Task 1: 纯函数 `eventAssets(e)`

**Files:** Modify `src/lib/media-import.ts`；Test `src/lib/media-import.test.ts`

**Interfaces:**
- Produces: `eventAssets(e: ServerEvent): { media: ReadyMedia[]; tasks: SubmittedTask[] }` —— 仅当 `e` 是 `claude.message` 且 `sdk_type==='UserMessage'` 时解析其 `tool_result` 块（跳过 `is_error`）：ready 图/音 → `media`（video/3D 的 media 跳过），`media.task_submitted`(video/3D) → `tasks`。

- [ ] **Step 1: 写失败测试**

在 `src/lib/media-import.test.ts` 顶部 import 追加 `eventAssets`，并新增：

```ts
import type { ServerEvent } from '@/koubou/protocol';

const userToolResult = (content: string): ServerEvent => ({
  type: 'claude.message', project_id: '2', session_id: 's1',
  payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content }] } },
} as unknown as ServerEvent);

describe('eventAssets', () => {
  test('ready 图片 media → media 项(basename + kind + previewUrl)', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: 'https://x/p.png' }] }));
    expect(eventAssets(e)).toEqual({ media: [{ filename: 'hero.png', kind: 'image', previewUrl: 'https://x/p.png' }], tasks: [] });
  });

  test('video task_submitted → tasks 项', () => {
    const e = userToolResult(JSON.stringify({ type: 'media.task_submitted', task_id: 'gt1', kind: 'video' }));
    expect(eventAssets(e)).toEqual({ media: [], tasks: [{ taskId: 'gt1', kind: 'video' }] });
  });

  test('is_error 结果跳过', () => {
    const e = { type: 'claude.message', project_id: '2', session_id: 's1', payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/x.png', preview_url: null }] }) }] } } } as unknown as ServerEvent;
    expect(eventAssets(e)).toEqual({ media: [], tasks: [] });
  });

  test('非 claude.message / 非 UserMessage → 空', () => {
    expect(eventAssets({ type: 'session.ready', project_id: '2', session_id: 's1', payload: {} } as ServerEvent)).toEqual({ media: [], tasks: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/media-import.test.ts -t "eventAssets"`
Expected: FAIL（`eventAssets` 未定义）

- [ ] **Step 3: 实现 `eventAssets`**

在 `src/lib/media-import.ts` 顶部 import 追加：

```ts
import type { ServerEvent } from '@/koubou/protocol';
import { toolResultText, parseMediaItems, parseSubmittedTask } from '@/koubou/protocol';
import type { SubmittedTask } from '@/koubou/protocol';
```

在文件末尾追加：

```ts
// 从「实时 WS tool_result 帧」解析出可导入资产:仅 claude.message/UserMessage 的 tool_result(跳过 is_error)。
// 供 onEvent 调用——历史(localStorage 快照 / REST 分页)不走 WS 事件,故天然不触发。
export function eventAssets(e: ServerEvent): { media: ReadyMedia[]; tasks: SubmittedTask[] } {
  const media: ReadyMedia[] = [];
  const tasks: SubmittedTask[] = [];
  if (e.type !== 'claude.message') return { media, tasks };
  const cm = e.payload as unknown as { sdk_type?: string; payload?: { content?: unknown } };
  if (cm.sdk_type !== 'UserMessage' || !Array.isArray(cm.payload?.content)) return { media, tasks };
  for (const b of cm.payload.content as Array<Record<string, unknown>>) {
    if (!b || b.type !== 'tool_result' || b.is_error) continue;
    const text = toolResultText(b.content);
    for (const item of parseMediaItems(text) ?? []) {
      if (!item.path) continue;
      const kind = mediaKindToAssetKind(item.kind);
      if (kind === 'video' || kind === '3d') continue;   // video/3D 走 task,不从 media 导
      media.push({ filename: basename(item.path), kind, previewUrl: item.previewUrl });
    }
    const task = parseSubmittedTask(text);
    if (task) tasks.push(task);
  }
  return { media, tasks };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/media-import.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/media-import.ts src/lib/media-import.test.ts
git commit -m "feat: 新增 eventAssets 纯函数——从实时 WS tool_result 帧解析可导入的图/音 media 与视频/3D 任务"
```

---

### Task 2: store action `importFromLiveEvent(e)`

**Files:** Modify `src/store/actions.ts`、`src/store/index.ts`(接口声明)、`src/store/types.ts`(若接口在此)；Test `src/store/actions.test.ts`（追加）

**Interfaces:**
- Consumes: `eventAssets`、`get().importGeneratedAsset`、`get().registerAgentGenTask`。
- Produces: `importFromLiveEvent(e: ServerEvent): void` —— 解析事件资产,串行(promise 链)调 `importGeneratedAsset`,并对每个 task 调 `registerAgentGenTask`。仅供 `onEvent` 调用。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 追加（沿用该文件既有 store 初始化范式）：

```ts
import type { ServerEvent } from '@/koubou/protocol';

const liveMedia = (): ServerEvent => ({
  type: 'claude.message', project_id: '42', session_id: 's1',
  payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: null }] }) }] } },
} as unknown as ServerEvent);

describe('importFromLiveEvent', () => {
  test('实时 media 帧 → 调 importGeneratedAsset(basename,kind,previewUrl)', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, importGeneratedAsset: spy as never });
    useStore.getState().importFromLiveEvent(liveMedia());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('hero.png', 'image', null));
  });

  test('实时 video task 帧 → 调 registerAgentGenTask(taskId,kind)', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, registerAgentGenTask: spy as never });
    const e = { type: 'claude.message', project_id: '42', session_id: 's1', payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify({ type: 'media.task_submitted', task_id: 'gt1', kind: 'video' }) }] } } } as unknown as ServerEvent;
    useStore.getState().importFromLiveEvent(e);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('gt1', 'video'));
  });

  test('非资产帧不触发', async () => {
    const iSpy = vi.fn().mockResolvedValue(undefined); const rSpy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, importGeneratedAsset: iSpy as never, registerAgentGenTask: rSpy as never });
    useStore.getState().importFromLiveEvent({ type: 'session.ready', project_id: '42', session_id: 's1', payload: {} } as ServerEvent);
    await Promise.resolve();
    expect(iSpy).not.toHaveBeenCalled(); expect(rSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "importFromLiveEvent"`
Expected: FAIL（`importFromLiveEvent` 未定义）

- [ ] **Step 3: 实现 action**

在 `src/store/actions.ts` 顶部 import 追加：

```ts
import { eventAssets } from '@/lib/media-import';
import type { ServerEvent } from '@/koubou/protocol';
```

在 `createServerActions` 内（返回对象之前）加一条 per-连接串行链与 action：

```ts
  // 实时 WS 帧携带的资产副作用:仅 onEvent 调用(历史加载不走此路径)。
  // 串行导入保证级联落位——下一条能读到上一条已落库坐标;去重由 import/register 内部兜底。
  let liveImportChain: Promise<void> = Promise.resolve();
  const importFromLiveEvent = (e: ServerEvent) => {
    const { media, tasks } = eventAssets(e);
    for (const m of media) {
      liveImportChain = liveImportChain
        .then(() => get().importGeneratedAsset(m.filename, m.kind, m.previewUrl))
        .catch(() => {});   // 单条失败不阻断队列(PgcError 已在 action 内转 lastError)
    }
    for (const t of tasks) void get().registerAgentGenTask(t.taskId, t.kind).catch(() => {});
  };
```

把 `importFromLiveEvent` 加入 `createServerActions` 返回对象（与 `importGeneratedAsset` 等并列）。

在 `src/store/index.ts` 的 `ServerActions` 接口（`importGeneratedAsset` 声明附近）追加：

```ts
  importFromLiveEvent: (e: ServerEvent) => void;   // 实时 WS 资产帧 → 导入/登记(仅 onEvent 调)
```

并确保该文件已 import `ServerEvent`（`import type { ServerEvent } from '@/koubou/protocol';`，如无则加）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "importFromLiveEvent"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/actions.ts src/store/index.ts src/store/actions.test.ts
git commit -m "feat: 新增 importFromLiveEvent action——实时 WS 资产帧串行导入/登记(暂未接线)"
```

---

### Task 3: `onEvent` 接线 + 删除两个扫描 hook（原子替换）

**Files:** Modify `src/client/useKoubouConnection.ts`、`src/components/workspace/Workspace.tsx`；Delete `src/client/useCanvasAutoImport.ts(+.test.tsx)`、`src/client/useAgentGenTasks.ts(+.test.tsx)`；Modify `src/lib/media-import.ts`(删 `pendingImports`)、`src/lib/media-import.test.ts`(删其用例)

**Interfaces:**
- Consumes: `useStore.getState().importFromLiveEvent`。
- Produces: 实时事件资产改由 onEvent 单一路径触发；扫描 hook 移除。

- [ ] **Step 1: onEvent 接线**

在 `src/client/useKoubouConnection.ts` 的 `onEvent` 回调里，`useStore.getState().ingestKoubou(e);` 之后追加一行：

```ts
          // 实时资产副作用只在此触发:历史(快照/REST 分页)不走 onEvent,天然惰性
          useStore.getState().importFromLiveEvent(e);
```

- [ ] **Step 2: 删两个扫描 hook 及其挂载**

删除文件：`src/client/useCanvasAutoImport.ts`、`src/client/useCanvasAutoImport.test.tsx`、`src/client/useAgentGenTasks.ts`、`src/client/useAgentGenTasks.test.tsx`。

在 `src/components/workspace/Workspace.tsx` 删除两处 import 与两处调用：

```ts
import { useCanvasAutoImport } from '@/client/useCanvasAutoImport';
import { useAgentGenTasks } from '@/client/useAgentGenTasks';
```
以及组件体内的 `useCanvasAutoImport();` / `useAgentGenTasks();` 两行。

- [ ] **Step 3: 删除变死的 `pendingImports`**

在 `src/lib/media-import.ts` 删除 `pendingImports` 函数（其唯一消费者 `useCanvasAutoImport` 已删）。在 `src/lib/media-import.test.ts` 删除 `describe('pendingImports', ...)` 用例与 import 里的 `pendingImports`。

- [ ] **Step 4: 校验**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/lib/media-import.test.ts src/store/actions.test.ts`
Expected: 类型通过；测试 PASS（无对已删 hook 的悬空引用）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 实时资产导入改由 onEvent 触发,删除 useCanvasAutoImport/useAgentGenTasks 扫描 hook 与 pendingImports——历史不再重放导入"
```

---

### Task 4: 移除预填 `importedByProject` 补丁 + 清死代码

**Files:** Modify `src/store/index.ts`、`src/lib/media-import.ts`(删 `collectReadyMedia`)、`src/lib/media-import.test.ts`、`src/store/koubou-seed.test.ts`

- [ ] **Step 1: 改写 koubou-seed 测试为「不预填」**

把 `src/store/koubou-seed.test.ts` 的 `describe` 改为断言不预填（`readyEvent` / `cmsg` 保留）：

```ts
describe('历史重建不预填 importedByProject(改由 onEvent 驱动)', () => {
  test('从服务器重建历史:不预填 importedByProject', () => {
    useStore.getState().ingestKoubou(readyEvent());
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('hero.png');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/koubou-seed.test.ts`
Expected: FAIL（当前仍预填 → `not.toContain` 失败）

- [ ] **Step 3: 删预填补丁与死代码**

在 `src/store/index.ts`：删除第 21 行 `import { collectReadyMedia } from '@/lib/media-import';`；把 `ingestKoubou` 改为 `ingestKoubou: (e) => set((s) => applyKoubou(s, e)),`；把 `seedKoubouHistory` 改为 `seedKoubouHistory: (page) => set((s) => seedHistory(s, page)),`（删去两处 `collectReadyMedia` 预填块与 `extra`）。

在 `src/lib/media-import.ts`：删除 `collectReadyMedia` 函数与顶部 `import type { Message } from '@/store/types';`（若已无其它使用）。在 `src/lib/media-import.test.ts` 删除 `collectReadyMedia` 相关 import 与用例。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/koubou-seed.test.ts src/lib/media-import.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 移除历史预填 importedByProject 补丁及随之变死的 collectReadyMedia——历史惰性化统一由 onEvent 源头分流负责"
```

---

### Task 5: `onReady` 以后端 `pending_interactions` 整体替换（问答小加固）

**Files:** Modify `src/koubou/apply-koubou.ts`；Test `src/koubou/apply-koubou.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 的 `describe('session.ready', ...)` 内追加：

```ts
  test('onReady 用 pending_interactions 整体替换 pending(旧的被清)', () => {
    const base = { ...S(), pendingInteractions: { old: { kind: 'question' as const, interactionId: 'old', questions: [] } } };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, visible_state: { messages: [] }, pending_interactions: [
      { interaction_id: 'i1', interaction_type: 'approval', tool_name: 'Bash', request: { input: { command: 'ls' } } },
    ] } }));
    expect(next.pendingInteractions['old']).toBeUndefined();
    expect(next.pendingInteractions['i1']).toMatchObject({ kind: 'approval', toolName: 'Bash' });
  });

  test('onReady 无 pending_interactions 时清空所有 pending', () => {
    const base = { ...S(), pendingInteractions: { old: { kind: 'question' as const, interactionId: 'old', questions: [] } } };
    const next = applyKoubou(base, ev({ type: 'session.ready', payload: { session_id: 's1', active_run: null, visible_state: { messages: [] } } }));
    expect(next.pendingInteractions).toEqual({});
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts -t "整体替换 pending"`
Expected: FAIL（当前 merge，`old` 仍在）

- [ ] **Step 3: 改 `onReady`**

在 `src/koubou/apply-koubou.ts` `onReady` 里，把：

```ts
  // 合并 pending(去重 by interaction_id)
  for (const it of p.pending_interactions ?? []) {
    next = upsertPending(next, toPending(it));
  }
  return next;
```

替换为：

```ts
  // pending 以后端 pending_interactions 为唯一权威快照:整体替换(先清后设),
  // 后端已不认为 pending 的(答过/超时/别 tab 处理)不残留
  next = { ...next, pendingInteractions: {} };
  for (const it of p.pending_interactions ?? []) {
    next = upsertPending(next, toPending(it));
  }
  return next;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS（含原有 session.ready 用例）

- [ ] **Step 5: 提交**

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: onReady 以后端 pending_interactions 整体替换 pending——清掉后端已不认为挂起的残留交互卡"
```

---

### Task 6: 全量 + 运行时校验

- [ ] **Step 1: 类型检查** — Run `pnpm exec tsc --noEmit`，Expected 无错误。
- [ ] **Step 2: 全量测试** — Run `pnpm exec vitest run`，Expected 全绿。
- [ ] **Step 3: lint** — Run `pnpm lint`，Expected 无 error。
- [ ] **Step 4: 运行时验证**（Skill `verify` / `run`）：本地起应用，实时发一条生成图片的对话确认画布落卡一次；刷新页面/清 localStorage 重开确认历史资产不再重复落卡、不再重复发 import 请求（Network 面板）。若无法连后端，则以 `useKoubouConnection` 的 onEvent 单测 + 手工注入 store 态验证。

---

## 自检（对照 spec）

- 资产 onEvent 驱动 → T1(eventAssets)+T2(importFromLiveEvent)+T3(接线/删 hook) ✓
- 删预填 + 死代码 → T4 ✓
- 问答 onReady 权威替换 → T5 ✓
- 无 historyMsgCount/seenSequences（已否决）→ 计划中无相关任务 ✓
- 占位符扫描：无 TBD；改码步骤均含完整代码。
- 类型一致：`eventAssets(e): {media,tasks}` 在 T1 定义、T2 消费一致；`importFromLiveEvent(e)` 声明与实现一致。
