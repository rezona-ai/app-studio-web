# Rezona Lab 品牌换名与主题色迁移（设计稿）

日期：2026-07-31

## 背景

2026-07-30 的迁库（`docs/superpowers/specs/2026-07-30-repo-migration-rezonalab-design.md`）
只做了「搬仓库 → 换域名 → 换仓库标识」三步，并把两件事明确推到后续单独一轮：

> **品牌文案与主站契约 key 本轮不动**：页面 title `Taluna · Game Agent`、`LoadingScreen` 字标、
> `public/figma/icons/logo.svg`、11 个语言包里的「Taluna」保持；`taluna-config` /
> `taluna-agent-backend` 是与主站的跨应用契约……
> **迁移后待办**：基础设施重命名与品牌换名（含 logo 资产、主站契约 key）各自单独一轮。

基础设施重命名那一轮已在 `docs/deploy/rezonalab-dev-bringup.md` 完成（三环境全部接入 Rezona Lab 栈）。
本轮做剩下的**品牌换名**，并合并处理新设计稿带来的 **logo 与主题色变更**。

新设计稿：Figma `Rezona Lab` 文件 `vtfn5ZttNgStezVfJR6wgB`，frame `6180:107850`。
其变量表给出 `primary/main = #F97316`（橙），取代现行品牌青 `#1FD4CF`。

## 目的

1. 仓库内除 `docs/superpowers/` 历史归档、以及对**仍在线的老 taluna 栈**的事实引用之外，
   「taluna」字样全部清零。
2. 品牌显示名统一为 **Rezona Lab**（UI 字标、页面 title、11 个语言包、注释）。
3. 品牌色由青 `#1FD4CF` 迁到橙 `#F97316`，令牌名从按色相命名的 `--color-teal`
   改为语义命名 `--color-primary`（与 Figma 变量 `primary/main` 同名）。
4. logo 资产换成新设计稿的橙色标记。

## 约束（盘问共识）

- **品牌显示名 = `Rezona Lab`**（含空格）。理由：与域名 `lab.rezona.ai`、namespace
  `rezonalab-game-*` 对齐；且 11 个语言包的 `settingsNote` 本来就是「发布后无法在 X 修改，
  请前往 **Rezona**」的对照句，带 `Lab` 后缀才能与姊妹产品 Rezona 区分开，句子仍成立。
  `LoadingScreen` 字标逐字动画不受空格影响。
- **主站契约 key 硬改**：`taluna-config` → `rezonalab-config`，localStorage key 与
  postMessage `type` 同时改，**不留兼容读**。已知代价：在主站同步发版之前，
  刷新后主题回落默认 dark、主站切语言不再传递到本应用。这是 Nick 明确拍板的取舍
  （对应需要主站侧同步改 key）。
- **`taluna-agent-backend` 不是跨应用契约**：`src/lib/agent-backend.ts` 的注释只说它
  「与主站下发主题 / 语言的 taluna-config **同范式**」，实际是本应用自己写自己读的调试开关
  （`?agent=codex` 落 localStorage，`src/client/useAgentBackend.ts` 独占）。因此直接改名，
  无外部协调成本。`CLAUDE.md:145` 原先把它也算作跨应用契约，属**记载有误**，本轮一并修正。
- **对老 taluna 栈的事实引用一律保留**：`taluna-game-develop` / `tlndev.taluna.ai` /
  `taluna-*-urlmap` /「与 taluna 同集群，靠 namespace 隔离」等，指的是**另一套仍在跑的线上栈**
  的真实资源名（集中在 `docs/deploy/cicd-onboarding.md`、`docs/deploy/rezonalab-dev-bringup.md`、
  `docs/deploy/dev-productionization.md`、`.github/workflows/_deploy.yml` 注释）。改了会让文档失实，
  且 `tests/deploy/setup-lb-contract.test.ts:44` 明确断言 README **不得**出现 `taluna-*-urlmap`
  —— 那条断言守的正是「别把共享 LB 改到老栈上」，动它等于拆护栏。
  唯一例外见「方案」§1 第 4 条：`docs/deploy/request-id-propagation.md` 里的 `taluna-game`
  指的是**本服务自己**的旧名，属失实文本，要改。
- **`docs/superpowers/{specs,plans}/` 历史稿不动**：沿用迁库轮的口径，保留原文不重写历史。
- **中性色不动**：新设计稿的中性面 `#171717 / #262626 / #fcfcfc / #7b7b7b` 与现行深色令牌
  `--color-shell / --color-surface-2 / --color-ink / --color-muted` **逐一比对后已经一致**，
  本轮不碰中性面与阴影，只换品牌色。范围严格限定在「logo + 主题色」。
- **UI 范式不变**：不新增令牌档位、不新增动画类、不改组件种类。品牌色迁移是纯令牌层替换，
  110 处 `--color-teal` + 15 处 `--color-teal-soft` 的引用点只改名不改用法。

## 方案

单一方案，三块彼此独立、可分别验证，按「令牌 → 文案 → 资产」推进。

### 1. 文案与标识换名（taluna → rezonalab / Rezona Lab）

| 目标 | 现值 | 新值 |
|---|---|---|
| 页面 title（`src/app/layout.tsx`） | `Taluna · Game Agent` | `Rezona Lab · Game Agent` |
| `LoadingScreen` 字标 | `"Taluna"` | `"Rezona Lab"` |
| 11 个语言包 `settingsNote` | 「在 Taluna 修改」 | 「在 Rezona Lab 修改」 |
| 主站配置 key + postMessage type | `taluna-config` | `rezonalab-config` |
| agent backend 调试 key | `taluna-agent-backend` | `rezonalab-agent-backend` |
| demo SDK 全局名 | `TalunaPicker` | `RezonaLabPicker` |
| `AGENTS.md` / `CLAUDE.md` 概览标题 | `Taluna Game Agent` | `Rezona Lab Game Agent` |
| `docs/deploy/request-id-propagation.md` 的服务名 | `taluna-game` | `rezonalab-game-web` |
| 注释：`Taluna Studio` / `Taluna logo` / 测试里的 `TALUNA AGENT` | — | 同步改 `Rezona Lab` |

`CLAUDE.md` 另需两处订正：§「部署与 basePath」里 `taluna-config` 的描述改为
`rezonalab-config` 并去掉「不随仓库改名」的说法；同段把 `taluna-agent-backend`
从「跨应用契约」的表述里摘出来（见上文约束）。

### 2. 主题色迁移（青 → 橙，令牌改名）

`globals.css` 令牌层：

```
--color-teal:      #1fd4cf   →   --color-primary:      #f97316
--color-teal-soft: #1fd4cf33 →   --color-primary-soft: #f9731633
--color-on-teal:   #171717   →   --color-on-primary:   #171717   （值不变，橙底配深字对比度更好）
--lib-accent:      #1fd4cf   →   #f97316
--color-code-sel:  #14b8a614 →   #f9731614
```

派生色（青色系硬编码，需按橙重算，保持原有明度关系）：

- `globals.css` 品牌渐变的深端锚点 `#063230`（深青）→ 橙的同位深色。
- `src/components/canvas/nodes/NodeCard.tsx:29` 径向渐变 `#8ff0ed / #4ce0db / #1fd4cf`
  → 橙色三档（高光 / 中间 / 基色）。
- `public/figma/icons/check-circle.svg`、`file-code.svg` 的描边 `#14B8A6` → 橙对位。

引用点：`src/` 下 110 处 `var(--color-teal)` 与 15 处 `var(--color-teal-soft)`（横跨 40 个文件）
做机械改名，用法一律不变。注释里「品牌青」的措辞同步改为「品牌橙」。

**充值弹窗（新稿 6180:109915，2026-07-31 追加）**：三组内发光 `--shadow-topup-{balance,select,timer}`
改取品牌橙沿明度轴的暗/亮版（只改 L，不动色相 25° 与饱和度 95%）——余额卡 L33% `#a44704`、
选中卡 L40% `#c75605`、倒计时 chip L79% `#fcc197`；券横幅底 `--color-promo-banner` 由浅青/深青
改中性灰（浅 `#f1f1f1` / 深 `#262626`，对齐 `alias-color/bg/neutral/page/tertiary`）；
倒计时 chip 底由促销粉改品牌橙实底，**促销粉 `--color-promo` 只留给 SAVE chip**。
余额卡与选中档位卡的描边、各处标签本来就取 `--color-primary`，随令牌自动转橙，无需改动。

**已知观感风险（记录，不在本轮处理）**：资产类型色 `--color-video: #ff8a4c` 与新品牌色
`#f97316` 色相接近，画布上「视频卡片色」与「选中态」可能不易区分。等真机看过再定是否调整。

### 3. logo 资产

`public/figma/icons/logo.svg` 换成新设计稿的橙色标记。该资产在 `figAsset` 注册表里
`tone: 'original'`（保留自身配色，不走 CSS mask 重着色），5 处引用
（`LoadingScreen` / `ChatPanel` / `MobileBlockPage` / `AssetCanvas` / `LoadingScreen.test`）
只要文件替换即可，无需改代码。

> ⛔ **当前阻塞**：Figma Dev Mode MCP 的 Allowed directories 未包含本仓库路径，
> 导出资产报 `Cannot write to this directory`。需 Nick 在 Figma → Dev Mode → MCP 面板
> 加入仓库目录后才能导出。此项独立于 1、2 两块，可最后补。

## 成功标准

- `grep -rniI "taluna" .` 除 `docs/superpowers/` 归档、`docs/deploy/`（老栈事实引用）、
  `.github/workflows/_deploy.yml` 注释、`tests/deploy/*.test.ts` 断言之外零命中。
- `grep -rn "color-teal\|1fd4cf\|14b8a6" src public` 零命中。
- 品牌色令牌值为 `#f97316`，`--color-primary` 在 `src/` 的引用数 = 迁移前 `--color-teal` 的 110 处。
- `public/figma/icons/logo.svg` 为新橙色标记。
- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 四项全绿；
  `tests/deploy/*.test.ts` 的部署契约断言不受影响。
- 真机（`pnpm dev`）深浅两主题各看一遍：字标显示 `Rezona Lab`，选中态 / 进度 / 聚焦光环为橙色。

## 本轮不做

- 主站侧同步改 `rezonalab-config`（需 Nick 在主站仓库另行推进，本轮只改本应用侧）。
- `--color-video` 与新品牌色的色相冲突调整（先观察）。
- `docs/superpowers/` 历史稿重写。
- 中性面色 / 阴影 / 圆角等其余设计令牌向新稿对齐。
- **入口页的青色字面值**（不由 `--color-primary` 驱动，需要新设计稿才能改）：
  `globals.css` 的 `.prompt-box` 输入框**橙青双色**流光边框（`rgb(2,233,245)` / `rgb(61,208,192)` /
  `rgb(255,138,61)` …）、基础外发光 `rgba(12,136,122)`，以及 `.game-modal-panel`（Popular games 弹窗）
  辉光 `rgba(31,212,207)`。这是设计稿 357:712 的一个**双色**流光效果，不是单一品牌色的柔光态；
  品牌色转橙后整条渐变要重新配色，属设计决定。

  > 排查提示：它在源码里写的是 **`rgba()` 十进制**形式，构建时才被压成 `#1fd4cf66` 这类 hex。
  > 只按 hex `grep` 会漏掉——本轮就是先漏后从构建产物 `.next/static/chunks/*.css` 里反查出来的。

  > 充值弹窗那组原本也在此列，2026-07-31 拿到新稿 6180:109915 后已迁完（见「方案」§2 附注）。
