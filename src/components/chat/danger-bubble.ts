// danger 气泡(错误气泡 / 重试进度气泡)共用的视觉常量。
//
// 单独成文件而不是挂在 ErrorDetail 上:那个文件的职责是「上游报错原文折叠」,
// 样式常量寄居在那里会让 MessageItem 为了拿一个 class 去 import 一个不相干的组件模块。

// 气泡右上角的行内动作(手动重试 / 停止重试)。红气泡里不该出现中性灰底,也不该用下划线
// 把它拗成链接 —— 常态是同色 ghost,hover 才浮起一层同色红。
// **不压透明度**:12px 的可交互文字压到 0.8 后连 3:1 都不到,层级要靠底色而不是把字调淡。
// 布局类(ml-auto / shrink-0)留在这里:两处调用方都要,抽出去反而两边各写一份。
export const DANGER_ACTION_CLS =
  'ml-auto shrink-0 rounded-[6px] border border-transparent px-2 py-[2px] text-[12px] font-medium '
  + 'text-[var(--color-danger)] transition-[background-color,border-color] '
  + 'hover:border-[var(--color-danger-soft)] hover:bg-[var(--color-danger-fill)] '
  + 'motion-safe:active:scale-[0.96]';

// 动作栏里的**首选**动作(Switch model):实底 danger + 白字,与 ghost 红字的 Try again 拉开层级 ——
// 一条动作栏里两个红字按钮分不清谁是推荐路径(Nick 2026-09-03 两轮排版反馈:半透明红底上仍是红字,
// 与旁边的 ghost 红字对比度不够)。白字用 --color-on-primary-strong(恒白,与品牌键帽同一令牌)
export const DANGER_ACTION_PRIMARY_CLS =
  'shrink-0 rounded-[6px] bg-[var(--color-danger)] px-2.5 py-[3px] '
  + 'text-[12px] font-semibold text-[var(--color-on-primary-strong)] transition-[filter] '
  + 'hover:brightness-110 motion-safe:active:scale-[0.96]';

// 气泡内的图标按钮(复制原文):与行内动作同一套 hover 面,别让它成为气泡里唯一没有反馈的控件
export const DANGER_ICON_BTN_CLS =
  'grid size-6 shrink-0 place-items-center rounded-[6px] text-[var(--color-danger)] '
  + 'transition-colors hover:bg-[var(--color-danger-fill)] motion-safe:active:scale-[0.92]';

// 气泡首行的前导标记(重试气泡的 spinner;错误气泡已不带圆点,见 AgentErrorBubble)的外盒。
// **不拿 mt 手调,也不靠 flex 居中**:首行里还有个行内动作按钮(12px 字 + py + 边框 = 26px),
// 比 20px 的文字行盒高,`items-center` 会把文字往下推 3px 而标记仍贴行顶 —— 手调偏移既跟不上
// 字号也跟不上按钮尺寸。改成让首行基线对齐(DANGER_ROW_CLS),标记本体用 align-middle 挂在
// 文字基线上(= 基线 - x-height/2,正好是字形的光学中心),两者都由字体度量派生。
export const DANGER_LEAD_CLS = 'shrink-0 leading-5';

// 气泡首行:文字与行内动作按钮基线对齐(而非盒子居中),前导标记才能跟首行文字对齐
export const DANGER_ROW_CLS = 'flex items-baseline gap-2';
