# 从 taluna-game-web 迁入画布线 54 个 merge 组 实现计划

> **For agentic workers:** 本计划逐任务执行，步骤用 `- [ ]` 复选框跟踪。本轮**不派子代理**（Nick 已明确排除），在当前会话内按 `superpowers:executing-plans` 的节奏推进。

**Goal:** 把旧仓 `taluna-game-web` 的 `a52f117e..dev`（384 笔提交 / 54 个 first-parent 条目）迁入本仓 dev，并让本仓 dev 的 first-parent 链上仍是这 54 个回合。

**Architecture:** 在 worktree 分支 `feat/migrate-taluna-canvas` 上，按旧仓 first-parent 时序对 54 个条目依次 `git merge --no-ff`，每组一次冲突解决 + 一次验证 + 一个 merge commit；全部落地后修上线看板解析器、收口品牌与 CI 脚本，最后 **fast-forward** 回 dev。

**Tech Stack:** git（`ort` 三路合并）· pnpm 11 / Node 22 · Vitest（jsdom）· ESLint · TypeScript · Next 16

**Spec:** `docs/superpowers/specs/2026-08-14-migrate-taluna-canvas-line-design.md`

## Global Constraints

以下每条对**每个任务**都生效，不再逐任务重复。

- **迁移源**：本地路径 remote `taluna`（`/Users/nickhopps/Documents/taluna/game-web`），已 `git fetch` 到 `refs/remotes/taluna/dev`。迁移起点 `a52f117e`，终点 `taluna/dev` 的 `b0e4e477`。
- **作业目录**：`/Users/nickhopps/Documents/rezonalab/rezonalab-game-web/.orca/worktrees/migrate-taluna-canvas`，分支 `feat/migrate-taluna-canvas`，起点 `e231a56a`（dev tip），依赖已 `pnpm install` 完毕。
- **顺序不可变**：54 组严格按本计划表格的编号顺序 merge。**不重排、不跳过、不合并两组**——跳过会让后续组的三路合并基准失真。
- **merge subject 唯一格式**（`RULES.md` 第 7 条）：`merge: <分支名> <中文标题>`。格式不对该 feature 永久不上看板。12 笔直提沿用原 subject（它们不是 merge 组，本来就不进看板）。
- **冲突口径**：取两边功能的并集；**本仓已上线行为（订阅 / 额度 / Post to Rezona / Rez1 / GA4）不得回退**。每处冲突解决要写中文注释说明为什么这么合。两边语义真的不能并存、必须舍一时——停下来问 Nick，不自行拍板。
- **每组四道闸门**（缺一不可，见下方「标准单组作业程序」）：未定义令牌闸门、品牌字样闸门、`lint` 0 error、`tsc` + `test` 全绿。
- **`pnpm build` 只在**发生冲突的组、以及最终合并结果上跑，不逐组跑。
- **lint 基线**：`0 errors, 11 warnings`。闸门看的是 **error 数为 0**，warning 数不得比基线增加。
- **不做**：不推远端、不删 worktree 与分支、不动 `deploy/` 与 `.github/workflows/deploy*.yml` 与 `scripts/lb-route-audit/`、不重写 `docs/superpowers/` 里旧仓的历史设计稿。

### 已知的三类"无声破坏"

三路合并**干净合入**不等于正确。本次已实测出三个会静默漏过编译的坑，闸门就是为它们设的：

1. **`--color-teal` 未定义令牌**（最险）。本仓已把旧青令牌全量迁移成品牌橙并删除定义；旧仓 `globals.css` 里 `--color-teal: #1fd4cf` 仍在，迁移区间内有 **23 处新增行**引用 `--color-teal` / `--color-teal-soft`，散落在 13 个文件，其中 11 个**不在**预判的冲突文件清单里 → 会干净合入并引用一个本仓根本没定义的 CSS 变量，UI 静默失色，编译与测试全绿。
   - 映射：`--color-teal` → `--color-primary`；`--color-teal-soft` → `--color-primary-soft`；`--color-on-teal` → `--color-on-primary`（三者在 `src/app/globals.css:39/63/40` 均已定义，已核实）。
2. **旧品牌字样**。整个迁移面只有 1 行新增代码带 `Taluna`（`src/app/full/[pid]/[vid]/page.tsx` 的 metadata title），由第 7 组带入。
3. **`test:tz` 脚本缺失**。第 39 组的 `.github/workflows/ci.yml` 新增 `Test (DST timezone)` 步骤，依赖 `package.json` 的 `test:tz` 脚本；`package.json` 是冲突文件，合并时若丢了这个脚本，这层夏令时守护就形同虚设而 CI 会直接红。

## 标准单组作业程序

**每一组**都跑这套，无一例外。以第 26 组为例：

```bash
cd /Users/nickhopps/Documents/rezonalab/rezonalab-game-web/.orca/worktrees/migrate-taluna-canvas

# 1) 合并（-m 写 RULES 约定的 subject）
git merge --no-ff 3713de89 -m "merge: feat/canvas-groups 画布分组框——圈成一组、拖框带动成员、八向缩放"

# 1b) 若报冲突：逐文件按「取并集、已上线行为不回退」解，然后
#     git add -A && git commit --no-edit      # --no-edit 沿用上面 -m 写好的 subject

# 2) 闸门 A：未定义令牌（必须无输出）
grep -rn -- "color-teal" src && echo "❌ --color-teal 漏入，按映射改成 --color-primary 系"

# 3) 闸门 B：旧品牌字样（必须无输出；docs/ 是历史稿不算）
grep -rIn "Taluna" src tests && echo "❌ 旧品牌字样漏入"

# 4) 闸门 C/D：静态检查与测试
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

闸门 A/B 若有输出，就地修正并 `git commit --amend --no-edit` 并进该组的 merge commit —— **不另起提交**，保持「一组一提交」。

不绿就地修到绿再进下一组，**不攒债**。任一组卡住超过 3 次修不好：停止打补丁，转盘问模式问 Nick（铁律第 2 条）。

---

## Task 1：第 1–5 组（无冲突热身）

**Files:** 由 merge 带入，不手工改文件。

**Interfaces:**
- Consumes: 分支 `feat/migrate-taluna-canvas` 的 HEAD 是本计划所在的 docs 提交（`e231a56a` 之后第 1 条）
- Produces: HEAD 前进 5 个 merge commit，`src/app/full/[pid]/[vid]/page.tsx` 等全屏预览相关文件首次出现

这 5 组不触及任何预判冲突文件，用来验证作业程序本身可跑通。

- [ ] **Step 1: 确认起点干净**

```bash
cd /Users/nickhopps/Documents/rezonalab/rezonalab-game-web/.orca/worktrees/migrate-taluna-canvas
git status --short          # 期望：无输出
git log --oneline -1        # 期望：docs: 从 taluna-game-web 迁入画布线 54 个 merge 组的设计稿与实现计划
```

- [ ] **Step 2: 第 1 组**

```bash
git merge --no-ff 444e61bd -m "fix(toast): 卡片宽度上限改按视口——预览全宽把画布列挤到 0 时不再被压成逐字换行的竖条"
```

- [ ] **Step 3: 第 2 组**

```bash
git merge --no-ff bf85b5cc -m "fix(chat): 打断回复按轮幂等——同一 run 收到两个打断终态帧不再产两条 Stopped 气泡"
```

- [ ] **Step 4: 第 3 组**

```bash
git merge --no-ff 02bd8431 -m "docs: 刷新后用 /sessions.updated_at 补 run 起始时刻的设计稿"
```

- [ ] **Step 5: 第 4 组**

```bash
git merge --no-ff 18c79435 -m "fix(chat): 刷新后用 updated_at 补 run 起始时刻——种子窗口外的长 run 不再丢计时"
```

- [ ] **Step 6: 第 5 组**

```bash
git merge --no-ff 530082b8 -m "fix(server): raise Node requestTimeout to 3600s for slow large uploads (#88)"
```

- [ ] **Step 7: 跑四道闸门**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests    # 两条都期望无输出
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

期望：lint `0 errors`、tsc 无输出、test 全绿（基线 220 文件 / 2312 用例，本任务后会增加）。

- [ ] **Step 8: 记录进度**

```bash
git log --oneline --first-parent e231a56a..HEAD | wc -l   # 期望：6（docs + 5 组）
```

---

## Task 2：第 6 组（四个语言包首撞）

**Files:**
- Modify（冲突预期）：`src/i18n/locales/{ja,ko,zh-TW,zh}.ts`

**Interfaces:**
- Consumes: Task 1 的 HEAD
- Produces: `src/lib/clamp-popover.ts` 的 `clampPopover`（浮层定位纯函数），后续多组的菜单/Tooltip 定位依赖它

本仓在这四个语言包里加过订阅、Post to Rezona、Rez1 的文案；旧仓这组加 mobile skill 的多语言名称与描述。两边都是**往同一个对象里加键**，取并集即可，不存在同键异值。

- [ ] **Step 1: 合并**

```bash
git merge --no-ff e2a65b9b -m "merge: fix/select-clamp-and-mobile-i18n 浮层夹回视口，补 mobile skill 多语言文案"
```

- [ ] **Step 2: 解冲突**

四个语言包逐个处理：保留本仓已有的全部键（订阅 / rezona / rez1 段落一个不能少），把旧仓新增的 mobile skill 键并进来。**判定方法**：解完后对每个文件跑

```bash
git show :2:src/i18n/locales/zh.ts | grep -c "^\s*[a-zA-Z]*:"   # 本仓侧键数
git show :3:src/i18n/locales/zh.ts | grep -c "^\s*[a-zA-Z]*:"   # 旧仓侧键数
```

解出来的键数应 ≥ 两侧各自的键数。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit --no-edit
```

- [ ] **Step 4: 四道闸门**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```

`src/i18n/i18n.test.ts` 里有「各语言包键集合一致」类断言，这一步就是它把并集解错的情况钉死。若报某语言缺键，补齐该键而不是删断言。

- [ ] **Step 5: 冲突组加跑 build**

```bash
pnpm build
```

---

## Task 3：第 7 组（`store/actions.ts` 首撞 + 唯一一处旧品牌字样）

**Files:**
- Create（由 merge 带入）：`src/app/full/[pid]/[vid]/page.tsx`、`src/lib/preview-url.ts`
- Modify（冲突预期）：`src/store/actions.ts`
- Modify（手工）：`src/app/full/[pid]/[vid]/page.tsx` 的 metadata title

**Interfaces:**
- Consumes: Task 2 的 HEAD
- Produces: `/full/{pid}/{vid}` 全屏路由；预览地址解析纯函数（store 与全屏页共用同一份 dev 分流）

`src/store/actions.ts` 是整轮最险的文件——本仓的订阅轮询与旧仓的画布生成任务轮询共用 action 骨架。这是它第一次撞。

- [ ] **Step 1: 合并**

```bash
git merge --no-ff db4ca973 -m "merge: worktree-feat+fullscreen-preview-instant-loading 全屏预览独立路由——点开即见加载态"
```

- [ ] **Step 2: 解 `src/store/actions.ts`**

口径：两边的 action 都保留；`await` 之后的 `if (get().currentProjectId !== pid) return;` 上下文校验**一处都不能丢**（这是本仓的不变式，见 CLAUDE.md「`await` 后必校验上下文」）。解完后自查：

```bash
grep -c "currentProjectId !== pid" src/store/actions.ts
git show :2:src/store/actions.ts | grep -c "currentProjectId !== pid"
git show :3:src/store/actions.ts | grep -c "currentProjectId !== pid"
```

解出来的计数应 ≥ 两侧最大值。

- [ ] **Step 3: 改掉唯一一行旧品牌字样**

`src/app/full/[pid]/[vid]/page.tsx`：

```ts
export const metadata: Metadata = { title: 'Rezona Lab · Preview' };
```

（对齐本仓 `src/app/layout.tsx` 的 title 口径；若 layout 里写的不是 `Rezona Lab`，以 layout 实际值为准。）

- [ ] **Step 4: 提交**

```bash
git add -A && git commit --no-edit
```

- [ ] **Step 5: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests    # Step 3 之后必须无输出
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 4：第 8 组（撤销栈；`NodeCard` / `pgc/client` / `store/types` 三处首撞）

**Files:**
- Modify（冲突预期）：`src/components/canvas/nodes/NodeCard.tsx`、`src/lib/pgc/client.ts`、`src/store/actions.ts`、`src/store/types.ts`、`src/i18n/locales/{ja,ko,zh-TW,zh}.ts`

**Interfaces:**
- Consumes: Task 3 的 HEAD
- Produces: 撤销栈 store 切片与 ⌘Z 入口；`Toast` 新增行内撤销按钮与自定义时长的 props（带 action 时 hover 不暂停）；延迟删除机制（窗口内可撤销，到点才真删）

这组一次撞五类文件，是本轮最重的一次合并。旧仓在这组**删掉了整套「删除中态」机制**——解冲突时注意不要把本仓侧的代码当成"要保留的另一半"而把已删机制又留回来。

- [ ] **Step 1: 合并**

```bash
git merge --no-ff 9bec73ec -m "merge: worktree-feat+canvas-undo 画布撤销栈与延迟删除——⌘Z 回退移动/重命名/整理/删除"
```

- [ ] **Step 2: 解冲突（按文件）**

- `src/store/types.ts`：两边新增的字段都保留；旧仓删除的字段（删除中态相关）**跟随删除**。
- `src/lib/pgc/client.ts`：两边新增的端点方法都保留。
- `src/components/canvas/nodes/NodeCard.tsx`：本仓的额度/订阅相关 UI 与旧仓的删除态改造并存。
- `src/store/actions.ts`：同 Task 3 的口径。
- 四个语言包：同 Task 2 的口径。

- [ ] **Step 3: 提交并跑闸门 + build**

```bash
git add -A && git commit --no-edit
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

- [ ] **Step 4: 确认已删机制没被留回来**

```bash
grep -rn "deleting\|删除中" src/store/types.ts src/components/canvas/nodes/NodeCard.tsx
```

期望：不出现旧仓已删除的「删除中态」字段。若出现，说明并集解过头了，删掉。

---

## Task 5：第 9–12 组

**Files:** 由 merge 带入。第 9 组撞四个语言包，第 10 组撞 `NodeCard.tsx`，第 11、12 组无预判冲突。

**Interfaces:**
- Consumes: Task 4 的 HEAD
- Produces: 画布搜索纯逻辑（命中集空间序排序、游标回环、跳转缩放下限）与 `CanvasSearchBar`；卡片触发带几何纯函数

- [ ] **Step 1: 第 9 组**

```bash
git merge --no-ff 97363b27 -m "merge: feat/canvas-search-jump 搜索栏命中计数与 Enter 逐个跳转"
# 冲突：四个语言包，按 Task 2 口径解 → git add -A && git commit --no-edit
```

- [ ] **Step 2: 第 10 组**

```bash
git merge --no-ff b3161291 -m "merge: worktree-feat+card-drag-and-hover-plus 卡片贴边「+」跟随指针，媒体交互按选中态门控"
# 冲突：NodeCard.tsx → 解后 git add -A && git commit --no-edit
```

- [ ] **Step 3: 第 11 组**

```bash
git merge --no-ff 14d989d9 -m "merge: worktree-fix+reduce-motion-display-none 降低动态下只关动画而非 display:none"
```

- [ ] **Step 4: 第 12 组**

```bash
git merge --no-ff 0a171ca3 -m "fix(canvas): 节点重建带回 RF 写回的尺寸——消掉点选卡片时整画布闪一下"
```

- [ ] **Step 5: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 6：第 13–16 组（`GenerateForm` 与 `package.json` 首撞）

**Files:**
- Modify（冲突预期）：第 13 组 `src/components/canvas/GenerateForm.tsx` + 语言包 + `actions.ts`；第 14 组语言包 + `actions.ts` + `types.ts`；第 15 组语言包 + `types.ts`；第 16 组 `package.json` + 语言包

**Interfaces:**
- Consumes: Task 5 的 HEAD
- Produces: 失败态卡片与重试入口（`retryable` 二选一）；资产详情面板与溯源落库（提示词 / 参数 / 血缘 / 再生成）；资产列表抽屉（五列排序、与画布选中双向联动）；批量引用 / 下载 / 重试与流式 zip

第 16 组的 `package.json` 冲突是新增依赖 `"client-zip": "^2.5.0"`（流式 zip）与本仓已有依赖的并集，**两边的 `dependencies` / `scripts` 条目都要留**。

- [ ] **Step 1: 第 13 组**

```bash
git merge --no-ff 109020d0 -m "merge: feat/canvas-gen-failure-retry 生成失败保留卡片并给可点的重试入口"
```

`GenerateForm.tsx` 冲突口径：本仓的额度预检 / 报价相关逻辑与旧仓的重试预填并存，两条提交路径都要能走通。

- [ ] **Step 2: 第 14 组**

```bash
git merge --no-ff ef5acc29 -m "merge: feat/canvas-provenance 资产详情面板与溯源落库——提示词/参数/血缘/再生成"
```

注意旧仓这组**删掉了死字段 `prompt` 与整套 `retrySpecs`**，跟随删除，别留回来。

- [ ] **Step 3: 第 15 组**

```bash
git merge --no-ff 258b1b26 -m "merge: feat/canvas-list-view 资产列表抽屉——五列排序并与画布选中双向联动"
```

- [ ] **Step 4: 第 16 组**

```bash
git merge --no-ff 9ea17623 -m "merge: feat/canvas-bulk-actions 多选批量引用/下载/重试，下载打成流式 zip"
```

`package.json` 解完后必须重装依赖，否则新依赖不存在：

```bash
pnpm install
```

- [ ] **Step 5: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 7：第 17–22 组（`--color-teal` 首次漏入的高危区）

**Files:**
- Create（由 merge 带入）：`src/components/canvas/AlignGuides.tsx`、`src/components/canvas/NewAssetsBadge.tsx`、`src/components/canvas/GenTaskBadge.tsx` 等
- Modify（手工，闸门 A 驱动）：上述新文件里的 `--color-teal` 引用

**Interfaces:**
- Consumes: Task 6 的 HEAD
- Produces: 拖拽对齐吸附纯几何（六线命中、整组包围盒、视口内候选）与 `applyDragSnap`；坐标回写限流与退避重试；`「生成中 N」` 药丸与任务列表；agent 资产血缘归因纯函数

**第 17 组的「青色辅助线」是 `--color-teal` 第一次漏入的地方**，闸门 A 必须在这一组真正拦下来。

- [ ] **Step 1: 第 17 组**

```bash
git merge --no-ff 53d3dc15 -m "merge: feat/canvas-align-guides 拖拽对齐吸附与辅助线，落点吸到 10px 网格"
```

- [ ] **Step 2: 跑闸门 A，预期这次有输出**

```bash
grep -rn -- "color-teal" src
```

期望：`AlignGuides.tsx` / `AlignGuides.test.tsx` 有命中。逐处按映射改：

| 旧仓令牌 | 本仓令牌 |
|---|---|
| `--color-teal` | `--color-primary` |
| `--color-teal-soft` | `--color-primary-soft` |
| `--color-on-teal` | `--color-on-primary` |

改完 `git add -A && git commit --amend --no-edit` 并进本组 merge commit。再跑一次 `grep -rn -- "color-teal" src`，必须无输出。

- [ ] **Step 3: 第 18 组**

```bash
git merge --no-ff 390c1294 -m "merge: feat/canvas-persist-reliability 坐标回写限流与失败退避重试，新资产角标"
# 冲突：语言包 + actions.ts + types.ts；合完再跑闸门 A（NewAssetsBadge.tsx 会带 teal）
```

- [ ] **Step 4: 第 19 组**

```bash
git merge --no-ff 82016f22 -m "merge: feat/canvas-input-browse 文件拖入画布、常驻新增入口与 lightbox 左右翻页"
```

- [ ] **Step 5: 第 20 组**

```bash
git merge --no-ff 11ca0ecf -m "merge: feat/canvas-keyboard ⌘A 只选视口内可见卡，方向键微调落库并合并撤销"
```

- [ ] **Step 6: 第 21 组**

```bash
git merge --no-ff 2ea8c6ad -m "merge: feat/canvas-task-visibility 「生成中 N」药丸与任务列表，卡片显示已等时长"
# 合完跑闸门 A（GenTaskBadge.tsx 会带 teal）
```

- [ ] **Step 7: 第 22 组**

```bash
git merge --no-ff 1129dc6c -m "merge: feat/agent-asset-lineage agent 生成的资产按归因连血缘并落在源卡右侧"
```

- [ ] **Step 8: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 8：第 23–24 组（构建配置三件套：两仓重复实现的正面撞击）

**Files:**
- Modify（冲突预期）：`.gitignore`、`eslint.config.mjs`、`vitest.config.ts`、`src/lib/pgc/client.ts`、`src/store/actions.ts`

**Interfaces:**
- Consumes: Task 7 的 HEAD
- Produces: `listProjects` 分页续拉全量（项目超 100 个不漏项）

第 23 组是**两仓各自独立做过同一件事**——worktree 落点迁到 `.orca/worktrees`（本仓 `deea3bb8`、旧仓 `19e2a9d9`）。这里**不是取并集**，而是「同一件事的两份实现，留本仓那份、把旧仓多做的部分补进来」。别解成两份排除规则叠加。

- [ ] **Step 1: 第 23 组**

```bash
git merge --no-ff 19e2a9d9 -m "chore: worktree 目录迁到 .orca/worktrees,同步 vitest/eslint/gitignore 排除路径"
```

- [ ] **Step 2: 解三个配置文件**

已核实两侧的实际差异：

- **`.gitignore`**：两侧都已忽略 `.claude/` + `.orca/`，**冲突只在注释措辞上**。留本仓那版注释（`# 本地工作区(worktree 等),勿提交。.orca/ 是当前约定的 worktree 落点,.claude/ 是旧落点`），旧仓那版丢弃。**不要**解成两组重复的 ignore 行。
- **`vitest.config.ts` / `eslint.config.mjs`**：本仓已同时排除 `.claude/worktrees/**` 与 `.orca/worktrees/**`（新旧两个落点都排，因为旧落点仍有存量 worktree）。旧仓这组做的是同一件事。取本仓版本，若旧仓多排了本仓没有的路径再补进来。

解完验证：

```bash
grep -n "worktrees" vitest.config.ts eslint.config.mjs
grep -n "orca\|claude" .gitignore
```

期望：`vitest.config.ts` 与 `eslint.config.mjs` 各自恰好一处 exclude/ignores 列表、其中同时含 `.claude/worktrees/**` 与 `.orca/worktrees/**` 且各出现一次；`.gitignore` 里 `.claude/` 与 `.orca/` 各一行，**无重复行**。

- [ ] **Step 3: 提交并验证排除仍生效**

```bash
git add -A && git commit --no-edit
pnpm test 2>&1 | tail -5
```

期望：测试文件数不因扫进 worktree 而暴涨（对比上一任务的文件数，增量应只来自本组带入的测试）。

- [ ] **Step 4: 第 24 组**

```bash
git merge --no-ff 59248303 -m "fix(pgc): listProjects 分页续拉全量,项目超 100 个不再漏项"
```

- [ ] **Step 5: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 9：第 25–28 组（画布分组框落地）

**Files:**
- Create（由 merge 带入）：`src/components/canvas/nodes/GroupNode.tsx`（`--color-teal` 重灾区，5 处）
- Modify（冲突预期）：`src/lib/pgc/client.ts`、`src/store/actions.ts`、`src/store/types.ts`、语言包、`GenerateForm.tsx`、`NodeCard.tsx`

**Interfaces:**
- Consumes: Task 8 的 HEAD
- Produces: 画布 item 批量更新契约层与分片纯函数（取代逐条 PATCH，坐标回写限流闸门与 `concurrency` 模块随之退役）；分组框的六个 store action；生成估价契约层与三形态归一纯函数 + debounce 300ms 的估价 hook

- [ ] **Step 1: 第 25 组**

```bash
git merge --no-ff c24bb634 -m "merge: feat/canvas-batch-position 坐标回写改走批量端点，退役限流闸门"
```

旧仓这组**删除了 `concurrency` 模块与坐标回写限流闸门**（第 18 组刚引入的），跟随删除。

- [ ] **Step 2: 第 26 组**

```bash
git merge --no-ff 3713de89 -m "merge: feat/canvas-groups 画布分组框——圈成一组、拖框带动成员、八向缩放"
```

- [ ] **Step 3: 闸门 A（`GroupNode.tsx` 有 5 处 teal，`GroupNode.test.tsx` 有 8 处）**

```bash
grep -rn -- "color-teal" src
```

按 Task 7 Step 2 的映射表逐处改，`git commit --amend --no-edit` 并入本组。

- [ ] **Step 4: 第 27 组**

```bash
git merge --no-ff d1070206 -m "merge: feat/canvas-estimate 生成表单显示报价，估价 hook debounce 300ms"
```

`GenerateForm.tsx` 冲突要点：本仓已有额度/订阅相关展示，旧仓在提交按钮左侧加报价。**两者都要在**，且报不出价时整段不渲染（不留空标签）。

- [ ] **Step 5: 第 28 组**

```bash
git merge --no-ff 9013d325 -m "merge: feat/agent-provenance agent 卡溯源落库，再生成改开预填表单并还原引用源"
```

- [ ] **Step 6: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 10：第 29–34 组（生成任务与重试路径护栏）

**Files:** 冲突预期集中在 `src/store/actions.ts`（第 29/30/31/33/34 组）、`src/store/types.ts`（第 33/34 组）、`src/lib/pgc/client.ts`（第 34 组）、`NodeCard.tsx`（第 29 组）、`GenerateForm.tsx` + 语言包（第 31 组）。

**Interfaces:**
- Consumes: Task 9 的 HEAD
- Produces: 占位卡判定全仓收口 + 等待上限对齐后端 30 分钟契约；孤儿任务兜底（不删服务端 item，四类异步生成对称发现）；`nearAt` 落位（取代 `spawnAtForTopLeft`）；在飞占位卡跨刷新持久化；撤销按 token 精确回退

- [ ] **Step 1: 第 29 组**

```bash
git merge --no-ff 44c91ad0 -m "merge: fix/gen-task-deadline-and-placeholder 在飞占位卡不被整表替换抹掉，等待上限对齐后端 30 分钟"
```

- [ ] **Step 2: 第 30 组**

```bash
git merge --no-ff 333da98b -m "merge: fix/orphan-gen-task-no-delete 孤儿任务兜底不再删服务端 item，四类异步生成对称发现"
```

- [ ] **Step 3: 第 31 组**

```bash
git merge --no-ff 39970603 -m "merge: fix/retry-path-guards 重试路径护栏——生成中不给再生成，批量重试排除不可重试的卡"
```

旧仓这组删掉了 `spawnAtForTopLeft`（已无调用方），跟随删除。

- [ ] **Step 4: 第 32 组**

```bash
git merge --no-ff 78cb6570 -m "merge: chore/test-fake-timer-reset 兜住假时钟泄漏与 i18n 竞态，封掉两例偶发红"
```

- [ ] **Step 5: 第 33 组**

```bash
git merge --no-ff ea0054b7 -m "merge: fix/inflight-placeholder-persist 在飞占位卡跨刷新存活，刷新不吞掉已付费的生成"
```

这组会往 `persist` 的白名单加字段。**本仓 `persist` key 是 `rezonalab-v4`**（旧仓是 `taluna-v4`），解冲突时不要把 key 改回去——闸门 B 抓不到（`taluna-v4` 不含大写 `Taluna`），所以这里显式验证：

```bash
grep -rn "rezonalab-v4\|taluna-v4" src/store/index.ts
```

期望：只有 `rezonalab-v4`。

- [ ] **Step 6: 第 34 组**

```bash
git merge --no-ff 49b0a6b8 -m "merge: fix/undo-and-overlay-guards 撤销按 token 精确回退并还原归属，药丸给面板让位"
```

- [ ] **Step 7: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
grep -rn "taluna-v4" src ; echo "---"    # 必须无输出
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 11：第 35 组（订阅 / 额度 UI 正面撞击，本轮最险）

**Files:**
- Modify（冲突预期）：`src/components/preview/UserInfo.tsx`、`src/components/preview/UserInfo.test.tsx`、`src/components/ui/InsufficientCreditsModal.tsx`、`src/components/ui/InsufficientCreditsModal.test.tsx`、`src/components/ui/TopupModal.tsx`、`src/i18n/i18n.test.ts`、语言包、`NodeCard.tsx`、`src/store/actions.ts`

**Interfaces:**
- Consumes: Task 10 的 HEAD
- Produces: 框几何 PATCH 失败时的退组补偿；派生资格共享谓词

这是**唯一一组直撞本仓订阅线核心 UI** 的。旧仓这组把额度数字换成 `spendable` 并把标签从「余额」改成「可用」；本仓的订阅线在同一批组件里加了订阅入口、低余额提示、Post to Rezona。约束很硬：**本仓已上线行为一处都不能退**。

- [ ] **Step 1: 先记录本仓侧的行为基线**

```bash
pnpm exec vitest run src/components/preview/UserInfo.test.tsx src/components/ui/InsufficientCreditsModal.test.tsx 2>&1 | tail -6
git show HEAD:src/components/preview/UserInfo.test.tsx | grep -c "^\s*\(it\|test\)("
git show HEAD:src/components/ui/InsufficientCreditsModal.test.tsx | grep -c "^\s*\(it\|test\)("
```

记下用例数——解完冲突后用例数只能增不能减。

- [ ] **Step 2: 合并**

```bash
git merge --no-ff 3575188a -m "merge: fix/credit-and-visibility-guards 框几何 PATCH 失败补偿退组，额度标签改「可用」"
```

- [ ] **Step 3: 解冲突**

- 三个测试文件：**两侧用例全留**。旧仓改了额度语义（`spendable` / 「可用」），本仓的低余额与订阅用例若断言的是旧标签文案，同步更新为新文案——但**断言的行为不能删**。
- `UserInfo.tsx` / `TopupModal.tsx` / `InsufficientCreditsModal.tsx`：订阅入口、低余额提示、语言下拉三者并存；额度数字改用 `spendable`、标签改「可用」。
- `src/i18n/i18n.test.ts` + 语言包：按 Task 2 口径取并集，注意补 `COPIED` 词条（旧仓这组加的，缺了会弹空白 Toast）。

- [ ] **Step 4: 提交并核对用例数没退**

```bash
git add -A && git commit --no-edit
grep -c "^\s*\(it\|test\)(" src/components/preview/UserInfo.test.tsx
grep -c "^\s*\(it\|test\)(" src/components/ui/InsufficientCreditsModal.test.tsx
```

期望：均 ≥ Step 1 记下的数。

- [ ] **Step 5: 订阅线全量回归**

```bash
pnpm exec vitest run src/lib/subscription src/components/ui src/components/preview 2>&1 | tail -6
```

期望：全绿。这是「本仓已上线行为不回退」这条约束的直接验收点。

- [ ] **Step 6: 四道闸门 + build**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## Task 12：第 36–42 组（交接文档 + 列表手感 + 时间维度 + lightbox）

**Files:**
- Modify（冲突预期）：第 39 组 `package.json`（`test:tz` 脚本）+ 语言包 + `actions.ts` + `types.ts`；第 41 组语言包
- Create（由 merge 带入）：`.github/workflows/ci.yml` 的 DST 步骤

**Interfaces:**
- Consumes: Task 11 的 HEAD
- Produces: 列表 Shift 范围多选与选中行滚入视野；画布按时间分段（周首日按语言取、legacy `Intl` weekInfo 访问器兜住 Node 22）；lightbox 底部动作条与 Delete 删除后自动推进

第 36 / 38 / 40 / 42 组是交接文档的更新与最终清理，净效果为零，但**仍按序 merge**以保持组数与历史完整。

- [ ] **Step 1: 第 36 组**

```bash
git merge --no-ff b47829ed -m "docs: 交接文档同步 P2-3 已合并,补本轮四条新教训"
```

- [ ] **Step 2: 第 37 组**

```bash
git merge --no-ff 18c1a815 -m "merge: fix/canvas-list-and-feel 列表 Shift 范围多选与选中行滚入视野，拖放改首张 spawnAt"
```

- [ ] **Step 3: 第 38 组**

```bash
git merge --no-ff 217e0236 -m "docs: 交接文档同步 P2-2 已合并,补三条新教训与 P1 接手须知"
```

- [ ] **Step 4: 第 39 组（`test:tz` 关键组）**

```bash
git merge --no-ff 8e01afe3 -m "merge: feat/canvas-time-dimension 画布按时间分段，周首日按语言取并把 DST 守护接进 CI"
```

`package.json` 解冲突后**必须**确认 `test:tz` 脚本在，其值应为
`"TZ=America/New_York vitest run src/lib/asset-time.dst.test.ts"`：

```bash
node -e "const s=require('./package.json').scripts; if(!s['test:tz']) { console.error('❌ test:tz 丢了，CI 的 DST 步骤会红'); process.exit(1) } console.log('✅', s['test:tz'])"
grep -n "test:tz" .github/workflows/ci.yml
pnpm test:tz 2>&1 | tail -5
```

三条都要通过：脚本在、CI 引用它、本地能跑绿。

- [ ] **Step 5: 第 40 组**

```bash
git merge --no-ff fce05439 -m "docs: 交接文档把 P1-4 标为已合并,并写清留给后三项的四条前提"
```

- [ ] **Step 6: 第 41 组**

```bash
git merge --no-ff 52fad257 -m "merge: feat/lightbox-action-bar lightbox 底部动作条与 Delete 删除后自动推进"
```

- [ ] **Step 7: 第 42 组**

```bash
git merge --no-ff d3e35fb2 -m "docs: 交接工作已完成清理文档"
```

- [ ] **Step 8: 四道闸门 + build + DST**

```bash
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
```

---

## Task 13：第 43–54 组（收尾十二组）

**Files:** 冲突预期：`actions.ts`（第 44/45/46/47/48/49/53 组）、`types.ts`（第 47/49 组）、语言包（第 44/46/47/48/49/50/51 组）、`i18n.test.ts`（第 46 组）、`GenerateForm.tsx`（第 48/54 组）。第 49 组另有 `--color-teal` 风险（「分组框色统一品牌青，删掉五色调色板」）。

**Interfaces:**
- Consumes: Task 12 的 HEAD
- Produces: `retryRouteFor` 重试路由纯函数（四个入口收敛到一份判据）；键盘归属守卫纯函数（`lightboxOpen` 必填）；`applyDragSnap` 回报 `handled`；框可点选 / Tab 聚焦 / Backspace 删除

- [ ] **Step 1: 第 43 组**

```bash
git merge --no-ff 49be06b2 -m "merge: fix/keyboard-layer-guards 键盘归属守卫下沉纯函数，lightbox 与画布互相让位"
```

- [ ] **Step 2: 第 44 组**

```bash
git merge --no-ff 7e8de464 -m "merge: fix/retry-single-routing 重试按路由分派，批量重试不再按 N×n 扣费"
```

- [ ] **Step 3: 第 45 组**

```bash
git merge --no-ff 61eb8693 -m "merge: fix/drag-commit-guards 松手帧不再承接失效偏移，零位移不入空撤销也不改归属"
```

- [ ] **Step 4: 第 46 组**

```bash
git merge --no-ff 8fb91a0d -m "merge: fix/provenance-and-badge-consistency 轮询转 ready 不冲掉本地溯源，角标 id 随占位卡迁移"
```

- [ ] **Step 5: 第 47 组**

```bash
git merge --no-ff c8d59891 -m "merge: feat/canvas-ux-refinements 卡片移入移出分组给高亮，后台刷画布不抹乐观期临时框"
```

- [ ] **Step 6: 第 48 组**

```bash
git merge --no-ff 55947b78 -m "merge: feat/canvas-ux-refinements-2 生成弹窗积分改闪电+数字，资产列表面板贴左下角"
```

`GenerateForm.tsx` 冲突：这组把尺寸收进 `Button` 的 `size` 契约、报价与提交成组。本仓的 `Button` 若无 `size` 契约，以旧仓引入的为准并保证本仓既有调用点仍编译通过（`tsc` 会抓）。

- [ ] **Step 7: 第 49 组（第二个 teal 高危点）**

```bash
git merge --no-ff 7a2d9319 -m "merge: feat/canvas-group-theming-menu 分组框色统一品牌色，删除与重命名改右键菜单"
grep -rn -- "color-teal" src      # 预期有命中，按映射表改后 git commit --amend --no-edit
```

原提交描述是「统一品牌青」，在本仓语境下就是**统一到品牌橙 `--color-primary`**（CLAUDE.md：强调色恒定品牌橙，旧青令牌已全量迁移删除）。这组同时删掉五色调色板，跟随删除。

- [ ] **Step 8: 第 50 组**

```bash
git merge --no-ff 0d4af6d8 -m "merge: feat/canvas-group-title-and-key-delete 框可点选并支持 Backspace 删除，标题改「框名 · N 张卡」"
```

- [ ] **Step 9: 第 51 组**

```bash
git merge --no-ff 12e35a72 -m "merge: feat/canvas-group-a11y-and-menu-debts 框支持 Tab 聚焦与读屏连读，光标菜单夹进视口并 Esc 关闭"
```

- [ ] **Step 10: 第 52 组**

```bash
git merge --no-ff 5ee2a15d -m "merge: fix/retry-route-content-policy 「修改后重试」改按 category=content_policy 判"
```

- [ ] **Step 11: 第 53 组**

```bash
git merge --no-ff 8fad964c -m "merge: fix/input-rejected-route 同步路径上游拒绝也走「修改后重试」"
```

- [ ] **Step 12: 第 54 组**

```bash
git merge --no-ff b0e4e477 -m "merge: fix/retry-form-replace 失败卡「修改后重试」提交时替换原卡并占回原位"
```

- [ ] **Step 13: 迁移完整性验收**

```bash
git cherry HEAD taluna/dev a52f117e | grep '^+' | wc -l      # 期望：0
git log --oneline --first-parent e231a56a..HEAD | wc -l      # 期望：55（docs + 54 组）
grep -rn -- "color-teal" src ; grep -rIn "Taluna" src tests  # 两条均无输出
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
```

---

## Task 14：修上线看板解析器（本轮唯一的新写代码，走 TDD）

**Files:**
- Modify: `scripts/release-board/lib.ts`（`parseMergeSubject` 返回值加 `titled`；`collectFeatures` 归并逻辑）
- Test: `scripts/release-board/lib.test.ts`

**Interfaces:**
- Consumes: Task 13 的 HEAD（此时旧仓 42 个裸格式 merge 已是可达祖先）
- Produces: `parseMergeSubject(subject: string): { title: string; branch: string; titled: boolean } | null` —— `titled` 仅在裸 `Merge branch '<分支>'` 兜底分支为 `false`。`collectFeatures` 的返回类型 `FeatureMerge` **不变**（不含 `titled`）。

**问题**：`collectFeatures` 同分支保留**最早**那条。迁移后旧仓原始的 `Merge branch 'feat/xxx' into dev` 时间更早，于是看板取到裸格式、标题退化成分支名。
**修法**：日期与 sha 仍取最早（"首次落地时间"的原意保留），**标题单独取有标题的那条**。用显式 `titled` 标志而非 `title === branch` 的重言式判断。

- [ ] **Step 1: 先看现状——确认问题真实存在**

```bash
cd /Users/nickhopps/Documents/rezonalab/rezonalab-game-web/.orca/worktrees/migrate-taluna-canvas
git log --merges --format='%H%x09%cI%x09%s' | grep "feat/canvas-groups"
```

期望：两条——旧仓的 `Merge branch 'feat/canvas-groups' into dev`（早）与本轮的 `merge: feat/canvas-groups 画布分组框……`（晚）。

- [ ] **Step 2: 写失败测试**

在 `scripts/release-board/lib.test.ts` 的 `describe("parseMergeSubject")` 末尾加：

```ts
  it("裸格式标记 titled=false，两种带标题格式标记 titled=true", () => {
    expect(parseMergeSubject("Merge branch 'feat/canvas-groups' into dev")).toEqual({
      title: "feat/canvas-groups",
      branch: "feat/canvas-groups",
      titled: false,
    });
    expect(parseMergeSubject("merge: feat/canvas-groups 画布分组框")).toEqual({
      title: "画布分组框",
      branch: "feat/canvas-groups",
      titled: true,
    });
    expect(parseMergeSubject("merge: 画布分组框 (feat/canvas-groups)")).toEqual({
      title: "画布分组框",
      branch: "feat/canvas-groups",
      titled: true,
    });
  });
```

在 `describe("collectFeatures")` 末尾加：

```ts
  // 从 taluna-game-web 迁入画布线后，同一分支会同时存在旧仓的裸 merge（早）与本仓重写的
  // `merge: <分支> <中文标题>`（晚）。「取最早」是为了拿首次落地时间，不该连标题一起退化成分支名。
  it("同分支既有裸格式又有带标题格式：日期取最早，标题取有标题的那条", () => {
    const rows = collectFeatures([
      "new\t2026-08-14T18:00:00+08:00\tmerge: feat/canvas-groups 画布分组框——圈成一组",
      "old\t2026-08-05T10:00:00+08:00\tMerge branch 'feat/canvas-groups' into dev",
    ]);
    expect(rows).toEqual([
      {
        sha: "old",
        date: "2026-08-05T10:00:00+08:00",
        title: "画布分组框——圈成一组",
        branch: "feat/canvas-groups",
      },
    ]);
  });

  it("同分支全是裸格式时，标题仍回落成分支名", () => {
    const rows = collectFeatures([
      "new\t2026-08-14T18:00:00+08:00\tMerge branch 'feat/only-bare' into main",
      "old\t2026-08-05T10:00:00+08:00\tMerge branch 'feat/only-bare' into dev",
    ]);
    expect(rows).toEqual([
      { sha: "old", date: "2026-08-05T10:00:00+08:00", title: "feat/only-bare", branch: "feat/only-bare" },
    ]);
  });
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm exec vitest run scripts/release-board/lib.test.ts 2>&1 | tail -20
```

期望：新增三条中，`titled` 那条报 `toEqual` 不匹配（实际对象没有 `titled` 字段）；「日期取最早、标题取有标题的」那条报 `title` 是 `"feat/canvas-groups"` 而非中文标题。

- [ ] **Step 4: 改 `parseMergeSubject` 的返回值**

`scripts/release-board/lib.ts`，三个 return 分支各加 `titled`：

```ts
export function parseMergeSubject(
  subject: string,
): { title: string; branch: string; titled: boolean } | null {
  const s = subject.trim();
  const neo = /^merge:\s*([\w.+-]*[/+][\w.+-]+)\s+(.+)$/.exec(s);
  if (neo) return neo[1].startsWith("origin/") ? null : { title: neo[2], branch: neo[1], titled: true };
  const legacy = /^merge:\s*(.+?)\s*\(([\w.+/-]+)\)\s*$/.exec(s);
  if (legacy) return { title: legacy[1], branch: legacy[2], titled: true };
  const bare = /^Merge branch '([^']+)'(?:\s+into\s+(\S+))?$/.exec(s);
  if (bare) {
    const [, branch, into] = bare;
    const looksFeature = /[/+]/.test(branch) && !branch.startsWith("origin/");
    const landed = into === undefined || into === "dev" || into === "main";
    // titled=false：标题是拿分支名顶上的，不是人写的——归并时应让位给同分支带标题的那条
    return looksFeature && landed ? { title: branch, branch, titled: false } : null;
  }
  return null;
}
```

同时把该函数的 JSDoc 里"兜底"那行补一句 `titled=false` 的语义。

- [ ] **Step 5: 改 `collectFeatures` 的归并**

```ts
export function collectFeatures(logLines: Iterable<string>): FeatureMerge[] {
  // ISO 串带时区偏移，不能按字典序比大小
  const at = (iso: string) => Date.parse(iso);
  const byBranch = new Map<string, FeatureMerge & { titled: boolean }>();
  for (const line of logLines) {
    if (!line) continue;
    const [sha, date, subject] = line.split("\t");
    if (!subject) continue;
    const parsed = parseMergeSubject(subject);
    if (!parsed) continue;
    const prev = byBranch.get(parsed.branch);
    if (!prev) {
      byBranch.set(parsed.branch, { sha, date, ...parsed });
      continue;
    }
    // 日期与 sha 取最早：「合入 dev 时间」要的是首次落地时间，不是重建时间。
    const earliest = at(date) < at(prev.date) ? { sha, date } : { sha: prev.sha, date: prev.date };
    // 标题取有标题的那条：从 taluna-game-web 迁入画布线后，同一分支会同时存在旧仓的裸 merge
    // （时间早、标题是拿分支名顶上的）与本仓重写的 `merge: <分支> <中文标题>`（时间晚）。
    // 若跟着日期一起取最早，看板 42 行就全退化成分支名——日期与标题必须分开取。
    const titleSide = prev.titled ? prev : parsed;
    byBranch.set(parsed.branch, {
      ...earliest,
      branch: parsed.branch,
      title: titleSide.title,
      titled: prev.titled || parsed.titled,
    });
  }
  // titled 是归并期的内部标记，不进对外的 FeatureMerge 模型
  return [...byBranch.values()]
    .map(({ titled: _titled, ...feature }) => feature)
    .sort((a, b) => at(b.date) - at(a.date));
}
```

- [ ] **Step 6: 补齐既有断言里的 `titled` 字段**

`scripts/release-board/lib.test.ts` 里 `describe("parseMergeSubject")` 的既有 `toEqual` 断言全部要加 `titled`：带标题的两种格式加 `titled: true`，裸格式（约在第 49 行那条 `it`）加 `titled: false`。`collectFeatures` / `buildBoard` 的断言**不用改**（`FeatureMerge` 没变）。

```bash
pnpm exec vitest run scripts/release-board/lib.test.ts 2>&1 | tail -20
```

期望：全绿。

- [ ] **Step 7: 真数据验收**

```bash
pnpm board 2>&1 | tail -5
grep -c "feat/canvas-groups" release-board.html          # 期望 ≥1
grep -o "画布分组框[^<]*" release-board.html | head -1    # 期望：出现中文标题而非分支名
```

- [ ] **Step 8: 全量验证并提交**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
git add scripts/release-board/lib.ts scripts/release-board/lib.test.ts
git commit -m "$(cat <<'EOF'
fix(release-board): 同分支归并时日期与标题分开取,标题让位给带标题的那条

迁入 taluna 画布线后,同一分支会同时存在旧仓的裸 Merge branch（早）与本仓
重写的 merge: <分支> <中文标题>（晚）。原来「同分支保留最早」把日期和标题
一起取了最早,42 行看板标题全退化成分支名。日期仍取最早（要的是首次落地时间）,
标题改取 titled=true 的那条;用显式 titled 标志而非 title === branch 的重言式判断。

验证：vitest scripts/release-board 全绿;pnpm board 产出的看板里 feat/canvas-groups
显示中文标题。

Claude-Session: https://claude.ai/code/session_01XW33Vf7wJwtqxBmZNgFsGq
EOF
)"
```

---

## Task 15：更新 CLAUDE.md 并回合 dev

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: Task 14 的 HEAD（56 条 first-parent 提交）
- Produces: dev 前进到迁移结果；工作树干净

- [ ] **Step 1: 更新 `CLAUDE.md`**

四处要改（每处都先读代码实况再写，不照抄本计划的措辞）：

1. **「画布与生成」小节**补新机制：分组框（`GroupNode` + 六个 store action，框几何 PATCH 失败要补偿退组）、撤销栈（⌘Z 回退移动/重命名/整理/删除，按 token 精确撤销）、延迟删除（窗口内可撤销，到点才真删）、拖拽对齐吸附与 10px 网格（Alt 临时绕过）、资产列表抽屉、批量操作与流式 zip、坐标回写改走批量端点（`concurrency` 限流模块已退役）、在飞占位卡跨刷新持久化、按时间分段。
2. **「反模式」小节**补：重试入口不得各写一遍判据（已收敛到 `retryRouteFor` 纯函数）；孤儿任务兜底不得删服务端 item。
3. **「常用命令」小节**补 `pnpm test:tz`，并说明它为什么必须在 CI 单独跑（`asset-time.dst.test.ts` 用 `skipIf` 只在固定 TZ 下生效，常规 `pnpm test` 在 UTC 下整组跳过）。
4. **「UI/UX 范式」小节**确认强调色口径仍是「品牌橙 `--color-primary` 恒定」，并补一句：迁入的画布线原本用旧青令牌，已全量映射到 primary 系。
5. **顺手修一处存量陈旧**：第 29 行写「Vitest……排除 `.claude/worktrees/**`」，而 `vitest.config.ts:11` 与 `eslint.config.mjs:11` 实际同时排除 `.claude/worktrees/**` 与 `.orca/worktrees/**`（`.orca` 是当前落点，`.claude` 是仍有存量的旧落点）。改成与代码一致。

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: CLAUDE.md 补齐迁入的画布线机制与 test:tz 守护

迁入 54 组后仓库指南与代码实况脱节：分组框/撤销栈/延迟删除/对齐吸附/列表抽屉/
批量端点坐标回写/时间分段这批机制未记，重试判据已收敛成 retryRouteFor 也未记。
另补 pnpm test:tz —— 它在 CI 里必须单独跑,常规 pnpm test 在 UTC 下整组跳过。

Claude-Session: https://claude.ai/code/session_01XW33Vf7wJwtqxBmZNgFsGq
EOF
)"
```

- [ ] **Step 3: 分支侧最终全量验证**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
git status --short          # 期望：无输出（release-board.html 若被改动，确认是否该提交）
```

- [ ] **Step 4: fast-forward 回 dev**

```bash
cd /Users/nickhopps/Documents/rezonalab/rezonalab-game-web
git merge --ff-only feat/migrate-taluna-canvas
git log --oneline --first-parent e231a56a..dev | wc -l    # 期望：57
```

`--ff-only` 是硬要求：一旦报「not possible to fast-forward」说明 dev 在迁移期间动过，**停下来问 Nick**，不要改用 `--no-ff`（会把 54 个组压回二级历史）。

- [ ] **Step 5: 在合并结果上重跑完整验证**（全局 CLAUDE.md「合并后在合并结果上重跑完整验证」）

```bash
pnpm install
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
```

- [ ] **Step 6: 对照 spec 的 7 条成功标准逐条核验并留输出**

```bash
git log --oneline --first-parent e231a56a..dev | wc -l                  # ① 57
git cherry dev taluna/dev a52f117e | grep -c '^+'                       # ② 0
# ③ 见 Step 5 的完整输出
pnpm exec vitest run scripts/release-board && pnpm board                # ④
pnpm exec vitest run src/lib/subscription src/components/ui             # ⑤
grep -rIn "Taluna" src tests                                            # ⑥ 无输出
git diff --stat e231a56a..dev -- deploy .github/workflows scripts/lb-route-audit  # ⑦ 只应有 ci.yml
```

- [ ] **Step 7: 收尾问 Nick**

删除本地路径 remote `taluna`、清理 worktree `.orca/worktrees/migrate-taluna-canvas`、删除分支 `feat/migrate-taluna-canvas`、是否推 dev —— **这四件都是删除类/外发类操作，先问 Nick 再做**（全局 CLAUDE.md Git 第 4 条）。

---

## 附：54 组速查表

| # | sha | 类型 | 预判冲突 |
|---|---|---|---|
| 1 | `444e61bd` | 直提 | — |
| 2 | `bf85b5cc` | 直提 | — |
| 3 | `02bd8431` | 直提 | — |
| 4 | `18c79435` | 直提 | — |
| 5 | `530082b8` | 直提 | — |
| 6 | `e2a65b9b` | PR#90 | 语言包 ×4 |
| 7 | `db4ca973` | merge | `actions.ts` |
| 8 | `9bec73ec` | merge | `NodeCard` `pgc/client` `actions` `types` 语言包 |
| 9 | `97363b27` | merge | 语言包 ×4 |
| 10 | `b3161291` | merge | `NodeCard` |
| 11 | `14d989d9` | merge | — |
| 12 | `0a171ca3` | 直提 | — |
| 13 | `109020d0` | merge | `GenerateForm` 语言包 `actions` |
| 14 | `ef5acc29` | merge | 语言包 `actions` `types` |
| 15 | `258b1b26` | merge | 语言包 `types` |
| 16 | `9ea17623` | merge | `package.json` 语言包 |
| 17 | `53d3dc15` | merge | ⚠️ teal |
| 18 | `390c1294` | merge | 语言包 `actions` `types` · ⚠️ teal |
| 19 | `82016f22` | merge | 语言包 |
| 20 | `11ca0ecf` | merge | — |
| 21 | `2ea8c6ad` | merge | 语言包 · ⚠️ teal |
| 22 | `1129dc6c` | merge | `actions` |
| 23 | `19e2a9d9` | 直提 | `.gitignore` `eslint.config.mjs` `vitest.config.ts` |
| 24 | `59248303` | 直提 | `pgc/client` `actions` |
| 25 | `c24bb634` | merge | `pgc/client` `actions` |
| 26 | `3713de89` | merge | 语言包 `pgc/client` `actions` `types` · ⚠️ teal ×13 |
| 27 | `d1070206` | merge | `GenerateForm` `NodeCard` 语言包 `pgc/client` |
| 28 | `9013d325` | merge | `actions` `types` |
| 29 | `44c91ad0` | merge | `NodeCard` `actions` |
| 30 | `333da98b` | merge | `actions` |
| 31 | `39970603` | merge | `GenerateForm` 语言包 `actions` |
| 32 | `78cb6570` | merge | — |
| 33 | `ea0054b7` | merge | `actions` `types` · persist key |
| 34 | `49b0a6b8` | merge | `pgc/client` `actions` `types` |
| 35 | `3575188a` | merge | 🔴 订阅/额度 UI 全家 + 语言包 + `actions` |
| 36 | `b47829ed` | 直提 | — |
| 37 | `18c1a815` | merge | — |
| 38 | `217e0236` | 直提 | — |
| 39 | `8e01afe3` | merge | `package.json`(`test:tz`) 语言包 `actions` `types` |
| 40 | `fce05439` | 直提 | — |
| 41 | `52fad257` | merge | 语言包 |
| 42 | `d3e35fb2` | 直提 | — |
| 43 | `49be06b2` | merge | — |
| 44 | `7e8de464` | merge | 语言包 `actions` |
| 45 | `61eb8693` | merge | `actions` |
| 46 | `8fb91a0d` | merge | `i18n.test` 语言包 `actions` |
| 47 | `c8d59891` | merge | 语言包 `actions` `types` |
| 48 | `55947b78` | merge | `GenerateForm` 语言包 `actions` |
| 49 | `7a2d9319` | merge | 语言包 `actions` `types` · ⚠️ teal |
| 50 | `0d4af6d8` | merge | 语言包 |
| 51 | `12e35a72` | merge | 语言包 |
| 52 | `5ee2a15d` | merge | — |
| 53 | `8fad964c` | merge | `actions` |
| 54 | `b0e4e477` | merge | `GenerateForm` |
