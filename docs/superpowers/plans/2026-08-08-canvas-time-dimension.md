# 实现计划：给资产接上时间维度

> 设计稿：`docs/superpowers/specs/2026-08-08-canvas-time-dimension.md`
> 分支：`feat/canvas-time-dimension`（worktree：`.orca/worktrees/feat+canvas-time-dimension`）
> 铁律：每条先写失败测试，看到它红，再写生产代码。

## 任务顺序的理由

T1（契约）是其余全部的前置，且**只有它会让既有测试变红**（`Asset` 加字段、fixture 要跟）。
T2（分桶纯函数）零依赖，可与 T1 并行想但顺序做。
T3（分组渲染）依赖 T1+T2。T4（相对时间）与 T3 同文件，放其后免冲突。
T5（清过期表述）纯文档 / 注释，放最后一次做完，避免中途反复改。

---

## T1 · 契约与映射

**先写的失败测试**
- `src/lib/pgc/map.test.ts`：`canvasItemToAsset 把 created_at 映射到 createdAt`（现状红：字段不存在）
- 同文件：`占位卡路径不产生 createdAt`（回归锚点，`makeAsset` 不带它）

**改动**
- `src/lib/pgc/types.ts` 的 `CanvasItemData` 加 `created_at: string;`（后端必填）
- `src/store/types.ts` 的 `Asset` 加 `createdAt?: string;`（前端占位卡没有 → 可选）
- `src/lib/pgc/map.ts` 的 `canvasItemToAsset` 补一行映射
- ⚠️ `CanvasItemData` 加**必填**字段会让所有构造它的测试 fixture 报类型错 ——
  跑 `pnpm exec tsc --noEmit` 找齐，逐个补上，别用 `as never` 糊过去

**变异验证**：删掉映射那行 → 第一条应变红。

**独立可评审**：是。

---

## T2 · 分桶纯函数

**先写的失败测试**（`src/lib/asset-time.test.ts`，新建）
- `无 createdAt → 'inflight'`
- `今天 / 昨天按**日历日**切`：`23:59` 与次日 `00:01` 分属两天（**不是**「相差 2 分钟算同一天」）
- `本周内其余 → 'week'`；`上周 → 'earlier'`
- 跨月边界（月末 23:59 → 次月 1 日）、跨年边界
- 周首日边界：周一 00:01 的卡，`now` 在同周周三 → `week`；`now` 在下周一 → `earlier`
- 未来时间戳（时钟偏差）→ 归 `today`，不炸也不产生第六个桶

**改动**：新建 `src/lib/asset-time.ts`，导出 `TimeBucket`、`bucketOf(asset, now)`、
`BUCKET_ORDER`（渲染顺序的单一真相）。

**变异验证**：把「日历日」判据改成「24 小时内」→ `23:59 / 00:01` 那条应变红。

**独立可评审**：是。

---

## T3 · 分组渲染

**先写的失败测试**（`src/components/canvas/AssetListDrawer.test.tsx`）
- `按创建顺序排:出现分组头,顺序为 生成中/今天/昨天/本周/更早`（现状红：没有分组头）
- `空桶不渲染`（只有今天与更早时，不出现「昨天」「本周」头）
- `切到名称排序 → 分组头全部消失`（spec 标准 4）
- `desc:false → 分组头顺序反过来`（标准 5）
- `分组头不进 option 序列`：`li[role="option"]` 数量恒等于资产数（标准 6）
- `分组不改变行顺序`（回归：与 `sortAssets` 的结果逐一比对）

**改动**：`AssetListDrawer` 在 `rows` 之后按 `bucketOf` 切段渲染；
分组头复用 `AddAssetMenu` 的 `groupLabel` 同款字号 / 颜色；`role="presentation"`。

**变异验证**：让空桶也渲染 → 第二条应变红；去掉 `sort.by === 'seq'` 判断 → 第三条应变红。

**独立可评审**：是。

---

## T4 · 相对时间

**先写的失败测试**
- `lib/asset-time.test.ts`：`relativeParts` 的单位选择（分钟 / 小时 / 天 / 周），
  以及**昨天返回 `{value:-1, unit:'day'}`**（配 `numeric:'auto'` 才能渲染成「昨天」）
- `AssetListDrawer.test.tsx`：`列表行次行显示相对时间`（en 下含 `ago`）；
  `占位卡不显示时间且不报错`（标准 8）

**改动**：`asset-time.ts` 加 `relativeParts`；`ListRow` 次行接在「类型 · 来源」之后。
格式化用 `new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })`。

⚠️ `Intl.RelativeTimeFormat` 在 jsdom 里可用，但**输出随 ICU 版本**微变；
断言取宽松口径（含 `ago` / 含数字），不钉死整句。

**变异验证**：把 `numeric:'auto'` 去掉 → 「昨天」那条应变红。

**独立可评审**：是。

---

## T5 · 清理过期表述

- `src/lib/agent-provenance.ts:51`、`src/store/actions.ts:1369`：
  「后端 canvas item 无 `created_at`」→ 改成准确说法（后端已有，但 `provenance.at` 记的是
  **导入 / 登记时刻**，两者口径不同，故此处仍用调用方给的 `at`）
- `docs/superpowers/specs/2026-08-06-orphan-gen-task-no-delete.md:142`：
  把「算不出年龄」这条已失效的理由，换成 spec 方案 5 里的新理由（**结论不变，理由变**）

**独立可评审**：是（纯文档 / 注释）。

---

## 验收

1. 四道闸门在**合并结果**上重跑，完整命令 + 输出 + 退出码留档（铁律 3）。
2. 每任务提交后派干净上下文子代理独立评审，**每人一份隔离副本做变异**
   （`cp -R src` + 软链 `node_modules` 到 scratchpad），绝不在共享 worktree 原地改。
   prompt 里必须明写「**用 SendMessage 发给 main**，不要只报 idle」——
   不写的话上一轮六个评审全部只报 idle。
3. 合并前终审全分支，**并单独派一轮审「评审后新写的修复」**（前两轮的严重缺陷都出在那批）。
4. **真机验收**（零 credit）：真实项目里看分组头与相对时间、切排序维度分组头消失。
   ⚠️ 画布虚拟化只渲染视口内节点，取全量要开列表抽屉或先 ⌘1 fit view。
5. 主会话在评审期间**不要往共享 worktree 落提交**；确需落时主动 `SendMessage` 告知，
   并让评审以 `git show <commit>` 为准。

## 实跑记录（2026-08-08）

worktree `.orca/worktrees/feat+canvas-time-dimension`，Node 22 / pnpm 11.5.3。

### 四道闸门（五个任务全部落地后）

| 闸门 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| lint | `pnpm lint` | 0 | `✖ 9 problems (0 errors, 9 warnings)`（既有基线，零新增） |
| 类型 | `pnpm exec tsc --noEmit` | 0 | 无输出 |
| 测试 | `pnpm test` | 0 | `Test Files 257 passed (257)` / `Tests 3081 passed \| 4 skipped (3085)` |
| DST 专测 | `pnpm test:tz` | 0 | `Tests 4 passed \| 1 skipped (5)`（`TZ=America/New_York`） |
| 构建 | `pnpm build` | 0 | — |

测试总数：3023（dev 基线 + T1）→ 3040（T2）→ 3048（T3）→ **3052**（T4/T5）。

### 变异验证

| 任务 | 变异 | 结果 |
|---|---|---|
| T1 | 删掉 `createdAt: it.created_at` 映射 | 1 条红 |
| T2 | 「日历日」改成「24 小时内」 | **4 条红**（跨日/跨月/跨年/相对单位） |
| T3 | 去掉「按创建顺序才分组」判断 | 2 条红 |
| T3 | 分组头改 `role="option"` | 3 条红 |
| T3 | **每行都出头** | ⚠️ **首次全绿逃逸**，补测后 1 条红（见下） |
| T4 | 去掉 `numeric:'auto'` | 1 条红 |
| T4 | 整段删掉时间渲染 | 3 条红 |

### 两处自查抓到的问题

1. **T2：`-Math.max(0, mins)` 在 `mins===0` 时产生 `-0`**，与 `+0` 深比较不等，也会渲染成
   「0 分钟前」的怪值。测试当场报红。
2. **T3：「每行都出头」的变异全绿逃逸**。我那条「空桶不渲染」只看**哪些桶出现**
   （`headers()` 返回的集合），抓不住「同一桶连着出好几个头」。补了一条按**数量**钉的用例
   （头数 === 非空桶数、且无重复）后被精确抓住。这是本仓反复出现的同一类假绿：
   **断言「有什么」而不断言「有几个」**。

### 一处我自己数错、事后更正

盘问阶段我说「交接文档讲 5 处过期注释，实际只有 3 处」—— **是我数错了，交接文档准确**。
漏掉的两处是 `map.test.ts:405` 的注释，以及 `specs/2026-08-04-canvas-list-view.md:25`
的「**明确不做时间列**」—— 后者不是注释，是一条**前提正被本轮推翻的决策**，需要标注而非删改。
已在 spec 里更正该说法。

### 契约改动的连锁

`CanvasItemData.created_at` 声明为**必填**（与后端一致）后，`tsc --noEmit` 精确列出
**32 处** fixture 缺字段。逐个补齐，**未用 `as never` 糊过去** —— 那会把这一层类型保护关掉。
补的时候还撞出一次重复键（我新写的测试本就带了该字段，脚本又补了一遍），也是 tsc 报出来的。

## 独立评审与采纳（2026-08-08）

四个干净上下文子代理，各一份隔离副本做变异，四份报告的 `git status` 都自证共享 worktree 零残留。

| 评审 | 范围 | Critical | Important | Minor |
|---|---|---|---|---|
| tv-contract | `26094871` 契约 | 0 | 2 | 4 |
| tv-pure | `6148630f` 纯函数 | 0 | 3 | 6 |
| tv-group | `48448b0b` 分组 | 0 | 2 | 3 |
| tv-rel | `ed46cdf4` + `a7b0ba7b` | 0 | 1 | 5 |

**全部采纳。** 其中四条值得单独记：

### 一条功能性缺陷（tv-contract I2）

我的「无 `createdAt` 即在飞」判据**只覆盖同步生成的一瞬**。异步不是这样：pgc 发起 video/3D 时
**就建行并标 `generating`**（`canvas_gen_service.py` 五处），列表查询也不按 status 过滤
（`canvas_repository.py:76-83`），前端随后把占位卡换成那张 `vid-*`/`m3d-` 真实卡继续转圈。
⟹ **正在跑的生成会落进「今天」而不是「生成中」**。判据改成 `status !== 'ready'`。

### 我违反了自己的 spec（tv-pure I-1）

spec 白纸黑字把「DST 边界」列进必测项，而实测 `Math.round → floor/ceil` 在**四个时区全部存活**
—— `round` 是这里唯一的 DST 防线却零测试。已加 `pnpm test:tz` 入口（`TZ=America/New_York`），
并**先自证探针日确实是 23/25 小时日**，否则用例会退化成普通「昨天」白测。

### 一条正面打脸立项理由的设计缺陷（tv-pure I-3）

深夜 23:50 生成、00:10 再看，只过了 20 分钟却写「昨天」—— 而这个功能立项就是为了回答
「我刚才生成的那批在哪」。改成「不足一小时按真实时长，跨不跨日历日都一样」。

### 四个测试逃逸，两个说明了同一类毛病

- **「跟 `rows[0]` 比而非上一行」**：我先前补的「按数量钉」用例把重复桶放在**第一个**桶
  ⟹ **补丁与漏洞差了一个位置**。
- **「分组头渲染到行后面」**：我断言的是**两条各自独立**的序列（头序列 / 行序列），
  从没有一条看它们**交织**出的真实 DOM 顺序。改用一条 `outline` 断言一次堵住两个。
- 「搜索时不出头」与「语言写死 `'en'`」：两个行为一点没被钉住。

### Nick 拍板的两条

- **周首日按语言取**：此前写死周一，但 11 语里 **5 语是周日为首**（含默认的 `en`）。
  对这些用户 7 天里 6 天错位，最重的是周日那天。
- **分组头改 `aria-hidden`**：此前 `role="presentation"` 直接挂在 `role="listbox"` 下，
  而 ARIA 规定 listbox 只接受 `option`/`group`；APG 范例里 presentation 头是**包在 `role=group` 内**
  并由其 `aria-labelledby` 指回来的 —— 我只抬了范例的一半，分组信息对 AT 其实是**丢失**。
  不按 APG 重构的理由：这个 listbox **目前键盘根本进不去**，在半残结构上做局部重构不划算。

### 清 Minor 时又抓到的

- **`createdAt` 的 store 层零覆盖**：`actions.test.ts` 里 128 处 canvas item mock 无一带该字段
  ⟹「整表刷新用本地值顶掉服务端」的变异能穿过全部 3023 条测试。补三条端到端断言后精确变红。
- **宽正则断言**：`/ago|hour/i` 让「单位写死 day」「符号翻转成 in 3 hours」都溜过。
  改整串断言后各杀 2 条 —— 顺带暴露我一处假设错误（失败态间距由 `ml-1` 给，
  `textContent` 里本就没空格；渲染没问题，是断言写错了）。

## 本轮我自己的错（记账）

1. **两次「测试全绿但 tsc 红」**：spy 写成箭头函数（`new` 箭头函数是 TS2351）；
   `loadCanvas` 不接参数而我按旧印象传了 `pid`。两次都是 vitest 抓不到、只有类型检查抓得到。
2. **第一次那个还被我漏过去提交了** —— 跑闸门用了 `cmd; echo $?` 而非 `&&`，
   `TSC=1` 看漏。此后改用 `&&` 串联，第二次就在提交前拦住了。
3. **盘问阶段数错一次**：说交接文档的「5 处过期注释」实际只有 3 处，其实是我漏了两处，
   其中一处还不是注释、而是一条前提被本轮推翻的决策。
4. **`-Math.max(0, 0)` 产生 `-0`**（测试当场抓到），且我给这道夹取写的理由有半句是错的
   （ICU 其实把 ±0 归一成同一句，真正的理由只是「深比较不等」）。

## 真机验收记录（2026-08-09，项目 1633，零 credit）

浏览器 Chrome + 真实 PGC 数据。用 `initScript` 改写 `GET /canvas/items` 的响应
（只改 `created_at` / `status`，不写后端）造出五桶齐全、且**在飞卡与失败卡位于列表中间**
的场景 —— 这是逐行出头会把同一桶切成两段的那个场景，也是本轮唯一没被单测覆盖过的真实路径。

| 项 | 结果 |
|---|---|
| 五个桶头 `failed / inflight / today / yesterday / earlier` | ✅ 各一个，`头无重复: true` |
| 在飞卡（第 7 条）、失败卡（第 9 条）从列表中间提到顶部 | ✅ |
| Shift 跨桶取区间＝屏幕上连续三行 | ✅ 选中 `drop-a / probe-auto-cjk / std5-probe`，与屏幕前三行一字不差 |
| 相对时间 `this minute / yesterday / 2 days ago / last week` | ✅ |
| 切名称 / 类型排序 → 分组头消失 | ✅（前一轮已验） |
| 页面错误 | ✅ 零 |

两个途中查清的既有行为，**与本次改动无关**，记下来免得后人误判：

- 注入 `status: "generating"` 但 id 反推不出 task_id 的卡，会被 `restoreGenTasks`
  就地标失败（`actions.ts:195-208` 的孤儿规则）。造真在飞卡必须让 id 带 `vid-` 前缀，
  并把轮询响应也接住，否则超时兜底同样会转失败。
- 当天是周日 + 语言 en（周首日 = 周日）⟹ `startOfWeek` 就是当天，两天前的卡落 `earlier`。
  一开始看着像 bug，实为「按语言取周首日」那条修复正在生效。

## 未验到

按铁律 3，这些是**本轮没有跑出证据**的部分，不算已验：

- **CI 真实环境**：Nick 决定不推分支，`pnpm test:tz` 这个 CI 步骤**从未被真正执行过** ——
  `tests/ci-tz-contract.test.ts` 只断言 `ci.yml` 里有那一步，没断言那一步会通过。
  同理未验：`--frozen-lockfile` 的 lockfile 一致性、ubuntu vs macOS 的平台差异。
  **Node 版本差异这条已关掉**：我与终审各自独立在真 Node 22 上跑过全量与 `test:tz`。
- **真机上的「本周」桶**：验收当天是周日、语言是 en（周首日 = 周日），
  于是 `startOfWeek` 就是当天，两天前的卡直接落 `earlier` —— `week` 桶在真机上是空的。
  它只在单测里验过（`mixed()` 的 C 卡）。这反过来正是「按语言取周首日」那条修复生效的证据。
- **11 语的分组头真机渲染**：只在 en 下看过，其余 10 语靠单测断言键存在，没逐个真机切过。
- **跨午夜的真机行为**：`dayKey` 那条只有单测（fake timer）证据；真机等一次午夜不现实。

## 已知取舍（终审提出，本轮明确不做）

- **失败卡仍永久占列表首行**。拆桶修正的是**标签**（头不再写「生成中」而写「Failed」），
  不是**驻留**：两个月前失败的视频照旧在第一行。若「永久占首行」这一半也要解，
  那是另一个决策（失败桶按 createdAt 沉底、或给失败卡加消隐），需要 Nick 单独拍板。
- **「Failed」在同一屏出现两次**（桶头一次、行内状态标一次）。轻微冗余，不是缺陷；
  是否在有 failed 头时省掉行内那个标记属产品取舍，本轮不动。

