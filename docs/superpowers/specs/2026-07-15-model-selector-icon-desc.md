# 对话模型选择器:图标 + 文案说明

## 背景

Composer 的模型下拉(`ModelSelector` → 公共 `Select`)目前只显示模型展示名(如 "Opus 4.8")。参考官方 claude.ai 模型选择器,每个模型选项应带一个族图标和一句定位文案,帮助用户按需选择。

## 方案

- **族解析**(纯函数,`src/lib/koubou/models.ts`):新增 `modelFamily(id)`,从 `claude-<family>-…` ID 解析出 `'fable' | 'opus' | 'sonnet' | 'haiku'`,非 claude-* 或未知族返回 `null`。
- **公共 `Select` 扩展**:`SelectOption` 新增可选 `icon?: string`(FigIcon src)与 `description?: string`。选项带 description 时渲染双行(标题 + 12px muted 描述),icon 渲染在行首;不带时保持原单行样式,现有调用方(GenerateForm / 语言下拉)零改动。
- **图标**:按品牌取各家**官方字形**,不手绘。Anthropic 官方不区分模型字形,统一 Claude 星芒(Simple Icons 官方 shape,品牌色 #D97757,tone `original`);OpenAI / Grok / Seed(豆包)取自 LobeHub 官方图标包(单色 currentColor,tone 默认 `primary` 随主题翻转)。落 `public/figma/icons/model-{claude,openai,grok,seed}.svg`。
- **模型识别**(`modelMeta(id)`):claude-* 按族解析;非 claude 仅收录后端实际下发的已知 ID(`seed-2-0-code` / `gpt-5.5` / `gpt-5.4` / `grok-4.5`),同时给官方展示名(Seed 2.0 Code / GPT-5.5 / GPT-5.4 / Grok 4.5);未知模型返回 null,选项回退纯名称行。
- **文案**(六语,`chat.modelDesc.*`,取各家官方描述):
  - fable — Next-generation intelligence for long-running agents(官方 docs Models overview,下同)
  - opus — For complex agentic coding and enterprise work
  - sonnet — The best combination of speed and intelligence
  - haiku — The fastest model with near-frontier intelligence
  - seedCode — Seed coding model built for agentic software engineering(Seed 2.0 官方发布文)
  - gpt55 — OpenAI's smartest and most intuitive model yet(OpenAI 官方发布文)
  - gpt54 — OpenAI's frontier model for complex professional work(OpenAI 官方发布文)
  - grok45 — Frontier intelligence for coding and agents, fast and cost-efficient(xAI 官方发布文)
  - gpt56 — Frontier intelligence that scales with your ambition(OpenAI 官方发布文标语)
  - kimiK3 — Open-weight frontier model for long-horizon coding and agents(Moonshot Kimi K3 官方发布定位;图标同取 LobeHub 官方 Kimi 字形)
  - glm52 — Flagship open model for long-horizon tasks with 1M context(Z.ai GLM-5.2 官方模型卡定位「flagship model for long-horizon tasks / solid 1M-token context」;图标取 LobeHub 官方 Z.ai 字形)
- **`ModelSelector`**:按 `modelMeta` 挂品牌 icon + `t('chat.modelDesc.<desc>')`。

## 不做

- 触发钮(收起态)不加图标/描述,仍只显示当前模型名。
- 画布 GenerateForm 的生成模型下拉不动(那是媒体生成模型,与对话模型无关)。
