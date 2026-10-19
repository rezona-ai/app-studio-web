# 会话落库模型回填选择器（含下架自动切换）

日期：2026-09-11 · 分支：`feat/session-model-adopt`
状态：已与 Nick 确认方向（会话为权威回填选择器；默认模型维持 `models[0]`；不按订阅档位拦模型）

## 目的

进入一个曾用 `claude-fable-5` 对话过的旧项目，输入区的模型选择器显示 **Rez1**，而这一轮对话实际仍由
**fable 5** 执行。同一屏上回合脚注（`TurnFooter`）写着 Fable 5、选择器写着 Rez1，用户无从判断自己
在用哪个模型，也无法通过"看起来已经选好了"的选择器把它切回来（重选同一项不会发帧）。

本需求让选择器显示**会话实际生效的模型**，并在该模型已下架时主动修好这个会话。

## 根因

三处叠加，前两处是刻意的历史决策，第三处是后端契约：

1. **选择器只信前端记忆，永不读会话真相。** `selectedModel` 的服务端同步入口只有 `model.changed`
   （`src/store/index.ts`）；`onReady`（`src/koubou/apply-koubou.ts`）完全不读 ready 里的 `model`。
   这是 spec `2026-06-17-model-selector-design.md:114` 明写的决定：「**不与 `session.ready.model`
   做双向同步**……不读取后端会话已落库模型回填选择器（避免与『建连带 model』的先后次序纠缠）」。

2. **旧项目必然落到列表首项。** `switchProjectSession` 取 `modelByProject[slot] ?? 继承值`，
   再经 `resolveSelectedModel` 校验，两条路都通向 `models[0]`：
   - **记忆缺失**：项目早于 `model-per-project`（2026-07-23）、换浏览器/设备、清过 localStorage；
   - **记忆在但已下架**：`resolveSelectedModel` 回落首项且**记忆本体不动**
     （`store/model-selection.test.ts` 钉着这个行为）。

3. **attach 路径的 `?model=` 是死参数。** `buildWsUrl` 对 `model` 不做 `!opts.sessionId` 判断
   （`backend` 做了），attach 时照拼；而 koubou 侧 `app/api/websocket.py` 只有 `create_session_ws`
   读并校验 `model`，`attach_session_ws` 整个函数里没有 `model` 这个词。**任何"靠建连参数纠正已有
   会话"的修法必然静默失效**——这也是 spec `2026-08-28-new-user-model-gate-design.md:43` 当初必须
   额外补一条 `session.set_model` 的原因。

历史上三轮"模型修复"都不覆盖本路径：`647f4e15`（按项目记忆，真相源是前端 localStorage）、
`9d599a7e`/`e8f5048e`（修 `TurnFooter` 的 `turn.model`，与 `selectedModel` 是两个字段）、
`fc3defc0`（给在世会话补 `set_model`，但被门禁判据挡住，只在新用户锁定态跑）。

## 后端契约（已查 koubou 源码并经独立评审复核，2026-09-11）

| 事实 | 落点 |
|---|---|
| `session.ready.payload.model` 存在 = `self._model or settings.claude.active_model` | `app/sessions/actor.py:680-695` |
| `session.ready.payload.available_models` 存在 = `settings.claude.selectable_models`，与 `GET /models` 的 `models` **同源** | 同上 + `app/api/http.py:126-129`、`app/core/config.py:1024-1036` |
| attach **不读** `?model=`；仅 create 读并校验 | `app/api/websocket.py:136-146`（create）/ `:177-224`（attach 无该字段） |
| `session.set_model` 校验 `is_model_allowed`：不合法回 `error{message:'invalid model'}` **不断连**；合法则落库 + 发 `model.changed` | `app/sessions/actor.py:897-929` |
| `set_model` 另有一道 `_context_snapshot_active` → `error{'run already active'}`（run 终态前的 context 用量快照窗口） | `app/sessions/actor.py:901-903` |
| **已下架的落库模型不会被后端拦**：`_ensure_client` 直接把 `_effective_model()` 送给 CLI/router，全程无 `is_model_allowed` | `app/sessions/actor.py:2430-2447` |

最后一条决定了下架处理的性质：这种会话**下一轮会把下架模型打给上游**，坏在上游那一层。
主动切换不是体验优化，是修好这个会话的唯一办法，故 toast 措辞是「已自动切换到 X」。

`ready.model` 的语义要写明：它是**实际生效的模型**，不区分"用户在本会话显式选过"与"本会话从未选过、
取服务端 provider 默认"。对回填而言这正是我们要显示的东西，但它不等于"用户的选择"。

## 方案

**纯函数出决策 → store 落库 + toast → hook 只发帧。** 三段分工对齐 CLAUDE.md 分层原则。

### 1. 纯函数（`src/lib/koubou/models.ts`）

```ts
export type ReadyModelAction =
  | { kind: 'adopt'; model: string }                      // 会话模型可用 → 回填选择器
  | { kind: 'retired'; model: string; fallback: string }  // 已下架 → toast + 切到 fallback
  | { kind: 'none' };                                     // 无可回填的事实 / 判不出
export function resolveReadyModel(
  readyModel: string | null | undefined,
  readyAvailable: string[] | undefined,
  storeAvailable: string[],
): ReadyModelAction
```

判定顺序：

- `readyModel` 为空 → `none`（后端让 CLI 自选，没有可回填的事实）；
- 可用列表取 `readyAvailable` 优先、`storeAvailable` 兜底（**不依赖 `/models` 那个独立 effect 的
  时序**——建连只等 `currentProjectId`，列表常常后到）；两者皆空 → `none`（判不出就什么都不做，
  下一次 ready（重连）才会再判——`setAvailableModels` **不**重跑本判定，别指望"等列表到达自愈"；
  触发它要后端下发空 `available_models` **且** `/models` 也失败，那种情形本来也无处可切）；
- `readyModel` 不在列表 → `retired`，`fallback` = **判定所用那份列表的首项**。同源是必须的：
  ready 先于 `/models` 到达、或 `listModels` 失败（`useModelList` 静默吞错）时 store 列表仍是空的，
  目标另取就会「判出下架却拿不到目标」，而那个会话是真坏的，补救动作不能静默丢失；
- 否则 → `adopt`。

> 与 spec `2026-06-17:114` 的「`available_models` 不作为列表数据源」**不冲突**：这里只拿它当判定依据，
> 选择器的列表来源仍是 `GET /models`。两者是不同用途，勿混。

### 2. store action `syncSessionModel(pid, readyModel, readyAvailable)`（`src/store/index.ts`）

返回「要发 `session.set_model` 的模型 id」，`null` = 不发帧（action 有返回值的先例：
`applyDragSnap` 回报 `handled`）。发帧要 client 句柄，归 hook；store 只管落库与提示。

- **上下文校验先行**：`if (s.currentProjectId !== pid) return null` —— ready 帧可能属于已切走的
  项目（两个源头见下「顺手修掉的既有缺陷」）。它写的 `selectedModel` / `modelByProject` 都在
  persist 白名单里，写错会跨刷新留存，症状恰是本需求要消灭的「选择器与会话打架」，只是方向相反
  （B 项目显示 A 项目会话的模型）。**不变式归写入口所有**，不依赖每个调用点自觉。
- `adopt` → 走 **`setSelectedModel(model)`**：它已经是写入口不变式（含门禁 `gatedModel` 收口 +
  同步落 `modelByProject`），与 `model.changed` 的既有处理同口径。
- `retired` → 弹 `MODEL_RETIRED` toast（`kind: 'warning'`），返回 `action.fallback`。
- `none` → 不动任何状态。

**门禁优先**（只对 `retired` 起作用）：`modelGateLocked` 为真时返回 `null` 不发帧——
`useNewUserGate` 本来就会把会话切到 `BASE_MODEL`，两边同时发 `set_model` 是两条命令打架。
`adopt` 在门禁判定**之前**返回是刻意的：它走写入口，锁定态下 `gatedModel` 会把值改写成 Rez1；
反过来把门禁放在 `adopt` 前面，锁定态新用户就完全不回填，丢掉"会话真相"这条主线。

### 3. hook（`src/client/useKoubouConnection.ts` 的 `onEvent`）

`session.ready` 分支内（那里已有 `readyCount` / `wsRunIds` 的 ready 处理块）：传**闭包 `pid`** 与
payload 的 `model` / `available_models` 调 action，返回非空则 `client.setModel(next)`。
回填由后端的 `model.changed` 完成，**不由前端乐观写**——`set_model` 可能被
`invalid model` / `run already active` 拒掉。

### 4. 顺手清掉死参数

`buildWsUrl` 的 `model` 加 `!opts.sessionId` 条件，与 `backend` 同口径。后端 attach 根本不读它，
故**无行为变更**，纯粹是拆掉"建连就把模型带过去了"这个误导——它已经骗过一轮修复。

### 5. 顺手修掉的既有缺陷（过期帧污染，非本需求引入）

pid 守卫只护住模型回填这一个 action；过期帧照样进 `ingestKoubou` 的 messages，还会被
`useKoubouConnection` 里那处**用闭包 pid 当 key** 的快照落盘写成「新项目的消息存进旧项目槽位」。
两个触发源都堵掉：

1. `createKoubouClient` 的 `close()` 现在解绑 `onmessage`（`src/koubou/client.ts`）。
   **只解绑 `onmessage`**，不照重连路径那样四个全解绑——`onclose` 里的 `if (closedByUser)` 分支
   还要上报 `'closed'`，全解绑会把这个状态上报弄丢。
2. `listEvents` reject 时 `catch {}` 吞掉异常、跳过了它前面那道 `aborted` 守卫，继续落到建连
   ——为旧 pid 建出一个 `clientRef` 管不到、永不关闭的 client。`catch` 之后补 `if (aborted) return`。

## 约束与取舍

1. **默认模型维持 `models[0]`（Nick 定，沿用 2026-06-17）**，不引入 `default_model`。
   已知风险记录在此：`deploy/k8s-deployment.yaml:302-307` 的注释说明 `allowed_models` 的顺序**就是**
   给前端排选择器用的、且 Rez1「also the default」——`models[0] === default_model` 是运维手工对齐的
   结果，不是契约保证（`config.py` 的 `selectable_models` 只在"默认不在 allowed 里"时才把默认插到
   首位）。运维调序时前端毫不知情，切换目标会跟着变。真出问题时改用 `default_model` 是一行。
2. **toast 只管会话模型下架（Nick 定）**，不管"本地记忆/选择被 `resolveSelectedModel` 回落"。
   后者只是 UI 层的陈旧偏好、会话没坏（今天就已经静默回落，没坏过），静默让位给会话真相即可；
   一视同仁会让一个模型下架后、用过它的每个项目进去都弹一次，而其中大部分会话其实是好的。
3. **回填是静默的**，不额外提示"本项目正在使用 X"。选择器显示的本来就该是事实，之前显示 Rez1 才是
   bug，没有"变更"可提示。
4. **toast 用 `warning` 不用 `error`**：这是一次成功的自动补救（已下架 + 已替你切好），
   红色会把它说成事故。柔和档的先例是 `SESSION_SUPERSEDED`。
5. **`ready.model` ≠「用户的选择」**（见上文语义）。回填把"服务端默认"写进 `modelByProject` 会让它
   看起来像用户的显式选择。接受：项目记忆的用途就是"下次进来显示什么"，而这正是我们要显示的。

## 刻意不做：按订阅档位拦模型

评估过「会话模型是付费模型而当前是 free 档 → 弹订阅弹窗 + 降回 Rez1」，**结论是不做**——
前提本身错了。核对结果（2026-09-11，Nick 指出）：

- `modelGateLocked`（`src/lib/subscription/model-gate.ts`）要求 `isNewUser === true`，即模型锁只作用于
  「从未 build 出版本」的新用户；用户出第一个版本后 `useNewUserGate` 就把它翻成 false，此后**不论
  是否订阅过、订阅是否过期，都能自由选任何模型**；
- 后端也不强制（`premium_models` 仅展示；koubou 的 `GET /models` 与生成入口均无 tier 校验）；
- 真正的闸门是**积分**：各生成路径的 402（`isCreditError` → `creditModalOpen:'insufficient'`）与
  `credit.insufficient` 事件汇到同一张升购弹窗。

所以那条判据**拦的是产品本来允许的事**，还会替用户降级已有会话。正确行为就是本文主线：
照常把会话模型同步到客户端，消费超限时由积分弹窗接管。

另有两条事实，供将来真要做档位区分时参考：

- 前端**分不出"订阅过期"与"从未订阅"**：只有 `current_tier`，而 `'free'` 的定义就是「无订阅**或**
  订阅到期回落」（`src/lib/biz/types.ts:73`）；唯一带 `status:'expired'` 的 `getSubscriptionOrder`
  要订单 id，只有刚下单那次会话才有。
- 按**每个模型的最低档位**判定需要契约：koubou 的 `GET /models` 只返回扁平字符串数组，
  **无 `min_tier` / `locked` 标注**；`session.ready.available_models` 同源，同样没有。
  **前置条件是后端先加这个标注**——不采用前端硬编码「模型 → 最低档位」映射表（后端加新模型前端
  不改就判错，且属于前端自己编一套权限）。

顺带留下一条原则（从 `modelGateLocked` 的注释推广而来）：**「未知一律放行」有方向性。**
那里未知放行是为了**不剥夺**（把老用户误锁成只剩 Rez1 比漏放糟得多）；而任何「未知就施加限制」
的判据方向相反，必须要求**确认**才成立，不能照抄"非 true 即可"。

## 独立评审处置（干净上下文子代理，只给 spec 与 diff）

后端契约表被逐条对着 Python 源码复核，全部一致；四条判据的组合枚举无"静默什么都不做"、
也无"帧与提示不一致"的组合。采纳的实质问题：

- **`syncSessionModel` 缺项目上下文校验**（Important）：见「方案 2」的上下文校验与「顺手修掉的
  既有缺陷」。两条实测可达路径都已堵源头，守卫仍留在写入口。三条单测守护——摘掉守卫实测全红。
- **`retired` 的 fallback 与判定不同源**（Important）：原先判定用 ready 自带列表、目标却取 store
  列表，两者不同源时会「判出下架却拿不到目标」，补救静默丢失。改为随判定一并由纯函数给出。
- **两条测试名不副实**（Important）：①「列表为空时无处可切」入参使两个列表皆空，实际走的是 `none`
  而非 `retired`，删掉（`none` 组已覆盖）；②「幂等，项目记忆不变脏」的 `toEqual` 看不见
  `setSelectedModel` 每次新建的对象，改名为「值保持不变」并注明幂等于值而非引用。
- **TDZ**（Minor）：`onEvent` 里引用尚在初始化中的 `client` const。真实 WS 不可达
  （`connect()` 先 `await mintTicket()`），但 `factory` 是测试注入的 DI 缝，构造期同步 emit 的 fake
  会抛 `ReferenceError`。改成先声明 `let koubouClient` 再赋值。
- **测试里的 `plansCache as never`**（Minor）：收成一处最小合法值工厂，形状变化时会报错而非静默通过。

### 技术性异议（未采纳）

评审要一条「门禁锁定 + `adopt`」的用例，理由是"锁定态下 `adopt` 靠 `gatedModel` 强制 `BASE_MODEL`"。
实测该组合并非它设想的样子：`modelGateLocked` 必然要求 `tier === 'free'`，而锁定态下会话模型是
付费模型时同样走 `adopt`（判据不看模型），由写入口改写成 Rez1。已按真实机制补两条用例
（锁定态 + Rez1、锁定态 + 付费模型），而非它描述的那条。

### 记录不改（Minor）

- **toast 说"已自动切换"，而那条 `set_model` 可能被拒**：`_context_snapshot_active` 窗口会回
  `error{'run already active'}`，前端归一成 `RUN_ALREADY_ACTIVE` 再弹一次 toast，单槽 Toast 会
  **顶掉** `MODEL_RETIRED`，用户只看到一句「有任务进行中」，会话仍跑着下架模型直到下次 ready 重试。
  窗口很窄且能自愈。真要改，把 toast 挪到 `model.changed` 分支更合适（那里本来就在写落定值），
  代价是要携带"本次是补救"的状态。
- **`adopt` 的正确性依赖「两份可用列表同源」**：若 `ready.available_models` 比 `/models` 宽，
  `adopt` 会把一个不在下拉里的值写成选中且落进项目记忆；随后 `setAvailableModels` →
  `resolveSelectedModel` 会静默把**视图**打回首项，但**记忆里那个值不动**，下次进该项目又显示一次
  陈旧值。今天不可达：两者都是后端同一个 `selectable_models` property。前提若破，这里要补记忆回滚。
- **`sessionSlotKey` 用的是 `agentBackend`，而 ready 的权威 backend 在 `payload.backend`**：
  今天后端只跑 `cc`（`websocket.py` 直接拒掉其余 taxonomy），两者不可能不同；若哪天 codex 真可执行，
  这里与 `model.changed` 那条会一起写错槽位。
- **`syncSessionModel` 只由 ready 驱动**，任何"判定依赖的输入后到"都会静默失效（本轮撞过一次：
  列表后到）。若再撞第二次，应做成统一的「输入齐了重判一次」入口，而不是各打一个补丁。
- **锁定态下 `retired` 把补救转交给了一条自身带前置条件的链路**（评审 Minor 3）。
  `syncSessionModel` 在门禁锁定时对 `retired` 返回 `null`，补救全交给 `useNewUserGate`；而后者
  （`useNewUserGate.ts:59-67`）第一行就是 `if (!selectModelGateLocked(...)) return;`，且每条会话
  只发一次、`client.current` 为空时直接 return。**失效时序**：ready 到达时门禁已判定锁定
  （本 action 静默返回）而 `client.current` 尚未赋值 → 随后用户 build 出第一个版本、门禁解锁 →
  那个 effect 第一行就 return，再不补发。结果这个会话既没被本 action 切走、也没被门禁切走，
  继续把已下架模型打给上游，直到下一次 ready（重连/刷新）才重判。窗口窄且能自愈，但它与上一条
  「只由 ready 驱动、输入后到即静默失效」是同一类——只是这次后到的不是可用列表而是**门禁判定**。
- **`retired` 的 toast 绕过了 `setWarning` 语义入口**（评审 Minor 4）。`index.ts` 的注释立着
  「kind 由方法名承载，调用方不传 kind」的规矩，这里直接写 `set({ toast: { …, kind:'warning' } })`，
  理由是 `setWarning` 签名不带 `params`；`actions.ts` 有四处同样的裸写先例
  （`POSITION_SAVE_FAILED` / `GROUP_ASSIGN_FAILED`×2 等）。给 `setWarning` / `setError` 加可选
  `params` 形参是两行的事，能把这批先例一并收回入口——**留给做那次收口的人一并处理**。
- **`close()` 收了 `onmessage`，但 `onerror` 仍是无条件 `onStatus('error')`**（合并前评审 Minor 1）。
  时序：切项目 → cleanup 调 `close()` → `ws.close()` 作用在 CONNECTING 态 socket 上（部分浏览器
  此时派 `error`）→ 新项目 client 已置 `'connecting'` → 旧 socket 的 `onerror` 晚一拍改写成 `'error'`。
  后果是新连接正常却显示错误态，且 `shouldReconnectOnWake('error')` 为真会让新 client 挨一次无谓
  `reconnect()`。修法是 `onerror` 加 `if (closedByUser) return;`，与「用户主动关闭仍要上报 closed」
  不冲突。**未随本轮改**：它动的是共享 WS 客户端的状态语义、该配自己的用例，混进来会糊掉这批提交
  的边界；单独一轮修。
- **`model.changed` 的写入没有 pid 守卫，与 `syncSessionModel` 的口径不对称**（评审 Minor 2）。
  它同样写 `selectedModel` / `modelByProject` 且取实时 `currentProjectId`。**为何是例外**：两条
  stale 帧投递源头（`close()` 漏解绑、`listEvents` 失败漏 `aborted`）已在本轮堵掉，帧到不了
  `ingestKoubou`；而 `syncSessionModel` 那道守卫留着是因为**不变式该归写入口所有**——两者动机不同，
  不是同一标准的两套做法。**若将来再开一条帧到达路径（多 socket、跨标签广播等），这条要一起补。**

## 成功标准

1. 旧项目（会话落库 `claude-fable-5`、本地无记忆）进入后，选择器显示 **Fable 5**，与 `TurnFooter`
   一致；发一条消息仍走 fable 5，前后口径不再打架。
2. 会话落库模型已从 `allowed_models` 摘掉时：弹一次 toast（「模型 X 已下架，已自动切换到 Y」，
   warning 档），发出 `session.set_model(<判定列表首项>)`，回来的 `model.changed` 把选择器与项目
   记忆一并改成新模型；再次进入该项目**不再**触发 toast（记忆已是新模型）。
3. 新用户门禁锁定态下：`retired` 分支不发帧、不弹 toast（会话由 `useNewUserGate` 切到 Rez1）；
   `adopt` 分支正常回填，值由写入口的 `gatedModel` 改写成 Rez1，选择器与项目记忆都落 Rez1。
4. `ready.model` 为空、或可用列表两边皆空时：不动选择器、不弹 toast、不发帧。
5. 过期 ready（`pid` 与 `currentProjectId` 不符）一律丢弃；`close()` 之后到达的帧不再派发。
6. `buildWsUrl` 在 attach 路径不再拼 `model=`；create 路径照旧带。
7. 既有测试全绿（`model-selection` / `apply-koubou` / `ModelSelector` / `useNewUserGate` / `protocol`）。

## 真机复核（dev，已跑，2026-09-11）

用主仓 `.env` 的 `DEV_COOKIE` 起本分支到 3007（主仓 dev 分支的服务器在 3000，充当**无修复对照组**），
账号 user_id=35、项目 1613。

**① 回填（A/B 对照）**：两侧都清空 `localStorage` 后进同一项目——

| | 选择器 | 项目记忆 |
|---|---|---|
| 3000（dev 分支，无修复） | **Rez1** ← 即本 bug | `{}` 一直空 |
| 3007（本分支） | **Fable 5** | 回填成 `claude-fable-5` |

**② 后端契约**：独立 WS 客户端抓到的 `session.ready` 为
`model: "claude-fable-5"`、`available_models: 15 项(首项 Rez1)`。同一次 attach **刻意带了
`?model=Rez1`**，ready 仍回报 `claude-fable-5` —— **attach 的 `model=` 被后端忽略，死参数判断在真机成立**。
真实 dev 的 `default_model` 与列表首项都是 Rez1，印证约束 1 说的「运维手工对齐」。

**③ 下架 → toast + 自动切换**：dev 后端摘不掉模型，故在 dev WS 代理上加一次性改造
（环境变量控制，从转发的 ready 帧里摘掉 `claude-fable-5`），其余全走真链路。组件级日志：

```
[probe] syncSessionModel {readyModel: claude-fable-5, readyAvailableLen: 14, storeLen: 15, kind: retired}
[probe] Toast render {error: MODEL_RETIRED, shown: MODEL_RETIRED, mounted: true}   ← 3582ms
[probe] Toast render {error: null,          shown: MODEL_RETIRED, mounted: true}   ← 7583ms(自动消失,正好 4s)
[probe] Toast render {error: null,          shown: MODEL_RETIRED, mounted: false}  ← 7788ms(退场卸载)
```
且后端落库模型由 `claude-fable-5` → `Rez1`，证明 `set_model` 真发出并被受理。验证用的临时代码已全部还原。

**④ 门禁未误伤**：`/api/auth/me/new-user-status` 返回 `is_new_user: false`，走的是 `retired` 分支
而非 `useNewUserGate`。

### 真机才暴露的环境事实（排障用）

**dev 的 koubou 是多副本 + LB 会话亲和**：本地 node 脚本不带浏览器的亲和 cookie，会落到**另一个 Pod**
——它写的会话模型浏览器读不到，反之亦然（本轮据此误判过两轮）。**对同一 session 的读写必须收在同一条
亲和路径上**（要么全在浏览器，要么全在脚本），两者不可互证。

## 合并前独立评审（第二个干净上下文子代理）

Critical 无、Important 无。六条后端契约逐条对 Python 源码复核全部属实。它另做了**变异验证**证明守护
测试名副其实：删 pid 守卫 → 3 条红；删 `close()` 的 `onmessage` 解绑 → 1 条红；把 `fallback` 改取
另一份列表 → 2 条红。Minor 三条见上「记录不改」。
