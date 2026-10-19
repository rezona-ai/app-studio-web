# 资产生成高级参数面板重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把生成弹窗「高级参数面板」里的 select 字段改为竖向等分 segmented control（含显式 Default 段），并给齿轮加状态点，提升可读性与可发现性。

**Architecture:** 新增通用 UI 原语 `Segmented`（受控、纯展示，与 `Select` 同层）；`AdvancedPill` 内 select 字段改用 `Segmented` 竖排渲染（label 上 + 占满宽分段），其余控件类型维持单行；齿轮在已设可见高级参数时叠绿色小圆点。不动 schema / `buildGenBody` / 后端契约。

**Tech Stack:** Next 16 + React 19 + TypeScript + Tailwind（CSS 变量主题）；Vitest + jsdom + @testing-library/react。

## Global Constraints

- 注释 / commit message 一律用**中文**；注释解释「为什么」。
- 测试与源码**同目录**（`*.test.tsx`）；`@` → `src` 别名；用 `vitest` globals 风格（`describe/it/expect`），从 `vitest` 显式 import `vi`。
- **不改不变式**：只下发用户设置过的字段，`undefined` 不下发（沿用服务端默认）；不动 `GEN_FIELDS` schema、`buildGenBody`、后端契约；不引入推测性别名；保持 snake_case key。
- 颜色/阴影一律用现有 CSS 变量（`--color-ink/muted/fill/surface/live`、`--shadow-pill`），不写死色值。
- 选中态须在**浅色 / 深色两套主题**下都明确可辨：采用 `bg-[var(--color-ink)] + text-[var(--color-surface)]` 强对比方案（该深色调色板里「更抬起」的中性面反而更暗，iOS 式「更浅 thumb」不通用，故用主题稳定的 ink 反色填充）。

---

### Task 1: 通用分段控件 `Segmented`

**Files:**
- Create: `src/components/ui/Segmented.tsx`
- Test: `src/components/ui/Segmented.test.tsx`

**Interfaces:**
- Consumes: 无（仅 React）。
- Produces: `Segmented` 默认导出，props 签名：
  ```ts
  export default function Segmented(props: {
    value: string | undefined;
    options: { value: string; label: string }[];
    onChange: (value: string | undefined) => void;
    withDefault?: boolean;      // 首段为 Default 段,选中回传 undefined
    defaultLabel?: string;      // 默认 'Default'
    ariaLabel?: string;
  }): JSX.Element
  ```
  并导出 `export type SegmentedOption = { value: string; label: string }`。

- [ ] **Step 1: 写失败测试**

`src/components/ui/Segmented.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Segmented from './Segmented';

const opts = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

describe('Segmented', () => {
  it('渲染全部选项;withDefault 时含 Default 段', () => {
    render(<Segmented value={undefined} options={opts} onChange={() => {}} withDefault ariaLabel="Format" />);
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeInTheDocument();
  });

  it('点选项段回传该 value', () => {
    const onChange = vi.fn();
    render(<Segmented value={undefined} options={opts} onChange={onChange} withDefault />);
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    expect(onChange).toHaveBeenCalledWith('jpeg');
  });

  it('点 Default 段回传 undefined', () => {
    const onChange = vi.fn();
    render(<Segmented value="png" options={opts} onChange={onChange} withDefault />);
    fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('value 命中段 → 该段 aria-checked;value=undefined → Default 段选中', () => {
    const { rerender } = render(<Segmented value="png" options={opts} onChange={() => {}} withDefault />);
    expect(screen.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'false');
    rerender(<Segmented value={undefined} options={opts} onChange={() => {}} withDefault />);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/ui/Segmented.test.tsx`
Expected: FAIL（`Cannot find module './Segmented'` 或解析错误）。

- [ ] **Step 3: 写最小实现**

`src/components/ui/Segmented.tsx`:

```tsx
'use client';

export type SegmentedOption = { value: string; label: string };

// 等分分段控件:一条圆角 track 内 N 段平分。受控、纯展示。
// withDefault:首段为「Default」段,选中即回传 undefined(语义=未设置,沿用服务端默认),
//   把高级面板「再点一次清空」这一隐藏交互显式化。
// 选中段用 ink 反色实心填充:此深色调色板里「更抬起」的中性面反而更暗,iOS 式更浅 thumb
//   不通用,故用主题稳定的强对比,修掉描边 chip 在深色下像被禁用的老问题。
export default function Segmented({
  value,
  options,
  onChange,
  withDefault = false,
  defaultLabel = 'Default',
  ariaLabel,
}: {
  value: string | undefined;
  options: SegmentedOption[];
  onChange: (value: string | undefined) => void;
  withDefault?: boolean;
  defaultLabel?: string;
  ariaLabel?: string;
}) {
  // Default 段用哨兵 key 与真实 option.value 区分(真实值里可能恰好有 'auto' 等)
  const segments: { key: string; label: string; val: string | undefined }[] = [
    ...(withDefault ? [{ key: '__default__', label: defaultLabel, val: undefined }] : []),
    ...options.map((o) => ({ key: o.value, label: o.label, val: o.value as string | undefined })),
  ];
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full gap-0.5 rounded-[10px] bg-[var(--color-fill)] p-0.5">
      {segments.map((s) => {
        const active = s.val === value; // undefined===undefined → Default 段选中;否则值匹配
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active || undefined}
            onClick={() => onChange(s.val)}
            className={`min-w-0 flex-1 truncate rounded-[8px] px-1.5 py-1 text-center text-[12px] transition-colors ${
              active
                ? 'bg-[var(--color-ink)] font-medium text-[var(--color-surface)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/ui/Segmented.test.tsx`
Expected: PASS（4 个用例全过）。

- [ ] **Step 5: 提交**

```bash
git add src/components/ui/Segmented.tsx src/components/ui/Segmented.test.tsx
git commit -m "feat: 新增通用等分分段控件 Segmented(含 Default 段)"
```

---

### Task 2: 高级面板改用 Segmented 竖排 + 齿轮状态点

**Files:**
- Modify: `src/components/canvas/GenParamControls.tsx`（`AdvancedPill`，约 184-231 行）
- Test: `src/components/canvas/GenParamControls.test.tsx`（新建）

**Interfaces:**
- Consumes: `Segmented`（Task 1，默认导出，props 见上）。
- Produces: 无对外签名变化（`AdvancedPill` 的 props 不变：`{ fields, params, refs, onChange, extra }`）。

- [ ] **Step 1: 写失败测试**

`src/components/canvas/GenParamControls.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdvancedPill } from './GenParamControls';
import { GEN_FIELDS } from './gen-params';

// image 高级字段含 background(select) / output_format(select) / output_compression(jpeg 才显)
//  / input_fidelity(有引用才显);refs={} 时只有 background、output_format 可见
const fields = GEN_FIELDS.image;

describe('AdvancedPill', () => {
  it('select 字段以 segmented 竖排呈现,点某段回传 key/value', () => {
    const onChange = vi.fn();
    render(<AdvancedPill fields={fields} params={{}} refs={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
    const group = screen.getByRole('radiogroup', { name: 'Background' });
    fireEvent.click(within(group).getByRole('radio', { name: 'transparent' }));
    expect(onChange).toHaveBeenCalledWith('background', 'transparent');
  });

  it('点 Default 段把该字段清成 undefined', () => {
    const onChange = vi.fn();
    render(<AdvancedPill fields={fields} params={{ background: 'transparent' }} refs={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
    const group = screen.getByRole('radiogroup', { name: 'Background' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Default' }));
    expect(onChange).toHaveBeenCalledWith('background', undefined);
  });

  it('已设置 ≥1 个可见高级参数时齿轮显示状态点', () => {
    const { container, rerender } = render(<AdvancedPill fields={fields} params={{}} refs={{}} onChange={() => {}} />);
    expect(container.querySelector('[data-adv-dot]')).toBeNull();
    rerender(<AdvancedPill fields={fields} params={{ background: 'opaque' }} refs={{}} onChange={() => {}} />);
    expect(container.querySelector('[data-adv-dot]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/GenParamControls.test.tsx`
Expected: FAIL（找不到 `radiogroup` / `data-adv-dot`——当前是描边 chip、齿轮无状态点）。

- [ ] **Step 3: 改实现 —— 引入 Segmented**

在 `src/components/canvas/GenParamControls.tsx` 顶部 import 区加一行（紧随其它组件 import）：

```tsx
import Segmented from '@/components/ui/Segmented';
```

- [ ] **Step 4: 改实现 —— 重写 `AdvancedPill` 的触发钮与面板**

把 `AdvancedPill` 函数体（`return` 部分，含触发按钮与 `visible.map` 渲染块）整体替换为：

```tsx
  const setCount = visible.filter((f) => params[f.key] !== undefined).length;
  return (
    <div className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`${pillCls} relative`} aria-label="Advanced settings">
        <SlidersHorizontal size={14} className="opacity-70" />
        {/* 已设可见高级参数时点亮状态点,弥补齿轮无值预览的可发现性 */}
        {setCount > 0 && <span data-adv-dot className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--color-live)]" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setOpen(false)} />
          {/* 高级面板在行尾,右对齐锚定避免超出弹窗右缘;竖排 select 需固定宽以稳定分段等分 */}
          <div className={`${popCls} left-auto right-0 w-[300px]`}>
            {visible.map((f) => {
              const c = f.control;
              // select:label 单独一行 + 占满宽 segmented(含 Default 段)
              if (c.type === 'select') {
                return (
                  <div key={f.key} className="flex flex-col gap-1.5 px-2 py-1.5">
                    <span className="text-[13px] text-[var(--color-ink)]">{f.label}</span>
                    <Segmented
                      value={params[f.key] as string | undefined}
                      options={c.options}
                      onChange={(v) => onChange(f.key, v)}
                      withDefault
                      ariaLabel={f.label}
                    />
                  </div>
                );
              }
              // 其余控件(toggle/slider/number/text):维持 label 左·控件右 单行
              return (
                <div key={f.key} className="flex min-h-9 items-center justify-between gap-3 px-2">
                  <span className="shrink-0 text-[12px] text-[var(--color-muted)]">{f.label}</span>
                  <FieldEditor field={f} params={params} onChange={onChange} />
                </div>
              );
            })}
            {extra}
          </div>
        </>
      )}
    </div>
  );
```

（`useEscClose`、`visible`、`if (visible.length === 0 && !extra) return null;` 等其余部分保持不变。）

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/GenParamControls.test.tsx`
Expected: PASS（3 个用例全过）。

- [ ] **Step 6: 回归 —— 类型检查与既有相关测试**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx src/components/ui/Segmented.test.tsx`
Expected: tsc 无错误；GenerateForm（含「Advanced settings 按钮存在」断言）与 Segmented 全过。

- [ ] **Step 7: 提交**

```bash
git add src/components/canvas/GenParamControls.tsx src/components/canvas/GenParamControls.test.tsx
git commit -m "feat: 高级参数面板 select 改竖向分段控件,齿轮加状态点"
```

---

## Self-Review

**Spec coverage（逐条对照设计稿）：**
- 目标 1（select → 竖向 segmented，label 上 + 占满宽、不换行、选中实心、对比清晰）→ Task 2 Step 4 select 分支 + Task 1 实现。✅
- 目标 2（显式 Default 段）→ Task 1 `withDefault`，Task 2 传 `withDefault`。✅
- 目标 3（抽出可复用 `Segmented`，与 `Select` 同层、可单测）→ Task 1。✅
- 目标 4（齿轮状态点）→ Task 2 Step 4 `setCount` + `data-adv-dot`。✅
- 非目标 / 不变式（不动 schema/buildGenBody/后端契约；`undefined` 不下发；`visibleWhen` 仍在 `visible` 过滤生效；snake_case）→ 仅改渲染层，`onChange(f.key, undefined)` 经既有 `buildGenBody` 的 `v===undefined` 跳过；`visible` 过滤未改。✅
- 测试（`Segmented.test.tsx` + 高级面板用例）→ Task 1、Task 2 测试。✅

**Placeholder scan:** 无 TBD/TODO/「类似上文」；所有代码步骤含完整代码与确切命令。✅

**Type consistency:** Task 1 导出 `Segmented(value, options, onChange, withDefault, defaultLabel, ariaLabel)`，Task 2 调用处参数名与类型一致；`onChange:(string|undefined)=>void` 与 `(v)=>onChange(f.key, v)`（`OnChange` 接受 `string|number|boolean|undefined`）兼容；`value={params[f.key] as string | undefined}` 与 select 字段实为字符串值一致。✅
