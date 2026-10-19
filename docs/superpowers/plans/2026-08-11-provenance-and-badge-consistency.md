# 实现计划：溯源字段、角标身份与两处入口一致性（D 批）

> 设计稿：`docs/superpowers/specs/2026-08-11-provenance-and-badge-consistency.md`
> 分支：`fix/provenance-and-badge-consistency`（worktree 建在 `.orca/worktrees/`，从含 A/B/C 的 dev 切）

## 带进本批的纪律（前三批攒的，不是套话）

前三批一共出现 **6 处假锁 + 1 处「误判为锁不上」+ 2 处我自己引入的回归**。所以：

1. **先提交再变异**；撤变异用反向替换，**禁止 `git checkout <file>`**（A 批为此丢过两次未提交实现）。
2. **每条测试都要变异验证**。判据：改坏被测那一行 → 对应用例必须红。「纯函数绿 + 透传绿」
   **不等于**功能成立（B 批 T4 的两处假锁就是这么来的：stub 掉的正好是接线本身）。
3. **「锁不上」要拿证据说，不能拿成本估算说**（C 批 T2 的教训：我估算错了，评审用 4 行桩锁上了）。
4. 断言别按了又按回原处、别不推时钟、别缺前置条件（A 批三处假绿）。
5. 改守卫时先问：**这个判据排除了什么？** （C 批 T4 差点用 `moved` 当守卫，而它刻意排除占位卡。）
6. 组件层接线可用 `AssetCanvas.dragstop.test.tsx` 那套 props 级夹具，但**只限接线断言**
   （ReactFlow 桩返回 null，DOM 断言在那里恒真）。

## T1 · `source` 字段补齐（成功标准 1、2）

两处 import 的下发体与本地 asset 一并带 `source`；`sourceOf` 的回落逻辑不动（老数据仍要能推导）。
测试：`lib/pgc/map.test.ts` 补「`reference.source` 为 `reference` 时 `sourceOf` 返回 reference」
（若已有则跳过）；`store/actions.*.test.ts` 补两条：导入后本地 asset 的 `source` 正确、
下发 body 的 `reference.source` 正确。**变异**：去掉下发的 `source` → 后者必须红。

## T2 · 列表右键不塌陷多选（成功标准 3）

照抄 `AssetCanvas` 的 `onNodeContextMenu` 判据。
测试：`AssetListDrawer.test.tsx` 两条——多选中右键 → `openContextMenu` 收到整选区且 `setSelection` 未被调用；
单选行右键 → 就地单选（不回归）。**变异**：去掉 `sel.includes(id) && sel.length > 1` → 第一条红。

## T3 · 角标身份迁移（成功标准 4）

`adoptAgentItem` 里把 `agentNewAssetIds` 中的 `placeholderId` 换成真实 `asset.id`。
测试：登记一个 agent 占位卡 id 进 `agentNewAssetIds` → 走 `adoptAgentItem` → 断言数组里是真实 id。
**变异**：去掉迁移 → 红。
⚠️ 注意 `pollGenTasks` 与 `registerAgentGenTask` 两条路都经 `adoptAgentItem`，一处改覆盖两条——
但要**各写一条用例**，别假定「同一函数」就等于两条路都通（B 批 T4 的教训）。

## T4 · `importGeneratedAsset` 补 pid 守卫（成功标准 5）

`await` 之后加 `if (get().currentProjectId !== pid) return;`（与仓库 10+ 处同款）。
测试：mock 的 write 在 resolve 前切项目 → 断言新项目 `assets` 不含该卡。
**变异**：去掉守卫 → 红。（这条 plan 早年写过用例但从未落地，见终审 `rv-agent-lineage`。）

## T5 · 轮询 ready 合并保住 `provenance`（成功标准 6）

`pollGenTasks` 的 ready 合并加 `provenance: a.provenance ?? asset.provenance`（与相邻 `parentId` 同写法）。
测试：本地 asset 有 provenance、服务端回显没有 → 转 ready 后 provenance 仍在。**变异**：去掉 → 红。

## T6 · 设计语言收尾（成功标准 7、8、9）

六处一两行的改动，逐个配断言（能断言的）：
- `.lib-eq-bar` 挪进 `animation:none` 组 → `globals-reduced-motion.test.ts` 断言它**不在** display:none 组
- `GenTaskBadge` 补 `motion-reduce:animate-none` → 断言 class 存在
- 全屏 iframe `onLoad` 补 `contentWindow?.focus()` → `FullscreenPreview` 测试断言 focus 被调用
- `GroupNode` 的 `rounded-[6px]` → `--radius-control`；搜索光标环 14 → 16（纯样式，无断言，靠 diff 复核）
- 分隔条 i18n 五语「高度」→「宽度」→ 断言 `canvas.list.resize` 文案含「宽」/width
- `globals.css` 的 reduce 块写明 `animate-spin` 豁免理由（注释，无断言）

## T7 · 收尾

- 五步全绿（贴完整输出与退出码）；每条护栏逐个变异并记录红/绿。
- 派干净上下文子代理增量评审，**明确要求它找假锁**（前三批各找出 1–3 处）。
- 真机复看：素材库导入看来源、列表多选右键、agent 产物落定后角标、减弱动态下音频徽章、全屏键盘。

## 已知取舍

- **压缩包导入该标 `uploaded` 还是 `reference`**：spec 写「按后端语义定的那一档」——
  动手前查 `types.ts` 的取值域注释与后端契约，拿不准就问 Nick，别猜。
- **老数据不迁移**：`sourceOf` 的回落逻辑保留，历史资产仍按 `parentId` 推导。
