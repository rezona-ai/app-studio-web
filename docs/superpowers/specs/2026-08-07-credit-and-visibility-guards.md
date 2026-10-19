# 钱与可见性的五道护栏：别让失败悄悄发生

> 状态：设计稿 · 2026-08-07
> 分支：`fix/credit-and-visibility-guards`（P2 第三批 / 共三批）
> 来源：2026-08-07 对 179 个未推送提交的 21 功能全量评审，五条**均已逐条对着代码重新核实**
> 前置：P0 四回合已收尾（A/C/D 合并，B 取消）；P2 第一批（撤销与浮层五道护栏）已合并

## 目的

上一批修的是「撤销自己骗人」。这一批修的是**失败发生了但用户不知道**：

- 拿一张已经失败的卡去生成，点下去必然再失败一次（还可能花钱）；
- 被「积分不足」拦下时，弹窗上却印着「你当前有 1000 积分」—— 屏幕上的数字和拒绝理由当面打架；
- 断网时把卡拖了半天，一条提示都没有，刷新后全回原处；
- 缩小分组框把卡挤出去了，框的 PATCH 一失败，退组请求一条都不发；
- 点「复制提示词」，弹出一个**完全空白**的 Toast。

五条的共性是：**系统知道出了问题，但这个信息没有走到用户面前**。每条都只需小改。

### 缺陷 1 · 失败卡仍露「从此生成 +」，能被当生成源

`src/components/canvas/nodes/NodeCard.tsx:66`：

```ts
const canDerive = !isPlaceholderId(assetId) && (derivableKinds(kind).length > 0 || canDerive3d(asset));
```

右支 `canDerive3d`（`lib/derived-3d.ts`）**本身已经看 `status === 'ready'`**，有专测覆盖；
缺陷只在 OR 的**左支** `derivableKinds(kind).length > 0` —— 它完全不看 `status`。

核实后的**精确影响面**（交接文档只说「失败卡」，不够准）：

| source kind | `DERIVE_MATRIX` | 失败态真实卡会露「+」吗 |
|---|---|---|
| `image` | `['image','video','3d']` | 会 —— 但同步生成失败留的是 `pending_` 占位卡，已被 `isPlaceholderId` 挡住；只有服务端拉回 `status:'failed'` 的 image item 才命中 |
| `video` | `['video']` | **会** —— 异步任务失败的真实卡（`vid-{task_id}`）就是这一类，是本缺陷的主战场 |
| `text` | `['image','video','3d']` | 会 —— 但文本便签不会失败 |
| `audio` / `3d` | `[]` | 不会（左支恒 false） |

另外 `Status = 'pending' | 'generating' | 'ready' | 'error'`（`store/types.ts:11`），
且 `map.ts` 的 `statusOf` 把服务端非 `ready`/`failed` 的一律映射成 `'generating'` ——
**处理中的真实 video 卡同样无产物**，现状也照露「+」，点下去同样必败。

### 缺陷 2 · 屏幕上印的是 `balance`，而闸门卡的是 `spendable`

> ⚠️ **本条的原始描述（「同步生成失败不刷余额」）经核实前提不成立，已重写。**
> 详见下面「原描述为什么塌了」。这是本轮第二次出现「评审断言合理、对着后端一查前提就塌」
> （第一次是 P0-B 的透明背景），处理方式相同：不照做，改修真问题。

pgc 的积分账本是 **hold 模型**（`docs/api/credits.md:31-35`）：
`GET /api/credits/balance` 返回 `{ balance, held, spendable }`，`spendable = balance - held`。
后端文档**两处明写**展示口径：

> `docs/api/credits.md:35`：「展示用 `spendable`，勿本地推导」
> `docs/deploy/credit-frontend-agent-integration.md:27`：「前端展示余额时直接使用服务端返回的
> `spendable`，不要本地用 `balance - held` 推导。`held` 会随着异步生成的预留和结算变化，
> 服务端返回值才是当前钱包视图。」

而前端**四处全都显示 `balance`**：

| 落点 | 场景 |
|---|---|
| `src/components/preview/UserInfo.tsx:28` | 账户条 hover 完整值 |
| `src/components/preview/UserInfo.tsx:35` | 账户条紧凑值（K/M/B） |
| `src/components/ui/InsufficientCreditsModal.tsx:105` | **积分不足弹窗的「你当前有 N」** |
| `src/components/ui/TopupModal.tsx:116` | 充值弹窗的 64px 大字余额卡 |

后果最刺眼的是第三处：几个视频 / 3D 任务在飞时 `held` 拉高、`spendable` 见底，
`_reserve` 抛 402 → 弹出「积分不足」窗 —— 而窗上白纸黑字印着「你当前有 1000 积分」。
**数字和拒绝理由当面打架**，用户只会以为系统坏了。

这是 CLAUDE.md 反模式清单第一条「尊重契约、不自作主张」的反面：后端把展示口径写进了文档，
前端取了另一个字段。

#### 原描述为什么塌了

原描述是「`runGen` 的 `void refreshBalance()` 只在 try 成功侧，同步失败不刷 ⟹ 余额停在旧值」。
核实 `canvas_gen_service.py:1651-1712` 的实际流程：

```
reserve(hold)  →  provider 调用 + 落盘 + register
                    ├─ 成功 → settle   （balance ↓，held ↓）
                    └─ 抛错 → release  （held ↓，balance 不变）
```

⟹ **同步生成失败时 `balance` 根本不会变**。而屏幕上印的正是 `balance`。
所以「把刷新挪进 catch / finally」在当前 UI 下**刷了也看不出任何区别**——
`actions.credit-refresh.test.ts` 里那条既有测试「生成失败 → 不刷余额（未扣费）」
的理由是**站得住的**，不是疏漏。

真正让失败侧刷新有意义的前提，是先把显示口径换成 `spendable`：
此后 `release` 的成败（含 `credit_meter.py` 文件头自认的「最终仍失败只记 error 吞掉，
悬挂 hold 交对账任务」）会改 `held` → 改 `spendable` → 改屏幕上的数字。
**两条是配套的**，故合并为本条一起修。

### 缺陷 3 · 坐标失败 Toast 是纯 debounce，断网期可能一直不出现

`src/store/actions.ts:1537` 的 `notePositionFailure`：每次失败都 `clearTimeout` 再重设 800ms。

`POSITION_FAIL_TOAST_WINDOW_MS = 800` 的注释写的是「同窗口内的失败聚合成一条 Toast」——
**注释描述的是固定窗口，实现却是 debounce**，两者本就不符。

后果：断网期间持续拖卡（每次拖停都触发一批失败），定时器被无限推后，
用户拖了几分钟、零提示，刷新后位置全回原处 —— 正是这段代码自己的注释所警告的
「静默数据丢失：摆好位置、刷新后全回原处且零提示」。

### 缺陷 4 · 缩放退组被框 PATCH 的成败绑住

`src/store/actions.ts:1207-1220` 的 `updateGroupGeometry`：

```ts
patchGroupLocal(gid, { ...geom, w, h });        // 本地几何立即生效
const evicted = /* 按新几何复判，算出被挤出框的成员 */;
await trackGroupWrite(gid, () => pgcApi.updateCanvasGroup(pid, gid, { ... }));   // ← 抛错就到此为止
if (evicted.length > 0) await assignGroup(evicted, null);                        // ← 一条请求都不发
```

整体包在 `guard` 里，所以 PATCH 抛错时后半段直接被跳过。结果：
**几何已经在本地改了、卡在视觉上已经出框，归属却还留在组里**，且服务端两边都没更新。

这正是 `assignGroup` 自己注释里警告的「几何是真相 vs 归属投影打架」：
成员数错、`moveGroup` 会带走看起来无关的卡、`tidy` 会跳过它们。

两件事本无因果 —— 框的几何写失败，不构成「不该退组」的理由。

### 缺陷 5 · 复制提示词弹空白 Toast

`src/components/canvas/AssetInspector.tsx:93` 发 `setSuccess({ code: 'COPIED', message: '' })`，
但 `'COPIED'` 不在 `src/i18n/errors.ts` 的 `ERROR_KEYS` 里。

`resolveErrorMessage` 的回落是 `return fallbackMessage` —— 而 fallback 正是那个空字符串。
于是弹出一个有边框、有图标、**没有任何文字**的 Toast。

对照组：`ContextMenu.tsx` 的 `BULK_DOWNLOAD` 与 `useTopupFlow` 的 `TOPUP_PAID` 都自带真实 message，
所以没暴露这个洞；`COPIED` 是唯一「空 message + 无词条」的组合。

## 约束

1. **不改既有 UI 种类**：不新建按钮 / toast / 动画，复用 `globals.css` 令牌与既有基础组件（CLAUDE.md「UI/UX 范式」）。
2. **零 credit 可验**：五条的验收都必须能在不触发真实计费生成的前提下走通（种 store 态 + 真实 action + 真刷新）。
   仅在无法回避时才动用真机生成，事先报数。
3. **不扩大契约**：只用文档已约定的后端字段，不臆测、不加 camelCase 兜底（反模式清单第一条）。
4. **每条独立可测、独立可评审**：五条各自一个提交，互不依赖（顺序可任意），便于按 commit 范围扇出评审。
5. **不引入新的 `await` 顺序耦合**：缺陷 4 的修法是解耦，不能反过来让退组去绑住几何写。

## 方案

### 1. `canDerive` 左支加 `status === 'ready'` 白名单（缺陷 1）

```ts
const canDerive = !isPlaceholderId(assetId)
  && ((asset.status === 'ready' && derivableKinds(kind).length > 0) || canDerive3d(asset));
```

**取白名单而非 `status !== 'error'` 黑名单**（Nick 定）：与右支 `canDerive3d` 已有的判据完全同口径，
两支不再一黑一白；连带挡住 `generating` / `pending` 的真实卡 —— 它们同样无产物，
拿去当源点下去必败。代价是比所报缺陷多挡一种状态，这是有意的。

### 2. 显示口径换成 `spendable`，失败侧才补上刷新（缺陷 2）

两步，配套但**各自独立可测、分两个提交**。

**2a · 四处显示从 `balance` 换成 `spendable`**（落契约）

`UserInfo.tsx:28,35` / `InsufficientCreditsModal.tsx:105` / `TopupModal.tsx:116`
一律改取 `credit?.spendable`。不本地算 `balance - held`（文档明禁）。

⚠️ 这是**用户可见的产品变化**：有异步任务在飞时，账户条数字会比现在小（小掉的正是 `held`）。
这是正确的钱包视图 —— 那部分钱已经被在飞任务预定了，花不出去。Nick 已确认接受。

`TopupModal` 的 64px 大字同样换：充值场景下用户要判断的是「还能花多少」，
而不是「账面挂了多少」。四处口径必须一致，否则用户在两个弹窗间看到两个数字更糟
（`InsufficientCreditsModal` 的 view-all 一点就切到 `TopupModal`，同一次点击内看到两个数字）。

**标签必须跟着换**（评审 T2a 指出，本节据此补充）。只换数字不换标签，等于把矛盾挪个位置：
印着「Current Balance 600」而账面确实有 1000。范围：

| 词条 | 语种 | 改动 |
|---|---|---|
| `topup.balanceLabel` | **11/11 全部** | 「余额」语义 → 「可用+该语言既有货币单位用词」（如 zh 可用积分 / zh-TW 可用點數 / en Available Credits） |
| `insufficient.descPrefix` | **仅 zh / zh-TW / ja / ko** | 去掉「当前余额 / 目前餘額 / 残高 / 잔액」字样 |

其余 7 语（en/de/es/pt/ru/vi/fr）的 `descPrefix` 本就是中性的「你有 / 你还剩」，**不动**。
账户条的 `preview.credit`（「积分 / credit」）同样中性，不动。

**2b · `refreshBalance()` 从 try 尾部挪进 `finally`**

```ts
try {
  await call(pid, placeholderIds, controller.signal);
} catch (e) {
  ...
} finally {
  unregisterInflight(placeholderIds);
  void refreshBalance();
}
```

一行位移，同时覆盖**成功 / 失败 / 用户取消**三条路径。
在 2a 落地后这才是有效的：失败走 `release`、`held` 回落 → `spendable` 变 → 屏幕上的数字变。

取消（`ABORTED`）也刷：abort 只切断前端这一侧，后端此时可能已 `reserve` 甚至 `settle`。
`refreshBalance` 是幂等 GET 且内部有在飞合流，多刷一次的成本可以忽略。

⚠️ 要**同步改写** `actions.credit-refresh.test.ts` 里既有的
「生成失败 → 不刷余额（未扣费，无需多打一次请求）」—— 它当初的理由在 2a 之前成立，
之后不再成立。改断言的同时把新理由写进用例名，别留一条理由已作废的测试。

### 3. `notePositionFailure` 加「首次失败起 3s 必发」上限（缺陷 3）

保留 800ms debounce（零星失败仍快速反馈，手感不变），另加一个**不被后续失败重置**的上限定时器：

```ts
let failedPositions = 0;
let failedToastTimer: ReturnType<typeof setTimeout> | null = null;
let failedToastCapTimer: ReturnType<typeof setTimeout> | null = null;

const flushPositionFailures = () => { /* 清两个定时器 + 归零 + set toast */ };

const notePositionFailure = (n = 1) => {
  failedPositions += n;
  if (failedToastTimer) clearTimeout(failedToastTimer);
  failedToastTimer = setTimeout(flushPositionFailures, POSITION_FAIL_TOAST_WINDOW_MS);
  // 上限:首次失败起最多 3s 必发。debounce 单独存在时,断网期持续拖卡会把它无限推后
  failedToastCapTimer ??= setTimeout(flushPositionFailures, POSITION_FAIL_TOAST_CAP_MS);
};
```

`POSITION_FAIL_TOAST_CAP_MS = 3000`。**两个定时器都由 `flushPositionFailures` 统一清理**——
只清一个会导致下一轮聚合被上一轮的残留定时器提前打断。

选 3s 而非直接改成固定 800ms 窗口（Nick 定）：固定 800ms 窗口下，断网拖卡会每 800ms 覆盖一次同一条
Toast，且计数每次归零，用户看到的是「3 张 / 5 张 / 2 张」跳动而非累计值，比现在更容易误读。

### 4. 退组与几何 PATCH 解绑，失败时补偿（缺陷 4）

> ⚠️ 本节在评审后**修订过**：初版只做解绑，被 T4 指出会在失败路径制造一个更糟的、
> 刷新后固化的不一致。Nick 拍板加失败补偿。下面是最终形态。

```ts
const prev = (get().groups ?? []).find((g) => g.id === gid);   // 补偿要用,须在本地改之前取
patchGroupLocal(gid, { ...geom, w, h });
const evicted = /* 按新几何复判 */;
// 发起顺序:退组不等框 PATCH(框写失败不是「不该退组」的理由);也不 await ——
// 反过来让退组绑住几何写同样违反约束 5
const evicting = evicted.length > 0 ? assignGroup(evicted, null).catch(() => {}) : null;
try {
  await trackGroupWrite(gid, () => pgcApi.updateCanvasGroup(pid, gid, { ... }));
} catch (e) {
  // 几何没落库,而 evicted 是新几何的**导出量** —— 只留导出量会让下次 loadCanvas 取回
  // 服务端旧几何(大框)、归属却保持已退组 ⟹「大框 + 卡摆在框里却不是成员」,
  // 刷新后固化、用户不可见、无法撤销。故两边一起退回「没发生过」
  if (prev) patchGroupLocal(gid, { x: prev.x, y: prev.y, w: prev.w, h: prev.h });
  if (evicting) { await evicting; void assignGroup(evicted, gid).catch(() => {}); }
  throw e;   // 仍交给外层 guard 报「几何没保存」
}
```

**补偿本身必须做 ABA 仲裁**（终审指出，本节据此再次修订）。PATCH 失败通常意味着超时 / 断网，
那段时间以秒计，够用户再操作一次；不仲裁的补偿会变成它要修的那类 bug：

- **仲裁一（整体）**：本次落的几何若已被后一次缩放取代（`superseded`），说明整个操作被超越 ——
  几何**不回滚**（否则把用户从未选过的原始尺寸写回去，而服务端已是新值），
  归属也**不放回**（新那次自己算过 `evicted`）。
- **仲裁二（逐卡）**：只放回「仍处于已退组、且卡还在」的那些。用户期间把某张拖进了别的框、
  或把它删了，那是更新的意图，补偿不许覆盖 —— 覆盖会落库，正是本条要消灭的破坏。
- 补偿路径的 `await` 之后同样要校验 `currentProjectId`（本文件 10+ 处同款守卫）。

另三处要点：

- **只还原几何四个字段**，不整份覆盖 `prev` —— 期间可能有改名落地。
- **放回要排在退组落到服务端之后**，否则两个请求乱序时服务端留下的是 `null`，补偿反被覆盖。
  但**不能 `await` 在 `throw` 前面** —— 退组挂死时用户就看不到「几何没保存」的 Toast、
  只看到框自己弹回去。故链在 promise 上（`void evicting.then(...)`）。
  断言这条的测试必须比对**完成顺序**而非调用顺序（mock 立即 resolve 时两者恒等，区分不出）。
- `assignGroup` **不是永不抛**：信封形状异常那条它有意不吞（见其内层 catch 注释）。
  浮动调用经 `settleGroupWrite` 收尾——只静默已知 `PgcError`，未知错误抛回全局，
  不踩反模式「`guard` 之外不 catch 非预期错误」。

### 5. 补 `COPIED` 词条（缺陷 5）

- `src/i18n/errors.ts` 的 `ERROR_KEYS` 加 `COPIED: 'canvas.inspector.copied'`；
- 11 个语言文件在既有 `canvas.inspector` 命名空间下加 `copied`（zh 为「已复制」）。

**不复用已有的 `preview.copied`**：跨命名空间借词条，日后改预览区文案会误伤画布提示。
两处各 11 语的重复是可接受的，命名空间边界更值钱。

## 成功标准

1. 一张 `status:'error'` 的真实 video 卡（`vid-*`），单选后**不出现**右侧「从此生成 +」；
   同一张卡改成 `status:'ready'` 则出现。
2. `status:'generating'` 的真实 video 卡同样不出现「+」（白名单的连带效果，需显式验）。
3. `status:'ready'` 的 image / text 卡「+」照常出现（不误伤）。
4. 账户条（数字 + hover 完整值）、积分不足弹窗、充值弹窗显示的都是 `spendable`；
   构造 `{balance:1000, held:400, spendable:600}` 时一致显示 600（现状显示 1000）。
4b. 标签与所显示的值同义：`topup.balanceLabel` 11 语均为「可用」语义（en 为 `Available Credits`，
   不再是 `Current Balance`）；zh/zh-TW/ja/ko 的 `insufficient.descPrefix` 不再含「余额」字样，
   其余 7 语保持原中性措辞不变。
5. 同步生成失败（含 402 余额不足与 504 超时两条）后，`refreshBalance` 被调用一次；
   用户取消（`ABORTED`）后同样被调用一次；成功路径仍只调用一次（不重复）。
6. 持续失败场景：每 100ms 触发一次 `notePositionFailure`、持续 **8s**，
   期间**至少发出 2 条** Toast（现状是 0 条），且每条 count 为该轮累计值（> 1，非空 Toast）。
   ⚠️ 驱动窗口必须 > 2×`CAP` + 首次失败延迟：`CAP=3000` 时第一炮在 t≈3.7s、第二炮 t≈6.7s，
   写 5s 的话这条标准**在算术上不可能通过**（评审 T3 的 I2 指出，已更正）。
7. 零星失败场景：单次 `notePositionFailure(1)` 后 800ms 内发出一条 count=1 的 Toast（手感不回退）。
8. `updateCanvasGroup` 抛错时，`assignGroup(evicted, null)` **仍被调用**（解绑属性）。
8b. 且随后补偿：本地几何回滚到旧值、被挤出的卡放回原组，
   放回请求必须在退组**落到服务端之后**才发出（断言完成顺序，不是调用顺序）。
   成功路径**不触发**补偿（几何保持新值、卡保持已退组）。
9. 缩放框把成员挤出后，退组请求与几何 PATCH 是**并发**发起的（不是串行等待）；
   反向亦然——退组请求挂住不落定时，几何 PATCH 仍照常发出（约束 5）。
10. 点「复制提示词」弹出的 Toast 显示「已复制」（zh）/「Copied」（en），不再空白。
11. 四道闸门在合并结果上重跑全绿：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。

## 明确不做

- **不动 `derivableKinds` 矩阵本身**（audio/3d 为什么不能当源是产品决策，不在本轮）。
- **不给 `release` 悬挂 hold 做前端补偿**：那是 pgc 的对账任务职责，前端只负责让显示的数字准。
- **不改 `useBalanceRefresh` 的 15s interval 条件**：本轮把漏斗补全后，同步失败已被覆盖，
  没有必要再放宽 interval 的触发条件（那会给空闲页面凭空加请求）。
- **不重构 `loadCanvas` 的 5 类保留规则**（`reconcileCanvas` 纯函数化）：那是「工程健康度」条目，
  独立回合，与本轮五条无耦合。
- **不碰 P2 第二批（列表与手感）与 P1（产品闭环）**。
