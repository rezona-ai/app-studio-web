# 资产 @提及内联 token(`@[type]<url>`)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在对话框 @提及画布资产时,草稿内联记 `@key`(镜像层参考 skill pill 着色),发送时把 `@key` 原位替换成后端要求的 `@[type]<url>` token;输入框资产 chip 与消息气泡的展示方式保持不变,但改由草稿派生而非独立存储。

**Architecture:** 新纯函数集中在 `src/lib/refs.ts`(kind 映射、eligibility 判定、token 原位替换、草稿派生、mirror 分段),store 的 `composer.refs` 字段整体退役、`addRef`/`removeRef` 改为直接操作 `composer.draft`;`Composer.tsx` 把 mention 分段并入既有 skill 分段渲染管线,`send()` 用一次 `applyMentionTokens` 替换掉旧的「末尾拼接 token」逻辑;`AttachmentBar`/`MentionPopover`/`ContextMenu` 各自改为读取派生结果或做 eligibility 过滤。

**Tech Stack:** TypeScript, React 19, Zustand, Vitest + Testing Library(既有栈,不引入新依赖)。

## Global Constraints

- mention type 严格限定且大小写敏感:`image | video | audio | model3d | document`(来源:koubou-agent-py `docs/frontend/mention-resource-interface.md`)。
- kind → type 映射:`image→image, video→video, audio→audio, 3d→model3d, text→document`。
- 只有 `status === 'ready' && preview?.src` 的资产可被提及(eligible);不满足条件的资产不进候选、右键项禁用、发送时不替换。
- token 格式:`@[type]<url>`,`url` 取资产的 `preview.src`。
- 前端不做 preview_base host 校验(`preview.src` 本身即后端下发的预览地址)。
- 聊天上传附件(视频/音频)的 `@url` 折叠格式本次不动。
- 输入框资产 chip(`AttachmentBar`)与消息气泡的资产 chip(`MessageItem`)展示方式不变;仅新增草稿正文内的 `@key` 内联着色(镜像层,参考 skill pill 做法)。
- 代码注释 / commit message 用中文;每个 task 结束单独 commit。

---

### Task 1: `src/lib/refs.ts` 纯函数重写

**Files:**
- Modify: `src/lib/refs.ts`
- Test: `src/lib/refs.test.ts`

**Interfaces:**
- Consumes: `AssetKind`(`@/lib/asset-kind`)、`Status`(`@/store/types`)
- Produces(后续任务依赖的确切签名):
  - `export interface MentionAsset { key: string; kind: AssetKind; status: Status; preview?: { src?: string }; }`
  - `export const MENTION_TYPE: Record<AssetKind, 'image' | 'video' | 'audio' | 'model3d' | 'document'>`
  - `export function canMention(asset: MentionAsset): boolean`
  - `export function applyMentionTokens(text: string, assets: MentionAsset[]): string`
  - `export function resolveMentionRefs(draft: string, assets: MentionAsset[]): string[]`
  - `export function insertMentionRef(draft: string, key: string): string`
  - `export function removeMentionKey(draft: string, key: string): string`
  - `export interface MentionSegment { kind: 'plain' | 'mention'; text: string; }`
  - `export function splitMentionTokens(text: string, keys: string[]): MentionSegment[]`
  - `export interface RefAsset { key: string; preview?: { src?: string }; }`(保留,`extractRefs` 用)
  - `export function extractRefs(text: string, assets: RefAsset[]): { keys: string[]; text: string }`(扩展识别新格式)
  - `getActiveMention` 与 `ActiveMention` 不变
  - 删除:`refToken`(旧发送路径专用,替换后无调用方)

- [ ] **Step 1: 写失败测试(全量覆盖新纯函数)**

覆盖 `src/lib/refs.test.ts`,保留原有 `getActiveMention` 测试块,其余整体替换为:

```ts
import { describe, expect, test } from 'vitest';
import {
  getActiveMention,
  canMention,
  applyMentionTokens,
  resolveMentionRefs,
  insertMentionRef,
  removeMentionKey,
  splitMentionTokens,
  extractRefs,
  type MentionAsset,
} from './refs';

describe('getActiveMention', () => {
  test('光标紧跟 @query 时返回 query 与起点', () => {
    const text = '把 @主角 调亮';
    const caret = 5; // 紧跟在 "@主角" 之后
    expect(getActiveMention(text, caret)).toEqual({ query: '主角', start: 2 });
  });
  test('@ 后到光标含空格则不激活', () => {
    expect(getActiveMention('@主 角', 4)).toBeNull();
  });
  test('无 @ 返回 null', () => {
    expect(getActiveMention('普通文本', 3)).toBeNull();
  });
  test('空 query(刚敲 @)也激活', () => {
    expect(getActiveMention('hi @', 4)).toEqual({ query: '', start: 3 });
  });
});

// 测试用最小资产集:char-1 就绪且有 url(可提及);clip-1 就绪且有 url(video);
// pending-1 生成中(不可提及);nosrc-1 就绪但无 preview(不可提及)
const ASSETS: MentionAsset[] = [
  { key: 'char-1', kind: 'image', status: 'ready', preview: { src: 'https://cdn/p/char-1.png' } },
  { key: 'clip-1', kind: 'video', status: 'ready', preview: { src: 'https://cdn/p/clip-1.mp4' } },
  { key: 'pending-1', kind: 'image', status: 'generating', preview: { src: 'https://cdn/p/pending.png' } },
  { key: 'nosrc-1', kind: 'image', status: 'ready' },
];

describe('canMention', () => {
  test('就绪且有 preview.src → 可提及', () => {
    expect(canMention(ASSETS[0])).toBe(true);
  });
  test('未就绪(生成中)→ 不可提及', () => {
    expect(canMention(ASSETS[2])).toBe(false);
  });
  test('就绪但无 preview → 不可提及', () => {
    expect(canMention(ASSETS[3])).toBe(false);
  });
});

describe('applyMentionTokens', () => {
  test('image 资产 → @[image]<url>', () => {
    expect(applyMentionTokens('改 @char-1 更红', ASSETS)).toBe('改 @[image]<https://cdn/p/char-1.png> 更红');
  });
  test('video 资产 → @[video]<url>', () => {
    expect(applyMentionTokens('配这段 @clip-1', ASSETS)).toBe('配这段 @[video]<https://cdn/p/clip-1.mp4>');
  });
  test('3d kind 映射为 model3d,text kind 映射为 document', () => {
    const assets: MentionAsset[] = [
      { key: 'tree-1', kind: '3d', status: 'ready', preview: { src: 'https://cdn/p/tree.glb' } },
      { key: 'spec-1', kind: 'text', status: 'ready', preview: { src: 'https://cdn/p/spec.pdf' } },
    ];
    expect(applyMentionTokens('@tree-1 @spec-1', assets)).toBe(
      '@[model3d]<https://cdn/p/tree.glb> @[document]<https://cdn/p/spec.pdf>',
    );
  });
  test('未就绪资产的 @key 原样保留(不替换)', () => {
    expect(applyMentionTokens('用 @pending-1 做参考', ASSETS)).toBe('用 @pending-1 做参考');
  });
  test('无 preview 资产的 @key 原样保留(不替换)', () => {
    expect(applyMentionTokens('用 @nosrc-1 做参考', ASSETS)).toBe('用 @nosrc-1 做参考');
  });
  test('未知 @token 原样保留(不误伤邮箱)', () => {
    expect(applyMentionTokens('联系 nick@rezona.ai', ASSETS)).toBe('联系 nick@rezona.ai');
  });
  test('同一文本多个引用按位置原位替换,顺序与其余文本保持不变', () => {
    expect(applyMentionTokens('用 @char-1 配 @clip-1 的节奏', ASSETS)).toBe(
      '用 @[image]<https://cdn/p/char-1.png> 配 @[video]<https://cdn/p/clip-1.mp4> 的节奏',
    );
  });
});

describe('resolveMentionRefs', () => {
  test('单个 @key 命中 → 返回该 key', () => {
    expect(resolveMentionRefs('改 @char-1 更红', ASSETS)).toEqual(['char-1']);
  });
  test('多个不同 @key → 按出现顺序返回', () => {
    expect(resolveMentionRefs('@clip-1 配 @char-1', ASSETS)).toEqual(['clip-1', 'char-1']);
  });
  test('同一 @key 重复出现 → 去重只算一次', () => {
    expect(resolveMentionRefs('@char-1 和 @char-1', ASSETS)).toEqual(['char-1']);
  });
  test('未就绪 / 无 preview 的资产不计入', () => {
    expect(resolveMentionRefs('@pending-1 @nosrc-1 @char-1', ASSETS)).toEqual(['char-1']);
  });
  test('未知 @token 不计入', () => {
    expect(resolveMentionRefs('联系 nick@rezona.ai', ASSETS)).toEqual([]);
  });
  test('无引用 → 空数组', () => {
    expect(resolveMentionRefs('纯文本', ASSETS)).toEqual([]);
  });
});

describe('insertMentionRef', () => {
  test('空草稿 → @key 加尾随空格', () => {
    expect(insertMentionRef('', 'char-1')).toBe('@char-1 ');
  });
  test('非空且不以空格结尾 → 补一个空格再追加', () => {
    expect(insertMentionRef('看这张图', 'char-1')).toBe('看这张图 @char-1 ');
  });
  test('已以空格结尾 → 不重复补空格', () => {
    expect(insertMentionRef('看这张图 ', 'char-1')).toBe('看这张图 @char-1 ');
  });
});

describe('removeMentionKey', () => {
  test('唯一引用移除后草稿清空', () => {
    expect(removeMentionKey('@char-1', 'char-1')).toBe('');
  });
  test('仅移除匹配 key 的 token,保留其余正文与其它引用', () => {
    expect(removeMentionKey('看 @char-1 这个 @clip-1 好看', 'char-1')).toBe('看 这个 @clip-1 好看');
  });
  test('前缀相同的其它 key 不受影响(如移除 img-1 不误伤 img-10)', () => {
    expect(removeMentionKey('@img-1 和 @img-10', 'img-1')).toBe('和 @img-10');
  });
  test('key 含正则特殊字符(如文件名)也能正确移除', () => {
    expect(removeMentionKey('看 @sky.v1.png 这张', 'sky.v1.png')).toBe('看 这张');
  });
});

describe('splitMentionTokens', () => {
  test('命中已知 key → 切出 mention 片段', () => {
    expect(splitMentionTokens('改 @char-1 更红', ['char-1'])).toEqual([
      { kind: 'plain', text: '改 ' },
      { kind: 'mention', text: '@char-1' },
      { kind: 'plain', text: ' 更红' },
    ]);
  });
  test('未知 token 不切分,整体作 plain', () => {
    expect(splitMentionTokens('联系 nick@rezona.ai', ['char-1'])).toEqual([
      { kind: 'plain', text: '联系 nick@rezona.ai' },
    ]);
  });
  test('无已知 key → 整体作 plain', () => {
    expect(splitMentionTokens('随便文本', [])).toEqual([{ kind: 'plain', text: '随便文本' }]);
  });
  test('空文本 → 空数组', () => {
    expect(splitMentionTokens('', ['char-1'])).toEqual([]);
  });
});

describe('extractRefs', () => {
  const refAssets = ASSETS.map((a) => ({ key: a.key, preview: a.preview }));

  test('新格式 @[type]<url> 命中资产 → 剥离并回填 key', () => {
    const r = extractRefs('让 @[image]<https://cdn/p/char-1.png> 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('新格式 url 反查不到(资产已删除)→ 原样保留', () => {
    const r = extractRefs('参考 @[image]<https://cdn/p/gone.png> 这个', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('参考 @[image]<https://cdn/p/gone.png> 这个');
  });
  test('兼容历史 @url', () => {
    const r = extractRefs('让 @https://cdn/p/char-1.png 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('兼容历史 @key', () => {
    const r = extractRefs('让 @char-1 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('未知 @token 原样保留(不误伤邮箱)', () => {
    const r = extractRefs('联系 nick@rezona.ai', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('联系 nick@rezona.ai');
  });
  test('多个引用去重保序', () => {
    const r = extractRefs('@[image]<https://cdn/p/char-1.png> @clip-1 @[image]<https://cdn/p/char-1.png> 文本', refAssets);
    expect(r.keys).toEqual(['char-1', 'clip-1']);
    expect(r.text).toBe('文本');
  });
  test('无引用时原样返回', () => {
    const r = extractRefs('纯文本', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('纯文本');
  });
  test('round-trip:applyMentionTokens 产出的新格式 token 能被 extractRefs 解析回 key', () => {
    const token = applyMentionTokens('@char-1', ASSETS);
    const r = extractRefs(`改 ${token}`, refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('改');
  });
});
```

- [ ] **Step 2: 运行测试确认全部失败(函数尚未实现/签名不匹配)**

Run: `pnpm exec vitest run src/lib/refs.test.ts`
Expected: FAIL —— `canMention`/`applyMentionTokens`/`resolveMentionRefs`/`insertMentionRef`/`removeMentionKey`/`splitMentionTokens` 不存在的导入错误,以及 `extractRefs` 新格式用例断言失败。

- [ ] **Step 3: 重写 `src/lib/refs.ts`**

```ts
import type { AssetKind } from './asset-kind';
import type { Status } from '@/store/types';

export interface ActiveMention { query: string; start: number; }

// 返回光标处正在输入的 @mention(从最近的 '@' 到光标,中间不含空白)
export function getActiveMention(text: string, caret: number): ActiveMention | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

// 可被 @提及的资产最小形状:status/preview 决定是否 eligible,kind 决定发送时的 mention type
export interface MentionAsset {
  key: string;
  kind: AssetKind;
  status: Status;
  preview?: { src?: string };
}

// kind → 后端 mention type(严格限定、大小写敏感,契约见 koubou-agent-py mention-resource-interface.md)
export const MENTION_TYPE: Record<AssetKind, 'image' | 'video' | 'audio' | 'model3d' | 'document'> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  '3d': 'model3d',
  text: 'document',
};

// 资产是否可被 @提及:必须就绪且有后端预览地址(preview.src),否则后端无可用 url
export function canMention(asset: MentionAsset): boolean {
  return asset.status === 'ready' && !!asset.preview?.src;
}

// 草稿发送前把 @key 原位替换为 @[type]<url>;不可提及/未知 @token 原样保留(不误伤邮箱等)
export function applyMentionTokens(text: string, assets: MentionAsset[]): string {
  const eligible = new Map<string, MentionAsset>();
  for (const a of assets) if (canMention(a)) eligible.set(a.key, a);
  return text.replace(/@(\S+)/g, (m, token: string) => {
    const a = eligible.get(token);
    if (!a) return m;
    return `@[${MENTION_TYPE[a.kind]}]<${a.preview!.src}>`;
  });
}

// 从草稿派生当前引用的资产 key 列表(按出现顺序去重),仅计入可提及资产——供 chip 展示与 send() 校验复用同一份逻辑
export function resolveMentionRefs(draft: string, assets: MentionAsset[]): string[] {
  const eligible = new Set(assets.filter(canMention).map((a) => a.key));
  const keys: string[] = [];
  const re = /@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft))) {
    if (eligible.has(m[1]) && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

// 画布右键「引用到对话」等非光标场景:把 @key 追加到草稿末尾(自动补分隔空格,不重复)
export function insertMentionRef(draft: string, key: string): string {
  const trimmed = draft.replace(/\s+$/, '');
  return trimmed ? `${trimmed} @${key} ` : `@${key} `;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// chip 移除按钮:从草稿中删掉该 key 对应的全部 @key token(词尾边界匹配,不误伤同前缀的其它 key)
export function removeMentionKey(draft: string, key: string): string {
  return draft
    .replace(new RegExp(`@${escapeRegExp(key)}(?=\\s|$)`, 'g'), '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export interface MentionSegment { kind: 'plain' | 'mention'; text: string; }

// 把草稿切成 plain/mention 片段供镜像层着色;仅命中已知(可提及)key 的 @key 记为 mention,与 skills.ts 的 splitSkillTokens 同构
export function splitMentionTokens(text: string, keys: string[]): MentionSegment[] {
  if (!text) return [];
  if (keys.length === 0) return [{ kind: 'plain', text }];
  const known = new Set(keys);
  const segs: MentionSegment[] = [];
  let last = 0;
  const re = /@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!known.has(m[1])) continue;
    if (m.index > last) segs.push({ kind: 'plain', text: text.slice(last, m.index) });
    segs.push({ kind: 'mention', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: 'plain', text: text.slice(last) });
  return segs;
}

// 消息气泡剥离引用所需的最小资产形状
export interface RefAsset { key: string; preview?: { src?: string }; }

// 从用户消息文本提取资产引用 token 并剥离,回填资产 key(去重保序):
// 依次识别新格式 @[type]<url>(按 url 反查)与历史 @url / @key;均反查不到的原样保留(不误伤邮箱)
export function extractRefs(text: string, assets: RefAsset[]): { keys: string[]; text: string } {
  const byToken = new Map<string, string>();
  const byUrl = new Map<string, string>();
  for (const a of assets) {
    byToken.set(a.key, a.key);
    if (a.preview?.src) {
      byToken.set(a.preview.src, a.key);
      byUrl.set(a.preview.src, a.key);
    }
  }
  const keys: string[] = [];
  const pushKey = (k: string) => { if (!keys.includes(k)) keys.push(k); };

  let stripped = text.replace(/@\[[a-z0-9]+\]<([^>]+)>/gi, (m, url: string) => {
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

- [ ] **Step 4: 运行测试确认全部通过**

Run: `pnpm exec vitest run src/lib/refs.test.ts`
Expected: PASS(全部用例)

- [ ] **Step 5: Commit**

```bash
git add src/lib/refs.ts src/lib/refs.test.ts
git commit -m "refactor: 重写 refs.ts 支持 @[type]<url> mention token"
```

---

### Task 2: store composer 状态改造(`refs` 字段退役)

**Files:**
- Modify: `src/store/index.ts:41,162,360-369,429`
- Test: `src/store/composer-mention.test.ts`(新建)
- Modify(修复因类型收紧而报错的既有测试字面量): `src/client/useProjectBootstrap.test.tsx:29`、`src/store/studio-prelude.test.ts:28`、`src/store/studio-remix.test.ts:33`、`src/store/actions.test.ts:1473,1488,1498,1508`

**Interfaces:**
- Consumes: `insertMentionRef`、`removeMentionKey`(Task 1,`@/lib/refs`)
- Produces: `ComposerState = { draft: string; attachments: ChatAttachment[] }`(无 `refs` 字段);`addRef(key)`/`removeRef(key)` 语义变为直接改写 `composer.draft`

- [ ] **Step 1: 写失败测试**

新建 `src/store/composer-mention.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';

beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [] } }));

describe('store.addRef', () => {
  test('空草稿追加 @key(带尾随空格)', () => {
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('@k1 ');
  });

  test('已有草稿 → 补一个空格后追加', () => {
    useStore.setState({ composer: { draft: '看这张图', attachments: [] } });
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('看这张图 @k1 ');
  });

  test('草稿已以空格结尾 → 不重复补空格', () => {
    useStore.setState({ composer: { draft: '看这张图 ', attachments: [] } });
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('看这张图 @k1 ');
  });
});

describe('store.removeRef', () => {
  test('移除唯一引用后草稿清空', () => {
    useStore.setState({ composer: { draft: '@k1', attachments: [] } });
    useStore.getState().removeRef('k1');
    expect(useStore.getState().composer.draft).toBe('');
  });

  test('仅移除匹配 key 的 token,保留其余正文', () => {
    useStore.setState({ composer: { draft: '看 @k1 这个 @k2 好看', attachments: [] } });
    useStore.getState().removeRef('k1');
    expect(useStore.getState().composer.draft).toBe('看 这个 @k2 好看');
  });
});

test('resetComposer 清空 draft 与 attachments', () => {
  useStore.setState({ composer: { draft: '@k1 你好', attachments: [{ id: 'a', name: 'x.png', mime: 'image/png', kind: 'image', status: 'ready' }] } });
  useStore.getState().resetComposer();
  expect(useStore.getState().composer).toEqual({ draft: '', attachments: [] });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/store/composer-mention.test.ts`
Expected: FAIL(此时 `addRef`/`removeRef` 仍是旧的 `refs` 数组语义,`composer.draft` 不会被改写)

- [ ] **Step 3: 修改 `src/store/index.ts`**

在文件顶部 import 区(紧邻其它 `@/lib/*` import)追加:

```ts
import { insertMentionRef, removeMentionKey } from '@/lib/refs';
```

第 41 行 `ComposerState` 定义:

```ts
// 旧:export interface ComposerState { draft: string; refs: string[]; attachments: ChatAttachment[]; }
export interface ComposerState { draft: string; attachments: ChatAttachment[]; }
```

第 162 行初始状态:

```ts
// 旧:composer: { draft: '', refs: [], attachments: [] },
composer: { draft: '', attachments: [] },
```

第 360-369 行 action 定义,整段替换为:

```ts
      composerSet: (patch) => set((s) => ({ composer: { ...s.composer, ...patch } })),
      addRef: (key) => set((s) => ({ composer: { ...s.composer, draft: insertMentionRef(s.composer.draft, key) } })),
      removeRef: (key) => set((s) => ({ composer: { ...s.composer, draft: removeMentionKey(s.composer.draft, key) } })),
      resetComposer: () => set({ composer: { draft: '', attachments: [] } }),
```

第 429 行 partialize:

```ts
// 旧:composer: { draft: s.composer.draft, refs: s.composer.refs, attachments: [] },
composer: { draft: s.composer.draft, attachments: [] },
```

- [ ] **Step 4: 修复因 `ComposerState` 收紧而报错的既有测试字面量**

`src/client/useProjectBootstrap.test.tsx:29`、`src/store/studio-prelude.test.ts:28`、`src/store/studio-remix.test.ts:33` 三处均为同一行文本,原样出现在三个文件里:

```ts
    composer: { draft: '', refs: [], attachments: [] }, selectedModel: null, availableModels: [],
```

三处均改为:

```ts
    composer: { draft: '', attachments: [] }, selectedModel: null, availableModels: [],
```

`src/store/actions.test.ts` 四处:

```ts
// 1473 行
useStore.setState({ currentProjectId: 7, assets: [], composer: { draft: '', refs: [], attachments: [] } });
// →
useStore.setState({ currentProjectId: 7, assets: [], composer: { draft: '', attachments: [] } });

// 1488 行
useStore.setState({ currentProjectId: 7, composer: { draft: '', refs: [], attachments: [] } });
// →
useStore.setState({ currentProjectId: 7, composer: { draft: '', attachments: [] } });

// 1498 行
composer: { draft: '', refs: [], attachments: [{ id: 'x', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' }] },
// →
composer: { draft: '', attachments: [{ id: 'x', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' }] },

// 1508 行
composer: { draft: '', refs: [], attachments: [{ id: 'y', name: 'a.png', mime: 'image/png', kind: 'image', status: 'uploading' }] },
// →
composer: { draft: '', attachments: [{ id: 'y', name: 'a.png', mime: 'image/png', kind: 'image', status: 'uploading' }] },
```

- [ ] **Step 5: 运行本任务改动到的测试文件确认通过**

Run: `pnpm exec vitest run src/store/composer-mention.test.ts src/client/useProjectBootstrap.test.tsx src/store/studio-prelude.test.ts src/store/studio-remix.test.ts src/store/actions.test.ts`
Expected: PASS(全部通过)。注意:此时 `Composer.tsx`/`AttachmentBar.tsx`(Task 3/4 才改)仍引用已被移除的 `composer.refs` 字段,`pnpm exec tsc --noEmit` 此刻会报错——这是预期的中间态,留给 Task 3/4 消除,不在本步处理;全量类型检查统一在 Task 8 做。

- [ ] **Step 6: Commit**

```bash
git add src/store/index.ts src/store/composer-mention.test.ts src/client/useProjectBootstrap.test.tsx src/store/studio-prelude.test.ts src/store/studio-remix.test.ts src/store/actions.test.ts
git commit -m "refactor: composer.refs 退役,addRef/removeRef 改为直接改写草稿"
```

---

### Task 3: `Composer.tsx` 内联 mention 渲染与发送替换

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Test: `src/components/chat/Composer.test.tsx`

**Interfaces:**
- Consumes: `canMention`、`applyMentionTokens`、`splitMentionTokens`(Task 1,`@/lib/refs`)
- Produces: 无新增导出(纯组件内部改造)

- [ ] **Step 1: 更新 `Composer.test.tsx`**

全文件替换以下几处(其余测试逐字保留):

1. `beforeEach` 里的 `useStore.setState` 调用,把 `composer: { draft: '', refs: [], attachments: [] }` 改为 `composer: { draft: '', attachments: [] }`(全文件出现多次,`replace_all`)。

2. 把测试「仅有资产引用(无草稿)→ 也是可发送 active 态」整段替换:

```ts
test('草稿仅含 @引用(无其它文字)→ 也是可发送 active 态', () => {
  useStore.setState({ composer: { draft: '@k1 ', attachments: [] } });
  render(<Composer client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Send' }).className).toContain('btn-raised-active');
});
```

3. 在文件末尾(`skill 内联胶囊`describe 块之后)追加新 describe 块:

```ts
describe('mention 内联胶囊(草稿内 @key 着色)', () => {
  const asset = { id: 'a1', key: 'char-1', label: '主角', kind: 'image' as const, source: 'generated' as const, status: 'ready' as const, position: { x: 0, y: 0 }, preview: { src: 'https://cdn/p/char-1.png' } };

  it('draft 含已知且可提及的 @key 时镜像层渲染 mention 胶囊', () => {
    useStore.setState({ assets: [asset] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    // 光标落在串尾(12):@ 后到光标含空格,getActiveMention 返回 null,不触发候选弹窗,只验证镜像层着色
    fireEvent.change(ta, { target: { value: '改 @char-1 更红', selectionStart: 12 } });
    const pill = screen.getByTestId('mention-pill');
    expect(pill).toHaveTextContent('@char-1');
  });

  it('资产未就绪(不可提及)时不渲染 mention 胶囊', () => {
    useStore.setState({ assets: [{ ...asset, status: 'generating' as const }] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    // 光标落在串尾(12):@ 后到光标含空格,getActiveMention 返回 null,不触发候选弹窗,只验证镜像层着色
    fireEvent.change(ta, { target: { value: '改 @char-1 更红', selectionStart: 12 } });
    expect(screen.queryByTestId('mention-pill')).not.toBeInTheDocument();
  });

  it('从候选弹窗选中 → 在光标处插入 @key(替换正在输入的 @query),而非追加到末尾', () => {
    useStore.setState({ assets: [asset], composer: { draft: '前面文字 @c 后面文字', attachments: [] } });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    // 光标紧跟在 "@c" 之后(索引 7,c 后、空格前),getActiveMention 才会激活 query='c'
    fireEvent.change(ta, { target: { value: '前面文字 @c 后面文字', selectionStart: 7 } });
    fireEvent.mouseDown(screen.getByText('主角'));
    expect(useStore.getState().composer.draft).toBe('前面文字 @char-1  后面文字');
  });

  it('发送时把草稿中的 @key 原位替换为 @[type]<url>', () => {
    useStore.setState({ assets: [asset], composer: { draft: '改 @char-1 更红', attachments: [] } });
    const { ref, sendUserMessage } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
    expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: '改 @[image]<https://cdn/p/char-1.png> 更红' });
  });

  it('运行中 steer 发送同样替换 @key', () => {
    useStore.setState({ assets: [asset], composer: { draft: '改 @char-1 更红', attachments: [] }, runStatus: 'running' });
    const { ref, steer } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
    expect(steer).toHaveBeenCalledWith('改 @[image]<https://cdn/p/char-1.png> 更红');
  });
});
```

- [ ] **Step 2: 运行测试确认新用例失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: FAIL —— 新 describe 块用例失败(`mention-pill` 不存在、点选后仍追加到末尾、发送后文本未替换);其余用例因 Task 2 已完成对 `refs` 字段的清理而应已通过。

- [ ] **Step 3: 修改 `src/components/chat/Composer.tsx`**

导入区(第 7 行)替换:

```ts
// 旧:import { getActiveMention, refToken } from '@/lib/refs';
import { getActiveMention, canMention, applyMentionTokens, splitMentionTokens } from '@/lib/refs';
```

组件顶部(第 22-43 行区域)改动:

```ts
export default function Composer({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const { draft, attachments } = useStore((s) => s.composer);
  const composerSet = useStore((s) => s.composerSet);
  const resetComposer = useStore((s) => s.resetComposer);
  const setError = useStore((s) => s.setError);
  const pushUserMessage = useStore((s) => s.pushUserMessage);
  const runStatus = useStore((s) => s.runStatus);
  const autoSendArmed = useStore((s) => s.autoSendArmed);
  const setAutoSendArmed = useStore((s) => s.setAutoSendArmed);
  const connStatus = useStore((s) => s.connStatus);
  const assets = useStore((s) => s.assets);
  const mentionKeys = assets.filter(canMention).map((a) => a.key);
  const canOpenMention = mentionKeys.length > 0; // 无可提及资产时 @ 按钮禁用
  const { t } = useTranslation();
  const dark = useIsDark();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const skills = useStore((s) => s.skills);
  const [slash, setSlash] = useState<ActiveSlash | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
```

(移除了 `refs`/`addRef` 解构、旧的 `assetCount`/`canMention` 布尔变量;新增反应式 `assets`/`mentionKeys`/`canOpenMention`。)

`onChange` 函数不变。

`segments` 计算(原第 61 行)改为合并 skill 与 mention 分段:

```ts
  const segments = splitSkillTokens(draft, skills).flatMap((seg) =>
    seg.kind === 'skill' ? [seg] : splitMentionTokens(seg.text, mentionKeys),
  );
```

`pickMention`(原第 76-85 行)整段替换:

```ts
  const pickMention = (key: string) => {
    if (!mention) return;
    const cur = useStore.getState().composer.draft;
    const next = cur.slice(0, mention.start) + '@' + key + ' ' + cur.slice(mention.start + 1 + mention.query.length);
    composerSet({ draft: next });
    setMention(null);
    taRef.current?.focus();
  };
```

`startMention`(原第 87-95 行)把变量名 `canMention` 改为 `canOpenMention`:

```ts
  const startMention = () => {
    if (!canOpenMention) return; // 无可提及资产:按钮已 disabled,此处再防御一次
    // 已有激活的 @ 引用时重复点击不再追加符号,仅保持菜单打开;校验 mention 位置防止 draft 已被外部清空的陈旧状态
    if (!(mention && draft[mention.start] === '@')) {
      composerSet({ draft: draft + '@' });
      setMention({ query: '', start: draft.length });
    }
    taRef.current?.focus();
  };
```

`send`(原第 108-142 行)整段替换:

```ts
  const send = () => {
    if (attachments.some((a) => a.status === 'uploading')) return; // 上传未完成:禁止发送(覆盖回车直发路径)
    const bubbleText = applyMentionTokens(draft.trim(), assets);
    const ready = attachments.filter((a) => a.status === 'ready' && a.url);
    if (!bubbleText && ready.length === 0) return; // 空内容拦截

    const mediaParts = ready.map((a) => ({ type: 'media' as const, kind: a.kind, url: a.url!, name: a.name }));
    pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [...mediaParts, { type: 'text', text: bubbleText }] });

    // 图片 / PDF 走原生 Anthropic 内容块(image / document,URL 源),模型直接理解。
    // 视频/音频模型不能原生处理:URL 折进文本(@token,与 @提及引用同形,agent 经 understand_media 理解)。
    const textFolded = ready.filter((a) => a.kind !== 'image' && a.mime !== 'application/pdf');
    const koubouText = [bubbleText, ...textFolded.map((a) => '@' + a.url)].filter(Boolean).join(' ');
    if (runStatus === 'running') {
      if (koubouText) client.current?.steer(koubouText); // 仅文本可 steer;空文本(纯媒体块此轮)不空发打断
    } else {
      const imageBlocks = ready
        .filter((a) => a.kind === 'image')
        .map((a) => ({ type: 'image', source: { type: 'url', url: a.url } }));
      const documentBlocks = ready
        .filter((a) => a.mime === 'application/pdf')
        .map((a) => ({ type: 'document', source: { type: 'url', url: a.url } }));
      const mediaBlocks = [...imageBlocks, ...documentBlocks];
      const content: string | ContentBlock[] = mediaBlocks.length
        ? ([...(koubouText ? [{ type: 'text', text: koubouText }] : []), ...mediaBlocks] as ContentBlock[])
        : koubouText;
      client.current?.sendUserMessage({ role: 'user', content });
    }
    resetComposer();
  };
```

`canSend` 计算(原第 161 行)去掉 `refs.length` 条件:

```ts
  const canSend = !uploading && (draft.trim().length > 0 || hasReady);
```

`@` 按钮的 `disabled`(原第 246 行)与镜像层的 `segments.map(...)` 表达式(原第 179-186 行,不含其后的 `{'\n'}` 与 `</div>`)分别改为:

```tsx
                disabled={!canOpenMention}
```

```tsx
            {segments.map((seg, i) =>
              seg.kind === 'skill' ? (
                <span key={i} data-testid="skill-pill" className="rounded-[4px] bg-[var(--color-teal-soft)]">{seg.text}</span>
              ) : seg.kind === 'mention' ? (
                <span key={i} data-testid="mention-pill" className="rounded-[4px] bg-[var(--color-teal-soft)]">{seg.text}</span>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
```

其余代码(JSX 结构、`onFiles`、landing prelude 自动发送 effect 等)不变。

- [ ] **Step 4: 运行测试确认全部通过**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: PASS(全部用例,含新增 mention 描述块)

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: Composer 内联 @key 胶囊,发送时替换为 @[type]<url>"
```

---

### Task 4: `AttachmentBar.tsx` refs 派生化

**Files:**
- Modify: `src/components/chat/AttachmentBar.tsx`
- Test: `src/components/chat/AttachmentBar.test.tsx`

**Interfaces:**
- Consumes: `resolveMentionRefs`(Task 1,`@/lib/refs`)、`removeRef`(Task 2,store action,已改写为改写草稿)

- [ ] **Step 1: 更新 `AttachmentBar.test.tsx`**

整文件替换为:

```ts
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AttachmentBar from './AttachmentBar';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [] }, assets: [] }));
afterEach(cleanup);

test('无引用无附件 → 不渲染', () => {
  const { container } = render(<AttachmentBar />);
  expect(container.firstChild).toBeNull();
});

test('草稿含可提及资产的 @key → 显示资产名 chip,移除后草稿清空', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: '/bg.png' } }],
    composer: { draft: '@k1', attachments: [] },
  });
  render(<AttachmentBar />);
  expect(screen.getByText('背景图')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Remove reference' }).click();
  expect(useStore.getState().composer.draft).toBe('');
});

test('资产引用有预览图 → 显示缩略图(走共享 AssetChip)', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: '/bg.png' } }],
    composer: { draft: '@k1', attachments: [] },
  });
  const { container } = render(<AttachmentBar />);
  expect(container.querySelector('img[src="/bg.png"]')).not.toBeNull();
});

test('草稿含未就绪资产的 @key → 不显示引用 chip(不可提及)', () => {
  useStore.setState({
    assets: [{ id: 'i', key: 'k1', label: '背景图', kind: 'image', source: 'generated', status: 'generating', position: { x: 0, y: 0 } }],
    composer: { draft: '@k1', attachments: [] },
  });
  const { container } = render(<AttachmentBar />);
  expect(container.firstChild).toBeNull();
});

test('就绪图片附件 chip 显示缩略图与文件名,可移除', () => {
  useStore.setState({ composer: { draft: '', attachments: [{ id: 'a1', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png' }] } });
  const { container } = render(<AttachmentBar />);
  expect(screen.getByText('a.png')).toBeInTheDocument();
  expect(container.querySelector('img[src="http://x/a.png"]')).not.toBeNull();
  screen.getByRole('button', { name: 'Remove attachment' }).click();
  expect(useStore.getState().composer.attachments).toEqual([]);
});

test('上传中附件显示 spinner', () => {
  useStore.setState({ composer: { draft: '', attachments: [{ id: 'u', name: 'b.png', mime: 'image/png', kind: 'image', status: 'uploading' }] } });
  render(<AttachmentBar />);
  expect(screen.getByRole('status', { name: 'Uploading' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/AttachmentBar.test.tsx`
Expected: FAIL(组件仍读取已不存在的 `composer.refs`,TS 编译错误 + 断言失败)

- [ ] **Step 3: 修改 `src/components/chat/AttachmentBar.tsx`**

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { resolveMentionRefs } from '@/lib/refs';
import AssetChip, { Chip, MediaThumb } from './AssetChip';

// 草稿待发送区:@ 资产引用(从草稿派生,与正文内 @key 单一真相)+ 上传附件(按 kind 缩略图 + 上传/错误态)
export default function AttachmentBar() {
  const { t } = useTranslation();
  const draft = useStore((s) => s.composer.draft);
  const attachments = useStore((s) => s.composer.attachments);
  const assets = useStore((s) => s.assets);
  const removeRef = useStore((s) => s.removeRef);
  const removeChatAttachment = useStore((s) => s.removeChatAttachment);
  const refs = resolveMentionRefs(draft, assets);
  if (refs.length === 0 && attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {refs.map((r) => (
        <AssetChip key={r} assetKey={r} onRemove={() => removeRef(r)} />
      ))}
      {attachments.map((a) => (
        <Chip
          key={a.id}
          label={a.name}
          removeLabel={t('chat.attachment.remove')}
          onRemove={() => removeChatAttachment(a.id)}
          icon={
            a.status === 'uploading' ? (
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
                role="status"
                aria-label={t('chat.attachment.uploading')}
              />
            ) : a.status === 'error' ? (
              <span className="text-[12px] font-semibold text-[var(--color-teal)]" aria-label={t('chat.attachment.uploadFailed')}>!</span>
            ) : (
              <MediaThumb kind={a.kind} src={a.url} />
            )
          }
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `pnpm exec vitest run src/components/chat/AttachmentBar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/AttachmentBar.tsx src/components/chat/AttachmentBar.test.tsx
git commit -m "refactor: AttachmentBar 资产引用 chip 改由草稿派生"
```

---

### Task 5: `MentionPopover.tsx` 候选按 eligibility 过滤

**Files:**
- Modify: `src/components/chat/MentionPopover.tsx`
- Test: `src/components/chat/MentionPopover.test.tsx`

**Interfaces:**
- Consumes: `canMention`(Task 1,`@/lib/refs`)

- [ ] **Step 1: 更新 `MentionPopover.test.tsx`**

整文件替换为:

```tsx
import { describe, expect, test, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';
import MentionPopover from './MentionPopover';

// 默认工厂:就绪 + 有 preview.src(可提及),覆盖 status/preview 即可造出不可提及场景
const asset = (over: Partial<Asset> = {}): Asset =>
  ({ id: 'a1', key: 'sky.png', label: 'Sky', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://x/sky.png' }, ...over } as Asset);

afterEach(cleanup);

describe('MentionPopover 空态反馈', () => {
  test('无任何资产:显示引导文案', () => {
    useStore.setState({ assets: [] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/generate some on the canvas/i)).toBeInTheDocument();
  });
  test('有资产但 query 无匹配:显示 No matches', () => {
    useStore.setState({ assets: [asset()] });
    render(<MentionPopover query="zzz" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('匹配项超过 8 个:全部列出,不被硬截断(靠滚动区容纳)', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      asset({ id: `a${i}`, key: `img${i}.png`, label: `Img ${i}`, preview: { src: `https://x/img${i}.png` } }),
    );
    useStore.setState({ assets: many });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(12);
  });
});

describe('MentionPopover 候选过滤(eligibility)', () => {
  test('未就绪资产不进候选', () => {
    useStore.setState({ assets: [asset({ status: 'generating' })] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('无 preview.src 的资产不进候选', () => {
    useStore.setState({ assets: [asset({ preview: undefined })] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
  test('就绪且有 preview.src 的资产进候选', () => {
    useStore.setState({ assets: [asset()] });
    render(<MentionPopover query="" onPick={() => {}} />);
    expect(screen.getByText('Sky')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认新用例失败**

Run: `pnpm exec vitest run src/components/chat/MentionPopover.test.tsx`
Expected: FAIL(新「候选过滤」describe 块中未就绪/无 preview 场景仍会出现在候选里)

- [ ] **Step 3: 修改 `src/components/chat/MentionPopover.tsx`**

```tsx
'use client';
import { useStore } from '@/store';
import { canMention } from '@/lib/refs';
import { AssetThumb } from './AssetChip';

export default function MentionPopover({
  query,
  onPick,
}: {
  query: string;
  onPick: (key: string) => void;
}) {
  const assets = useStore((s) => s.assets);
  // 候选仅列可提及资产(就绪且有后端预览地址);不硬截断,超出高度交给容器滚动区(max-h-56 + overflow-auto)承载
  const list = assets
    .filter(canMention)
    .filter((a) => (a.key + a.label).toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="anim-pop-in origin-bottom-left scrollbar-auto absolute bottom-full mb-1 flex max-h-56 w-64 flex-col gap-0.5 overflow-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
      {list.length === 0 ? (
        <div className="px-2 py-1.5 text-sm leading-5 text-[var(--color-muted)]">
          {assets.length === 0
            ? 'No assets yet — generate some on the canvas to @mention them'
            : 'No matches'}
        </div>
      ) : (
        list.map((a) => (
          <button
            key={a.id}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(a.key);
            }}
            className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-fill)]">
              <AssetThumb asset={a} />
            </span>
            <span className="truncate">{a.label}</span>
          </button>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `pnpm exec vitest run src/components/chat/MentionPopover.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/MentionPopover.tsx src/components/chat/MentionPopover.test.tsx
git commit -m "feat: MentionPopover 候选按 ready+preview.src 过滤"
```

---

### Task 6: `ContextMenu.tsx`「引用到对话」禁用态

**Files:**
- Modify: `src/components/canvas/ContextMenu.tsx`
- Test: `src/components/canvas/ContextMenu.test.tsx`

**Interfaces:**
- Consumes: `canMention`(Task 1,`@/lib/refs`)、`addRef`(Task 2,store action,已改写为追加到草稿末尾)

- [ ] **Step 1: 追加失败测试**

在 `src/components/canvas/ContextMenu.test.tsx` 的 `describe('ContextMenu', ...)` 块内、`'多选:仅显示「删除 N 项」...'` 测试之前插入两个新用例:

```ts
  test('资产无 preview.src → Use as reference 项禁用,点击不改写草稿', () => {
    seed(); // makeAsset 无 preview → 不可提及
    useStore.setState({ composer: { draft: '', attachments: [] } });
    const { getByText } = render(<ContextMenu />);
    const btn = getByText('Use as reference').closest('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(useStore.getState().composer.draft).toBe('');
  });

  test('资产有 preview.src → Use as reference 项可点击,追加 @key 到草稿末尾并关闭菜单', () => {
    const asset = makeAsset('image', { label: '背景', preview: { src: 'https://x/bg.png' } });
    useStore.setState({
      assets: [asset],
      contextMenu: { ids: [asset.id], x: 10, y: 10 },
      composer: { draft: '', attachments: [] },
    } as never);
    const { getByText } = render(<ContextMenu />);
    fireEvent.click(getByText('Use as reference'));
    expect(useStore.getState().composer.draft).toBe(`@${asset.key} `);
    expect(useStore.getState().contextMenu).toBeNull();
  });
```

- [ ] **Step 2: 运行测试确认新用例失败**

Run: `pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx`
Expected: FAIL(菜单项当前始终可点击,无 `disabled` 属性)

- [ ] **Step 3: 修改 `src/components/canvas/ContextMenu.tsx`**

导入区追加:

```ts
import { canMention } from '@/lib/refs';
```

`items` 类型标注与「Use as reference」项:

```tsx
  const items: { icon: string; label: string; onClick: () => void; disabled?: boolean }[] = multi
    ? [
        {
          icon: figAsset.trash,
          label: t('canvas.context.deleteN', { count: menu.ids.length }),
          onClick: () => {
            openDeleteModal(menu.ids);
            close(null);
          },
        },
      ]
    : [
        {
          icon: figAsset.at,
          label: t('canvas.context.useAsRef'),
          disabled: !canMention(asset!),
          onClick: () => {
            addRef(asset!.key);
            close(null);
          },
        },
```

(其余 `items` 数组元素——Rename/Download/Delete——不变。)

菜单按钮渲染(原第 91-104 行):

```tsx
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.onClick}
            disabled={it.disabled}
            className={`flex h-10 items-center gap-3 self-stretch rounded-[12px] py-1 pl-1 pr-3 text-left transition-colors ${it.disabled ? 'opacity-40' : 'hover:bg-[var(--color-fill)]'}`}
          >
            <span className="grid size-8 shrink-0 place-items-center">
              <FigIcon src={it.icon} size={20} tone="primary" />
            </span>
            <span className="flex-1 text-[12px] font-semibold leading-4 tracking-[-0.12px] text-[var(--color-ink)]">
              {it.label}
            </span>
          </button>
        ))}
```

- [ ] **Step 4: 运行测试确认全部通过**

Run: `pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx`
Expected: PASS(含既有「菜单项图标均用 ink 色」等用例——禁用态只加 `opacity-40`,不改变图标 tone,不受影响)

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/ContextMenu.tsx src/components/canvas/ContextMenu.test.tsx
git commit -m "feat: 画布右键引用到对话按 eligibility 禁用"
```

---

### Task 7: `MessageItem` 新格式回归测试

**Files:**
- Test: `src/components/chat/MessageItem.test.tsx`(仅新增用例,无生产代码改动——`extractRefs` 签名不变,Task 1 已在纯函数层扩展新格式识别)

- [ ] **Step 1: 追加测试**

在 `src/components/chat/MessageItem.test.tsx` 第 119 行(「用户消息:已知 @key 渲染为 chip」测试结束)之后插入:

```tsx
test('用户消息:新格式 @[type]<url> 渲染为 chip 且正文剥离引用', () => {
  useStore.setState({ assets: [{ id: 'i', key: 'char-1', label: '主角', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://cdn/p/char-1.png' } }] });
  const m: Message = { id: 'u2b', role: 'user', status: 'ready', parts: [{ type: 'text', text: '让 @[image]<https://cdn/p/char-1.png> 更红' }] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('主角')).toBeInTheDocument(); // chip 标签
  expect(screen.getByText('让 更红')).toBeInTheDocument(); // 正文已剥离新格式 token
});
```

- [ ] **Step 2: 运行测试确认通过(无需生产代码改动)**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: PASS —— `extractRefs` 已在 Task 1 支持新格式,`MessageItem.tsx` 无需改动即可通过

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageItem.test.tsx
git commit -m "test: MessageItem 补新格式 mention token 回归用例"
```

---

### Task 8: 全量验证

**Files:** 无代码改动,仅验证

- [ ] **Step 1: 全量类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: 全量 lint**

Run: `pnpm lint`
Expected: 无错误

- [ ] **Step 3: 全量测试**

Run: `pnpm exec vitest run`
Expected: 全部通过,数量应比 Task 开始前的 1321 条只增不减(新增 refs.test.ts / composer-mention.test.ts / 各组件新用例)

- [ ] **Step 4: 全量构建**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 5: 手动核对 grep 清单——确认无遗留 `composer.refs` / `refToken` 引用**

Run: `grep -rn "composer\.refs\|refToken" src --include='*.ts*'`
Expected: 无匹配(全部已迁移到派生逻辑;`refToken` 已删除)

若以上全部通过,本功能实现完毕,可进入 `superpowers:requesting-code-review` 或直接触发 `superpowers:finishing-a-development-branch` 收尾合并流程。
