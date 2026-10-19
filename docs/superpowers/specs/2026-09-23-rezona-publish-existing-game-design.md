# Rezona 发布：选择已导入游戏发布新版本（设计稿）

- 日期：2026-09-23
- 分支：`feat/rezona-publish-existing-game`
- 前置：`2026-08-12-rezona-publish-direct-design.md`（直发）、`2026-08-13-rezona-publish-modal-figma-align.md`（弹窗按稿重做）
- 后端契约：`rezonalab-game-server` #120 / #121 / #122，文档 `docs/api/rezona.md`、`docs/rezona-contract/frontend-integration.md` §1 / §6 / §7；
  后端设计 `docs/plans/2026-09-21-001-feat-rezona-existing-game-update-design.md`。**Apifox 尚未同步**（Publish To Rezona 停在 2026-07-21 版），以仓库文档为准。

## 1. 目的

发布弹窗现在只能「创建新游戏」。后端新增：

- `GET /api/projects/{pid}/rezona/games` → `{ items: [{ game_id, share_url, version_ids, first_published_at, last_published_at }] }`，
  只含本用户、本项目成功发布过、且在 App 仍存在的游戏，按 `last_published_at` 倒序；空历史 `[]`。**不返回游戏名 / 封面**。
- `POST .../rezona/publish` 请求体新增可选 `game_id`（正 int64）：缺省 = 创建，传入 = 给该游戏发新版本。
- 新错误码 `REZONA_GAME_NOT_FOUND` 404：目标不在本用户本项目成功发布历史里（或已被删）。
- `game_id` 参与幂等指纹：**目标变化即新发布意图，必须换新 `idempotency_key`**。

让用户在弹窗里选择「创建新游戏」或列表中的某个已导入游戏。

## 2. 盘问结论（2026-09-23，Nick 拍板）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 目标选择器形态 / 位置 | 复用 `ui/Select`，放在账号行下方，标签 `PUBLISH TO`。选项：「创建新游戏」+ 每个已导入游戏一项。**列表为空时整行不渲染**（与现状一致） |
| 2 | 有已导入游戏时的默认目标 | **最近发布的游戏**（列表第一项）；列表空 → 创建 |
| 3 | 列表加载中 / 失败 | **列表就绪前 CTA 禁用**。加载中目标行骨架；失败目标行就地「加载失败 · 重试」，CTA 仍禁用 |
| 4 | 发布撞 `REZONA_GAME_NOT_FOUND` | Toast + 回表单 + 重拉列表，**选择器清空**显示「请选择发布目标」，CTA 禁用直到用户明确选一项 |
| 5 | 收尾默认 | ① 表单其余部分（标题 / 简介 / 封面 / 开关）不随目标变化，标题仍预填项目名；② 切换目标换新幂等键；③ 成功页不区分创建 / 更新；④ 埋点 `game_export_submit` 增 `rezona_mode: 'create' \| 'update'`；⑤ 不对「当前版本已在所选游戏 `version_ids` 里」做特殊提示；⑥ 列表状态放弹窗本地，不进 store |

### 2.1 理由留档

- **默认选最近游戏 + 就绪前禁用**是一组：默认是「更新」，若列表未到就放行，会静默退化成「创建」发出重复的公开游戏。
  列表接口本身要去 Rezona 批量核对游戏存在性，它失败时发布大概率也失败，禁用代价小。
- **NOT_FOUND 后清空而非自动回选**：用户原本明确选过某个游戏，任何自动候选（另一个游戏 / 创建）都可能被顺手再点一次就发错，两种误发都不可逆。

## 3. 选项文案

- 创建：`preview.rezona.targetNew`（「创建新游戏」）。
- 已导入游戏：单行 `preview.rezona.targetGame`，插值 `{id, versions, date}` →「游戏 #456 · v1、v2 · 9月21日」。
  - `versions`：`version_ids` 用 i18n 分隔符 `preview.rezona.targetVersionSep`（en `, ` / zh `、`）连接（后端已按自然版本号升序）。
    不用 `Intl.ListFormat`：实测 zh 的 unit 列表直接连写成 `v1v2v3`、de 带 `und`，各语言口径不一。
  - `date`：`last_published_at` 用 `Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' })`。
- **不用 Select 的双行 description**：带 description 的菜单被写死 `w-[300px] h-[340px]`（为模型列表设计），两三项时大片留白。单行 label 走 `min-w-[200px]` 自适应高度。
- 清空态：`preview.rezona.targetPlaceholder`（「请选择发布目标」）。

## 4. 组件改动

### 4.1 `ui/Select` 增 `placeholder`

现状 `value` 不在 options 里会回落 `options[0]`（触发钮显示第一项、菜单给第一项打选中点）——清空态会被误读成「已选第一项」。
新增可选 `placeholder?: string`：**仅当传了 placeholder 且 value 无匹配时**，触发钮显示 placeholder、菜单无选中项。
不传时行为完全不变（其余调用方零影响）。

占位态下**只剩一项也可展开**（平常一项渲染静态标签）：目标失效后重拉到空列表时，选项只剩「创建新游戏」，
不可点就没有入口解除禁用。对应地 `PublishForm` 在 `value === null` 时即使列表为空也渲染目标行。

另增 `fullWidth?: boolean`：触发钮撑满父宽、chevron 贴右，与表单上下输入框对齐。

### 4.2 Esc 优先级

弹窗 `window` 上监听 Esc 关弹窗，Select 展开时也监听 Esc 收菜单——同一次按键会连带关掉整个弹窗。
沿用 `GenerateForm` 范式：`Select.onOpenChange` 回报展开态，弹窗 Esc 处理在菜单展开时跳过。

### 4.3 下拉方向

选择器在弹窗上部，`direction="down"`。弹窗外壳 `overflow-y-auto`，菜单 absolute 落在内容盒内，不会被裁。

## 5. 数据流

```
open modal ──▶ pgcApi.rezona.listGames(pid) ──▶ games / 'loading' | 'ready' | 'error'
                                              └▶ target = defaultTarget(items)   // items[0].game_id ?? 'new'
select change ──▶ target = v; idemKey = new
submit ──▶ publish({ ..., ...(target !== 'new' && { game_id: target }), idempotency_key })
  ├ ok ──▶ published
  └ REZONA_GAME_NOT_FOUND ──▶ Toast; step=form; target=null; refetch list
```

- `target: number | 'new' | null`（null = 须重选）。CTA 可点 ⇔ `versionReady && gamesState === 'ready' && target !== null`。
- **创建请求不带 `game_id` 键**（不发 `null`）——保持旧请求 JSON 形状；后端 `gt=0` 校验下显式 `null` 虽合法，但没必要多一种形态。
- 列表请求用默认 30s 超时档（后端未声明慢端点）。
- 列表请求非 `PgcError`（`pgc()` 已把超时 / 断网归一成 PgcError，剩下的只可能是 bug）：置 error 后照抛，不吞。
- 所有 `await` 后校验 `mountedRef`（沿用本弹窗既有守卫）。

## 6. 纯逻辑（`src/lib/rezona/publish.ts`）

- `type PublishTarget = number | 'new' | null`
- `defaultTarget(items): PublishTarget` —— `items[0]?.game_id ?? 'new'`
- `mapRezonaError` 增 `REZONA_GAME_NOT_FOUND` → `{ messageKey: 'preview.rezona.err.gameNotFound', resetIdempotency: false, resetTarget: true }`；
  `RezonaErrorUX` 增可选 `resetTarget?: true`（仅该码出现，其余码对象形状不变）。
- 目标 ↔ Select 字符串值的互转：`'new'` / `String(game_id)`，`targetFromValue(v)`。

## 7. 类型 / API

- `RezonaPublishRequest` 增 `game_id?: number`。
- 新增 `RezonaGameData { game_id: number; share_url: string; version_ids: string[]; first_published_at: string; last_published_at: string }`、`RezonaGameListData { items: RezonaGameData[] }`。
- `pgcApi.rezona.listGames(pid)`。
- `analytics/events.ts`：`game_export_submit` 增可选 `rezona_mode?: 'create' | 'update'`。

## 8. i18n（11 语言）

`preview.rezona.targetLabel` / `targetNew` / `targetGame` / `targetVersionSep` / `targetPlaceholder` / `targetLoadFailed` / `err.gameNotFound`；重试按钮复用 `common.retry`。

## 9. 成功标准

1. 无发布历史的项目：弹窗与现状一致，请求体无 `game_id`。
2. 有历史：默认选最近游戏，请求体带其 `game_id`；可切到「创建新游戏」，请求体无 `game_id`。
3. 切换目标后幂等键变化；同一目标重试复用同一键。
4. 列表未就绪 / 失败时 CTA 禁用；失败可重试。
5. `REZONA_GAME_NOT_FOUND` → Toast、回表单、重拉列表、选择器清空、CTA 禁用直到重选。
6. 选择器展开时按 Esc 只收菜单不关弹窗。
7. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` / `pnpm build` 全绿。

## 10. 评审处置（2026-09-23，干净上下文子代理，范围 `dev..HEAD`）

无 Critical / Important。Minor 逐条核实后：

| # | 问题 | 处置 |
|---|---|---|
| M1 | 菜单展开时键盘 Tab 到 CTA 提交，表单随 posting 卸载、Select 来不及回报收起，`targetMenuOpen` 残留 true → 之后 Esc 关不掉弹窗 | **已修**：提交时复位展开态；复现用例先红后绿。`GenerateForm` 同范式理论上有同类问题（其表单不在菜单开着时卸载，未实测），未动 |
| M3 | 「重选当前已选游戏复用原键」无测试钉住 | **已补用例**，删掉 `changeTarget` 的同值守卫该用例即红（已做变异验证） |
| M2 | 列表请求无代际保护，StrictMode（仅 dev）双请求可能让后到的失败覆盖先到的成功 | 记录不修：生产无并发入口（重试按钮只在 error 态渲染，NOT_FOUND 重拉期间为 loading）；加代际也是「后发者赢」，dev 下结果相同 |
| M4 | `Select` 的 `inert`（吞 `openRequest`）未随「占位态单项可展开」同步 | 记录不修：无调用方同时用 `placeholder` 与 `openRequest` |
| M5 | 目标未就绪 / 未选导致 CTA 禁用时，脚注（`aria-describedby`）仍是通用文案 | 记录不修：目标行自身已有占位 / 错误提示 |
| M6 | 失败态「重试」按钮手写样式 | 记录不修：跟随本文件上传 / ✕ 按钮的既有写法，颜色全走令牌 |

## 11. 迭代：下拉显示游戏名（2026-09-24）

后端 PR #129（合入 pgc `dev`，上游 go-rezona#551）给列表项加了 `game_name: string | null`：`/lab/games/active` 实时带回 App 侧当前名字，
pgc 不落库，App 内改名能跟上；上游旧版本 / 坏条目 / 空名一律 null，两端部署顺序无关。dev 已上线实测有值。

- 选项文案改为「游戏名 · 已发布版本 · 最近发布日期」（Nick：显示游戏名而非 `Game #xxx`）。App 里可能重名，后两段兜底区分。
- `game_name` 为 null（或纯空白）时名字回落 `preview.rezona.targetGameUnnamed`（「游戏 #456」）。
- i18n：`targetGame` 插值由 `{id}` 改为 `{name}`，新增 `targetGameUnnamed`；`escapeValue:false` 下用户起的名字交给 React 转义，不会被 i18next 双重转义成 `&amp;`。
- 本节同时作废 §3 / §10 里「后端不返回游戏名」的前提。

### 11.1 评审处置（干净上下文子代理，范围 `dev..HEAD`）

无 Critical / Important。

| # | 问题 | 处置 |
|---|---|---|
| M1 | 游戏名本身含后续占位符（如起名 `{{date}}`）时显示错位：i18next 逐个占位用字符串 `replace` 只换首个命中，先填进的名字会被后面的占位吃掉 | 记录不修：只影响该用户自己那一项的**显示**，请求体仍是 `game_id`，无安全面；修法（名字改拼接 / 调整占位顺序）要么固定语序要么改文案结构，代价不值 |
| M2 | 「纯空白回落」无测试 | **已补用例**，删掉 `?.trim()` 该用例即红（已做变异验证） |
| 观察 | 无描述菜单项 `truncate`，超长名字可能截掉用于区分重名的「版本 · 日期」后缀 | 记录：真实数据名字都短；若长名 + 重名常见再考虑给选项加 `title` |

## 12. 不在范围

- 不展示封面（后端不返回）；不做 share_url 外链入口。（游戏名见 §11）
- 不改成功页；不做「版本已发布到该游戏」提示。
- 不同步 Apifox（后端职责）。
