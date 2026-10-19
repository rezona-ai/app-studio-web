# i18n 扩充到 11 语（实现计划）

对应设计稿：`docs/superpowers/specs/2026-07-15-i18n-expand-11-locales.md`

## 步骤

1. **config.ts**：`SUPPORTED` 增 `zh-TW` / `de` / `es` / `ko` / `pt`；`normalizeLocale` 升级为「全标签精确匹配 → 繁体别名(zh-hant/zh-hk/zh-mo→zh-TW) → 主子标签 → 回退 en」。同步更新 `config.test.ts`（`zh_TW` 断言从 `zh` 改为 `zh-TW`，`es`/`de` 从回退改为命中，补别名与 `pt-BR` 等用例）。
2. **新词典 ×5**：`locales/{zh-TW,de,es,ko,pt}.ts`，以 en 为形状源标注 `: Messages` 全量翻译（含插值占位符与 `\n` 原样保留）。
3. **index.ts**：`localeLoaders` 增补五个显式静态映射；`load.test.ts` 补新语言按需加载用例。
4. **LanguageMenu.tsx**：`LANGS` 扩到 11 项、按主站菜单顺序；`zh` 母语名改「简体中文」。
5. **校验**：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm lint`（只信退出码，不信 worktree IDE 诊断）。

## 风险

- `zh-TW` 归一顺序错了会把繁体折到简体——用测试钉住；
- 翻译遗漏插值占位符（`{{name}}` 等）会运行期渲染错——翻译约束里显式要求保留，完成后 grep 抽查。
