# 实现计划：钱与可见性的五道护栏

> 设计稿：`docs/superpowers/specs/2026-08-07-credit-and-visibility-guards.md`
> 分支：`fix/credit-and-visibility-guards`（worktree：`.orca/worktrees/fix+credit-and-visibility-guards`）
> 铁律：每条先写复现它的失败测试，看到它红，再写生产代码。

## 任务顺序的理由

五条按 spec 约束 4 **彼此独立**，顺序可任意。这里的排法只为减少同文件冲突与心智切换：

- T1 只动 `NodeCard.tsx`，与其余四条零交集，放最前当热身。
- T2 / T3 / T4 都动 `src/store/actions.ts`，串行做，按「改动微妙度」递增排：
  T2 是一行位移，T3 引入第二个定时器（假时钟，最容易写出假绿），T4 改 await 顺序。
- T5 铺 11 个语言文件，机械但量大，单独放最后，不与逻辑改动混在同一个提交里。

---

## T1 · `canDerive` 左支加 `status === 'ready'` 白名单

**先写的失败测试**（`src/components/canvas/nodes/NodeCard.test.tsx`）

- `status:'error'` 的真实 video 卡单选 → **不渲染**「从此生成」触发带 / 「+」（现状红：会渲染）
- `status:'generating'` 的真实 video 卡单选 → 同样不渲染（现状红）
- `status:'ready'` 的真实 video 卡单选 → 照常渲染（回归，防误伤）
- `status:'ready'` 的 image 卡单选 → 照常渲染（回归）
- `status:'error'` 的 3d 卡 → 不渲染（现状已绿；作为「右支口径不被改坏」的回归锚点）

断言抓 `[data-derive-band]` 这个已有的属性钩子，不新增 test-id。

**改动**（`src/components/canvas/nodes/NodeCard.tsx:66`）

```ts
// 无产物的卡不能当生成源:点下去必然再失败一次(还可能计费)。
// 与右支 canDerive3d 同口径取白名单 —— error / generating / pending 一并挡住
const canDerive = !isPlaceholderId(assetId)
  && ((asset.status === 'ready' && derivableKinds(kind).length > 0) || canDerive3d(asset));
```

**变异验证**：把 `'ready'` 改成 `'error'`，四条断言应精确变红/变绿翻面。

**独立可评审**：是。

---

## T2 · 显示口径换成 `spendable`，失败侧才补上刷新

> ⚠️ 本任务在实现期间**改过范围**：原定「把 `refreshBalance` 挪进 `finally`」经核实是 no-op
> （pgc 的 `reserve` 只动 `held`，失败 `release` 后 `balance` 不变，而屏幕上印的正是 `balance`）。
> Nick 拍板改为「显示 spendable + 失败侧刷新」配套做。前因后果见 spec 缺陷 2 的
> 「原描述为什么塌了」一节。**两步分两个提交。**

### T2a · 四处显示从 `balance` 换成 `spendable`

**先写的失败测试**

- `src/components/preview/UserInfo.test.tsx`：
  `credit={balance:1000, held:400, spendable:600} → 账户条显示 600、title 也是 600`（现状红：1000）
- `src/components/ui/InsufficientCreditsModal.test.tsx`：
  `同一份 credit → 描述行显示 600`（现状红：1000）
- `src/components/ui/TopupModal.test.tsx`：
  `同一份 credit → 余额卡大字显示 600`（现状红：1000）

三条各自断言「不含 1000」，否则 `formatCredit` 的紧凑写法可能让 `600`/`1000` 的子串判定失真。

**改动**：四处 `credit?.balance` → `credit?.spendable`，各带一行注释指向后端契约
（`docs/api/credits.md:35`「展示用 spendable，勿本地推导」）。**不**本地算 `balance - held`。

**变异验证**：改回 `balance` → 三条断言全红。

**独立可评审**：是。

### T2b · `refreshBalance()` 从 try 尾部挪进 `finally`

**先写的失败测试**（`src/store/actions.credit-refresh.test.ts`，该文件已存在）

- `同步生成抛 402（余额不足）→ refreshBalance 被调用一次`（现状红：0 次）
- `同步生成抛 422（参数错误）→ refreshBalance 被调用一次`（现状红：0 次）
- `请求被 abort（ABORTED）→ refreshBalance 仍被调用一次`（现状红：0 次）
- `生成成功 → refreshBalance 仍只被调用一次`（回归，防 finally 与原 try 尾部重复触发）

402 那条一并断言 `creditModalOpen === 'insufficient'`，把「弹窗与刷新同时发生」锁死。

⚠️ **改写既有用例**：`生成失败 → 不刷余额(未扣费,无需多打一次请求)` 的理由在 T2a 之后作废
（失败会改 `held` → 改 `spendable` → 改屏幕上的数字）。断言翻面，用例名与理由一并重写，
**不留一条理由已作废的测试**。

**改动**（`src/store/actions.ts` `runGen`，约 704 行）

- 删掉 try 末尾的 `void refreshBalance();`
- `finally` 内 `unregisterInflight(placeholderIds);` 之后加 `void refreshBalance();`
- 注释改写：漏斗覆盖成功 / 失败 / 取消三条路径；写明为什么失败也要刷（`release` 改 `held`
  → 改展示用的 `spendable`）、为什么取消也要刷（abort 只切前端，后端可能已 reserve/settle）。

**变异验证**：把 `finally` 里那行挪回 try 尾部，三条失败/取消断言应变红。

**独立可评审**：是。

---

## T3 · 坐标失败 Toast 加「首次失败起 3s 必发」上限

**先写的失败测试**（`src/store/actions.test.ts`，`POSITION_SAVE_FAILED` 那一簇附近）

- `持续失败:每 100ms 触发一次 notePositionFailure、推进 5s → 至少发出 2 条 Toast`
  （现状红：0 条 —— debounce 被无限推后）
- `零星失败:单次 notePositionFailure(1) → 800ms 后一条 count=1 的 Toast`（回归，手感不能退）
- `上限发出后,后续新一轮失败仍能正常聚合并发出`（守 spec 里点名的「只清一个定时器」陷阱）

⚠️ 这三条用假时钟。按接手须知 2，**跑整文件**判红绿，不用 `-t` 过滤（同文件更早用例设的 mock
不跨用例重置，过滤跑会给出假象）。假时钟的全局 `afterEach` 兜底已由 P0-D 落地，沿用。

**改动**（`src/store/actions.ts:1537` 一带）

- 新增常量 `POSITION_FAIL_TOAST_CAP_MS = 3000`（放在 `POSITION_FAIL_TOAST_WINDOW_MS` 旁，带注释）
- 抽出 `flushPositionFailures()`：**同时清两个定时器** + 计数归零 + `set` toast
- `notePositionFailure` 里 debounce 照旧，另加 `failedToastCapTimer ??= setTimeout(flushPositionFailures, CAP)`
- 顺手把 `POSITION_FAIL_TOAST_WINDOW_MS` 那句「同窗口内聚合」的注释改准（它描述的是固定窗口，
  实现是 debounce，本就不符），说明现在是「debounce + 硬上限」两段式

**变异验证**：把 `??=` 改成 `=`（即上限也被重置）→ 持续失败那条应变红。

**独立可评审**：是。

---

## T4 · 退组与框几何 PATCH 解绑

**先写的失败测试**（`src/store/actions.test.ts` 的 `renameGroup / updateGroupGeometry` describe 内）

- `updateCanvasGroup 抛错 → assignGroup 对应的 batchUpdateCanvasItems(group_id:null) 仍被发出`
  （现状红：一条请求都不发）
- `updateCanvasGroup 抛错 → 被挤出的卡本地 groupId 已清空`（几何与归属不再打架）
- `updateCanvasGroup 成功 → 退组请求照发,入参与失败路径一致`（回归）
- `没有成员被挤出时 → 不发多余的归属请求`（回归，防 `void` 化时漏掉 `evicted.length > 0` 判断）

**改动**（`src/store/actions.ts:1212-1219`）

把 `if (evicted.length > 0) await assignGroup(evicted, null);` 从 `await trackGroupWrite(...)`
**之后**移到**之前**，并改为 `void`：

```ts
// 退组与框几何互不构成因果:框的 PATCH 失败不是「不该退组」的理由(此前串在它后面,
// PATCH 一抛错就一条退组请求都不发,留下「几何已改、归属还在组里」的半态)。
// 提到 await 之前还让本地退组即时生效(assignGroup 第一步 apply 是同步的)。
// void 安全:assignGroup 内部 try/finally 自收错误、不 rethrow
if (evicted.length > 0) void assignGroup(evicted, null);
await trackGroupWrite(gid, () => pgcApi.updateCanvasGroup(pid, gid, { ... }));
```

**变异验证**：改回 `await` 且放到 PATCH 之后 → 前两条断言应变红。

**独立可评审**：是。

---

## T5 · 补 `COPIED` 词条

**先写的失败测试**

- `src/i18n/errors.test.ts`：`resolveErrorMessage('COPIED', '', t) 返回非空译文`（现状红：返回 `''`）
- `src/components/canvas/AssetInspector.test.tsx`：`点「复制提示词」→ toast.code === 'COPIED'`
  （现状绿，作为落点锚点）
- 若仓库已有「11 语 key 齐全」的守护测试则复用；没有就在 `errors.test.ts` 里断言
  `canvas.inspector.copied` 在 zh / en 两份词典中都存在（不给 11 语各写一条，避免测试通胀）

**改动**

- `src/i18n/errors.ts`：`ERROR_KEYS` 加 `COPIED: 'canvas.inspector.copied'`，
  带注释说明它是 success 类 code（该表已收 `UNDO_*` 同类先例）
- `src/i18n/locales/{zh,zh-TW,en,ja,ko,de,es,fr,pt,ru,vi}.ts`：
  在 `canvas.inspector` 下加 `copied`（zh 「已复制」/ en 「Copied」/ 其余照该语言既有 `preview.copied` 的译法对齐）

⚠️ 接手须知 4：**脚本化改多语言文件必须断言替换真的发生**（上轮有过 `str.replace` 因括号全半角
不匹配静默成空操作）。落完 `grep -c "copied" src/i18n/locales/*.ts` 逐个核对计数。

**独立可评审**：是。

---

## 验收

1. 四道闸门在**合并结果**上重跑：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，
   完整命令 + 输出 + 退出码留档（铁律 3）。
2. 每个任务提交后，派干净上下文子代理按 commit 范围独立评审（只给本 spec + 该提交 diff）。
   Critical / Important 修完才继续，Minor 记录给终审。
3. 合并前终审全分支。
4. 真机验收（spec 约束 2：零 credit）——
   - T1 / T4 / T5：种 store 态 + 真实 action + 真刷新，全程不触发生成。
   - T2：用 422 参数错误路径触发同步失败（不计费），观察余额请求是否发出。
     402 那条若无法零成本构造，如实记为「未验到」，不假称已验。
   - T3：断网（DevTools offline）后连续拖卡 5s，观察 Toast 是否出现。
5. 若 `CreativeLibraryModal.test.tsx` 的偶发红再现 —— 按接手须知，**完整保存 `pnpm test` 输出**
   再排查，不要只 grep 标题行。

## 实跑记录（2026-08-07）

worktree `.orca/worktrees/fix+credit-and-visibility-guards`，Node 22 / pnpm 11.5.3。

### 四道闸门（**在分支尖端重跑**，即合并结果）

⚠️ 此表曾停在 `f9b6c3ce`（五条刚落地时），而此后又落了 4 个提交、其中 3 个改生产代码
（`a597a2c7` / `a5ef4174` / `8c6783a1`）+ 采纳终审后的又一轮。终审 I1 点名了这处过期，
下面是**尖端实测**（铁律 3 要求在合并结果上重跑）：

| 闸门 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| lint | `pnpm lint` | 0 | `✖ 9 problems (0 errors, 9 warnings)` |
| 类型 | `pnpm exec tsc --noEmit` | 0 | 无输出 |
| 测试 | `pnpm test` | 0 | `Test Files 254 passed (254)` / `Tests 2978 passed (2978)` |
| 构建 | `pnpm build` | 0 | `✓ Compiled successfully` |

⚠️ lint 的 9 个 warning 是**既有基线**，不是本轮引入：`git stash` 后在干净 dev 上重跑
同样是 `9 problems (0 errors, 9 warnings)`；终审也在独立的干净 dev 上逐条对名核过。本轮零新增。

**类型检查抓到过一处 vitest 抓不到的错**：采纳终审后新写的一个测试辅助变量签名不符
（`TS2554`），而 `pnpm test` 是绿的 —— 四道闸门缺一不可，这就是活例。

测试总数演进：2940（T1 前基线）→ 2945（T2a）→ 2947（T2b）→ 2951（T3）→ 2955（T4）
→ 2956（T5）→ 2957（标签文案）→ 2958（T3 采纳）→ 2962（T4 补偿）→ 2972（Minor 批）
→ **2978**（终审采纳：AddAssetMenu 3 条 + 补偿 ABA 2 条 + i18n 措辞守护 1 条）。

### 变异验证（每条都做了，含两次自我纠错）

| 任务 | 变异 | 结果 |
|---|---|---|
> 下表的条数是**各任务当时**的实测值；随后续提交补测，同一变异会杀死更多用例
> （终审在尖端复测：T1 那条 **17 红**、T4 那条 **6 红**）。方向一致，此处不逐条回填。

| T1 | `status === 'ready'` → `'error'` | 12 条红（含既有 image 卡用例翻面） |
| T2a | 四处 `spendable` 改回 `balance` | 4 条红 |
| T2b | `refreshBalance()` 挪回 try 成功侧 | 3 条红 |
| T3-A | 上限定时器改成每次失败都真重置 | 1 条红（持续失败那条） |
| T3-B | `flush` 只清 debounce、不清上限 | 2 条红 |
| T4 | 退组改回串在 PATCH 的 `await` 之后 | 2 条红 |
| T5 | 抽掉 `ERROR_KEYS` 的 `COPIED` 映射 | 1 条红 |

**两次自我纠错（都是「绿的护栏其实没守住」，接手须知 3 点名的那类）：**

1. **T3 第一次的变异 A 是假变异**：只把 `??=` 换成 `=`，但没加 `clearTimeout` ——
   旧的上限定时器仍会按原时刻放炮，语义并没变成「上限被重置」。全绿是**变异本身无效**，
   不是测试无效。改成 `clearTimeout` + 重设后，测试精确变红。
2. **T3 的「陷阱守卫」测试原本没守住陷阱**：变异 B（flush 只清一个定时器）下，
   残留的上限定时器要到 t≈3000ms 才放炮，而我那条测试只推进到 t=2000ms，压根走不到。
   当时红的是**另一条既有测试**（`请求返回时项目已切走`，被跨用例泄漏的定时器误伤）——
   这不算守住。重写成「debounce 发完后一路推过 3000ms，屏幕必须保持干净」才真正抓到。

### 踩到的坑

- **`failedPositions` 是 store 闭包里的累加器，不随 `setState` 重置**：T3 的持续失败用例
  留下的在飞退避漏进了下一个用例，实测 `count` 从 1 变成 7。在该 describe 的 `afterEach` 里
  先 `advanceTimersByTimeAsync(5000)` 放干再切回真实时钟才隔离干净。
- `UserInfo` 此前**没有测试文件**，T2a 顺手补了一个（3 条）。
- 多语言插入按接手须知 4 做了「写入后读回断言」，11/11 全部核对通过（`grep -c` 逐文件为 1）。

## 独立评审与采纳（2026-08-07 / 08）

六个干净上下文子代理，各只给 spec + 对应 commit 的净 diff。**结论全部由主会话对着代码复核后才采纳。**

| 评审 | commit | Critical | Important | Minor |
|---|---|---|---|---|
| T1 | `82c3c5a7` | 0 | 0 | 4 |
| T2a | `6b35cacc` | 0 | **1（已采纳）** | 4 |
| T2b | `978117c3` | 0 | 0 | 5 |
| T3 | `b144a86d` | 0 | **2（均已采纳）** | 4 |
| T4 | `1913788f` | 0 | **1（已采纳，Nick 拍板）** | 5 |
| T5 | `4654db8d` | 0 | 0 | 4 |

### 四条 Important 的处置

1. **T2a：值改对了标签没跟上**（`6ba9b329`）。`balanceLabel` 11 语全是「余额」语义，
   显示 `spendable` 后成了「当前余额 600」而账面有 1000 —— 把本轮要消灭的矛盾换了个位置。
   *复核修正了它的范围*：`descPrefix` 只有 zh/zh-TW/ja/ko 四语说「余额」，其余七语本就中性。
   Nick 拍板改文案：11 处 `balanceLabel` + 4 处 `descPrefix`。
2. **T3-I1：`flush` 里清 debounce 那行无人守**（`a597a2c7`）。自行复现：删掉该行 **321/321 全绿存活**。
   真后果是残留 debounce 打在已归零的累加器上，弹「0 张卡」空 Toast。补镜像用例后该变异 2 条红。
3. **T3-I2：spec 成功标准 6 算术不自洽**（`a597a2c7`）。`CAP=3000` 下第一炮 t≈3.7s、第二炮 t≈6.7s，
   原文写「持续 5s 至少 2 条」**在算术上不可能通过**。已改 8s 并把算式写进标准。
4. **T4-I1：失败路径把瞬态半态换成了固化的归属丢失**（`a5ef4174`）。三条证据链逐条复核属实：
   `trackGroupWrite` 失败也摘票 → `loadCanvas` 取服务端旧几何 → `map.ts:156` 单向保留使卡保持已退组
   ⟹ 刷新后「大框 + 卡摆在框里却不是成员」。而改动前刷新即自愈。Nick 拍板加失败补偿。

### 提出技术性异议 / 修正评审说法的地方

- **T2b 对我的反驳成立，已接受**：我原本用「`markInflightDeleted` 整组 abort + `balanceInflight` 合流」
  论证不会有请求风暴。它实测「隔几秒删一张 → 5 次 abort 落在独立合流窗口 → 5 次 GET」，
  指出这两条**必要不充分**，真正的上界是**用户动作频率**而非卡片数量。论证已补全。
- **修正 T2a 的范围**：它只查了 zh 就断言「积分不足弹窗更直接」，实际七语本就中性（见上）。
- **T5 推翻了我的一处依据，已接受**：我以为 `ERROR_KEYS` 收 success 类 code 只有 `UNDO_*` 一个先例，
  实际 `PROJECT_IMPORTED` 早就是；它进一步指出真味道是**表名与函数名早已名不副实**
  （实为「toast code → i18n key」通用映射）—— 属本轮之前的欠账，改名要动三个文件，记入下轮。

### 本轮第三次「绿的护栏没守住」

T4 的补偿落地后我做了三处变异，**变异 3（去掉 `await evicting`）存活**：我那条「顺序」测试断言的是
**调用顺序**，而 mock 立即 resolve 时调用顺序恒等于完成顺序，压根区分不出有没有 `await`。
改写成「退组挂住不落定时，放回一条都不许发」后该变异精确变红。
连同实跑记录里的两次，本轮共三次靠变异验证抓出自己的假绿 —— 接手须知 3 应继续保留并加重。

### 评审流程本身的教训（下轮必须改）

**六个评审代理共用一个 worktree，其中两个在原地改生产代码跑变异，互相污染。**
T5 观察到工作区有活变异；T2b 发现自己的变异 C 那轮撞上了 T3 的活变异，
于是全部四轮在 pristine 文件上重跑、跑前跑后各取一次 `shasum` 证明期间无人改动（结论未变）；
T4 也丢过一次还原。所幸变异区域不相交，无人得出错误结论。

**下轮做法**：给每个评审者独立 worktree；退而求其次用 T4 的办法 ——
`cp -R src` + 软链 `node_modules` 到 scratchpad，用 `git show <commit>:<path>` 覆盖目标文件并核哈希，
变异全在副本里跑，共享仓库零接触。

### 终审（2026-08-08，两个干净上下文）

| 终审 | 范围 | Critical | Important |
|---|---|---|---|
| final-branch | 全分支 15 提交（跨提交作用 / spec 逐条 / plan 事实性 / CLAUDE.md 合规） | 0 | 2（均已采纳） |
| final-fixes | 评审后新写的 4 个修复（此前无人独立看过） | 0 | 3（均已采纳） |

两个终审**独立地点名了同一处**：`8c6783a1` 给 `AddAssetMenu` 加的收紧无测试、无文档，
且真走到时会渲染出「只有『生成』标题、下面一个条目都没有」的空组。已补 3 条组件用例
（变异回旧写法从「334 全绿逃逸」变成 2 条红）+ 空组不渲染 + spec/plan 记录。

**final-fixes 的两条 ABA 缺陷最要紧，已自行复现后修复**：我给缺陷 4 加的失败补偿
**自己也缺仲裁**，会变成它要修的那类 bug ——

1. **补偿放回没有逐卡仲裁**：几何 PATCH 失败通常意味着超时 / 断网，那段时间以秒计，
   够用户把卡拖进别的框；补偿会把它**改回原组并落库**。复现确认（`expected 'grp-1' to be 'grp-2'`）。
   修法：只放回「仍处于已退组、且卡还在」的那些。
2. **几何回滚没有「这份几何还是我落的」校验**：两次缩放重叠时，先发那次失败会把几何拽回
   **用户从未选过**的原始尺寸，而服务端已是后一次的值。修法：整体 `superseded` 门 ——
   本次落的几何若已被取代，几何不回滚、归属也不放回（新那次自己算过 evicted）。

两道仲裁各自变异验证：去掉任一条，对应用例精确变红。

其余采纳：补偿路径补 `pid` 校验（M1）；`await evicting` 从 `throw` 前面挪成链在 promise 上
（M2 —— 否则退组挂死时用户只看到框弹回去、没有「几何没保存」的 Toast）；
两处 `.catch(() => {})` 换成 `settleGroupWrite`，只静默已知 `PgcError`、未知错误抛回全局
（CLAUDE.md 反模式明写「guard 之外不 catch 非预期错误」）；常量 `export` 的注释改准
（`DELETE_GRACE_MS` 的类比不平行 —— 它在生产代码里被 import）；spec 标准 5 的「422」改成
实际用的「504」；4 语 `descPrefix` 补词条守护测试（变异改回「当前余额」精确变红）。

## 未验到

- **真机验收**（尚未进行）。零 credit 可验的部分：T1 / T4 / T5 种 store 态 + 真实 action + 真刷新；
  T2a 的显示变化种一个在飞 `genTasks` 即可；T3 用 DevTools offline 连续拖卡 5s。
  T2b 的 402 路径若无法零成本构造，如实记为未验到，不假称已验。
- **`spendable` 缺字段的失败模式**（T2a 知情项）：`pgc<BalanceData>` 是裸强转、无运行时校验，
  若上游哪天不返回 `spendable`，四处一起显示 0。加 `?? balance` 兜底会同时踩
  CLAUDE.md「臆测后端字段做兜底」与文档明禁的本地推导，**有意不加**。
- **`loadCanvas` 不尊重 `groupAssignInFlight`**（T4-M2）：退组在飞时 `loadCanvas` 落地会把卡拉回组里。
  对所有 `assignGroup` 调用点都成立，非本轮引入，且本轮并发化后暴露时长反而更短。记入工程健康度。
- **402 弹窗仍会闪一个 RTT 的旧数字**（T2b-M5）：`finally` 先发 GET → 重抛 → guard 同步开弹窗。
  改动前那个数字是**永久**旧的，现在只旧一个 RTT。要彻底消灭得让 402 分支 `await` 再开弹窗，
  等于给弹窗加一个 RTT 延迟，是另一笔权衡，本轮不做。
- **`ERROR_KEYS` / `resolveErrorMessage` 名不副实**（T5）：实为「toast code → i18n key」通用映射。
  改名要动 `Toast.tsx` / `MessageItem.tsx` / `actions.ts`，独立清理回合。
- **spec 标准 5 的「成功路径仍只调用一次（不重复）」没有测试守住**（终审 M4）。
  `actions.credit-refresh.test.ts` 文件头已诚实写明：断言打在 `api.getBalance` 上，
  而 `refreshBalance` 内部有在飞合流，「finally + 成功侧都刷」的变异在网络层看不出差别、能全绿逃逸。
  要真守住得给 `refreshBalance` 加注入面 —— 那是 CLAUDE.md 反模式里「为测试而加的包装」，**有意不做**。
- **`AddAssetMenu` 那条收紧今天不可达**（两个终审都确认）：唯一带 `sourceId` 的入口是
  `NodeCard.tsx` 的「+」，而它本身已被同一谓词挡住。保留的理由是「派生资格只该有一处定义」，
  新入口（如拖拽派生）才不会绕过；现已有测试与空组处理兜住。
- **`CreativeLibraryModal.test.tsx` 的偶发红又复现了一次**（终审 final-branch）：
  与另一重任务**并行**跑 `pnpm test` 时该文件 **6 条超时红**（5000ms testTimeout），
  单跑 14/14 绿，再次全量 254/254 全绿。`git log dev..HEAD -- CreativeLibraryModal.*` 为空
  ⟹ 本轮未碰。**新线索：是超时而非断言失败，且发生在资源争抢下** —— 这与 P0-D 修掉的两例
  （假时钟泄漏 / i18n 未 await）都不是一回事，指向测试本身的时限过紧或 mock resolve 时序对负载敏感。
  下次复现请完整保存输出。仍属既有 flake，CI 有概率红。
