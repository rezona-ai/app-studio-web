# 实现计划:Rezona 绑定弹窗重设计 + 取消白名单校验

对应 spec:`docs/superpowers/specs/2026-07-16-rezona-link-redesign.md`

## Task 1:删除白名单校验链

- `src/lib/pgc/client.ts`:删 `rezona.eligibility` 与 `RezonaEligibilityData` import
- `src/lib/pgc/types.ts`:删 `RezonaEligibilityData`
- `src/store/types.ts`:删 `rezonaEligible` 字段与初值
- `src/store/actions.ts`:删 `loadRezonaEligibility` 及注册
- `src/client/useProjectBootstrap.ts`:删调用
- `src/components/preview/PreviewPanel.tsx` / `FileMenu.tsx`:删订阅与 `showRezona` prop,菜单项恒显示
- 测试同步:`rezona-client.test.ts` / `actions.test.ts` / `PreviewPanel.test.tsx` / `FileMenu.test.tsx` / `RezonaPublishModal.test.tsx`(mock 键)

验证:`grep -rn "eligib\|rezonaEligible" src` 为空;`pnpm exec vitest run` 相关文件绿。

## Task 2:链接常量 + 下载 QR 纯函数(TDD)

- `pnpm add qrcode-generator`
- `src/lib/rezona/links.ts`:五个常量(占位 URL,待产品确认)
- `src/lib/rezona/qr.ts`:`qrSvgPath(text): string`(返回 SVG path d,纯函数)+ `qr.test.ts`

## Task 3:store 徽章图标资产

- `public/figma/icons/apple-logo.svg` / `google-play.svg`(自绘,注释注明来源)
- `figma.tsx`:登记 `appleLogo` / `googlePlay`,ICON_TONE `original`

## Task 4:LinkStep 重写 + 模态徽标对齐 + i18n

- `LinkStep.tsx` 按 spec 表重排;expired/rejected 保持现有语义(QR 区下方提示 + Refresh)
- `RezonaPublishModal.tsx` 徽标字号 11→10、tracking 1.5
- i18n 11 语新增/替换键:`linkTitle`(改文案)、`linkDesc1/2`、`scanTitle`(替 `linkSubtitle`)、`linkStep1..3`(替 `linkInstruction`)、`notOnRezona`、`appStore`/`appStoreCaption`/`googlePlay`/`googlePlayCaption`、`downloadQrAlt`、`agreePrefix`/`terms`/`agreeAnd`/`privacy`
- `LinkStep.test.tsx` 更新

## Task 5:全量验证

`pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`;dev 起服双主题目检。
