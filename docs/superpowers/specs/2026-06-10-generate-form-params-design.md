# 资产生成弹窗参数化改造设计

日期：2026-06-10
状态：已与 Nick 确认方向（常用层 + 高级设置折叠区；简化版多引用；底部参数 pill + popover 布局）

## 背景

后端资产生成接口（Apifox 最新定义）新增了大量透传参数，当前 `GenerateForm.tsx` 仅传 `prompt`（image 额外固定 `n: 1`）。本次改造让生成弹窗按资产类型提供可配置表单，覆盖全部值得露出的透传参数。

接口参数面（以 Apifox schema 为准）：

- **Image**（同步，对齐 OpenAI Images API 白名单）：`n`(1–4)、`size`、`quality`(low/medium/high/auto)、`background`(transparent/opaque/auto)、`output_format`(png/jpeg)、`output_compression`(0–100)、`moderation`(auto/low)、`input_fidelity`(low/high，仅图生图)、`source_item_id`/`source_item_ids`(≤8)、`model`、`name`
- **Audio**（同步，`kind` 分流）：`kind`(auto/speech/music/sound)、`expand`、`voice_id`、`output_format`(mp3/wav)、`speed`(0.25–4)、`duration`(speech 0–72 / music·sound 1–30)、`quality_preset`(1–10)、`emo`、`target_lang`、`trim_silence`、`similarity_enh`、`name`。speech 专属参数在 music/sound 下传入会 422
- **Video**（异步，对齐 Seedance 2.0）：`seconds`(1–30)、`resolution`(480p/720p/1080p)、`ratio`(16:9/4:3/1:1/3:4/9:16/21:9/adaptive)、`seed`、`watermark`、`camera_fixed`、`source_item_id`(首帧)、`last_frame_item_id`(尾帧)、`ref_image_item_ids`(≤9)、`ref_video_item_ids`(≤3)、`model`、`name`。首尾帧与 omni-reference 两种模式互斥，并存 422
- **Model3D**（异步，对齐 Tripo 白名单）：`source_item_id`(图生 3D)、`model_version`、`negative_prompt`、`texture`、`pbr`、`texture_quality`(standard/detailed)、`face_limit`(≥1)、`quad`、`style`、`auto_size`、`smart_low_poly`、`model_seed`/`texture_seed`/`image_seed`、`texture_alignment`/`orientation`(仅图生 3D，纯文生传入 422)、`name`
- 新接口 **`GET /api/gen/audio/voices`**：系统音色列表（`voice_id`/`display_name`/`labels`/`sample_url`），服务端 1h 缓存

## 整体架构

保持现有 460px 紧凑卡片与底部 bar 设计语言，改造分四层：

### 1. 参数声明层（新增 `src/components/canvas/gen-params.ts`）

用声明式 schema 描述每种资产类型的参数：

- 字段：`key`、`label`、控件类型（`select` / `stepper` / `toggle` / `slider` / `number` / `text`）、可选值、默认值
- 层级：`pill`（底部常用层）或 `advanced`（高级设置面板）
- 显隐条件 `visibleWhen(params, ctx)`：如 speech 专属、有参考图时才显示、仅 jpeg 时启用 compression
- 纯函数 `buildGenBody(kind, prompt, params, refs)` 产出请求 body，单元测试友好

### 2. UI 渲染层（改造 `GenerateForm.tsx`）

- 底部 bar 按 schema 渲染参数 pill，复用现有模型下拉的 popover 交互语言（上拉面板、Esc 先收起再关弹窗）
- 最右增加 ⚙ 高级设置 pill，弹出分组面板渲染 `advanced` 层字段
- 不引入表单库，沿用 `useState`；参数状态为单个 `params` 对象

### 3. 类型/请求层

- `src/lib/pgc/types.ts` 按 Apifox schema 补全 `CanvasGenImageRequest` / `CanvasGenAudioRequest` / `CanvasGenVideoRequest` / `CanvasGenModel3DRequest`
- store 的 `generateImage` / `generateAudio` / `generateVideo` / `generateModel3d` actions 透传完整 body（保留现有 `sourceItemId` 注入与 reference 连线逻辑）

### 4. 音色数据

- 新增 client 方法 `listAudioVoices()`（`GET /api/gen/audio/voices`）
- 打开音色 pill 时懒加载，模块级缓存 1 小时（对齐服务端缓存）
- 音色下拉项展示 `display_name`，`labels` 作为辅助说明；本次不做 `sample_url` 试听

## 各类型参数分配

| 类型 | 底部 pill（常用层） | 高级设置 popover |
|---|---|---|
| **Image** | 尺寸（1024x1024/1536x1024/1024x1536/auto）、质量 quality、张数 n（×1–4） | background、output_format、output_compression（仅 jpeg 时启用）、input_fidelity（仅有参考图时显示） |
| **Audio** | 类型 kind（auto/语音/音乐/音效）、音色 voice_id（仅 speech）、时长 duration | 智能扩写 expand、语速 speed、output_format、quality_preset、trim_silence、target_lang、similarity_enh（speech 专属项随 kind 联动显隐，规避 422） |
| **Video** | 时长 seconds、比例 ratio、分辨率 resolution | watermark、camera_fixed、seed、尾帧选择（仅首尾帧模式） |
| **3D** | 贴图质量 texture_quality、面数 face_limit、PBR | negative_prompt、texture、quad、auto_size、smart_low_poly、model_seed/texture_seed/image_seed、texture_alignment/orientation（仅图生 3D 时显示） |

**明确不做**：

- `model` / `model_version` / `name` / `moderation`：服务端配置或自动生成，前端不露出
- audio 的 `emo` 情绪权重表：map 型输入复杂度高、受众窄，留待后续迭代
- `sample_url` 音色试听：本次不做
- audio 的 `duration` 语义随 kind 切换：speech 为 0–72s 目标时长（0/不传=自然节奏），music/sound 为 1–30s 成品长度；控件随 kind 联动调整范围与提示

## 简化版多引用

引用行从「单个只读 chip」升级为「chip 列表 + ＋添加参考按钮」，点击弹出画布资产缩略图多选 popover：

- **Image**：多选画布图片（≤8）→ `source_item_ids`；从单个资产打开时该资产预选入列表
- **Video**：用入口区分两种互斥模式，规避 422 冲突：
  - 从某个资产打开（有 `sourceId`）→ **首尾帧模式**：源资产为首帧（`source_item_id`），高级设置中可单选图片作尾帧（`last_frame_item_id`），多选参考按钮隐藏
  - 空白处打开 → **omni-reference 模式**：多选图片（≤9）→ `ref_image_item_ids`，视频（≤3）→ `ref_video_item_ids`
- **3D**：维持单源 chip（图生 3D）；`texture_alignment` / `orientation` 仅有源图时显示
- **Audio**：无引用行

多选 popover 按目标类型过滤画布资产（image 生成只列图片；video omni 模式列图片与视频），达到数量上限后禁用未选项。

## 提交与校验

- 仅发送用户实际设置过的参数（undefined 不进 body），避免把前端默认值固化到后端
- 控件层面用枚举/范围约束兜住非法值（stepper 限 1–4、slider 限 0–100、number 输入 clamp），不做自由文本尺寸输入
- speech 专属参数在 kind 切到 music/sound 时从 body 中剔除（schema 显隐条件 + buildGenBody 双重保证）
- 错误处理沿用现有 store 流程，422/503 的 message 走已有提示路径

## 测试

沿用现有 vitest 体系（参考 `AssetChip.test.tsx`），重点覆盖 `gen-params` 纯函数：

- 各 kind 的 body 构建：默认不发未设置参数；设置后正确进 body
- speech 专属字段在 music/sound 下不进 body
- video 两种模式互斥：首尾帧模式不发 ref ids，omni 模式不发 last_frame
- 引用数量上限截断（image ≤8、ref image ≤9、ref video ≤3）
- 显隐条件：input_fidelity 仅有参考图、compression 仅 jpeg、texture_alignment 仅图生 3D
