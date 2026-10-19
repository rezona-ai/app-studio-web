# 对话报错改为输入框上方的固定气泡

> 前置：`2026-08-25-agent-error-passthrough-auto-retry.md`（错误透传 + 自动重试的主稿，本稿只改「错误长在哪儿」）

## 目的

错误气泡目前是 `messages` 里的一条助手消息，长在它当时所处的对话流位置；重试进度气泡却是订阅 `agentRetry` 的瞬态组件，挂在消息列表尾部。同一件事（这一轮失败了）两种形态、两个位置，往上翻还会看到历次失败堆在流里。

统一成**一个固定槽**：输入框正上方，同一时刻至多一条，二者同一套数据模型与生命周期。

## 约束（盘问结论）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 旧错误怎么办 | **对话流不再渲染错误气泡**。固定槽只展示当前这一条。 |
| 2 | 数据归属 | **改瞬态，与 `agentRetry` 完全同构** —— 不进 `messages`、不落盘、刷新即消。 |
| 3 | 消失时机 | 与 `agentRetry` 同一套规则：用户发新消息 / 新一轮 `run.started` / 回合成功 / 点手动重试。**不给关闭按钮**（多一个控件，且与重试气泡的「Stop retrying」位置重叠、语义易混）。 |

## 非目标

- 不改错误的**判定与文案**：`classifyKoubouError` / 白名单 / 自动重试判据 / i18n 全部不动。
- 不改重试机制本身（`agentRetry` 的 phase 机、退避、哨兵）。
- 不做错误历史面板 / 折叠多条。同一时刻只一条，后来的覆盖先前的。

## 详细设计

### ① 状态：`KoubouState.agentError`

```ts
export interface AgentError {
  text: string;      // 主行 fallback(与原 error part 同源,渲染期按 code 翻译)
  code?: string;
  detail?: string;   // 上游原文,走 ErrorDetail 折叠
}
agentError: AgentError | null;
```

与 `agentRetry` 并列放在 `KoubouState`。**天然不落盘**：`sessionSnapshot` 只取 `messages / turns / tasks / subagents`；**天然跨项目归零**：`switchProjectSession` 走 `...createInitialKoubouState()`。两处都不需要新增代码，但需要测试钉住（否则哪天有人往快照里加字段就破了）。

`agentError` 与 `agentRetry` **互斥**：`pushAgentError` 置前者、清后者；`failAgentTurn` 置后者时不写前者。渲染层据此二选一。

### ② 写入：`pushErrorBubble` 改写字段，调用方全不动

三个调用方的语义不变，只是落点从「append 一条 message」变成「写 `agentError`」：

- `pushAgentError`（放弃自愈 / 不可重试 / 次数耗尽）
- `build.failed`
- `cancelAgentRetry`（用户点停止重试）

### ③ 清除：逐条对齐 `agentRetry` 现有的清除点

| 时机 | 位置 | 现状 | 本稿 |
|---|---|---|---|
| 用户发送 | `markPendingSend` | 清 `agentRetry` | 同时清 `agentError` |
| 插话 | `markSteerSent` | 同上 | 同上 |
| 新一轮开跑 | `run.started` | `running → responded` | 清 `agentError` |
| 回合成功 | `run.finished{succeeded}` | 清 `agentRetry` | 同时清 |
| 打断 | `run.interrupted` / `finished{interrupted}` | 清 `agentRetry` | 同时清 |
| 手动重试 | `retryAgentNow` | 摘掉被点的那条 message | 清 `agentError`、置 `agentRetry` |
| 切项目 | `switchProjectSession` | 整体重置 | 无需改动（测试钉住） |

`retryAgentNow(from)` 的入参随之简化：原本要 `from.id` 去 `messages` 里摘那条，现在原因就在 `agentError` 里，签名收成 `retryAgentNow()`。

### ④ 渲染：底部固定槽

`ChatPanel` 底部那个 `relative` 容器（承载 PlanCard / pending 交互 / ReconnectBanner / Composer）里，在 `ReconnectBanner` 之上放一格：

```
<AgentRetryBubble />   ← 从消息列表尾部挪来
<AgentErrorBubble />   ← 新增,MessageItem 的 error 分支挪来
```

两者互斥，不会同时出现。视觉全部沿用现有 danger 令牌与 `danger-bubble.ts` 的共用类（`DANGER_LEAD_CLS` / `DANGER_LEAD_DOT_CLS` / `DANGER_ROW_CLS` / `DANGER_ACTION_CLS`），`ErrorDetail` 折叠原样跟到新位置。

手动重试按钮的判据从「它是 `messages` 最后一条」改成：

```ts
lastSend != null && agentRetry == null && runStatus !== 'running'
```

（`agentError` 非空是渲染前提，不必再判）——比原判据更准：原判据在错误之后又来了任何一条消息时就把按钮弄没了。

`MessageItem` 的 `case 'error'` 分支删除；`Part` 的 `error` 变体保留（老快照里有存量，见下）。

### ⑤ 存量：老会话快照里已有的 error 消息

`koubouByProject` 落盘的老快照里存着形如 `{role:'assistant', status:'error', parts:[{type:'error',…}]}` 的消息。渲染分支删掉后它们会变成**空壳消息节点**（外层仍有 `mb-5` 间距，视觉上是一段莫名其妙的空白）。

处置：`restoreSnapshot` 里过滤掉「所有 part 都是 `error` 类型」的消息。这是一次性数据清洗，不是长期兼容层——新写入的快照里不会再有 error part。

## 取舍与代价

1. **失败在历史里只剩 `TurnFooter` 的「Failed after {{dur}}」**，没有原因文案。可接受：原因当场可见、可展开原文、可复制；翻旧账不是这条链路的用途。
2. **`error` 事件早于 `run.started` 到达的失败（run 根本没起）在历史里彻底无痕** —— 没有 turn 就没有 footer。这是本稿真正丢掉的东西，明确接受。
3. **刷新后错误消失**。与 `lastSend`（重发 payload，本就瞬态）同寿：刷新后本来也重试不了，留一条不能操作的红条反而更糟。
4. 固定槽会占掉输入框上方的高度。长文案 + 展开原文时挤压消息区，但消息区是 `flex-1` 自适应，且原文默认收起。

## 实现计划

见 `docs/superpowers/plans/2026-08-27-chat-error-docked-bubble.md`。

---

## 实现回填（2026-08-27，分支 `fix/retry-bubble-polish`）

三步落在三笔提交上：`9b0581cb`（T1 并存加新）→ `d51afb8e`（T2 原子切换）→ `3128ac17`（T3 删旧）。

### 与设计稿的出入

- **`pushErrorBubble` 更名 `setAgentError`**：函数职责已从「append 一条气泡消息」变成「写一个字段」，留着旧名会骗下一个读者。
- **`Part` 的 `error` 变体保留**：老快照要能被读出来再滤掉。类型注释里写明「只读不写」。
- **`MessageItem` 的 `case 'error'` 返回 `null` 而非删掉分支**：`Part` 是判别联合，删掉这一支 `switch` 就不再穷尽、tsc 会报。它是清洗之外的第二道。

### 测试落点的迁移

29 条原先断言 `messages[0].parts[0]` 的用例改断言 `agentError`。其中一条按新机制**重述**而非机械改写：「终态帧不重复推第二条气泡」——固定槽只有一格，「推两条」已不可能；但去重仍要守，因为终态帧那步若拿自己那份兜底文案（`fallback: 'run failed'`）覆盖一遍，用户看到的原因会从真实上游文案退化成通用句。新判据直接断言原因文案没被覆盖。

上一轮那条不变式（终态帧过后失败必须看得见）判据同步换成「要么自愈还在，要么 `agentError` 非空」——不换的话它会在新机制下静默通过。

### 真机验证（dev server 3005 连 dev 后端）

- 报错固定在输入框正上方、不在滚动区内；用户消息仍在流里。
- `agentError` 与 `agentRetry` 并存时只画进度气泡（互斥防线生效）。
- 造了一份含存量 `error` 消息的老快照写回 localStorage，刷新后该条被滤掉（`messages` 只剩 `u1, a1`），消息区无空壳节点。

### 评审（干净上下文子代理，只给本稿与 commit 范围 diff）处置

**Critical**：无。

**Important（已修，`91870a79`）** —— 三条都自己复现过：

- **I-1 互斥只写在渲染层**。`failAgentTurn` 安排自愈时不清 `agentError`，`build.failed` 走的 `setAgentError` 也不清 `agentRetry` —— 两个字段可以并存，固定槽画哪个全看组件里那道防线，防线一改就静默丢报错。改：安排自愈即清报错，互斥落到状态里。
- **I-2 让位判据过宽**。写成 `agentRetry != null`，而 `phase:'responded'` 时 `agentRetry` 还留着（只剩计数用途）、进度气泡已退场 —— 这段**横跨整个被重试 run** 的窗口里两个气泡都不画，期间任何报错都看不见。改：只在 `waiting` / `running` 让位。I-1 与 I-2 都先临时回退修复、确认新测试变红再改。
- **I-3 高度失控**（设计稿 §取舍 4 低估了）。原文上限 2000 字符，原先长在 `flex-1 overflow-auto` 的滚动区里撑多高都只是滚动；搬到底部块后能把消息区压没、继续挤掉 Composer。改：原文 `max-h-[30vh]` 内部滚动 + 底部块 `shrink-0`。真机 60 行原文实测：`pre` 钉在 224px、消息区仍有 233px、输入框完整可见。

**Minor（已修）**

- 回放收尾清固定槽：回放灌进来的 `error` 帧是**当时**发生过的失败，不该以「现在失败了」的形态挂在输入框上方（它又不进快照，续接后也无从解释）。
- 两条被削弱的断言：`toMatchObject({ })` 只等价于「非 null」，改回形状断言；`MessageItem` 那条「无可重发 payload → 不给按钮」在 `case 'error'` 恒返回 null 后已是同义反复，删掉（有效用例已迁到 `AgentErrorBubble.test.tsx`）。
- `ChatPanel` 测试不再靠「可访问名为空」区分 `role="status"`（`ReconnectBanner` 同为 status）。

**评审确认无问题的**：`dropLegacyErrors` 判据无漏（`pushErrorBubble` 是历史上唯一的 error part 写入方，且恒是单条 part）、零拷贝承诺守住、`lastMessageId` 锚点不会失配（它从不指向 error 消息，且 `selectTurnAnchors` 有 `ids.has()` 校验）、三处 `restoreSnapshot` 调用点覆盖全部读路径；PlanCard 是 `absolute bottom-full`，悬在容器上沿之外，遮不到固定槽。

### 取舍补记（评审 M-2 提出）

**「run 起来了但一个字没吐就崩」的失败在历史里同样无痕**：`selectTurnAnchors` 只把 `lastMessageId` 命中 messages 的轮挂上 footer，这类轮既没 footer 也没报错。判据是旧的，但报错搬走之后它才变成「什么都看不到」。与 §取舍 2 同类，一并接受。

**自愈退避窗口（1–8s）内到达的 `build.failed` 会被随后的 `run.started` 清掉**：那段窗口进度气泡占着这一格，而新一轮开跑即清固定槽是决策 3 的一部分。构建失败与 agent 自愈本就正交，为它单开一条豁免不值得——接受，记录。
