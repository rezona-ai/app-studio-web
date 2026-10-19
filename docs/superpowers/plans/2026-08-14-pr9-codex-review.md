# PR #9（dev → main）Codex 评审处置

- 评审源：GitHub PR #9 的 `chatgpt-codex-connector` 自动评审，针对 commit `08c0ae4b`，共 3 条 inline 意见。
- 处置日期：2026-08-14。修复分支 `fix/pr9-codex-review`。
- 口径：逐条对照代码验证后再决定采纳或异议；Critical / Important 修，Minor 记录在本文件。

## C1（采纳，Important）订阅成功后 plansCache 未失效

**原意见**：`useSubscribeFlow.ts:106` 成功分支只刷 user/balance，`plansCache.current_tier` 留在旧值，而 `useSubscriptionPlans` 在缓存非 null 时跳过拉取。

**验证**：成立。

- `plansCache` 全仓只有一个写入点（`useSubscriptionPlans` 拉取成功）+ 一个 setter，**没有任何失效点**。
- `useSubscriptionPlans.ts:41` 的 `plans != null` 短路确实会跳过重拉。
- `current_tier` 的三处下游后果：`CreditModalGate` 决定开哪个弹窗、`nextTier()` 决定推荐档位、以及作为 `currentTier` 传给 `useSubscribeFlow` 决定走 `createSubscription`（首次）还是 `changeSubscription`（升档）。

即同会话内升档成功后再开弹窗，UI 按旧档位渲染、推荐刚买的那档，点下去打的是首次订阅接口。踩计费接口，按 Important 处理。

**修法**：不能在成功那一刻清缓存——`CreditModalGate.tsx:68` 见 `plans == null` 直接 `return null`，弹窗会当场消失、吃掉成功态的 1.5s 停留。故在 `useSubscribeFlow` 里记 `succeededRef`，**在弹窗卸载时**（自动关窗与用户手动关都会卸载）清缓存，下次打开重新拉。配套把 `setPlansCache` 的入参放宽到 `SubscriptionPlansData | null`。

**测试**：`src/client/useSubscribeFlow.test.tsx` 的 `订阅成功后让 plansCache 过期` 三例——成功那一刻不清 / 卸载时清 / 没成功不清。

## C2（采纳，Important；对方因果讲反了一半）异步生成提交被标成终态

**原意见**：`actions.ts:517` 对 video / 3D 也标 `terminal: true`，而真实终态在 `pollGenTasks`；余额已低于 20 时弹窗会盖在跑着的生成上。

**验证**：结论成立，但推理需要修正——`low-balance.ts:14-15` 的判据是 `balance` 而非 `spendable`，异步提交那一刻只有 held↑、`balance` 未动，所以这次判定读的是**提交前的旧余额**，而不是对方说的「已跌破」。

正常流里那个旧状态在上一次生成的终态刷新时已判过并上锁，此刻是 no-op；真正的漏洞在「`locked=false` 但 balance 已 <20」的边缘态（冷启动后跨端消费、或解锁后余额在无终态刷新的路径下掉下去），此时提交异步任务会当场把弹窗盖在正在跑的生成上——正是 `actions.ts` 里终审 I6 为兜底 tick 写下的那条口径被另一条路径绕过。

**修法**：`runGen` 提交后的刷新按 kind 分——同步（image/audio）此刻已扣费，仍是终态；异步（video/3d，含两类 3D 派生）改非终态，终态交给 `pollGenTasks` 任务离队时那次（含超时 / 失败兜底，不会漏掉提示）。

**测试**：`src/store/low-balance-trigger.test.ts` 的 `提交时的余额刷新:只有同步生成算终态` 两例。

## C3（部分采纳，Minor，未在本轮修）遮罩硬编码 `bg-black/40`

**原意见**：`CreditUpsellModal.tsx:61` 用了 `bg-black/40`，应改 `--color-scrim`。

**验证**：方向对，定级不同意。

- `--color-scrim` 值就是 `rgba(0,0,0,0.4)`，与 `bg-black/40` **完全等价**，改动零视觉零行为差异。
- 全仓 `bg-black/40` 共 **9 处模态**（TopupModal / CreateGameModal / ImportProjectModal / RenameAssetModal / TextEditorModal / DeleteAssetModal / CreativeLibraryModal / ApkExportModal / CreditUpsellModal），用令牌的只有 `WorkbenchSharePopover` 一处。令牌注释写着「替代散落的 bg-black/40 硬编码」，说明这是一次**没做完的迁移**；本文件是跟了周围 8 个兄弟的写法，不是新引入的独立违规。只改这一个反而更不一致。

**遗留待办**（本轮不做，避免混进发布 PR）：

1. 单开 chore 把 9 处 `bg-black/40` 一次性换成 `bg-[var(--color-scrim)]`。
2. **对稿确认**：同一回合的两个升购弹窗遮罩浓度不一致——`AllPlansModal.tsx:45` 用 `--upsell-scrim`（0.8 + blur），`CreditUpsellModal.tsx:61` 是 0.4。Codex 没看出这一点，但它比令牌化本身更值得确认是稿上如此还是漏改。

## 验证

本轮在 `fix/pr9-codex-review` 上跑的完整门（命令 + 退出码见提交说明）：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全 0。

---

# 第二轮：Codex 对 `096251dc` 的复评

修复推上去后 Codex 重跑了一次，原三条不再提，新提两条 P2，都落在 `refreshBalance`。两条都验证成立并已修（分支 `fix/pr9-review-round2`）。

## C4（采纳）回血后锁不解，新的低余额区间被吃掉

**原意见**：解锁只发生在终态生成刷新里，而充值 / 订阅成功走 `loadUserInfo()`，它只写 `credit` 不评估锁。

**验证**：成立，但触发面比对方说的窄。`loadUserInfo` 确实只 `set({ credit })`；非终态刷新也刻意不推进锁。不过大额回血后的**下一次**终态刷新通常仍在阈值以上，那一次会顺手解锁。真正丢提示的是「回血后紧接着又跌破」——例如警示于 15、小额充值到 25、下一次生成扣 8 到 17：这次终态刷新看到 `locked=true` 就不弹了，这个新区间的提示永久丢失。

值得注意的是 `low-balance.test.ts` 里早有一条 `解锁后再次跌破会重新弹(充值/续订 → 再消耗完)`——纯状态机一直是这么设计的，是**接线**没把回血路径接上。

**修法**：`low-balance.ts` 加纯函数 `unlockedByBalance(balance, locked)`——状态机的「只解锁」分支：余额 ≥ 阈值就解锁，低于阈值保持原样（**绝不在这里上锁**，上锁会让终态那次不再弹）。`actions.ts` 里由 `unlockPatch()` 包一层（锁按用户存，只解当前用户自己的锁），挂在非终态刷新与 `loadUserInfo` 两处。

**测试**：`low-balance.test.ts` 的 `unlockedByBalance` 三例 + `low-balance-trigger.test.ts` 的 `回血解锁:不限于终态刷新` 四例（含「回血后又跌破照常弹」这条端到端复现，以及「余额仍低时非终态路径不动锁」这条反向护栏）。

## C5（采纳）在飞合流吞掉 terminal 意图

**原意见**：非终态刷新在飞时，终态调用直接返回那个 promise，其 callback 捕获的 `opts.terminal` 是 false，完成时的低余额判定被跳过且无补偿。

**验证**：成立。`if (balanceInflight) return balanceInflight;` 无条件合流，`opts` 是首个调用者的。可达性也是结构性的——`useBalanceRefresh` 的 15s tick 恰好在 `running || genTasks.length > 0` 时才建 interval，而 `pollGenTasks` 的终态刷新正是在任务离队时发出，两者天然并发；窗口约等于一次 `/credits/balance` 往返除以 15s。

它与 C2 的修复有直接交互：video / 3D 的提示现在只剩 `pollGenTasks` 那一次终态刷新，被吞就没有第二次机会。

**修法**：不能像对方暗示的那样「把在飞请求提升为终态」——那个 GET 在生成完成前就发出了，响应里的余额可能还没扣完，提升等于拿「完成前」的旧余额做终态判定，与 C2 同源的坑。改为**排队重发**：终态撞上在飞的非终态时，等它结束后再真跑一次（`queuedTerminal` 去重，避免多个终态调用各排一条）。同终态性之间仍然合流，保住「多个生成同时完成只打一个请求」的初衷。

**测试**：`low-balance-trigger.test.ts` 的 `刷新合流不能吞掉终态意图` 两例——排队重发后用完成后的余额判定并弹窗；多个终态并发仍只发一次请求。

## 第二轮验证

`fix/pr9-review-round2` 上：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test`（218 文件 / 2293 用例）/ `pnpm build` 全 exit 0。

---

# 第三轮：Codex 对 `4c8e89b0` 的复评

三条：两条采纳并已修（分支 `feat/subscribe-order-watch`），一条定级 Minor 留待办。

## C6（采纳）订阅轮询随弹窗卸载而死

**验证**：成立。所有关闭路径都不受 `phase` 约束——`CreditUpsellModal` 的遮罩点击（:66）、Escape（:48）、关闭按钮（:78），`AllPlansModal` 的同三处（:50 / :36 / :60）；只有 CTA 是 `disabled={phase !== 'idle'}`。最尖锐的是 **`onSeeAllPlans`（`CreditUpsellModal.tsx:179`）**：`waiting` 期间点它，Gate 改渲染 `AllPlansModal`，`PlanBody` 卸载，`clearInterval` 带走轮询——用户根本没想放弃，收银台还开着。

**修法**：轮询提进 store，详见 `docs/superpowers/specs/2026-08-14-subscribe-order-watch.md` 与同名 plan。要点：在飞单 `subscribeOrder` 归 store，节奏由新的 `useSubscribeWatch` 在 Workspace 层驱动，成败副作用（Toast / `loadUserInfo` / plansCache 失效）搬进 `pollSubscribeOrder`；hook 内旧轮询与 C1 的 `succeededRef` 一并删除（替换不堆叠）。

## C7（采纳）失败路径绕过 10 分钟超时

**验证**：成立。`catch { return; }` 在 else-if 链之前直接返回，持续 5xx / 超时会让弹窗永远停在 `waiting` 并每 3s 打一次。既有覆盖只有「单次失败下轮继续」，抓不到。

**修法**：轮询搬进 store 后，失败分支先判超时再跳过本轮。

## C8（部分采纳，Minor，未修）宝箱字标三段字面色

**验证**：方向对，定级不同意，理由与 C3 同源且多两条：

1. 这三个值**就在令牌层文件里**（`globals.css`），不在组件里。规则约束的是组件不许硬编码；`--hero-stroke-chest`(:54) 之所以是令牌，正因为 `UpsellHero.tsx:67` 要跨出文件注入它。这三段只在本文件内消费。
2. 紧邻的上一条 `.hero-wordart-warm`(:708) 里的 `#371801` 是同样写法，**未被标记**——同一把尺子没量到它。

**遗留待办**（与 C3 合并到同一个 chore）：

1. 9 处 `bg-black/40` → `bg-[var(--color-scrim)]`。
2. `.hero-wordart-chest` 三段命名为 `--hero-chest-from/mid/to`（顺带看 `.hero-wordart-warm` 是否同办）。
3. 两个升购弹窗遮罩浓度不一致（0.4 vs `--upsell-scrim` 0.8）需对稿确认。

## 第三轮验证

`feat/subscribe-order-watch` 与合并结果上均跑满四道门：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test`（220 文件 / 2310 用例）/ `pnpm build` 全 exit 0。

**过程偏差（记录在案）**：本轮实现先于测试写出，违反「无失败测试不写生产代码」。补做了两处变异验证代替——去掉失败路径的超时判定 → `持续拉单失败满 10 分钟` 转红；成功时无条件清 plansCache → `弹窗开着先不清` 与 `充值弹窗/all-plans 开着` 两例转红；恢复后 14 例全绿。证据等价，但顺序不合规矩，下次先写测试。
