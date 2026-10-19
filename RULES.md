# RULE.md — 本项目最关键的行为规则

## 一、验证纪律（最高优先级）

1. **证据先于断言**：任何"已修复/已对齐/已完成"必须先跑验证命令并看输出。质量信号只信 `pnpm exec tsc --noEmit` 与测试退出码——worktree 里的 IDE `<new-diagnostics>` 大量误报，不作依据。
2. **渲染类 bug 先复现再修**：白屏/不渲染先用 Playwright 复现读真实 console；blank ≠ 渲染崩溃，ErrorBoundary 抓不到异步/model-viewer 错误，dev 错误遮罩会伪装成"不渲染"。
3. **对齐设计稿必须逐项比对**：取 Figma 精确 px + 渲染 mock，列子节点↔实现对照表；实现前 `get_metadata` 展开 ≥3 层子节点，功能性控件不得以"仅视觉对齐"为由静默跳过。
4. **不轻信子 agent 报告**：SDD 中子 agent 可能把 commit 提到错误分支（如 main）；每个任务后用 `git log` 校验 commit 落点。

## 二、Worktree / Git 纪律

5. **worktree 里只用 worktree 路径**：用主仓绝对路径 Edit/Write 会静默写到主仓；改完用 `grep` / `git -C` 校验落点。
6. **特性分支回合用 `--no-ff`**：merge commit 成组标识 feature，合并后删分支。禁止"先合 base 进特性分支再 ff base"（会留反向合并提交）——改用 rebase 或从 base 侧 merge。
7. **merge subject 唯一约定格式：`merge: <分支名> <中文标题>`**（`git merge --no-ff -m "merge: fix/xxx 中文一句话"`）。上线看板（`pnpm board`）靠扫 merge subject 认 feature，**格式不对这个 feature 就永久不上看板**：
   - ❌ `Merge: <中文标题>` / 拿 `feat(x): …` 直接当 merge subject —— **无分支名可提取，事后任何解析器都救不回来**（迁移到 rezonalab 仓后已因此丢 7 条，见 `scripts/release-board/lib.ts`）。
   - ⚠️ 裸 `git merge --no-ff feat/x`（git 默认 subject `Merge branch 'feat/x' into dev`）—— 解析器已兜底，但标题退化成分支名，看板可读性差。
   - 🔴 **dev→main 禁 squash**：压平后 merge 结构全丢、不可逆，看板会瞬间解析不出任何 feature。
8. **ExitWorktree 报"丢弃 N 提交"先验 SHA**：已 ff 合并后属误报，确认 SHA 相等再 `discard_changes:true`。

## 三、代码风格偏好（Nick 的明确要求）

9. **源头分流胜过簿记**：Nick 反感为挡副作用堆去重/边界判断/seenSequences 之类簿记；他说"为什么这么复杂"= 要换成只在正确入口触发的源头分流。
10. **强调色一律品牌橙 `--color-primary`**（#F97316，恒定不随主题翻）：选中 / 进度 / 高亮平铺橙用它，柔光底纹用 `--color-primary-soft`。其上文字分两档——小字号徽章用深字 `--color-on-primary`（#171717，对比度更高），大字号 CTA 按稿用白字 `--color-on-primary-strong`；带立体底沿的键帽 CTA 走 `--cta-brand-{from,to,edge}`。旧青 `--color-teal` 与旧蓝 `--color-accent` 均已全量删除，不得重新引入。
11. **react-hooks lint**：仓库禁 effect-setState 与渲染期读写 ref；改用渲染期 guard setState。StrictMode 下 mountedRef 只在 cleanup 置 false 会卡死恒 false——setup 里 reset true，回归测试包 `<StrictMode>`。

## 四、后端契约（不臆测）

12. **查接口契约用 apifox 取真实 OAS**：PGC/Koubou = 项目 8405123，biz-api = 8391231；不臆测字段名。
13. **Koubou WS `user.message` 只收 text/image 块**：图片 url 须公网可达，无 video/audio 块（非图片走文本描述）。

## 五、本地环境已知坑

14. **主题突变 light = hydration mismatch**：整树重渲抹掉 `<html data-theme>`；长跑 dev server HMR 坏掉是典型触发，重启即修。
15. **Tailwind 会扫描 md 文档**：文档里非法 arbitrary class 会炸 CSS 构建；已用 `@source not` 两行在 globals.css 根治，复发先查这两行还在不。
16. **dev 端口可能被别的 worktree 占用**（渲染错代码）；Turbopack dev 因 Google Fonts 被墙 500 时改跑 prod。无本地后端时用 Playwright `page.route('**/api/pgc/**')` 注入信封 mock 逐态截图，或临时挂 `window.__store` 注入完整态。

## 六、i18n

17. **六语文案（en/zh/fr/ru/ja/vi），en 为单一真相源**：新增文案必须补齐六套；抽取时须扫插值与 aria-label 盲点。
