# 实现计划：撤销与浮层的五道护栏

> 设计稿：`docs/superpowers/specs/2026-08-07-undo-and-overlay-guards.md`
> 分支：`fix/undo-and-overlay-guards`（worktree：`.orca/worktrees/fix+undo-and-overlay-guards`）
> 铁律：每条先写复现它的失败测试，看到它红，再写生产代码。

## 任务顺序的理由

T1（token）改 `undo()` 签名与 `ToastMessage` 形状，T2（不吞反馈）依赖它落地后才好断言 ——
两者是同一条按钮路径的一体两面，放最前。
T3（归属）独立且最大（改 entry 形状 + 两侧接线）。
T4/T5 是接线级，互不相干，放最后。

---

## T1 · Toast 的撤销按钮绑 token

**先写的失败测试**
- `src/store/pending-delete.test.ts`：`删除后再拖一张卡入栈 → 按 token 撤销 → 删的卡回来、那次拖动不受影响`
  （现状红：撤掉的是拖动）
- 同文件：`token 已不在栈里 → 安全 no-op,不撤栈顶、不报成功`
- 同文件：`不传 token（⌘Z 路径）→ 仍撤栈顶`（回归）
- `src/components/ui/Toast.test.tsx`：`带 token 的 action → 点击以该 token 调 undo`

**改动**
- `src/store/types.ts`：`ToastMessage.action` → `{ type: 'undo'; token?: string }`
- `src/store/index.ts` `undo(token?)`：传 token 则按 `type in ('delete','deleteGroup') && token 匹配`
  从栈里精确摘出并执行，其余原样保留；找不到 → no-op
- `src/store/actions.ts`：`requestDeleteAssets` / `deleteGroup` 建 Toast 时带上各自的 token
- `src/components/ui/Toast.tsx`：`onClick` 传 `shown.action.token`

**独立可评审**：是。

---

## T2 · 按钮不再自己清 Toast

**先写的失败测试**（`src/components/ui/Toast.test.tsx`）
- `点撤销后能看到「已撤销」反馈（不被 clearToast 吞掉）`（现状红：toast 被清成 null）

**改动**：`Toast.tsx` 的 `onClick` 去掉 `clearToast()`。

⚠️ 注意 no-op 分支：token 找不到时 `undo()` 不写新 Toast，旧的继续挂到 `durationMs` —— 
与「窗口已过」的事实一致，spec 已认领，不额外处理。

**独立可评审**：是。

---

## T3 · `positions` entry 带归属快照

**先写的失败测试**（`src/store/undo.test.ts`）
- `拖卡入框后撤销 → 坐标与归属一起回到拖动前`（现状红：归属留在新框）
- `拖卡出框后撤销 → 归属回到原框`
- `不碰归属的拖动 → entry 不带 groups,撤销不发归属回写`（防过度触发）
- `tidy 的撤销不带 groups,行为不回退`（回归）

**改动**
- `src/store/types.ts`：`UndoEntry` 的 `positions` 分支增可选 `groups?: { id; groupId: string | null }[]`
- `src/components/canvas/AssetCanvas.tsx` `persistDraggedNodes`：已算出 `groupChanges`，
  入栈时把**变更前**归属一并记下（只在真的有变更时带该字段）
- `src/store/index.ts` `undo()` 的 `positions` 分支：`entry.groups` 有值时本地还原 + 走 `assignGroup`
  回写（**不**并进 `persistAssetPositions` —— 分组那轮约束 3：归属失败与坐标失败要分开报）

**独立可评审**：是（本批最大的一个）。

---

## T4 · 面板开着时药丸让位

**先写的失败测试**（`src/components/canvas/GenTaskBadge.test.tsx`）
- `inspectorOpen 为真 → 药丸右偏移让开面板宽度`（现状红：恒 right-5）
- `inspectorOpen 为假 → 位置与现在一致`（回归）

**改动**：`GenTaskBadge.tsx` 订阅 `inspectorOpen`，`right-5` / `right-[316px]` 二选一。
**不改 z、不新增组件**（CLAUDE.md 的 z 阶梯不得插新值）。

---

## T5 · 删框的关页兜底

**先写的失败测试**（`src/client/usePendingDeleteFlush.test.tsx` 或就近）
- `pagehide → 待删框也被 flush（keepalive）`（现状红：只 flush 卡片）

**改动**
- `src/store/actions.ts`：`flushAllPendingGroupDeletes` 接 `{ keepalive?: boolean }`，
  透传给 `deleteCanvasGroup`（若 client 不支持该选项，则与卡片那份对齐后再说 —— **实现时先核实**）
- `src/client/usePendingDeleteFlush.ts`：`flush` 里一并调用

⚠️ **实现前必须核实**：`pgcApi.deleteCanvasGroup` 目前有没有 `keepalive` 入口。
卡片那份 `deleteCanvasItem(pid, id, { keepalive })` 是有的；若分组那份没有，要么补上，
要么在 spec 里如实降级为「切项目/正常关闭时 flush，硬关页仍可能复活」。**不假装做到。**

---

## 验收

每个任务提交后派干净上下文子代理按 commit 范围独立评审（只给 spec 与 diff）。
全部完成后跑四道闸门，再按 spec 的 10 条成功标准做真机验收 ——
本批**全部可零 credit 验证**（撤销、浮层、删框都不涉及生成），没有借口不真机走一遍。
合并前终审全分支。

---

## 实跑记录（2026-08-07）

### 四道闸门

```
pnpm exec tsc --noEmit → 无输出                                    退出码=0
pnpm test              → Tests 2934 passed（连跑 2 轮均全绿）
pnpm lint              → ✖ 9 problems (0 errors, 9 warnings) = 本分支基线,未新增
pnpm build             → ✓ Compiled successfully
```

### 变异验证

- **T1**：`undo` 忽略 token 恒弹栈顶 → 两条 store 测试红。
- **T2**：按钮改回 `undo(); clearToast();` → 两条组件测试红。
- **T3**：`undo` 忽略 `entry.groups` → 两条归属还原测试红。

### ⚠️ 偶发红又出现了一次 —— 更正回合 D 的说法

本轮某一次全量跑出 **6 条红，全在 `CreativeLibraryModal.test.tsx`**（含「触底追加下一页」
「后发先至」两条）；该文件**单独跑 14/14 全过**，随后连跑两轮全量也全绿。

这与 `chore/test-fake-timer-reset`（回合 D）想封掉的**是同一个簇状形态**。所以那一轮的
commit message 里「封掉两例偶发红」的说法**不准确，现更正为：减轻但未根除**。
D 的两条修复本身是对的（都有确定性复现与前后对照），但显然还有第二个成因没找到。

如实记下当次观测，供后续追查：

- 触发时机：`pnpm test` 与 `pnpm lint` 在同一条命令里串行跑（机器负载较高）。
- 失败集中在同一文件、且是带 `waitFor` 的异步用例 —— 与「轮询被冻住 / 等待超时」一致。
- **我没有留下那次的完整失败输出**（只 grep 了标题行），因此无法指名根因。下次复现时
  应完整保存 `pnpm test` 输出再排查。
- 未排除的方向：`CreativeLibraryModal.test.tsx:51` 的 `vi.useFakeTimers()` 仍在**用例体内**
  （D 只加了全局 `afterEach` 兜底，没有把它挪进 `beforeEach/afterEach`）；
  以及该文件多条用例共享 `pgcApi.listLibraryAssets` mock 的 resolve 时序。

**本轮不追**（属回合 D 的遗留，且追一个间歇性问题需要先稳定复现）。已记入交接。

---

## 独立评审与采纳（2026-08-07）

评审判「修完 2 条 Important 再合并」，无 Critical。逐条核实后**全部成立、全部采纳**：

- **Important 1（已修）· 新增测试让真实网络请求逃逸**。`undo.test.ts` 的 mock 工厂只替换了
  `renameCanvasItem`/`updateCanvasReference`，而 T3 的撤销归属走 `assignGroup` →
  **真实** `batchUpdateCanvasItems`；`pending-delete.test.ts` 的 ⌘Z 回归用例走真实
  `persistAssetPositions`，两者都没 mock。断言在第一个微任务就跑完（所以是绿的），
  但请求会在**用例结束之后**失败并回滚本地 + 写 Toast / 调度重试定时器 —— 跨用例污染源。
  评审点出它与本分支记录的那簇未定位偶发红方向一致。**两个 mock 工厂各补上该方法。**
- **Important 2（已修）· plan 承诺的真机验收没落地**。补跑如下（零 credit）。

### 真机验收（2026-08-07，worktree dev :3013 打 pgc dev，项目 1633）

⚠️ **只跑了 10 条成功标准里的 2 条**（8 与 9）—— 它们是自动化只能断到「类名字符串」与「调用签名」、
证明不了真实行为的那两条。其余 8 条由单测 + 三处变异验证 + 四道闸门覆盖，**未真机走过**
（终审指出验收节原措辞「没有借口不真机走一遍」与实际表格不齐，此处如实收紧）。

| 标准 | 结果 | 证据（真实几何 / 服务端状态，不看类名与调用签名） |
|---|---|---|
| **8 面板开着时药丸完整可见且可点** | ✅ | 药丸右缘 **815**、面板左缘 **831** → **零重叠、间隙正好 16px**；`elementFromPoint(药丸中心)` 命中药丸自身（证明点得到）。**A/B 对照**：面板关时药丸右缘 1111，开时让到 815 |
| **9 删框后关页不复活** | ✅（限定见右） | 建真框 `grp-ff3feb1c6d36` → 删框 → **不等 6 秒窗口**直接 dispatch `pagehide` → 查服务端 `GET /canvas/groups`：**total 0、框已不在**，DELETE 确实发出并被服务端处理。**未验到**：真实浏览器 unload 期 `keepalive` 的投递（那是 fetch 规格的保证，且卡片删除路径在生产已依赖同一机制）|

收尾：探针卡与假任务已清，画布回到 9 张真实卡，框数 0，无残留归属。

### Minor 处理

- **M3（已修）**：`ToastMessage.action.token` 收成**必填**。收紧后 tsc 立刻揪出另外两处未传 token 的
  构造点（`Toast.test.tsx`）—— 正是这条改动的价值。
- **M5 / M6 / M7（已修）**：加回「只调一次」断言；补「不发归属回写请求」（spec 成功标准 6 的原话，
  此前只断本地没变）；`GenTaskBadge` 测试复用文件既有的 `seed()`。
- **M1（记录）**：`persistDraggedNodes` 的重排把三段挪进了 `if (pid != null)`。实际不可达
  （没有项目就没有卡可拖，且 `persistAssetPositions` 首行即 `if (pid == null) return`），
  评审认定不算缺陷 —— 但它是 diff 里唯一没被注释认领的行为变更，在此认领。
- **M2（记录不做）**：撤销时坐标与归属拆两个请求（约束 3 要求分开报）。
  ⚠️ 终审核实：两个请求**字段集不相交**（`positionBatchItem` 发 `reference/canvas_x/canvas_y`，
  而 `assetReference` 不含任何 group 字段；`assignGroup` 只发 `group_id`），两个在飞注册表也独立
  —— **不存在互相覆盖的竞态**。唯一代价是**部分失败态**：归属请求失败会 rollback 本地 `groupId`
  （弹回拖后的框）而坐标已还原且刻意不回滚。本轮不引入第三种机制去弥合。
- **M4 / M8（记录不做）**：面板退场期药丸单次瞬跳（非抖动循环，评审已核几何无误）；
  spec 说 `flushAllPendingGroupDeletes`「在 selectProject / switchProjectSession」调用，实际只有前者。

- **终审第 6 条（记录）**：`pending-delete.test.ts` 里 `persistAssetPositions` 仍是真实实现
  （`undo.test.ts` 那份是 mock 的），其 `positionInFlight` 是闭包级注册表、跨用例不重置。
  目前只有 ⌘Z 回归那一条用例走到，无问题；**后续在该文件再加「同 id 同坐标」的用例时会撞上
  「同坐标已在飞 → 静默合并」的假象**，届时一并 mock 掉。
