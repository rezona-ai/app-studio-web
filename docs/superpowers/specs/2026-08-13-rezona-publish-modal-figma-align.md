# Post to Rezona 弹窗按 Figma 8905:73023 重做（设计稿）

- 日期：2026-08-13
- Figma：`https://www.figma.com/design/vtfn5ZttNgStezVfJR6wgB/Rezona-Lab?node-id=8905-73023`（下称「稿」）
- 前置：`docs/superpowers/specs/2026-08-12-rezona-publish-direct-design.md`（直发改造，本稿在其之上做视觉重做，**并按 Nick 拍板回滚其中三处 UI 删除**）
- 涉及文件：`src/components/preview/rezona/PublishForm.tsx`、`src/components/preview/RezonaPublishModal.tsx`、`src/app/globals.css`、11 语言 i18n

## 1. 目的

昨天（2026-08-12）的直发改造按后端契约 `frontend-integration.md` §0/§3 删掉了弹窗内的**顶部描述文案、账号行、Remixable 开关**，
并把告知区扩成三段纯文案。稿上这三块都在，且整体尺寸/字号/按钮样式与当前实现有系统性偏差。

本次把弹窗**完全对齐稿**：补回被删内容、按稿重排间距与字号、CTA 换成品牌橙键帽。

## 2. 盘问结论（2026-08-13，Nick 拍板）

| # | 问题 | 结论 |
|---|---|---|
| 1 | 稿上 Remixable 开关是否恢复？契约 §7 请求体不传 `remixable` | **恢复但恒关置灰**（`checked=false` + `disabled`），不进请求体、不进 `PublishToggles` |
| 2 | 稿上头像 + `@Username` 显示谁？（Rezona 账号发布前拿不到） | **显示当前 lab 用户**（`store.userInfo` 的 `display_name`/`username`），不提供切换 |
| 3 | 三条告知文案怎么收？契约 §2 要求 CTA 前明示自动建号 | **完全对齐设计稿**：只留稿上带 ⓘ 的那一条 settings 说明 |
| 4 | CTA 与字标前缀这两处「稿 vs 仓库范式」冲突 | **都按稿**：CTA 改品牌橙键帽白字（不再用 `.btn-raised`）；字标去掉 `> ` 前缀 |

### 2.1 已知偏离与理由（必须留档）

- **偏离契约 §2**（结论 3 的直接后果）：`accountNotice`（「发布将使用你的 Rezona 账号，若没有会自动创建」）与
  `noRemixNotice`（「本次发布不开放二次创作」）两条告知**从 UI 移除**。前者是契约明文要求的发布前告知，
  本次按产品（Nick）决定以稿为准；`noRemixNotice` 的语义由恢复出来的置灰 Remixable 开关承担。
  两条 i18n key **保留在 locales 里**（后端/法务若要求回补，改 UI 即可，不必再动 11 语言）。
- **偏离契约 §0**（结论 1/2）：契约写「弹窗内不再有账号条、Remixable 开关」。恢复后二者都**不产生任何请求字段**、
  也不提供换绑入口，故不违反 §4/§7 的行为约束，只是 §0 的 UI 描述与稿不一致——以稿为准。
- **`> ` 前缀**：`ApkExportModal` 仍保留 `> ${badge}` 写法，本次只改 Rezona 弹窗，两个弹窗的字标写法暂不一致（稿如此）。
- **稿上暗色原值不逐一硬编码**：稿是暗稿，给出 `#0d0d0d`（缩略图底）/`#1a1a1a`（输入框底）/`#2a2a2a`（描边）/`#404040`（Upload 按钮底）等原值。
  本弹窗须同时支持浅色主题，故这些一律映射到既有语义令牌（见 §4 表），不引入 `--rezona-*` 作用域令牌。
  唯一例外是 CTA——品牌橙恒定不随主题翻，按 `.btn-raised` / `--upsell-*` 的既有例外惯例落成 `globals.css` 里的具名类 + 令牌。
- **头像用首字母而非稿上人像图标**：`/auth/me` 不返回头像 URL，稿上的人像 icon 是占位。沿用 `UserInfo.tsx` 的
  `userInitial()` 首字母范式，保持全站头像一致。
- **ⓘ 说明文案措辞**：稿写 “RznLab” / “the Rezona app”，仓库 i18n 现文案是 “Rezona Lab” / “go to Rezona”，语义相同。
  保留现有全称措辞（品牌换名 spec `2026-07-31` 统一用 Rezona Lab），只改版式不改措辞。

## 3. 稿上形态（自上而下，含实测尺寸）

外壳 400 宽、padding 32（内容宽 336）、总高 770。**所有区块之间统一 8px 间距**。

| # | 区块 | 稿上规格 |
|---|---|---|
| 1 | 字标行（16 高） | `POST TO REZONA` 10px Inter ExtraBold uppercase 品牌橙、无字距；右侧 close 16px |
| 2 | 描述文案（32 高） | 12px/16 Regular、`#e5e5e5`、字距 0.18px，两行 |
| 3 | 账号行（64 高） | 无底色，padding 12；头像 40 圆（浅底 + 人像）+ gap 12 + `@Username` 14px/20 SemiBold |
| 4 | PREVIEW（150 高） | 标签 10px ExtraBold uppercase **品牌橙** + gap 12；下方 gap 12 横排：126×126 缩略图（radius 8、底 `#0d0d0d`、描边 `#2a2a2a`、封面图 opacity 30、居中 40 圆 `#2a2a2a` + 16 upload 图标）／右侧铺满的 Upload 按钮（32 高、radius 8、底 `#404040`、描边 `rgba(255,255,255,.1)`、px16 py8、gap 8、16 图标 + 12px/16 白字字距 0.18） |
| 5 | GAME TITLE（65 高） | 标签 11px Bold uppercase `#a3a3a3` + gap 8；输入框 44 高、radius 8、底 `#1a1a1a`、描边 `#2a2a2a`、padding 12、值 14px/20 SemiBold、右侧 14px pencil 图标 |
| 6 | BRIEF INTRODUCTION（80 高） | 标签同上；textarea 59 高、同底/描边/radius、padding 12/8、placeholder 14px |
| 7 | 分隔线 | 336×1 |
| 8 | 三开关（各 36 高、间距 8） | 标题 14px Bold、描述 12px Regular `#a3a3a3`、二者 gap 4；右侧 toggle 39×24；文案：Public / Everyone can see your game、Sync to community / Appeared in Rezona Community、Remixable / Others can remix on your game |
| 9 | ⓘ 说明（24 高） | 24px info 图标 + gap 4 + 10px Regular `#e5e5e5` |
| 10 | CTA 区（78 高） | 上 padding 8；按钮全宽 32 高、radius 8、渐变 `#fb923c→#ff8029`（180deg）、底沿 `drop-shadow 0 4px 0 #7c2d12`、16 火箭图标 + 13px/16 Bold 白字；下方 gap 12、页脚 11px 居中 `#a3a3a3` |

## 4. 令牌映射

| 稿上值 | 用途 | 落成 |
|---|---|---|
| `#e5e5e5` | 描述文案 / ⓘ 说明 | `--color-ink`（10–12px 小字需要高对比；`--color-muted` 深色下 `#7b7b7b` 对比不足 4.5:1） |
| `#a3a3a3` | 区块标签 / 开关描述 / 页脚 | `--color-muted` |
| `#f97316` | 字标 / PREVIEW 标签 | `--color-primary` |
| `#1a1a1a` / `#404040` | 输入框底 / Upload 按钮底 | `--color-fill` |
| `#0d0d0d` / `#2a2a2a` | 缩略图底 / 其中心圆形图标底 | `--color-surface-2` / `--color-fill`——稿上圆形按钮比缩略图底**浅**，故不能沿用旧写法（旧写法圆形用 `--color-pop` #202020 反而比 `--color-fill` #2e2e2e 深，关系是反的） |
| `#2a2a2a` | 输入框、缩略图、按钮描边 | `--color-line-2` |
| `#fb923c→#ff8029` + `#7c2d12` | CTA 渐变 + 底沿 | 新增 `globals.css`：`--cta-brand-from/--cta-brand-to/--cta-brand-edge` + `.btn-brand-key`（恒定不随主题，同 `.btn-raised` 例外惯例），文字 `--color-on-primary-strong` |

图标：`Upload` / `Rocket` / `Info` / `Pencil` 取 `lucide-react`（本文件既有范式已用 `Upload`/`Rocket`，不新增 `figAsset` 条目）。

## 5. 数据与行为（不变量）

- **发布请求体不变**：`{version_id, name, summary, cover_ref:'version_cover', public, sync_to_community, idempotency_key}`。
  Remixable 不进 `PublishToggles`、不进请求体。
- **封面上传行为不变**：缩略图与 Upload 按钮共用同一个 `<input type=file accept=image/png>`，上传替换**项目级**封面。
- **CTA 置灰逻辑不变**：`version.status !== 'ready'` 时 disabled，页脚换成 `notBuiltHint`，`aria-describedby` 关系保留。
- **账号行只读**：无按钮、无菜单；`userInfo` 缺失时回落 `preview.account` 文案，头像回落 `?`（同 `UserInfo.tsx`）。
- 三步壳（form / posting / published）共用 400 宽外壳；`max-h-[85vh] + overflow-y-auto` 保留（稿高 770 > 部分视口）。

## 6. 新增 i18n（11 语言）

- `preview.rezona.intro`：描述文案（Post your game onto Rezona, the largest AI interactive content platform, to reach over 10 Million Rezonians!）
- `preview.rezona.remixable` / `remixableDesc`：Remixable / Others can remix on your game（2026-08-12 删过，本次恢复）
- 文案微调对齐稿：`publicDesc`（Everyone can see → Everyone can see your game）、`syncDesc`（Appeared in Rezona feed → Appeared in Rezona Community）、`postFooter`（→ Your game will be visible to Rezona's community after you posted onto Rezona）

删除：`coverHint`（稿上 Upload 按钮取代了那句提示文案，全仓仅此一处引用，不留 dead key）。

保留不删：`accountNotice` / `noRemixNotice`（见 §2.1）。

## 7. 成功标准

1. 弹窗宽 400、区块间距 8，与稿逐块对位（字标 / 描述 / 账号行 / PREVIEW / 标题 / 简介 / 分隔线 / 三开关 / ⓘ / CTA + 页脚）。
2. 账号行显示当前 lab 用户 `@name`，无任何切换入口。
3. 三个开关都在；Remixable 恒 `aria-checked=false` 且 `disabled`。
4. 发布请求体仍不含 `remixable`（回归测试守住）。
5. CTA 为橙底白字键帽，`version.status !== 'ready'` 时仍置灰 + 提示。
6. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 8. 非目标

- 不动发布接口、错误码映射、幂等键、超时口径（`src/lib/rezona/publish.ts` 只增不改语义）。
- 不动 posting / published 两步的内容（只随外壳变宽度）。
- 不动 APK 导出弹窗、Share Game、Workbench 分享。
- 不为 Remixable 补后端能力（真开关待后端支持后另立需求）。
