# 接入 Seed 系图像 / 音频生成模型（设计稿）

2026-08-10

## 目的

把后端已接入的两个 seed 系模型露出到画布生成弹窗：

1. **图像** `dola-seedream-5-0-pro-260628`（Seedream 5.0 Pro，BytePlus Ark）——加入图像模型下拉，第三档。
2. **音频** `seed-audio-1.0`（Seed-Audio 1.0，BytePlus Voice）——音频**首次**出现模型下拉，与默认的 Noiz 并列。

要求是「选了就能正常出片」：所选模型不支持的参数不出现在 UI、也不进 body；模型特有的取值范围（张数、时长）随选择切换。

## 现状（核验于 2026-08-10）

- `src/components/canvas/gen-models.ts`：`GEN_MODELS.image` 只有 `gemini-3.1-flash-image`(默认) / `gpt-image-2`；`GEN_MODELS.audio = []`，`MODEL_FIELD.audio = null` —— **音频从来没有模型下拉**（`Select` 0 项不渲染）。
- `modelBody(kind, modelValue)` 的既有语义：选中 `isDefault` 项 → 返回 `{}`（不下发模型字段，由服务端定默认）；非默认 → `{ [MODEL_FIELD[kind]]: value }`。
- `src/components/canvas/gen-params.ts`：`ParamField.models` 是**白名单**——未声明 = 全模型通用；声明则须命中当前模型。`fieldForModel` 同时驱动 UI 渲染与 `buildGenBody` 组装，保证「看不到的参数 = 不会下发」。图像的 6 个 GPT 专属字段现在挂 `GPT_ONLY`。
- `buildGenBody` 里对 music/sound 的 `duration` 硬编码夹到 `1..30`（Noiz 上限）。
- `src/i18n/errors.ts` 的 `resolveErrorMessage`：`ERROR_KEYS` 未收录的 code 回退后端原 `message`（英文）。
- `src/lib/pgc/types.ts` 的 `CanvasGenAudioRequest` **没有 `model` 字段**（图像/视频有）。

后端契约（`rezonalab-game-server/docs/api/canvas.md`，dev 分支，核对于 2026-08-10）：

| 事项 | Seedream 5.0 Pro | Seed-Audio 1.0 |
|---|---|---|
| 参数名 | `model: "dola-seedream-5-0-pro-260628"` | `model: "seed-audio-1.0"` |
| flag 门控 | `pgc-seedream-image`，关 → `503 SEEDREAM_IMAGE_DISABLED` | `pgc-seedaudio-speech`，关 → `503 SEEDAUDIO_SPEECH_DISABLED` |
| 不支持的参数 | `quality/background/output_compression/moderation/input_fidelity` **整类忽略**（回显 `ignored_params`，不 422） | Noiz 专属 `quality_preset/emo/target_lang/trim_silence/similarity_enh` → **422 GENERATION_PARAMETER_UNSUPPORTED**（不静默丢弃） |
| 原生支持 | `output_format` png/jpeg | `speed`（0.5x~2.0x 外由服务端封顶）、`output_format` |
| 数量 / 时长 | `n` **仅 1**，`n>1` → 422 | music/sound `duration` **1..120**（Noiz 为 1..30）；speech 上游不收 `duration`（服务端按文本推导计费） |
| 尺寸 / 音色 | `size` 取 `auto` 或 `宽x高`，总像素须在 1280x720..2048x2048 | speech 的 `voice_id` 走 BytePlus TTS2.0 命名空间，**不在 `GET /audio/voices` 列表里** |
| 专属新参数 | `watermark`、`prompt_mode`(`standard`/`fast`) | `sample_rate`(int 枚举)、`pitch_rate`(-12..12，仅 speech)、`loudness_rate`(-50..100)、`watermark` |

### 后端文档 2026-08-10 修订（第二版）

同日后端更新了文档（`+14` 行），带来三件事：

1. **两模型各自的专属新参数**（见上表末行）。其中 `prompt_mode=standard` 后端实测**单图 >120s**；前端图像/音频走 `SLOW_TIMEOUT_MS = 300s`，不会撞超时，但用户会干等。
2. **Seed-Audio 新增两个参考素材入参**：`reference_item_ids`（≤3 个画布音频，音色克隆，prompt 里 `@Audio1`…引用）、`reference_image_item_id`（画布图片，按图配音）；二者与 `voice_id` 三方互斥。
3. **⚠️ 文档内部自相矛盾（待后端澄清）**：`model` 参数行仍写「Noiz 专属 TTS 字段传给 Seed-Audio → `422 GENERATION_PARAMETER_UNSUPPORTED`（不静默丢弃）」，而新增的「超集入参 + 按 model 分流」段落写「整类不支持的字段**静默忽略** + `ignored_params` 回显，调用方无需按 provider 裁剪」。本设计稿采取的策略（该模型下隐藏、不下发）**在两种口径下都安全**，故不阻塞实现；后端对齐后无需改前端。

## 约束

- **不臆测后端字段**（项目反模式）：文档没给的一律不造。Seed-Audio 的音色 id 文档一个都没列，前端不得硬编码任何 id。
- 「看不到的参数 = 不会下发」这条既有不变式必须继续成立——按模型分档只准走 `fieldForModel` 这一个判定点，不引入第二套过滤路径。
- 不新增 UI 组件种类、不改动 `Select` / `ParamPill` / `AdvancedPill` 的外观；模型下拉的第三档、音频下拉的两档都由既有 `Select` 自动承载（>1 项即可展开）。
- flag 状态**无接口可查**，前端不做探测、不加 env 开关。
- i18n 形状以 `en` 为单一真相源，新增 key 须补齐全部 11 个语种（tsc 会强制）。

## 决策（盘问结论，2026-08-10）

1. **Seed-Audio + speech 的音色**：**隐藏音色选择**。选 Seed-Audio 时不渲染 `voice_id` pill、也不下发，由服务端用默认音色。理由：前端拿不到该命名空间的合法 id，硬编码等于凭空编造后端契约；等后端把 Seed-Audio 音色并进 `/voices` 或另开列表接口再补。
2. **flag 门控**：**模型无条件展示**，真碰上关闭就走现有 `guard → Toast`，并在 `ERROR_KEYS` + 11 语 i18n 里补 `SEEDREAM_IMAGE_DISABLED` / `SEEDAUDIO_SPEECH_DISABLED` 两条中文可读文案（否则只会弹后端英文原文）。不加 env 开关——三套环境各自维护一份前端配置必然与后端 flag 漂移。
3. **音频默认项命名**：`Noiz Audio`。与 image/video 下拉已有的「Gemini 3.1 Flash Image」「Seedance 2.0」一致，都是真实模型/服务名，不需要 i18n。

文档第二版后补问的两条：

4. **参考素材（音色克隆 / 按图配音）另起一轮**。它不是参数而是一整套引用交互：画布音频卡目前根本不能被选为引用（`canMultiRef` 只对 image/video 开、`DERIVE_MATRIX` 里 audio 派生为空），还要设计 `voice_id` / 参考音频 / 参考图 的三选一互斥 UI 与画布连线。与本轮「参数分档」边界不同，捏在一起会把一个已验证的回合拖成大改。
5. **`prompt_mode` 放 pill 层、不预设值**。它显著影响等待时长（standard 单图 >120s），藏进高级面板用户找不到；但仍沿用「未设置不进 body、默认档交服务端配置」的既有语义，不由前端硬替后端选默认。

## 方案

### A. 模型注册（`gen-models.ts`）

```
MODEL_FIELD.audio: null → 'model'

GEN_MODELS.image  += { value: 'dola-seedream-5-0-pro-260628', label: 'Seedream 5.0 Pro' }
GEN_MODELS.audio   = [{ value: 'noiz', label: 'Noiz Audio', isDefault: true },
                      { value: 'seed-audio-1.0', label: 'Seed-Audio 1.0' }]
```

`'noiz'` 是**前端哨兵值**，不是后端模型名：它被标记 `isDefault`，`modelBody` 对默认项返回 `{}`，故永远不会下发到 body（对应文档的「不传 model = 走 Noiz」）。同时它作为 `ParamField.models` 白名单里的键，用来表达「仅 Noiz 支持」的字段。这一点必须有测试钉死。

### B. 参数按模型分档（`gen-params.ts`）

**先给 `ParamField` 补一个黑名单维度 `notModels`**（实现时确认必要）：现有的 `models` 是白名单，而 `fieldForModel` 对 `model === undefined` 的既定语义是「按各类型默认档处理」——白名单字段一律排除。`n`、`voice_id`、四个 Noiz TTS 字段都是**通用参数的个别例外**（只有某一个模型不收），用白名单表达就得把所有其它模型名逐一列进去，既冗余又会让 `undefined` 语义从「默认档」退化成「什么都不支持」。故 `fieldForModel` 扩成「白名单命中 且 黑名单不命中」，仍是同一个判定点，UI 与 body 共用不变。

**图像**
- `output_format`：`models` 从 `GPT_ONLY` 扩成 `[gpt-image-2, seedream]`（Seedream 原生支持 png/jpeg）。
- `n`：加 `notModels: [seedream]` —— Seedream 下隐藏，不下发即等价 `n=1`，从 UI 上根除 `n>1` 的 422。
- 其余 5 个 GPT 专属字段维持 `GPT_ONLY`：Seedream 虽然只是「忽略」，但既然它整类不支持，就不该出现在表单里。
- `size` 三个预设 `1024x1024` / `1536x1024` / `1024x1536` 与 `auto` 全部落在 Seedream 的像素区间内，**不需要改**。

- Seedream 专属两项：`prompt_mode` 进 **pill 层**（决策 5）、`watermark` 进高级，均 `models: [seedream]`。

**音频**
- `voice_id` / `quality_preset` / `trim_silence` / `target_lang` / `similarity_enh`：全部加 `notModels: ['seed-audio-1.0']`。后四者是 Noiz 专属（Seed-Audio 下传入 422），`voice_id` 按决策 1 隐藏。
- Seed-Audio 专属四项全进高级，均 `models: ['seed-audio-1.0']`：`sample_rate`（select 六档）、`pitch_rate`（slider -12..12，`visibleWhen: isSpeech`——显式 music/sound 传入会 422）、`loudness_rate`（slider -50..100，全 kind）、`watermark`（toggle）。
- **`sample_rate` 的类型坑**：`select` 控件恒产字符串，而后端 schema 收 int。给 `ParamField` 加 `numeric?: true` 标记，`buildGenBody` 写入前转 `Number`——对齐仓库既有的「尊重契约类型」做法（`canvas_x/y` 取整再传），不指望后端做隐式转换。
- `duration` **拆成两条同名字段**，靠互斥的白/黑名单二选一（过滤后不会重复，React key 与 body 组装都安全）：
  - Noiz：`notModels: ['seed-audio-1.0']`，`number 0..72`，`visibleWhen: hasKind`（沿用现状）。
  - Seed-Audio：`models: ['seed-audio-1.0']`，`number 1..120`，`visibleWhen:` 仅 music/sound —— speech 下上游根本不收该参数，露出来会误导用户以为能控时长。
- `kind` / `expand` / `output_format` / `speed`：两个 provider 都支持，保持通用。

**`buildGenBody` 的 duration 夹取**：现在硬编码 `1..30`，改为按模型取上限（Noiz 30 / Seed-Audio 120）。该函数已经接收 `model` 参数，不需要改签名。

### C. 表单接线（`GenerateForm.tsx`）

- 音色列表懒加载的 effect 追加 `modelId === 'noiz'` 条件：选 Seed-Audio 时不再无谓地打 `/audio/voices`。
- 其余不改：`models[0]` 现在对 audio 有值，`modelId` 初始即 `'noiz'`；`fields` 已按 `fieldForModel` 过滤，两条 `duration` 只会活下来一条。

### D. 类型与错误文案

- `CanvasGenAudioRequest` 补 `model?: string | null`，并把 `duration` 注释里的 `1-30` 修正为随 provider 变。
- `ERROR_KEYS` 注册两个 503 code → `errors.SEEDREAM_IMAGE_DISABLED` / `errors.SEEDAUDIO_SPEECH_DISABLED`，11 语补文案（大意：该模型当前未开放，请换一个模型或稍后再试）。

## 非目标

- **Seed-Audio 参考素材**（`reference_item_ids` / `reference_image_item_id`）：见决策 4，另起一轮；本轮连类型都不落，避免留下没有消费方的 dead code。
- 不补文档里存在但前端未接入的其它能力：`transparent` 透明背景、`gemini-2.5-flash-image` / `gemini-3-pro-image` 两个 Gemini 变体、`emo` 情感参数、`ignored_params` / `transparency_applied` 的 UI 呈现。它们与本需求正交，各自单独成轮。（`enable_subtitle` 后端也明确暂未开放。）
- 不为 Seed-Audio 造音色列表（见决策 1）。
- 不改 `size` 预设，不做像素区间的前端校验（现有预设全部合法，越界只可能来自后续新增预设）。

## 成功标准

1. 图像下拉出现第三项「Seedream 5.0 Pro」；选中后表单只剩 `size` / `output_format`（+ 高级里无 GPT 专属项），提交 body 形如 `{ prompt, model: 'dola-seedream-5-0-pro-260628', ... }` 且**不含** `n` 与 5 个 GPT 专属字段。
2. 音频下拉出现两项；选「Noiz Audio」时 body **不含** `model`，且全部既有参数（含 `voice_id`）行为与本次改动前**逐字节一致**（回归不变）。
3. 选「Seed-Audio 1.0」时 body 含 `model: 'seed-audio-1.0'`，**不含** `voice_id/quality_preset/trim_silence/target_lang/similarity_enh`；`kind=music/sound` 时 `duration` 可填到 120 且按 `1..120` 夹取；`kind=speech` 时不出现 `duration`。
4. flag 关闭导致的 503 在 Toast 里显示中文可读文案，而非后端英文原文。
5. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。
