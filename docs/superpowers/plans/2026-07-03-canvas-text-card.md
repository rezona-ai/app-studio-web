# Text 类型画布卡片 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布新增 text 类型卡片（Markdown 摘要渲染 + 弹窗查看/编辑），彻底取代半成品 doc 类型。

**Architecture:** `AssetKind` 中 `doc` 全量重命名为 `text`；文本内容存桶为 `.md` 文件经 `preview.src` fetch 取回，缓存到 `preview.text`（瞬态不持久化）；创建/编辑均经现有 upload 端点（编辑=传新文件原位替换+删旧 item，等后端支持 PATCH 换源后再切换）。卡片摘要与弹窗全文都复用 `src/components/chat/Markdown.tsx`。

**Tech Stack:** Next.js 16 / React 19 / zustand / @xyflow/react / react-markdown（已有依赖）/ vitest + jsdom。

## Global Constraints

- 所有注释 / commit message 用中文；commit 一句话总结。
- 颜色/圆角/阴影/动效只用 `globals.css` 既有令牌与 `.anim-*`/`.modal-pop` 类，禁止硬编码色值与一次性 keyframes；强调色用 `--color-teal`。
- 图标一律 `FigIcon`；按钮用 `Button`/`IconButton`；错误提示走 `setError` → 全局 Toast。
- 文案经 react-i18next，新键必须补齐六语（en/zh/fr/ru/ja/vi），en 为单一真相源。
- store action 内每个 `await` 后校验 `get().currentProjectId !== pid` 则丢弃。
- 不覆盖前端拥有的 `position`；不持久化瞬态（`preview.text` 不落盘——`assets` 本就不在 persist 白名单，天然满足）。
- 自身绝对路径必经 `apiPath()`/`assetPath()`。
- 验证只信 `pnpm exec tsc --noEmit` 与 `pnpm test` 退出码（worktree 里 IDE 诊断是已知误报）。
- 执行前先经 superpowers:using-git-worktrees 建 `feat/canvas-text-card` worktree；worktree 内编辑必须用 worktree 内路径，改完 `git -C` 校验落点。

## 后端契约前提（已与 Nick 对齐，推动后端中）

- import `type` 枚举将新增 `'text'`；upload 将放行 `text/markdown`/`text/plain`。前端按此先行，联调前后端未上线时上传文本会被后端拒——预期内，测试全部 mock PGC client。

---

### Task 1: 类型体系 doc → text（含 TextNode 基础卡与 i18n）

**Files:**
- Modify: `src/lib/asset-kind.ts`
- Modify: `src/app/globals.css:68`
- Modify: `src/lib/assets.ts:6-12,36-42`
- Modify: `src/lib/pgc/map.ts:7`
- Modify: `src/lib/pgc/types.ts`（`CanvasWriteFromUrlRequest.type` 联合，约 170 行）
- Modify: `src/lib/media-import.ts:12-39`
- Modify: `src/components/canvas/gen-params.ts:46-52`
- Modify: `src/components/canvas/nodeTypes.ts`
- Create: `src/components/canvas/nodes/TextNode.tsx`
- Delete: `src/components/canvas/nodes/DocNode.tsx`
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`canvas.assetKind.doc` → `text`）
- Test: 受影响的既有 `*.test.ts(x)`（grep 修正）

**Interfaces:**
- Produces: `AssetKind = 'image' | 'video' | 'audio' | '3d' | 'text'`；`LEGEND_KINDS` 含 text（text 进过滤图例）；`kindToImportType('text') === 'text'`；`TYPE_TO_KIND.text === 'text'`；CSS 变量 `--color-text`；nodeTypes 键 `text`。

- [ ] **Step 1: 写失败测试**（追加到既有同目录测试文件；无则新建 `src/lib/asset-kind.test.ts`）

```ts
// src/lib/asset-kind.test.ts
import { describe, it, expect } from 'vitest';
import { KIND_ORDER, LEGEND_KINDS, KIND_META } from './asset-kind';

describe('text 取代 doc', () => {
  it('KIND_ORDER 含 text 不含 doc', () => {
    expect(KIND_ORDER).toContain('text');
    expect(KIND_ORDER).not.toContain('doc' as never);
  });
  it('text 进过滤图例', () => { expect(LEGEND_KINDS).toContain('text'); });
  it('text 类型色为 --color-text', () => { expect(KIND_META.text.colorVar).toBe('var(--color-text)'); });
});
```

```ts
// src/lib/pgc/map.test.ts 追加
it('type=text 映射为 kind text', () => {
  const a = canvasItemToAsset({ id: 1, item_id: 'i1', type: 'text', status: 'ready', name: 'n', url: '/preview/1/canvas/n.md' } as CanvasItemData);
  expect(a.kind).toBe('text');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/asset-kind.test.ts src/lib/pgc/map.test.ts`
Expected: FAIL（text 不存在 / 映射回退 image）

- [ ] **Step 3: 实现类型层替换**

`src/lib/asset-kind.ts` 全文改为：

```ts
// 资产类型(原 agent-protocol/messages,迁来此处作为唯一来源)
export type AssetKind = 'image' | 'video' | 'audio' | '3d' | 'text';

import { figAsset } from '@/components/ui/figma';

// 资产类型的 UI 元数据:类型色变量 / 图标(徽章/图例文案已迁至 i18n canvas.assetKind.*)
export const KIND_META: Record<AssetKind, { colorVar: string; icon: string }> = {
  image: { colorVar: 'var(--color-image)', icon: figAsset.image },
  video: { colorVar: 'var(--color-video)', icon: figAsset.video },
  audio: { colorVar: 'var(--color-audio)', icon: figAsset.audio },
  '3d': { colorVar: 'var(--color-3d)', icon: figAsset.threeD },
  text: { colorVar: 'var(--color-text)', icon: figAsset.text },
};

export const KIND_ORDER: AssetKind[] = ['image', 'video', 'audio', '3d', 'text'];
export const TIDY_ROW_KIND_ORDER: AssetKind[] = ['video', 'image', 'audio', '3d', 'text'];
export const KIND_LABEL: Record<AssetKind, string> = { image: '图像', video: '视频', audio: '音频', '3d': '3D', text: '文本' };

// text 是一等类型,与其余类型一样进过滤图例(移除原 doc 恒可见特例)
export const LEGEND_KINDS: AssetKind[] = [...KIND_ORDER];

export const isKindFilterActive = (visibleKinds: AssetKind[]): boolean =>
  LEGEND_KINDS.some((k) => !visibleKinds.includes(k));
```

其余修改（逐处）：

- `globals.css:68`：`--color-doc: #f2c64b;` → `--color-text: #f2c64b;`（确认 `[data-theme="dark"]` 块无 doc 覆盖，无则不动）。
- `src/lib/assets.ts`：`KIND_DEFAULT_LABEL` 的 `doc: 'Text'` → `text: 'Text'`；`kindFromMime` 末行 `return 'doc';` → `return 'text';`（注释改为「文本及未知归 text;真正的类型拦截由 upload-policy accept 白名单负责」）。
- `src/lib/pgc/map.ts:7`：`TYPE_TO_KIND` 追加 `text: 'text'`。
- `src/lib/pgc/types.ts`：`CanvasWriteFromUrlRequest` 的 `type?: 'image'|'video'|'audio'|'model3d'|null` 追加 `'text'`。
- `src/lib/media-import.ts`：`mediaKindToAssetKind` 加 `case 'text': case 'doc': return 'text';`；`kindToImportType` 返回类型联合加 `'text'`，加 `case 'text': return 'text';`，删除 `default` 分支的 `// doc 等` 注释（改 `default: return undefined;`）。
- `src/components/canvas/gen-params.ts` `DERIVE_MATRIX`：`doc: []` → `text: []`（Task 8 再放开）。
- `src/components/canvas/nodeTypes.ts`：`import TextNode from './nodes/TextNode';`，映射键 `doc: withNodeBoundary(DocNode)` → `text: withNodeBoundary(TextNode)`，删 DocNode import。
- 删除 `src/components/canvas/nodes/DocNode.tsx`。

- [ ] **Step 4: 创建 TextNode 基础卡**（本任务先渲染 `preview.text` 纯文本摘要，md 渲染与取数在 Task 2/3）

```tsx
// src/components/canvas/nodes/TextNode.tsx
'use client';
import { type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
import NodeCard from './NodeCard';

// 文本卡:标题 + 内容摘要(限高溢出渐隐)。内容来自 preview.text(Task 3 接入按需 fetch)
export default function TextNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const a = data.asset;
  return (
    <NodeCard kind="text" title={a.label} selected={selected} assetId={a.id} width={210}>
      <div className="rounded-[11px] bg-[var(--color-surface-2)] px-3.5 py-3.5">
        <div className="max-h-[120px] overflow-hidden whitespace-pre-wrap text-[12px] leading-4 text-[var(--color-ink)] [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
          {a.preview?.text ?? ''}
        </div>
      </div>
    </NodeCard>
  );
}
```

注：`preview.text` 字段在 Task 2 加进类型；本任务同时把 `AssetPreviewData` 加上 `text?: string`（见 Step 5）以保 tsc 绿——Task 2 只做取数与测试。

- [ ] **Step 5: `src/store/types.ts:9` 加字段**

```ts
export interface AssetPreviewData { color?: string; title?: string; src?: string; dataUrl?: string; duration?: string; text?: string; }
```

- [ ] **Step 6: i18n 六语替换 `canvas.assetKind.doc` → `text`**

| locale | 值 |
|---|---|
| en | `text: 'Text'` |
| zh | `text: '文本'` |
| fr | `text: 'Texte'` |
| ru | `text: 'Текст'` |
| ja | `text: 'テキスト'` |
| vi | `text: 'Văn bản'` |

- [ ] **Step 7: 清理残留 doc 引用并跑全量测试**

Run: `grep -rn "'doc'" src --include='*.ts' --include='*.tsx'` → 应只剩无关命中（如单词 doc 出现在注释里的 docs 路径）；逐个修正测试文件里的 doc 断言。
Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 全绿。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: 资产类型 text 取代 doc,新增 TextNode 基础卡"
```

---

### Task 2: 文本内容按需加载 action `loadTextContent`

**Files:**
- Modify: `src/store/actions.ts`（新增 action 并导出到 `createServerActions` 返回对象与 `ServerActions` 类型声明处）
- Test: `src/store/actions.test.ts`（追加）

**Interfaces:**
- Produces: `loadTextContent(assetId: string): Promise<void>` —— fetch `preview.src` 全文写入该资产 `preview.text`；已有 text 或无 src 直接返回；HTTP 失败抛错（由调用组件本地接住展示错误态，不走 guard/Toast）。

- [ ] **Step 1: 写失败测试**（沿用 actions.test.ts 既有 store/mocks 搭法）

```ts
describe('loadTextContent', () => {
  it('fetch preview.src 并写入 preview.text', async () => {
    // 造一个 kind=text、preview.src 存在的资产入 store
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# hello', { status: 200 })));
    await store.getState().loadTextContent('t1');
    expect(store.getState().assets.find((a) => a.id === 't1')?.preview?.text).toBe('# hello');
  });
  it('已有 preview.text 不重复 fetch', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await store.getState().loadTextContent('t1');   // t1 已带 text
    expect(f).not.toHaveBeenCalled();
  });
  it('HTTP 失败抛错且不写 text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(store.getState().loadTextContent('t2')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t loadTextContent`
Expected: FAIL（action 不存在）

- [ ] **Step 3: 实现**（`createServerActions` 内）

```ts
// 文本卡内容按需加载:fetch preview.src(画布桶预览链,同源代理已带 basePath)写入 preview.text。
// 失败直接抛给调用组件展示卡内错误态+重试,不走 guard(避免每张卡加载失败都全局 Toast)
const loadTextContent = async (assetId: string) => {
  const pid = get().currentProjectId; if (pid == null) return;
  const a = get().assets.find((x) => x.id === assetId);
  const src = a?.preview?.src;
  if (!src || a?.preview?.text != null) return;
  const res = await fetch(src, { credentials: 'include' });
  if (!res.ok) throw new PgcError('TEXT_FETCH_FAILED', `HTTP ${res.status}`, res.status);
  const text = await res.text();
  if (get().currentProjectId !== pid) return;   // await 后切项目:丢弃
  set({ assets: get().assets.map((x) => (x.id === assetId ? { ...x, preview: { ...x.preview, text } } : x)) });
};
```

并在返回对象与 `ServerActions` 接口（`src/store/types.ts` 或 actions.ts 内的类型声明，跟随现状）补 `loadTextContent`。

- [ ] **Step 4: 跑测试通过后 Commit**

Run: `pnpm exec vitest run src/store/actions.test.ts && pnpm exec tsc --noEmit`

```bash
git add -A && git commit -m "feat: loadTextContent 按需拉取文本卡内容"
```

---

### Task 3: TextNode Markdown 摘要 + 三态（loading / 内容 / 失败重试）

**Files:**
- Modify: `src/components/canvas/nodes/TextNode.tsx`
- Test: `src/components/canvas/nodes/TextNode.test.tsx`（新建）

**Interfaces:**
- Consumes: `loadTextContent`（Task 2）、`chat/Markdown`。
- Produces: 挂载时若 `preview.text == null && preview.src` 则触发加载；成功渲染 md 摘要，失败显示错误占位 + 重试按钮。

- [ ] **Step 1: 写失败测试**

```tsx
// 三个用例:1) 有 preview.text 渲染 md(断言出现 <strong> 等);2) 无 text 有 src → 调 loadTextContent 且显示骨架;
// 3) loadTextContent reject → 显示 t('canvas.textLoadError') 与重试按钮,点击重试再次调用。
// mock useStore 沿用仓库既有组件测试写法;注意 StrictMode 双挂载(测试包 <StrictMode>,加载函数须幂等)。
```

- [ ] **Step 2: 跑测试确认失败**，Run: `pnpm exec vitest run src/components/canvas/nodes/TextNode.test.tsx`

- [ ] **Step 3: 实现**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type NodeProps } from '@xyflow/react';
import type { RFNodeData } from '@/store/selectors';
import { useStore } from '@/store';
import Markdown from '@/components/chat/Markdown';
import NodeCard from './NodeCard';

// 文本卡:md 渲染摘要(限高+底部渐隐)。内容按需 fetch:失败卡内错误态+重试,不打全局 Toast
export default function TextNode({ data, selected }: NodeProps & { data: RFNodeData }) {
  const { t } = useTranslation();
  const a = data.asset;
  const loadTextContent = useStore((s) => s.loadTextContent);
  const [failed, setFailed] = useState(false);
  const needsLoad = a.preview?.text == null && !!a.preview?.src;
  useEffect(() => {
    if (!needsLoad || failed) return;
    loadTextContent(a.id).catch(() => setFailed(true));
  }, [needsLoad, failed, a.id, loadTextContent]);
  return (
    <NodeCard kind="text" title={a.label} selected={selected} assetId={a.id} width={210}>
      <div className="rounded-[11px] bg-[var(--color-surface-2)] px-3.5 py-3">
        {failed ? (
          <div className="flex flex-col items-start gap-1.5 py-1">
            <span className="text-[12px] text-[var(--color-muted)]">{t('canvas.textLoadError')}</span>
            <button type="button" className="text-[12px] font-medium text-[var(--color-teal)] hover:underline" onClick={() => setFailed(false)}>
              {t('common.retry')}
            </button>
          </div>
        ) : a.preview?.text == null ? (
          // 加载骨架:复用类型色系灰条(与全局骨架语汇一致)
          <div className="space-y-2 py-1" role="status" aria-label={t('common.loading')}>
            {[100, 88, 72].map((w, i) => (
              <div key={i} className="h-1.5 animate-pulse rounded-full bg-[var(--color-line-2)]" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <div className="max-h-[120px] overflow-hidden text-[12px] leading-4 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
            <Markdown text={a.preview.text} />
          </div>
        )}
      </div>
    </NodeCard>
  );
}
```

- [ ] **Step 4: i18n 补键**（六语）：`canvas.textLoadError`（en: `Failed to load text`；zh: `文本加载失败`；fr: `Échec du chargement du texte`；ru: `Не удалось загрузить текст`；ja: `テキストの読み込みに失敗しました`；vi: `Không tải được văn bản`）；`common.retry` / `common.loading` 若已存在则复用，不存在则同样六语补齐（en: `Retry` / `Loading`）。

- [ ] **Step 5: 跑测试通过后 Commit**：`git add -A && git commit -m "feat: TextNode md 摘要渲染与加载/失败态"`

---

### Task 4: 文本弹窗（查看 md / 编辑源码）+ store 打开态

**Files:**
- Modify: `src/store/index.ts`（UIState 加 `textEditor`、actions 加 `openTextEditor/closeTextEditor`）
- Create: `src/components/canvas/TextEditorModal.tsx`
- Modify: `src/components/canvas/nodes/TextNode.tsx`（双击打开弹窗——与 MediaLightbox 打开手势一致，参照 ImageNode 对 `openLightbox` 的接线位置）
- Modify: `Workspace.tsx` 或 `AssetCanvas.tsx`（弹窗挂载点——跟随 `RenameAssetModal` 当前挂载处，保持同级）
- Test: `src/components/canvas/TextEditorModal.test.tsx`

**Interfaces:**
- Produces: store 字段 `textEditor: { assetId: string | null; spawnAt?: XY } | null`（`assetId: null` = 新建草稿，Task 5/6 使用）；`openTextEditor(p: { assetId: string | null; spawnAt?: XY })`、`closeTextEditor()`。
- Consumes: `loadTextContent`、`chat/Markdown`、`useRequestClose`、`IconButton/submitVariant`。保存回调本任务留接口 `onSave(content: string)`（Task 5 接入真实 action）。

- [ ] **Step 1: store 打开态**（对照 `renameTarget` 三处：字段声明、初值 `null`、两个 action）

```ts
textEditor: { assetId: string | null; spawnAt?: XY } | null;
openTextEditor: (p: { assetId: string | null; spawnAt?: XY }) => void;
closeTextEditor: () => void;
// 实现:
openTextEditor: (p) => set({ textEditor: p }),
closeTextEditor: () => set({ textEditor: null }),
```

- [ ] **Step 2: 写失败测试**（渲染 modal:查看态显示 md;点编辑出现 textarea;改动后点保存回调 onSave;Esc 走 requestClose）

- [ ] **Step 3: 实现 TextEditorModal**（复用 RenameAssetModal 的骨架:`modal-backdrop`/`modal-pop`/`useRequestClose(close, 200)`/Esc 监听/宽度改 `w-[640px]`,内容区 `max-h-[60vh] overflow-y-auto scrollbar-auto`）

```tsx
// 结构要点(完整骨架抄 RenameAssetModal,此处列差异):
// - 标题行:资产 label + 右侧「编辑/预览」切换(Segmented 或两个 ghost IconButton,复用既有组件)
// - 查看态:<Markdown text={content} />;编辑态:<textarea> 全高,bg-[var(--color-fill)] 圆角 12px,focus 边框 --color-teal
// - 底部:取消 + 保存(IconButton submitVariant(dirty, dark));保存中 disabled + spinner(对照 NodeCard deleting spinner)
// - 打开时 assetId 非空且 preview.text == null → 调 loadTextContent,加载骨架;新建(assetId null)直接进编辑态空 textarea
// - onSave 本任务先占位:const onSave = useStore((s) => s.saveTextAsset) —— Task 5 提供;为让本任务独立编译,
//   Task 4 先在 store 里放一个空实现 saveTextAsset: async () => {},Task 5 替换为真实现(计划内显式约定,非 dead code)
```

- [ ] **Step 4: TextNode 接双击**：`NodeCard` 内容区外层 `onDoubleClick={() => openTextEditor({ assetId: a.id })}`（nodrag 不需要——双击不与拖拽冲突，但需 `e.stopPropagation()` 防画布双击新建菜单）。

- [ ] **Step 5: i18n 六语补键**：`canvas.textEditor.edit`（Edit/编辑/Modifier/Редактировать/編集/Chỉnh sửa）、`canvas.textEditor.preview`（Preview/预览/Aperçu/Просмотр/プレビュー/Xem trước）、`canvas.textEditor.save`（Save/保存/Enregistrer/Сохранить/保存/Lưu）、`canvas.textEditor.placeholder`（en: `Write something…`; zh: `写点什么…`; fr: `Écrivez quelque chose…`; ru: `Напишите что-нибудь…`; ja: `何か書いてください…`; vi: `Viết gì đó…`）。

- [ ] **Step 6: 跑测试 + tsc 通过后 Commit**：`git add -A && git commit -m "feat: 文本卡查看/编辑弹窗"`

---

### Task 5: 保存 action：新建上传 + 编辑原位替换

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`（追加）

**Interfaces:**
- Produces: `saveTextAsset(assetId: string | null, content: string, spawnAt?: XY): Promise<void>`。
- Consumes: `uploadAsset`（新建路径直接复用）、`uploadCanvasItem`、`pgcApi.{renameCanvasItem,updateCanvasReference,deleteCanvasItem}`、`canvasItemToAsset`、`assetReference`。

- [ ] **Step 1: 写失败测试**

```ts
describe('saveTextAsset', () => {
  it('新建:content 封成 .md File 走 uploadCanvasItem,占位卡替换为 text 资产且 preview.text=content', async () => {/* mock uploadCanvasItem resolve item(type text) */});
  it('编辑:上传新文件→继承旧卡 position/parentId/label→删旧 item', async () => {
    // 断言:assets 中旧 id 消失、新 item_id 在原 position;pgcApi.deleteCanvasItem 以旧 id 调用;
    // renameCanvasItem 以旧 label 调用;updateCanvasReference 带 assetReference(新资产)
  });
  it('编辑上传失败:旧卡原样保留,错误交 guard → lastError', async () => {});
  it('await 后切项目:丢弃,不改 assets', async () => {});
});
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```ts
// content 封 .md 文件;名字用资产 label(后端存储名自取,展示名靠 name 字段)
const mdFile = (label: string, content: string) => new File([content], `${label}.md`, { type: 'text/markdown' });

// 文本卡保存:assetId=null 走新建(复用 uploadAsset 占位卡链路);否则「新文件替换旧 item」——
// 后端暂无「PATCH 换源」能力(契约已提),先以 upload 新 item + 继承旧卡前端态 + 删旧 item 实现原位替换。
const saveTextAsset = async (assetId: string | null, content: string, spawnAt?: XY) => {
  const pid = get().currentProjectId; if (pid == null) return;
  if (assetId == null) {
    await uploadAsset(mdFile('Text', content), { spawnAt });
    // 新建后把 content 直接写入刚落库资产的 preview.text,省一次回读 fetch:
    // uploadAsset 内 adoptAgentItem 已入表,按 sourceFilename 不可靠,改在 uploadAsset 加可选 opts 不划算——
    // 简化:新建卡首次渲染由 TextNode 按需 fetch 取回(内容刚写入桶,可读),不额外穿参
    return;
  }
  await guard(set, async () => {
    const old = get().assets.find((a) => a.id === assetId); if (!old) return;
    const item = await uploadCanvasItem(pid, mdFile(old.label, content));
    if (get().currentProjectId !== pid) return;   // await 后切项目:丢弃(新 item 成孤儿,由下次 loadCanvas 展示,可接受)
    const next: Asset = {
      ...canvasItemToAsset(item),
      label: old.label, source: old.source, parentId: old.parentId,
      position: old.position,                      // 位置归前端所有,不被替换冲掉
      preview: { ...(canvasItemToAsset(item).preview ?? {}), text: content },
    };
    set({ assets: get().assets.map((a) => (a.id === assetId ? next : a)) });
    // 展示名/引用回写与旧 item 清理均 fire-and-forget:失败不阻塞 UI(与 reference 回写同约定)
    void pgcApi.renameCanvasItem(pid, next.id, old.label).catch(() => {});
    void pgcApi.updateCanvasReference(pid, next.id, assetReference(next)).catch(() => {});
    void pgcApi.deleteCanvasItem(pid, assetId).catch(() => {});
  });
};
```

替换 Task 4 的空实现，导出并入 `ServerActions` 类型。

- [ ] **Step 4: 跑测试 + tsc 通过后 Commit**：`git add -A && git commit -m "feat: 文本卡保存(新建上传/编辑原位替换)"`

---

### Task 6: 手动创建入口（AddAssetMenu）+ 上传策略放行文本

**Files:**
- Modify: `src/lib/upload-policy.ts`
- Modify: `src/components/canvas/AddAssetMenu.tsx`
- Test: `src/lib/upload-policy.test.ts`、`src/components/canvas/AddAssetMenu.test.tsx`（追加）

**Interfaces:**
- Consumes: `openTextEditor({ assetId: null, spawnAt })`（Task 4）。
- Produces: canvas 上传策略接受 `text/markdown`/`text/plain`（上限 1MB）；菜单 addSource 组新增 Text 项。

- [ ] **Step 1: 写失败测试**（policy: text/markdown 文件被 accept、>1MB 被拒 size；菜单渲染出 `canvas.addMenu.text` 项，点击调 openTextEditor 且带 spawnAt、菜单关闭）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 upload-policy**

```ts
// 文本资产(text 卡):md/纯文本,1MB 足够(后端契约同步提)
const TEXT_MIMES = ['text/markdown', 'text/plain'];
const UPLOAD_LIMITS: Partial<Record<AssetKind, number>> = { image: 5 * MB, video: 20 * MB, audio: 20 * MB, text: 1 * MB };
// canvas 面额外放行文本;chat 附件维持纯媒体(koubou user.message 契约仅 text/image 块)
export const UPLOAD_POLICY: Record<UploadSurface, UploadPolicy> = {
  chat: { accept: MEDIA_MIMES, maxBytes: 20 * MB, maxBytesByKind: UPLOAD_LIMITS, maxCount: 5 },
  canvas: { accept: [...MEDIA_MIMES, ...TEXT_MIMES], maxBytes: 20 * MB, maxBytesByKind: UPLOAD_LIMITS },
};
// MIME_LABELS 补 'text/markdown': 'Markdown', 'text/plain': 'TXT'
```

注意 `limitForFile` 用 `mimeToAssetKind`（media-import.ts），其对 text/* 回退 image(5MB) 会算错限额——同步把 `mimeToAssetKind` 加 `if (top === 'text') return 'text';`（media-import.ts，Task 1 未动此函数）。

- [ ] **Step 4: 实现菜单项**（AddAssetMenu addSource 组、upload 按钮之后）

```tsx
<button className={row} onClick={() => { openTextEditor({ assetId: null, spawnAt }); onClose(); }}>
  <span className={symbol}><FigIcon src={figAsset.text} size={16} /></span>
  <span className={label}>{t('canvas.addMenu.text')}</span>
</button>
```

（`openTextEditor` 经 `useStore` 取；派生模式 `sourceId` 存在时该组本就不渲染，天然只在画布新建出现。）

- [ ] **Step 5: i18n 六语补键**：`canvas.addMenu.text`（en: `Text note`; zh: `文本便签`; fr: `Note de texte`; ru: `Текстовая заметка`; ja: `テキストメモ`; vi: `Ghi chú văn bản`）；`canvas.addMenu.uploadHint` 文案若列举了类型则同步补 md/txt（六语核对）。

- [ ] **Step 6: 跑测试 + tsc 通过后 Commit**：`git add -A && git commit -m "feat: 画布新建菜单增加文本便签入口,上传策略放行 md/txt"`

---

### Task 7: agent 产出文档自动导入

**Files:**
- Modify: `src/lib/media-import.ts`（`eventAssets`）
- Test: `src/lib/media-import.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `mediaKindToAssetKind('text') === 'text'`、`kindToImportType('text') === 'text'`。
- Produces: WS tool_result 中 kind 为 text/doc 的 media item 进入 `ReadyMedia`，由既有 `importFromLiveEvent` → `importGeneratedAsset`（import 端点 `type:'text'`）落画布，`importedByProject` 去重复用。

- [ ] **Step 1: 写失败测试**（构造含 `{kind:'text', path:'design.md', previewUrl:'/preview/...'}` media item 的 UserMessage tool_result 事件，断言 `eventAssets` 返回该项 kind==='text'；video/3d 仍被跳过）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**：`eventAssets` 的跳过条件维持 `kind === 'video' || kind === '3d'` 不变（text 自然放行，改动其实只有注释——确认 `parseMediaItems` 对未知 kind 不过滤；若其内部有 kind 白名单，同步放行 `text`，以实际代码为准）。

- [ ] **Step 4: 跑测试 + Commit**：`git add -A && git commit -m "feat: agent 产出 md/txt 文档自动导入画布为文本卡"`

---

### Task 8: 文本卡作为生成参考（prompt 注入）

**Files:**
- Modify: `src/components/canvas/gen-params.ts`（`DERIVE_MATRIX.text`）
- Modify: `src/store/actions.ts`（生成 action 源为 text 时的 prompt 前置注入）
- Test: `src/store/actions.test.ts`、`src/components/canvas/gen-params.test.ts`（追加）

**Interfaces:**
- Consumes: `loadTextContent`、`preview.text`。
- Produces: `derivableKinds('text') === ['image', 'video', '3d']`；从 text 卡「＋从此生成」时：不下发 `source_item_id`（后端仅接受 image），改为把文本内容前置进 prompt（截前 2000 字符），连线（parentId 落位）保留。

- [ ] **Step 1: 写失败测试**（derivableKinds('text') 断言；generateImage with sourceId=text 卡:断言请求 body 无 source_item_id、prompt 以文本内容开头、占位卡 parentId=text 卡 id）

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现**

```ts
// gen-params.ts
const DERIVE_MATRIX: Record<AssetKind, GenKind[]> = {
  image: ['image', 'video', '3d'],
  video: ['video'],
  audio: [],
  '3d': [],
  // 文本卡不可作 item 引用(生成接口仅收 image),派生时内容注入 prompt(store action 处理)
  text: ['image', 'video', '3d'],
};
```

```ts
// actions.ts:生成 action 组 body 处(generateImage/generateVideo/generateModel3d 共用一个 helper)
// 源资产是文本卡:不下发 source_item_id(后端 422),把内容截前 2000 字前置进 prompt 作参考
const TEXT_REF_LIMIT = 2000;
const resolveTextRef = async (opts?: GenPlacement): Promise<{ opts?: GenPlacement; promptPrefix: string }> => {
  const srcId = opts?.sourceItemId;
  if (!srcId) return { opts, promptPrefix: '' };
  const src = get().assets.find((a) => a.id === srcId);
  if (src?.kind !== 'text') return { opts, promptPrefix: '' };
  if (src.preview?.text == null) await loadTextContent(srcId).catch(() => {});   // 拉不到就不注入,不阻塞生成
  const text = get().assets.find((a) => a.id === srcId)?.preview?.text ?? '';
  // 剔除 sourceItemId(不发后端),保留 parentId 连线与落位语义(GenPlacement 结构以实际代码为准,连线字段若与 sourceItemId 同源则拆开)
  return { opts: { ...opts, sourceItemId: undefined }, promptPrefix: text ? `${text.slice(0, TEXT_REF_LIMIT)}\n\n` : '' };
};
```

各生成 action 调用处：`const { opts: o2, promptPrefix } = await resolveTextRef(opts); body.prompt = promptPrefix + body.prompt;`——**注意**：占位卡 `parentId` 连线取自 opts 的哪个字段以实际代码为准（`addGenPlaceholders` 签名），若 parentId 与 sourceItemId 是同一字段，需在 GenPlacement 拆分「连线用 parentId」与「下发用 sourceItemId」两个语义，保证去掉 source_item_id 后连线仍在。

- [ ] **Step 4: 跑测试 + tsc 通过后 Commit**：`git add -A && git commit -m "feat: 文本卡可派生生成,内容注入 prompt 作参考"`

---

### Task 9: 全量验证与收尾

- [ ] **Step 1:** `pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build` 全绿（只信退出码）。
- [ ] **Step 2:** `grep -rn "doc" src/lib/asset-kind.ts src/components/canvas` 确认无残留 doc 类型引用；`grep -n "color-doc" src -r` 为空。
- [ ] **Step 3:** 运行态冒烟（`/verify` 或 Playwright + mock PGC，参照 memory「无后端驱动前端流程截图」）：新建文本便签 → 编辑保存 → 卡片 md 摘要渲染 → 双击弹窗，逐态截图核对令牌与动效。
- [ ] **Step 4:** 回合主分支(dev)并清理 worktree（superpowers:finishing-a-development-branch）。
