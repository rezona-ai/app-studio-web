# 生成弹窗可用模型列表数据源化改造 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用后端文档的真实可用模型替换生成弹窗写死的假占位，并把选中模型真正下发给后端（image/video 传 `model`、3d 传 `model_version`、audio 无）。

**Architecture:** 新增声明式数据模块 `gen-models.ts`（GEN_MODELS 列表 + MODEL_FIELD 映射 + `modelBody` 纯函数），与 `gen-params.ts` 同构；`GenerateForm.tsx` 改读该数据，模型 pill 按可选数量分三态（0=隐藏 / 1=静态标签 / >1=可选下拉），提交时合并模型字段，默认模型不下发。

**Tech Stack:** Next.js + React + Zustand + Tailwind + vitest（jsdom / @testing-library/react）。不引入新依赖。

**Spec:** `docs/superpowers/specs/2026-06-10-generate-form-models-design.md`

**约定：** 测试命令 `npx vitest run <file>`；类型检查 `npx tsc --noEmit`（关注本次改动文件零报错）；commit message 中文一句话。

---

### Task 1: gen-models 数据模块与 modelBody（TDD）

**Files:**
- Create: `src/components/canvas/gen-models.ts`
- Test: `src/components/canvas/gen-models.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/components/canvas/gen-models.test.ts`：

```ts
import { expect, test } from 'vitest';
import { GEN_MODELS, MODEL_FIELD, modelBody } from './gen-models';

// ---- modelBody 行为 ----
test('video 选 Fast(非默认) → 注入 model', () => {
  expect(modelBody('video', 'dreamina-seedance-2-0-fast-260128'))
    .toEqual({ model: 'dreamina-seedance-2-0-fast-260128' });
});

test('video 选标准档(默认) → 不下发', () => {
  expect(modelBody('video', 'dreamina-seedance-2-0-260128')).toEqual({});
});

test('image 选默认 gpt-image-2 → 不下发', () => {
  expect(modelBody('image', 'gpt-image-2')).toEqual({});
});

test('3d 选默认 v2.5 → 不下发', () => {
  expect(modelBody('3d', 'v2.5-20250123')).toEqual({});
});

test('3d 选非默认版本 → 注入 model_version', () => {
  expect(modelBody('3d', 'v9.9-x')).toEqual({ model_version: 'v9.9-x' });
});

test('audio 无模型参数 → 不下发', () => {
  expect(modelBody('audio', 'anything')).toEqual({});
});

test('modelValue 为 undefined → 不下发', () => {
  expect(modelBody('video', undefined)).toEqual({});
});

// ---- 数据完整性 ----
test('各类型字段映射与列表自洽', () => {
  expect(MODEL_FIELD).toEqual({ image: 'model', video: 'model', '3d': 'model_version', audio: null });
  // 有模型参数的类型必须恰有一个默认项;audio 列表为空
  for (const kind of ['image', 'video', '3d'] as const) {
    expect(GEN_MODELS[kind].filter((m) => m.isDefault)).toHaveLength(1);
  }
  expect(GEN_MODELS.audio).toEqual([]);
  // value 唯一
  for (const kind of ['image', 'video', '3d', 'audio'] as const) {
    const vals = GEN_MODELS[kind].map((m) => m.value);
    expect(new Set(vals).size).toBe(vals.length);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/canvas/gen-models.test.ts`
Expected: FAIL（Cannot find module './gen-models'）

- [ ] **Step 3: 实现 gen-models.ts**

```ts
import type { GenKind } from './gen-params';

export interface GenModel { value: string; label: string; isDefault?: boolean }

// 各类型 model 写入请求体的哪个字段(image/video=model,3d=model_version,audio 无模型参数)
export const MODEL_FIELD: Record<GenKind, 'model' | 'model_version' | null> = {
  image: 'model',
  video: 'model',
  '3d': 'model_version',
  audio: null,
};

// 仅收录后端文档标 ✅ 已验证的模型;⚪ 未实测本期不下发(gemini 图片系/seedance 另一渠道/Tripo v3.0·v2.0)
export const GEN_MODELS: Record<GenKind, GenModel[]> = {
  image: [{ value: 'gpt-image-2', label: 'GPT Image 2', isDefault: true }],
  video: [
    { value: 'dreamina-seedance-2-0-260128', label: 'Seedance 2.0', isDefault: true },
    { value: 'dreamina-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  ],
  '3d': [{ value: 'v2.5-20250123', label: 'Tripo v2.5', isDefault: true }],
  audio: [],
};

// 组装模型字段:选中非默认模型时返回 { [字段]: 值 };选中默认/无模型参数/未选 返回 {}
// (沿用「未设置不进 body」语义:默认模型让服务端自己定)
export function modelBody(kind: GenKind, modelValue: string | undefined): Record<string, unknown> {
  const field = MODEL_FIELD[kind];
  if (!field || !modelValue) return {};
  const def = GEN_MODELS[kind].find((m) => m.isDefault)?.value;
  if (modelValue === def) return {};
  return { [field]: modelValue };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run src/components/canvas/gen-models.test.ts`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/gen-models.ts src/components/canvas/gen-models.test.ts
git commit -m "feat: 新增生成模型数据模块与 modelBody 纯函数"
```

---

### Task 2: GenerateForm 接入真实模型列表

**Files:**
- Modify: `src/components/canvas/GenerateForm.tsx`
- Test: `src/components/canvas/GenerateForm.test.tsx`

- [ ] **Step 1: 追加失败测试**

在 `src/components/canvas/GenerateForm.test.tsx` 末尾（第 75 行 `})` 之后）追加以下 4 个用例：

```tsx
test('video:选 Fast 模型后提交,body 含 model', async () => {
  render(<GenerateForm kind="video" onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the video/), { target: { value: '运镜' } });
  fireEvent.click(screen.getByRole('button', { name: 'Model' }));
  fireEvent.click(screen.getByRole('button', { name: 'Seedance 2.0 Fast' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genVideo).toHaveBeenCalled());
  expect(genVideo).toHaveBeenCalledWith({ prompt: '运镜', model: 'dreamina-seedance-2-0-fast-260128' }, undefined);
});

test('video:默认标准档不下发 model', async () => {
  render(<GenerateForm kind="video" onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Describe the video/), { target: { value: '运镜' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
  await vi.waitFor(() => expect(genVideo).toHaveBeenCalled());
  expect(genVideo).toHaveBeenCalledWith({ prompt: '运镜' }, undefined);
});

test('image:模型为静态标签(无可点击的 Model 下拉,显示模型名)', () => {
  render(<GenerateForm kind="image" onClose={() => } />);
  expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
  expect(screen.getByText('GPT Image 2')).toBeInTheDocument();
});

test('audio:不渲染模型 pill', () => {
  render(<GenerateForm kind="audio" onClose={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Model' })).toBeNull();
  expect(screen.queryByText('GPT Image 2')).toBeNull();
  expect(screen.queryByText(/Seedance/)).toBeNull();
});
```

说明：模型下拉的触发按钮加 `aria-label="Model"`，使其无障碍名为 "Model"（不受展示的模型名影响），因此 `getByRole('button', { name: 'Seedance 2.0 Fast' })` 只会命中下拉里的选项、不会与触发按钮歧义。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: FAIL（当前模型 pill 渲染的是 GVLM 3.1 假占位、无 aria-label="Model"、model 不进 body）

- [ ] **Step 3: 改 import 与 MODELS**

删除 `src/components/canvas/GenerateForm.tsx` 第 17 行：

```ts
// 可选生成模型(占位:目前仅一项,后端暂不接收 model 参数,为多模型留接口)
const MODELS = [{ id: 'gvlm-3.1', name: 'GVLM 3.1' }] as const;
```

在第 14 行 `import RefPicker from './RefPicker';` 之后追加：

```ts
import { GEN_MODELS, modelBody } from './gen-models';
```

- [ ] **Step 4: 改 modelId state 与 model 派生**

把第 75–77 行：

```ts
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
```

替换为：

```ts
  const models = GEN_MODELS[kind];
  const [modelId, setModelId] = useState<string | undefined>(models[0]?.value);
  const [modelOpen, setModelOpen] = useState(false);
  const model = models.find((m) => m.value === modelId) ?? models[0];
```

- [ ] **Step 5: 提交时合并模型字段**

把第 115 行：

```ts
      const body = buildGenBody(kind, prompt, params, refSel);
```

替换为：

```ts
      // 合并模型字段:image/video→model,3d→model_version;默认模型不下发(modelBody 内判定)
      const body = { ...buildGenBody(kind, prompt, params, refSel), ...modelBody(kind, modelId) };
```

- [ ] **Step 6: 模型 pill 改三态渲染**

把第 172–207 行整段（从 `{/* 模型选择 pill + 下拉 */}` 到对应的 `</div>`）替换为：

```tsx
            {/* 模型:0 项(audio)不渲染;1 项静态标签;>1 项可选下拉 */}
            {models.length === 1 && (
              <div className="flex h-10 items-center gap-1 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-[10px] shadow-[inset_0_0_2px_0_#fff]">
                <span className={sphere} />
                <span className="text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{model?.label}</span>
              </div>
            )}
            {models.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Model"
                  onClick={() => setModelOpen((v) => !v)}
                  className="flex h-10 items-center gap-3 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-[10px] shadow-[inset_0_0_2px_0_#fff] transition hover:brightness-[0.98]"
                >
                  <span className="flex items-center gap-1">
                    <span className={sphere} />
                    <span className="text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{model?.label}</span>
                  </span>
                  <FigIcon src={figAsset.chevronDown} size={16} className="opacity-70" />
                </button>
                {modelOpen && (
                  <>
                    <div className="fixed inset-0 z-[55]" onClick={() => setModelOpen(false)} />
                    <div className="absolute bottom-[calc(100%+6px)] left-0 z-[56] flex min-w-[180px] flex-col rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
                      {models.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => {
                            setModelId(m.value);
                            setModelOpen(false);
                          }}
                          className={`flex h-9 items-center gap-2 rounded-[12px] px-2 text-left transition-colors hover:bg-[var(--color-fill)] ${m.value === modelId ? 'bg-[var(--color-fill)]' : ''}`}
                        >
                          <span className={sphere} />
                          <span className="flex-1 text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{m.label}</span>
                          {m.value === modelId && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
```

注意：`model` 现在类型为 `GenModel | undefined`（audio 空列表时为 undefined），故用 `model?.label`；但这两段 JSX 仅在 `models.length >= 1` 时渲染，运行时 `model` 必然有值。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run src/components/canvas/GenerateForm.test.tsx`
Expected: 9 passed（原 5 + 新 4）

- [ ] **Step 8: 类型检查 + 全量测试**

Run: `npx tsc --noEmit`
Expected: GenerateForm/gen-models 零报错

Run: `npm test`
Expected: 全部通过

- [ ] **Step 9: Commit**

```bash
git add src/components/canvas/GenerateForm.tsx src/components/canvas/GenerateForm.test.tsx
git commit -m "feat: 生成弹窗接入真实模型列表并下发 model 参数"
```

---

### Task 3: 全量验证与手动走查

**Files:** 无新增

- [ ] **Step 1: 全量自动验证**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: 测试全过；tsc 0 报错；lint 0 告警

- [ ] **Step 2: 手动走查（npm run dev）**

1. 打开 **video** 生成弹窗 → 模型 pill 可点击，下拉含「Seedance 2.0」「Seedance 2.0 Fast」，默认选中标准档
2. 选「Seedance 2.0 Fast」提交 → Network 里请求 body 含 `model: "dreamina-seedance-2-0-fast-260128"`；选回标准档提交 → body 不含 `model`
3. 打开 **image** 生成弹窗 → 模型显示为「GPT Image 2」静态标签，不可点击、无下拉箭头
4. 打开 **3d** 生成弹窗 → 模型显示为「Tripo v2.5」静态标签
5. 打开 **audio** 生成弹窗 → 无模型 pill（仅 Type 等参数 pill）

- [ ] **Step 3: 收尾**

手动走查有问题按 superpowers:systematic-debugging 处理后补提交；全过后按 superpowers:finishing-a-development-branch 决定合并方式。

---

## Self-Review 记录

- **Spec 覆盖**：数据模块 GEN_MODELS/MODEL_FIELD/modelBody（Task 1）、三态渲染（Task 2 Step 6）、提交合并模型字段+默认不下发（Task 2 Step 5 + modelBody）、仅 ✅ 模型（GEN_MODELS 内容）、测试范围（Task 1/2）、YAGNI（无联动/无 ⚪/无持久化，计划未引入）——均覆盖。
- **类型一致性**：`GenModel { value, label, isDefault? }`、`modelBody(kind, modelValue)`、`GEN_MODELS`/`MODEL_FIELD` 在 Task 1 定义，Task 2 引用一致；`modelId` 改为 `string | undefined` 与 `models[0]?.value` 吻合；`model?.label` 处理 audio 空列表。
- **占位符扫描**：无 TBD/TODO，所有代码完整给出。
- **回归风险**：image 现有提交测试期望 `{ prompt, quality }`——image 唯一模型即默认，`modelBody` 返回 `{}`，body 不变，不回归。
