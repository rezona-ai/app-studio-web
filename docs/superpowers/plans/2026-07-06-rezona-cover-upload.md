# Rezona 面板封面上传接入项目封面接口 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rezona 发布面板的封面上传改走后端新项目封面接口 `POST /api/projects/{id}/cover`（pgc-server PR #272），删除发不出去的 canvas-item 旧链路，缩略图交互对齐 Figma 1174:33832。

**Architecture:** 协议层加 `uploadProjectCover`（multipart，复用信封解析）；`RezonaPublishModal.uploadCover` 换调新端点、`cover_ref` 恒 `'version_cover'`；纯函数 `mapCoverUploadError` 下沉 `lib/rezona/publish.ts`；`PublishForm` 缩略图变可点击上传入口。

**Tech Stack:** Next.js 16 / React 19 / zustand / Vitest（jsdom + globals）/ react-i18next 六语。

## Global Constraints

- 设计稿：`docs/superpowers/specs/2026-07-06-rezona-cover-upload-design.md`
- 颜色/圆角/阴影一律走 `globals.css` 令牌，禁止字面色值（CLAUDE.md UI 范式）
- i18n：en 为单一真相源，新增 key 必须补齐 en/zh/fr/ru/ja/vi 六套
- 注释/commit message 用中文，注释解释「为什么」
- 后端契约：仅 PNG（`UNSUPPORTED_COVER_TYPE`）、空文件 `EMPTY_COVER_UPLOAD`、超限 `CANVAS_UPLOAD_TOO_LARGE`；成功 `data` 为 `ProjectData`
- 每步跑测试用 `pnpm exec vitest run <文件>`；收尾跑 `pnpm exec tsc --noEmit`

---

### Task 1: 协议层 `uploadProjectCover`

**Files:**
- Modify: `src/lib/pgc/client.ts`（`uploadCanvasItem` 附近，文件尾部函数区）
- Test: `src/lib/pgc/cover-client.test.ts`（新建）

**Interfaces:**
- Produces: `export function uploadProjectCover(pid: number, file: File): Promise<ProjectData>` —— Task 3 的模态调用它。

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/pgc/cover-client.test.ts
import { afterEach, expect, test, vi } from 'vitest';
import { uploadProjectCover, PgcError } from './client';

function mockFetchOnce(payload: { ok?: boolean; status?: number; env: unknown }) {
  const spy = vi.fn().mockResolvedValue({
    ok: payload.ok ?? true, status: payload.status ?? 200,
    json: async () => payload.env,
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

const project = {
  id: 42, public_id: 'mVFGYtHQ', name: 'G',
  cover_url: '/pv/mVFGYtHQ/assets/pgc-cover/cover.png?v=3a1c9f0e2b7d4a86',
  cover_source: 'user', current_version_id: 'v2', status: 'active',
  created_at: '', updated_at: '',
};

test('uploadProjectCover:POST multipart 到 /projects/{id}/cover,解包 ProjectData', async () => {
  const spy = mockFetchOnce({ env: { success: true, code: 'OK', message: '', data: project } });
  const file = new File(['png-bytes'], 'cover.png', { type: 'image/png' });
  const res = await uploadProjectCover(42, file);
  expect(res.cover_url).toContain('pgc-cover/cover.png?v=');
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/cover');
  expect(init.method).toBe('POST');
  expect(init.credentials).toBe('include');
  // multipart:body 是 FormData 且字段名为 file;不得手写 Content-Type(边界串由浏览器生成)
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get('file')).toBe(file);
  expect(init.headers).toBeUndefined();
});

test('uploadProjectCover:非 PNG 等后端错误码转 PgcError', async () => {
  mockFetchOnce({ ok: false, status: 422, env: { success: false, code: 'UNSUPPORTED_COVER_TYPE', message: 'png only' } });
  const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
  await expect(uploadProjectCover(42, file)).rejects.toMatchObject(
    Object.assign(new PgcError('UNSUPPORTED_COVER_TYPE', 'png only', 422), {}),
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/cover-client.test.ts`
Expected: FAIL —— `uploadProjectCover` 未导出。

- [ ] **Step 3: 最小实现**

在 `src/lib/pgc/client.ts` 的 `uploadCanvasItem` 之前加（并把 `ProjectData` 已在 import 列表中，无需改动 import）：

```ts
// 上传替换项目封面(PR #272):multipart 字段 file,仅 PNG(其余后端 422);成功返回更新后的 ProjectData。
// 无需上传进度,直接 fetch + FormData(浏览器自动生成 multipart 边界,不能手写 Content-Type)。
export async function uploadProjectCover(pid: number, file: File): Promise<ProjectData> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${PREFIX}/api/projects/${pid}/cover`, {
    method: 'POST', credentials: 'include', body: fd,
  });
  return unwrap<ProjectData>(res);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/cover-client.test.ts`
Expected: PASS（2 passed）

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/client.ts src/lib/pgc/cover-client.test.ts
git commit -m "feat: PGC 协议层新增项目封面上传 uploadProjectCover(multipart,PNG-only 契约)"
```

---

### Task 2: 封面上传错误码映射纯函数 + i18n 六语补全

**Files:**
- Modify: `src/lib/rezona/publish.ts`（文件尾追加）
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`preview.rezona` 段）
- Test: `src/lib/rezona/publish.test.ts`（追加用例）

**Interfaces:**
- Produces: `export function mapCoverUploadError(code: string): string`（返回 i18n key）—— Task 3 的模态调用它。
- Produces: i18n key `preview.rezona.uploadCover / coverUploading / err.coverUpload / err.coverType / err.coverEmpty / err.coverTooLarge`。

> 背景：`uploadCover`、`coverUploading`、`err.coverUpload` 三个 key 组件里已在引用但**六语全缺失**（提交 b014043 引入 UI 时漏加），本任务一并补上。

- [ ] **Step 1: 写失败测试**

在 `src/lib/rezona/publish.test.ts` 尾部追加：

```ts
import { mapCoverUploadError } from './publish';

test('mapCoverUploadError:已知错误码映射专属文案,未知回落通用封面失败', () => {
  expect(mapCoverUploadError('UNSUPPORTED_COVER_TYPE')).toBe('preview.rezona.err.coverType');
  expect(mapCoverUploadError('EMPTY_COVER_UPLOAD')).toBe('preview.rezona.err.coverEmpty');
  expect(mapCoverUploadError('CANVAS_UPLOAD_TOO_LARGE')).toBe('preview.rezona.err.coverTooLarge');
  expect(mapCoverUploadError('WHATEVER')).toBe('preview.rezona.err.coverUpload');
});
```

（若该文件的既有 import 不是 `import { test, expect }` 全局风格，对齐既有写法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/rezona/publish.test.ts`
Expected: FAIL —— `mapCoverUploadError` 未导出。

- [ ] **Step 3: 实现映射 + 补六语文案**

`src/lib/rezona/publish.ts` 尾部追加：

```ts
// 封面上传(POST /projects/{id}/cover,PR #272)错误码 → i18n key。与发布错误(mapRezonaError)分开:
// 上传失败只弹 Toast,不涉及绑定/步骤迁移。未知码回落通用封面上传失败文案。
export function mapCoverUploadError(code: string): string {
  switch (code) {
    case 'UNSUPPORTED_COVER_TYPE': return 'preview.rezona.err.coverType';
    case 'EMPTY_COVER_UPLOAD': return 'preview.rezona.err.coverEmpty';
    case 'CANVAS_UPLOAD_TOO_LARGE': return 'preview.rezona.err.coverTooLarge';
    default: return 'preview.rezona.err.coverUpload';
  }
}
```

六语 locale 在 `preview.rezona` 段补 key（放 `coverHint` 旁；`err.*` 放 err 块内）：

en：
```ts
uploadCover: 'Upload',
coverUploading: 'Uploading cover…',
// err 块内:
coverUpload: 'Cover upload failed. Please try again.',
coverType: 'Only PNG images are supported.',
coverEmpty: 'The selected file is empty.',
coverTooLarge: 'The image exceeds the size limit.',
```
zh：
```ts
uploadCover: '上传',
coverUploading: '封面上传中…',
coverUpload: '封面上传失败，请重试。',
coverType: '仅支持 PNG 图片。',
coverEmpty: '所选文件为空。',
coverTooLarge: '图片超过大小上限。',
```
fr：
```ts
uploadCover: 'Importer',
coverUploading: 'Envoi de la couverture…',
coverUpload: "Échec de l'envoi de la couverture. Veuillez réessayer.",
coverType: 'Seules les images PNG sont prises en charge.',
coverEmpty: 'Le fichier sélectionné est vide.',
coverTooLarge: "L'image dépasse la taille maximale.",
```
ru：
```ts
uploadCover: 'Загрузить',
coverUploading: 'Загрузка обложки…',
coverUpload: 'Не удалось загрузить обложку. Попробуйте ещё раз.',
coverType: 'Поддерживаются только изображения PNG.',
coverEmpty: 'Выбранный файл пуст.',
coverTooLarge: 'Изображение превышает допустимый размер.',
```
ja：
```ts
uploadCover: 'アップロード',
coverUploading: 'カバーをアップロード中…',
coverUpload: 'カバーのアップロードに失敗しました。もう一度お試しください。',
coverType: 'PNG 画像のみ対応しています。',
coverEmpty: '選択されたファイルが空です。',
coverTooLarge: '画像がサイズ上限を超えています。',
```
vi：
```ts
uploadCover: 'Tải lên',
coverUploading: 'Đang tải ảnh bìa…',
coverUpload: 'Tải ảnh bìa thất bại. Vui lòng thử lại.',
coverType: 'Chỉ hỗ trợ ảnh PNG.',
coverEmpty: 'Tệp đã chọn trống.',
coverTooLarge: 'Ảnh vượt quá giới hạn dung lượng.',
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/rezona/publish.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/rezona/publish.ts src/lib/rezona/publish.test.ts src/i18n/locales/
git commit -m "feat: 封面上传错误码映射纯函数 + 补齐封面相关六语文案(含历史缺失 key)"
```

---

### Task 3: RezonaPublishModal 换封面上传链路

**Files:**
- Modify: `src/components/preview/RezonaPublishModal.tsx`
- Test: `src/components/preview/RezonaPublishModal.test.tsx`（改/加用例）

**Interfaces:**
- Consumes: `uploadProjectCover(pid, file): Promise<ProjectData>`（Task 1）、`mapCoverUploadError(code): string`（Task 2）。
- Produces: 对 `PublishForm` 的 props 不变（`coverUrl` / `coverUploading` / `onUploadCover`）。

- [ ] **Step 1: 写/改失败测试**

`RezonaPublishModal.test.tsx` 对齐既有 mock 风格（该文件已 mock `@/lib/pgc/client`），要点用例：

```tsx
// 1) 上传成功:调用 uploadProjectCover(而非 uploadCanvasItem),缩略图换成返回的 cover_url
test('上传封面走项目封面端点并更新缩略图', async () => {
  vi.mocked(uploadProjectCover).mockResolvedValue({
    ...projectStub, cover_url: '/pv/abc/assets/pgc-cover/cover.png?v=deadbeef', cover_source: 'user',
  });
  // ...进入 form 步骤后,选择文件触发 onUploadCover
  // 断言 uploadProjectCover 被调用、uploadCanvasItem 未被调用
  // 断言 <img> src 包含 'pgc-cover/cover.png?v=deadbeef'
});

// 2) 上传失败:已知错误码映射文案进 setError,cover 展示不变
test('非 PNG 上传失败弹对应文案', async () => {
  vi.mocked(uploadProjectCover).mockRejectedValue(new PgcError('UNSUPPORTED_COVER_TYPE', 'png only', 422));
  // 触发上传后断言 store.lastError.message 为 t('preview.rezona.err.coverType') 文案
});

// 3) 发布请求 cover_ref 恒 'version_cover'(即使上传过自定义封面)
test('发布请求 cover_ref 恒为 version_cover', async () => {
  // 上传成功后点发布,断言 pgcApi.rezona.publish 的 body.cover_ref === 'version_cover'
});
```

（具体渲染/驱动写法照抄该测试文件现有用例的 helper；`projectStub` 按 `ProjectData` 全字段造。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/RezonaPublishModal.test.tsx`
Expected: 新用例 FAIL（仍走 uploadCanvasItem / cover_ref 传 itemId）。

- [ ] **Step 3: 改实现**

`RezonaPublishModal.tsx` 变更点：

```tsx
// import 改:删 uploadCanvasItem;pgcApi 仍要(rezona.*);加 uploadProjectCover 与 mapCoverUploadError
import { pgcApi, uploadProjectCover, PgcError } from '@/lib/pgc/client';
import { newIdempotencyKey, mapRezonaError, mapCoverUploadError, REZONA_TITLE_MAX } from '@/lib/rezona/publish';

// state 改:cover 从 {itemId, url} 简化为 URL 串(不再需要 asset id 参与发布)
const [coverUrl, setCoverUrl] = useState<string | null>(null); // 用户上传的项目封面(展示用,不进发布请求)

// uploadCover 整体替换:
// 上传自定义封面 = 替换项目级封面(POST /projects/{id}/cover,PR #272);
// 发布仍恒带 version_cover —— Rezona 侧封面由后端后续迭代(产品确认的预期行为)。
const uploadCover = useCallback(async (file: File) => {
  setCoverUploading(true);
  try {
    const p = await uploadProjectCover(projectId, file);
    if (!mountedRef.current) return;
    setCoverUrl(resolveAssetUrl(p.cover_url) ?? null);
  } catch (e) {
    if (!mountedRef.current) return;
    if (e instanceof PgcError) setError({ code: e.code, message: t(mapCoverUploadError(e.code)) });
    else setError({ code: 'REZONA_COVER_UPLOAD_FAILED', message: t('preview.rezona.err.coverUpload') });
  } finally {
    if (mountedRef.current) setCoverUploading(false);
  }
}, [projectId, setError, t]);

// submit 里:cover_ref 恒定
cover_ref: 'version_cover',
// submit 的 useCallback 依赖数组删掉 cover

// PublishForm 传参:
coverUrl={coverUrl ?? version?.cover}
```

同时删除 `updateCanvasReference(..., { rezona_cover: true })` 调用与相关注释。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/RezonaPublishModal.test.tsx`
Expected: PASS（含既有用例，若有断言旧链路的用例一并改掉）。

- [ ] **Step 5: Commit**

```bash
git add src/components/preview/RezonaPublishModal.tsx src/components/preview/RezonaPublishModal.test.tsx
git commit -m "feat: Rezona 封面上传切换项目封面端点,cover_ref 恒 version_cover,删除画布资产旧链路"
```

---

### Task 4: PublishForm 缩略图上传交互对齐 Figma

**Files:**
- Modify: `src/components/preview/rezona/PublishForm.tsx`
- Test: `src/components/preview/rezona/PublishForm.test.tsx`（加用例）

**Interfaces:**
- Consumes: props 不变（`coverUrl` / `coverUploading` / `onUploadCover`）。

- [ ] **Step 1: 写失败测试**

`PublishForm.test.tsx` 追加（对齐该文件既有 render helper）：

```tsx
test('点击缩略图触发同一文件选择器', () => {
  // render 后:
  const thumb = screen.getByRole('button', { name: en.preview.rezona.uploadCover });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const clickSpy = vi.spyOn(input, 'click');
  fireEvent.click(thumb);
  expect(clickSpy).toHaveBeenCalled();
  expect(input.accept).toBe('image/png');
});

test('上传中缩略图按钮禁用', () => {
  // render 时 coverUploading=true
  const thumb = screen.getByRole('button', { name: en.preview.rezona.uploadCover });
  expect(thumb).toBeDisabled();
});
```

（缩略图与 Upload 按钮 aria-label/文案相同会取到多个元素时，用 `getAllByRole(...)[0]` 或给缩略图专属 `aria-label` —— 以实现为准，两处保持一致。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/rezona/PublishForm.test.tsx`
Expected: 新用例 FAIL（缩略图还不是 button）。

- [ ] **Step 3: 改实现**

封面块替换为（Figma 1174:33832：容器圆角 8px + 描边、封面 30% 压暗、中央 40px 圆托底 + 16px upload 图标；色值按令牌映射，深浅主题自适应）：

```tsx
<button
  type="button"
  disabled={coverUploading}
  onClick={() => fileRef.current?.click()}
  aria-label={t('preview.rezona.uploadCover')}
  className="relative grid size-[126px] shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-fill)]"
>
  {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 size-full object-cover opacity-30" />}
  <span className="grid size-10 place-items-center rounded-[20px] bg-[var(--color-pop)]">
    <Upload size={16} className="text-[var(--color-ink)]" />
  </span>
  {coverUploading && (
    <span className="absolute inset-0 grid place-items-center bg-black/40">
      <span role="status" aria-label={t('preview.rezona.coverUploading')}
        className="block size-5 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-teal)]" />
    </span>
  )}
</button>
```

隐藏 input 收紧类型：`accept="image/png"`。右侧 Upload 按钮/提示文案不动。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/rezona/PublishForm.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量校验 + Commit**

```bash
pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm lint
git add src/components/preview/rezona/PublishForm.tsx src/components/preview/rezona/PublishForm.test.tsx
git commit -m "feat: Rezona 发布表单缩略图变上传入口,视觉对齐 Figma(压暗+圆形图标,accept 收紧 PNG)"
```

---

## 收尾

- `pnpm exec tsc --noEmit`、`pnpm exec vitest run`、`pnpm lint` 全绿。
- 检查 `PublishForm.tsx:13` 的陈旧注释「本期封面只读…不做自定义封面控件」——已与实现矛盾，改成描述新语义。
- 联调前置：pgc-server PR #272 需合并部署 dev 后才能真机验证；本计划全部用测试桩即可完成。
