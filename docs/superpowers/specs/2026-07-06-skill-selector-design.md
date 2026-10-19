# Skill 选择功能设计（Composer 斜杠命令 + Skill 弹窗 + 内联胶囊）

日期：2026-07-06
设计稿：
- Skill 弹窗：Figma node `2245:29154`
- 弹窗空态：Figma node `2245:38457`
- 输入框胶囊：Figma node `2245:38540`

## 背景与目标

用户在 Composer 中输入 `/` 唤起 Skill 弹窗，选择一个 skill 后在输入框内呈现为青色内联胶囊（如 `/plan`），消息以纯文本前缀 `/slug` 的形式经 Koubou WS 发给后端，由 agent 自动调用对应 skill。

后端契约（apifox 项目 8405123，endpoint 481739480，已确认）：

```
GET /game/koubou/skills?backend=cc   # 公开接口，无需鉴权；backend 缺省 cc
→ { code: 0, message: "ok", data: { backend: string, skills: [{ name: string }] } }
```

**后端只返回 slug（`name`）**，显示名与描述由前端 i18n 词典按 slug 映射（六语 en/zh/fr/ru/ja/vi，en 为真相源）。

## 已确认的决策

1. **发送语义**：胶囊序列化为纯文本 `/slug`，与 Claude Code 斜杠命令语义一致，后端无新字段；`send()` / `steer()` 链路零改动。
2. **未知 slug 降级**：后端返回但词典未登记的 skill 仍进列表，显示名 = slug、描述空；输入框内的胶囊高亮以「后端返回的 skill 集合」为准（含降级项），不在集合内的 `/xxx` 保持普通文本。
3. **触发与数量**：任意位置词首 `/` 触发，可插入多个胶囊（与 @ mention 同型）。
4. **胶囊实现**：方案 B——textarea 底衬高亮（highlight-overlay），不重写为 contentEditable。

## 架构

### 1. 数据层

- `src/lib/koubou/client.ts` 新增 `listSkills(): Promise<string[]>`，经现有 Koubou 代理请求 `apiPath('/api/koubou/skills?backend=cc')`，解析 `code===0` 信封，返回 slug 数组。
- store（ServerState）新增 `skills: string[]`（初始 `[]`）与 action `loadSkills()`：全局拉取一次（与项目无关），不持久化、不按项目分桶；失败静默置空（弹窗显示空态，不 Toast）。
- 拉取时机：`useProjectBootstrap` 启动时并行拉取（幂等，已有值不重复拉）。

### 2. i18n 词典

`src/i18n/locales/*.ts` 六语各新增：

```
skills: {
  plan:               { name, description },
  'char-ref':         { name, description },
  cutout:             { name, description },
  'sprite-animation': { name, description },
}
```

en 文案对齐设计稿：Game Design / Produce game design documents；Role Consistency / Make the same character consistent across scenes；Smart Cutout / Cut creatives into transparent PNG.；Elf Animation / Generate walking, attack and other frame animation sprite maps。其余五语翻译补齐。查询用 `t(`skills.${slug}.name`, { defaultValue: slug })` 实现降级。

### 3. 斜杠触发（纯函数）

新增 `src/lib/skills.ts`：

- `getActiveSlash(text, caret): { query, start } | null` —— 光标前最近一个处于词首（字符串首/换行后/空白后）的 `/`，`/` 与光标之间不含空白时激活；`query` 为其后片段。与 `getActiveMention` 并存互不干扰（`@` 激活时不判 `/`，反之亦然，取更靠近光标者）。
- `splitSkillTokens(text, skills): Segment[]` —— 把文本切成 `{ kind: 'plain' | 'skill', text }` 片段：匹配「词首 `/` + 已知 slug + 词尾边界（空白/串尾）」的 token 记为 skill 片段。供底衬渲染。

### 4. SkillPopover 组件

`src/components/chat/SkillPopover.tsx`，仿 `MentionPopover`：

- 标题栏 "Skill"；列表项 = 本地化显示名（粗体）+ `/slug` 青色小胶囊（`--color-teal-soft` 底 / teal 字，对齐设计稿）+ 灰色描述（`--color-muted`）。
- 过滤：query 同时匹配 slug 与本地化显示名（不区分大小写，包含匹配）。
- 空态："No matching skill"（i18n）。
- 底部固定提示条："The agent will automatically invoke these skills."（i18n）。
- 键盘 ↑↓ 移动、Enter 选择、Esc 关闭；点击选择。浮层样式走既有令牌：`bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]` + `.anim-pop-in`。
- 选中：把 draft 中 `/query` 段替换为 `/slug `（尾随空格），光标移至其后并聚焦。

### 5. 内联胶囊（底衬高亮）

Composer 的 textarea 外包定位容器，textarea 之下叠镜像层：

- 镜像层与 textarea 字体、字号、行高、padding、`white-space: pre-wrap`、word-break 完全一致，尺寸随 textarea，滚动位置同步（onScroll 同步 scrollTop）。
- 文字渲染整体移交镜像层：textarea `color: transparent` + `caret-color: var(--color-ink)`，placeholder 保持可见（placeholder 不受 text color 透明影响需单独处理：用 `::placeholder { color: var(--color-muted) }` 显式指定）。选区高亮由浏览器默认行为保留。
- 镜像层用 `splitSkillTokens(draft, skills)` 渲染：skill 片段包青色胶囊（teal 底、白字、小圆角、微 padding——胶囊行内呈现不得改变字符排版宽度，视觉 padding 用 `box-decoration-break` + 负 margin 或仅背景色圆角实现，以保证镜像与 textarea 逐字符对齐），plain 片段正常 `--color-ink`。
- 镜像层 `pointer-events: none`、`aria-hidden`。

> 关键不变式：镜像层任何样式不得改变文本流布局（不加水平 padding/margin 于字符流），否则光标错位。

### 6. 发送

零改动。draft 即含 `/slug` 的纯文本，`send()`（含气泡文本、steer、image blocks 组装）原样工作。用户消息气泡本期不做胶囊化渲染。

## 错误处理

- `listSkills` 失败：静默，`skills` 保持 `[]`，弹窗直接空态；不阻断输入与发送。
- 非法/未知信封：按现有 Koubou client 错误路径抛出，由 `loadSkills` 捕获置空。

## 测试

- `getActiveSlash`：词首/行首/空白后激活、词中 `/` 不激活、空白终止、与 `@` 共存取近者。
- `splitSkillTokens`：多 token、词尾边界、未知 slug 不切分、空 skills。
- `SkillPopover`：渲染四项、query 过滤（slug 与显示名）、空态文案、键盘选择回调、未知 slug 降级显示。
- `listSkills`：信封成功/`code!==0`/网络错误。
- Composer 集成：输入 `/` 弹窗、选中后 draft 被替换为 `/slug `。

## 范围外

- 用户消息气泡内的胶囊渲染。
- skill 的启用/禁用管理、后端 backend=codex/single 支持。
