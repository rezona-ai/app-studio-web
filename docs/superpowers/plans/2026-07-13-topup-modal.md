# 充值弹窗(Top-up Modal)实现计划

设计稿:`docs/superpowers/specs/2026-07-13-topup-modal.md`

## 文件清单

### 新增

| 文件 | 内容 |
|---|---|
| `src/server/biz/proxy.ts` | biz-api 转发(同 koubou/proxy 模式:PGC_BASE_URL + BIZ_PREFIX,5xx 记日志,不可达→502 JSON) |
| `src/app/api/biz/[...path]/route.ts` | catch-all 路由(GET/POST,cookie 透传) |
| `src/lib/biz/types.ts` | `TopupOptions / TopupPackage / TopupCoupon / TopupOrder / CreateWaffoOrderData` |
| `src/lib/biz/client.ts` | `bizApi.getTopupOptions / createWaffoOrder / getTopupOrder / closeTopupOrder`;裸 JSON,非 2xx 抛 `BizError` |
| `src/lib/topup.ts` | 纯逻辑:`formatUsd`(分→$,compact 去 .00)/ `couponPercent`(bps→折扣%)/ `formatCountdown`(ms→HH:MM:SS,时可>24)/ `creditsPerUsd`(档位推汇率)/ `isOrderPaid` / `isOrderClosed` |
| `src/components/ui/TopupModal.tsx` | 弹窗本体(状态机 idle/creating/waiting 组件内部态) |
| `src/lib/topup.test.ts` · `src/lib/biz/client.test.ts` · `src/components/ui/TopupModal.test.tsx` | 单测 |
| `public/figma/icons/timer.svg` · `public/figma/topup-banner.jpg` | 设计资产(已就位) |

### 修改

| 文件 | 变更 |
|---|---|
| `src/lib/backend-routes.ts` | + `BIZ_PREFIX = '/tln/biz'` |
| `src/store/types.ts` | `creditModalOpen: 'insufficient' \| 'manual' \| false`(+导出 `CreditModalSource`) |
| `src/store/index.ts` | `setCreditModalOpen` 签名随之;`ingestKoubou` 置 `'insufficient'` |
| `src/store/actions.ts` | 三处 `creditModalOpen: true` → `'insufficient'` |
| `src/components/workspace/Workspace.tsx` | `CreditModal` → `TopupModal` |
| `src/components/preview/UserInfo.tsx` | 积分区域改 `<button>`,点击 `setCreditModalOpen('manual')` |
| `src/components/ui/figma.tsx` | 登记 `timer` |
| `src/app/globals.css` | + `--color-promo` / `--color-promo-banner`(浅深两稿)/ 三个 `--shadow-topup-*` |
| `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts` | 删 `creditModal.*`,增 `topup.*` |
| `src/store/actions.test.ts` | `creditModalOpen` 断言 true → `'insufficient'` |

### 删除

- `src/components/ui/CreditModal.tsx` + `CreditModal.test.tsx`(行为整体被替换,不留 dead code)

## 实现要点(按依赖序)

1. **代理层**:BIZ_PREFIX → biz/proxy → route(照抄 koubou 三件套,信封差异只在客户端处理)。
2. **lib 纯逻辑 TDD**:先写 `topup.test.ts` 再实现 `topup.ts`;`biz/client` 用 fetch mock 测非 2xx/非 JSON 兜底。
3. **store 类型扩展**:真值语义不变,现有 `if (creditModalOpen)` 类判断零改动。
4. **TopupModal**:
   - 打开即 `getTopupOptions()` + `loadUserInfo()`;骨架/失败重试;
   - 倒计时 1s 步进,归零重拉 options;
   - CTA:同步预开空白窗 → `createWaffoOrder({package_id|amount_usd, idempotency_key: crypto.randomUUID()})` → 占位窗写入 redirect_url → 3s 轮询 `getTopupOrder`;`paid_at` 非空 → `loadUserInfo()` + success Toast 回 idle;`status==='failed'` → error Toast 回 idle;10min 超时停轮询;
   - waiting 态可取消(`closeTopupOrder`);关闭弹窗清计时器;
   - `enabled:false` → CTA 走旧主站跳转(埋点不变)。
5. **UserInfo**:积分 span → button(hover `--color-fill`、aria-label),埋点由弹窗挂载时按 source 上报。
6. **视觉验收**:Playwright 挂 `window.__store` 注入余额 + route mock options(有券/无券两态),截图与 Figma 截图逐项对照(间距/字号/颜色/圆角)后再宣称完成;`prefers-reduced-motion` 复查动效退化。

## 验证

- `pnpm exec tsc --noEmit` · `pnpm lint` · `pnpm test`(全量,worktree 内跑);
- Playwright 渲染两主题 × 有券/无券截图核对;
- 实连 dev 后端(enabled:false)验证回落路径可用。
