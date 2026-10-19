# Rezona 绑定弹窗重设计 + 取消白名单校验

日期:2026-07-16 · 设计稿:Figma TALUNA-DEVELOPER-SITE 4311:37775

## 目的

1. 按新设计稿重做 Rezona 发布流程的「Link your Rezona account」扫码绑定步骤(`LinkStep`)。
2. 取消入口白名单校验:删除 `GET /api/rezona/eligibility` 调用链,File menu 的 Share to Rezona 恒显示。

## 设计稿要点(metadata + 截图 + variable defs 推导;get_design_context 持续超时不可用)

弹窗 400px 宽、内边距 32、纵向节距 12(spacing-12),自上而下:

| 设计稿节点 | 实现 |
|---|---|
| `> Post to rezona` 徽标(10/12,ls 1.5,teal)+ close | 模态壳既有徽标,字号对齐 10px |
| 标题 Link your Rezona account(24/29 bold,白) | `text-[24px] leading-[29px] font-bold text-ink` |
| 描述两段式(12/16):首句 semibold 白 + 次句灰 | `linkDesc1`(ink semibold)+ `linkDesc2`(muted) |
| Scan this QR with the Rezona App(14/20)+ info 图标 16(右) | 行内 flex,Info 装饰性 aria-hidden |
| 绑定 QR 204×204,白底圆角 12 | 沿用后端 `qr_image`,现有卡样式 |
| Does not work? / Contact support | 设计稿 hidden,不实现 |
| 编号说明 1–3(12/16) | `<ol>` 三条 `linkStep1..3` |
| 分隔行:96px 线 ×2 + Not on Rezona yet?(13/20) | 线 `--color-line-strong`(dark=#494949 与稿一致) |
| 下载区:左 162×162 白底 QR + 右两枚 store 徽章 162×40(间距 12,垂直居中) | QR 前端生成(下详);徽章为灰底自绘(下详) |
| 页脚 By linking… Terms of Service / Privacy Policy(10/12,居中,链接下划线) | 拆分 i18n 键 + `<a>` |

色值映射:#FFF/#E5E5E5→`--color-ink`;#737373→`--color-muted`;#494949→`--color-line-strong`;#1FD4CF→`--color-teal`。徽章底 #737373(两主题恒定灰,白字白标,同 `.btn-raised` 的恒色例外)→ `bg-[var(--color-muted)]`。

## 关键决策

- **下载 QR**:后端无对应接口(Apifox 8405123 全量核对,rezona 相关仅 eligibility/binding/bind/poll/callback/jwks/publish),前端用零依赖库 `qrcode-generator` 运行时生成 SVG,内容为 `REZONA_DOWNLOAD_URL` 常量——改 URL 码自动跟上。
- **外链常量集中** `src/lib/rezona/links.ts`:App Store / Google Play / 下载页 / Terms / Privacy,均经产品确认(2026-07-16;下载页为 go.link 落地页)。
- **store 徽章**:官方样式但按稿改灰底,自绘(FigIcon 注册 apple-logo / google-play,tone original);不引官方黑底位图。
- **白名单删除**:`eligibility` API + `RezonaEligibilityData` + store `rezonaEligible` + action `loadRezonaEligibility` + bootstrap 调用 + `FileMenu.showRezona` 门控整链删除,不留 dead code。绑定/发布链路(binding/bind/poll/publish)不动。

## 成功标准

- 深浅两主题下 LinkStep 与设计稿逐项对齐(字号/间距/圆角按上表)。
- Share to Rezona 菜单项无条件显示;src 内无 eligibility/rezonaEligible 残留。
- 新文案补齐 11 语;lint / tsc / test / build 全绿。
