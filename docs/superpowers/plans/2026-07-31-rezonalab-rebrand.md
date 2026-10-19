# Rezona Lab 品牌换名与主题色迁移（实现计划）

日期：2026-07-31
设计稿：`docs/superpowers/specs/2026-07-31-rezonalab-rebrand-design.md`

分支：`worktree-feat+rezonalab-rebrand`（worktree `.claude/worktrees/feat+rezonalab-rebrand`，基于 dev tip）

## 任务拆分

每个任务独立可验证、独立提交。任务 1–3 无相互依赖，任务 4 依赖 Figma 白名单解除。

---

### 任务 1：品牌色令牌迁移（青 → 橙 + 令牌改名）

**涉及文件**

- `src/app/globals.css`：令牌定义 + 品牌渐变深端锚点
- `src/components/canvas/nodes/NodeCard.tsx`：径向渐变三档色
- `public/figma/icons/check-circle.svg`：`tone="original"` 下**可见**的对勾描边
- `public/figma/icons/file-code.svg`：描边（走 mask 重着色，实为死值，一并清掉以便 grep 归零）
- `src/` 下 40 个文件里 110 处 `var(--color-teal)` + 15 处 `var(--color-teal-soft)` 的机械改名

**改动明细**

```
--color-teal      #1fd4cf    →  --color-primary       #f97316
--color-teal-soft #1fd4cf33  →  --color-primary-soft  #f9731633
--color-on-teal   #171717    →  --color-on-primary    #171717   （值不变）
--lib-accent      #1fd4cf    →                        #f97316
--color-code-sel  #14b8a614  →                        #f9731614
```

派生色按「保持原 HSL 的明度 / 饱和度关系，只换色相到 25°」重算：

| 位置 | 原值（青） | 新值（橙） | 推导 |
|---|---|---|---|
| `globals.css` 渐变深端锚点 | `#063230` | `#371801` | HSL(178,78%,11%) → HSL(25,95%,11%) |
| `NodeCard.tsx` 高光 | `#8ff0ed` | `#fcb583` | HSL(177,72%,75%) → HSL(25,95%,75%) |
| `NodeCard.tsx` 中间 | `#4ce0db` | `#fa8633` | HSL(177,70%,59%) → HSL(25,95%,59%) |
| `NodeCard.tsx` 基色 | `#1fd4cf` | `#f97316` | 品牌色本身 |
| 两个 SVG 描边 | `#14B8A6` | `#f97316` | 统一收敛到品牌色 |

注释里「品牌青」措辞同步改「品牌橙」；`ImportProjectModal.tsx:90` 的
`text-[var(--color-teal)]` 一并改名。

**验证**

```bash
grep -rn "color-teal\|1fd4cf\|14b8a6\|063230\|8ff0ed\|4ce0db" src public   # 期望零命中
grep -rc "color-primary" src | awk -F: '{s+=$2} END {print s}'             # 期望 125（110+15）
pnpm exec tsc --noEmit && pnpm lint && pnpm test
```

**提交**：`refactor(ui): 品牌色青换橙,--color-teal 改名 --color-primary`

---

### 任务 2：品牌文案换名（Taluna → Rezona Lab）

**涉及文件**

- `src/app/layout.tsx`：页面 title
- `src/components/ui/LoadingScreen.tsx` + `.test.tsx`：字标常量与断言
- `src/i18n/locales/{zh,zh-TW,en,ja,ko,de,fr,es,pt,ru,vi}.ts`：`settingsNote`（11 个）
- `src/components/chat/MessageItem.test.tsx`：`TALUNA AGENT` 断言字符串
- `src/components/chat/ChatPanel.tsx:259`、`src/components/canvas/AssetCanvas.tsx:87`：注释
- `public/picker-demo/picker-sdk.js` + `game.html`：`TalunaPicker` → `RezonaLabPicker`
- `AGENTS.md`、`CLAUDE.md`：概览标题
- `docs/deploy/request-id-propagation.md`：`taluna-game` → `rezonalab-game-web`（本服务旧名，失实文本）

**验证**

```bash
pnpm exec vitest run src/components/ui/LoadingScreen.test.tsx src/components/chat/MessageItem.test.tsx
pnpm exec tsc --noEmit && pnpm lint
```

**提交**：`refactor(brand): 品牌显示名 Taluna 换成 Rezona Lab`

---

### 任务 3：契约 key 改名（`taluna-config` / `taluna-agent-backend`）

先改测试断言看它以预期原因失败，再改实现转绿（TDD）。

**涉及文件**

- `src/lib/host-config.ts` + `.test.ts`：postMessage `type` 校验
- `src/client/useHostConfig.ts` + `.test.tsx`：注释与用例帧
- `src/components/preview/LanguageMenu.tsx` + `.test.tsx`：`HOST_CONFIG_KEY`
- `src/components/preview/UserInfo.tsx`：注释
- `src/app/layout.tsx`：防白闪内联脚本读的 key
- `src/lib/agent-backend.ts`：`AGENT_BACKEND_KEY`
- `CLAUDE.md`：订正「`taluna-agent-backend` 属跨应用契约」的失实记载，并记下
  「`rezonalab-config` 需主站同步改 key，未同步前主题 / 语言不传递」

**验证**

```bash
pnpm exec vitest run src/lib/host-config.test.ts src/client/useHostConfig.test.tsx src/components/preview/LanguageMenu.test.tsx
grep -rn "taluna" src public   # 期望零命中
```

**提交**：`refactor(brand): 主站配置 key 改 rezonalab-config,agent backend key 同步换名`

---

### 任务 4：logo 资产替换 ✅

> **踩过的坑（记下来省得下次再花半小时）**：Figma Dev Mode MCP 报
> `Cannot write to this directory` 时，**先直接读 Figma 的配置文件确认允许列表里到底有什么**：
> `~/Library/Application Support/Figma/settings.json` → `mcpAllowedDirectoriesByUser`。
> 本次卡了三轮（重连 MCP、重启 Figma 都无效），根因是列表里加成了**隔壁仓库**
> `rezonalab-game-server`（pgc）而不是 `rezonalab-game-web`。
> 判据：如果连 `~/Desktop` 都被拒，那就不是路径写法问题，是这条路径压根没进列表。

新 logo **不是旧字形换色**，而是全新标记：

- 主字形（Figma 图层名 `Exclude`，26.923 × 28）——一个「R」形，自带 `#FF6F03`
  （**注意**：与品牌色 `--color-primary` 的 `#F97316` 不同色，该资产 `tone: 'original'`
  不走 CSS mask 重着色，保留自身配色，属设计如此）。
- 叠加一枚 `LAB` 贴纸徽章：白圆角底 + `#FF6F03` 内核 + 白色 `LAB` 字，整体旋转 -5°，
  带 `0 0.507px 0.507px rgba(0,0,0,0.4)` 投影。几何按设计稿换算进 28×28 视口：
  贴纸外框 13.511×6.204 @(13.0745, 15.747) r1.353；内核 12.665×5.192 @(13.4975, 16.253) r1.015；
  文字 4.058px 居中于 (19.83, 18.849)。

`LAB` 用 `<text>` 而非轮廓路径，字体栈 `Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif`
+ `font-weight:900`。原因：该 SVG 经 `<img>` 加载，外部字体不会注入，只能靠系统字体；
4px 字号下 Inter 与 Helvetica/Arial 的粗体几乎无差。若日后要求逐像素还原，需在 Figma 里
把文字转轮廓后重新导出。

`figAsset` 注册表与 5 处引用均无需改动（同文件名、同 `tone: 'original'`、同 1:1 宽高比）。

**验证**：起 dev server，用 `public/logo-check.html` 临时页在 200 / 48 / 28px 三档
及深浅两底渲染比对（比对后已删除该临时页）。

**提交**：`feat(brand): 换新版 Rezona Lab logo`

---

### 任务 5：全量验证与收尾

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
grep -rniI "taluna" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
```

最后一条的预期残留**仅限**：`docs/superpowers/`（历史归档）、`docs/deploy/`（老栈事实引用）、
`.github/workflows/_deploy.yml` 注释、`tests/deploy/*.test.ts` 断言。逐条核对确属这四类。

真机验证（`pnpm dev`）：深浅两主题下字标显示 `Rezona Lab`，选中态 / 进度条 / 聚焦光环为橙色。

---

## 风险与回滚

- **主站配置断链**：任务 3 落地后，主站同步改 key 之前，刷新页面主题回落默认 dark、
  主站切语言不传递。已与 Nick 确认接受。回滚只需把两个 key 字符串改回。
- **`--color-video` 色相撞车**：`#ff8a4c` 与新品牌色 `#f97316` 接近，真机看过再决定是否调整，
  不在本轮。
