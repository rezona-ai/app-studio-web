# 上传校验与限制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为对话窗附件与画布资产两处上传加上强制的图片类型/大小校验，失败时用现有 Toast 提示，并把校验逻辑收敛到一个配置驱动的共享模块以便后续扩展。

**Architecture:** 新增纯函数模块 `src/lib/upload-policy.ts`（按场景配置的策略表 + 校验器 + 文案/accept 辅助）。两处组件调用它筛选文件，被拒文件经 `store.setError` 走现有 `Toast`。当前两处都只放行 JPEG/PNG/GIF/WebP、单文件 ≤10MB、不限数量；扩展只改配置。

**Tech Stack:** TypeScript、React、Zustand（`src/store`）、vitest（jsdom）。

设计文档：`docs/superpowers/specs/2026-06-10-upload-validation-design.md`

---

## File Structure

- **Create** `src/lib/upload-policy.ts` — 校验策略与纯函数（类型、`UPLOAD_POLICY`、`validateUpload`、`acceptAttr`、`rejectMessage`）。唯一职责：决定"哪些文件可上传"。
- **Create** `src/lib/upload-policy.test.ts` — 上述纯函数的单测。
- **Modify** `src/components/chat/Composer.tsx` — `onFiles` 接入校验；`<input>` 加 `accept`。
- **Modify** `src/components/canvas/AddAssetMenu.tsx` — `onFile` 接入校验；收紧 `accept`；副标题改为 `Image`。

复用（不改）：`src/store`（`setError` / `lastError`）、`src/components/ui/Toast.tsx`。

---

## Task 1: 校验模块核心（类型 + 策略 + validateUpload）

**Files:**
- Create: `src/lib/upload-policy.ts`
- Test: `src/lib/upload-policy.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/upload-policy.test.ts`：

```ts
import { describe, test, expect } from 'vitest';
import { validateUpload, UPLOAD_POLICY, type UploadPolicy } from './upload-policy';

// 构造指定大小/类型的 File
function fakeFile(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('validateUpload', () => {
  test('放行 4 种图片格式', () => {
    const files = [
      fakeFile('a.jpg', 'image/jpeg'),
      fakeFile('b.png', 'image/png'),
      fakeFile('c.gif', 'image/gif'),
      fakeFile('d.webp', 'image/webp'),
    ];
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    expect(accepted).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  test('拒绝非图片类型,reason=type', () => {
    const files = [fakeFile('x.svg', 'image/svg+xml'), fakeFile('y.pdf', 'application/pdf'), fakeFile('z.mp4', 'video/mp4')];
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason)).toEqual(['type', 'type', 'type']);
  });

  test('拒绝超过 maxBytes,reason=size;等于上限通过', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 100 };
    const over = fakeFile('big.png', 'image/png', 101);
    const exact = fakeFile('ok.png', 'image/png', 100);
    const res = validateUpload([over, exact], policy);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('size');
    expect(res.accepted).toEqual([exact]);
  });

  test('混合时正确分组', () => {
    const good = fakeFile('a.png', 'image/png');
    const bad = fakeFile('b.txt', 'text/plain');
    const { accepted, rejected } = validateUpload([good, bad], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([good]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].file).toBe(bad);
  });

  test('maxCount:超出的尾部文件 reason=count', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 1 };
    const f1 = fakeFile('1.png', 'image/png');
    const f2 = fakeFile('2.png', 'image/png');
    const { accepted, rejected } = validateUpload([f1, f2], policy);
    expect(accepted).toEqual([f1]);
    expect(rejected).toEqual([{ file: f2, reason: 'count' }]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- upload-policy`
Expected: FAIL（`Cannot find module './upload-policy'` / 未定义导出）

- [ ] **Step 3: 实现 `src/lib/upload-policy.ts`（仅本任务涉及的部分）**

```ts
// 上传校验策略:按场景配置允许类型/大小/数量,供对话窗与画布共用。

// 上传场景:对话窗附件 / 画布资产(后续可加更多)
export type UploadSurface = 'chat' | 'canvas';

export interface UploadPolicy {
  accept: string[];   // 允许的 MIME
  maxBytes: number;   // 单文件上限(原始字节)
  maxCount?: number;  // 单次最多文件数;省略=不限(预留)
}

// 模型支持的图片格式(JPEG/PNG/GIF/WebP)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MB = 1_000_000;

// 当前两处都只放行图片、统一 10MB、不限数量
export const UPLOAD_POLICY: Record<UploadSurface, UploadPolicy> = {
  chat: { accept: IMAGE_MIMES, maxBytes: 10 * MB },
  canvas: { accept: IMAGE_MIMES, maxBytes: 10 * MB },
};

export type RejectReason = 'type' | 'size' | 'count';
export interface FileReject {
  file: File;
  reason: RejectReason;
}
export interface ValidateResult {
  accepted: File[];
  rejected: FileReject[];
}

// 按策略筛选文件。校验顺序:超出 maxCount 的尾部文件记 'count';其余逐个 type → size。
export function validateUpload(files: File[], policy: UploadPolicy): ValidateResult {
  const accepted: File[] = [];
  const rejected: FileReject[] = [];
  files.forEach((file, i) => {
    if (policy.maxCount != null && i >= policy.maxCount) {
      rejected.push({ file, reason: 'count' });
    } else if (!policy.accept.includes(file.type)) {
      rejected.push({ file, reason: 'type' });
    } else if (file.size > policy.maxBytes) {
      rejected.push({ file, reason: 'size' });
    } else {
      accepted.push(file);
    }
  });
  return { accepted, rejected };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- upload-policy`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/upload-policy.ts src/lib/upload-policy.test.ts
git commit -m "feat: 新增上传校验策略模块与 validateUpload"
```

---

## Task 2: 文案与 accept 辅助（acceptAttr + rejectMessage）

**Files:**
- Modify: `src/lib/upload-policy.ts`
- Test: `src/lib/upload-policy.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `src/lib/upload-policy.test.ts` 顶部 import 增加 `acceptAttr, rejectMessage`：

```ts
import { validateUpload, acceptAttr, rejectMessage, UPLOAD_POLICY, type UploadPolicy } from './upload-policy';
```

文件末尾追加：

```ts
describe('acceptAttr', () => {
  test('逗号拼接 MIME', () => {
    expect(acceptAttr(UPLOAD_POLICY.chat)).toBe('image/jpeg,image/png,image/gif,image/webp');
  });
});

describe('rejectMessage', () => {
  function fakeFile(name: string, type: string, bytes = 10): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  test('空数组返回空串', () => {
    expect(rejectMessage([], UPLOAD_POLICY.chat)).toBe('');
  });

  test('type:列出友好格式名与文件名', () => {
    const msg = rejectMessage([{ file: fakeFile('x.svg', 'image/svg+xml'), reason: 'type' }], UPLOAD_POLICY.chat);
    expect(msg).toBe('Unsupported file type (x.svg). Only JPEG, PNG, GIF, WebP images are allowed.');
  });

  test('size:含 10 MB 与文件名', () => {
    const msg = rejectMessage([{ file: fakeFile('big.png', 'image/png'), reason: 'size' }], UPLOAD_POLICY.chat);
    expect(msg).toBe('File too large (big.png). Max size is 10 MB.');
  });

  test('count:含上限数', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 1 };
    const msg = rejectMessage([{ file: fakeFile('2.png', 'image/png'), reason: 'count' }], policy);
    expect(msg).toBe('Too many files (2.png). Max 1 at a time.');
  });

  test('混合:type 与 size 合并为一条', () => {
    const msg = rejectMessage(
      [
        { file: fakeFile('x.svg', 'image/svg+xml'), reason: 'type' },
        { file: fakeFile('big.png', 'image/png'), reason: 'size' },
      ],
      UPLOAD_POLICY.chat,
    );
    expect(msg).toBe('Unsupported file type (x.svg). Only JPEG, PNG, GIF, WebP images are allowed. File too large (big.png). Max size is 10 MB.');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- upload-policy`
Expected: FAIL（`acceptAttr` / `rejectMessage` 未定义）

- [ ] **Step 3: 在 `src/lib/upload-policy.ts` 末尾追加实现**

```ts
// 已知图片 MIME 的友好名;未知回退为子类型大写
const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
};

function formatList(mimes: string[]): string {
  return mimes.map((m) => MIME_LABELS[m] ?? (m.split('/')[1] ?? m).toUpperCase()).join(', ');
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

// 生成 <input accept> 属性值,如 'image/jpeg,image/png,image/gif,image/webp'
export function acceptAttr(policy: UploadPolicy): string {
  return policy.accept.join(',');
}

// 把拒绝结果转成英文提示(按原因聚合,带文件名),配合 Toast
export function rejectMessage(rejected: FileReject[], policy: UploadPolicy): string {
  if (rejected.length === 0) return '';
  const names = (reason: RejectReason) =>
    rejected.filter((r) => r.reason === reason).map((r) => r.file.name).join(', ');
  const parts: string[] = [];
  if (rejected.some((r) => r.reason === 'type')) {
    parts.push(`Unsupported file type (${names('type')}). Only ${formatList(policy.accept)} images are allowed.`);
  }
  if (rejected.some((r) => r.reason === 'size')) {
    parts.push(`File too large (${names('size')}). Max size is ${formatBytes(policy.maxBytes)}.`);
  }
  if (rejected.some((r) => r.reason === 'count')) {
    parts.push(`Too many files (${names('count')}). Max ${policy.maxCount} at a time.`);
  }
  return parts.join(' ');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- upload-policy`
Expected: PASS（全部用例绿）

- [ ] **Step 5: 提交**

```bash
git add src/lib/upload-policy.ts src/lib/upload-policy.test.ts
git commit -m "feat: 补充 acceptAttr 与 rejectMessage 辅助及测试"
```

---

## Task 3: 接入对话窗 Composer

**Files:**
- Modify: `src/components/chat/Composer.tsx`

- [ ] **Step 1: 增加 import 与 setError selector**

在文件顶部 import 区追加（紧随现有 `@/...` import 之后）：

```ts
import { validateUpload, rejectMessage, acceptAttr, UPLOAD_POLICY } from '@/lib/upload-policy';
```

在组件内、`resetComposer` 这一行附近，新增 selector：

```ts
  const setError = useStore((s) => s.setError);
```

- [ ] **Step 2: 用校验替换 `onFiles` 现有实现**

将现有 `onFiles`（含 `if (f.size > 1_000_000) return;`）整体替换为：

```ts
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许被拒后重选同名文件
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    if (rejected.length) setError({ code: 'UPLOAD', message: rejectMessage(rejected, UPLOAD_POLICY.chat) });
    accepted.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () =>
        composerSet({
          attachments: [
            ...useStore.getState().composer.attachments,
            { name: f.name, mime: f.type, dataUrl: String(reader.result) },
          ],
        });
      reader.readAsDataURL(f);
    });
  };
```

- [ ] **Step 3: 给文件 input 加 accept**

将（约 130 行）：

```tsx
            <input ref={fileRef} type="file" multiple className="hidden" onChange={onFiles} />
```

改为：

```tsx
            <input ref={fileRef} type="file" multiple accept={acceptAttr(UPLOAD_POLICY.chat)} className="hidden" onChange={onFiles} />
```

- [ ] **Step 4: 类型检查 + lint + 测试**

Run:
```bash
npx tsc --noEmit && npm run lint && npm test
```
Expected: tsc 无报错；lint 通过；vitest 全绿（含既有用例与新模块）。

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat: 对话窗附件接入图片校验并提示非法文件"
```

---

## Task 4: 接入画布 AddAssetMenu

**Files:**
- Modify: `src/components/canvas/AddAssetMenu.tsx`

- [ ] **Step 1: 增加 import 与 setError selector**

顶部 import 区追加：

```ts
import { validateUpload, rejectMessage, acceptAttr, UPLOAD_POLICY } from '@/lib/upload-policy';
```

在组件内 `const uploadAsset = useStore((s) => s.uploadAsset);` 下方追加：

```ts
  const setError = useStore((s) => s.setError);
```

- [ ] **Step 2: 用校验替换 `onFile` 现有实现**

```ts
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // 允许被拒后重选同名文件
    if (!f) return;
    const { accepted, rejected } = validateUpload([f], UPLOAD_POLICY.canvas);
    if (rejected.length) {
      setError({ code: 'UPLOAD', message: rejectMessage(rejected, UPLOAD_POLICY.canvas) });
      return; // 保持菜单打开,便于重选
    }
    void uploadAsset(accepted[0]);
    onClose();
  };
```

- [ ] **Step 3: 收紧 input accept**

将（约 73 行）：

```tsx
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={onFile} />
```

改为：

```tsx
        <input ref={fileRef} type="file" accept={acceptAttr(UPLOAD_POLICY.canvas)} className="hidden" onChange={onFile} />
```

- [ ] **Step 4: 上传区副标题改为 Image**

将（约 68 行）：

```tsx
                <span className="text-[10px] tracking-[-0.1px] text-[var(--color-muted)]">Image/ Video/ Audio</span>
```

改为：

```tsx
                <span className="text-[10px] tracking-[-0.1px] text-[var(--color-muted)]">Image</span>
```

- [ ] **Step 5: 类型检查 + lint + 全量测试**

Run:
```bash
npx tsc --noEmit && npm run lint && npm test
```
Expected: tsc 无报错；lint 通过；vitest 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/components/canvas/AddAssetMenu.tsx
git commit -m "feat: 画布资产上传接入图片校验并收紧文件类型"
```

---

## Self-Review 记录

- **Spec 覆盖**：类型校验（Task 1/3/4）、大小校验（Task 1/3/4）、统一 10MB（`UPLOAD_POLICY`）、不限数量（不设 `maxCount`）、失败 Toast（Task 3/4 `setError`）、英文文案（Task 2）、JPEG/PNG/GIF/WebP（`IMAGE_MIMES`）、扩展预留（`UploadPolicy.maxCount` / 按 surface 配置）、测试（Task 1/2）。均有对应任务。
- **Placeholder 扫描**：无 TBD/TODO，所有步骤含完整代码与命令。
- **类型一致性**：`UploadSurface`、`UploadPolicy`、`RejectReason`、`FileReject`、`ValidateResult` 在 Task 1 定义，Task 2/3/4 沿用同名；`validateUpload` / `acceptAttr` / `rejectMessage` 签名前后一致；`setError({ code, message })` 与 `store` 的 `lastError: {code,message}|null` 一致。

## 手动验证（实现完成后）

1. `npm run dev` 启动。
2. 对话窗：点 + 选一张 >10MB 图片 / 一个非图片文件 → 底部出现 Toast，附件不入栏；选正常图片 → 正常进入附件栏。
3. 画布：右键/菜单 Upload，选非图片或超大文件 → Toast 提示，菜单保持打开;选正常图片 → 正常上传。
