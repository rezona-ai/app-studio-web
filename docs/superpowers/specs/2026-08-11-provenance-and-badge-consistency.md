# 溯源字段、角标身份与两处入口一致性（终审整改 D 批）

> 状态：设计稿 · 2026-08-11
> 分支：`fix/provenance-and-badge-consistency`（终审整改 D 批 / 共四批；A `49be06b2`、B `7e8de464`、C `61eb8693` 已合并）
> 来源：2026-08-10 全量终审的 Important 剩余项 + 设计语言收尾。P0 六条已在 A–C 修完
> ⚠️ 终审报告里的行号出自合并前的 HEAD，A/B/C 三批之后**已漂移**——动手前一律按符号名重新定位

## 目的

P0 修完后剩下的是**四条「系统悄悄给出错答案」+ 一批设计语言欠账**。它们不丢钱不丢卡，
但都在用户看得见的地方说假话，或者把错值固化进服务端。

| # | 用户看到的 | 实际 |
|---|---|---|
| 1 | 素材库 / 压缩包导入的卡，属性面板写「Generated」 | 它是导入的。更糟：拖一下卡，`assetReference` 把这个错值**固化进服务端** |
| 2 | 在列表里 ⌘/Shift 选 5 行 → 右键 | 选区被压成 1 项，批量能力在列表侧完全够不到（画布侧有正确分支） |
| 3 | agent 生成的产物落在离屏，「N 个新资产」角标指路 | 产物落定那一刻角标**自己消失**——正是它要解决的场景 |
| 4 | 切项目后 | 旧项目的 agent 产物可能落进新项目画布（`await` 后无 pid 守卫） |
| 5 | 属性面板的提示词/模型/再生成按钮 | 轮询转 ready 时可能整段消失（合并漏保 `provenance`） |

## 现状核实（终审已逐条对代码，本轮动手前须按符号名复核一遍）

| 事实 | 定位（按符号名） |
|---|---|
| `source: 'reference'` 全仓**零赋值**；`sourceOf` 缺字段回落 `parentId ? 'derived' : 'generated'` | `lib/pgc/map.ts` 的 `sourceOf` |
| 两处 import 只下发 `library_key` / `import_rel_path`，不带 `source` | `store/actions.ts` 的 `importLibraryAsset` / 压缩包导入 |
| 错值会被 `assetReference` 固化进服务端 | `lib/pgc/map.ts` 的 `assetReference` |
| 列表行 `onContextMenu` 无条件 `setSelection([asset.id])`；画布侧有「已在多选内则不塌陷」分支 | `AssetListDrawer.tsx` vs `AssetCanvas.tsx` 的 `onNodeContextMenu` |
| `agentNewAssetIds` 只在三处写：切项目清 / 追加占位卡 id / 点角标清；**无 id 迁移** | `store/actions.ts` + `store/index.ts` 的 `clearAgentNewAssets` |
| `adoptAgentItem` 用真实 id 原位替换，不动 `agentNewAssetIds` | `store/actions.ts` 的 `adoptAgentItem` |
| `importGeneratedAsset` 的 `await pgcApi.writeCanvasItemFromUrl` 之后直接 `set`，无 `currentProjectId` 校验 | `store/actions.ts` 的 `importGeneratedAsset` |
| 轮询 ready 合并保了 position/parentId/refIds/source，**漏 provenance**，而 mapper 恒写该键 | `store/actions.ts` 的 `pollGenTasks` ready 分支 |

## 约束

- **C1 只补前端已知的事实，不臆造后端字段**。`source` 的取值域已在 `types.ts` 声明
  （`generated / derived / uploaded / reference / manual`），本轮只是把该填的填上。
- **C2 列表右键照抄画布那段判据**，不另立标准（`sel.includes(id) && sel.length > 1` → 整选区）。
- **C3 角标身份迁移放在 `adoptAgentItem`**：它是占位卡 → 真实卡的**唯一**收口点，
  轮询与 agent 注册两条路都经它，一处改覆盖两条。
- **C4 设计语言收尾一并做掉**（都是一两行）：`.lib-eq-bar` 从 `display:none` 组挪进
  `animation:none` 组；`GenTaskBadge` 的 `animate-pulse` 补 `motion-reduce:animate-none`；
  全屏 iframe `onLoad` 补 `contentWindow?.focus()`；`GroupNode` 改名输入框 `rounded-[6px]` → `--radius-control`；
  搜索光标环 `borderRadius: 14` → 16；分隔条 i18n 五语「高度」→「宽度」。
- **C5 `animate-spin` 按 Nick 拍板豁免 reduced-motion**——不是漏，在 `globals.css` 的 reduce 块
  写明豁免理由（旋转 spinner 是「还在转」的唯一指示，静止会读作卡死）。

## 成功标准

1. 素材库导入的卡：面板显示「Library」；拖一下卡后服务端 `reference.source` 仍是 `reference`。
2. 压缩包导入的卡：显示「Uploaded」，同样不被固化成 generated。
   （2026-08-11 Nick 拍板选 `uploaded` 而非 `reference`：字节是用户上传进来的，与「素材库引用」分档。）
3. 列表里多选后右键：菜单对整个选区；单选行右键仍就地单选（不回归）。
4. agent 产物落定后角标仍在、点它能跳到那张真实卡。
5. `importGeneratedAsset` 在 `await` 后切项目：不写入（与仓库其余 10+ 处同款守卫）。
6. 轮询转 ready 后属性面板的提示词/模型/再生成按钮仍在。
7. 减弱动态下：素材库播放中的音频徽章**看得见**（三根柱子定格）；`GenTaskBadge` 的点不脉冲。
8. 全屏预览打开后键盘直接可用（不必先点画面）。
9. `globals.css` 的 reduce 块写明 `animate-spin` 的豁免理由。

## 增量评审处置（2026-08-11，干净上下文子代理，范围 `61eb8693..`）

Critical 无。Important 一条已修，Minor 采纳四条、留档两条。

| 档 | 结论 | 处置 |
|---|---|---|
| Important-1 | T4 的 pid 守卫把 `importedByProject` 的写入一起跳过了 —— 卡在服务端已建好，切回项目时重扫历史会二次 POST，画布上两张同素材的卡 | **已修**：去重表按 pid 键，先无条件记，再守卫 `assets`；用例扩断言 |
| Minor-2 | 两处 import 的本地 asset 押在「后端原样回显 `reference.source`」上，漏回显即显示 Generated，且 `preserveFrontendOwned` 没有 source 的本地兜底 | **已修**：本地这份恒带 source（同 `importGeneratedAsset` 的既有做法），两条用例扩断言 |
| Minor-3 | 轮询的 `provenance` 合并与 `map.ts` 的 `preserveFrontendOwned` 口径相反 | **已注**：两处口径差异写进注释（一处按「顶层字段将来上线」设计，一处只有回没回显两态） |
| Minor-4 | plan T6 承诺的 i18n 断言没落地 | **已补**：`i18n.test.ts` 钉住 `canvas.list.resize` 七语不含「高度」 |
| Minor-5 | 新 `describe` 插在既有注释与其所述 `describe` 之间 | **已修**：挪到文件末尾 |
| Minor-6 | `globals-reduced-motion.test.ts` 的正则区分不了 `@media` 内外（媒体块内仅首条规则带 `@media` 文本） | **留档**：该文件既有性质，真实变异仍能抓到；单独立项 |
| Minor-7 | `adoptAgentItem` 用了两次 `set` | **技术性异议**：两分支各有自己的 `assets` 写入，合并要重排分支逻辑，收益仅一次订阅通知；中间无 `await`，不构成竞态 |

另记一条与本批无关的既有欠账：`src/store/actions.test.ts` 存在测试顺序依赖（前序用例给 `api.*` 铺 mock），
单跑 `-t` 过滤会假红，整文件跑一律绿。单独立项清理。

## 终审处置（2026-08-11，干净上下文子代理，范围全分支 `61eb8693..`）

Critical 无、Important 无（终审逐条排除了「`importedByProject` 提前写入会污染新项目 / 破不变式 /
断串行链」与「本地覆盖 `source` 会盖掉正确值」两项质疑）。15 处变异实验，**未发现假锁**；
9 条成功标准全部达成。Minor 五条全部采纳：

| 档 | 结论 | 处置 |
|---|---|---|
| M1 | `preserveFrontendOwned` 没有 `source` 的本地兜底 —— 那道「不押在回显上」的防御活不过一次 `loadCanvas`，注释却自称覆盖了该场景 | **已修**：补 `if (!ref.source && local.source)`，排在 `derived` 规则之前（血缘按 parentId 现推，与回没回显无关，不该被本地旧值挡）；三条用例钉住「漏回显保本地 / 回显了以服务端为准 / derived 优先」 |
| M2 | 测试文件注释仍写「播放指示」，与 CSS 那条已相反 | 已改 |
| M3 | `animate-spin` 豁免注释贴在 `.composer-card` 正上方，归属会被误读 | 已挪到 `display:none` 规则之后、空行隔开 |
| M4 | i18n 护栏只跑 7 套，仓里有 11 套 | **已扩到十一套**并补 de/es/ko/pt 的尺寸词（护栏的意义就是将来补文案时被抓住，抽样等于漏网） |
| M5 | `rf-nodes.ts` 的「与旧 AssetCanvas 内联对象一致」在 14→16 后不再成立 | 已改写为真实理由（对象引用稳定 + 与卡片 16px 圆角对齐） |

终审另记一条无法归因的单测 flake（首次全量跑 1 failed 未截到文件名，随后连跑 7 次含加压跑全绿，
本批新增用例一次未失败）——留档观察，不阻塞。

## 明确不做

- **`aria-modal` 取舍**（A 批 Minor-3）、**Lightbox 视频 ←/→ 归属**、**B 批 m1 孤儿付费出口**：
  三条都是待 Nick 定的产品口径，不在本轮顺手改。
- **`ToolApprovalCard` 的 amber 调色板与裸按钮**、**`ContextMenu` 的 z-40/z-50 与文档阶梯不符**：
  既有欠账、本轮未触碰的文件，单独立项。
- **对齐到分组框**、**辅助线数组按内容比较**：C 批已列为明确不做，沿用。
