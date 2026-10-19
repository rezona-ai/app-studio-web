# 模型侧不可重试失败 → 引导切换模型 — 设计稿

> 日期：2026-09-03 · 分支：`feat/model-switch-on-fatal-error` · Figma `11490-83019`
> 前置：`2026-08-25-agent-error-passthrough-auto-retry.md`（错误判定）· `2026-08-27-chat-error-docked-bubble.md`（固定槽）· `2026-08-28-new-user-model-gate-design.md`（模型门禁）

## 方案变更（2026-09-03 二，Nick 定案，**当前生效**）

第一版（下文「约束」「详细设计」「真机验证」所述）的独立换模型卡已整体退役，改为**不新增任何独立界面**：

- 红色报错气泡（`AgentErrorBubble`）在 `agentError.retryable === false` 时多一行提示（`chat.modelSwitch.hint`）与一个 **Switch model** 按钮（沿用 `DANGER_ACTION_CLS`，与 Try again 同款）。
- 点 Switch model **不自己开菜单**：只调 store action `requestModelMenu()`（`UIState.modelMenuRequest` 计数 +1），Composer 里的 `ModelSelector` 订阅该计数、经公共 `Select` 新增的 `openRequest` prop 展开下拉。菜单归 ModelSelector 一家所有，不在气泡里再开一份。
- 选完模型**只切模型**（沿用 ModelSelector 既有行为：`setSelectedModel` + `session.set_model` + 埋点），气泡留着，用户点 Try again 续跑。Nick 定案：与主动切模型完全一致，最少意外。
- 提示 / 按钮的出现判据收成 `selectModelSwitchHint`：`retryable === false` 且未门禁且 `availableModels.length ≥ 2`。不再看 `lastSend` / `agentRetry`（气泡自身已按这些让位或给不给 Try again）。
- 为什么用**递增计数**而非布尔开关：用户手动关掉下拉后再点一次按钮，布尔值不变、effect 不重跑；计数每变一次就开一次。`Select` 只响应变化，挂载初值不算请求。
- 随之删除：`ModelSwitchCard`、`lib/model-switch.ts`、`AgentError.switchDismissed`、`dismissModelSwitch`、`Select.fullWidth`、埋点 `reason` 字段、`chat.modelSwitch.{title,keep}`（无单一使用者之外的用途，不留 dead code）。保留：`AgentError.retryable` 事实、`modelSwitch.change` 文案（改为 "Switch model"）。

### 方案二排版修正（2026-09-03 三，Nick 对首版排版的反馈）

首版把提示行与主行做成同色同字号、两个按钮各挂在自己那行右侧，读不出「哪句是错误、哪句是建议、哪个是首选动作」。定案为**文案分层 + 底部一条动作栏**：

```
● 主行（13px 红）
  提示行（12px 次要灰 --color-muted，仅模型侧不可重试失败时有）
  ▸ Details                    Try again  [Switch model]
```

- 动作栏左侧是 Details 开关，右侧 Try again（ghost，`DANGER_ACTION_CLS`）与 Switch model（带底色 + 描边的首选，新增 `DANGER_ACTION_PRIMARY_CLS`）。无任何动作也无原文时不渲染空栏。
- `ErrorDetail` 由 `<details>` 拆成受控的「开关 + 正文」：开关要和按钮并排在同一栏，正文却要在栏下整宽铺开，`<details>` 的正文只能长在 summary 底下。开合状态归气泡持有。
- 动作栏 `role="group"` + `aria-label`（`chat.error.actions`，11 语）。

第二轮样式修正（Nick 看真机后）：去掉主行前导圆点（多行结构里只是多一个元素，还逼着下面几行缩进对齐）；提示行由 `--color-muted` 改 `--color-ink`（红底上灰字发闷；红 = 错误、正文色 = 建议）；Switch model 改实底 `--color-danger` + 白字 `--color-on-primary-strong`（半透明红底上的红字与旁边 ghost 红字对比不够）。`DANGER_LEAD_DOT_CLS` 随之删除。

### 方案二评审处置（干净上下文子代理基于 `dev..HEAD`）

Critical 无。Important 两条：I-1 **采纳** —— `Select` 在 disabled / 单选项期收到 `openRequest` 会把 `open` 悄悄置 true，解锁那一刻菜单凭空弹出；codex 活跃 run 期 `ModelSelector` 正好 locked，而 error 事件不关轮，窗口真实存在。修法两层：`Select` 在 inert 态把请求消费掉不置 open；`locked` 判据抽成 `selectModelSelectorLocked` 供 `ModelSelector` 与 `selectModelSwitchHint` 共用，锁定期不显示 Switch model（否则是个点了没反应的按钮）。I-2（`epics.json` 被删）**技术性异议，不采纳**：分支基点早于 dev 上那条登记提交、分支从未碰过该文件，`dev..HEAD` 的删除是读法假象，合并保留 dev 版本（合并后已核对）。Minor：M-2 plan 顶部加了指向方案变更的说明；M-3 补 `Select` disabled 期请求、`ModelSelector` locked 期请求、selector locked 分支三条用例；M-1（`ModelSelector` 未挂载期请求被吞）当前不可达，记录为已知边界。

### 方案二真机验证（2026-09-03，dev 后端 + 真实登录态，同第一版方法：只 mock error 帧）

| 路径 | 结果 |
|---|---|
| 真发消息起真 run，run 在跑时注入 `upstream_error{retryable:false}` | ✅ 红色气泡出现，主行译文下多一行提示 + Switch model，Details 折叠仍在；没有任何独立卡 |
| 真 run 结束（成功）| ✅ 报错随既有生命周期清掉（run.finished 成功清 agentError），提示随之消失 |
| run 结束后注入 `budget_exceeded{retryable:false}` | ✅ 气泡带 Try again + Switch model |
| 点 Switch model | ✅ 下方 Composer 的模型下拉展开（Rez1 选中绿点，Fable 5 / Opus 5 / Kimi K3 / GPT-5.6…） |
| Esc 关掉再点一次 | ✅ 再次展开（递增计数生效，布尔做不到这条） |
| 选 Fable 5 | ✅ Composer 模型钉 Rez1 → Fable 5；气泡与 Try again 仍在；**没有**触发自动重试 |
| 控制台 | ✅ 无应用报错（仅 favicon 404、GA 域名被本地网络拦） |

验证副作用已复原（模型切回 Rez1）。

以下章节为第一版设计与验证记录，保留作决策依据。

## 背景

后端 `error` 事件的上游 / 模型侧失败带权威 `retryable` 标记。`false` 的四个 code（`upstream_auth_failed` / `upstream_error` / `output_limit` / `budget_exceeded`）目前直接 `giveUp()` 落固定槽红色报错气泡，只给「Try again」——原模型再试大概率原样再败。设计稿给的出路是**换一个模型继续**。

## 目的

`retryable === false` 的失败到达时，在固定槽用一张「换模型」卡替代红色报错：一句说明 + 模型下拉 + 「保留当前模型」/「Change model」。点 Change model 一键切模型并自动续跑。

## 约束（盘问结论）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 落位 | **固定槽内联卡**（输入框正上方，替代红色报错气泡出现）。不做居中 Modal —— 设计稿 308 宽、图层名 `user-question`，与 `QuestionCard` 同形态；且与报错 / 自愈进度共用同一套瞬态生命周期，不新增 z 层。 |
| 2 | 触发范围 | **仅后端 `retryable === false`**。协议类错误（`run already active` 等）与自愈 10 次耗尽仍走红色报错气泡。 |
| 3 | Change model 动作 | **切模型 + 自动重发**：写 `selectedModel`、发 `session.set_model`，紧接着走既有 `retryAgentNow` 路径（有产出 continue / 否则重发上一句），进度气泡就地接管固定槽。 |
| 4 | 左键语义 | 设计稿写「No, keep waiting」但此时 run 已终态无可等。改为**「Keep current model」语义：关卡退回红色报错气泡**（原文折叠 + 手动重试都保留）。 |
| 5 | 预选与门禁 | 下拉预选 `availableModels` 里**首个 ≠ 当前**的模型。新用户门禁锁定态（只放 Rez1）无可换目标，**不弹卡**、直接红色报错。 |

**本稿自定的残留假设**（均为「无可换 / 无可重发 → 退回红色报错」）：

- `lastSend == null`（刷新后）不弹卡：Change model 的核心是续跑，没有可重发 payload 就退化成只切模型，与直接在 ModelSelector 切没差别。
- `availableModels.length < 2` 不弹卡。
- ~~回合正在跑不弹卡~~ **已推翻（评审 I-1）**：`error` 事件不关轮，`runStatus` 要等随后的 `run.finished` 才回落，间隔无上界；按 running 当门会让红气泡先闪一下再被卡替换，窗口期点了 Try again 卡就再不出现。「不撞 `run already active`」是**发送**约束，`useAgentRetry` 已按 `runStatus` 挂起发送，展示层不重复判。
- codex 后端 `set_model` 只在 run 空闲时被接受；被拒会以 `error` 事件回来走红色气泡，不静默。
- 下拉**不含当前模型**：选回原模型再点 Change model 只是披着换模型外衣的 Try again。

## 非目标

- 不改 `retryable` 判定、不改自动重试机制、不改 i18n 错误码表。
- 不给红色报错气泡加「换模型」入口（10 次耗尽等场景保持现状）。
- 不记忆用户「保留当前模型」的选择：下次再来 `retryable=false` 仍弹卡。

## 详细设计

### ① 事实进 reducer，策略进 selector

reducer 是纯函数、只看 `KoubouState`，而「能否换模型」还依赖 `availableModels` / 门禁（`ServerState` / `UIState`）。故分两层：

- `AgentError` 新增 `retryable?: false`：`pushAgentError` 在 `f.retryable === false` 时写入。**只记事实**，不在 reducer 判「该不该弹卡」。
- 新增 `AgentError.switchDismissed?: true`：用户点左键后置位，卡退场、红色气泡接管。action `dismissModelSwitch`。
- 纯函数 `src/lib/model-switch.ts`：
  ```ts
  // 首个 ≠ 当前的可用模型;无则 null
  export function defaultSwitchTarget(models: readonly string[], current: string | null): string | null;
  ```
- selector `selectModelSwitchOffer(s): boolean` = `agentError?.retryable === false && !agentError.switchDismissed && lastSend != null && agentRetry == null && runStatus !== 'running' && !gated && defaultSwitchTarget(...) != null`。

### ② 组件 `src/components/chat/ModelSwitchCard.tsx`

订阅 `selectModelSwitchOffer`；不满足则不渲染。渲染：

- 外框沿用 `QuestionCard` 容器语汇（`rounded-[20px] border-line bg-surface-2`，`anim-collapse-in`）。
- 说明行 `chat.modelSwitch.title`（`text-[13px] leading-5 ink`）。
- `Select`（`variant="filled"`，选项与 `ModelSelector` 同一份 `modelLabel` / 品牌图标 / 描述，抽成共享 `modelOptions(models, t)` 放 `ModelSelector.tsx` 同文件导出）。本地 `useState` 记选中，初值 `defaultSwitchTarget`。
- 两键并排各占一半、40px 高、`rounded-[10px]`：左 `IconButton variant="bordered"` 风格的次级键 `chat.modelSwitch.keep`；右主 CTA `Button` `chat.modelSwitch.change`。
- 右键：`setSelectedModel(id)` + `client.current?.setModel(id)` + `track('model_switch', { model_from, model_to, reason: 'fatal_error' })` + `retryAgentNow()`。`reason` 是 `GA4EventParams.model_switch` 新增的可选字段，ModelSelector 主动切换不带，两者转化率分得开。
- 左键：`IconButton variant="bordered"`（不自写按钮样式），点击调 `dismissModelSwitch()`。

`AgentErrorBubble` 在 offer 为真时让位（同 `retrying` 判据一并 return null），保证固定槽同一时刻一条。

### ③ i18n

`chat.modelSwitch.{title,keep,change}`，11 个语言同步。英文照设计稿：`Oops, there is some problem with your current model, switch to another one?` / `Keep current model` / `Change model`。

## 成功标准

1. `retryable:false` 的 error 事件到达、有 lastSend、≥2 模型、未门禁 → 固定槽出现换模型卡，红色气泡不出现。
2. 点 Change model → `selectedModel` 变为所选、`client.setModel` 被调、`agentRetry` 进入 waiting（进度气泡接管）。
3. 点 Keep current model → 卡消失、红色报错气泡出现且带「Try again」与原文折叠。
4. 门禁锁定 / 无 lastSend / 单模型 / 自愈耗尽（`retryable` 缺失）→ 不弹卡，行为与现状一致。
5. 用户发新消息 / 新 run.started → 卡随 `agentError` 一起清掉（沿用既有生命周期，测试钉住）。
6. 生产常态时序（run 在跑时 `error(retryable:false)` 先到、`run.finished{failed}` 后到）：卡在 error 到达那一刻即弹，终态帧不动它。

## 评审处置（2026-09-03，干净上下文子代理基于 `dev..HEAD`）

Critical 无。Important 三条全部采纳：I-1 selector 去掉 `runStatus` 判据并补时序测试（见上「已推翻」）；I-2 左键改用 `IconButton bordered`；I-3 埋点补 `reason: 'fatal_error'`。Minor 四条：M-4 下拉排除当前模型、M-5 列表刷新后所选失效回落首选、M-6 `AgentErrorBubble` 补让位用例、M-7 补 run.started / 发新消息清卡用例，均已实施。

## 真机验证（2026-09-03，dev 后端 + 真实登录态）

`PORT=3100 pnpm dev` + Playwright。真实项目、真实 koubou WS（ws-ticket 现签）、真发一条用户消息起真 run；**只 mock 那一帧 error 事件**——用 `addInitScript` 记下真实 socket，往它的 `onmessage` 注入 `{code, message, api_error_status, retryable:false}`，其余（连接、鉴权、模型列表、切模型、自愈接管、埋点）全走真链路。

| 路径 | 结果 |
|---|---|
| run 在跑时注入 `upstream_error{retryable:false}` | ✅ 卡**立即**出现，红色报错气泡不在场（`role=alert` 只剩 Next devtools 那个空节点）——评审 I-1 的时序修复在真机成立 |
| 卡形态 | ✅ 说明行 + 全宽下拉 + 两键并排，与 Figma 11490-83019 一致 |
| 下拉内容 | ✅ 当前模型 Rez1 已排除，预选 Fable 5，其余 Opus 5 / Kimi K3 / GPT-5.6 / Opus 4.8… 照常带图标与定位文案 |
| Keep current model | ✅ 卡退场，红色报错接管固定槽（`The request could not be completed. Please contact support.` + Details 折叠）。此刻真 run 仍在跑，故按既有判据不给 Try again |
| 再注入 `budget_exceeded{retryable:false}` | ✅ 卡再现（上次的 dismissed 不粘住新错误） |
| Change model | ✅ Composer 模型钉 Rez1 → Fable 5，固定槽转「Retrying 1/10 · in 0s」进度气泡，卡退场 |
| 埋点 | ✅ 真实 GA 请求载荷 `en=model_switch&ep.model_from=Rez1&ep.model_to=claude-fable-5&ep.reason=fatal_error`（GA 域名在本地被网络隧道拦，与本功能无关） |
| 应用报错 | ✅ 控制台无应用错误，仅 favicon 404 与 GA 连接失败 |

验证副作用已复原：切回 Rez1、自愈全部 Stop retrying（未真发出重试消息）。**发现并已修**：下拉原为内容宽胶囊，设计稿是全宽整行，见提交 `506a9394`。
