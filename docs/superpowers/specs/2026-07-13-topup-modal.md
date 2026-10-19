# 充值弹窗(Top-up Modal)设计稿

日期:2026-07-13
Figma:`TALUNA-DEVELOPER-SITE` node `3625:38237`(topup-modal)

## 背景与目标

现状:积分不足时弹 `CreditModal`(小型提醒模态),CTA 新标签跳主站 `/studio/recharge` 完成充值——用户离开编辑器、链路断裂。

目标:

1. 按设计稿实现完整的**站内充值弹窗**(余额卡 + 首充券横幅 + 充值档位网格 + 结算条),直接走 Waffo 收银台完成支付;
2. 积分不足(guard 捕获 `CREDIT_INSUFFICIENT` 类 PgcError / Koubou `credit.insufficient` 帧)时**打开该弹窗**,替换原跳转主站的行为;
3. 预览区账户条的**积分区域可点击**,手动打开弹窗。

## 后端契约(biz-api,Apifox 项目 8391231,2026-07-13 已实测核对)

biz-api 与 PGC/Koubou 同网关(`PGC_BASE_URL`),前缀 `/tln/biz`。**响应为裸 JSON,无 `{success,data}` / `{code,data}` 信封**(与 PGC/Koubou 都不同);错误按 HTTP 状态码 + body 兜底处理。

| 接口 | 用途 | 关键字段 |
|---|---|---|
| `GET /credits/topup/options` | 充值配置 | `enabled`(Waffo 是否可用)· `currency` · `coupon\|null`(`pay_rate_bps` 基点、`max_discount_cents` 封顶、`expires_at`)· `packages[]`(`id/credits/amount_cents/discounted_amount_cents/discount_cents/currency`) |
| `POST /credits/topup/waffo` | 建单 | 入参 `package_id` 与 `amount_usd`(整数美元原价,≥1)二选一 + `idempotency_key`;返回 `id`(本地单号)、`redirect_url`(收银台) |
| `GET /credits/topup/order?id=` | 查单(轮询) | `status` · `paid_at` · `expires_at` |
| `POST /credits/topup/order/close` | 用户主动关单 | `{id}` → `status: failed`=已关闭并释放券 |

**订单状态枚举未在 Apifox 文档化**,判定只依赖已文档化字段(不臆测枚举值):

- `paid_at` 非空 → 支付成功(终态);
- `status === 'failed'` → 已关闭 / 失败(终态,与关单接口文档一致);
- 其余状态视为在途,继续轮询;`expires_at` 过期或轮询超时(10 分钟)则停止。

`coupon.pay_rate_bps` 文档明确「仅用于展示徽标,不参与价格计算」——**券后价一律以 `packages[].discounted_amount_cents` 为准**,前端不自行算折扣。

dev 环境实测:`enabled:false`、`coupon:null`、5 档(credits-5k → $5 … credits-100k → $100,当前无折扣)。**UI 完全数据驱动**,设计稿中的档位数值仅为示意。

## 接入方式

新增第三条 BFF 代理(与 pgc/koubou 同构):`/api/biz/[...path]` → `PGC_BASE_URL + /tln/biz/<path>`,cookie 透传鉴权(本地回落 `DEV_COOKIE`),上游不可达收敛 502 + JSON。浏览器侧新增 `src/lib/biz/client.ts`(裸 JSON 处理,非 2xx 抛 `BizError`)。

## 设计稿 → 实现对照(≥3 层展开)

| 设计节点 | 内容 | 实现 |
|---|---|---|
| `3625:38237` topup-modal | 1077px 宽、bg `#202020`、rounded 20px、p-32、gap-12 | 面板 `w-[min(1077px,calc(100vw-64px))] rounded-[20px] p-8 gap-3`,bg `--color-pop`(深色稿即 #202020) |
| `38238` 头部 | `> TOP-UP CREDITS` 10px extrabold 青 uppercase + close 16px | 标题 + `IconButton ghost` + `figAsset.close` |
| `38246` balance-card | 2px 青描边 rounded-16、bg `#171717`、内发光;label 12px bold 青 uppercase;数字 64px extrabold + `credits` 18px | bg `--color-shell`、border `--color-teal`、内阴影 `--shadow-topup-balance`;数字取 `store.credit.balance`(千分位) |
| `38252` promo-banner | 仅有券时显示。bg `#0f3a36` + 纹理图 soft-light、border `#494949`;文案 18px semibold(白 + 青高亮);右侧倒计时 chip 209px、粉渐变 `rgba(254,52,102,.8)`、timer 图标 + `47:12:03` | bg 走新令牌 `--color-promo-banner`(浅色稿浅青,深色稿 #0f3a36)+ `topup-banner.jpg` 纹理;chip 粉底 `--color-promo` + `--shadow-topup-timer`;倒计时由 `coupon.expires_at` 派生,HH:MM:SS(小时可 >24),1s 步进,`tabular-nums` |
| `38258` pricing-grid | 6 卡等宽 gap-16;普通卡 bg `#171717` border `#494949` p-20 rounded-16;选中卡 1.5px 青描边 + 青 15% 罩 + 内发光;卡底青色光斑(Ellipse 931,模糊椭圆) | 卡为 `<button>`;选中态 border teal + `--shadow-topup-select`;光斑用 CSS `radial-gradient`(不引 PNG);划线原价 12px `--color-muted`(仅 `discount_cents>0` 时显示)+ 现价 18px 白/ink + credits 13px bold 青 |
| `38270` 等 chip | 卡顶右 `SAVE $X` 粉胶囊 -top-8 | `discount_cents>0` 时渲染,bg `--color-promo`,文字恒白 |
| `38318` Customize 卡 | 虚线描边 + plus 24px + `Customize` 18px | 选中后卡内换成整数美元输入框(`$` 前缀,min 1);credits 显示按档位比率估算(见「决策」) |
| `38326` action-bar | bg `#171717` rounded-16 px-24 py-12;划线原价 18px + 实付 32px bold + credits 14px bold 青;CTA 青底胶囊 h-44 px-32、文字 13px bold `#171717` | 汇总随选中档位/自定义金额联动;CTA `bg-[--color-teal] text-[--color-on-teal] rounded-full`(设计稿新按钮形态,非 `.btn-raised`,令牌 `--color-on-teal` 即为此场景而设) |

## 交互状态机

```
idle(选档) ── CTA 点击 ──▶ creating(建单) ──▶ waiting(新标签开收银台 + 3s 轮询查单)
   ▲                          │ 失败→Toast,回 idle        │
   │◀── 取消(关单接口)/失败 ────┘◀───────────────────────────┤
   └────────── paid_at 非空:刷新余额 + success Toast,回 idle ┘
```

- **`enabled:false` 回落**:CTA 点击改为新标签打开主站充值页(沿用原 `/studio/recharge?source_product=…` 链接与埋点),弹窗内其余展示不变——新链路灰度期间不断老路。
- **弹窗打开时**:拉 `options` + 刷新余额(`loadUserInfo`);加载中骨架,失败显示重试。
- **新标签防拦截**:点击处理器内**同步** `window.open('', '_blank')` 占位,建单成功后再写入 `redirect_url`,失败即关闭占位窗(异步后再 open 会被弹窗拦截器杀掉)。
- **关闭弹窗**(X / 遮罩 / Esc):停止轮询即可——到账由后端 Waffo webhook 保证,余额在下次 `loadUserInfo` 可见;在途订单不强制关单。
- **倒计时归零**:重拉 `options`(券过期后价格字段会变)。

## 状态归属(store)

- `creditModalOpen: boolean` → **`'insufficient' | 'manual' | false`**(真值语义不变,来源驱动埋点)。guard 三处与 `ingestKoubou` 置 `'insufficient'`;`UserInfo` 积分区域点击置 `'manual'`。瞬态,不持久化(不变)。
- 订单/轮询/倒计时等为弹窗组件内部态(卸载即清),不进 store——单一使用方,无跨组件协调需求。

## 主题与令牌(globals.css 新增)

设计稿仅有深色稿;全部走语义令牌,浅色主题自动适配(组件零主题分支):

| 设计值 | 令牌 |
|---|---|
| 弹窗底 `#202020` / 卡底 `#171717` / 描边 `#494949` / 次要字 `#a3a3a3` | 既有 `--color-pop` / `--color-shell` / `--color-line-strong` / `--color-muted` |
| 促销粉 `#FE3466`(SAVE chip / 倒计时 chip) | 新增 `--color-promo`(恒定不随主题翻,上面文字恒白,同 `.btn-raised` 例外策略) |
| 券横幅底 `#0f3a36` | 新增 `--color-promo-banner`:浅色稿取浅青 `#e4f8f6`,深色稿覆盖 `#0f3a36` |
| 三组内发光 inset 阴影(余额卡青 / 选中卡青 / 倒计时粉) | 新增 `--shadow-topup-balance` / `--shadow-topup-select` / `--shadow-topup-timer`(设计稿精确值,品牌色系恒定) |

新图标 `figAsset.timer`(`public/figma/icons/timer.svg`,mask 重着色);横幅纹理 `public/figma/topup-banner.jpg`(4096px 原 PNG 2.2MB 压为 1600px JPEG 92KB,soft-light 纹理无视觉损失)。

## 埋点

沿用既有事件,`trigger` 区分来源:`out_of_credits_show` / `out_of_credits_recharge_click`,`trigger: 'generate'(积分不足触发)| 'manual'(手动点积分区)`。充值漏斗深埋点(建单/支付成功)待与数据侧对齐后另行补充,本期不自造。

## 决策记录

1. **Customize 档 credits 估算**:后端无自定义金额报价接口;展示用 `amount_usd × (packages[0].credits ÷ packages[0].amount_cents × 100)` 估算并以 `≈` 前缀标注,实际到账以后端为准。不对自定义金额展示券后价(文档明示券不参与前端价格计算,且无报价字段)。
2. **默认选中第一档**:API 无 popular/推荐标记,不臆测。
3. **弹窗圆角 20px**:设计稿明确 20px(模态既有档位 24px);属该弹窗的品牌化形态,按设计稿精确值。
4. **CTA 青底胶囊**:设计稿新按钮形态(青底 + `--color-on-teal` 深字),不套 `.btn-raised`;`--color-on-teal` 令牌注释即为此用途。
5. **成功后不自动关弹窗**:余额卡原位刷新 + success Toast,用户可继续充值或自行关闭。
6. **i18n**:`creditModal.*` 六语文案随旧组件删除,新增 `topup.*` 六语(en 为单一真相源)。
