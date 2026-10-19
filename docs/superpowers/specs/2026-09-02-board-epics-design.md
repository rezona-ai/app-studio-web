# 上线看板按需求聚合 + 工程内部分支折叠 · 设计稿

日期：2026-09-02 · 状态：盘问结论已获批，进入实现

## 1. 目的

`pnpm board`（`scripts/release-board`）的 feature 身份是**分支名**，一分支一行（契约见
`2026-08-28-board-trailer-identity-design.md`，其 §6 已预留「将来按需求聚合再加字段」的口子）。
当前 173 行里两个问题：

1. **同一需求拆成多行**。画布分组框一族 13 个分支（`feat/canvas-groups`、`feat/group-resize-snap-ui`、
   `fix/group-undo-gaps`…），回放一族 8 个，导出一族 3 个。读看板的人要自己在脑里合并。
2. **工程内部分支混进功能列表**。`docs/*` 3 行、`chore/*` 2 行，它们不是「上线功能」，但其中
   有真改动（`docs/board-trailer-identity` 改了看板脚本，`chore/merge-strategy` 改了 CI），不能从判定
   里抹掉。

## 2. 为什么不能全自动

git 里没有任何信息能说明 `fix/group-undo-gaps` 属于「画布分组框」。给每条提交贴 `Epic:` trailer 也
不行：钩子取不到需求名，且存量 173 个分支都没有，回填等于重写历史。**需求归属只能由人给一次
映射**，看板消费这份映射。

## 3. 决策（盘问结论，2026-09-02）

| # | 题 | 结论 | 理由 |
|---|---|---|---|
| 1 | `docs/*` / `chore/*` 的去向 | **折叠成表尾「工程内部」分组**，不隐藏；判定逻辑原样保留 | 它们有真改动，隐藏会让「stage 到底带了什么」少一块；折叠既不打扰功能列表又不丢信息 |
| 2 | 聚合行的上线状态 | **全部子分支命中才 ✓，否则显示 `n/m`** | 看板的用途是「这个需求上线了没」，部分命中就是没上完；「主功能上了、4 个 fix 没上」正是最容易出事故的情形，不能冒充 ✓ |
| 3 | 映射里怎么写子分支 | **精确分支名为主，glob 可选**；未归类分支单独成行 | glob 误伤真实存在：`*replay*` 会吞 `feat/ux-polish-qr-timer-replay`（UX 打磨），`*group*` 会吞 `feat/tidy-groups-as-boxes`（一键整理）。看板是给不看代码的人用的，说的每句都得对 |
| 4 | 聚合行的「合入 dev 时间」 | **取最早子分支**（需求首次落地）；展开后子分支各显各的 | 与既有「同分支多次 merge 取最早」口径一致；取最晚会让一有 fix 这行就往上跳 |

常规判断（未单独盘问）：映射文件放 `scripts/release-board/epics.json`（与脚本同目录、JSON 零依赖）；
展开用原生 `<details>`；一个分支归到两个需求视为**配置错误直接报错退出**；映射到当前窗口内不存在
的分支**只告警不报错**（`--since` 窗口收窄时属正常现象）。

## 4. 方案

### 4.1 映射文件 `scripts/release-board/epics.json`

```jsonc
{
  "internalPrefixes": ["docs/", "chore/"],
  "epics": [
    {
      "title": "画布分组框",
      "branches": ["feat/canvas-groups", "feat/group-resize-snap-ui", "fix/group-undo-gaps"],
      "globs": []            // 可选，minimatch 语义不引入依赖，只支持 `*` 通配
    }
  ]
}
```

- `internalPrefixes`：分支名前缀匹配即归入表尾「工程内部」分组。它本身也是一个聚合行，状态语义同
  §3.2。
- `epics[].branches`：精确名；`epics[].globs`：可选，仅支持 `*`（不引入 minimatch）。精确名与 glob
  两侧命中同一分支不算冲突；**两个不同 epic** 命中同一分支报错。
- 归类优先级：`internalPrefixes` > epic。一个 `docs/` 分支即使写进 epic 也进工程内部——
  避免「文档分支冒充功能」；真要算进需求就别用 `docs/` 前缀。

### 4.2 纯逻辑（`lib.ts`）

新增 `groupRows(rows: BoardRow[], config: EpicsConfig): GroupedBoard`：

- 输出 `groups: EpicRow[]`（含 `title` / `members: BoardRow[]` / `date` = 最早成员 / 
  `status: Record<EnvKey, { hit: number; total: number }>`）与 `singles: BoardRow[]`（未归类）。
- 主表按 `date` 倒序混排聚合行与单行；「工程内部」聚合行固定表尾。
- 校验：分支重复归属 → throw；epic 引用的分支在 `rows` 里不存在 → 收进 `warnings: string[]`
  由 `index.ts` 打到 stderr。
- 只有一个成员的 epic 仍渲染为聚合行（标题用 epic 的），这样映射文件的语义稳定，不随窗口变化翻形。

`renderHtml` 改吃 `GroupedBoard`：聚合行是 `<details>`，summary 一行显示标题 / 成员数 / 日期 / 三列状态
（✓ 或 `n/m`），展开后成员用现有单行格式。环境卡片的「n/m 个 feature」改成按**主表行数**统计
（聚合行算 1，工程内部不计），避免同一需求被数 13 次。

### 4.3 副作用层（`index.ts`）

读 `epics.json`（不存在则等价于空配置，看板行为与今天完全一致），调 `groupRows`，warnings 打 stderr，
终端摘要加一行「N 个需求 · M 个未归类 · K 个工程内部」。

## 5. 成功标准

1. `pnpm board` 生成成功，主表行数 < 173，`docs/*` / `chore/*` 五行全部落在表尾「工程内部」组。
2. 画布分组框、回放、导出三组各聚成一行，展开可见全部成员；stage 列在部分命中时显示 `n/m` 而非 ✓。
3. 删掉 `epics.json` 再跑，行集合与三列状态与改造前一致（回归零）。HTML 字节不要求一致：布局
   从 `<table>` 换成了 grid（`<details>` 放不进表格结构），信息等价即可。
4. 把同一分支写进两个 epic，脚本报错退出并指出分支名。
5. `pnpm test` 全绿，`lib.test.ts` 覆盖：归类 / 冲突报错 / 缺失告警 / 前缀优先 / 日期取最早 / `n/m` 状态 / 单成员 epic / 空配置恒等。

## 6.1 评审处置（2026-09-02，干净上下文子代理，只给 spec 与 diff）

Critical 无。逐条对照代码库核实后：

| 级别 | 结论 | 处置 |
|---|---|---|
| Important | `index.ts` 对 `epics.json` 形状零校验，手改少个键崩成裸 TypeError；JSON 语法错误也不带路径 | **采纳**：加 `loadEpics`，语法 / 形状错误都报带路径的人话并 `exit(1)`，不引 schema 库 |
| Important | 首版映射三条归错：`fix/version-build-polling`、`fix/download-filename-project-version` 改的是**版本**侧（`VersionTimeline` / `lib/download.ts`），不是画布；`fix/select-clamp-and-mobile-i18n` 改的是 `Select` 组件 + locale，不是画布 | **采纳**（自己按 merge 的 `--stat` 复核）：前两条新开「游戏版本时间线与下载」，第三条留未归类。附带复核评审「把握较低」的两条：`feat/agent-image-import-reliability` 改的是画布自动导入，挪到「资产溯源与 agent 导入」；`fix/share-boot-loading-stuck` 改的是分享 / 回放编排（`studio-share` + koubou client），留回放组 |
| Minor | glob 零命中、精确名被 `internalPrefixes` 吃掉都静默 | **采纳**：各推一条 warning |
| Minor | glob 转义测试守不住 `.`；epic 标题转义、`n/m` 绑定 stage 列、internal 不在主表都无直接断言 | **采纳**：直接测 `globToRegExp`，补 4 处断言 |
| Minor | `<summary>` 内放 `<div>` 不合内容模型 | **采纳**：单元格改 `<span>`，grid 不受影响 |
| Minor | 环境卡片「n/m 个 feature」与新口径（按主表行）不符 | **采纳**：改「个功能」 |
| Minor | §5.3「输出逐行一致」在 table→grid 后字节上不成立 | **采纳**：改成「行集合与状态一致」 |
| Minor | `globToRegExp` 转义集多了 `/` | 顺手删掉，无行为差异 |

处置后真跑：173 分支 → 33 需求 · 4 未归类（`fix/list-projects-paging`、`feat/ux-polish-qr-timer-replay`、
`feat/mobile-block-page`、`fix/select-clamp-and-mobile-i18n`）· 5 工程内部，warnings 0。

## 6. 取舍与已知限制

- **映射是人维护的**：新分支合入后以未归类单行出现，靠人看到后补映射。不做 CI 强制，先跑一段。
- **不引入 `Epic:` trailer**，理由见 §2；若将来钩子能可靠取到需求名再考虑，与本方案不冲突。
- **不动身份层**：`parseMergeSubject` / trailer 双源原样保留，聚合只是身份之上的一层视图。
- 首版映射（见 `epics.json`）由 Claude 按分支名与标题起草、Nick 审阅；归错的条目改文件即可，不需要改码。
