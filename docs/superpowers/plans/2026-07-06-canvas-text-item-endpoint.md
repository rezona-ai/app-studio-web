# 文本卡落库切换专用 text 接口 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文本卡新建/编辑/文件上传全部切换到后端专用 text 接口（POST `/canvas/items/text` + PATCH `content`），删除 `.md` 文件封装、`seedText`、编辑替换 hack 与 `loadTextContent` 回读。

**Architecture:** 协议层加类型与两个 client 方法 → 映射层把内联 `content` 写进 `preview.text` → actions 重写 `saveTextAsset` 两分支并在 `doUploadAsset` 对 text mime 分流 → 删除 `loadTextContent` 及组件加载/失败态。前提：线上无存量 file 形态文本卡，不留兼容分支。

**Tech Stack:** Next.js 16 / React 19 / zustand / Vitest（jsdom + globals，测试与源码同目录）

## Global Constraints

- 依据 spec：`docs/superpowers/specs/2026-07-06-canvas-text-item-endpoint-design.md`
- 后端契约字段一律 snake_case，`canvas_x/canvas_y` 传前 `Math.round` 取整（后端 int）
- 位置归前端所有：编辑响应合并时保留前端 `position`
- 状态变更不可变更新；action 内每个 `await` 后校验 `get().currentProjectId !== pid` 则丢弃
- 注释/commit message 用中文；`eslint-disable` 必带 `-- 理由`
- 每个 Task 结束跑 `pnpm exec vitest run <该文件>`，全部完成后统一 `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
- 执行前先经 superpowers:using-git-worktrees 建 `feat/canvas-text-item-endpoint` worktree；worktree 内 IDE 诊断误报只信 tsc/test 退出码；Edit/Write 用 worktree 绝对路径

---

### Task 1: 协议层 —— 类型与 client 方法

**Files:**
- Modify: `src/lib/pgc/types.ts:26-37`（CanvasItemData）、`src/lib/pgc/types.ts:167`（CanvasUpdateRequest）
- Modify: `src/lib/pgc/client.ts`（pgcApi 对象内 canvas 段）
- Test: `src/lib/pgc/client.test.ts`

**Interfaces:**
- Produces: `CanvasItemData.content?: string | null`、`CanvasItemData.text_format?: string | null`；`CanvasTextCreateRequest`；`pgcApi.createTextItem(pid: number, body: CanvasTextCreateRequest): Promise<CanvasItemData>`；`pgcApi.updateTextContent(pid: number, itemId: string, content: string): Promise<CanvasItemData>`

- [ ] **Step 1: 写失败测试**（`client.test.ts`，仿既有 pgcApi 用例的 fetch mock 风格，断言方法/路径/body）

```ts
describe('文本卡接口', () => {
  test('createTextItem POST /canvas/items/text 带 content/name/坐标', async () => {
    mockFetchOk({ id: 1, item_id: 't1', type: 'text', status: 'ready', content: 'hi', text_format: 'markdown' });
    const item = await pgcApi.createTextItem(3, { content: 'hi', name: 'Text', canvas_x: 10, canvas_y: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/projects/3/canvas/items/text');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ content: 'hi', name: 'Text', canvas_x: 10, canvas_y: 20 });
    expect(item.content).toBe('hi');
  });
  test('updateTextContent PATCH item 只带 content', async () => {
    mockFetchOk({ id: 1, item_id: 't1', type: 'text', status: 'ready', content: '新' });
    await pgcApi.updateTextContent(3, 't1', '新');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/projects/3/canvas/items/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ content: '新' });
  });
});
```

（`mockFetchOk`/`fetchMock` 为该测试文件既有 helper，若命名不同以文件内实际 helper 为准复用。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: FAIL（`createTextItem is not a function`）

- [ ] **Step 3: 实现**

`types.ts`：

```ts
export interface CanvasItemData {
  id: number;
  item_id: string;
  type: string;            // image | video | audio | model3d | text
  name?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  status: string;          // ready | generating | failed
  reference?: unknown | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
  content?: string | null;       // 文本节点:正文内联落 DB,url 恒空
  text_format?: string | null;   // markdown | plain
}
```

```ts
export interface CanvasUpdateRequest { reference?: unknown | null; canvas_x?: number | null; canvas_y?: number | null; name?: string | null; content?: string | null; text_format?: string | null; }
// 文本画布节点创建:content 原样落 DB(verbatim),同步返回 ready 项;超业务上限 422 CANVAS_TEXT_TOO_LONG
export interface CanvasTextCreateRequest { content: string; text_format?: 'markdown' | 'plain'; name?: string | null; reference?: unknown | null; canvas_x?: number | null; canvas_y?: number | null; }
```

`client.ts`（pgcApi canvas 段，紧邻 `importCanvasItem`；补 `CanvasTextCreateRequest` import）：

```ts
  createTextItem: (pid: number, body: CanvasTextCreateRequest) =>
    pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/text`, body),
  updateTextContent: (pid: number, itemId: string, content: string) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { content } satisfies CanvasUpdateRequest),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: PGC 协议层增加文本卡创建与正文 PATCH 方法"
```

---

### Task 2: 映射层 —— content 内联进 preview.text

**Files:**
- Modify: `src/lib/pgc/map.ts:28-45`（canvasItemToAsset）
- Test: `src/lib/pgc/map.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CanvasItemData.content`
- Produces: `canvasItemToAsset` 对 `content` 非空的 item 返回 `preview: { text: content }`（url 为空时无 src）

- [ ] **Step 1: 写失败测试**

```ts
test('文本 item 的 content 内联写入 preview.text', () => {
  const a = canvasItemToAsset({ id: 1, item_id: 't1', type: 'text', status: 'ready', content: '# hi', text_format: 'markdown' });
  expect(a.kind).toBe('text');
  expect(a.preview).toEqual({ text: '# hi' });
});
test('content 为 null 时 preview 不带 text(维持原行为)', () => {
  const a = canvasItemToAsset({ id: 1, item_id: 'i1', type: 'image', status: 'ready', url: 'https://x/y.png', content: null });
  expect(a.preview?.text).toBeUndefined();
  expect(a.preview?.src).toBeTruthy();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: FAIL（preview 为 undefined）

- [ ] **Step 3: 实现** —— `canvasItemToAsset` 的 preview 组装改为：

```ts
  const src = resolveAssetUrl(it.url);
  const preview = it.content != null
    ? { ...(src ? { src } : {}), text: it.content }
    : src ? { src } : undefined;
```

return 中 `preview: src ? { src } : undefined` 改为 `preview`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "feat: 画布映射把文本 item 内联 content 写入 preview.text"
```

---

### Task 3: 动作层 —— saveTextAsset 重写 + doUploadAsset text 分流 + 删 loadTextContent

**Files:**
- Modify: `src/store/actions.ts`（`doUploadAsset` 429-455、`loadTextContent` 764-776、`resolveTextRef` 782-790、`mdFile`/`saveTextAsset` 792-822、导出表 830）
- Modify: `src/store/index.ts:81` 附近（AppStore 接口去掉 `loadTextContent` 声明）
- Test: `src/store/actions.test.ts:1591-1700` 附近

**Interfaces:**
- Consumes: `pgcApi.createTextItem` / `pgcApi.updateTextContent`（Task 1）、`canvasItemToAsset`（Task 2）
- Produces: `saveTextAsset(assetId: string | null, content: string, spawnAt?: XY): Promise<void>` 签名不变；`loadTextContent` 从 store 移除；`doUploadAsset` 对 `text/markdown`/`text/plain` 文件转走 text 接口

- [ ] **Step 1: 改写测试**（替换 `loadTextContent` describe 块与 `saveTextAsset` describe 块；mock 表加 `createTextItem: vi.fn()`、`updateTextContent: vi.fn()`）

```ts
describe('saveTextAsset(专用 text 接口)', () => {
  test('新建:POST createTextItem 带取整坐标,占位卡原位替换为 content 内联资产', async () => {
    setupProject();   // 该文件既有的建项目 helper,以实际命名为准
    (pgcApi.createTextItem as Mock).mockResolvedValue({ id: 1, item_id: 't1', type: 'text', status: 'ready', content: '新文本' });
    await useStore.getState().saveTextAsset(null, '新文本', { x: 10.6, y: 20.2 });
    const [pid, body] = (pgcApi.createTextItem as Mock).mock.calls[0];
    expect(body).toMatchObject({ content: '新文本', name: 'Text', canvas_x: 11, canvas_y: 20 });
    const a = useStore.getState().assets.find((x) => x.id === 't1')!;
    expect(a.preview?.text).toBe('新文本');
    expect(useStore.getState().assets.some((x) => x.id.startsWith('pending_'))).toBe(false);
  });
  test('新建失败:占位卡移除,reject 透给 Modal,写 lastError', async () => {
    setupProject();
    (pgcApi.createTextItem as Mock).mockRejectedValue(new PgcError('CANVAS_TEXT_TOO_LONG', 'too long', 422));
    await expect(useStore.getState().saveTextAsset(null, 'x')).rejects.toThrow();
    expect(useStore.getState().assets.some((x) => x.id.startsWith('pending_'))).toBe(false);
    expect(useStore.getState().lastError?.code).toBe('CANVAS_TEXT_TOO_LONG');
  });
  test('编辑:单次 PATCH content,原 id 原位更新且保留前端 position/label/parentId', async () => {
    setupProjectWithTextAsset('old-1', { position: { x: 5, y: 6 }, label: '设定', parentId: 'p1' });
    (pgcApi.updateTextContent as Mock).mockResolvedValue({ id: 1, item_id: 'old-1', type: 'text', status: 'ready', content: '新内容' });
    await useStore.getState().saveTextAsset('old-1', '新内容');
    const a = useStore.getState().assets.find((x) => x.id === 'old-1')!;
    expect(a.preview?.text).toBe('新内容');
    expect(a.position).toEqual({ x: 5, y: 6 });
    expect(a.label).toBe('设定');
    expect(a.parentId).toBe('p1');
    expect(pgcApi.deleteCanvasItem).not.toHaveBeenCalled();   // 替换 hack 已删
  });
  test('编辑失败:资产原样保留,reject 透给 Modal', async () => {
    setupProjectWithTextAsset('old-2', {});
    (pgcApi.updateTextContent as Mock).mockRejectedValue(new PgcError('NETWORK', 'x', 0));
    await expect(useStore.getState().saveTextAsset('old-2', '新内容')).rejects.toThrow();
    expect(useStore.getState().assets.find((x) => x.id === 'old-2')).toBeTruthy();
  });
});

describe('uploadAsset 文本文件分流', () => {
  test('text/markdown 文件读内容走 createTextItem,不走 uploadCanvasItem', async () => {
    setupProject();
    (pgcApi.createTextItem as Mock).mockResolvedValue({ id: 1, item_id: 't2', type: 'text', status: 'ready', content: '# md' });
    await useStore.getState().uploadAsset(new File(['# md'], 'note.md', { type: 'text/markdown' }));
    expect(uploadMock).not.toHaveBeenCalled();
    const [, body] = (pgcApi.createTextItem as Mock).mock.calls[0];
    expect(body).toMatchObject({ content: '# md', name: 'note' });
  });
});
```

（`setupProject`/`setupProjectWithTextAsset` 指该测试文件既有的项目/资产铺设方式，复用现有写法；同时删除原 `loadTextContent` describe 块与旧 `saveTextAsset` 用例。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: FAIL（`createTextItem` 未被调用 / mock 不存在）

- [ ] **Step 3: 实现** —— `actions.ts`：

删除 `loadTextContent`（764-776）、`mdFile`（793）。新增（放原 `mdFile` 位置）：

```ts
  // 文本卡新建:占位卡 → POST 专用 text 接口(content 原样落 DB,url 恒空,同步 ready) → 原位替换。
  // 失败移除占位卡并 rethrow(调用方 guardRethrow 落 lastError→Toast,Modal 据 reject 保留弹窗)
  const createTextAsset = async (content: string, opts?: GenPlacement, name = 'Text') => {
    const pid = get().currentProjectId; if (pid == null) return;
    const [phId] = addGenPlaceholders('text', 1, opts);
    try {
      const pos = get().assets.find((a) => a.id === phId)?.position ?? { x: 0, y: 0 };
      const item = await pgcApi.createTextItem(pid, {
        content, name,
        canvas_x: Math.round(pos.x), canvas_y: Math.round(pos.y),   // 后端 int,取整
      });
      if (get().currentProjectId !== pid) return;
      adoptAgentItem(pid, phId, { ...canvasItemToAsset(item), source: 'uploaded' });
    } catch (e) {
      if (get().currentProjectId === pid) removeGenPlaceholders([phId]);
      throw e;
    }
  };
```

`saveTextAsset` 重写：

```ts
  // 文本卡保存:新建走 createTextAsset;编辑单次 PATCH content 原地改(位置/展示名/连线全不动)
  const saveTextAsset = async (assetId: string | null, content: string, spawnAt?: XY) => {
    const pid = get().currentProjectId; if (pid == null) return;
    if (assetId == null) {
      await guardRethrow(set, () => createTextAsset(content, { spawnAt }));
      return;
    }
    await guardRethrow(set, async () => {
      await pgcApi.updateTextContent(pid, assetId, content);
      if (get().currentProjectId !== pid) return;   // await 后切项目:丢弃
      set({ assets: get().assets.map((a) => (a.id === assetId ? { ...a, preview: { ...a.preview, text: content } } : a)) });
    });
  };
```

`doUploadAsset` 顶部分流（`const pid = ...` 之后）：

```ts
    // 文本文件不走 multipart:读内容转专用 text 接口,与手写文本卡同构(content 内联,可 PATCH 编辑)
    if (file.type === 'text/markdown' || file.type === 'text/plain') {
      const content = await file.text();
      await createTextAsset(content, opts, file.name.replace(/\.[^.]+$/, ''));
      return;
    }
```

`doUploadAsset` 的 `opts` 参数类型去掉 `& { seedText?: string }`，`adoptAgentItem` 调用处删掉 seedText 三元（`preview: uploaded.preview`），并删该处 seedText 注释。`resolveTextRef` 中 `if (src.preview?.text == null) await loadTextContent(srcId).catch(() => {});` 一行删除（content 恒内联，`preview.text` 直接同步读，拿不到就不注入的语义由后一行 `?? ''` 保持）——`resolveTextRef` 因此不再 async 也可，但为不扩散调用点改动，保留 async 签名。导出表删 `loadTextContent`。`src/store/index.ts` 的 AppStore 接口删 `loadTextContent: (assetId: string) => Promise<void>;` 声明。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有全部用例）

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 仅剩组件层 `loadTextContent` 引用报错（Task 4 处理）；若报错在此范围外须先修复

- [ ] **Step 6: Commit**

```bash
git add src/store/actions.ts src/store/index.ts src/store/actions.test.ts
git commit -m "feat: 文本卡新建/编辑/文件上传切换专用 text 接口,删除回读与替换 hack"
```

---

### Task 4: 组件层 —— 移除加载/失败态 + 清 dead i18n key

**Files:**
- Modify: `src/components/canvas/nodes/TextNode.tsx`
- Modify: `src/components/canvas/TextEditorModal.tsx`
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（删 `canvas.textLoadError`，六语）
- Test: `src/components/canvas/nodes/TextNode.test.tsx`（如存在；不存在则不新建，靠既有组件测试兜底）

**Interfaces:**
- Consumes: `preview.text` 恒随资产内联到位（Task 2/3）
- Produces: 组件无 `loadTextContent` 引用；`canvas.textLoadError` key 全量删除

- [ ] **Step 1: TextNode 简化** —— 删 `loadTextContent`/`failed`/`needsLoad`/`useEffect`/失败分支与骨架分支（`preview.text` 恒有值；防御性兜底渲染空串即可），顶部注释改为「文本卡:md 渲染摘要(限高+底部渐隐),content 随资产内联到位」。保留 `openTextEditor` 双击逻辑与外层结构：

```tsx
'use client';
import { type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
import { useStore } from '@/store';
import Markdown from '@/components/chat/Markdown';
import NodeCard from './NodeCard';

// 文本卡:md 渲染摘要(限高+底部渐隐)。content 随资产内联到位,无按需加载
export default function TextNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  const openTextEditor = useStore((s) => s.openTextEditor);
  return (
    <NodeCard kind="text" title={a.label} selected={selected} assetId={a.id} width={210}>
      <div
        className="rounded-[11px] bg-[var(--color-surface-2)] px-3.5 py-3"
        onDoubleClick={(e) => { e.stopPropagation(); openTextEditor({ assetId: a.id }); }}
      >
        <div className="max-h-[120px] overflow-hidden text-[12px] leading-4 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
          <Markdown text={a.preview?.text ?? ''} />
        </div>
      </div>
    </NodeCard>
  );
}
```

- [ ] **Step 2: TextEditorModal 简化** —— 删 `loadTextContent` 订阅、`failed` state、拉取 `useEffect`（40-43 行）、`loading` 派生与失败/骨架两个渲染分支（94-106 行折叠为直接 `mode === 'preview' ? <Markdown/> : <textarea/>`）；`lastOriginal` 渲染期 guard 保留（编辑响应回写 store 后仍需同步）。其余（保存流程、退场过渡、Segmented）不动。

- [ ] **Step 3: 删 i18n key** —— 六个 locale 文件各删 `textLoadError` 一行；`grep -rn "textLoadError" src` 确认零引用。

- [ ] **Step 4: 全量验证**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: 全部 PASS，零 `loadTextContent`/`textLoadError`/`seedText` 残留（`grep -rn "loadTextContent\|seedText\|textLoadError" src` 为空）

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/nodes/TextNode.tsx src/components/canvas/TextEditorModal.tsx src/i18n/locales
git commit -m "refactor: 文本卡组件移除按需加载与失败态,清理 dead i18n key"
```

---

### Task 5: 收尾 —— 构建验证与回合

- [ ] **Step 1: 构建**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 2: 回合** —— 走 superpowers:finishing-a-development-branch；合并用 `--no-ff`（message 含分支名），合并后删分支与 worktree。
