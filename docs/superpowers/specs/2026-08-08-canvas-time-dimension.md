# 给资产接上时间维度：让「最近那批」自己浮出来

> 状态：设计稿 · 2026-08-08
> 分支：`feat/canvas-time-dimension`（P1 第 4 项 / 共四项，其余三项另开回合）
> 来源：2026-08-07 对 179 个未推送提交的全量评审，P1 清单第 4 条
> 前置：P0 四回合、P2 三批全部合并

## 目的

评审给 P1 的定性是「能生成、能追溯、能整理，但**高频创作循环的爽感**是行业平均」，
其中一个具体症状是：**「我刚才生成的那批在哪？」答不上来**。

资产列表现在只能按「创建顺序 / 名称 / 类型」排，而**屏幕上一个时间都不显示**。
用户脑子里的检索线索是「今天下午弄的那几张」，界面却只能给一条无刻度的长清单。

本轮补上时间维度：契约里接住后端已下发的 `created_at`，列表按天分组。

### 一处必须先纠正的判断

交接文档写「补齐后列表可**按时间排序**/分组」。**「排序」那一半其实早就有了**：

`map.ts:106` 是 `seq = it.id`，而 `canvas_item.id` 是 `autoincrement=True` 的自增主键
（`pgc-server/app/infra/db/models/canvas_item.py:43`）—— 它**本身就是创建顺序**，
而列表默认排序正是 `{ by: 'seq', desc: true }`（`store/index.ts:313`）。

所以 `created_at` 真正新增的**不是顺序，是刻度**：

1. 屏幕上第一次出现「什么时候」（列表次行的相对时间）；
2. 按天分组，把「今天那批」从长清单里切出来；
3. 让孤儿判据**有能力**算年龄（本轮不用，见下）。

**不新增第四个排序维度**：「时间」与现有的「创建」（`seq`）语义重叠，两个按钮排出来的结果
几乎一样，只会让人以为它们不同。

### 后端已就位，缺的只是前端契约一行

`pgc-server/app/schemas/canvas.py` 的 `CanvasItemData.created_at: datetime` 已下发，
其字段注释写明就是为这件事加的：

> 建卡时间（UTC，tz-aware）。列表视图「按时间排序」的服务端口径——此前前端只能退化成
> 按自维护的 seq 排，而 `reference.provenance.at` 只覆盖前端新生成的那批。

而前端 `src/lib/pgc/types.ts` 的 `CanvasItemData` **没有声明它**（该文件里 `created_at`
出现在 `ProjectData:21` 与 `VersionData:111`，都不是 canvas item）。这是契约层缺一行，不是实现偷懒。

## 约束

1. **不改既有 UI 种类**：分组头用该抽屉自己的分区标签同款字号（`text-[11px]`/`tracking-[-0.11px]`，
   全仓通用档），不新建组件、不加 keyframes、不引入新色值（CLAUDE.md「UI/UX 范式」）。
2. **不引入日期库**：用平台内置的 `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat`，
   跟随 i18n 当前语言。仓内目前零日期依赖，不为这一项开口子。
3. **纯逻辑下沉**：「时间戳 → 分桶」「时间戳 → 相对文案参数」是纯函数，放 `lib/` 并单测；
   组件只消费（CLAUDE.md 开发范式）。
4. **分组头只在按创建顺序排时出现**：按名称 / 类型排时插入日期头没有意义。
5. **不臆测后端字段**：只取文档已约定的 `created_at`，缺失（理论上不该有）时按「无时间」处理，
   不拿 `provenance.at` 顶替 —— 那只覆盖前端新生成的那批，口径不同（反模式清单第一条）。

## 方案

### 1. 契约与映射

- `src/lib/pgc/types.ts` 的 `CanvasItemData` 加 `created_at: string;`（后端必填，非 optional）。
- `src/store/types.ts` 的 `Asset` 加 `createdAt?: string;`（**前端侧可选** —— `pending_` 占位卡
  是前端自建的，没有它）。
- `src/lib/pgc/map.ts` 的 `canvasItemToAsset` 补 `createdAt: it.created_at`。
- 清掉已过期的表述。**共 8 处**（终审 tf-branch 又找出 5 处，最初只数到 3）：
  `agent-provenance.ts:51`、`actions.ts:1369`、`map.test.ts:405`、`store/types.ts:20`、
  `store/types.ts:52`（**就在本轮新增字段的上方三行**）、
  以及四份 spec：`2026-08-06-orphan-gen-task-no-delete.md`、`2026-08-04-canvas-list-view.md`、
  `2026-08-03-canvas-provenance.md`、`2026-08-06-agent-asset-provenance.md`
  （后三份按同一标准加 ⚠️ 推翻标注，不改写历史）。

> 交接文档说「5 处过期注释」——它只给了**数量**、未枚举。我找齐的 5 处与该数量吻合
> （最初只数到 3 处，漏了后两条）：
> `agent-provenance.ts:51`、`actions.ts:1369`、`map.test.ts:405`、
> `specs/2026-08-06-orphan-gen-task-no-delete.md:142`、
> `specs/2026-08-04-canvas-list-view.md:25`（后者是「明确不做时间列」那条决策，
> 其前提正是被本轮推翻的那个 —— 不只是注释，是一条要标注推翻的决策）。

### 2. 分桶（纯函数，`lib/asset-time.ts`）

```ts
export type TimeBucket = 'inflight' | 'today' | 'yesterday' | 'week' | 'earlier';
export function bucketOf(asset: Asset, now: Date): TimeBucket
```

- **`failed`**（`status === 'error'`）与 **`inflight`**（其余 `status !== 'ready'`）：
  **两个桶、都置顶**，`failed` 在最前。
  > ⚠️ 初版把两者混成一桶，而那个桶的文案是「生成中」。失败卡**每次刷新都回来**
  > （服务端 failed item 不删），于是一张两个月前失败的视频会永久占据列表首行、
  > 头上写「生成中」、行里写「9 周前 · 失败」—— 头与行当面矛盾（终审 tf-rewrites 的 I1，Nick 拍板拆桶）。
  > `failed` 的头文案复用已有的 `canvas.list.statusError`（11 语齐全，零新增翻译）。
  > ⚠️ 初版判据是「`createdAt` 缺失者」，**只覆盖前端自建的 `pending_` 占位卡**。
  > 异步生成不是这样：pgc 发起 video/3D 时**就建行并标 `generating`**
  > （`canvas_gen_service.py` 五处），列表查询也不按 status 过滤
  > （`canvas_repository.py:76-83`），前端随后把占位卡换成那张 `vid-*`/`m3d-` 真实卡继续转圈
  > ⟹ **正在跑的生成会落进「今天」**。失败态一并归此：错误也该在眼前。
  >
  > 连带影响（终审 tf-branch 的 I-1）：服务端在飞卡是**有 seq 的真实卡**，seq 会把它排在
  > 列表**中间** —— 于是原先「走一遍行、桶一变就出头」的渲染法会让「今天」出两个头、
  > 「生成中」也到不了顶。故渲染改为**先分段**（`segmentByBucket`）：
  > **桶间顺序由 `BUCKET_ORDER` 决定**（`desc` 时反转），**桶内保持 `sortAssets` 的顺序**。
- `today` / `yesterday`：按**本地日历日**切分（不是「24 小时内」）——
  用户说的「昨天」是日历概念。
- `week`：本日历周内其余的（不含今天 / 昨天）。
- `earlier`：其余。

分桶只依赖 `createdAt` 与 `now`，不读 store，可表驱动单测（跨月 / 跨年 / 周首日 / DST 边界）。

### 3. 分组渲染

`AssetListDrawer` 用 `segmentByBucket` 把已排序的 `rows` 切成段，段首插一个分组头
（该抽屉自己的分区标签同款字号 `text-[11px]`/`tracking-[-0.11px]`）。**空桶不渲染**。
仅当 `sort.by === 'seq'` 时分组（约束 4）。

⚠️ **桶间顺序由 `BUCKET_ORDER` 决定、桶内保持 `sortAssets`** —— 所以扁平后的渲染顺序
**不再等于** `sortAssets` 的结果（失败 / 在飞组会被整组提到顶）。
`desc: false` 时桶间反转、桶内不反转，两个方向都自洽。

⟹ **一切「按顺序」的消费方都必须用渲染顺序，不能用 `rows`**。目前只有一个：
Shift 区间的 `rangeBetween`（终审 tf-branch 的 I-1′ 就是它按扁平 `rows` 取、
跳过了屏幕上夹在中间那行）。其余消费点按 id 查（`ensureVisible` / `rowEls`），不受影响。

桶序为 `失败 · 生成中 · 今天 · 昨天 · 本周 · 更早`（`BUCKET_ORDER` 是唯一真相，由
`segmentByBucket` 消费）。

a11y：分组头用 **`aria-hidden="true"`**（且刻意不带 `role`），整枝移出 a11y 树。
> ⚠️ 初版写的是 `role="presentation"`。评审 tv-group 指出：ARIA 只允许 `listbox` 拥有
> `option` / `group` 子元素，而 APG 的 grouped listbox 范例里 presentation 头是**包在
> `role="group"` 内**并由其 `aria-labelledby` 指回来的 —— 只留后半截等于**分组信息对 AT 丢失**。
> Nick 拍板：不按 APG 重构（这个 listbox 目前**键盘根本进不去**，在半残结构上做局部重构不划算），
> 改用 `aria-hidden` 把话说全，时间语义由**行内相对时间**承载（它已在每条 option 的可访问名里）。
> 完整的列表 a11y（键盘导航 + 真分组）列为独立条目，见 plan 的「未验到」。

### 4. 相对时间（纯函数 + 组件消费）

`lib/asset-time.ts` 出 `relativeParts(iso, now)`，并由同文件的 `formatRelative(iso, now, lang)`
用 `Intl.RelativeTimeFormat(lang, { numeric: 'auto' })` 格式化
（`numeric:'auto'` 让 -1 天渲染成「昨天」而非「1 天前」）。
**formatter 按语言缓存** —— 实测每行各构造一个在 200 行时是 8.95ms（冷）/ 1.27ms（暖），
共用一个 0.044ms，而这是**每次渲染**都付。

**两段口径**（评审 tv-pure I-3 指出后改）：**不足一小时一律按真实时长**，跨不跨日历日都一样；
超过一小时才让日历日接管。
> ⚠️ 初版只按日历日，于是深夜 23:50 生成、00:10 再看会写「昨天」——
> 只过了 20 分钟，正好打脸本 spec 的立项理由（「我刚才生成的那批在哪」）。
> **已认领的观感**：此时分组头仍是「昨天」（它确实是昨天造的）而行内写「20 分钟前」。
> 两者口径不同是有意的 —— 头回答「哪一天」，行内回答「多久以前」。

落点：列表行次行，接在「类型 · 来源」之后 —— 该行现有内容是常态信息，时间同属常态。
失败态仍单独出声，不被时间挤掉。

### 5. 孤儿判据：重估结论是**维持原样**

`specs/2026-08-06-orphan-gen-task-no-delete.md:142` 把「canvas item 没有 `created_at`，
前端算不出年龄」列为「不给孤儿判据加时间窗」的理由。**这个前提现在不成立了**，故按交接文档要求重估。

**结论：不加时间窗，维持原样。** 理由是那条决策的**另一半**已经把风险消掉了 ——
那一轮同时把「删服务端 item」改成了「就地标失败 + 保留重试入口」。于是：

- 误判的代价从「不可恢复的数据丢失」降成「显示一个可重试的失败态」，量级完全不同；
- 而加时间窗会让**真正卡死**的卡在窗口期内继续转圈，这正是那条决策要防的
  「不留永远转圈的加载卡」。

前提变了、结论不变，但**理由必须换**（原理由已失效）。本轮把该 spec 那一行改写成新理由。

## 成功标准

1. `CanvasItemData` 声明 `created_at`；`canvasItemToAsset` 映射到 `Asset.createdAt`；
   服务端返回的每张卡都带上它（占位卡不带）。
2. `bucketOf` 表驱动单测覆盖：缺 `createdAt` → `inflight`；今天 / 昨天按**日历日**切
   （23:59 与次日 00:01 分属两天，而非「相差 2 分钟算同一天」）；跨月、跨年、本周首日边界。
3. 列表按创建顺序排时出现分组头，顺序为 `失败 · 生成中 · 今天 · 昨天 · 本周 · 更早`；**空桶不渲染**。
4. 切到「名称」或「类型」排序 → 分组头**全部消失**（约束 4）。
5. `desc:false`（最旧在前）下**桶间**顺序反过来，**桶内**仍是 `sortAssets` 的顺序。
5b. Shift 区间按**渲染顺序**取：在飞 / 失败组被提到顶之后，框屏幕上连续的三行必须得到那三条
   （而不是按扁平 `rows` 取、跳过夹在中间的行）。
6. 分组头带 `aria-hidden="true"` 且**不带 `role`**，`li[role="option"]` 的数量恒等于资产数。
6b. 服务端在飞 / 失败卡（有 `createdAt`、`status !== 'ready'`）夹在列表中间时，
   「生成中」仍**整组置顶**，且不把「今天」切成两段（终审 tf-branch 的 I-1）。
7. 列表行次行显示相对时间（en 下形如 `3 hours ago`、zh 下「3小时前」），
   昨天的卡渲染成「昨天 / yesterday」而非「1 天前」（`numeric:'auto'`）；
   但**不足一小时按真实时长** —— 昨天 23:50 的卡在今天 00:10 是「20 分钟前」，不是「昨天」。
8. 占位卡不显示时间（没有 `createdAt`），也不因此报错。
9. 过期表述清理干净（8 处，见方案 1）；孤儿 spec 的那一行换成新理由（结论不变）。
10. **五道**闸门在合并结果上重跑全绿：`pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` /
   **`pnpm test:tz`**（DST 守护，已接进 CI 并由 `tests/ci-tz-contract.test.ts` 钉住） / `pnpm build`。
   ⚠️ 还要在 **Node 22**（CI 与生产镜像的版本）上跑一次 —— 本机 Node 26 对
   「只在 Node 22 上错」的问题是盲的（`getWeekInfo` 那条就是这么漏掉的）。
11. **真机验收**（零 credit）：真实项目里能看到分组头与相对时间，切排序维度分组头消失。

## 明确不做

- **不新增「时间」排序维度**：与 `seq` 语义重叠（见「一处必须先纠正的判断」）。
- **不引入日期库**：只用 `Intl.*`。
- **不做「按会话分组」**：「同一次创作会话」需要 gap 检测（如相邻两卡间隔 > 30 分钟即断开），
  是另一套启发式，且没有需求证据；按日历日是用户脑子里现成的刻度。
- **不改孤儿判据的行为**（只换理由，见方案 5）。
- **不动画布**：时间只进列表与（可选）属性面板，画布卡不加时间角标 —— 卡面已经很挤。
- **不碰 P1 其余三项**（Lightbox 动作条、收藏打标、分组框折叠）。
