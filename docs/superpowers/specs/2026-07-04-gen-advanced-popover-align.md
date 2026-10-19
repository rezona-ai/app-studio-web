# 生成面板高级参数浮窗对齐设计稿 1743:31561

对照 Figma「Frame 76」(高级参数浮窗,深色稿)优化 `AdvancedPill` 面板与行内控件。展开 3 层子节点核对:

| 设计子节点 | 规格 | 现状 | 处理 |
|---|---|---|---|
| 容器 1743:31561 | 302px 宽 / rounded-20 / px-8 py-12 / 行距 4px | 300px / rounded-16 / p-8 | 改(仅高级面板,其余弹层沿用 popCls) |
| Layer item ×4 | 行高 40 / rounded-12 / pl-4 pr-12 / 标签-控件 gap-12 | min-h-36 / px-8 | 改 |
| 行标签 | 12px Medium / tracking -0.12 / text primary(ink) | 12px muted | 改 |
| switch 1743:31566 | 39×24 iOS 开关,active=品牌青 #1FD4CF(--color-teal),knob 白 20px | 36×20,active=--color-live 绿 | 改 |
| Seed 输入 1743:31574 | w-86 / rounded-8 / bg grey-800(→--color-fill) / border #494949(→--color-line) 实线 / px-12 py-8 / 文字 14 / 占位 auto muted | w-90 / 透明底 / border line-2 / 文字 13 | 改 |
| Last frame 按钮 1743:31582 | 同 Seed 输入但虚线边,gap-8 + plus 16px + 文字 14 muted | rounded-10 / px-2.5 / 文字 12 | 改(RefPicker 带 label 变体) |
| pencil 1743:31576/31585 | hidden=true | — | 设计稿隐藏,跳过 |

约束:toggle 激活色从 `--color-live` 改 `--color-teal`(符合「选中/高亮一律品牌青」的令牌规则);浮窗 `--color-pop` 底与 `--color-line` 描边沿用语义变量,不硬编码设计稿深色值。text 输入(voice 说明等)与 number 同步样式保持一致性。
