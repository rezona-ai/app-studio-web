# Post to Rezona 弹窗按稿重做（实现计划）

- 设计稿：`docs/superpowers/specs/2026-08-13-rezona-publish-modal-figma-align.md`
- 分支：`fix/rezona-publish-figma-align`（worktree `.orca/worktrees/rezona-figma-align`）

四个任务各自可独立跑测试、独立评审；顺序即依赖顺序（T3 用到 T1 的 key 与 T2 的类）。

## T1 · i18n：补回文案并对齐稿上措辞

**改**：`src/i18n/locales/{en,zh,zh-TW,vi,fr,ru,ja,ko,de,es,pt}.ts`（`preview.rezona`）

- 新增 `intro`（描述文案）、`remixable`、`remixableDesc`。
- 改措辞：`publicDesc` → “Everyone can see your game”、`syncDesc` → “Appeared in Rezona Community”、
  `postFooter` → “Your game will be visible to Rezona's community after you posted onto Rezona”（各语言对应翻译）。
- **不删** `accountNotice` / `noRemixNotice`（spec §2.1）。

**验证**：`pnpm exec vitest run src/i18n/i18n.test.ts`（11 语言 key 集合一致）+ `tsc --noEmit`（词典有 TS 类型双保险）。

## T2 · globals.css：品牌橙键帽 CTA

**改**：`src/app/globals.css`

- `@theme` 里加三个恒定令牌（不随主题翻，紧邻 `--color-on-primary-strong` 并注释理由）：
  `--cta-brand-from: #fb923c` / `--cta-brand-to: #ff8029` / `--cta-brand-edge: #7c2d12`。
- 新增 `.btn-brand-key`：`background-image: linear-gradient(180deg, from, to)`；
  `filter: drop-shadow(0 4px 0 var(--cta-brand-edge))`；`color: var(--color-on-primary-strong)`；
  hover `brightness(1.05)`；`:disabled` 去掉底沿与渐变退成中性面（复用 `--color-fill` + `--color-muted`）。
- 位移/缩放反馈走 `motion-safe:`；本类无 keyframes，`prefers-reduced-motion` 段无需补。

**验证**：无独立单测（纯样式）；由 T3 的组件测试断言 class 挂载 + 人工比稿。

## T3 · PublishForm 按稿重做

**改**：`src/components/preview/rezona/PublishForm.tsx`、`PublishForm.test.tsx`

结构（外层 `flex flex-col gap-2`，即 8px）：

1. 描述文案 `intro`（12px/16、`--color-ink`、tracking 0.18）
2. 账号行：新增 prop `user?: CurrentUser | null`；40 圆首字母头像（`userInitial`）+ `@{display_name||username}`，
   缺失回落 `t('preview.account')`；**只读、无按钮**
3. PREVIEW：标签改 10px extrabold **品牌橙**；缩略图保持现有上传入口逻辑；右侧 Upload 改成**铺满的 32 高按钮**
   （删掉 `coverHint` 那句），上传中显示 `coverUploading` 文案 + 禁用
4. GAME TITLE：标签 11px bold muted；输入框 44 高 radius 8 + 右侧 14px `Pencil` 图标（装饰性，`aria-hidden`；
   点击不额外聚焦——原生 input 本身可点）
5. BRIEF INTRODUCTION：同上，textarea 59 高
6. 分隔线
7. 三开关（`gap-2`）：Public / Sync 可交互；**Remixable 恒 `checked={false}` + `disabled`**（不写进 `PublishToggles`）
8. ⓘ 行：`Info` 24 + gap-1 + 10px `--color-ink` 的 `settingsNote`
9. CTA 区：`pt-2` + `.btn-brand-key` 全宽 32 高按钮（`Rocket` 16 + 13px bold 白字）+ `gap-3` + 11px 居中页脚

**测试**（改写 `PublishForm.test.tsx`）：

- 删除「账号条已下线」「Remixable 已删除」「两条告知」三条反向断言（它们已被 Nick 的决策作废）。
- 新增：账号行渲染 `@Name`（传 `user`）/ 无 `user` 时回落且不崩；
  三个 switch 且 `Remixable` 为 `disabled` + `aria-checked=false`；点 Remixable 不触发 `onChange`；
  `intro` 与 `settingsNote` 在文档中；CTA 挂 `.btn-brand-key`。
- 保留：Public 只改自身、maxLength 30/200、CTA 触发 onSubmit、未 build 置灰 + 提示、缩略图触发同一 file input、上传中禁用。

**验证**：`pnpm exec vitest run src/components/preview/rezona/PublishForm.test.tsx`

## T4 · 外壳与接线

**改**：`src/components/preview/RezonaPublishModal.tsx`、`RezonaPublishModal.test.tsx`

- 壳宽 `w-[480px]` → `w-[400px]`；`p-8` 保留；`mb-4` 头部间距改成外层统一 `gap-2` 语义（头部与描述由 PublishForm 承接描述、
  外壳只保留字标行 + 8px 间距）。
- 字标去掉 `> ` 前缀，字重改 extrabold、去 `tracking-[1.5px]`。
- 从 store 读 `userInfo` 传给 `PublishForm`（modal 已是 store 订阅者，保持 PublishForm 为纯展示件）。

**测试**：新增/更新——发布请求体**仍不含 `remixable`**（守住契约 §7）；账号行显示 store 里的用户名。

**验证**：`pnpm exec vitest run src/components/preview/RezonaPublishModal.test.tsx`

## 收尾

1. 全量：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四条输出留档。
2. 删掉抓稿时落在 `public/figma/tmp-8905-73023/` 的临时 SVG/PNG（**不进仓库**）。
3. 派干净上下文子代理按 commit 范围评审（只给 spec + diff）；Critical/Important 修完再合。
4. `--no-ff` 合回 dev，在合并结果上重跑全量验证。
