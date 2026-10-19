# Agent 生成资产：画布加载卡 + 复用轮询 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent 提交 video/3d 生成任务时（`media.task_submitted`），立刻在画布落一张 `generating` 加载卡，并用其 `task_id` 复用既有 `GenTask`/`pollGenTasks` 轮询推进到 ready/失败。

**Architecture:** 协议层把 `media.task_submitted` 解析为 `SubmittedTask{taskId,kind}` 并挂到 tool `Part`；新 hook `useAgentGenTasks` 扫描对话发现未处理任务 → 调新 action `registerAgentGenTask`，落占位卡 + 首拉 `pollVideo/pollModel3d` 拿真实 `item_id` 原位替换 + 登记 `GenTask`，之后零改动复用 `useCanvasPolling`/`pollGenTasks`。三道去重（持久化 `agentTasksByProject` 触发去重 / 真实 item_id 身份去重 / `collectReadyMedia` 收窄到 image-audio 路径分流）。

**Tech Stack:** Next.js 16 + React 19 + zustand(persist) + vitest(jsdom)。设计稿见 `docs/superpowers/specs/2026-06-29-agent-gen-canvas-cards-design.md`。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**；commit message 一句话总结。
- 颜色/动效等 UI 令牌走 `globals.css` 变量（本计划无新增 UI 视觉，沿用既有占位卡）。
- 纯函数 + 唯一落库入口：状态变更走 store action，返回新对象、不可变更新；hook 只检测 + 派发，不直接改 store。
- `await` 后必校验 `if (get().currentProjectId !== pid) return;`，丢弃过期响应。
- **只取后端契约约定字段**（`type`/`kind`/`task_id`/`asset_path`…），不加 camelCase 兜底、不臆测字段。
- 位置归前端所有：轮询 / `loadCanvas` 不覆盖已落位 `position`。
- `eslint-disable` 必带 `-- 理由`；注释解释「为什么」（竞态/不变式/后端契约）。
- 测试与源码同目录（`*.test.ts(x)`）；TDD：先写失败测试。
- 每个任务末尾验证命令：`pnpm exec vitest run <文件>`；全量收口跑 `pnpm lint && pnpm exec tsc --noEmit && pnpm test`。

---

### Task 1: 协议层 `parseSubmittedTask`

**Files:**
- Modify: `src/koubou/protocol.ts`（新增 `SubmittedTask` 接口 + `parseSubmittedTask`，紧邻 `parseMediaItems`）
- Test: `src/koubou/protocol.test.ts`（新增 `describe('parseSubmittedTask')`）

**Interfaces:**
- Produces: `export interface SubmittedTask { taskId: string; kind: 'video' | 'model3d' }`；`export function parseSubmittedTask(text: string): SubmittedTask | null`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/protocol.test.ts` 顶部 import 追加 `parseSubmittedTask`（与现有同一行 import 合并）：

```ts
import { isFullMessage, parseMediaItems, parseSubmittedTask, classifyClose, buildWsUrl, toolResultText } from './protocol';
```

在 `describe('parseMediaItems')` 块之后新增：

```ts
describe('parseSubmittedTask', () => {
  test('video 提交回执 → {taskId, kind:video}', () => {
    const j = JSON.stringify({ type: 'media.task_submitted', kind: 'video', task_id: 'gtask-1', status: 'pending' });
    expect(parseSubmittedTask(j)).toEqual({ taskId: 'gtask-1', kind: 'video' });
  });
  test('3d / model3d 都归一为 model3d', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: '3d', task_id: 'g2' }))).toEqual({ taskId: 'g2', kind: 'model3d' });
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'model3d', task_id: 'g3' }))).toEqual({ taskId: 'g3', kind: 'model3d' });
  });
  test('image / audio → null(无 poll 端点,走 auto-import)', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'image', task_id: 'g4' }))).toBeNull();
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'audio', task_id: 'g5' }))).toBeNull();
  });
  test('缺 task_id → null', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.task_submitted', kind: 'video' }))).toBeNull();
  });
  test('非 task_submitted(tasks.status) / 纯文本 / 非法 → null', () => {
    expect(parseSubmittedTask(JSON.stringify({ type: 'media.tasks.status', items: [] }))).toBeNull();
    expect(parseSubmittedTask('plain text')).toBeNull();
    expect(parseSubmittedTask('{"kind":"video","task_id":"x"}')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts -t parseSubmittedTask`
Expected: FAIL（`parseSubmittedTask is not a function` / import 报错）

- [ ] **Step 3: 实现**

在 `src/koubou/protocol.ts` 的 `parseMediaItems` 函数定义之后追加：

```ts
// ---- 提交回执(submit_*_generation 的 media.task_submitted)----
// 仅放行有 PGC 轮询端点的 video/3d(image/audio 同步、无 poll 端点,继续走 useCanvasAutoImport)。
// kind 归一到 'video' | 'model3d' 以对齐 GenTask.kind。
export interface SubmittedTask { taskId: string; kind: 'video' | 'model3d' }

export function parseSubmittedTask(text: string): SubmittedTask | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.type !== 'media.task_submitted') return null;
  if (typeof o.task_id !== 'string' || !o.task_id) return null;
  const kind = o.kind === 'video' ? 'video' as const
    : (o.kind === '3d' || o.kind === 'model3d') ? 'model3d' as const
    : null;
  if (!kind) return null;
  return { taskId: o.task_id, kind };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/protocol.test.ts`
Expected: PASS（含原 `parseMediaItems` 用例）

- [ ] **Step 5: 提交**

```bash
git add src/koubou/protocol.ts src/koubou/protocol.test.ts
git commit -m "feat: 协议层 parseSubmittedTask 解析 media.task_submitted 的 video/3d 任务回执"
```

---

### Task 2: `Part.submittedTask` 字段 + `foldResults` 挂载

**Files:**
- Modify: `src/store/types.ts:3`（import 追加 `SubmittedTask`）、`src/store/types.ts:33`（tool Part 加可选字段）
- Modify: `src/koubou/apply-koubou.ts:5`（import 追加 `parseSubmittedTask`）、`src/koubou/apply-koubou.ts:220`（foldResults 挂载）
- Test: `src/koubou/apply-koubou.test.ts`（新增一条断言）

**Interfaces:**
- Consumes: `SubmittedTask`、`parseSubmittedTask`（Task 1）
- Produces: tool `Part` 携带 `submittedTask?: SubmittedTask`

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 现有 `test('UserMessage 的 tool_result 回填到 tool part,media.tasks.status 解析', ...)` 之后新增（沿用文件已有的 `applyKoubou`/`S`/`ev` helper 与同样的两步事件结构——先 AssistantMessage 出 tool_use，再 UserMessage 折叠 tool_result）：

```ts
test('submit_*_generation 的 media.task_submitted(video) → tool part 带 submittedTask', () => {
  let s = applyKoubou(S(), ev({ type: 'claude.message', sequence: 3, payload: { sdk_type: 'AssistantMessage', payload: { message_id: 'ms', content: [{ type: 'tool_use', id: 'ts', name: 'submit_video_generation', input: {} }] } } }));
  const submittedJson = JSON.stringify({ type: 'media.task_submitted', kind: 'video', task_id: 'gtask-9', status: 'pending' });
  s = applyKoubou(s, ev({ type: 'claude.message', sequence: 4, payload: { sdk_type: 'UserMessage', payload: { content: [{ type: 'tool_result', tool_use_id: 'ts', content: submittedJson }] } } }));
  const part = s.messages.flatMap((m) => m.parts).find((p) => p.type === 'tool' && p.id === 'ts');
  expect(part && part.type === 'tool' && part.submittedTask).toEqual({ taskId: 'gtask-9', kind: 'video' });
});
```

> 注：若 `S()` / `ev()` helper 名称与文件实际不同，照搬该文件 `media.tasks.status` 用例（约 `apply-koubou.test.ts:205`）的同款 helper 与事件构造方式，仅把 tool 名改 `submit_video_generation`、结果 JSON 改 `media.task_submitted`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts -t submittedTask`
Expected: FAIL（`submittedTask` 为 `undefined`）

- [ ] **Step 3: 实现**

`src/store/types.ts` —— import 行（第 3 行）追加 `SubmittedTask`：

```ts
import type { MediaItem, QuestionDef, FileDiff, ServerEvent, SubmittedTask } from '@/koubou/protocol';
```

tool Part 分支（第 33 行）加可选字段：

```ts
  | { type: 'tool'; id: string; name: string; input: unknown; status: Status; result?: string; media?: MediaItem[]; diff?: FileDiff; submittedTask?: SubmittedTask };
```

`src/koubou/apply-koubou.ts` —— import（第 5 行）追加 `parseSubmittedTask`：

```ts
import { isFullMessage, parseMediaItems, parseSubmittedTask, toolResultText, parseFileDiff } from './protocol';
```

`foldResults` 非 error 分支（第 220 行 `return { ...p, ... }`）追加 `submittedTask`：

```ts
      return { ...p, status: 'ready' as const, result: text, media: parseMediaItems(text) ?? undefined, submittedTask: parseSubmittedTask(text) ?? undefined, diff: attach ? diff : p.diff };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/types.ts src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: tool Part 携带 submittedTask,foldResults 解析挂载 video/3d 任务回执"
```

---

### Task 3: `collectReadyMedia` 收窄到 image/audio（路径分流）

**Files:**
- Modify: `src/lib/media-import.ts:46-59`（`collectReadyMedia` 跳过 video/3d）
- Test: `src/lib/media-import.test.ts`（新增 video/3d 跳过断言）
- Modify: `src/client/useCanvasAutoImport.test.tsx:41-53`（既有用例混用 image+video，收窄后 video 不再入队，改为 image+audio）

**Interfaces:**
- Produces: `collectReadyMedia` 输出 `ReadyMedia[]` 仅含 image/audio（契约结构不变）

- [ ] **Step 1: 写失败测试**

`src/lib/media-import.test.ts` 新增（与该文件既有 `collectReadyMedia`/`Message` 构造同款；若文件无现成 helper，按 `useCanvasAutoImport.test.tsx:7-11` 的 `mediaMsg` 形状构造 message）：

```ts
test('collectReadyMedia 跳过 video/3d(由 agent task 路径独占),仍收 image/audio', () => {
  const msg: Message = { id: 'm1', role: 'assistant', status: 'ready', parts: [
    { type: 'tool', id: 't1', name: 'gen', input: {}, status: 'ready', media: [
      { kind: 'image', path: 'a/img.png', previewUrl: 'https://x/img.png' },
      { kind: 'video', path: 'a/clip.mp4', previewUrl: 'https://x/clip.mp4' },
      { kind: 'model3d', path: 'a/model.glb', previewUrl: 'https://x/model.glb' },
      { kind: 'audio', path: 'a/snd.mp3', previewUrl: 'https://x/snd.mp3' },
    ] },
  ] };
  expect(collectReadyMedia([msg])).toEqual([
    { filename: 'img.png', kind: 'image', previewUrl: 'https://x/img.png' },
    { filename: 'snd.mp3', kind: 'audio', previewUrl: 'https://x/snd.mp3' },
  ]);
});
```

确保该测试文件已 import `collectReadyMedia` 与 `Message` 类型（参照文件现有 import；`Message` 来自 `@/store/types`）。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/lib/media-import.test.ts -t "跳过 video"`
Expected: FAIL（当前 video/model3d 也被收进结果）

- [ ] **Step 3: 实现**

`src/lib/media-import.ts` 的 `collectReadyMedia` 内层循环改为：

```ts
      for (const item of p.media) {
        if (!item.path) continue;
        const kind = mediaKindToAssetKind(item.kind);
        // video/3d 由 agent task 路径(registerAgentGenTask)独占落卡;此处跳过避免 from-url import 造第二张卡。
        // image/audio 无 PGC poll 端点,继续走 useCanvasAutoImport。
        if (kind === 'video' || kind === '3d') continue;
        out.push({ filename: basename(item.path), kind, previewUrl: item.previewUrl });
      }
```

- [ ] **Step 4: 修既有 useCanvasAutoImport 用例**

`src/client/useCanvasAutoImport.test.tsx` 的 `test('多条 ready media 串行导入并保持出现顺序', ...)`（约 41–53 行）把第二条 media 由 `video`/`b.mp4` 改为 `audio`/`b.mp3`，断言顺序改为 `['a.png', 'b.mp3']`：

```ts
        { type: 'tool', id: 't2', name: 'gen', input: {}, status: 'ready', media: [{ kind: 'audio', path: 'assets/b.mp3', previewUrl: null }] },
```
```ts
    expect(order).toEqual(['a.png', 'b.mp3']);
```

- [ ] **Step 5: 运行相关测试确认通过**

Run: `pnpm exec vitest run src/lib/media-import.test.ts src/client/useCanvasAutoImport.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/lib/media-import.ts src/lib/media-import.test.ts src/client/useCanvasAutoImport.test.tsx
git commit -m "feat: collectReadyMedia 收窄到 image/audio,video/3d 交 agent task 路径独占"
```

---

### Task 4: `agentTasksByProject` 状态 + 持久化 + 删项目清桶

**Files:**
- Modify: `src/store/types.ts`（`ServerState` 加字段、`createInitialServerState` 初始化）
- Modify: `src/store/index.ts:312-320`（partialize 白名单加 `agentTasksByProject`）
- Modify: `src/store/actions.ts:183-195`（`deleteProject` 一并清 `agentTasksByProject` 分桶）
- Test: `src/store/actions.test.ts`（`deleteProject` 清桶断言）

**Interfaces:**
- Produces: `ServerState.agentTasksByProject: Record<string, string[]>`（已处理的 agent 生成 taskId，按项目，触发去重用）

- [ ] **Step 1: 写失败测试**

`src/store/actions.test.ts` 在 `deleteProject` 相关 describe 内新增（参照文件既有 `proj()` 工厂与 mock 范式；`deleteProject` 现有测试可作模板）：

```ts
test('deleteProject 一并清掉该项目的 agentTasksByProject 分桶', async () => {
  api.listProjects.mockResolvedValue({ items: [proj(7), proj(8)], total: 2, page: 1, page_size: 100 });
  api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
  api.listVersions.mockResolvedValue({ items: [], total: 0 });
  api.deleteProject.mockResolvedValue({ id: 8 });
  useStore.setState({ projects: [proj(7), proj(8)], currentProjectId: 7, agentTasksByProject: { '7': ['gt7'], '8': ['gt8'] } });
  await useStore.getState().deleteProject(8);
  expect(useStore.getState().agentTasksByProject).toEqual({ '7': ['gt7'] });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "agentTasksByProject 分桶"`
Expected: FAIL（`agentTasksByProject` 不存在 / 未清桶 → `'8'` 残留或字段 undefined）

- [ ] **Step 3: 实现**

`src/store/types.ts` —— `ServerState` 接口在 `importedByProject` 行后追加：

```ts
  agentTasksByProject: Record<string, string[]>;   // 已处理的 agent 生成 taskId(按项目),触发去重用(镜像 importedByProject 语义)
```

`createInitialServerState` 的返回对象追加 `agentTasksByProject: {}`：

```ts
export function createInitialServerState(): ServerState {
  return { booting: true, projects: [], currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], pendingVersionId: null, buildingVersion: null, authRequired: false, lastError: null, koubouByProject: {}, genTasksByProject: {}, importedByProject: {}, agentTasksByProject: {} };
}
```

`src/store/index.ts` —— `partialize`（约 312 行）在 `importedByProject` 行后追加：

```ts
        importedByProject: s.importedByProject,
        agentTasksByProject: s.agentTasksByProject,
```

`src/store/actions.ts` —— `deleteProject`（约 183 行）在已有 `genTasksByProject` 摘除旁追加 `agentTasksByProject` 摘除：

```ts
  const deleteProject = async (id: number) => guard(set, async () => {
    await pgcApi.deleteProject(id);
    const rest = get().projects.filter((p) => p.id !== id);
    const { [String(id)]: _removed, ...restGenTasks } = get().genTasksByProject;
    const { [String(id)]: _removedAgent, ...restAgentTasks } = get().agentTasksByProject;   // eslint 解构剔除,_ 前缀标记未用
    set({ projects: rest, genTasksByProject: restGenTasks, agentTasksByProject: restAgentTasks });
    if (get().currentProjectId === id) {
```
（其余行不变。）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "agentTasksByProject 分桶"`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store/types.ts src/store/index.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 新增持久化 agentTasksByProject(agent 生成任务触发去重),删项目同步清桶"
```

---

### Task 5: `registerAgentGenTask` action + `adoptAgentItem` 助手 + `pollGenTasks` 适配占位卡

**Files:**
- Modify: `src/store/actions.ts`（新增 `adoptAgentItem` 闭包、`registerAgentGenTask` action、`pollGenTasks` 加占位卡适配分支、`return {...}` 导出）
- Test: `src/store/actions.test.ts`（新增 `describe('registerAgentGenTask')`）

**Interfaces:**
- Consumes: `pgcApi.pollVideo/pollModel3d`（返回 `CanvasGenTask{task_id,status,item,failure}`）；`canvasItemToAsset`、`assetReference`、`getViewportCenter`、`addGenPlaceholder`、`removeGenPlaceholder`、`commitGenTasks`、`FAILED_TASK_STATUSES`、`agentTasksByProject`（Task 4）、`GenTask`、`Asset`、`AssetKind`、`CanvasGenFailure`
- Produces: `registerAgentGenTask(taskId: string, kind: 'video' | 'model3d'): Promise<void>`

- [ ] **Step 1: 写失败测试**

`src/store/actions.test.ts` 新增（沿用文件顶部 mock 的 `api.pollVideo`/`api.pollModel3d`、`proj()`；`registerViewportCenter` 已在文件 import）：

```ts
describe('registerAgentGenTask(agent 生成 → 画布加载卡 + 轮询)', () => {
  const item = (id: string, status = 'generating', type = 'video') => ({ item_id: id, type, status, url: status === 'ready' ? `https://x/${id}.mp4` : null, name: id });

  beforeEach(() => {
    useStore.setState({ currentProjectId: 7, assets: [], genTasks: [], agentTasksByProject: {} });
  });

  test('首拉拿到 generating item → 落真实 item_id 卡(generating) + 登记 GenTask + 记去重', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt1', status: 'running', item: item('itm1') });
    await useStore.getState().registerAgentGenTask('gt1', 'video');
    const st = useStore.getState();
    expect(api.pollVideo).toHaveBeenCalledWith(7, 'gt1');
    expect(st.assets.map((a) => a.id)).toEqual(['itm1']);            // 占位卡已被真实卡原位替换
    expect(st.assets[0].status).toBe('generating');
    expect(st.genTasks).toEqual([expect.objectContaining({ itemId: 'itm1', kind: 'video', taskId: 'gt1' })]);
    expect(st.agentTasksByProject['7']).toContain('gt1');
  });

  test('首拉即 ready → 落 ready 卡,不登记 GenTask(无需轮询)', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt2', status: 'succeeded', item: item('itm2', 'ready') });
    await useStore.getState().registerAgentGenTask('gt2', 'video');
    const st = useStore.getState();
    expect(st.assets.map((a) => a.id)).toEqual(['itm2']);
    expect(st.assets[0].status).toBe('ready');
    expect(st.genTasks).toEqual([]);
    expect(st.agentTasksByProject['7']).toContain('gt2');
  });

  test('重复 taskId(已在去重集)→ 直接返回,不重复落卡/不再 poll', async () => {
    useStore.setState({ agentTasksByProject: { '7': ['gt3'] } });
    await useStore.getState().registerAgentGenTask('gt3', 'video');
    expect(api.pollVideo).not.toHaveBeenCalled();
    expect(useStore.getState().assets).toEqual([]);
  });

  test('首拉 RPC 失败 → 移除占位卡,不记去重(可重试),lastError 置位', async () => {
    api.pollVideo.mockRejectedValue(new PgcError('GEN_FAILED', 'boom', 500));
    await useStore.getState().registerAgentGenTask('gt4', 'video');
    const st = useStore.getState();
    expect(st.assets).toEqual([]);                                   // 占位卡已移除
    expect(st.agentTasksByProject['7'] ?? []).not.toContain('gt4');  // 未记去重
    expect(st.lastError?.code).toBe('GEN_FAILED');
  });

  test('首拉任务级失败(status=failed)→ 删占位卡 + Toast(透传 failure) + 记去重', async () => {
    api.pollModel3d.mockResolvedValue({ task_id: 'gt5', status: 'failed', item: null, failure: { code: 'PROVIDER_X', category: 'x', message: '违规', retryable: false } });
    await useStore.getState().registerAgentGenTask('gt5', 'model3d');
    const st = useStore.getState();
    expect(st.assets).toEqual([]);
    expect(st.lastError).toEqual(expect.objectContaining({ code: 'PROVIDER_X', message: '违规' }));
    expect(st.agentTasksByProject['7']).toContain('gt5');
  });

  test('首拉暂无 item → 保留占位卡 + 登记 GenTask(itemId=占位卡 id) + 记去重', async () => {
    api.pollVideo.mockResolvedValue({ task_id: 'gt6', status: 'pending', item: null });
    await useStore.getState().registerAgentGenTask('gt6', 'video');
    const st = useStore.getState();
    expect(st.assets).toHaveLength(1);
    expect(st.assets[0].id.startsWith('pending_')).toBe(true);
    expect(st.assets[0].status).toBe('generating');
    expect(st.genTasks).toEqual([expect.objectContaining({ itemId: st.assets[0].id, taskId: 'gt6', kind: 'video' })]);
    expect(st.agentTasksByProject['7']).toContain('gt6');
  });

  test('upsert:loadCanvas 抢先拉到同 item_id → 不重复 add,原位更新并删占位卡', async () => {
    // 预置一张已由 loadCanvas 落上来的同 item_id 卡(自带前端坐标)
    useStore.setState({ assets: [{ id: 'itm7', key: 'itm7', label: 'itm7', kind: 'video', source: 'generated', status: 'generating', position: { x: 111, y: 222 } }] });
    api.pollVideo.mockResolvedValue({ task_id: 'gt7', status: 'running', item: item('itm7') });
    await useStore.getState().registerAgentGenTask('gt7', 'video');
    const st = useStore.getState();
    const ids = st.assets.map((a) => a.id);
    expect(ids.filter((id) => id === 'itm7')).toHaveLength(1);       // 不重复
    expect(ids.some((id) => id.startsWith('pending_'))).toBe(false); // 占位卡已删
    expect(st.assets.find((a) => a.id === 'itm7')?.position).toEqual({ x: 111, y: 222 }); // 保留前端坐标
  });

  test('pollGenTasks 适配:占位卡 GenTask 首次拿到 ready item → 替换真实卡 + 移除任务', async () => {
    useStore.setState({
      assets: [{ id: 'pending_x', key: 'pending_x', label: '', kind: 'video', source: 'generated', status: 'generating', position: { x: 5, y: 6 } }],
      genTasks: [{ itemId: 'pending_x', kind: 'video', taskId: 'gt8', startedAt: Date.now(), fails: 0 }],
    });
    api.pollVideo.mockResolvedValue({ task_id: 'gt8', status: 'succeeded', item: item('itm8', 'ready') });
    await useStore.getState().pollGenTasks();
    const st = useStore.getState();
    expect(st.assets.map((a) => a.id)).toEqual(['itm8']);
    expect(st.assets[0].position).toEqual({ x: 5, y: 6 });          // 保留占位卡坐标
    expect(st.genTasks).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t registerAgentGenTask`
Expected: FAIL（`registerAgentGenTask is not a function`）

- [ ] **Step 3: 实现 `adoptAgentItem` 助手**

`src/store/actions.ts` 在 `settleGenPlaceholder`（约 247 行）之后新增闭包：

```ts
  // 占位卡 → 真实 item_id 卡(upsert):loadCanvas 可能已抢先把同 item_id 拉上来,
  // 故按 item_id 判存:已存在则原位更新(保留前端坐标)+ 删占位卡;否则把占位卡替换为真实卡(沿用其坐标)并回写 reference。
  const adoptAgentItem = (pid: number, placeholderId: string, asset: Asset) => {
    const anchor = get().assets.find((a) => a.id === placeholderId)?.position;
    const rest = get().assets.filter((a) => a.id !== placeholderId);
    const idx = rest.findIndex((a) => a.id === asset.id);
    if (idx >= 0) {
      // loadCanvas 抢先:原位更新,保留其坐标(位置归前端所有),不重复 add
      const next = rest.slice();
      next[idx] = { ...next[idx], ...asset, position: next[idx].position };
      set({ assets: next });
    } else {
      const position = anchor ?? getViewportCenter() ?? { x: 0, y: 0 };
      const placed: Asset = { ...asset, position };
      set({ assets: [...rest, placed] });
      void pgcApi.updateCanvasReference(pid, placed.id, assetReference(placed)).catch(() => {});   // fire-and-forget 回写坐标
    }
  };
```

- [ ] **Step 4: 实现 `registerAgentGenTask` action**

`src/store/actions.ts` 在 `pollGenTasks` 定义之前新增（紧接 `importGeneratedAsset` 附近的画布区）：

```ts
  // agent 在对话里提交 video/3d 生成任务(media.task_submitted)→ 画布即时落 generating 加载卡,
  // 复用 PGC 轮询端点拿真实 item_id 原位替换 + 登记 GenTask,后续由 pollGenTasks 推进到 ready/失败。
  // 触发去重靠 agentTasksByProject(持久);卡片用真实 item_id 作身份 → run.finished 后 loadCanvas 整表替换按同 id 天然合并不重复。
  const registerAgentGenTask = async (taskId: string, kind: 'video' | 'model3d') => guard(set, async () => {
    const pid = get().currentProjectId; if (pid == null) return;
    const key = String(pid);
    if ((get().agentTasksByProject[key] ?? []).includes(taskId)) return;   // 已处理(重渲/重连重放/历史重建)
    if (get().genTasks.some((t) => t.taskId === taskId)) return;           // 同会话内已在途

    const assetKind: AssetKind = kind === 'model3d' ? '3d' : 'video';
    const placeholderId = addGenPlaceholder(assetKind);   // 视口中心 + 避让落位;无 source_item_id 不连线

    let task;
    try {
      task = kind === 'video' ? await pgcApi.pollVideo(pid, taskId) : await pgcApi.pollModel3d(pid, taskId);
    } catch (e) {
      // 首拉 RPC 失败(网络/PgcError):移除占位卡,不记去重(允许后续重渲重试);PgcError 由外层 guard 转 Toast
      if (get().currentProjectId === pid) removeGenPlaceholder(placeholderId);
      throw e;
    }
    if (get().currentProjectId !== pid) return;   // await 期间切项目:画布已清空,占位卡随之消失

    // 首拉 RPC 成功 → 记去重(无论后续 item 有无 / 任务失败)
    set({ agentTasksByProject: { ...get().agentTasksByProject, [key]: [...(get().agentTasksByProject[key] ?? []), taskId] } });

    const it = task.item ?? null;
    const asset = it ? canvasItemToAsset(it) : null;
    // 任务级失败(item 常缺失或标 error):删占位卡 + Toast(透传 failure),已知真实 item 则清服务端残留
    if (FAILED_TASK_STATUSES.has(task.status) || asset?.status === 'error') {
      removeGenPlaceholder(placeholderId);
      set({ lastError: task.failure?.message
        ? { code: task.failure.code || 'GEN_FAILED', message: task.failure.message }
        : { code: 'GEN_FAILED', message: 'Generation failed, please try again' } });
      if (it?.item_id) void pgcApi.deleteCanvasItem(pid, it.item_id).catch(() => {});
      return;
    }
    if (!asset) {
      // 提交瞬间上游未就绪:保留占位卡,登记 GenTask(itemId=占位卡 id),由 pollGenTasks 首次拿到 item 时适配真实 id
      commitGenTasks([...get().genTasks, { itemId: placeholderId, kind, taskId, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
      return;
    }
    // 拿到 item:占位卡 → 真实 item_id 卡(upsert);仍 generating 才登记轮询(已 ready 则首拉即完成)
    adoptAgentItem(pid, placeholderId, asset);
    if (asset.status !== 'ready') {
      commitGenTasks([...get().genTasks, { itemId: asset.id, kind, taskId, startedAt: Date.now(), fails: 0 } satisfies GenTask]);
    }
  });
```

- [ ] **Step 5: `pollGenTasks` 加占位卡适配分支**

`src/store/actions.ts` 的 `pollGenTasks`，在 `const asset = canvasItemToAsset(task.item);` 与 `if (asset.status === 'error')` 之间插入适配分支（用户点击流 `t.itemId` 恒为真实 id，`startsWith('pending_')` 永 false，分支不触发，既有行为不变）：

```ts
        const asset = canvasItemToAsset(task.item);
        if (asset.status === 'error') {
          failGenTask(t.itemId, t.taskId, true, task.failure);
          continue;
        }
        // agent 任务首拉暂无 item 时 GenTask.itemId 暂记占位卡 id;首次拿到 item 时适配为真实卡 + 更新 GenTask.itemId
        if (t.itemId.startsWith('pending_')) {
          adoptAgentItem(pid, t.itemId, asset);
          commitGenTasks(asset.status === 'ready'
            ? get().genTasks.filter((g) => g.taskId !== t.taskId)
            : get().genTasks.map((g) => (g.taskId === t.taskId ? { ...g, itemId: asset.id } : g)));
          continue;
        }
        // 位置归前端所有:创建时已落位,轮询结果不得覆盖
        set({ assets: get().assets.map((a) => (a.id === t.itemId
          ? { ...a, ...asset, ... } : a)) });   // ← 既有原位更新逻辑保持不变
```

> 仅新增 `if (t.itemId.startsWith('pending_')) { ... continue; }` 这一块；其下原有 `set({ assets: ... })` 与 ready/超时分支原样保留。

- [ ] **Step 6: 导出 action**

`src/store/actions.ts` 末尾 `return { ... }`（约 470 行）追加 `registerAgentGenTask`：

```ts
  return {
    loadProjects, selectProject, createProject, renameProject, deleteProject,
    loadCanvas, loadVersions, generateImage, generateAudio, generateVideo, generateModel3d,
    uploadAsset, deleteCanvasItem, persistAssetPosition, pollGenTasks, restoreGenTasks,
    publishVersion, pollVersions, previewVersionById, downloadActiveVersion,
    importGeneratedAsset, applyStudioRemix, registerAgentGenTask,
  };
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t registerAgentGenTask`
然后全量：`pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有用例）

- [ ] **Step 8: 提交**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: registerAgentGenTask 落 agent 生成加载卡并复用 GenTask 轮询,pollGenTasks 适配占位卡"
```

---

### Task 6: `useAgentGenTasks` hook + 挂载 Workspace

**Files:**
- Create: `src/client/useAgentGenTasks.ts`
- Create: `src/client/useAgentGenTasks.test.tsx`
- Modify: `src/components/workspace/Workspace.tsx:8,45`（import + 调用）

**Interfaces:**
- Consumes: `Part.submittedTask`（Task 2）、`registerAgentGenTask`（Task 5）、`agentTasksByProject`（Task 4）
- Produces: `useAgentGenTasks(): void`

- [ ] **Step 1: 写失败测试**

Create `src/client/useAgentGenTasks.test.tsx`（镜像 `useCanvasAutoImport.test.tsx` 范式）：

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgentGenTasks } from './useAgentGenTasks';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState, type Message } from '@/store/types';

function submitMsg(taskId: string, kind: 'video' | 'model3d'): Message {
  return { id: 'm1', role: 'assistant', status: 'ready', parts: [
    { type: 'tool', id: 't1', name: 'submit_video_generation', input: {}, status: 'ready', submittedTask: { taskId, kind } },
  ] };
}

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }));
afterEach(() => vi.restoreAllMocks());

describe('useAgentGenTasks', () => {
  test('出现 submittedTask 时调用 registerAgentGenTask(taskId, kind) 一次', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, registerAgentGenTask: spy as never, messages: [submitMsg('gt1', 'video')] });
    renderHook(() => useAgentGenTasks());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('gt1', 'video'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('已在 agentTasksByProject 中的不再派发', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, registerAgentGenTask: spy as never, agentTasksByProject: { '42': ['gt1'] }, messages: [submitMsg('gt1', 'video')] });
    renderHook(() => useAgentGenTasks());
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  test('同一 taskId 多次 render 只派发一次(本会话 attempted 去重)', async () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ currentProjectId: 42, registerAgentGenTask: spy as never, messages: [submitMsg('gt2', 'model3d')] });
    const { rerender } = renderHook(() => useAgentGenTasks());
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/client/useAgentGenTasks.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 hook**

Create `src/client/useAgentGenTasks.ts`：

```ts
'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import type { Message } from '@/store/types';
import type { SubmittedTask } from '@/koubou/protocol';

// 扫描对话里 agent 提交的 video/3d 生成任务(media.task_submitted → tool Part.submittedTask)→
// 画布落 generating 加载卡 + 登记轮询(registerAgentGenTask)。
// 去重两道:agentTasksByProject(持久,跨渲染/重连)+ attemptedRef(本会话已派发,防持久落库前重复派发)。
export function useAgentGenTasks() {
  const messages = useStore((s) => s.messages);
  const pid = useStore((s) => s.currentProjectId);
  const agentTasksByProject = useStore((s) => s.agentTasksByProject);
  const registerAgentGenTask = useStore((s) => s.registerAgentGenTask);

  const attemptedRef = useRef<Set<string>>(new Set());
  const lastPidRef = useRef<number | null>(null);

  useEffect(() => {
    if (pid == null) return;
    // 仅在项目"真正切换"时重置 attempted(用 ref 判定,区别于 StrictMode/热刷新的重复挂载——那种 pid 未变)
    if (pid !== lastPidRef.current) {
      lastPidRef.current = pid;
      attemptedRef.current = new Set();
    }
    const handled = new Set(agentTasksByProject[String(pid)] ?? []);
    for (const task of collectSubmittedTasks(messages)) {
      if (handled.has(task.taskId) || attemptedRef.current.has(task.taskId)) continue;
      attemptedRef.current.add(task.taskId);   // 立即标记,后续 render 不重复派发
      void registerAgentGenTask(task.taskId, task.kind);
    }
  }, [messages, pid, agentTasksByProject, registerAgentGenTask]);
}

function collectSubmittedTasks(messages: Message[]): SubmittedTask[] {
  const out: SubmittedTask[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool' && p.submittedTask) out.push(p.submittedTask);
    }
  }
  return out;
}
```

- [ ] **Step 4: 挂载到 Workspace**

`src/components/workspace/Workspace.tsx` import 区（约第 8 行 `useCanvasAutoImport` 之后）追加：

```ts
import { useAgentGenTasks } from '@/client/useAgentGenTasks';
```

在 `useCanvasAutoImport();`（约第 45 行）之后追加调用：

```ts
  useCanvasAutoImport();
  useAgentGenTasks();
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/client/useAgentGenTasks.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/client/useAgentGenTasks.ts src/client/useAgentGenTasks.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: useAgentGenTasks 扫描对话 submittedTask 触发画布加载卡并挂载 Workspace"
```

---

### Task 7: 全量收口验证

**Files:** 无（仅验证）

- [ ] **Step 1: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。重点：`Part.submittedTask`、`registerAgentGenTask` 签名、`agentTasksByProject` 字段贯通。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 error。重点：`deleteProject` 解构剔除的 `_removedAgent` 未用须 `_` 前缀（沿用既有 `_removed` 写法），注释中文且解释「为什么」。

- [ ] **Step 3: 全量测试**

Run: `pnpm test`
Expected: 全过（基线 682 + 新增用例）。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: 构建成功（Tailwind 扫描 md 文档不报错——本计划 markdown 未含非法 arbitrary class）。

- [ ] **Step 5: 提交（若上述步骤有任何收尾改动）**

```bash
git add -A
git commit -m "chore: agent 生成画布加载卡功能收口(类型/lint/测试/构建通过)"
```

---

## 验收标准

- agent 在对话里提交 video/3d 生成 → 画布**立即**出现 generating 加载卡（视口中心、不连线）。
- 生成完成后加载卡**原位**变为就绪资产卡（视频可播 / 3d 可看），**无重复卡**（与 `run.finished` 后 `loadCanvas` 共存）。
- 生成失败 → 加载卡消失 + Toast（透传上游 failure 文案）。
- 刷新 / 重连：在途任务由既有 `restoreGenTasks` 重连轮询；已处理任务不重复落卡（`agentTasksByProject`）。
- image/audio 仍走 `useCanvasAutoImport`（行为不变）。

## Self-Review 记录

- **Spec 覆盖**：协议解析(T1) / Part 挂载(T2) / 路径分流(T3) / 去重状态(T4) / 落卡+轮询+upsert+占位卡适配(T5) / hook 触发(T6) / 收口(T7) —— spec 各节均有对应任务。
- **占位符**：无 TBD/TODO；每个 code step 给出完整代码。
- **类型一致性**：`SubmittedTask{taskId,kind:'video'|'model3d'}`、`registerAgentGenTask(taskId,kind)`、`agentTasksByProject: Record<string,string[]>`、`adoptAgentItem(pid,placeholderId,asset)` 在 T1/T2/T4/T5/T6 间签名一致。
- **跨任务影响**：T3 收窄 `collectReadyMedia` 会使 `useCanvasAutoImport.test.tsx` 既有 image+video 用例失效 → 已在 T3 Step 4 一并修正。
