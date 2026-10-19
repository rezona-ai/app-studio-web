# 积分不足弹窗（Insufficient Credits Modal）设计稿

日期：2026-07-14 · Figma 节点：`TALUNA DEVELOPER SITE` 3082:41181（modal-root, 1169×742）

## 背景

此前积分不足（`creditModalOpen === 'insufficient'`）与手动点积分区（`'manual'`）共用同一个充值弹窗 `TopupModal`。设计侧为「积分不足」场景出了专属营销弹窗：宝箱 hero 大图 + WordArt 标题 + 三档套餐速选 + 单个全宽 CTA，转化导向更强。本需求将 insufficient 来源改为渲染新弹窗，manual 来源保留原 `TopupModal`。

## 视觉结构（自上而下）

1. **Hero 区**（1169×328，圆角 12，溢出裁切，深底）
   - 底层：漩涡纹理位图（`insufficient-swirl.jpg`）`opacity-10` 铺满；其上叠 173° 促销粉渐变（`rgba(--color-promo, 0.6) → 透明`，上浓下淡）。
   - 中层：宝箱主视觉 `insufficient-chest.webp`。原设计为「暗色宝箱底图 + mask 提亮箱内区域」两层位图（原图 19MB + mask 资产 MCP 不落盘），已离线预合成为单张 1024px 带透明底 webp（箱内提亮区按 mask 坐标羽化贴合）。
   - 顶层：两行 WordArt 标题 “Insufficient / Credits...”，Sekuya 56px、青色三段渐变 `background-clip:text`、整体 rotate -8.25° / skew -8.72°、第二行右下错位。**视为装饰性艺术字不做 i18n**（`aria-hidden`，等同 logo；弹窗 `aria-label` 用本地化文案）。
   - 右上角：黑色半透明圆形关闭钮（`bg-black/50` + close 图标）。
2. **描述行**：16px 居中灰字（`--color-muted`），余额数字白色强调。后端积分不足错误**不携带本次所需积分数**（触发信号只是布尔，见 `credit-error.ts`），故不采用设计稿的 “You need 2 more credits…(Costs 20, you have 18.)”，改为通用句式：*You don't have enough credits to generate. (You have **{n}**.)*，`n` 取 store 余额。
3. **首充券横幅**（有券才显示）：深底圆角 12 条幅；左侧两行 12px bold 全大写（第一行 ink、第二行 teal），右侧倒计时 chip（促销粉 80% 罩深底 + 内阴影 `--shadow-topup-timer`、timer 图标 + 18px 等宽数字）。数据与倒计时逻辑与 TopupModal 完全一致（归零重拉配置）。
4. **套餐三卡**：`options.packages` 渲染（设计为 3 档，按实际数量弹性布局，无自定义档）。卡片：圆角 16、p-5、`--color-shell` 底 / `--color-line-strong` 描边；选中态与 TopupModal 一致（teal 1.5px 描边 + 15% teal 罩 + `--shadow-topup-select`）。卡内：划线原价 14px muted + 折后价 24px semibold ink、积分数 14px bold teal、下方两行 10px 等价示例文案。SAVE 徽标为促销粉胶囊，骑卡顶边**靠右**（right-6，与 TopupModal 的居中不同）。
   - **等价示例文案**（“= 92 Nano Banana 2 generations / ~27 Tripo 3D models”）：后端 `TopupPackage` 无此字段，且各档换算率在设计稿中并不一致（纯营销文案），故按档位序号取静态 i18n 文案（`insufficient.examples.p0/p1/p2`），超过 3 档的卡不显示示例。
   - 默认选中**第二档**（设计稿高亮中间档）；不足两档回落首档。
5. **View all pricing options →**：居中文字链，点击切到完整充值弹窗（`setCreditModalOpen('manual')`，含自定义金额档）。
6. **全宽 CTA**：teal 底胶囊（rounded-full、py-4、16px semibold、`--color-on-teal` 深字），文案 “Recharge Now - ~~$25~~ $17.50”（有折扣带划线原价）。点击走与 TopupModal 相同的 Waffo 建单流：同步开占位新标签 → 建单 → 收银台 → 3s 轮询查单；`options.enabled=false` 时回落主站充值页。waiting 期 CTA 转为等待文案禁用，其下出现「取消支付」小按钮。

弹窗容器：`w-[min(1169px,100%)]`、圆角 24、`--color-pop` 底、`modal-pop`/`modal-backdrop` 动效、Esc / 点遮罩关闭。颜色一律语义变量（营销恒定色沿用既有 `--color-promo` / `text-white` 先例）。

## 数据与状态

- 复用 biz-api 充值域：`getTopupOptions` / `createWaffoOrder` / `getTopupOrder` / `closeTopupOrder`，字段语义不变。
- **共享逻辑抽 hook `src/client/useTopupFlow.ts`**：配置拉取（最后请求胜出）+ 券倒计时（归零重拉）+ 建单 / 轮询 / 取消 / 回落 + 弹窗曝光与点击埋点（`out_of_credits_show` / `out_of_credits_recharge_click`，trigger 语义不变：insufficient→`generate`，manual→`manual`）。`TopupModal` 与新弹窗共用，档位选择与自定义金额仍归各自组件。
- 打开分流（`Workspace.tsx`）：`creditModalOpen === 'insufficient'` → `InsufficientCreditsModal`；`'manual'` → `TopupModal`。store 结构不变。

## i18n

新增 `insufficient.*`（六语）：`desc`（含 `<b>{{n}}</b>` 强调插值，经 `Trans` 渲染）、`viewAll`、`examples.p0/p1/p2`（两行用 `\n`，`whitespace-pre-line` 渲染）。其余文案（rechargeNow / waiting / cancelOrder / save / couponOff / loadFailed / credits…）复用 `topup.*`。

## 资产

- `public/figma/insufficient-chest.webp`：预合成宝箱（74KB，透明底）。
- `public/figma/insufficient-swirl.jpg`：漩涡底纹（46KB）。
- `public/figma/icons/arrow-right.svg`：新登记 `figAsset.arrowRight`（secondary tone）。
