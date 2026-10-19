# 终审记录：订阅升购弹窗回合

- 日期：2026-08-11
- 范围：`4be0030..bb39431`（分支 `feat/subscription-upsell-modal`）
- spec：[2026-08-11 订阅升档弹窗设计](../specs/2026-08-11-subscription-upsell-modal-design.md)
- plan：[实现计划](2026-08-11-subscription-upsell-modal.md)

## 评审是怎么做的（含一次失败）

派了两个干净上下文的子代理，只给 spec 与全分支 diff、不给会话历史：一个查正确性与契约，一个查 spec 一致性与仓库规范。

- **规范一致性评审交付了**，并自跑了四连验证。结论：无 Critical，7 条 Important，9 条 Minor。
- **正确性评审始终没交结论**（四次报空闲、两次补发任务书无效），那一半由实现者自审顶上——**独立性打了折**，下次回合应重跑这一半。

自审额外发现 1 条 Important（评审范围未覆盖）：低余额锁没绑用户 id。

## 已修（Important，8 条）

| 编号 | 问题 | 修法 | commit |
|---|---|---|---|
| I4 | 目标档不在 `plans[]` 时单卡弹窗三个分支全不渲染 → 只剩 hero 与说明行、**无任何 CTA 的死弹窗**；原注释声称「也回落充值」与代码不符 | Gate 判 `targetMissing` 回落三档并排 | `3284f9d` |
| I6 | `refreshBalance` 同时被在途兜底 tick 调用（run 期间每 15s），弹窗会盖在进行中的生成上，与「上一次生成完成后」不符 | 加 `terminal` 入参，三个终态漏斗显式声明，缺省 `false` fail-closed | `3284f9d` |
| 自审 | `lowBalanceLocked` 是布尔且未绑用户，共用浏览器换账号时锁被带过去、吞掉新账号第一次提示 | 改存 `lowBalanceLockedUserId` | `3284f9d` |
| I1 | 曝光埋点只带 `trigger`，而 `variant` 参与去重 stamp → 点 See all plans 会再发一条**完全相同**的记录 | payload 补 `tier` / `variant` | `a46ebe7` |
| I2 | 曝光报 `generate/low_balance`、点击报 `insufficient/lowBalance`，同一漏斗两套字面值 | 抽 `triggerDimension()` 共用 | `a46ebe7` |
| I7 | plans 的网络 IO 与竞态控制写在 UI 组件里，跨分层（同回合 `useSubscribeFlow` 就在 `client/`） | 抽 `client/useSubscriptionPlans.ts` | `bb39431` |
| I5 | 「二次打开走缓存」注释不成立：Gate 条件挂载、关窗即卸载，局部 state 随之丢 → 每次触发都重等一个往返且期间空屏 | 缓存提到 store 瞬态 `plansCache`，补「关窗再开不重复请求」用例 | `bb39431` |
| I3 / I3b | `welcomeBack` 用 `object-cover` 铺满，套在回落中的透明底宝箱上会**拉变形**；两处用例名声称验了「满箱稿」而实际只验字标 | 素材到位前沿用等比落位；用例改名并加「三变体共用回落图」断言（素材到位后会变红当提醒） | `bb39431` |

## 对评审建议提出的技术性异议（未照改）

1. **I7「顺带解决 I5」不成立。** 抽成 hook 后 state 同样随 Gate 卸载丢失；缓存要活过卸载只有两条路——提到 store，或让 Gate 常挂载。故两件事分开做。
2. **I6 建议的「锁的推进可照旧」会把提示彻底吞掉。** 非终态 tick 若推进锁，run 结束后的终态刷新会看到已上锁而不再弹，这次提示**永久丢失**，比弹在中途更糟。故非终态连锁也不碰，只更新 `credit`。

## 复验后判定不成立的怀疑（记录以免重复排查）

**`refreshBalance` 的并发窗口不存在。** 函数开头 `if (balanceInflight) return balanceInflight;` 做了在途合流，并发调用共用同一 promise、`.then` 只跑一次；两次 `get()` 之间无 `await`。

## 未修（Minor，留作欠账）

| 编号 | 问题 | 位置 |
|---|---|---|
| M1 | 轮询超时判定被持续网络失败绕过：`catch { return; }` 在 deadline 检查之前返回，上游持续失败时 `POLL_DEADLINE_MS` 永不触发，interval 只靠卸载停 | `useSubscribeFlow.ts` 轮询 effect |
| M2 | 两个弹窗各写一份 Escape 监听与失败态卡片（`PlansFallback` / `Fallback` 结构相同） | `CreditUpsellModal.tsx` · `AllPlansModal.tsx` |
| M3 | `UpsellTrigger` 与 `CreditModalSource` 是同一个 union，声明两处 | `useSubscribeFlow.ts` · `store/types.ts` |
| M6 | 「View all pricing options」直接卸载弹窗、跳过 `useRequestClose` 的 200ms 退场，观感是闪一下换窗（CLAUDE.md「退场不直接卸载」） | `CreditModalGate.tsx` |
| M7 | `topup_allowed=false` 时 CTA 禁用的用例缺失（对应 spec §降级「不静默下单」） | `CreditUpsellModal.test.tsx` |
| M8 | 产品名不一致：新增文案写 `Nano Banana Pro`，Max 分支复用的旧键 `insufficient.examples.p0` 写 `Nano Banana 2` | `i18n/locales/*` |
| M9 | `set({ creditModalKind })` 未做「`await` 后校验上下文」，与同一 catch 上一行的 `currentProjectId === pid` 判定不齐（影响仅进度卡图标） | `store/actions.ts` runGen catch |

## 顺带发现、与本回合无关

- **`CreativeLibraryModal.test.tsx` 在全量并行下偶发超时**（6 个用例，~1000ms 特征）。单独跑 14 passed，全量重跑亦全绿。用了假计时器 + 长等待，对负载敏感。属既有不稳定测试。

## 待回写的文档（spec/plan 与实际不符）

1. **plan T7** 承诺的 store `plansCache` 与 async `openCreditModal(source, kind)`：`plansCache` 现已落地（`bb39431`），但 `openCreditModal` 没有——触发仍是 `guard` 内联 `set`，资产类型走 `runGen` catch 旁路，路由归 `CreditModalGate`（plan 未提及该文件）。读者照 plan 去 store 里找会找不到。
2. **spec §支付闭环** 只写了轮询判据 `status='active'`，实际加严为 `status='active' && tier===目标档`（理由：升档改同一条订阅行，授权期间恒 active）。不回写的话后人照 spec 会改回去。
3. **spec §接口契约** 说 `topup_allowed`「只读不判」，§降级 又要求「CTA 禁用、不静默下单」——自相矛盾；代码取了更严那条。
4. **plan T3** 说 `--color-cta-highlight` 要在 `@theme` 与 `[data-theme="dark"]` 两处登记，实际只在 `:root`。**代码对、plan 错**（恒定色不进 dark 块，同 `--color-primary`）。
5. **plan T3** 承诺导出两张 hero 素材——未导出，见下。

## 阻塞合并之外的已知欠账

- **两张 hero 主视觉未导出**（`PENDING_HERO_ART`，greppable）：满箱宝箱（Figma `8047:165129`）与吉祥物实验室（`8372:178534`）。现三个变体共用回落图，`lowBalance` 与 `welcomeBack` 的主视觉是错的。
- **`--color-cta-highlight: #dcfb4b`** 按设计稿目视取值，未经设计确认（该填充在 Figma 未绑变量，`get_design_context` 取不到）。
- **进度卡的 `X / Y` · 进度条 · `N short`**：等后端在积分不足信号里补 `required_credits` + `asset_kind`。
