# document 资产统一与纯文本内联发送 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** landing 传入的 `document` 资产可进对话栏发送；非图片附件统一 `@[type]<url>` token；纯文本(txt/md)内容以 `<attachment name="...">...</attachment>` 内联进正文（附件与 @引用画布 text 节点两条路）。

**Architecture:** 边界归一（`document`→内部 `text`）+ `ChatAttachment` 缓存纯文本内容 + 发送三分路（image 原生块 / 纯文本内联 / 其余 URL token）。设计稿：`docs/superpowers/specs/2026-07-10-document-asset-inline-design.md`。

**Tech Stack:** Next.js 16 + React 19 + zustand + Vitest（jsdom, tests 与源码同目录）。

## Global Constraints

- 注释/commit message 一律中文；commit 一句话总结。
- 纯函数下沉 `src/lib/` 并单测；副作用留 store/hooks。
- 不硬编码色值/样式（本计划无 UI 变更）。
- 类型检查 `pnpm exec tsc --noEmit`；测试 `pnpm exec vitest run <file>`。
- `await` 后必须校验 `get().currentProjectId === pid`，过期丢弃。
- mention type 契约（严格小写）：image/video/audio/model3d/document，见 `refs.ts` 的 `MENTION_TYPE`。

---

### Task 1: 纯文本文件名判定 `isPlainTextName`（lib/media-import.ts）

**Files:**
- Modify: `src/lib/media-import.ts`
- Test: `src/lib/media-import.test.ts`（已存在则追加，不存在则新建）

**Interfaces:**
- Produces: `isPlainTextName(nameOrUrl: string): boolean` — 按扩展名判定纯文本（`.txt`/`.md`/`.markdown`，大小写不敏感；URL 自动剥 query/hash）。

- [ ] **Step 1: 写失败测试**

```ts
import { isPlainTextName } from './media-import';

describe('isPlainTextName', () => {
  it('txt/md/markdown 扩展判定为纯文本(大小写不敏感)', () => {
    expect(isPlainTextName('notes.txt')).toBe(true);
    expect(isPlainTextName('README.MD')).toBe(true);
    expect(isPlainTextName('a.markdown')).toBe(true);
  });
  it('pdf/其他扩展/无扩展不是纯文本', () => {
    expect(isPlainTextName('spec.pdf')).toBe(false);
    expect(isPlainTextName('a.png')).toBe(false);
    expect(isPlainTextName('noext')).toBe(false);
  });
  it('URL 剥离 query/hash 后按路径末段判定', () => {
    expect(isPlainTextName('https://x.com/f/design.md?sig=abc#top')).toBe(true);
    expect(isPlainTextName('https://x.com/f/movie.mp4?ext=.md')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/media-import.test.ts`
Expected: FAIL（`isPlainTextName` 未导出）

- [ ] **Step 3: 最小实现**

```ts
// 纯文本扩展集:landing document 资产与 @引用内联判定共用(pdf 不在内,不可内联)
const PLAIN_TEXT_EXTS = ['txt', 'md', 'markdown'];

// 按文件名/URL 的扩展名判定是否纯文本;URL 先剥 query/hash 再取路径末段
export function isPlainTextName(nameOrUrl: string): boolean {
  const path = nameOrUrl.split(/[?#]/)[0];
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return path.includes('.') && PLAIN_TEXT_EXTS.includes(ext);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/media-import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/media-import.ts src/lib/media-import.test.ts
git commit -m "feat: 纯文本扩展判定 isPlainTextName(txt/md/markdown)"
```

---

### Task 2: prelude 接受 `document` kind 并归一为 `text`（lib/studio-prelude.ts）

**Files:**
- Modify: `src/lib/studio-prelude.ts:16-24`（`parseAssets` 循环体）
- Test: `src/lib/studio-prelude.test.ts`（追加用例）

**Interfaces:**
- Consumes: 现有 `AssetSeed { url; kind: AssetKind; name? }`、`KIND_ORDER`。
- Produces: `parseAssets`/`parseStudioPrelude` 行为变化——入参 `kind: 'document'` 的条目通过校验，产出 `kind: 'text'`。`AssetSeed` 形状不变。

- [ ] **Step 1: 写失败测试**（追加到 `src/lib/studio-prelude.test.ts`）

```ts
it('kind=document 归一为内部 text', () => {
  const assets = encodeURIComponent(JSON.stringify([
    { url: 'https://x.com/a.txt', kind: 'document', name: 'a.txt' },
    { url: 'https://x.com/b.pdf', kind: 'document' },
  ]));
  const p = parseStudioPrelude(`?assets=${assets}`);
  expect(p?.assets).toEqual([
    { url: 'https://x.com/a.txt', kind: 'text', name: 'a.txt' },
    { url: 'https://x.com/b.pdf', kind: 'text' },
  ]);
});

it('未知 kind 仍被丢弃', () => {
  const assets = encodeURIComponent(JSON.stringify([{ url: 'https://x.com/a', kind: 'file' }]));
  expect(parseStudioPrelude(`?assets=${assets}`)).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: FAIL（document 条目被丢弃，assets 为空）

- [ ] **Step 3: 实现**（替换 `parseAssets` 循环内 kind 校验两行）

```ts
    // landing 线格式 kind='document'(txt/pdf 统称)归一为内部一等类型 'text';
    // 内部枚举不新增成员——TextNode/筛选/MENTION_TYPE(text→document)全链路复用
    const normalized = kind === 'document' ? 'text' : kind;
    if (typeof normalized !== 'string' || !KIND_ORDER.includes(normalized as AssetKind)) continue;
    out.push({ url, kind: normalized as AssetKind, ...(typeof name === 'string' && name ? { name } : {}) });
```

（注意 `kind` 非 string 时 `normalized` 即原值，`typeof` 校验仍拦住。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/studio-prelude.test.ts`
Expected: PASS（含原有用例不回归）

- [ ] **Step 5: Commit**

```bash
git add src/lib/studio-prelude.ts src/lib/studio-prelude.test.ts
git commit -m "feat: prelude 接受 landing 的 document kind 并归一为内部 text"
```

---

### Task 3: refs.ts — canMention 放宽 / 发送版 token 替换 / 回显剥离（lib/refs.ts）

**Files:**
- Modify: `src/lib/refs.ts`
- Test: `src/lib/refs.test.ts`（追加用例）

**Interfaces:**
- Consumes: `MENTION_TYPE`（已有）、`AssetKind`。
- Produces:
  - `MentionAsset` 扩展：`{ key; kind; status; label?: string; preview?: { src?: string; text?: string } }`
  - `attachmentTag(name: string, text: string): string` — 返回 `<attachment name="...">...</attachment>`（name 中的 `"` 替换为 `'`）
  - `applyMentionTokensForSend(text: string, assets: MentionAsset[]): string` — Koubou 侧替换：text kind 且有 `preview.text` → attachment 标签（name 用 `label ?? key`）；其余有 src → `@[MENTION_TYPE[kind]]<src>`；无可用来源 → 原样保留
  - `canMention` 放宽：ready 且（有 `preview.src`，或 text kind 有 `preview.text`）
  - `applyMentionTokens`（气泡侧）行为微调：命中但无 `preview.src` 的资产原样保留 `@key`（不再假定 src 必在）
  - `extractRefs` 追加：剥离 `<attachment name="...">...</attachment>` 块；name 命中资产 label 时回填 key
  - `RefAsset` 扩展：`{ key; label?: string; preview?: { src?: string } }`

- [ ] **Step 1: 写失败测试**（追加到 `src/lib/refs.test.ts`）

```ts
describe('text 节点内联发送', () => {
  const textAsset = { key: 'note1', kind: 'text' as const, status: 'ready' as const, label: '关卡设计', preview: { text: '# 内容' } };
  const srcOnly = { key: 'doc2', kind: 'text' as const, status: 'ready' as const, preview: { src: 'https://x/d.pdf' } };
  const img = { key: 'img1', kind: 'image' as const, status: 'ready' as const, preview: { src: 'https://x/i.png' } };

  it('canMention: text 有 preview.text 即可提及;无 src 无 text 不可', () => {
    expect(canMention(textAsset)).toBe(true);
    expect(canMention({ ...textAsset, preview: {} })).toBe(false);
  });

  it('applyMentionTokensForSend: text+content → attachment 标签,name 用 label', () => {
    expect(applyMentionTokensForSend('看 @note1 的设定', [textAsset]))
      .toBe('看 <attachment name="关卡设计"># 内容</attachment> 的设定');
  });

  it('applyMentionTokensForSend: 仅 src 的 text → @[document]<url>;image → @[image]<url>', () => {
    expect(applyMentionTokensForSend('@doc2 @img1', [srcOnly, img]))
      .toBe('@[document]<https://x/d.pdf> @[image]<https://x/i.png>');
  });

  it('applyMentionTokens(气泡): 无 src 的 text 原样保留 @key,不崩', () => {
    expect(applyMentionTokens('看 @note1', [textAsset])).toBe('看 @note1');
  });

  it('extractRefs: 剥离 attachment 块;name 命中 label 回填 key', () => {
    const { keys, text } = extractRefs('前文 <attachment name="关卡设计"># 内容</attachment> 后文',
      [{ key: 'note1', label: '关卡设计' }]);
    expect(keys).toEqual(['note1']);
    expect(text).toBe('前文 后文');
  });

  it('extractRefs: name 未命中也剥离标签(不渲染原始内容)', () => {
    const { keys, text } = extractRefs('a <attachment name="x">y</attachment> b', []);
    expect(keys).toEqual([]);
    expect(text).toBe('a b');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/refs.test.ts`
Expected: FAIL（新函数未导出）

- [ ] **Step 3: 实现**

`MentionAsset` / `canMention` / `applyMentionTokens` 改为：

```ts
export interface MentionAsset {
  key: string;
  kind: AssetKind;
  status: Status;
  label?: string;                              // 节点名称:内联 attachment 标签的 name
  preview?: { src?: string; text?: string };   // text=PGC content 内联内容(仅 text 资产)
}

// 资产是否可被 @提及:就绪且有后端 url;text 资产有内联内容(preview.text)时亦可(发送走内联)
export function canMention(asset: MentionAsset): boolean {
  if (asset.status !== 'ready') return false;
  return !!asset.preview?.src || (asset.kind === 'text' && !!asset.preview?.text);
}

// 内联附件标签:纯文本内容包裹后拼进 Koubou 正文;name 含双引号替换为单引号防破坏属性
export function attachmentTag(name: string, text: string): string {
  return `<attachment name="${name.replace(/"/g, "'")}">${text}</attachment>`;
}

// 气泡侧:@key → @[type]<url>;无 src(纯内联 text 资产)原样保留 @key(extractRefs 按 key 反查渲染 chip)
export function applyMentionTokens(text: string, assets: MentionAsset[]): string {
  const eligible = new Map<string, MentionAsset>();
  for (const a of assets) if (canMention(a)) eligible.set(a.key, a);
  return text.replace(/@(\S+)/g, (m, token: string) => {
    const a = eligible.get(token);
    if (!a?.preview?.src) return m;
    return `@[${MENTION_TYPE[a.kind]}]<${a.preview.src}>`;
  });
}

// Koubou 发送侧:text 资产有内联内容 → attachment 标签(agent 直读,无需工具取 url);
// 其余有 src → @[type]<url>;均无 → 原样保留
export function applyMentionTokensForSend(text: string, assets: MentionAsset[]): string {
  const eligible = new Map<string, MentionAsset>();
  for (const a of assets) if (canMention(a)) eligible.set(a.key, a);
  return text.replace(/@(\S+)/g, (m, token: string) => {
    const a = eligible.get(token);
    if (!a) return m;
    if (a.kind === 'text' && a.preview?.text) return attachmentTag(a.label ?? a.key, a.preview.text);
    if (a.preview?.src) return `@[${MENTION_TYPE[a.kind]}]<${a.preview.src}>`;
    return m;
  });
}
```

`RefAsset` / `extractRefs` 改为（在现有两段 replace 之前加 attachment 剥离）：

```ts
export interface RefAsset { key: string; label?: string; preview?: { src?: string }; }

export function extractRefs(text: string, assets: RefAsset[]): { keys: string[]; text: string } {
  const byToken = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const a of assets) {
    byToken.set(a.key, a.key);
    if (a.label) byLabel.set(a.label, a.key);
    if (a.preview?.src) {
      byToken.set(a.preview.src, a.key);
      byUrl.set(a.preview.src, a.key);
    }
  }
  const keys: string[] = [];
  const pushKey = (k: string) => { if (!keys.includes(k)) keys.push(k); };

  // 内联 attachment 块:历史重建的消息文本含完整内联内容,一律剥离不渲染原文;name 命中 label 回填 chip
  let stripped = text.replace(/<attachment name="([^"]*)">[\s\S]*?<\/attachment>/g, (_m, name: string) => {
    const key = byLabel.get(name);
    if (key) pushKey(key);
    return '';
  });

  stripped = stripped.replace(/@\[[a-z0-9]+\]<([^>]+)>/gi, (m, url: string) => {
    const key = byUrl.get(url);
    if (key) { pushKey(key); return ''; }
    return m;
  });

  stripped = stripped.replace(/@(\S+)/g, (m, token: string) => {
    const key = byToken.get(token);
    if (key) { pushKey(key); return ''; }
    return m;
  });

  return { keys, text: stripped.replace(/ {2,}/g, ' ').trim() };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/refs.test.ts`
Expected: PASS（含原有用例不回归）

- [ ] **Step 5: 检查 extractRefs 调用方传入 label**

`grep -rn "extractRefs" src --include="*.tsx"`，调用方（MessageItem 等）传入的资产对象需带 `label`（Asset 本身有 `label` 字段，多数直接传 store assets 即满足；确认形状兼容即可，缺则补映射）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/refs.ts src/lib/refs.test.ts
git commit -m "feat: @引用 text 节点发送时内联内容,回显剥离 attachment 标签"
```

---

### Task 4: ChatAttachment.text — 本地上传纯文本读内容（store/types.ts + store/index.ts）

**Files:**
- Modify: `src/store/types.ts:40-48`（`ChatAttachment`）
- Modify: `src/store/index.ts:387-408`（`uploadChatAttachment`）
- Test: `src/store/chat-attachment-text.test.ts`（新建；若已有 uploadChatAttachment 相关测试文件则追加到该处）

**Interfaces:**
- Consumes: `TEXT_MIMES`（`@/lib/upload-policy`，值 `['text/markdown', 'text/plain']`）。
- Produces: `ChatAttachment` 增加 `text?: string`（纯文本内容缓存，仅 TEXT_MIMES 命中时有值）；`uploadChatAttachment` ready 态附件带 `text`。

- [ ] **Step 1: types.ts 增加字段**

```ts
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  kind: AssetKind;
  status: 'uploading' | 'ready' | 'error';
  url?: string;     // resolveAssetUrl 后的绝对 URL:气泡缩略图 + koubou
  itemId?: string;  // 画布 item_id:移除时删孤儿
  text?: string;    // 纯文本内容(txt/md):发送时内联进正文而非 URL 引用
}
```

- [ ] **Step 2: 写失败测试**

参照现有 store 测试的 mock 手法（`vi.mock` PGC client）。核心断言：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useStore } from '@/store';

vi.mock('@/lib/pgc/client', () => ({
  pgcApi: {
    uploadCanvasItem: vi.fn(async () => ({ item_id: 'it1', url: '/preview/a.md' })),
    updateCanvasReference: vi.fn(async () => ({})),
    deleteCanvasItem: vi.fn(async () => ({})),
  },
}));
// 注:uploadCanvasItem/updateCanvasReference 的实际导入路径以 src/store/index.ts 顶部 import 为准,mock 对齐该路径

describe('uploadChatAttachment 纯文本读内容', () => {
  beforeEach(() => useStore.setState({ currentProjectId: 1, composer: { draft: '', attachments: [], baseLines: 1 } }));

  it('text/markdown 文件 ready 后附件带 text 内容', async () => {
    const file = new File(['# 标题\n内容'], 'a.md', { type: 'text/markdown' });
    await useStore.getState().uploadChatAttachment(file);
    const att = useStore.getState().composer.attachments[0];
    expect(att.status).toBe('ready');
    expect(att.text).toBe('# 标题\n内容');
  });

  it('非文本 mime 不读内容', async () => {
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await useStore.getState().uploadChatAttachment(file);
    expect(useStore.getState().composer.attachments[0].text).toBeUndefined();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/chat-attachment-text.test.ts`
Expected: FAIL（`text` undefined）

- [ ] **Step 4: 实现**（`uploadChatAttachment` try 块内改）

```ts
        try {
          // 纯文本(txt/md)先读内容缓存:发送时内联进正文,agent 无需再经工具取 url
          const text = TEXT_MIMES.includes(file.type) ? await file.text() : undefined;
          const item = await uploadCanvasItem(pid, file);
          if (get().currentProjectId !== pid) return; // await 后校验:切项目则丢弃,不再标记
          await pgcApi.updateCanvasReference(pid, item.item_id, { chat_attachment: true });
          if (get().currentProjectId !== pid) return; // await 后切项目则丢弃
          patch({ status: 'ready', url: resolveAssetUrl(item.url), itemId: item.item_id, ...(text != null ? { text } : {}) });
        } catch (e) {
```

`src/store/index.ts` 顶部补 `import { TEXT_MIMES } from '@/lib/upload-policy';`（若未引入）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/chat-attachment-text.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/store/types.ts src/store/index.ts src/store/chat-attachment-text.test.ts
git commit -m "feat: 对话栏上传纯文本附件时读取内容缓存到 ChatAttachment.text"
```

---

### Task 5: applyStudioPrelude — document 种子拉取纯文本内容（store/index.ts）

**Files:**
- Modify: `src/store/index.ts:246-279`（`applyStudioPrelude`）
- Test: `src/store/studio-prelude-fetch.test.ts`（新建；若已有 applyStudioPrelude 测试则追加）

**Interfaces:**
- Consumes: `isPlainTextName`（Task 1）、`assetProxyUrl`（`@/lib/pgc/url`，包成同源 `/api/pgc/asset?url=` 防 CORS）、`assetSeedLabel`。
- Produces: prelude 中扩展名为纯文本的 text 种子，附件带 `text`（fetch 成功）或不带（失败降级 URL token）；**fetch 落定后才 composerSet + arm**。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useStore } from '@/store';

// mock createProject/refreshProjectList 所依赖的 PGC client(参照现有 actions 测试的 mock 方式对齐真实导入路径)

describe('applyStudioPrelude 纯文本种子内容拉取', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('txt 种子 fetch 成功 → 附件带 text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('文件内容', { status: 200 })));
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.txt', kind: 'text', name: 'a.txt' }],
    });
    const att = useStore.getState().composer.attachments[0];
    expect(att.text).toBe('文件内容');
    expect(useStore.getState().autoSendArmed).toBe(true);
  });

  it('fetch 失败 → 附件无 text 仍 ready(降级 URL token),照常 arm', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.txt', kind: 'text' }],
    });
    const att = useStore.getState().composer.attachments[0];
    expect(att.text).toBeUndefined();
    expect(att.status).toBe('ready');
    expect(useStore.getState().autoSendArmed).toBe(true);
  });

  it('pdf 种子不 fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await useStore.getState().applyStudioPrelude({
      assets: [{ url: 'https://pgc.x/f/a.pdf', kind: 'text', name: 'a.pdf' }],
    });
    expect(f).not.toHaveBeenCalled();
  });
});
```

（createProject 需 mock 成功落 `currentProjectId`，具体 mock 结构参照 `src/store/` 下现有 applyStudioPrelude / actions 测试；若无先例，mock `@/lib/pgc/client` 的 `pgcApi.createProject` 等最小集合。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/studio-prelude-fetch.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**（`applyStudioPrelude` 中 `composerSet` 前插入拉取，attachments 映射改）

```ts
          // 纯文本种子(txt/md)预拉内容:发送时内联进正文;经同源媒体代理规避 CORS。
          // 全部落定(成败均可)后才预填并 arm——保证自动发送时内容已就位;失败降级 URL token,不弹 Toast
          const seedTexts = await Promise.all(prelude.assets.map(async (a) => {
            if (a.kind !== 'text' || !isPlainTextName(a.name ?? a.url)) return undefined;
            try {
              const res = await fetch(assetProxyUrl(a.url)!);
              return res.ok ? await res.text() : undefined;
            } catch {
              return undefined;
            }
          }));
          if (get().currentProjectId !== pid) return; // await 后校验:切项目则丢弃
          get().composerSet({
            draft: prelude.prompt ?? '',
            attachments: prelude.assets.map((a, i): ChatAttachment => ({
              id: newId('att'), name: assetSeedLabel(a), mime: '', kind: a.kind, status: 'ready', url: a.url,
              ...(seedTexts[i] != null ? { text: seedTexts[i] } : {}),
            })),
          });
```

顶部补 import：`isPlainTextName`（`@/lib/media-import`）、`assetProxyUrl`（`@/lib/pgc/url`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/studio-prelude-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/store/studio-prelude-fetch.test.ts
git commit -m "feat: prelude 纯文本种子经同源代理预拉内容,落定后再 arm 自动发送"
```

---

### Task 6: Composer 发送三分路（components/chat/Composer.tsx）

**Files:**
- Modify: `src/components/chat/Composer.tsx:142-180`（`send`）
- Test: `src/components/chat/Composer.test.tsx`（改/增用例）

**Interfaces:**
- Consumes: `applyMentionTokensForSend`、`attachmentTag`、`MENTION_TYPE`（Task 3）；`ChatAttachment.text`（Task 4/5）。
- Produces: Koubou 发送形态——image 附件原生 image 块；带 `text` 附件内联 attachment 标签；其余附件 `@[type]<url>` token；**PDF 原生 document 块删除**。气泡（`pushUserMessage`）不变。

- [ ] **Step 1: 改/增测试**（`Composer.test.tsx`，参照现有发送用例的 FakeWS/断言手法）

核心断言（用例名与组织对齐现有文件风格）：

```ts
it('纯文本附件内联 attachment 标签发送,不发 URL token', () => {
  // attachments: [{ kind:'text', status:'ready', url:'https://x/a.md', name:'a.md', text:'# 内容' }]
  // 断言发出的 user.message content(string)含 '<attachment name="a.md"># 内容</attachment>'
  // 且不含 '@[document]<https://x/a.md>'
});

it('PDF 附件走 @[document]<url> token,不再发原生 document 块', () => {
  // attachments: [{ kind:'text', status:'ready', url:'https://x/s.pdf', name:'s.pdf', mime:'application/pdf' }]
  // 断言 content 为 string 且含 '@[document]<https://x/s.pdf>';无 document 内容块
});

it('video/audio/3d 附件折叠为 @[type]<url> 新格式', () => {
  // kind:'video' → '@[video]<url>';kind:'3d' → '@[model3d]<url>'
});

it('image 附件仍走原生 image 内容块', () => {
  // content 为数组且含 { type:'image', source:{ type:'url', url } }
});

it('@引用 text 节点:气泡保留 @key,koubou 侧为 attachment 标签', () => {
  // store assets 注入 { key:'note1', kind:'text', status:'ready', label:'设定', preview:{ text:'内容' } }
  // draft: '看 @note1'
  // 断言 pushUserMessage 的气泡 text 含 '@note1';WS 发出的 text 含 '<attachment name="设定">内容</attachment>'
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: 新用例 FAIL（旧格式 `@url` / document 块仍在）

- [ ] **Step 3: 实现**（替换 `send` 中折叠与内容块段）

```ts
    // 发送三分路:image 走原生 image 内容块;纯文本(带 text)内联 attachment 标签(agent 直读);
    // 其余(video/audio/3d/pdf/拉取失败的纯文本)折叠 @[type]<url> token(agent 经 understand_media/工具理解)
    const koubouDraft = applyMentionTokensForSend(draft.trim(), assets);
    const tokenFolded = ready.filter((a) => a.kind !== 'image' && !a.text);
    const inlined = ready.filter((a) => a.kind !== 'image' && !!a.text);
    const koubouText = [
      [koubouDraft, ...tokenFolded.map((a) => `@[${MENTION_TYPE[a.kind]}]<${a.url}>`)].filter(Boolean).join(' '),
      ...inlined.map((a) => attachmentTag(a.name, a.text!)),
    ].filter(Boolean).join('\n\n');
    if (runStatus === 'running') {
      if (koubouText) client.current?.steer(koubouText); // 仅文本可 steer;空文本(纯媒体块此轮)不空发打断
    } else {
      const imageBlocks = ready
        .filter((a) => a.kind === 'image')
        .map((a) => ({ type: 'image', source: { type: 'url', url: a.url } }));
      const content: string | ContentBlock[] = imageBlocks.length
        ? ([...(koubouText ? [{ type: 'text', text: koubouText }] : []), ...imageBlocks] as ContentBlock[])
        : koubouText;
      client.current?.sendUserMessage({ role: 'user', content });
    }
```

import 行补 `applyMentionTokensForSend, attachmentTag, MENTION_TYPE`（自 `@/lib/refs`）。`bubbleText = applyMentionTokens(draft.trim(), assets)` 与 `pushUserMessage` 保持不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: PASS（含原有用例；原有断言旧 `@url` 格式/document 块的用例同步更新为新格式）

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: 发送三分路——纯文本内联/非图片统一 @[type]<url>/删 PDF 原生块"
```

---

### Task 7: 全量校验

- [ ] **Step 1: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors（重点:`extractRefs`/`MentionAsset` 形状变更的所有调用方——MessageItem/AttachmentBar/MentionPopover/ContextMenu）

- [ ] **Step 2: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS

- [ ] **Step 3: lint**

Run: `pnpm lint`
Expected: 0 errors

- [ ] **Step 4: 如有修复,提交**

```bash
git add -A && git commit -m "fix: 类型/lint 收尾"
```
