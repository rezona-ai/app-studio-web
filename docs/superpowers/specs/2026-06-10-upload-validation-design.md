# 上传校验与限制 设计文档

日期：2026-06-10
作者：Nick / Claude

## 背景与目标

平台有两处独立的文件上传入口，目前都只应支持图片，但校验缺失或不一致：

- **对话窗附件**（`src/components/chat/Composer.tsx` 的 `onFiles`）：无类型校验，仅有裸的 `f.size > 1_000_000`（1MB）限制；非图片在发送时被静默过滤，用户无任何提示。
- **画布资产上传**（`src/components/canvas/AddAssetMenu.tsx` 的 `onFile` → `store.uploadAsset`）：仅 HTML `accept="image/*,video/*,audio/*"`（浏览器提示，非强制），无大小校验、无类型校验。

目标：

1. 两处都施加**强制的类型与大小校验**，当前阶段只放行图片。
2. 校验失败时**给用户明确提示**（复用现有 Toast）。
3. 校验逻辑**单一事实来源 + 配置驱动**，为后续扩展（video / audio / 3d 等）预留能力——扩展时只改配置，校验层不动。

## 关键事实（Claude 官方 Vision API 硬限制）

对话窗附件以 base64 内联进消息发送给模型，需对齐 API 限制：

- 单图大小：**10 MB（base64 编码后）**（一方 Claude API；Bedrock/Vertex 为 5MB）。
- 支持格式：**JPEG / PNG / GIF / WebP**（GIF 动图只取首帧；SVG/BMP/TIFF 不支持）。
- 最大尺寸：8000×8000 px（超出 API 自动缩放，前端不校验）。
- 单请求图数：100（200k 模型）/ 600（1M 模型），整请求体上限 32MB。

**已知限制（记录，不在本次处理）**：base64 编码使体积膨胀约 33%，故 10MB 的原始文件编码后约 13MB，理论上略超 API "10MB base64" 线；且当前不限数量，多张大图可能逼近 32MB 请求体上限。本次按**原始文件 10MB** 校验（用户选择），该边界情形作为已知限制；后续如需可把对话窗 `maxBytes` 单独收紧（约 7MB）。

## 决策（已确认）

- 现阶段两处都**仅放行图片**，类型收紧到 **JPEG/PNG/GIF/WebP**（模型支持集，排除 SVG/BMP/TIFF——SVG 另有 XSS 风险）。
- 单文件统一上限 **10 MB**，**不限数量**。
- 校验失败**复用现有 Toast**（`store.setError`）提示具体原因。
- 错误文案使用**英文**（与近期"文案统一为英文"一致）。

## 架构

新增共享校验模块 `src/lib/upload-policy.ts`：一份按"场景"配置的策略表 + 一组纯函数。两处组件都调用它，失败统一走 `store.setError` → `Toast`。

```
对话窗 Composer.onFiles ─┐
                         ├─► validateUpload(files, UPLOAD_POLICY[surface])
画布 AddAssetMenu.onFile ─┘        │
                          accepted ─► 原有处理(base64 / uploadAsset)
                          rejected ─► setError({ code:'UPLOAD', message: rejectMessage(...) })
```

### 模块接口 `src/lib/upload-policy.ts`

```ts
// 上传场景:对话窗附件 / 画布资产(后续可加更多)
export type UploadSurface = 'chat' | 'canvas';

export interface UploadPolicy {
  accept: string[];        // 允许的 MIME,如 ['image/png', ...]
  maxBytes: number;        // 单文件上限(原始字节)
  maxCount?: number;       // 单次最多文件数;省略=不限(预留)
}

// 当前两处都只放行图片、统一 10MB、不限数量
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MB = 1_000_000;
export const UPLOAD_POLICY: Record<UploadSurface, UploadPolicy> = {
  chat:   { accept: IMAGE_MIMES, maxBytes: 10 * MB },
  canvas: { accept: IMAGE_MIMES, maxBytes: 10 * MB },
};

export type RejectReason = 'type' | 'size' | 'count';
export interface FileReject { file: File; reason: RejectReason }
export interface ValidateResult { accepted: File[]; rejected: FileReject[] }

// 纯函数:按策略筛选,返回通过/拒绝(带原因)。
// 校验顺序:先 count(超数量的尾部文件记 'count'),再逐个 type → size。
export function validateUpload(files: File[], policy: UploadPolicy): ValidateResult;

// 把拒绝结果转成给用户的英文提示(配合 Toast);按原因聚合,带被拒文件名。
export function rejectMessage(rejected: FileReject[], policy: UploadPolicy): string;

// 生成 <input accept> 属性值,如 'image/jpeg,image/png,image/gif,image/webp'
export function acceptAttr(policy: UploadPolicy): string;
```

校验语义：
- `type`：`file.type` 不在 `policy.accept` 中。
- `size`：`file.size > policy.maxBytes`。
- `count`：仅当 `policy.maxCount` 存在且本次文件数超出时，超出的尾部文件记此因（当前两处都未设 `maxCount`，恒不触发）。

错误文案（英文）：
- 类型：`Unsupported file type. Only JPEG, PNG, GIF, WebP images are allowed.`
- 大小：`File too large. Max size is 10 MB.`
- 多文件混合被拒时合并为一条，并带上被拒文件名（如 `"a.svg, b.bmp"`）。

## 组件改动

### `src/components/chat/Composer.tsx`
- `onFiles`：`const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);`
  - `accepted` 走原有 `FileReader.readAsDataURL` → 写入 `composer.attachments`。
  - `rejected.length` 非空 → `setError({ code: 'UPLOAD', message: rejectMessage(rejected, UPLOAD_POLICY.chat) })`。
  - 删除原有 `if (f.size > 1_000_000) return;`。
- `<input ref={fileRef} type="file" multiple>` 增加 `accept={acceptAttr(UPLOAD_POLICY.chat)}`。
- 从 store 取 `setError`。

### `src/components/canvas/AddAssetMenu.tsx`
- `onFile`：`const { accepted, rejected } = validateUpload(f ? [f] : [], UPLOAD_POLICY.canvas);`
  - `accepted[0]` 存在 → `void uploadAsset(accepted[0])`。
  - `rejected.length` 非空 → `setError(...)`。
- `<input accept>` 由 `image/*,video/*,audio/*` 收紧为 `acceptAttr(UPLOAD_POLICY.canvas)`。
- 上传区副标题 `Image/ Video/ Audio` 改为 `Image`（与现状一致）。
- 从 store 取 `setError`。

> 说明：HTML `accept` 仅作首道 UX 过滤（用户文件选择框预筛），`validateUpload` 才是强制校验——用户仍可能通过"所有文件"绕过 `accept`，故 JS 校验不可省。

## 失败反馈

复用 `src/store` 的 `setError({ code, message })` 与 `src/components/ui/Toast.tsx`（订阅 `lastError`，4s 自动消失）。本次统一 `code: 'UPLOAD'`。无需新增任何 UI。

## 测试

新增 `src/lib/upload-policy.test.ts`（仓库已有 vitest，参见 `src/store/selectors.test.ts`）：
- 放行：4 种图片 MIME 各通过。
- 拒绝类型：`image/svg+xml`、`application/pdf`、`video/mp4` 被拒，`reason==='type'`。
- 拒绝大小：`size > maxBytes` 被拒，`reason==='size'`；边界 `=== maxBytes` 通过。
- 混合：accepted / rejected 正确分组。
- `acceptAttr` 输出逗号拼接的 MIME 串。
- `rejectMessage` 对 type / size / 混合分别产出预期英文文案，含文件名。
- `maxCount`（构造一个带 `maxCount` 的策略）：超出尾部记 `'count'`。

## 扩展预留

后续开 video / audio / 3d：
1. 往对应 surface 的 `UPLOAD_POLICY[...].accept` 增加 MIME，按需调 `maxBytes` / 设 `maxCount`。
2. 对话窗若要把新类型发给模型，再在 `Composer.send` 的 content-block 转换里加分支。

校验模块与 Toast 反馈链路均无需改动。

## 非目标（YAGNI）

- 不实现拖拽 / 粘贴上传。
- 不做图片尺寸（像素）校验、不做客户端压缩 / 缩放。
- 不实现 video/audio/3d 的实际放行与处理（仅预留配置位）。
- 不改后端上传接口。
