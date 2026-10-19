# 资产生成弹窗可用模型列表数据源化改造设计

日期：2026-06-10
状态：已与 Nick 确认方向（下发模型参数；仅放 ✅ 已验证模型；audio 隐藏/image 静态/video 可选下拉）

## 背景

资产生成弹窗（`GenerateForm.tsx`）当前写死单项假占位 `MODELS = [{ id: 'gvlm-3.1', name: 'GVLM 3.1' }]`，且用户选中的 model **没有进入 `buildGenBody`、不会下发给后端**。后端 `canvas.md` 文档（`docs/api/canvas.md`，私有仓库）现已给出各资产类型的真实可用模型清单，本次以此为数据源更新弹窗模型列表，并真正下发。

各生成请求类型已具备承载字段（前次改造补全）：image/video 用 `model`，3d 用 `model_version`，audio 无模型参数。

## 数据源（canvas.md「可用模型清单」，✅=已上游验证 / ⚪=未实测建议不下发）

| 资产 | 字段 | 可选值 | 默认 |
|---|---|---|---|
| 图片 | `model` | `gpt-image-2`（✅ 目前唯一；gemini 系明确「不要下发」） | `gpt-image-2`（= 服务端默认） |
| 视频 | `model` | `dreamina-seedance-2-0-260128`（✅ 标准档）、`dreamina-seedance-2-0-fast-260128`（✅ 快速档，参数面相同）；`seedance-2-0(-fast)` ⚪ | `dreamina-seedance-2-0-260128` |
| 3D | `model_version` | `v2.5-20250123`（✅ 服务端默认）；`v3.0-20250812` ⚪ / `v2.0-20240919` ⚪ | `v2.5-20250123` |
| 音频 | 无 model 参数 | —（仅 `voice_id` 选音色，已实现） | — |

**只放 ✅ 已验证模型**：image 1 项、video 2 项、3d 1 项、audio 0 项。⚪ 模型本期不下发（文档明确建议，且可能触发上游 502）。

## 整体架构

### 1. 新增数据模块 `src/components/canvas/gen-models.ts`

与 `gen-params.ts` 同构的声明式数据 + 纯函数：

```ts
import type { GenKind } from './gen-params';

export interface GenModel { value: string; label: string; isDefault?: boolean }

// 各类型 model 写入请求体的哪个字段（image/video=model，3d=model_version，audio 无模型参数）
export const MODEL_FIELD: Record<GenKind, 'model' | 'model_version' | null> = {
  image: 'model',
  video: 'model',
  '3d': 'model_version',
  audio: null,
};

// 仅 ✅ 已验证模型；⚪ 未实测本期不下发
export const GEN_MODELS: Record<GenKind, GenModel[]> = {
  image: [{ value: 'gpt-image-2', label: 'GPT Image 2', isDefault: true }],
  video: [
    { value: 'dreamina-seedance-2-0-260128', label: 'Seedance 2.0', isDefault: true },
    { value: 'dreamina-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  ],
  '3d': [{ value: 'v2.5-20250123', label: 'Tripo v2.5', isDefault: true }],
  audio: [],
};

// 选中非默认模型时返回 { [字段]: 值 }；选中默认/无模型参数返回 {}（沿用「未设置不进 body」）
export function modelBody(kind: GenKind, modelValue: string | undefined): Record<string, unknown> {
  const field = MODEL_FIELD[kind];
  if (!field || !modelValue) return {};
  const def = GEN_MODELS[kind].find((m) => m.isDefault)?.value;
  if (modelValue === def) return {};
  return { [field]: modelValue };
}
```

### 2. `GenerateForm.tsx` 改造

- 删除假占位 `MODELS`，改读 `GEN_MODELS[kind]`
- `modelId` 默认取 `GEN_MODELS[kind][0]?.value`（image/video/3d 即各自默认模型；audio 为 undefined）
- 模型 pill 按可选数量分三态：
  - **0 项（audio）**：不渲染模型 pill
  - **1 项（image / 3d）**：渲染为不可点击的静态标签（保留 sphere + 模型名，去掉 chevron 与下拉交互）
  - **>1 项（video）**：保留现有可点击下拉（sphere + 名称 + chevron + 上拉 popover，选中项打勾）
- 提交时合并模型字段：
  ```ts
  const body = { ...buildGenBody(kind, prompt, params, refSel), ...modelBody(kind, modelId) };
  ```
  选中默认模型不下发；仅 video 选「Seedance 2.0 Fast」时注入 `model`

### 3. 数据流

选中 model → `modelId` state → 提交时 `modelBody(kind, modelId)` 注入请求体 → image/video 进 `model`、3d 进 `model_version` → store action → 后端。默认模型不进 body，跟随服务端默认。

## 测试

沿用现有 vitest 体系：

- `gen-models.test.ts`（纯函数 `modelBody`）：
  - video 选 Fast → `{ model: 'dreamina-seedance-2-0-fast-260128' }`
  - video 选标准档（默认）→ `{}`
  - image 选 gpt-image-2（默认）→ `{}`
  - 3d 选 v2.5（默认）→ `{}`
  - audio（无模型参数）→ `{}`
  - modelValue 为 undefined → `{}`
- `GenerateForm.test.tsx` 补充：
  - video 选 Fast 后提交，`generateVideo` 收到的 body 含 `model: '...fast...'`
  - video 选标准档提交，body 不含 `model`
  - image / 3d 模型 pill 为静态标签（无 `chevronDown`、点击不展开下拉）
  - audio 不渲染模型 pill

## YAGNI 取舍

- **不做模型联动参数**：文档说 video 两档「参数面相同」，3d 单版本，无需按模型切换参数 schema
- **不放 ⚪ 未实测模型**：image 的 gemini 系、video 的 seedance-2-0(-fast)、3d 的 v3.0/v2.0 本期不下发
- **不持久化模型选择**：每次打开弹窗重置为默认模型，与现有 params 重置行为一致
- **不动 audio 音色逻辑**：voice_id 选择已实现，本次不涉及
