# 生成前估价：不再盲付

> 状态：设计稿 · 2026-08-06
> 后端契约：`pgc-server` `docs/api/canvas.md` 的
> `POST /api/projects/{project_id}/canvas/items/generate/estimate`
> 契约已真机确认（见文末「契约核实」）：请求体是**扁平**的，端点已在 dev 上线

## 目的

画布生成是付费动作，而表单里**完全没有价格概念**——用户点「生成」之前不知道要花多少，
只能等扣完看余额。后端给了零副作用的估价端点（不调 provider、不预留额度、不落任务行，
故 ARTGEN/TRIPO 未配也能报价），把「不盲付」这件事补上。

关键便利：**请求体与真实生成入参完全同构**，前端已有的 `buildGenBody`（`gen-params.ts:131`）
产出的就是扁平 body，加一个 `type` 判别器即可 —— **不必维护第二套参数映射**。

## 三个已定的决策（盘问结论）

1. **自动重报、报价常驻**：`prompt` 以外的任何参数变化（模型 / 张数 / 时长 / 分辨率 / 音频 kind…）
   都 debounce 重报，报价常驻显示。付费产品里用户调参时就该实时看到价格变化。
   **`prompt` 不参与重报** —— 它与定价无关。⚠️ 原先这条的依据只是「后端把 `prompt` 设为可选」，
   而可选 ≠ 不影响定价（评审指出这一步推断没有证据，且 audio TTS 按字符计费是行业常态）。
   **已真机实测补上证据**（2026-08-06，pgc dev）：2 字 vs 300 字 prompt，
   `audio kind=speech` / `audio kind=auto` / `image` 的报价**完全一致**（10 / 10 / 54）。
   既然不影响定价，估价体里就**恒发空串**——免得让人误以为发的是用户当前输入
   （实测过：把 prompt 排除依赖后，闭包里的值必然滞后一拍）。
2. **能报就报，报不出就整行不渲染**：确定值 → `8 credits`；区间 → `20–40 credits`；
   三者皆空（rig3d/retexture 本期无定价）/ `billable=false`（计费灰度关闸）/ 请求失败
   → **一律不渲染**。只维护一条「不显示」路径，绝不编数。
   （被否的方案：给 `billable=false` 单独标「内测不计费」—— 多一条分支 + 11 语言词条，
   而灰度一开这行就成死代码。）
3. **报价放提交按钮左侧、同一行**：作为 `shrink-0` 的纯文本插在 pill 行与提交按钮之间。
   价格紧邻「决定付不付」的那一瞬，且不占新行、**不改弹窗高度**。
   （被否的方案：单独一行 —— 报不出价时该行消失会让弹窗高度跳；藏进 Tooltip —— 与「不盲付」相悖。）

## 我自行判定的部分（写下来免得成为默默假设）

- **报价可以合法地滞后 300ms + 一个往返**：同类型内改参数时刻意保留旧价（不闪空），
  期间**没有 pending 提示**。所以用户有可能在旧参数的报价还挂着时就点了生成。
  本轮接受这个取舍（加 spinner/骨架会让价格区域一直在抖）；若真实使用中造成困扰，
  再考虑「变灰 + 轻微淡出」这类低干扰提示。
- **debounce 300ms**，且**取消旧请求**（`AbortSignal`）：不取消的话快速调参时旧响应可能后到、
  把新报价盖掉（与坐标回写那条「同坐标在飞合并」同一类竞态）。
- **打开弹窗即报一次**（用当前默认参数）：否则常驻位置一开始是空的，用户以为没有价格功能。
- **关闭弹窗 / 切生成类型 → 取消在飞请求**，并清掉旧报价（不让上一类型的价停在新表单上）。
- **估价失败静默**：不弹 Toast、不进 `lastError`。它是辅助信息，失败不影响生成；
  在表单里放一个醒目错误态会把注意力从「生成」拉走。这是对仓库「`guard` 把已知 `PgcError`
  转 Toast」的一处**有意例外**，故估价 action 不走 `guard`，自己 catch 后只清报价。
- **不做「估价 > 可用余额就提前拦截提交」**：沿用上一轮的决定（YAGNI）——
  会把提交前后两套积分校验耦在一起，而后端提交时本来就会返回 `402 CREDIT_INSUFFICIENT`
  并由既有 `InsufficientCreditsModal` 接住。
- **本轮只覆盖 `GenerateForm` 的四类**（image / video / audio / 3d）。`type` 取值里的
  `sprite` 前端完全没接、`rig3d`/`retexture` 走 `generateDerived3d` 不经本表单，
  且后端对这两类本期就是「三者皆空」→ 按决策 2 天然不渲染。

## 约束

1. **请求体复用 `buildGenBody`，不写第二套映射**。估价体 = `{ type } + buildGenBody(...)`，
   与提交用的 body 同源。两套映射迟早漂移（仓库里 `assetReference` 已有同类教训）。
2. **`GenKind` → 契约 `type` 需要映射**：前端 `'3d'` 对应契约 `'model3d'`（`GenKind` 是
   `AssetKind` 的子集，与后端判别器不同名）。这个映射是纯函数、单测钉死。
3. **判别器叫 `type` 不叫 `kind`**：音频入参自己就有 `kind`（`auto`/`speech`/`music`/`sound`），
   用 `kind` 当判别器会直接撞名。
4. **响应三形态的归一下沉纯函数**：`{credits} | {credits_min,credits_max} | 全空`
   → `{ kind: 'exact', credits } | { kind: 'range', min, max } | null`，
   再叠加 `billable === false → null`。组件只消费归一结果，不碰原始字段。
5. **瞬态不落盘**：报价与在飞态是纯前端瞬态，**不进 store persist 白名单**；
   本轮甚至不进 store —— 它只属于当前打开的那个表单，用组件内 hook 持有。
6. UI 复用既有令牌与字号：报价文本用 `text-[12px]` + `--color-muted`，数字用 `font-mono`
   （与仓库既有「等宽数字」惯例一致，注意用 `font-mono` 而非
   `font-[var(--font-mono)]` —— 后者在 tailwind v4 会编译成非法 `font-weight`，
   上一轮踩过）。不新增按钮种类、不自造 toast、不写一次性 keyframes。

## 成功标准

1. 打开图片生成弹窗 → 提交按钮左侧出现报价（如 `8 credits`），未占新行、弹窗高度不变。
2. 把张数从 1 改成 4 → 报价随之变化（debounce 后一次请求，不是每次按键一个）。
3. 快速连续改三次参数 → **只有最后一次的报价被采用**（旧请求被取消，不会闪回旧值）。
4. 只敲 `prompt` 不动其它参数 → **不发估价请求**。
5. 音频选 `kind=auto` → 显示区间（如 `20–40 credits`）。
6. `billable=false` / 三者皆空 / 请求失败 → **报价行整个不渲染**，且**不弹 Toast**。
7. 切换生成类型（图片 → 视频）→ 旧报价立刻消失，按新类型重报。
8. 关闭弹窗 → 在飞估价请求被取消（不留悬挂请求）。
9. 估价端点 503（ARTGEN 未配等）→ 同 6，静默不显示；**生成按钮照常可用**。

## 方案

| 文件 | 职责 |
|---|---|
| `src/lib/pgc/types.ts` | `CanvasEstimateRequest`（`type` + 扁平入参）/ `CanvasEstimateData` |
| `src/lib/pgc/client.ts` | `estimateGenerate(pid, body, signal?)` |
| `src/lib/gen-estimate.ts`（新） | 纯函数：`ESTIMATE_TYPE_BY_KIND`（`'3d'→'model3d'`）· `estimateBody(kind, prompt, params, refs, model)`（复用 `buildGenBody`）· `normalizeEstimate(data)` → 三形态归一 · `ESTIMATE_DEBOUNCE_MS` |
| `src/client/useGenEstimate.ts`（新） | 副作用 hook：debounce + `AbortController` 取消旧请求 + 卸载/切类型收尾；返回归一后的报价（或 `null`） |
| `src/components/canvas/GenerateForm.tsx` | 提交按钮左侧插报价文本（`shrink-0`）；依赖数组**排除 prompt** |
| i18n × 11 | `canvas.gen.estimateExact` / `estimateRange`（带 `{{credits}}` / `{{min}}`/`{{max}}` 插值） |

### 为什么 hook 而不进 store

报价只属于「当前打开的那个生成弹窗」，随弹窗生死；进 store 就要处理「弹窗关了但报价还在」
「切项目时清空」等一堆与它无关的生命周期。仓库既有先例：`useCanvasPolling` / `useCanvasPaste`
这类「副作用隔离在 `client/` hooks」的分层正是为此（见 CLAUDE.md 分层原则）。

## 真机验收（2026-08-06，dev :3011 打 pgc dev，项目 1044）

手法：Playwright 真实鼠标/键盘 + `window.fetch` 探针只统计 `/generate/estimate`。
估价端点零副作用，**本轮未在项目上产生任何写入**，无需基线还原。

### 已通过

| 标准 | 实测 |
|---|---|
| 1 报价出现且同行 | 打开图片弹窗 → `54 credits`（默认 Gemini）。同行子元素实测为 `[pill 行 DIV, 报价 SPAN, 提交 SPAN]` —— 报价与提交在**同一个 flex 容器**里，未占新行 |
| **4 只敲 prompt 不发请求** | 真实键盘敲 7 个字符 → 估价请求 **0 个**，报价仍是 `54 credits`。这条最关键：依赖摘要把 `prompt` 排除掉是对的 |
| 7 切生成类型 | 图片 `54 credits` → 切音频**瞬间为 `null`**（旧类型的价没停在新表单上）→ 重报为 `10 credits`；请求 `type` 序列为 `['audio']` |
| 6a `billable=false` | 报价元素**不在 DOM**、`toast` 为 `null` |
| 6b/9 请求失败（503） | 报价元素**不在 DOM**、`toast` 为 `null`；生成按钮照常存在（disabled 仅因 prompt 为空） |
| 8 关弹窗取消在飞 | 请求发出 1 个、在飞时未取消（0）→ **关弹窗后 aborted 计数变 1** |

### 未验到的（如实列出）

- **标准 2 / 3（改参数重报、连改只采用最后一次）**：UI 驱动**三次尝试均失败** —— 点模型 Select
  时误中了 chat 的模型选择器（两者 `aria-label` 都以 `Model:` 开头），点参数 pill 则把弹窗
  关掉了（点击被判为「点到外面」）。改用坐标点击同样不稳。
  替代覆盖：`useGenEstimate.test.tsx` 有「参数变化重报」「连改三次只发最后一次」「已在飞时参数
  再变则旧请求被 abort」三条；端点侧也实测过重定价（`{n:2, model:'gpt-image-2'}` → 8 credits
  vs 默认 → 54 credits）。**缺的那一环是「真实 UI 的参数变更能否到达 hook」**，这一环仍未证。
- **标准 5（音频 `kind=auto` 显示区间）**：**当前定价下无法复现** —— 实测
  `{type:'audio', kind:'auto'}` 返回的是**确定值 `credits: 10`**，不是区间。契约文档说区间的
  唯一来源是音频 `kind=auto`，但同时也说「两条路价一样时会收敛成确定值」，当前正是这种情况。
  区间形态的渲染由单测覆盖（`normalizeEstimate` 与 `GenerateForm.test` 各一条）。

### 手法上的坑（记给下次）

1. **双击画布空白开的是「添加资产」菜单，不是生成表单** —— 要开表单得走 `openGenForm`。
2. **`aria-label` 前缀撞名**：生成表单与 chat 的模型选择器都以 `Model:` 开头，按前缀找会点错，
   且点错会连带关掉表单。要在表单卡容器内查找（以带对应 placeholder 的 textarea 为锚上溯到
   含 `button[aria-label="Generate"]` 的容器）。
3. **读报价要等够**：debounce 300ms + pgc dev 往返，等 1500ms 会读到 `null`（我第一次就误判成
   「不显示」），2500ms 稳定。

## 分层倒挂：已随后修掉

原先 `src/lib/gen-estimate.ts` 从 `@/components/canvas/gen-params` 取 `submitGenBody`，
即 ⑤ 纯逻辑层依赖 ⑥ UI 层。终审指出这条边**从「顺带」变成了「承重」**——`submitGenBody`
是本轮新增的纯逻辑函数，加在 `components/` 下却被 `lib/` 消费。

已根治：`gen-params.ts` / `gen-models.ts` / `gen-prefill.ts` 连同各自的同目录测试
一并下沉到 `src/lib/`（三者本就只依赖 `lib/`、零 React、零组件引用）。现在 `lib/` 对
`components/` 只剩 `asset-kind.ts → components/ui/figma` 这一条**先前就存在**的边。

## 明确不做

- **提交前的余额拦截**：见上，YAGNI。
- **`billable=false` 的「内测不计费」文案**：见决策 2。
- **报价明细 / 按参数拆解**（「4 张 × 2 credits」）：后端只回总价，拆解得前端自己猜定价规则 —— 违背「不臆测后端」。
- **sprite / rig3d / retexture 的估价 UI**：前端没有这三个的表单入口（sprite 完全没接，
  派生 3D 不经本表单），后端对后两者本期也无定价。
- **历史生成的花费回显**：那是另一件事（版本时间线已有 `credits_spent`）。

## 契约核实（2026-08-05 真机，pgc dev，项目 1044）

```
POST {BASE}/api/projects/1044/canvas/items/generate/estimate
{"type":"image","prompt":"test","n":2,"model":"gpt-image-2"}
→ 200 {"type":"image","credits":8,"credits_min":null,"credits_max":null,
        "currency":"credit","model_id":"gpt-image-2","billable":true}
```

**请求体确认是扁平的**（不是 `{type, image:{...}}` 嵌套）——这条是上一轮 handoff 里卡住整层
client 的 F1，已由真机定论。`{BASE}` = `PGC_BASE_URL` + `/game/pgcserver`。
