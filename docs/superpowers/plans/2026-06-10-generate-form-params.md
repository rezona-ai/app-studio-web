# 资产生成弹窗参数化改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资产生成弹窗按资产类型提供可配置参数表单（常用 pill + 高级设置折叠区 + 简化版多引用），完整透传 Apifox 最新生成接口参数。

**Architecture:** 新增声明式参数 schema 模块 `gen-params.ts`（纯数据 + 纯函数 `buildGenBody`，单测覆盖核心规则），`GenerateForm.tsx` 按 schema 渲染底部参数 pill 与 ⚙ 高级设置 popover；引用行升级为 chip 列表 + 多选 RefPicker；音色列表走新接口懒加载缓存。

**Tech Stack:** Next.js + React + Zustand + Tailwind + vitest（jsdom / @testing-library/react）。不引入表单库。

**Spec:** `docs/superpowers/specs/2026-06-10-generate-form-params-design.md`

**约定：**
- 测试命令：`npx vitest run <file>`（全量 `npm test`）
- 类型检查：`npx tsc --noEmit`（注意：仓库当前可能有本分支无关的既有报错，只关注本次改动文件）
- commit message 用中文一句话

---

### Task 1: 补全 pgc 请求类型 + voices 类型与 client 方法

**Files:**
- Modify: `src/lib/pgc/types.ts:56-59`（替换四个 Gen 请求类型，追加 Voice 类型）
- Modify: `src/lib/pgc/client.ts:39-75`（pgcApi 追加 `listAudioVoices`）

- [ ] **Step 1: 替换 types.ts 中四个生成请求类型，并追加音色类型**

把 `src/lib/pgc/types.ts` 第 56–59 行的四个接口替换为（对齐 Apifox schema 全量字段）：

```ts
export interface CanvasGenImageRequest {
  prompt: string;
  model?: string | null;
  size?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto' | null;
  output_format?: 'png' | 'jpeg' | null;
  output_compression?: number | null;   // 0-100,仅 jpeg
  moderation?: 'auto' | 'low' | null;
  input_fidelity?: 'low' | 'high' | null;  // 仅图生图路径生效
  n?: number;                           // 1-4
  source_item_id?: string | null;
  source_item_ids?: string[] | null;    // 多图合成 ≤8,与 source_item_id 服务端合并去重
  name?: string | null;
}
export interface CanvasGenAudioRequest {
  prompt: string;
  kind?: 'auto' | 'speech' | 'music' | 'sound';
  expand?: boolean;
  voice_id?: string | null;             // 仅 speech;music/sound 下传入 422
  output_format?: 'mp3' | 'wav';
  speed?: number | null;                // 0.25-4,仅 speech
  duration?: number | null;             // speech 0-72 目标时长;music/sound 1-30 成品长度
  quality_preset?: number | null;       // 1-10,仅 speech
  emo?: Record<string, number> | null;  // 仅 speech;本期 UI 不露出
  target_lang?: string | null;          // 仅 speech
  trim_silence?: boolean | null;        // 仅 speech
  similarity_enh?: boolean | null;      // 仅 speech
  name?: string | null;
}
export interface CanvasGenVideoRequest {
  prompt: string;
  model?: string | null;
  seconds?: number | null;              // 1-30
  resolution?: '480p' | '720p' | '1080p' | null;
  ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive' | null;
  seed?: number | null;
  watermark?: boolean | null;
  camera_fixed?: boolean | null;
  source_item_id?: string | null;       // 首尾帧模式:首帧
  last_frame_item_id?: string | null;   // 首尾帧模式:尾帧
  ref_image_item_ids?: string[] | null; // omni 模式 ≤9;与首尾帧互斥(并存 422)
  ref_video_item_ids?: string[] | null; // omni 模式 ≤3
  name?: string | null;
}
export interface CanvasGenModel3DRequest {
  prompt: string;
  source_item_id?: string | null;       // 给定走图生 3D
  model_version?: string | null;
  negative_prompt?: string | null;
  texture?: boolean | null;
  pbr?: boolean | null;
  texture_quality?: 'standard' | 'detailed' | null;
  face_limit?: number | null;           // ≥1
  quad?: boolean | null;
  style?: string | null;
  auto_size?: boolean | null;
  smart_low_poly?: boolean | null;
  model_seed?: number | null;
  texture_seed?: number | null;
  image_seed?: number | null;
  texture_alignment?: 'original_image' | 'geometry' | null;  // 仅图生 3D,纯文生传入 422
  orientation?: 'default' | 'align_image' | null;            // 仅图生 3D
  name?: string | null;
}
```

并在 `UserData` 定义附近（第 50 行前后）追加：

```ts
export interface VoiceData { voice_id: string; display_name: string; labels?: string | null; sample_url?: string | null; }
export interface VoiceListData { voices: VoiceData[]; total: number; }
```

- [ ] **Step 2: client.ts 追加 listAudioVoices**

`src/lib/pgc/client.ts` 顶部 import type 列表加入 `VoiceListData`；`pgcApi` 对象中「画布」分组后追加：

```ts
  // 生成辅助
  listAudioVoices: () => pgc<VoiceListData>('GET', '/api/gen/audio/voices'),
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: 本次改动的两个文件无报错（仓库既有的无关报错忽略）

- [ ] **Step 4: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts
git commit -m "feat: 补全生成接口请求类型并新增音色列表 client 方法"
```

---

### Task 2: voices 懒加载缓存模块（TDD）

**Files:**
- Create: `src/lib/pgc/voices.ts`
- Test: `src/lib/pgc/voices.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/lib/pgc/voices.test.ts`：

```ts
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('@/lib/pgc/client', () => ({
  pgcApi: { listAudioVoices: vi.fn() },
}));

import { pgcApi } from '@/lib/pgc/client';
import { listVoicesCached, clearVoicesCache } from './voices';

const api = pgcApi as unknown as { listAudioVoices: ReturnType<typeof vi.fn> };
const VOICES = [{ voice_id: 'v1', display_name: '小明', labels: '中文,男性', sample_url: null }];

beforeEach(() => {
  clearVoicesCache();
  vi.clearAllMocks();
  api.listAudioVoices.mockResolvedValue({ voices: VOICES, total: 1 });
});

test('首次调用拉取接口并返回音色列表', async () => {
  const voices = await listVoicesCached(0);
  expect(voices).toEqual(VOICES);
  expect(api.listAudioVoices).toHaveBeenCalledTimes(1);
});

test('TTL 内重复调用命中缓存,不再请求', async () => {
  await listVoicesCached(0);
  const voices = await listVoicesCached(30 * 60 * 1000);  // 30min 后,仍在 1h 内
  expect(voices).toEqual(VOICES);
  expect(api.listAudioVoices).toHaveBeenCalledTimes(1);
});

test('超过 1h 重新拉取', async () => {
  await listVoicesCached(0);
  await listVoicesCached(61 * 60 * 1000);
  expect(api.listAudioVoices).toHaveBeenCalledTimes(2);
});

test('请求失败时抛错且不写缓存(下次可重试)', async () => {
  api.listAudioVoices.mockRejectedValueOnce(new Error('boom'));
  await expect(listVoicesCached(0)).rejects.toThrow('boom');
  const voices = await listVoicesCached(0);
  expect(voices).toEqual(VOICES);
  expect(api.listAudioVoices).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/lib/pgc/voices.test.ts`
Expected: FAIL（Cannot find module './voices'）

- [ ] **Step 3: 实现 voices.ts**

```ts
import { pgcApi } from './client';
import type { VoiceData } from './types';

// 系统音色列表的进程内缓存,TTL 对齐服务端 1h 缓存
const TTL_MS = 60 * 60 * 1000;
let cache: { at: number; voices: VoiceData[] } | null = null;

export async function listVoicesCached(now: number = Date.now()): Promise<VoiceData[]> {
  if (cache && now - cache.at < TTL_MS) return cache.voices;
  const data = await pgcApi.listAudioVoices();
  cache = { at: now, voices: data.voices };
  return data.voices;
}

export function clearVoicesCache(): void {
  cache = null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/lib/pgc/voices.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/voices.ts src/lib/pgc/voices.test.ts
git commit -m "feat: 新增音色列表懒加载缓存模块"
```

---

### Task 3: gen-params 参数 schema 与 buildGenBody（TDD，核心）

**Files:**
- Create: `src/components/canvas/gen-params.ts`
- Test: `src/components/canvas/gen-params.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/components/canvas/gen-params.test.ts`：

```ts
import { expect, test } from 'vitest';
import { buildGenBody, GEN_FIELDS, REF_LIMITS, type RefSelection } from './gen-params';

const NO_REFS: RefSelection = {};
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

// ---- 通用 ----
test('未设置任何参数 → body 只有 prompt', () => {
  expect(buildGenBody('image', '主角立绘', {}, NO_REFS)).toEqual({ prompt: '主角立绘' });
});

test('已设置的参数原样进 body', () => {
  const body = buildGenBody('image', 'x', { size: '1536x1024', quality: 'high', n: 2 }, NO_REFS);
  expect(body).toEqual({ prompt: 'x', size: '1536x1024', quality: 'high', n: 2 });
});

// ---- image 显隐规则 ----
test('output_compression 仅 jpeg 时进 body', () => {
  expect(buildGenBody('image', 'x', { output_compression: 80 }, NO_REFS)).toEqual({ prompt: 'x' });
  expect(buildGenBody('image', 'x', { output_format: 'jpeg', output_compression: 80 }, NO_REFS))
    .toEqual({ prompt: 'x', output_format: 'jpeg', output_compression: 80 });
});

test('input_fidelity 仅有引用时进 body', () => {
  expect(buildGenBody('image', 'x', { input_fidelity: 'high' }, NO_REFS)).toEqual({ prompt: 'x' });
  const body = buildGenBody('image', 'x', { input_fidelity: 'high' }, { refs: [{ id: 'a', kind: 'image' }] });
  expect(body.input_fidelity).toBe('high');
});

test('image 多引用 → source_item_ids,超过 8 张截断', () => {
  const refs: RefSelection = { refs: ids(10, 'img').map((id) => ({ id, kind: 'image' as const })) };
  const body = buildGenBody('image', 'x', {}, refs);
  expect(body.source_item_ids).toHaveLength(REF_LIMITS.image);
});

// ---- audio kind 联动 ----
test('speech 专属参数在 music 下不进 body(规避 422)', () => {
  const body = buildGenBody('audio', 'x', {
    kind: 'music', voice_id: 'v1', speed: 1.2, quality_preset: 3,
    trim_silence: true, target_lang: 'zh', similarity_enh: true, duration: 15,
  }, NO_REFS);
  expect(body).toEqual({ prompt: 'x', kind: 'music', duration: 15 });
});

test('speech 下 voice/speed/duration 正常进 body,duration 上限 72', () => {
  const body = buildGenBody('audio', 'x', { kind: 'speech', voice_id: 'v1', speed: 1.2, duration: 72 }, NO_REFS);
  expect(body).toEqual({ prompt: 'x', kind: 'speech', voice_id: 'v1', speed: 1.2, duration: 72 });
});

test('music/sound 的 duration 夹到 1-30', () => {
  expect(buildGenBody('audio', 'x', { kind: 'sound', duration: 45 }, NO_REFS).duration).toBe(30);
  expect(buildGenBody('audio', 'x', { kind: 'music', duration: 0 }, NO_REFS).duration).toBe(1);
});

test('kind=auto(未设置)时 duration 不进 body', () => {
  expect(buildGenBody('audio', 'x', { duration: 10 }, NO_REFS)).toEqual({ prompt: 'x' });
});

// ---- video 模式互斥 ----
test('首尾帧模式(有 sourceId):尾帧进 body,多选引用忽略', () => {
  const refs: RefSelection = { sourceId: 'img-first', lastFrameId: 'img-last', refs: [{ id: 'img-x', kind: 'image' }] };
  const body = buildGenBody('video', 'x', { seconds: 5 }, refs);
  expect(body).toEqual({ prompt: 'x', seconds: 5, last_frame_item_id: 'img-last' });
  expect(body.ref_image_item_ids).toBeUndefined();
});

test('omni 模式(无 sourceId):引用按类型拆分并截断 9/3', () => {
  const refs: RefSelection = {
    refs: [
      ...ids(10, 'img').map((id) => ({ id, kind: 'image' as const })),
      ...ids(4, 'vid').map((id) => ({ id, kind: 'video' as const })),
    ],
  };
  const body = buildGenBody('video', 'x', {}, refs);
  expect(body.ref_image_item_ids).toHaveLength(REF_LIMITS.videoImage);
  expect(body.ref_video_item_ids).toHaveLength(REF_LIMITS.videoVideo);
  expect(body.last_frame_item_id).toBeUndefined();
});

test('omni 模式无引用时不发空数组', () => {
  expect(buildGenBody('video', 'x', {}, NO_REFS)).toEqual({ prompt: 'x' });
});

// ---- 3d 图生路径 ----
test('texture_alignment/orientation 仅图生 3D(有 sourceId)时进 body', () => {
  expect(buildGenBody('3d', 'x', { texture_alignment: 'original_image', orientation: 'align_image' }, NO_REFS))
    .toEqual({ prompt: 'x' });
  const body = buildGenBody('3d', 'x', { texture_alignment: 'original_image', orientation: 'align_image' }, { sourceId: 'img-1' });
  expect(body.texture_alignment).toBe('original_image');
  expect(body.orientation).toBe('align_image');
});

// ---- schema 完整性 ----
test('每个 kind 都有 pill 层字段,且字段 key 唯一', () => {
  for (const kind of ['image', 'audio', 'video', '3d'] as const) {
    const fields = GEN_FIELDS[kind];
    expect(fields.some((f) => f.tier === 'pill')).toBe(true);
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/canvas/gen-params.test.ts`
Expected: FAIL（Cannot find module './gen-params'）

- [ ] **Step 3: 实现 gen-params.ts**

```ts
import type { AssetKind } from '@/lib/asset-kind';

export type GenKind = Extract<AssetKind, 'image' | 'video' | 'audio' | '3d'>;

// 用户实际设置过的参数;未设置的 key 不存在(也不发往后端,沿用服务端默认)
export type GenParamValues = Record<string, string | number | boolean | undefined>;

// 引用选择(简化版多引用,见 spec):
// - sourceId:打开弹窗的源资产(单源,store action 注入 source_item_id 并连线)
// - refs:「＋添加参考」多选结果(image→source_item_ids;video omni→ref_*_item_ids)
// - lastFrameId:video 首尾帧模式的尾帧
export interface RefSelection {
  sourceId?: string;
  refs?: { id: string; kind: GenKind }[];
  lastFrameId?: string;
}

export interface ParamOption { value: string; label: string }

export type ParamControl =
  | { type: 'select'; options: ParamOption[] }
  | { type: 'stepper'; min: number; max: number }
  | { type: 'toggle' }
  | { type: 'slider'; min: number; max: number; step: number }
  | { type: 'number'; min?: number; max?: number }
  | { type: 'text'; maxLength: number };

export interface ParamField {
  key: string;
  label: string;
  tier: 'pill' | 'advanced';
  control: ParamControl;
  default?: string | number | boolean;  // 仅 pill 未设置时的展示值,不进 body
  visibleWhen?: (params: GenParamValues, refs: RefSelection) => boolean;
}

// 引用数量上限(对齐接口 maxItems)
export const REF_LIMITS = { image: 8, videoImage: 9, videoVideo: 3 } as const;

const opts = (...vs: string[]): ParamOption[] => vs.map((v) => ({ value: v, label: v }));
const hasAnyRef = (_: GenParamValues, refs: RefSelection) => !!refs.sourceId || (refs.refs?.length ?? 0) > 0;
const isSpeech = (p: GenParamValues) => p.kind === 'speech';
const hasKind = (p: GenParamValues) => p.kind === 'speech' || p.kind === 'music' || p.kind === 'sound';
const hasSource = (_: GenParamValues, refs: RefSelection) => !!refs.sourceId;

export const GEN_FIELDS: Record<GenKind, ParamField[]> = {
  image: [
    { key: 'size', label: 'Size', tier: 'pill', default: '1024x1024', control: { type: 'select', options: opts('1024x1024', '1536x1024', '1024x1536', 'auto') } },
    { key: 'quality', label: 'Quality', tier: 'pill', default: 'low', control: { type: 'select', options: opts('low', 'medium', 'high', 'auto') } },
    { key: 'n', label: 'Count', tier: 'pill', default: 1, control: { type: 'stepper', min: 1, max: 4 } },
    { key: 'background', label: 'Background', tier: 'advanced', control: { type: 'select', options: opts('auto', 'transparent', 'opaque') } },
    { key: 'output_format', label: 'Format', tier: 'advanced', control: { type: 'select', options: opts('png', 'jpeg') } },
    { key: 'output_compression', label: 'Compression', tier: 'advanced', control: { type: 'slider', min: 0, max: 100, step: 5 }, visibleWhen: (p) => p.output_format === 'jpeg' },
    { key: 'input_fidelity', label: 'Fidelity', tier: 'advanced', control: { type: 'select', options: opts('low', 'high') }, visibleWhen: hasAnyRef },
  ],
  audio: [
    { key: 'kind', label: 'Type', tier: 'pill', default: 'auto', control: { type: 'select', options: [{ value: 'auto', label: 'Auto' }, { value: 'speech', label: 'Speech' }, { value: 'music', label: 'Music' }, { value: 'sound', label: 'Sound' }] } },
    // voice 选项运行时由 voices 接口注入(GenerateForm 传 optionsOverride)
    { key: 'voice_id', label: 'Voice', tier: 'pill', control: { type: 'select', options: [] }, visibleWhen: isSpeech },
    { key: 'duration', label: 'Duration', tier: 'pill', control: { type: 'number', min: 0, max: 72 }, visibleWhen: hasKind },
    { key: 'expand', label: 'Smart expand', tier: 'advanced', default: true, control: { type: 'toggle' } },
    { key: 'output_format', label: 'Format', tier: 'advanced', default: 'mp3', control: { type: 'select', options: opts('mp3', 'wav') } },
    { key: 'speed', label: 'Speed', tier: 'advanced', control: { type: 'slider', min: 0.25, max: 4, step: 0.25 }, visibleWhen: isSpeech },
    { key: 'quality_preset', label: 'Quality preset', tier: 'advanced', control: { type: 'stepper', min: 1, max: 10 }, visibleWhen: isSpeech },
    { key: 'trim_silence', label: 'Trim silence', tier: 'advanced', control: { type: 'toggle' }, visibleWhen: isSpeech },
    { key: 'target_lang', label: 'Language', tier: 'advanced', control: { type: 'text', maxLength: 16 }, visibleWhen: isSpeech },
    { key: 'similarity_enh', label: 'Similarity enhance', tier: 'advanced', control: { type: 'toggle' }, visibleWhen: isSpeech },
  ],
  video: [
    { key: 'seconds', label: 'Duration', tier: 'pill', default: 5, control: { type: 'stepper', min: 1, max: 30 } },
    { key: 'ratio', label: 'Ratio', tier: 'pill', control: { type: 'select', options: opts('16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive') } },
    { key: 'resolution', label: 'Resolution', tier: 'pill', control: { type: 'select', options: opts('480p', '720p', '1080p') } },
    { key: 'watermark', label: 'Watermark', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'camera_fixed', label: 'Fixed camera', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'seed', label: 'Seed', tier: 'advanced', control: { type: 'number' } },
  ],
  '3d': [
    { key: 'texture_quality', label: 'Texture quality', tier: 'pill', control: { type: 'select', options: opts('standard', 'detailed') } },
    { key: 'face_limit', label: 'Face limit', tier: 'pill', control: { type: 'number', min: 1 } },
    { key: 'pbr', label: 'PBR', tier: 'pill', control: { type: 'toggle' } },
    { key: 'negative_prompt', label: 'Negative prompt', tier: 'advanced', control: { type: 'text', maxLength: 2000 } },
    { key: 'texture', label: 'Texture', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'quad', label: 'Quad mesh', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'auto_size', label: 'Auto size', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'smart_low_poly', label: 'Smart low poly', tier: 'advanced', control: { type: 'toggle' } },
    { key: 'model_seed', label: 'Model seed', tier: 'advanced', control: { type: 'number' } },
    { key: 'texture_seed', label: 'Texture seed', tier: 'advanced', control: { type: 'number' } },
    { key: 'image_seed', label: 'Image seed', tier: 'advanced', control: { type: 'number' } },
    { key: 'texture_alignment', label: 'Texture align', tier: 'advanced', control: { type: 'select', options: opts('original_image', 'geometry') }, visibleWhen: hasSource },
    { key: 'orientation', label: 'Orientation', tier: 'advanced', control: { type: 'select', options: opts('default', 'align_image') }, visibleWhen: hasSource },
  ],
};

// 组装请求 body:只收录「用户设置过且当前可见」的参数;隐藏字段一律剔除
// (规避 speech 专属参数在 music/sound 下、texture_alignment 在纯文生下的 422)
export function buildGenBody(
  kind: GenKind,
  prompt: string,
  params: GenParamValues,
  refs: RefSelection,
): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt };
  for (const f of GEN_FIELDS[kind]) {
    const v = params[f.key];
    if (v === undefined) continue;
    if (f.visibleWhen && !f.visibleWhen(params, refs)) continue;
    body[f.key] = v;
  }
  // music/sound 成品长度 1-30s(显式超限会 422,客户端先夹)
  if (kind === 'audio' && (params.kind === 'music' || params.kind === 'sound') && typeof body.duration === 'number') {
    body.duration = Math.min(Math.max(body.duration, 1), 30);
  }
  if (kind === 'image') {
    const imgIds = (refs.refs ?? []).filter((r) => r.kind === 'image').map((r) => r.id).slice(0, REF_LIMITS.image);
    if (imgIds.length > 0) body.source_item_ids = imgIds;
  }
  if (kind === 'video') {
    if (refs.sourceId) {
      // 首尾帧模式:首帧由 store action 注入 source_item_id,此处只补尾帧;引用多选忽略(互斥)
      if (refs.lastFrameId) body.last_frame_item_id = refs.lastFrameId;
    } else {
      const imgs = (refs.refs ?? []).filter((r) => r.kind === 'image').map((r) => r.id).slice(0, REF_LIMITS.videoImage);
      const vids = (refs.refs ?? []).filter((r) => r.kind === 'video').map((r) => r.id).slice(0, REF_LIMITS.videoVideo);
      if (imgs.length > 0) body.ref_image_item_ids = imgs;
      if (vids.length > 0) body.ref_video_item_ids = vids;
    }
  }
  return body;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/canvas/gen-params.test.ts`
Expected: 14 passed

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/gen-params.ts src/components/canvas/gen-params.test.ts
git commit -m "feat: 新增生成参数 schema 与 buildGenBody 纯函数"
```

---

### Task 4: 参数控件组件（ParamPill / AdvancedPill）

**Files:**
- Create: `src/components/canvas/GenParamControls.tsx`

说明：纯展示组件，复用 `GenerateForm.tsx:118-152` 模型下拉的 popover 视觉语言（上拉面板、fixed 遮罩收起）。行为逻辑已由 Task 3 测试覆盖，本组件在 Task 6 的 GenerateForm 测试中一并验证，此处不单独 TDD。

- [ ] **Step 1: 实现 GenParamControls.tsx**

```tsx
'use client';
import { useState } from 'react';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { SlidersHorizontal } from 'lucide-react';
import type { GenParamValues, ParamField, ParamOption, RefSelection } from './gen-params';

// 与 GenerateForm 模型下拉一致的 pill / 上拉面板样式
const pillCls =
  'flex h-10 items-center gap-1.5 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-[10px] text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)] shadow-[inset_0_0_2px_0_#fff] transition hover:brightness-[0.98]';
const popCls =
  'absolute bottom-[calc(100%+6px)] left-0 z-[56] flex max-h-[280px] min-w-[180px] flex-col overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]';
const rowCls = 'flex h-9 items-center gap-2 rounded-[12px] px-2 text-left text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-fill)]';

type OnChange = (key: string, v: string | number | boolean | undefined) => void;

// pill 上的展示值:未设置时回退展示默认,均无则 Auto(跟随服务端)
function displayValue(f: ParamField, params: GenParamValues): string {
  const v = params[f.key] ?? f.default;
  if (v === undefined) return 'Auto';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (f.key === 'n') return `×${v}`;
  return String(v);
}

// 单字段编辑器(pill 弹层与高级面板共用)
function FieldEditor({ field, params, onChange, close, optionsOverride }: {
  field: ParamField;
  params: GenParamValues;
  onChange: OnChange;
  close?: () => void;
  optionsOverride?: ParamOption[];
}) {
  const c = field.control;
  const v = params[field.key];
  if (c.type === 'select') {
    const options = optionsOverride ?? c.options;
    const pick = (val: string | undefined) => { onChange(field.key, val); close?.(); };
    return (
      <>
        <button type="button" onClick={() => pick(undefined)} className={rowCls}>
          <span className="flex-1">Default</span>
          {v === undefined && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
        </button>
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => pick(o.value)} className={rowCls}>
            <span className="flex-1 truncate">{o.label}</span>
            {v === o.value && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
          </button>
        ))}
      </>
    );
  }
  if (c.type === 'stepper') {
    const cur = (typeof v === 'number' ? v : (field.default as number | undefined)) ?? c.min;
    return (
      <div className="flex items-center justify-between gap-3 px-2 py-1">
        <button type="button" aria-label={`${field.label} minus`} onClick={() => onChange(field.key, Math.max(c.min, cur - 1))} className={rowCls}>−</button>
        <span className="text-[13px] font-medium">{cur}</span>
        <button type="button" aria-label={`${field.label} plus`} onClick={() => onChange(field.key, Math.min(c.max, cur + 1))} className={rowCls}>＋</button>
      </div>
    );
  }
  if (c.type === 'toggle') {
    const on = (typeof v === 'boolean' ? v : (field.default as boolean | undefined)) ?? false;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={field.label}
        onClick={() => onChange(field.key, !on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--color-live)]' : 'bg-[var(--color-line-2)]'}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    );
  }
  if (c.type === 'slider') {
    const cur = (typeof v === 'number' ? v : (field.default as number | undefined)) ?? c.min;
    return (
      <span className="flex items-center gap-2">
        <input
          type="range" min={c.min} max={c.max} step={c.step} value={cur}
          aria-label={field.label}
          onChange={(e) => onChange(field.key, Number(e.target.value))}
          className="w-[120px] accent-[var(--color-live)]"
        />
        <span className="w-8 text-right text-[12px] tabular-nums text-[var(--color-muted)]">{v === undefined ? '—' : cur}</span>
      </span>
    );
  }
  if (c.type === 'number') {
    return (
      <input
        type="number" min={c.min} max={c.max} value={typeof v === 'number' ? v : ''}
        aria-label={field.label}
        placeholder="auto"
        onChange={(e) => {
          if (e.target.value === '') return onChange(field.key, undefined);
          let n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          if (c.min !== undefined) n = Math.max(c.min, n);
          if (c.max !== undefined) n = Math.min(c.max, n);
          onChange(field.key, n);
        }}
        className="h-8 w-[90px] rounded-[8px] border border-[var(--color-line-2)] bg-transparent px-2 text-[13px] outline-none placeholder:text-[var(--color-muted)]"
      />
    );
  }
  // text
  return (
    <input
      type="text" maxLength={c.maxLength} value={typeof v === 'string' ? v : ''}
      aria-label={field.label}
      placeholder="auto"
      onChange={(e) => onChange(field.key, e.target.value === '' ? undefined : e.target.value)}
      className="h-8 w-[150px] rounded-[8px] border border-[var(--color-line-2)] bg-transparent px-2 text-[13px] outline-none placeholder:text-[var(--color-muted)]"
    />
  );
}

// 底部常用参数 pill:toggle 直接点按切换,其余弹出上拉面板编辑
export function ParamPill({ field, params, refs, onChange, optionsOverride }: {
  field: ParamField;
  params: GenParamValues;
  refs: RefSelection;
  onChange: OnChange;
  optionsOverride?: ParamOption[];
}) {
  const [open, setOpen] = useState(false);
  if (field.visibleWhen && !field.visibleWhen(params, refs)) return null;
  if (field.control.type === 'toggle') {
    const on = (params[field.key] as boolean | undefined) ?? (field.default as boolean | undefined) ?? false;
    return (
      <button type="button" onClick={() => onChange(field.key, !on)} className={pillCls} aria-label={field.label}>
        <span className="opacity-60">{field.label}</span>
        <span className={`size-1.5 rounded-full ${on ? 'bg-[var(--color-live)]' : 'bg-[var(--color-line-2)]'}`} />
      </button>
    );
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={pillCls} aria-label={field.label}>
        <span className="opacity-60">{field.label}</span>
        {displayValue(field, params)}
        <FigIcon src={figAsset.chevronDown} size={14} className="opacity-70" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className={popCls}>
            <FieldEditor field={field} params={params} onChange={onChange} close={() => setOpen(false)} optionsOverride={optionsOverride} />
          </div>
        </>
      )}
    </div>
  );
}

// ⚙ 高级设置 pill:面板内逐行渲染 advanced 字段;extra 用于尾帧选择等特殊行
export function AdvancedPill({ fields, params, refs, onChange, extra }: {
  fields: ParamField[];
  params: GenParamValues;
  refs: RefSelection;
  onChange: OnChange;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const visible = fields.filter((f) => f.tier === 'advanced' && (!f.visibleWhen || f.visibleWhen(params, refs)));
  if (visible.length === 0 && !extra) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className={pillCls} aria-label="Advanced settings">
        <SlidersHorizontal size={14} className="opacity-70" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className={`${popCls} min-w-[280px] gap-1`}>
            {visible.map((f) => (
              <div key={f.key} className="flex min-h-9 items-center justify-between gap-3 px-2">
                <span className="shrink-0 text-[12px] text-[var(--color-muted)]">{f.label}</span>
                {f.control.type === 'select' ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    {f.control.options.map((o) => (
                      <button
                        key={o.value} type="button"
                        onClick={() => onChange(f.key, params[f.key] === o.value ? undefined : o.value)}
                        className={`h-7 rounded-[8px] border px-2 text-[12px] transition-colors ${params[f.key] === o.value ? 'border-[var(--color-ink)] text-[var(--color-ink)]' : 'border-[var(--color-line-2)] text-[var(--color-muted)] hover:bg-[var(--color-fill)]'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </span>
                ) : (
                  <FieldEditor field={f} params={params} onChange={onChange} />
                )}
              </div>
            ))}
            {extra}
          </div>
        </>
      )}
    </div>
  );
}
```

注意：高级面板的 select 用「再点取消选择」回到服务端默认；toggle 一旦点过即发送显式值（可接受，spec 未要求三态开关）。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 本文件无报错

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/GenParamControls.tsx
git commit -m "feat: 新增生成参数 pill 与高级设置面板控件"
```

---

### Task 5: RefPicker 多引用选择组件

**Files:**
- Create: `src/components/canvas/RefPicker.tsx`

- [ ] **Step 1: 实现 RefPicker.tsx**

```tsx
'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '@/store';
import { KIND_META } from '@/lib/asset-kind';
import type { Asset } from '@/store/types';
import type { GenKind } from './gen-params';

// 简化版多引用选择:从画布 ready 资产中按类型多选;达到该类型上限后禁用未选项。
// single 模式用于 video 尾帧(单选,选中即收起)。
export default function RefPicker({ accept, selected, limits, onToggle, single, label }: {
  accept: GenKind[];
  selected: string[];
  limits: Partial<Record<GenKind, number>>;
  onToggle: (a: Asset) => void;
  single?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const assets = useStore((s) => s.assets);
  const candidates = assets.filter((a) => (accept as string[]).includes(a.kind) && a.status === 'ready');
  const countOf = (kind: GenKind) => candidates.filter((a) => a.kind === kind && selected.includes(a.id)).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--color-line-2)] px-2.5 text-[12px] font-medium text-[var(--color-muted)] transition hover:bg-[var(--color-fill)]"
      >
        <Plus size={14} />
        {label ?? 'Add reference'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[calc(100%+6px)] z-[56] max-h-[240px] w-[300px] overflow-y-auto rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
            {candidates.length === 0 && (
              <div className="px-2 py-3 text-center text-[12px] text-[var(--color-muted)]">No available assets on canvas</div>
            )}
            <div className="grid grid-cols-4 gap-2">
              {candidates.map((a) => {
                const on = selected.includes(a.id);
                const kind = a.kind as GenKind;
                const full = !on && countOf(kind) >= (limits[kind] ?? Infinity);
                const thumb = a.preview?.dataUrl || a.preview?.src;
                return (
                  <button
                    key={a.id} type="button" disabled={full} title={a.label}
                    onClick={() => { onToggle(a); if (single) setOpen(false); }}
                    className={`relative aspect-square overflow-hidden rounded-[10px] border transition ${on ? 'border-[var(--color-live)]' : 'border-[var(--color-line-2)] hover:brightness-[0.97]'} ${full ? 'opacity-40' : ''}`}
                  >
                    {thumb ? (
                      a.kind === 'video'
                        ? <video src={thumb} muted className="size-full object-cover" />
                        : <img src={thumb} alt="" draggable={false} className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center bg-[var(--color-surface-2)]">
                        <span className="size-2 rounded-full" style={{ background: KIND_META[a.kind].colorVar }} />
                      </span>
                    )}
                    {on && <span className="absolute right-1 top-1 size-2 rounded-full bg-[var(--color-live)]" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 本文件无报错

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/RefPicker.tsx
git commit -m "feat: 新增画布参考资产多选组件"
```

---

### Task 6: GenerateForm 接入（pills + 高级设置 + 多引用 + 音色）

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`
- Test: `src/components/canvas/GenerateForm.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/canvas/GenerateForm.test.tsx`（覆盖：pill 渲染、kind 联动、提交 body、omni 引用）：

```tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/pgc/voices', () => ({
  listVoicesCached: vi.fn().mockResolvedValue([{ voice_id: 'v1', display_name: '小明', labels: '中文', sample_url: null }]),
}));

import GenerateForm from './GenerateForm';
import { useStore } from '@/store';
import type { Asset } from '@/store/types';

afterEach(cleanup);

const asset = (a: Partial<Asset>): Asset => ({
  id: 'a1', key: 'k1', label: '图A', kind: 'image', source: 'generated',
  status: 'ready', position: { x: 0, y: 0 }, pinned: false, ...a,
});

const genImage = vi.fn().mockResolvedValue(undefined);
const genVideo = vi.fn().mockResolvedValue(undefined);
const genAudio = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    assets: [],
    generateImage: genImage, generateVideo: genVideo, generateAudio: genAudio,
  } as never);
});

test('image:渲染 Size/Quality/Count pill 与高级设置入口', () => {
  render(<GenerateForm kind="image" onClose={() => {}} />);
  expect(screen.getByRole('button', { name: 'Size' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Quality' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Count' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Advanced settings' })).toBeInTheDocument();
});

test('image:设置参数后提交,body 含设置项;未设置项不发', async () => {
  render(<GenerateForm kind="image" onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the image/), { target: { value: '主角立绘' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quality' }));
  fireEvent.click(screen.getByRole('button', { name: 'high' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genImage).toHaveBeenCalled());
  expect(genImage).toHaveBeenCalledWith({ prompt: '主角立绘', quality: 'high' }, undefined);
});

test('audio:默认 Auto 不显示音色 pill,切到 Speech 后出现', async () => {
  render(<GenerateForm kind="audio" onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Voice' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Type' }));
  fireEvent.click(screen.getByRole('button', { name: 'Speech' }));
  expect(await screen.findByRole('button', { name: 'Voice' })).toBeInTheDocument();
});

test('video omni 模式:多选参考进 ref_image_item_ids', async () => {
  useStore.setState({
    assets: [asset({ id: 'img-1', key: 'k1' }), asset({ id: 'img-2', key: 'k2', label: '图B' })],
  } as never);
  render(<GenerateForm kind="video" onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the video/), { target: { value: '运镜' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reference' }));
  fireEvent.click(screen.getByTitle('图A'));
  fireEvent.click(screen.getByTitle('图B'));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genVideo).toHaveBeenCalled());
  expect(genVideo).toHaveBeenCalledWith({ prompt: '运镜', ref_image_item_ids: ['img-1', 'img-2'] }, undefined);
});

test('video 首尾帧模式(有 sourceId):不显示多选参考按钮', () => {
  useStore.setState({ assets: [asset({ id: 'src-1', key: 'ks' })] } as never);
  render(<GenerateForm kind="video" sourceId="src-1" onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: FAIL（pill 尚未渲染 / 提交 body 不含参数）

- [ ] **Step 3: 改造 GenerateForm.tsx**

整体替换为（保留原模型 pill、Esc、IME 逻辑，新增参数与引用区）：

```tsx
'use client';
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useStore } from '@/store';
import IconButton, { submitVariant } from '@/components/ui/IconButton';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { KIND_META } from '@/lib/asset-kind';
import { listVoicesCached } from '@/lib/pgc/voices';
import type { VoiceData } from '@/lib/pgc/types';
import type { CanvasGenImageRequest, CanvasGenAudioRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest } from '@/lib/pgc/types';
import type { Asset } from '@/store/types';
import { GEN_FIELDS, REF_LIMITS, buildGenBody, type GenKind, type GenParamValues, type RefSelection } from './gen-params';
import { AdvancedPill, ParamPill } from './GenParamControls';
import RefPicker from './RefPicker';

// 可选生成模型(占位:目前仅一项,后端暂不接收 model 参数,为多模型留接口)
const MODELS = [{ id: 'gvlm-3.1', name: 'GVLM 3.1' }] as const;

// 按资产类型给输入提示(audio 的 prompt 实际是要合成的 TTS 文本)
const PLACEHOLDER: Record<GenKind, string> = {
  image: 'Describe the image you want to generate…',
  video: 'Describe the video you want to generate…',
  audio: 'Enter the text to speak…',
  '3d': 'Describe the 3D world you want to generate…',
};

// Material 球体缩略图:近似设计稿的模型材质预览
const sphere =
  'size-5 shrink-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,#8f8f8f,#1c1c1c)] shadow-[inset_0_-1px_2px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.25)]';

// 引用 chip(源资产只读;多选参考可移除)
function RefChip({ a, onRemove }: { a: Asset; onRemove?: () => void }) {
  const thumb = a.preview?.dataUrl || a.preview?.src;
  return (
    <span className="flex items-center gap-2 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-fill)] py-1 pl-1 pr-2.5">
      <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-[7px] bg-[var(--color-surface-2)]">
        {thumb ? (
          a.kind === 'video'
            ? <video src={thumb} muted className="size-full object-cover" />
            : <img src={thumb} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <span className="size-2 rounded-full" style={{ background: KIND_META[a.kind].colorVar }} />
        )}
      </span>
      <span className="max-w-[120px] truncate text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)]">{a.label}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove ${a.label}`} onClick={onRemove} className="opacity-50 transition hover:opacity-100">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

// 画布生成弹窗:对齐 Figma「Prompt Input」(219:3133)。复用 Composer 卡片语言:
// 圆角卡 + 引用行 + prompt 输入 + 底部「模型/参数 pill / 高级设置 / 提交箭头」。
export default function GenerateForm({
  kind,
  sourceId,
  onClose,
}: {
  kind: GenKind;
  sourceId?: string;
  onClose: () => void;
}) {
  const generateImage = useStore((s) => s.generateImage);
  const generateAudio = useStore((s) => s.generateAudio);
  const generateVideo = useStore((s) => s.generateVideo);
  const generateModel3d = useStore((s) => s.generateModel3d);
  const assets = useStore((s) => s.assets);
  const dark = useStore((s) => s.theme) === 'dark';
  const source = sourceId ? assets.find((a) => a.id === sourceId) : undefined;
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];

  // 生成参数(仅记录用户设置过的项)与引用选择
  const [params, setParams] = useState<GenParamValues>({});
  const [refIds, setRefIds] = useState<string[]>([]);
  const [lastFrameId, setLastFrameId] = useState<string | undefined>();
  const setParam = (key: string, v: string | number | boolean | undefined) =>
    setParams((p) => ({ ...p, [key]: v }));

  // 音色列表:audio 且 kind=speech 时懒加载(模块级缓存 1h)
  const [voices, setVoices] = useState<VoiceData[] | null>(null);
  useEffect(() => {
    if (kind !== 'audio' || params.kind !== 'speech' || voices) return;
    void listVoicesCached().then(setVoices).catch(() => setVoices([]));
  }, [kind, params.kind, voices]);

  // 多选参考的可见性与上限:image=多图合成;video 仅 omni 模式(无 sourceId);audio/3d 不支持
  const refAssets = refIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  const refSel: RefSelection = { sourceId, refs: refAssets.map((a) => ({ id: a.id, kind: a.kind as GenKind })), lastFrameId };
  const canMultiRef = kind === 'image' || (kind === 'video' && !sourceId);
  const refAccept: GenKind[] = kind === 'image' ? ['image'] : ['image', 'video'];
  const refLimits = kind === 'image'
    ? { image: REF_LIMITS.image - (sourceId ? 1 : 0) }  // 源资产占一个名额(action 注入 source_item_id 后服务端合并)
    : { image: REF_LIMITS.videoImage, video: REF_LIMITS.videoVideo };
  const toggleRef = (a: Asset) =>
    setRefIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]));

  const fields = GEN_FIELDS[kind];
  const voiceOptions = voices?.map((v) => ({ value: v.voice_id, label: v.display_name }));
  const lastFrame = lastFrameId ? assets.find((a) => a.id === lastFrameId) : undefined;

  const hasText = prompt.trim().length > 0;
  const canSubmit = hasText && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const body = buildGenBody(kind, prompt, params, refSel);
      if (kind === 'image') await generateImage(body as CanvasGenImageRequest, sourceId);
      else if (kind === 'audio') await generateAudio(body as CanvasGenAudioRequest, sourceId);
      else if (kind === 'video') await generateVideo(body as CanvasGenVideoRequest, sourceId);
      else await generateModel3d(body as CanvasGenModel3DRequest, sourceId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  // Esc:先收起模型下拉,否则关闭弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (modelOpen) setModelOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modelOpen, onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 flex w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col gap-6 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        <div className="flex flex-col gap-3">
          {(source || canMultiRef) && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              {source && <RefChip a={source} />}
              {refAssets.map((a) => (
                <RefChip key={a.id} a={a} onRemove={() => toggleRef(a)} />
              ))}
              {canMultiRef && (
                <RefPicker accept={refAccept} selected={refIds} limits={refLimits} onToggle={toggleRef} />
              )}
            </div>
          )}
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              // 输入法(IME)组合期间的回车用于上屏候选词,不应触发提交
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={PLACEHOLDER[kind]}
            className="w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] outline-none placeholder:text-[var(--color-muted)]"
          />
        </div>

        <div className="flex items-end justify-between gap-2">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {/* 模型选择 pill + 下拉 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="flex h-10 items-center gap-3 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-[10px] shadow-[inset_0_0_2px_0_#fff] transition hover:brightness-[0.98]"
              >
                <span className="flex items-center gap-1">
                  <span className={sphere} />
                  <span className="text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{model.name}</span>
                </span>
                <FigIcon src={figAsset.chevronDown} size={16} className="opacity-70" />
              </button>
              {modelOpen && (
                <>
                  <div className="fixed inset-0 z-[55]" onClick={() => setModelOpen(false)} />
                  <div className="absolute bottom-[calc(100%+6px)] left-0 z-[56] flex min-w-[180px] flex-col rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
                    {MODELS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setModelId(m.id);
                          setModelOpen(false);
                        }}
                        className={`flex h-9 items-center gap-2 rounded-[12px] px-2 text-left transition-colors hover:bg-[var(--color-fill)] ${m.id === modelId ? 'bg-[var(--color-fill)]' : ''}`}
                      >
                        <span className={sphere} />
                        <span className="flex-1 text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{m.name}</span>
                        {m.id === modelId && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 常用参数 pill(按 schema 渲染;voice 选项来自 voices 接口) */}
            {fields.filter((f) => f.tier === 'pill').map((f) => (
              <ParamPill
                key={f.key}
                field={f}
                params={params}
                refs={refSel}
                onChange={setParam}
                optionsOverride={f.key === 'voice_id' ? voiceOptions : undefined}
              />
            ))}

            {/* 高级设置;video 首尾帧模式额外提供尾帧选择行 */}
            <AdvancedPill
              fields={fields}
              params={params}
              refs={refSel}
              onChange={setParam}
              extra={kind === 'video' && sourceId ? (
                <div className="flex min-h-9 items-center justify-between gap-3 px-2">
                  <span className="shrink-0 text-[12px] text-[var(--color-muted)]">Last frame</span>
                  {lastFrame ? (
                    <RefChip a={lastFrame} onRemove={() => setLastFrameId(undefined)} />
                  ) : (
                    <RefPicker
                      accept={['image']}
                      selected={lastFrameId ? [lastFrameId] : []}
                      limits={{ image: 1 }}
                      onToggle={(a) => setLastFrameId(a.id)}
                      single
                      label="Pick last frame"
                    />
                  )}
                </div>
              ) : undefined}
            />
          </div>

          {/* 提交 */}
          <IconButton
            variant={submitVariant(hasText, dark)}
            className={`size-10 shrink-0 ${hasText ? 'rounded-[10px]' : 'rounded-[12px]'}`}
            aria-label="Generate"
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <FigIcon src={figAsset.arrowUp} size={20} />
            )}
          </IconButton>
        </div>
      </div>
    </>
  );
}
```

要点：
- 卡片宽度 460→520px，底部参数 pill 区 `flex-wrap` 容纳多 pill
- image 打开自带 `sourceId` 时：源 chip 只读（与现状一致），多选名额减 1（服务端把 `source_item_id` 与 `source_item_ids` 合并去重）
- 原「引用行只读 chip」逻辑由 `RefChip` 承接，`thumb` 取值方式不变

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: 5 passed

- [ ] **Step 5: 跑全量测试防回归**

Run: `npm test`
Expected: 全部通过（若 store/actions 等既有用例失败，先确认是否本次改动引起）

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成弹窗接入参数 pill、高级设置与多引用选择"
```

---

### Task 7: 全量验证与手动走查

**Files:** 无新增

- [ ] **Step 1: 全量自动验证**

```bash
npm test
npx tsc --noEmit
npm run lint 2>/dev/null || true
```

Expected: 测试全过；tsc 本次改动文件无报错；lint 无新增告警

- [ ] **Step 2: 手动走查（npm run dev）**

按清单逐项确认：

1. 画布空白处分别打开 image/video/audio/3d 生成弹窗 → 各自 pill 正确（image: Size/Quality/Count；video: Duration/Ratio/Resolution；audio: Type；3d: Texture quality/Face limit/PBR）
2. image：高级设置选 Format=jpeg → Compression 滑条出现；移除 jpeg → 滑条消失
3. audio：Type 切 Speech → Voice/Duration pill 出现、高级区出现 speech 专属项；切回 Music → 全部隐藏
4. video（空白打开）：＋Add reference 多选两张图 → 提交请求 body 含 `ref_image_item_ids`（开发者工具 Network 确认）
5. video（从图片资产打开）：无多选按钮；高级设置可选尾帧 → body 含 `source_item_id` + `last_frame_item_id`
6. image（从图片资产打开）：源 chip 只读 + 可另选参考 → body 含 `source_item_ids`
7. 3d（从图片资产打开）：高级区出现 Texture align / Orientation
8. 未设置任何参数直接提交 → body 仅 `prompt`（行为与改造前等价）

- [ ] **Step 3: 收尾**

如手动走查发现问题：按 superpowers:systematic-debugging 处理后补提交。
全部通过后按 superpowers:finishing-a-development-branch 决定合并方式。

---

## Self-Review 记录

- **Spec 覆盖**：四类参数分配（Task 3 schema）、显隐联动与 422 规避（Task 3 buildGenBody + 测试）、多引用简化版（Task 5/6）、video 模式互斥（Task 3/6）、音色懒加载缓存（Task 2）、「未设置不进 body」（Task 3）、UI pill+popover 布局（Task 4/6）——均有对应任务。
- **不做项**：`model`/`model_version`/`name`/`moderation`/`emo`/试听 未出现在任何表单字段中，符合 spec。
- **类型一致性**：`GenParamValues`/`RefSelection`/`ParamField` 在 Task 3 定义、Task 4/6 引用一致；`listVoicesCached` 签名 Task 2 与 Task 6 一致；`REF_LIMITS` 键名 image/videoImage/videoVideo 全文一致。
