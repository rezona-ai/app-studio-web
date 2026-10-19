# 实现计划：在飞占位卡跨刷新存活

> 设计稿：`docs/superpowers/specs/2026-08-07-inflight-placeholder-persist.md`
> 分支：`fix/inflight-placeholder-persist`（worktree：`.orca/worktrees/fix+inflight-placeholder-persist`）
> 铁律：先写复现缺陷的失败测试，看到它红，再写生产代码。

## 任务顺序的理由

T1 先做状态与写入（快照跟着 `commitGenTasks` 走），T2 才是恢复（读快照）—— 反过来没东西可读。
T3 是回归护栏，专门钉住「不复活用户删掉的卡」与两条「行为不变」。

---

## T1 · 快照：`inflightCardsByProject` + `commitGenTasks` 顺带算

**先写的失败测试**（`src/store/actions.test.ts`）
- `登记异步任务后,inflightCardsByProject 里有那张 pending_ 卡`（现状红：字段不存在）
- `任务终结(commitGenTasks 落空表)→ 快照随之清空`（自动清理，无第二个清理点）
- `真实 item 的卡不进快照`（只存 `pending_`：真实卡刷新后由 `loadCanvas` 带回）

**改动**
- `src/store/types.ts`：`ServerState` 增 `inflightCardsByProject: Record<string, Asset[]>`；
  `createInitialServerState` 补默认 `{}`
- `src/store/actions.ts` `commitGenTasks`：按 `next` 的 itemId 集合 ∩ `isPlaceholderId` 算快照，
  与 `genTasksByProject` 在**同一次 `set`** 内落
- `src/store/index.ts` `partializeAppState`：白名单加 `inflightCardsByProject`（紧挨 `genTasksByProject`）
- ⚠️ 本轮**只加字段不改 persist key**，防白闪脚本不受影响。
  ✅ **实地核实后订正**（评审 M3）：`src/app/layout.tsx:24` 读的是 **`taluna-config`**（主站下发的配置），
  与 persist 的 `taluna-v4` 是**两个 key**；全仓 `taluna-v4` 只出现在 `store/index.ts`。
  结论（不受影响）对，但 CLAUDE.md「防白闪脚本硬编码 taluna-v4」那句说法本身不准确 —— 属仓库文档债，本轮不改。

**独立可评审**：是。只写不读，行为无变化，测试锁形状。

---

## T2 · 恢复：`restoreGenTasks` 剪枝前把卡接回来

**先写的失败测试**（`src/store/actions.test.ts`）
- `刷新场景:assets 只有服务端卡 + 持久化任务指向 pending_ → 占位卡被接回且任务保住`
  （现状红：任务被当残留剪掉、卡不存在）
- `接回来的卡带回 provenance 与 parentId/refIds`（不是裸卡）
- `快照里有、但持久化任务里已没有的卡 → 不接回`（幽灵防线）
- `assets 里已有同 id → 不重复插`（幂等）

**改动**
- `src/store/actions.ts` `restoreGenTasks`：函数**第一步**按 `inflightCardsByProject` 接回
  （只接「仍被持久化任务引用」且「当前 assets 里没有」的），随后走既有剪枝

**独立可评审**：是。

---

## T3 · 回归护栏：三条不变式

**先写的失败测试**
- `用户删掉生成中的卡 → 快照里也没有 → 刷新不复活`（spec 成功标准 4；
  删除会经 `removePlaceholderAsset` 摘掉 GenTask，快照跟着任务走，所以应当天然成立 ——
  但必须**显式测到**，否则将来有人换写入点就破了）
- ~~`同步生成(image/audio)的在飞占位卡不进快照`~~ —— **不写**：同步生成从不登记 GenTask ⟹
  结构上进不了 `referenced` 集合，写出来是重言式（评审 M2 指出 plan↔diff 对不上，此处按「由结构保证」划掉）
- `失败态占位卡不进快照`（成功标准 8：`2026-08-03` 那条决策不被推翻）
- 切项目隔离：`A 项目的在飞卡不出现在 B 项目`（成功标准 6）

**改动**：无（纯测试）。若某条红了，说明 T1/T2 的判据写宽了，回头收。

---

## 验收

每个任务提交后派干净上下文子代理按 commit 范围独立评审（只给 spec 与 diff）。
全部完成后跑四道闸门，再按 spec 的 9 条成功标准做真机验收 —— **重点是标准 1**
（真提交一次异步生成 → 刷新 → 卡还在、任务还在）。异步生成要花数千 credit，
若不跑真的，就按前几轮的做法「种 store 态 + 调真实 action + 真刷新」，并**如实记为哪部分是种出来的**。
合并前终审全分支。

---

## 实跑记录与评审采纳（2026-08-07）

### 四道闸门（分支 HEAD 实跑）

```
pnpm exec tsc --noEmit → 无输出                                    退出码=0
pnpm test              → Test Files 252 passed / Tests 2924 passed  退出码=0
pnpm lint              → ✖ 9 problems (0 errors, 9 warnings)
pnpm build             → ✓ Compiled successfully
```

⚠️ **lint 基线由 8 涨到 9**，如实记：新增的是 `_removedInflight is assigned a value but never used`
（`actions.ts:486`）。它与既有 4 个同族警告（`_removed` / `_removedAgent` / `_removedVp` / `_removedQueue`）
写法一致 —— `deleteProject` 那套「解构剔除某个 key」的既定风格本就产生这类警告。
选择保持一致而非改成 `delete` 变体，代价是基线 +1，**不静默带过**。

### 独立评审（干净上下文子代理）与采纳

评审判「修完 I1 / I2 / I3 再合并」，无 Critical。三条 Important 逐条核实后**全部成立、全部采纳**：

- **I1（已修）**：`partialize` 白名单那一行是「跨刷新」的唯一落点，却没有任何护栏，
  且少一个键 tsc 不报（返回的是对象字面量）。补了照抄同文件既有先例的持久化测试。
  **变异验证**：删掉该行 → 只有这条新测试变红。
- **I2（已修，但评审的措辞需订正）**：补了走完整 `selectProject`（真经过 `loadCanvas` 整表替换）的组合测试。
  ⚠️ 评审说「把那两行对调、全套测试仍绿」—— **实测不成立，15 条既有用例会红**；
  而我新加的这条**也不在红名单里**。原因是回合 A 的 `alivePlaceholders` 是第二道防线：
  对调后 `restoreGenTasks` 先 commit 了任务，`loadCanvas` 就认得这张卡并保留它 ——
  **顺序在这里其实不承重**。已把测试注释改成如实描述它守的东西（「整表替换之后卡还在」这个结果）。
- **I3（已修）**：`deleteProject` 漏剪 `inflightCardsByProject`，打破「按项目持久化映射在此处成套剪除」
  的既有约定。补了剪除 + 护栏测试，**变异验证**：去掉剪除 → 只有这条变红。

Minor 处理：

- **M9（已修）**：接回时补 `c.status === 'generating'`，把隐式不变式变成结构性的，顺带挡脏 localStorage。
- **M4 / M5 / M6（已修）**：三条测试原本是重言式或从错误起点出发 —— 切项目隔离改成「项目 8 也有
  同 itemId 的任务」才杀得掉误键；失败态那条改成「先真的进过快照，再转失败」；快照整份 Asset 的
  断言挪到走真实路径那条上。
- **M1 / M2 / M3（已修）**：spec 的链路收窄到 agent 路径（用户自发起那条拿得到 item，产生不出
  `pending_` 任务）；plan 划掉一条承诺过但属重言式的测试；订正 `layout.tsx` 读的是 `taluna-config`
  而非 `taluna-v4` —— 我 plan 里那句 ⚠️ 是照抄 CLAUDE.md 的说法未经核实，**CLAUDE.md 那条本身也不准确**
  （属仓库文档债，本轮不改）。
- **M7 / M8 / M10 / M11（记录不做）**：变异覆盖面的补充说明、`pid == null` 分支今天不可达、
  `registerAgentGenTask` 缺 `inflightDeleted` 守卫（既有缺陷，本轮不加剧）、提交粒度未按 T1/T2/T3 分三次评审。

### 终审（第二个干净上下文子代理，看最终状态）

结论「**可以合并**」，无阻塞项。两处采纳：

- **M6（已修）**：终审指出我那条「快照存整份 Asset」的断言其实只比了 `position`，
  **裁剪版照样绿**。变异坐实（把快照改成 `{id,key,label,kind,source,status,position}` → 313 条全绿）。
  已改成在**写入侧**做：用 `submitMsg` 种 messages 让 `registerAgentGenTask` 真算出 provenance 与
  `parentId`，再断言快照里有。**变异复验：裁剪版现在被精确抓到（只有这条红）。**
- **建议 2（已记）**：`groupId` 的陈旧面补进 spec「已知取舍」。

终审还独立复核并**确认了我对上一轮评审 I2 措辞的订正**：它自己按代码推了对调后的执行序
（`selectProject` 同一次 `set` 清空 `assets` 与 `genTasks` → `restoreGenTasks` 面对空表照样接回并 commit
→ `loadCanvas` 的 `alivePlaceholders` 认得该卡并保住），结论一致：**顺序不承重**，
那条组合测试守的是「走完真实入口后画布上有卡、表里有任务」这个结果。

其余（`pid == null` 分支不可达、`commitGenTasks` 全量覆盖的既有竞态、空数组键累积）记录不做。

### 真机验收（2026-08-07，worktree dev :3012 打 pgc dev，项目 1633）

按终审建议走了**零 credit** 的那条路径：种一条 `pending_` 卡 + GenTask 进 store → 经真实
`restoreGenTasks`（内部 `commitGenTasks`）落盘 → **真刷新** → 看是否接得回来。

| 环节 | 结果 |
|---|---|
| 写盘 | `localStorage.taluna-v4` 的 `inflightCardsByProject['1633']` 有该卡，带坐标 (640,720) 与 `provenance` |
| **真刷新后** | 卡**回到画布**、`status: 'generating'`、坐标 (640,720) **原样**、溯源还在 |
| 任务 | `genTasks` 里 `refresh-probe` **还在**（改动前会被当残留剪掉） |
| 收尾 | 验证用的假卡与假任务已清（内存与 localStorage 均为空），画布回到 9 张真实卡 |

**这条是本轮唯一的端到端语义面**（写盘 → 刷新 → 读回 → 接回），此前只有单测分开验过两半。

### 仍未做

- spec 其余 8 条成功标准的真机验收（2/3/4/5/6/7/8）：均由单测 + 变异验证覆盖，**未真机走过**。
  尤其标准 3（接回后轮询推进到 adopt / 超时转失败）要一条真在飞的付费任务。**不当作通过。**
