# 资产生成高级参数面板重设计 Design

## 背景

画布资产生成弹窗（`GenerateForm`）底部有一颗「齿轮」按钮（`AdvancedPill`，`src/components/canvas/GenParamControls.tsx`），展开后是「高级参数」面板，承载各资产类型的进阶参数（如 image 的 Background / Format / Compression / Fidelity，audio 的 Smart expand / Speed，3d 的一堆 toggle / seed 等）。

当前面板渲染缺乏有效设计，体验差。具体问题（以 image 的 Background / Format 为例）：

1. **布局错乱**：`select` 字段用「label 左 · 选项右 + `flex-wrap justify-end`」。长选项（如 `transparent`）一换行就把 `opaque` 挤到第二行，label 与多行选项垂直居中对不齐，整体凌乱。
2. **选中态太弱**：选项是「描边 + muted 灰字」的 chip，深色主题下像被禁用，看不出哪个可选、哪个选中。
3. **「清空回默认」不可见**：再点一次当前选中段会把值清成 `undefined`（回退服务端默认），但界面无任何提示，用户根本无从发现。（对比：底部常用 pill 的列表弹层 `ParamPill` 反而有显式 "Default" 行。）
4. **控件语言不统一**：底部 pill 弹层用「列表行 + 绿点」表达 select 选择，高级面板用「描边 chip」，两套渲染。

## 目标

1. 把高级面板内的 `select` 字段改为**竖向等分 segmented control**：label 单独一行，下方占满宽的等分分段，永不换行、选中态实心、对比清晰。
2. 给每个 select 一个**显式「Default」段**，把「清空回服务端默认」从隐藏交互变成可见可点的一段。
3. 抽出可复用 UI 原语 `Segmented`，与 `Select` 同层、可单测。
4. 齿轮触发钮在「已设置 ≥1 个可见高级参数」时显示一个状态小圆点。

## 非目标 / 范围边界

- **只改** `AdvancedPill` 高级面板的内部渲染与新增 `Segmented` 组件。
- **不动**：底部常用 pill（`ParamPill` 及其列表弹层）、`FieldEditor` 在 pill 场景的渲染、参数 schema（`GEN_FIELDS`）、`buildGenBody`、后端契约。
- **不改不变式**：仍「只下发用户设置过且当前可见的字段；`undefined` 不下发，沿用服务端默认」；仍尊重 `visibleWhen`（如 Compression 仅 jpeg 可见）；仍用 snake_case key。

## 设计

### 新组件 `src/components/ui/Segmented.tsx`

与 `Select.tsx` 同层的通用 UI 原语，单一职责、纯展示（受控）。

Props：

```ts
{
  value: string | undefined;                 // 当前值;undefined 表示「未设置」
  options: { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
  withDefault?: boolean;                      // 开启时首段为「Default」段(选中即回传 undefined)
  defaultLabel?: string;                      // 默认 'Default'
  ariaLabel?: string;
}
```

渲染：

- 一条圆角 track（`rounded-[10px]`，`bg-[var(--color-fill)]`），内部 `N` 段等分（`flex`，每段 `flex-1`，文字 `text-[12px]` 居中、`truncate`）。`withDefault` 开启时，首段为 Default 段，其 `value` 概念上是 `undefined`。
- **选中段** = 抬起的实心 thumb：`bg`（浅/深各自比 track 更「亮/抬起」的色，加 `shadow-[var(--shadow-pill)]` 内高光）+ `text-[var(--color-ink)]`、`font-medium`。
- **未选中段**：`text-[var(--color-muted)]`，hover → `text-[var(--color-ink)]`。
- 选中判定：`withDefault && value === undefined` → Default 段选中；否则匹配 `value`。
- 点击行为：点某选项段 → `onChange(option.value)`；点 Default 段 → `onChange(undefined)`。

> thumb 的实际填充色在浅色 / 深色两套主题里都目测验证一遍再定（深色下 `--color-surface` 比 `--color-fill` 暗，不能想当然套「更浅」；以「能明显看出抬起的选中段」为准，必要时退回 `bg-[var(--color-ink)] + text-[var(--color-surface)]` 的强对比方案）。

### 高级面板 `AdvancedPill` 改造

面板内每个可见字段竖向堆叠，按 `control.type` 分两种行型：

- **`select`**（含运行时注入选项的场景）→ 上：label（提升为 `text-[13px] text-[var(--color-ink)]`，不再 muted 小字）；下：`<Segmented withDefault ... />` 占满宽。
- **`toggle` / `slider` / `number` / `text`** → 维持「label 左 · 控件右」单行（复用现有 `FieldEditor`），统一行高 `min-h-9`、间距与 segmented 视觉密度对齐；label 仍用 muted 小字以与「需要一行的开关型」区分。

面板宽度从 `min-w-[280px]` 改为固定 `w-[300px]`，等分段宽稳定可算。仍右对齐锚定（`left-auto right-0`）避免超出弹窗右缘；竖排后高度增加，保留 `max-h` + 滚动。

`extra`（video 首尾帧的尾帧选择行）位置与行为不变。

### 数字输入（`number` 控件）去原生样式

`FieldEditor` 的 `number` 分支直接用原生 `<input type="number">`，浏览器自带的上下箭头 spinner 与重设计后的面板格格不入（高级面板里 video `seed`、3d `model_seed`/`texture_seed`/`image_seed` 均走此分支，pill 弹层的 `duration`/`face_limit` 亦共用）。

改为「干净输入框」：用 Tailwind v4 arbitrary variant 隐藏 webkit/firefox 的 spinner（`[-moz-appearance:textfield]` + `::-webkit-inner/outer-spin-button` 的 `appearance-none`），保留自由输入；聚焦时描边变 `--color-accent`。seed 类值一般手输/随机，`±1` nudge 无意义，故不做步进器。**行为不变**（输入→数值、清空→`undefined`、min/max 夹取均沿用），属纯样式改动。

### 齿轮触发钮状态点

`AdvancedPill` 计算「当前可见且已被用户设置」的字段数 `setCount`（用现有 `visible` 列表过滤 `params[f.key] !== undefined`）。`setCount > 0` 时，在齿轮按钮右上角叠一个小圆点（`bg-[var(--color-live)]`，与代码里既有「小圆点表状态」语言一致）。仅圆点，不放数字。

### Pill 弹层控件优化（Count 分段 / number 宽度贴合）

底部常用 pill（`ParamPill`）展开的弹层有两处易用性问题：

1. **Count（image `n`，stepper 1-4）**：`−[N]＋` 用 `rowCls`（大列表行）+ `justify-between`，在 `popCls` 的 `min-w-[200px]` 里被撑得很散，三个按钮像三条大行。
2. **Face limit（3d `face_limit`，number）/ Duration（audio `duration`）**：90px 的 number 输入泡在 `min-w-[200px]` 的弹层里，容器空旷过宽。

根因之一是 `popCls` 给**所有** pill 弹层硬加了 `min-w-[200px]`（select 列表需要，stepper/number 不需要）。改法：

- **`popCls` 去掉 `min-w-[200px]`**；`ParamPill` 按 `field.control.type` 给弹层宽度：
  - `select` → `min-w-[200px]`（列表需要宽度）；
  - `stepper` → `w-[176px]`（分段 / 紧凑步进器的舒适宽）；
  - 其余（`number` 等）→ `w-auto`，贴合内容（修掉 Face limit / Duration 空旷）。
- **小范围 stepper（`max-min ≤ 4`）→ Segmented**：`FieldEditor` 的 stepper 分支在小范围时平铺为 `Segmented`（如 Count 的 `1 2 3 4`），一点即选；无 Default 段（计数恒有值，默认值即首段选中）。选中即 `onChange(key, Number(段值))`。
- **大范围 stepper（`max-min > 4`）→ 紧凑步进器**：`−[N]＋` 改为小方块按钮 + 居中数字，到边界（`cur<=min` / `cur>=max`）对应按钮 `disabled` 置灰。受益：video `seconds`(1-30)、audio `quality_preset`(1-10)。

`AdvancedPill` 仍以 `${popCls} ... w-[300px]` 显式定宽，不受 `popCls` 去 `min-w` 影响。`buildGenBody`、schema、后端契约不变。

## 数据流与不变式

- `Segmented.onChange(undefined)` → `setParam(key, undefined)`，与「点 Default 行」效果一致；`buildGenBody` 内 `v === undefined` 即跳过，不下发。**无需改 `buildGenBody`**。
- `visibleWhen` 仍在 `AdvancedPill` 的 `visible` 过滤里生效（如选 jpeg 后 Compression 行出现 / 选 png 后消失）。
- 不引入新的后端字段或别名，不动 schema。

## 测试（TDD，同目录 `*.test.tsx`）

新增 `src/components/ui/Segmented.test.tsx`：

1. 渲染全部选项 label；`withDefault` 时含 "Default" 段。
2. 点选项段 → `onChange` 收到该 `value`。
3. 点 Default 段 → `onChange(undefined)`。
4. `value` 命中某段 / `value===undefined` 命中 Default 段时，选中段带选中态标记（如 `aria-checked` 或可断言的 class/data 属性——实现时给选中段加 `data-active` 便于断言）。

在 `GenerateForm.test.tsx` 或新增 `GenParamControls.test.tsx` 补一条高级面板用例：

5. 展开高级面板 → 某 `select`（如 image Background）以 segmented 呈现 → 点某段 → 该 key 进入将提交的 body；点 Default → 该 key 从 body 移除（`undefined`）。

## 实现要点小结

- 新文件：`src/components/ui/Segmented.tsx`、`src/components/ui/Segmented.test.tsx`。
- 改文件：`src/components/canvas/GenParamControls.tsx`（`AdvancedPill` 的 select 行改用 `Segmented`、宽度与 label 样式、齿轮状态点）。
- 注释用中文，解释「为什么」（如 Default 段语义、thumb 配色在两主题下的取舍）。
