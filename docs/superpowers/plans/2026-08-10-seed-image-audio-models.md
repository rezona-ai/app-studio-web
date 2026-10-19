# 接入 Seed 系图像 / 音频生成模型（实现计划）

2026-08-10 · 设计稿：`docs/superpowers/specs/2026-08-10-seed-image-audio-models-design.md`

分支 `feat/seed-gen-models`（worktree），基线 `dev@611eec9`。四个任务各自可独立跑测试、独立评审，按序提交。

## 全局约束

- TDD：每个任务先写失败测试，再改生产代码。测试与源码同目录。
- 「看不到的参数 = 不会下发」不变式由 `fieldForModel` 单点保证，不得新增第二条过滤路径。
- 不硬编码任何后端未给出的 id / 模型名。
- 每个任务结束跑 `pnpm exec vitest run <该任务涉及的测试文件>`；全部完成后跑完整四件套。

## 任务 1：模型注册 + 音频请求类型

**改动**
- `src/lib/pgc/types.ts`：`CanvasGenAudioRequest` 增 `model?: string | null`；修正 `duration` 注释（music/sound 上限随 provider：Noiz 30 / Seed-Audio 120）。
- `src/components/canvas/gen-models.ts`：
  - `MODEL_FIELD.audio` `null → 'model'`。
  - `GEN_MODELS.image` 追加 `{ value: 'dola-seedream-5-0-pro-260628', label: 'Seedream 5.0 Pro' }`。
  - `GEN_MODELS.audio` 填入 `noiz`(默认) + `seed-audio-1.0`。
  - 注释写明 `'noiz'` 是不下发的前端哨兵值及其两个用途（默认项 / `models` 白名单键）。

**测试**（`gen-models.test.ts`，含既有用例改写）
- `modelBody('audio', 'noiz') === {}`（哨兵值绝不进 body —— 这是最关键的一条）。
- `modelBody('audio', 'seed-audio-1.0') === { model: 'seed-audio-1.0' }`。
- `modelBody('image', 'dola-seedream-5-0-pro-260628') === { model: '...' }`。
- 既有的 `MODEL_FIELD` 全等断言、`GEN_MODELS.image` 值序列断言、`GEN_MODELS.audio === []`、`modelBody('audio','anything') === {}` 四条会红，按新契约改写（`audio` 的「未知模型名」用例改为断言 `{ model: 'anything' }`，与 image/video 同构）。
- 每类恰好一个 `isDefault` 的既有不变式对 audio 同样成立。

**验证**：`pnpm exec vitest run src/components/canvas/gen-models.test.ts`
**提交**：`feat(canvas): 注册 Seedream 5.0 Pro 与 Seed-Audio 1.0 两个生成模型`

## 任务 2：参数按模型分档

**改动**（`src/components/canvas/gen-params.ts`）
- 新增常量：`SEEDREAM = 'dola-seedream-5-0-pro-260628'`、`SEED_AUDIO = 'seed-audio-1.0'`、`NOIZ = 'noiz'`。
- image：`output_format.models = [...GPT_ONLY, SEEDREAM]`；`n.models = ['gemini-3.1-flash-image', 'gpt-image-2']`。
- audio：`voice_id` / `quality_preset` / `trim_silence` / `target_lang` / `similarity_enh` 加 `models: [NOIZ]`；`duration` 拆两条（Noiz `0..72` + `hasKind`；Seed-Audio `1..120` + 仅 music/sound）。
- `buildGenBody` 的 music/sound `duration` 夹取上限按 `model` 取（Noiz 30 / Seed-Audio 120），下限恒 1。

**测试**（`gen-params.test.ts`）
- Seedream：body 不含 `n` / `quality` / `background` / `moderation` / `input_fidelity` / `output_compression`，含 `size` 与 `output_format`。
- Gemini / GPT 既有行为不回归（既有用例应全绿，不改）。
- Seed-Audio：body 不含五个 Noiz 专属字段；`kind=music` + `duration=200` → 夹到 `120`；`kind=speech` 不含 `duration`。
- Noiz：`kind=sound` + `duration=200` → 仍夹到 `30`；speech 全参数原样下发（回归护栏）。
- 两条 `duration` 在任一模型下经 `fieldForModel` 过滤后**恰好剩一条**（保 React key 唯一 + body 无歧义）。

**验证**：`pnpm exec vitest run src/components/canvas/gen-params.test.ts`
**提交**：`feat(canvas): 生成参数按所选模型分档,seed 模型剔除其不支持的字段`

## 任务 3：表单接线

**改动**（`src/components/canvas/GenerateForm.tsx`）：音色懒加载 effect 增加 `modelId === 'noiz'` 条件（依赖数组同步加 `modelId`）。

**测试**（`GenerateForm.test.tsx`）
- audio 弹窗现在渲染模型下拉（此前 0 项不渲染），默认选中 Noiz Audio，提交 body 不含 `model`。
- 切到 Seed-Audio 1.0 后提交，body 含 `model: 'seed-audio-1.0'`。
- 选 Seed-Audio + `kind=speech` 时不渲染音色 pill、且不发 `/audio/voices` 请求。

**验证**：`pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`
**提交**：`feat(canvas): 生成弹窗接入音频模型选择,Seed-Audio 下不拉 Noiz 音色`

## 任务 4：503 错误文案

**改动**
- `src/i18n/errors.ts`：`ERROR_KEYS` 增两条 code → key 映射。
- `src/i18n/locales/en.ts` 先加（canonical），再补 zh / zh-TW / ja / ko / de / es / fr / pt / ru / vi 共 11 语。

**测试**：`src/i18n/i18n.test.ts` 既有 key 一致性用例覆盖 en/zh/vi/fr/ru/ja；其余语种由 `Messages` 类型 + `tsc` 兜底。补一条 `resolveErrorMessage('SEEDREAM_IMAGE_DISABLED', ...)` 返回译文而非 fallback 的用例（`errors.test.ts`）。

**验证**：`pnpm exec vitest run src/i18n`
**提交**：`feat(i18n): 补 seed 模型 flag 关闭时的 503 文案`

## 任务 5：文档第二版新增的专属参数

后端同日修订文档后追加（决策 4/5 见设计稿）。

**改动**
- `src/lib/pgc/types.ts`：image 加 `watermark` / `prompt_mode`；audio 加 `sample_rate` / `pitch_rate` / `loudness_rate` / `watermark`。参考素材两项**不落类型**（另轮做，不留 dead code）。
- `src/components/canvas/gen-params.ts`：`ParamField` 加 `numeric?: true`，`buildGenBody` 写入前把标记字段的 select 字符串转 `Number`；按上表新增 6 个字段（`prompt_mode` 进 pill，其余进高级）。
- i18n 新增 4 个 label（`promptMode` / `sampleRate` / `pitch` / `loudness`）× 11 语；`watermark` 复用既有 key。

**测试**
- `gen-params.test.ts`：Seedream 专属两项只在该模型进 body（GPT 与默认档下剔除）；Seed-Audio 四项同理，且 `sample_rate` 下发的是 **number 44100 而非字符串**；`pitch_rate` 仅 speech。
- `GenerateForm.test.tsx`：切到 Seedream 后 `Count` pill 消失、`Prompt mode` pill 出现。

**验证**：`pnpm exec vitest run src/components/canvas src/i18n`
**提交**：`feat(canvas): 接入 seed 两模型的专属参数`

## 收尾

1. 全量验证：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四条命令的完整输出与退出码留档。
2. 自审全分支 diff（对照本计划与设计稿逐条核）。
3. `--no-ff` 合回 `dev`，在合并结果上重跑全量验证。
4. worktree / 分支的清理动作先问 Nick。
