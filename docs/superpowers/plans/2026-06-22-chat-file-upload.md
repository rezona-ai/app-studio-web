# 对话窗文件上传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话窗支持上传图片/视频/音频附件,复用画布上传端点拿 URL,图片以 image url 内容块、视频/音频以 URL 折进文本发给 koubou,并在用户消息气泡内按类型显示缩略图。

**Architecture:** 上传走既有 `uploadCanvasItem`(画布上传端点),上传后 PATCH `reference.chat_attachment=true` 标记;`loadCanvas` 的列表映射器据标记过滤,使其不上画布(仅对话内显示)。附件态进 `composer.attachments`(改为带上传态的 `ChatAttachment[]`),上传/移除作为 store action(放 `index.ts`,沿用 `loadOlderMessages` 在 index 做异步 IO 的先例,以便直接访问 UIState 的 `composer`)。消息渲染新增 `media` part,复用从 `AssetThumb` 抽出的 `MediaThumb` 基元。

**Tech Stack:** Next 16 / React 19 / zustand / @xyflow / Vitest(jsdom + globals)/ Tailwind v4。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**。
- 颜色 / 圆角 / 阴影 / 字号一律走 `globals.css` 既有 CSS 变量与令牌,**禁止硬编码色值**;图标一律用 `FigIcon`;不造新按钮/ toast 组件。
- 自身绝对路径(fetch/WebSocket/img)必经 `apiPath()`/`assetPath()`;本计划用的是 `pgcApi`(已内置 `apiPath`)与 `resolveAssetUrl`(已拼 PGC 前缀),勿另写裸路径。
- 纯函数下沉 `lib/`、单测同目录;`await` 后必校验 `currentProjectId`;轮询/重连**不得**覆盖前端已落位的 `position`(本计划不碰画布坐标)。
- 尊重后端契约:`reference` 是后端原样回显的元数据(同 `source_filename`/`parent_id`),新增键 `chat_attachment` 在契约内;不臆测其它字段。
- koubou WS `user.message` 仅支持 `text` / `image` 内容块,`image` source 为 `base64` 或 `{type:'url',url}`(URL 须公网可达);无 `video`/`audio` 块。
- 运行验证命令:`pnpm exec tsc --noEmit`、`pnpm exec vitest run <file>`、`pnpm lint`。

---

### Task 1: upload-policy 扩展(放行 image/video/audio + 拒绝文案泛化)

**Files:**
- Modify: `src/lib/upload-policy.ts`
- Test: `src/lib/upload-policy.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `UPLOAD_POLICY.chat` 现放行 image+video+audio;`VIDEO_MIMES`/`AUDIO_MIMES` 常量(模块内即可,不必导出);`rejectMessage` type 文案不再写死 "images"。

- [ ] **Step 1: 写失败测试**

在 `src/lib/upload-policy.test.ts` 追加:

```ts
test('chat 策略放行视频/音频,拒绝其它类型', () => {
  const mp4 = new File([new Uint8Array(10)], 'a.mp4', { type: 'video/mp4' });
  const mp3 = new File([new Uint8Array(10)], 'a.mp3', { type: 'audio/mpeg' });
  const pdf = new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
  const { accepted, rejected } = validateUpload([mp4, mp3, pdf], UPLOAD_POLICY.chat);
  expect(accepted).toEqual([mp4, mp3]);
  expect(rejected).toEqual([{ file: pdf, reason: 'type' }]);
});

test('类型拒绝文案泛化(不写死 images are allowed)', () => {
  const pdf = new File([], 'a.pdf', { type: 'application/pdf' });
  const msg = rejectMessage([{ file: pdf, reason: 'type' }], UPLOAD_POLICY.chat);
  expect(msg).toContain('Unsupported file type');
  expect(msg).not.toContain('images are allowed');
});
```

(若文件顶部未导入 `UPLOAD_POLICY` / `rejectMessage` / `validateUpload`,补进现有 import。)

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/lib/upload-policy.test.ts`
Expected: FAIL(pdf 之外被放行的断言不符 / 文案仍含 "images are allowed")

- [ ] **Step 3: 实现**

在 `src/lib/upload-policy.ts`:

`IMAGE_MIMES` 下方新增:

```ts
// 模型/平台支持的视频、音频格式(与画布上传端点一致:image/video/audio)
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/webm'];
```

`UPLOAD_POLICY` 改为(chat 放行三类、上调上限容纳视频;canvas 不动):

```ts
export const UPLOAD_POLICY: Record<UploadSurface, UploadPolicy> = {
  chat: { accept: [...IMAGE_MIMES, ...VIDEO_MIMES, ...AUDIO_MIMES], maxBytes: 100 * MB },
  canvas: { accept: IMAGE_MIMES, maxBytes: 10 * MB },
};
```

`MIME_LABELS` 补常见条目(其余走子类型大写回退):

```ts
const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/gif': 'GIF', 'image/webp': 'WebP',
  'video/mp4': 'MP4', 'video/webm': 'WebM', 'video/quicktime': 'MOV',
  'audio/mpeg': 'MP3', 'audio/wav': 'WAV', 'audio/ogg': 'OGG', 'audio/aac': 'AAC',
};
```

`rejectMessage` 内 type 分支文案改为(去掉 "images" 假定):

```ts
  if (rejected.some((r) => r.reason === 'type')) {
    parts.push(`Unsupported file type (${names('type')}). Allowed: ${formatList(policy.accept)}.`);
  }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/lib/upload-policy.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/upload-policy.ts src/lib/upload-policy.test.ts
git commit -m "feat: 对话窗上传策略放行图片/视频/音频,拒绝文案泛化"
```

---

### Task 2: `mimeToAssetKind`(MIME → AssetKind)

**Files:**
- Modify: `src/lib/media-import.ts`
- Test: `src/lib/media-import.test.ts`

**Interfaces:**
- Consumes: `AssetKind`(已在该文件导入)
- Produces: `export function mimeToAssetKind(mime: string): AssetKind`(image|video|audio,其余回退 image)

- [ ] **Step 1: 写失败测试**

在 `src/lib/media-import.test.ts` 追加(若无该测试文件则新建,顶部 `import { mimeToAssetKind } from './media-import';`):

```ts
test('mimeToAssetKind 按 MIME 主类型映射,未知回退 image', () => {
  expect(mimeToAssetKind('image/png')).toBe('image');
  expect(mimeToAssetKind('video/mp4')).toBe('video');
  expect(mimeToAssetKind('audio/mpeg')).toBe('audio');
  expect(mimeToAssetKind('application/pdf')).toBe('image');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/lib/media-import.test.ts`
Expected: FAIL("mimeToAssetKind is not a function")

- [ ] **Step 3: 实现**

在 `src/lib/media-import.ts` 的 `mediaKindToAssetKind` 附近新增:

```ts
// 文件 MIME → 画布 AssetKind(对话窗上传只产生 image/video/audio;未知回退 image)
export function mimeToAssetKind(mime: string): AssetKind {
  const top = mime.split('/')[0];
  if (top === 'video') return 'video';
  if (top === 'audio') return 'audio';
  return 'image';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/lib/media-import.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/media-import.ts src/lib/media-import.test.ts
git commit -m "feat: 新增 mimeToAssetKind(MIME→AssetKind)"
```

---

### Task 3: `loadCanvas` 过滤 chat_attachment 标记 item

**Files:**
- Modify: `src/lib/pgc/map.ts`
- Test: `src/lib/pgc/map.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `CanvasReference` 增 `chat_attachment?: boolean`;`canvasItemsToAssets` 过滤标记项(`canvasItemToAsset` 单项映射不变)。

- [ ] **Step 1: 写失败测试**

在 `src/lib/pgc/map.test.ts` 追加:

```ts
test('canvasItemsToAssets 过滤掉 reference.chat_attachment 的 item', () => {
  const items: CanvasItemData[] = [
    { id: 1, item_id: 'keep', type: 'image', status: 'ready', url: '/p/a.png', reference: { position: { x: 1, y: 2 } } },
    { id: 2, item_id: 'hide', type: 'image', status: 'ready', url: '/p/b.png', reference: { chat_attachment: true } },
  ];
  expect(canvasItemsToAssets(items).map((a) => a.id)).toEqual(['keep']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: FAIL(返回包含 'hide')

- [ ] **Step 3: 实现**

`src/lib/pgc/map.ts`:`CanvasReference` 接口加字段:

```ts
  source_filename?: string;  // 自动导入溯源
  chat_attachment?: boolean;  // 对话窗上传附件:仅对话内显示,loadCanvas 据此过滤,不上画布
  [k: string]: unknown;
```

`canvasItemsToAssets` 在 `.map` 前加 `.filter`:

```ts
export function canvasItemsToAssets(items: CanvasItemData[]): Asset[] {
  let fallbackIdx = 0;
  return items
    .filter((it) => !((it.reference ?? {}) as CanvasReference).chat_attachment)
    .map((it) => {
      const a = canvasItemToAsset(it);
      return hasCanvasCoord(it) ? a : { ...a, position: cascadePosition({ x: 0, y: 0 }, fallbackIdx++) };
    });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/map.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/pgc/map.ts src/lib/pgc/map.test.ts
git commit -m "feat: loadCanvas 映射器过滤 chat_attachment 标记 item(对话上传不上画布)"
```

---

### Task 4: 抽出 `MediaThumb` 基元(AssetChip)

**Files:**
- Modify: `src/components/chat/AssetChip.tsx`
- Test: `src/components/chat/AssetChip.test.tsx`

**Interfaces:**
- Consumes: `KIND_META`(已导入)、`AssetKind`
- Produces: `export function MediaThumb({ kind, src, iconSize }: { kind: AssetKind; src?: string; iconSize?: number })`;`AssetThumb` 改为委托 `MediaThumb`(对外行为不变)。

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/AssetChip.test.tsx` 追加(顶部确保 `import { MediaThumb } from './AssetChip';` 与 `import { render } from '@testing-library/react';`):

```ts
test('MediaThumb 图片渲染 <img>(原 src)', () => {
  const { container } = render(<MediaThumb kind="image" src="http://x/a.png" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('http://x/a.png');
});
test('MediaThumb 视频渲染 <video> 首帧(#t=0.001)', () => {
  const { container } = render(<MediaThumb kind="video" src="http://x/a.mp4" />);
  expect(container.querySelector('video')?.getAttribute('src')).toBe('http://x/a.mp4#t=0.001');
});
test('MediaThumb 音频不渲染 video(回退图标)', () => {
  const { container } = render(<MediaThumb kind="audio" src="http://x/a.mp3" />);
  expect(container.querySelector('video')).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/AssetChip.test.tsx`
Expected: FAIL("MediaThumb is not exported")

- [ ] **Step 3: 实现**

`src/components/chat/AssetChip.tsx`:顶部加 `import type { AssetKind } from '@/lib/asset-kind';`,把 `AssetThumb` 改写为:

```ts
// 媒体缩略图基元:图片直接 <img>;视频复用首帧封面(#t=0.001,同 VideoNode);其余(音频/3D/文档)回退类型图标
// 需放在相对定位的方形贴片容器内使用
export function MediaThumb({ kind, src, iconSize = 16 }: { kind: AssetKind; src?: string; iconSize?: number }) {
  const cover = 'absolute inset-0 size-full object-cover';
  if (src && kind === 'image') return <img src={src} alt="" className={cover} />;
  if (src && kind === 'video') return <video src={`${src}#t=0.001`} muted playsInline preload="metadata" className={cover} />;
  return <FigIcon src={KIND_META[kind].icon} size={iconSize} />;
}

// 资产缩略图:由 store Asset 取 kind/src 后委托 MediaThumb
export function AssetThumb({ asset }: { asset?: Asset }) {
  return <MediaThumb kind={asset?.kind ?? 'image'} src={asset?.preview?.dataUrl ?? asset?.preview?.src} />;
}
```

- [ ] **Step 4: 运行测试确认通过(含原有 AssetChip 用例不回归)**

Run: `pnpm exec vitest run src/components/chat/AssetChip.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/AssetChip.tsx src/components/chat/AssetChip.test.tsx
git commit -m "refactor: 抽出 MediaThumb 基元,AssetThumb 委托(供对话附件复用)"
```

---

### Task 5: `media` part 类型 + MessageItem 气泡渲染

**Files:**
- Modify: `src/store/types.ts`(Part 联合增 media)
- Modify: `src/components/chat/MessageItem.tsx`
- Test: `src/components/chat/MessageItem.test.tsx`

**Interfaces:**
- Consumes: `MediaThumb`(Task 4)
- Produces: `Part` 增 `{ type: 'media'; kind: AssetKind; url: string; name?: string }`;MessageItem 用户气泡渲染 media 缩略图(顺序:media → ref chips → 文本)。

- [ ] **Step 1: 写失败测试**

在 `src/components/chat/MessageItem.test.tsx` 追加(参照该文件现有 import / store 复位写法;`Message` 从 `@/store/types`):

```ts
test('用户消息含 media(图片)part → 气泡渲染缩略图 <img> 与文本', () => {
  useStore.setState({ assets: [] });
  const msg: Message = {
    id: 'm1', role: 'user', status: 'ready',
    parts: [{ type: 'media', kind: 'image', url: 'http://x/a.png', name: 'a.png' }, { type: 'text', text: 'hi' }],
  };
  const { container } = render(<MessageItem message={msg} />);
  expect(container.querySelector('img[src="http://x/a.png"]')).not.toBeNull();
  expect(screen.getByText('hi')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: FAIL(无 media 渲染 / 类型不存在)

- [ ] **Step 3: 实现类型**

`src/store/types.ts` 的 `Part` 联合追加一行:

```ts
export type Part =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'media'; kind: AssetKind; url: string; name?: string }
  | { type: 'tool'; id: string; name: string; input: unknown; status: Status; result?: string; media?: MediaItem[]; diff?: FileDiff };
```

(`AssetKind` 已在 `types.ts` 顶部导入。)

- [ ] **Step 4: 实现 MessageItem 渲染**

`src/components/chat/MessageItem.tsx`:顶部加 `import { MediaThumb } from './AssetChip';`(已 import `AssetChip`,改为 `import AssetChip, { MediaThumb } from './AssetChip';`)。用户分支改为:

```tsx
  if (message.role === 'user') {
    const media = message.parts.filter((p): p is Extract<Part, { type: 'media' }> => p.type === 'media');
    const raw = message.parts
      .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    const { keys, text } = extractRefs(raw, assets);
    const hasContent = media.length > 0 || keys.length > 0 || text.trim().length > 0;
    return (
      <div className="mb-5 flex justify-end pl-6">
        {hasContent && (
          <div className="flex w-fit max-w-full flex-col gap-1 rounded-[12px] bg-[var(--color-fill)] p-3">
            {media.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {media.map((m, i) => (
                  <span
                    key={i}
                    className="relative block size-[72px] overflow-hidden rounded-[12px] bg-[var(--color-surface-2)]"
                    aria-label={m.name}
                  >
                    <MediaThumb kind={m.kind} src={m.url} iconSize={28} />
                  </span>
                ))}
              </div>
            )}
            {keys.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {keys.map((k) => (
                  <AssetChip key={k} assetKey={k} />
                ))}
              </div>
            )}
            {text.trim() && <RichText text={text} className={TEXT} />}
          </div>
        )}
      </div>
    );
  }
```

助手分支 `switch (p.type)` 末尾(在 `case 'tool'` 后)补:

```tsx
          case 'media':
            return null; // 媒体 part 仅出现在用户消息;助手分支占位以满足类型穷尽
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/chat/MessageItem.test.tsx`
Expected: PASS

- [ ] **Step 6: 类型检查(确认 Part 联合扩展未破坏别处穷尽分支)**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/store/types.ts src/components/chat/MessageItem.tsx src/components/chat/MessageItem.test.tsx
git commit -m "feat: 新增 media part 类型,用户消息气泡渲染媒体缩略图"
```

---

### Task 6: 冷启动重建 image 块 → media part(blocksToParts)

**Files:**
- Modify: `src/koubou/apply-koubou.ts`
- Test: `src/koubou/apply-koubou.test.ts`

**Interfaces:**
- Consumes: `Part`(含 media,Task 5)
- Produces: `blocksToParts` 把 `image` 块(url / base64 source)转成 `{ type:'media', kind:'image', url }`。

- [ ] **Step 1: 写失败测试**

在 `src/koubou/apply-koubou.test.ts` 追加(复用文件内已有的 `umsg`/`seq`/`S`):

```ts
test('seedHistory: 用户消息含 image url 块 → media part', () => {
  const ev = umsg([{ type: 'text', text: '看这张' }, { type: 'image', source: { type: 'url', url: 'http://x/a.png' } }], 'evt_img');
  const s = seedHistory(S(), { events: [seq(ev, 10)], has_more: false, latest_sequence: 10 });
  const msg = s.messages.find((m) => m.role === 'user');
  expect(msg?.parts).toContainEqual({ type: 'media', kind: 'image', url: 'http://x/a.png' });
  expect(msg?.parts).toContainEqual({ type: 'text', text: '看这张' });
});

test('seedHistory: image base64 块 → media part(data url)', () => {
  const ev = umsg([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], 'evt_b64');
  const s = seedHistory(S(), { events: [seq(ev, 11)], has_more: false, latest_sequence: 11 });
  const msg = s.messages.find((m) => m.role === 'user');
  expect(msg?.parts).toContainEqual({ type: 'media', kind: 'image', url: 'data:image/png;base64,AAAA' });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: FAIL(image 块被丢弃,无 media part)

- [ ] **Step 3: 实现**

`src/koubou/apply-koubou.ts` 的 `blocksToParts`,在 `tool_use` 分支后、注释 `// tool_result 由 foldResults 处理` 前加 image 分支:

```ts
    else if (b.type === 'image') {
      // koubou 仅支持 image 块;url source 直接用,base64 source 拼成 data url 兜底
      const s = (b as { source?: { type?: string; url?: string; media_type?: string; data?: string } }).source;
      const url = s?.type === 'url' ? s.url
        : s?.type === 'base64' && s.data ? `data:${s.media_type ?? 'image/png'};base64,${s.data}`
        : undefined;
      if (url) parts.push({ type: 'media', kind: 'image', url });
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts
git commit -m "feat: 历史重建把 image 块转成 media part(冷启动显示图片缩略图)"
```

---

### Task 7: 端到端上传(ChatAttachment 模型 + 上传/移除 action + Composer + AttachmentBar)

> 本任务是耦合改动:`ComposerState.attachments` 改型会同时影响 actions、Composer、AttachmentBar,需一并落地才编译通过(中途 tsc 会短暂红,任务末尾全绿)。单次提交。

**Files:**
- Modify: `src/store/types.ts`(新增 `ChatAttachment`)
- Modify: `src/store/index.ts`(`ComposerState.attachments` 改型;新增 `uploadChatAttachment`/`removeChatAttachment` action;import)
- Modify: `src/components/chat/Composer.tsx`(`onFiles` 走上传 action;`send` 重写;`canSend` 禁用上传中)
- Modify: `src/components/chat/AttachmentBar.tsx`(附件 chip 用 MediaThumb + 上传/错误态 + removeChatAttachment)
- Test: `src/store/actions.test.ts`、`src/components/chat/Composer.test.tsx`、`src/components/chat/AttachmentBar.test.tsx`

**Interfaces:**
- Consumes: `uploadCanvasItem`/`pgcApi.updateCanvasReference`/`pgcApi.deleteCanvasItem`(`@/lib/pgc/client`)、`resolveAssetUrl`(`@/lib/pgc/url`)、`mimeToAssetKind`(Task 2)、`validateUpload`/`rejectMessage`/`acceptAttr`/`UPLOAD_POLICY`(Task 1)、`MediaThumb`(Task 4)、`media` part(Task 5)、`ContentBlock`(`@/koubou/protocol`)。
- Produces:
  - `ChatAttachment`(`@/store/types`):`{ id: string; name: string; mime: string; kind: AssetKind; status: 'uploading'|'ready'|'error'; url?: string; itemId?: string }`
  - `uploadChatAttachment(file: File): Promise<void>`、`removeChatAttachment(id: string): void`(store action)

- [ ] **Step 1: 新增 ChatAttachment 类型并改 ComposerState**

`src/store/types.ts` 新增(放 `Part` 附近):

```ts
// 对话窗上传附件的会话内态:后台上传 → 就绪后带 url/itemId;移除时按 itemId 删孤儿
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  kind: AssetKind;
  status: 'uploading' | 'ready' | 'error';
  url?: string;     // resolveAssetUrl 后的绝对 URL:气泡缩略图 + koubou
  itemId?: string;  // 画布 item_id:移除时删孤儿
}
```

`src/store/index.ts`:`import` 段从 `./types` 引入 `ChatAttachment`(并入现有 `from './types'` 的具名导入),把 `ComposerState` 改为:

```ts
export interface ComposerState { draft: string; refs: string[]; attachments: ChatAttachment[]; }
```

- [ ] **Step 2: 声明 action 类型并补 import**

`src/store/index.ts`:`interface Actions` 内、`resetComposer` 附近新增两行:

```ts
  uploadChatAttachment: (file: File) => Promise<void>;
  removeChatAttachment: (id: string) => void;
```

顶部补 import(与现有 import 合并去重):

```ts
import { pgcApi, uploadCanvasItem, PgcError } from '@/lib/pgc/client';
import { resolveAssetUrl } from '@/lib/pgc/url';
import { mimeToAssetKind } from '@/lib/media-import';
```

- [ ] **Step 3: 实现两个 action(在 store 对象内,`resetComposer` 之后)**

```ts
      // 对话窗上传:走画布上传端点拿 URL,标记 chat_attachment(loadCanvas 据此过滤,不上画布),仅对话内显示
      uploadChatAttachment: async (file) => {
        const id = newId('att');
        const pid = get().currentProjectId;
        if (pid == null) return;
        const kind = mimeToAssetKind(file.type);
        const setAtts = (next: ChatAttachment[]) => set((s) => ({ composer: { ...s.composer, attachments: next } }));
        const patch = (p: Partial<ChatAttachment>) =>
          setAtts(get().composer.attachments.map((a) => (a.id === id ? { ...a, ...p } : a)));
        setAtts([...get().composer.attachments, { id, name: file.name, mime: file.type, kind, status: 'uploading' }]);
        try {
          const item = await uploadCanvasItem(pid, file);
          await pgcApi.updateCanvasReference(pid, item.item_id, { chat_attachment: true });
          if (get().currentProjectId !== pid) return; // await 后切项目则丢弃
          patch({ status: 'ready', url: resolveAssetUrl(item.url), itemId: item.item_id });
        } catch (e) {
          if (get().currentProjectId !== pid) return;
          patch({ status: 'error' });
          if (e instanceof PgcError) set({ lastError: { code: e.code, message: e.message } });
          else throw e; // 未知错误照抛,便于发现 bug
        }
      },
      // 移除附件:已上传(未发送)的删孤儿;未就绪/无 itemId 仅本地移除
      removeChatAttachment: (id) => {
        const att = get().composer.attachments.find((a) => a.id === id);
        const pid = get().currentProjectId;
        if (att?.itemId && pid != null) void pgcApi.deleteCanvasItem(pid, att.itemId).catch(() => {});
        set((s) => ({ composer: { ...s.composer, attachments: s.composer.attachments.filter((a) => a.id !== id) } }));
      },
```

- [ ] **Step 4: 重写 Composer 的 onFiles / send / canSend**

`src/components/chat/Composer.tsx`:

顶部 hooks 区新增:

```ts
  const uploadChatAttachment = useStore((s) => s.uploadChatAttachment);
```

`onFiles` 改为(去掉 FileReader,走上传 action):

```ts
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许被拒后重选同名文件
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    if (rejected.length) setError({ code: 'UPLOAD', message: rejectMessage(rejected, UPLOAD_POLICY.chat) });
    accepted.forEach((f) => void uploadChatAttachment(f));
  };
```

`send` 改为(气泡文本与 koubou 文本分离;图片走 image url 块,视频/音频折进文本):

```ts
  const send = () => {
    if (attachments.some((a) => a.status === 'uploading')) return; // 上传未完成:禁止发送(覆盖回车直发路径)
    const assets = useStore.getState().assets;
    const tokens = refs.map((key) => {
      const a = assets.find((x) => x.key === key);
      return '@' + (a ? refToken(a) : key);
    });
    const bubbleText = [draft.trim(), ...tokens].filter(Boolean).join(' ');
    const ready = attachments.filter((a) => a.status === 'ready' && a.url);
    if (!bubbleText && ready.length === 0) return; // 空内容拦截

    const mediaParts = ready.map((a) => ({ type: 'media' as const, kind: a.kind, url: a.url!, name: a.name }));
    pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [...mediaParts, { type: 'text', text: bubbleText }] });

    // 视频/音频无对应内容块:URL 折进文本(@token,与 @提及引用同形,agent 统一当资产 URL 处理)
    const nonImages = ready.filter((a) => a.kind !== 'image');
    const koubouText = [bubbleText, ...nonImages.map((a) => '@' + a.url)].filter(Boolean).join(' ');
    if (runStatus === 'running') {
      client.current?.steer(koubouText); // steer 仅文本:图片此轮无法带(既有局限)
    } else {
      const imageBlocks = ready
        .filter((a) => a.kind === 'image')
        .map((a) => ({ type: 'image', source: { type: 'url', url: a.url } }));
      const content: string | ContentBlock[] = imageBlocks.length
        ? ([{ type: 'text', text: koubouText }, ...imageBlocks] as ContentBlock[])
        : koubouText;
      client.current?.sendUserMessage({ role: 'user', content });
    }
    resetComposer();
  };
```

`canSend` 改为(上传中禁用):

```ts
  const uploading = attachments.some((a) => a.status === 'uploading');
  const hasReady = attachments.some((a) => a.status === 'ready');
  const canSend = !uploading && (draft.trim().length > 0 || hasReady || refs.length > 0);
```

(原 `const canSend = ...` 一行整体替换为上面三行。)

并给**发送态** IconButton 加 `disabled={!canSend}`(`runStatus !== 'running'` 分支的那个 Send 按钮),使上传中按钮真正禁用(Stop 按钮分支不变):

```tsx
              <IconButton
                variant={submitVariant(canSend, dark)}
                className={`size-10 ${canSend ? 'rounded-[10px]' : 'rounded-[12px]'}`}
                aria-label="Send"
                disabled={!canSend}
                onClick={send}
              >
```

- [ ] **Step 5: 更新 AttachmentBar(附件 chip 用 MediaThumb + 上传/错误态)**

`src/components/chat/AttachmentBar.tsx` 整体改为:

```tsx
'use client';
import { useStore } from '@/store';
import AssetChip, { Chip, MediaThumb } from './AssetChip';

// 草稿待发送区:@ 资产引用 + 上传附件(按 kind 缩略图 + 上传/错误态)
export default function AttachmentBar() {
  const { refs, attachments } = useStore((s) => s.composer);
  const removeRef = useStore((s) => s.removeRef);
  const removeChatAttachment = useStore((s) => s.removeChatAttachment);
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
          removeLabel="移除附件"
          onRemove={() => removeChatAttachment(a.id)}
          icon={
            a.status === 'uploading' ? (
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
                role="status"
                aria-label="上传中"
              />
            ) : a.status === 'error' ? (
              <span className="text-[12px] font-semibold text-[var(--color-accent)]" aria-label="上传失败">!</span>
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

- [ ] **Step 6: 写 actions 测试**

在 `src/store/actions.test.ts`:先把顶部 import 改为带上 `uploadCanvasItem`(同一模块,已 mock):

```ts
import { pgcApi, PgcError, uploadCanvasItem } from '@/lib/pgc/client';
```

并在 `api` 别名附近加一行 mock 句柄(`uploadCanvasItem` 是具名导出、非 `pgcApi` 成员):

```ts
const uploadMock = uploadCanvasItem as unknown as ReturnType<typeof vi.fn>;
```

再追加用例(`api` 别名、`beforeEach` 复位已存在):

```ts
describe('对话窗附件上传/移除', () => {
  test('uploadChatAttachment 成功 → 附件 ready 带 url/itemId/kind,标记 chat_attachment,且不入 assets', async () => {
    useStore.setState({ currentProjectId: 7, assets: [], composer: { draft: '', refs: [], attachments: [] } });
    api.updateCanvasReference.mockResolvedValue({});
    uploadMock.mockResolvedValue({ id: 1, item_id: 'ci1', type: 'image', status: 'ready', url: 'http://x/a.png' });

    const file = new File([new Uint8Array(4)], 'a.png', { type: 'image/png' });
    await useStore.getState().uploadChatAttachment(file);

    const att = useStore.getState().composer.attachments;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ name: 'a.png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' });
    expect(api.updateCanvasReference).toHaveBeenCalledWith(7, 'ci1', { chat_attachment: true });
    expect(useStore.getState().assets).toEqual([]);
  });

  test('uploadChatAttachment 失败(PgcError)→ 附件 error + lastError', async () => {
    useStore.setState({ currentProjectId: 7, composer: { draft: '', refs: [], attachments: [] } });
    uploadMock.mockRejectedValue(new PgcError('UPLOAD', '太大了', 413));
    await useStore.getState().uploadChatAttachment(new File([], 'b.png', { type: 'image/png' }));
    expect(useStore.getState().composer.attachments[0].status).toBe('error');
    expect(useStore.getState().lastError).toMatchObject({ code: 'UPLOAD' });
  });

  test('removeChatAttachment 有 itemId → 调 deleteCanvasItem 并移除', () => {
    useStore.setState({
      currentProjectId: 7,
      composer: { draft: '', refs: [], attachments: [{ id: 'x', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png', itemId: 'ci1' }] },
    });
    useStore.getState().removeChatAttachment('x');
    expect(api.deleteCanvasItem).toHaveBeenCalledWith(7, 'ci1');
    expect(useStore.getState().composer.attachments).toEqual([]);
  });

  test('removeChatAttachment 无 itemId(上传中)→ 仅本地移除,不调删除', () => {
    useStore.setState({
      currentProjectId: 7,
      composer: { draft: '', refs: [], attachments: [{ id: 'y', name: 'a.png', mime: 'image/png', kind: 'image', status: 'uploading' }] },
    });
    useStore.getState().removeChatAttachment('y');
    expect(api.deleteCanvasItem).not.toHaveBeenCalled();
    expect(useStore.getState().composer.attachments).toEqual([]);
  });
});
```

> 注:`vi.clearAllMocks()`(现有 `beforeEach`)会清掉 `uploadMock` 的返回值,故每个用例内显式 `mockResolvedValue`/`mockRejectedValue`。`uploadChatAttachment`/`removeChatAttachment` 定义在 `index.ts`,但通过 `useStore.getState()` 可直接调用,且它们 import 的是同一被 mock 的 `@/lib/pgc/client`,mock 生效。

- [ ] **Step 7: 写 Composer / AttachmentBar 测试**

`src/components/chat/Composer.test.tsx` 追加(就绪附件直接塞 store,绕过上传 IO):

```ts
const att = (over: Partial<import('@/store/types').ChatAttachment> = {}) =>
  ({ id: 'a1', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png', ...over });

test('图片附件就绪发送 → 气泡含 media part + koubou content 为 [text, image url 块]', () => {
  useStore.setState({ composer: { draft: '看这张', refs: [], attachments: [att()] }, runStatus: 'idle', assets: [] });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  const lastMsg = useStore.getState().messages.at(-1)!;
  expect(lastMsg.parts).toContainEqual({ type: 'media', kind: 'image', url: 'http://x/a.png', name: 'a.png' });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: [{ type: 'text', text: '看这张' }, { type: 'image', source: { type: 'url', url: 'http://x/a.png' } }],
  });
});

test('视频附件就绪发送 → 无 image 块,URL 折进文本(@url)', () => {
  useStore.setState({
    composer: { draft: '配乐', refs: [], attachments: [att({ id: 'v', name: 'c.mp4', mime: 'video/mp4', kind: 'video', url: 'http://x/c.mp4' })] },
    runStatus: 'idle', assets: [],
  });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: '配乐 @http://x/c.mp4' });
});

test('附件上传中 → 发送按钮禁用', () => {
  useStore.setState({ composer: { draft: 'hi', refs: [], attachments: [att({ status: 'uploading', url: undefined })] }, runStatus: 'idle', assets: [] });
  render(<Composer client={clientRef} />);
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
});
```

`src/components/chat/AttachmentBar.test.tsx`:把原 “文件附件 chip” 用例替换为新 ChatAttachment 形状,并加状态用例:

```ts
test('就绪图片附件 chip 显示缩略图与文件名,可移除', () => {
  useStore.setState({ composer: { draft: '', refs: [], attachments: [{ id: 'a1', name: 'a.png', mime: 'image/png', kind: 'image', status: 'ready', url: 'http://x/a.png' }] } });
  const { container } = render(<AttachmentBar />);
  expect(screen.getByText('a.png')).toBeInTheDocument();
  expect(container.querySelector('img[src="http://x/a.png"]')).not.toBeNull();
  screen.getByRole('button', { name: '移除附件' }).click();
  expect(useStore.getState().composer.attachments).toEqual([]);
});

test('上传中附件显示 spinner', () => {
  useStore.setState({ composer: { draft: '', refs: [], attachments: [{ id: 'u', name: 'b.png', mime: 'image/png', kind: 'image', status: 'uploading' }] } });
  render(<AttachmentBar />);
  expect(screen.getByRole('status', { name: '上传中' })).toBeInTheDocument();
});
```

- [ ] **Step 8: 运行全部相关测试 + 类型检查**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/store/actions.test.ts src/components/chat/Composer.test.tsx src/components/chat/AttachmentBar.test.tsx
```
Expected: tsc 无错;三个测试文件全 PASS

- [ ] **Step 9: 提交**

```bash
git add src/store/types.ts src/store/index.ts src/components/chat/Composer.tsx src/components/chat/AttachmentBar.tsx src/store/actions.test.ts src/components/chat/Composer.test.tsx src/components/chat/AttachmentBar.test.tsx
git commit -m "feat: 对话窗附件上传走画布端点(图片URL块/视频音频进文本)+ 气泡缩略图与上传态"
```

---

### Task 8: 全量校验

**Files:** 无(仅校验)

- [ ] **Step 1: 类型 + lint + 全量测试 + 构建**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```
Expected: 全部通过(CI 等价链路:lint → tsc → test → build)

- [ ] **Step 2: 若有失败**

按报错定位到对应 Task 修复;修完重跑本任务命令。无失败则本计划完成。

---

## Self-Review

**Spec coverage 核对(逐条对 spec):**
- 复用画布上传端点拿 URL → Task 7(`uploadCanvasItem`)。✓
- 仅对话内显示(标记 + loadCanvas 过滤)→ Task 7(PATCH `chat_attachment`)+ Task 3(过滤)。✓
- 全类型上传(image/video/audio)+ 策略 → Task 1 + Task 2(kind 推导)。✓
- 图片走 image url 块、视频/音频折进文本 → Task 7 `send()`。✓
- 气泡按 kind 缩略图(图片/视频首帧/音频·3D 图标)→ Task 4(MediaThumb)+ Task 5(渲染)。✓
- 冷启动重建图片缩略图 → Task 6(blocksToParts)。✓
- 上传中/错误态、移除删孤儿 → Task 7(AttachmentBar + removeChatAttachment)。✓
- 切项目 await 校验、错误分层、不入 assets → Task 7 action。✓
- 重载视频/音频仅显 URL 文本(已知取舍)→ Task 6 不处理非 image 块(符合 spec 决策)。✓

**Placeholder scan:** 无 TBD/TODO;每个改动步骤含完整代码。

**Type consistency:** `ChatAttachment` 字段(id/name/mime/kind/status/url/itemId)在 types、action、Composer、AttachmentBar、测试中一致;`media` part `{type,kind,url,name?}` 在 types、MessageItem、blocksToParts、Composer.send 中一致;`MediaThumb({kind,src,iconSize?})` 在 AssetChip 定义、MessageItem、AttachmentBar 调用一致;action 名 `uploadChatAttachment`/`removeChatAttachment` 全篇一致。
