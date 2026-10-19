# 问答卡片重构（QuestionCard）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 Figma（`1099-25192` 默认 / `647-26220` 选中 / `647-26356` hover）重实现 AskUserQuestion 问答卡片：进度条 + 圆形箭头导航 + 序号选项行 + Custom answer 内联输入，点选即答、末题即提交。

**Architecture:** 只改 `QuestionCard.tsx` 这一个展示组件与其测试；协议、store、ChatPanel 挂载点全部不动（props 签名 `onSubmit(interactionId, answers)` 保持不变）。新增一个 `question` 图标资源并登记进 `figma.tsx`；六语文案补键。

**Tech Stack:** React 19 + Tailwind（CSS 变量令牌）+ react-i18next + Vitest/@testing-library。

**Spec:** `docs/superpowers/specs/2026-07-03-question-card-redesign-design.md`

## Global Constraints

- 颜色一律 CSS 变量令牌（`--color-*`），禁止字面色值；设计稿青色 primary 映射为 `--color-accent`。
- 图标一律 `FigIcon`（`src/components/ui/figma.tsx`），不直接 `<img>`；左箭头用 `chevronRight` + `flipX`。
- 按钮复用 `IconButton`，不新建按钮种类。
- 新增文案补齐六语（en/zh/fr/ru/ja/vi），en 为单一真相源。
- 动效复用既有类（`anim-media-in`），位移/缩放反馈加 `motion-safe:` 前缀。
- 注释/commit message 中文；测试与源码同目录。
- **交互裁定（含 spec 补充）**：单选点选即答并自动前进，末题点选即提交；多选点选仅切换，右箭头确认/提交；导航行渲染条件 = `questions.length > 1 || 当前题 multiSelect`，单问题时隐藏左箭头与「n of N」计数（只留进度条 + 右箭头）。

---

### Task 1: 图标资产整备 + spec 边角补充

**Files:**
- Create: `public/figma/icons/question.svg`
- Delete: `public/figma/icons/{4e0f59fe…,7fea659a…,92b11d37…,fc8017be…}.svg`（Figma 工具落盘的裸导出，问号字形已并入 question.svg，chevron/pencil 复用已有资源）
- Modify: `src/components/ui/figma.tsx`（登记 `question`，tone `primary`）
- Modify: `docs/superpowers/specs/2026-07-03-question-card-redesign-design.md`（补「单问题多选」裁定）

**Interfaces:**
- Produces: `figAsset.question`（Task 3 的问题行图标）。

- [ ] **Step 1: 创建 question.svg**

字形来自 Figma 导出 `4e0f59fe….svg`（viewBox 6.667×11.5），按仓库惯例重取景到 16×16 画布居中（对齐设计 inset：左右 29.17%、上 16.67%）：

```svg
<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<g transform="translate(4.6667 2.6667)">
<path d="M3.33333 0C1.49181 0 0 1.49181 0 3.33333C0 3.70152 0.298477 4 0.666667 4C1.03486 4 1.33333 3.70152 1.33333 3.33333C1.33333 2.22819 2.22819 1.33333 3.33333 1.33333C4.43848 1.33333 5.33333 2.22819 5.33333 3.33333C5.33333 3.87765 5.20095 4.19631 5.04139 4.41903C4.86693 4.66255 4.62486 4.84472 4.28898 5.07564L4.2122 5.12819C3.91411 5.33179 3.53019 5.59401 3.23286 5.95948C2.8816 6.39123 2.66667 6.93742 2.66667 7.66667V8C2.66667 8.36819 2.96514 8.66667 3.33333 8.66667C3.70152 8.66667 4 8.36819 4 8V7.66667C4 7.22925 4.1184 6.98377 4.26714 6.80093C4.43777 6.59121 4.66837 6.43273 5.00916 6.19855L5.04435 6.17436C5.37514 5.94694 5.79974 5.64995 6.12527 5.19555C6.46571 4.72035 6.66667 4.12235 6.66667 3.33333C6.66667 1.49181 5.17486 0 3.33333 0ZM3.33333 11.5C3.79357 11.5 4.16667 11.1269 4.16667 10.6667C4.16667 10.2064 3.79357 9.83333 3.33333 9.83333C2.8731 9.83333 2.5 10.2064 2.5 10.6667C2.5 11.1269 2.8731 11.5 3.33333 11.5Z" fill="#494949"/>
</g>
</svg>
```

- [ ] **Step 2: 删除 4 个裸导出文件**

```bash
rm public/figma/icons/4e0f59fe6670ac952f4e90619af582c152c00d2d.svg public/figma/icons/7fea659a4b0e6d4ba5cb2ff67f6f0d7c602bf7ce.svg public/figma/icons/92b11d37f1921817576c5db38fd83898bc4899d3.svg public/figma/icons/fc8017be8d9af9ed443ccccc0bce3eb1af9b41f9.svg
```

- [ ] **Step 3: 登记 figAsset.question**

`src/components/ui/figma.tsx` 的 `figAsset` 中 `close` 行后新增：

```ts
  // 问答卡片(AskUserQuestion)问题行前的问号
  question: `${F}/question.svg`,
```

`ICON_TONE` 表**不加**该项（缺省即 `primary`，随 currentColor 翻转，符合设计中问号与标题同色）。若该表缺省不是 primary（以 `resolveTone`/取值逻辑为准），则显式加 `[figAsset.question]: 'primary'`。

- [ ] **Step 4: spec 补充单问题多选裁定**

在 spec「交互语义」小节末尾追加一行：

```markdown
- **单问题且多选**：仍渲染导航行以承载确认动作，但隐藏左箭头与「n of N」计数，只留进度条 + 右箭头（= 提交）。
```

- [ ] **Step 5: 类型检查通过后提交**

```bash
pnpm exec tsc --noEmit
git add public/figma/icons src/components/ui/figma.tsx docs/superpowers/specs/2026-07-03-question-card-redesign-design.md
git commit -m "feat: 登记问答卡片 question 图标,清理 Figma 裸导出,spec 补单问题多选裁定"
```

---

### Task 2: 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts` 的 `chat.question` 段

**Interfaces:**
- Produces: `chat.question.count`（可见计数「1 of 3」）、`chat.question.custom`（Custom answer 行文案兼输入占位）；保留 `progress`（进度条 aria）、`back`/`next`/`submit`（箭头 aria-label）。

- [ ] **Step 1: 六个 locale 的 `question` 段改为**（保留原有键，新增 `count`/`custom`）：

```ts
// en.ts
question: {
  progress: 'Question {{cur}} of {{total}}',
  count: '{{cur}} of {{total}}',
  submit: 'Submit',
  back: 'Back',
  next: 'Next',
  custom: 'Custom answer',
},
// zh.ts
question: {
  progress: '第 {{cur}} 题,共 {{total}} 题',
  count: '{{cur}} / {{total}}',
  submit: '提交',
  back: '上一题',
  next: '下一题',
  custom: '自定义答案',
},
// fr.ts
question: {
  progress: 'Question {{cur}} sur {{total}}',
  count: '{{cur}} sur {{total}}',
  submit: 'Envoyer',
  back: 'Précédent',
  next: 'Suivant',
  custom: 'Réponse personnalisée',
},
// ru.ts
question: {
  progress: 'Вопрос {{cur}} из {{total}}',
  count: '{{cur}} из {{total}}',
  submit: 'Отправить',
  back: 'Назад',
  next: 'Далее',
  custom: 'Свой ответ',
},
// ja.ts
question: {
  progress: '質問 {{cur}} / {{total}}',
  count: '{{cur}} / {{total}}',
  submit: '送信',
  back: '前へ',
  next: '次へ',
  custom: 'カスタム回答',
},
// vi.ts
question: {
  progress: 'Câu hỏi {{cur}} trên {{total}}',
  count: '{{cur}} / {{total}}',
  submit: 'Gửi',
  back: 'Quay lại',
  next: 'Tiếp theo',
  custom: 'Câu trả lời tùy chỉnh',
},
```

注意：各 locale 原有的 `back`/`next` 若已存在译文（如 zh 原为「上一步/下一步”），按上表改为题目语义；其余键名勿动。

- [ ] **Step 2: 跑 i18n 相关测试确认键位一致**

```bash
pnpm exec vitest run src/i18n
```
Expected: PASS（若仓库有键位对齐测试则覆盖到；无则跳过不算失败）。

- [ ] **Step 3: 提交**

```bash
git add src/i18n/locales
git commit -m "feat: 问答卡片六语文案——count 计数与 custom 自定义答案"
```

---

### Task 3: 重写 QuestionCard（TDD）

**Files:**
- Modify: `src/components/chat/QuestionCard.tsx`（整体重写，props 签名不变）
- Test: `src/components/chat/QuestionCard.test.tsx`（整体重写）

**Interfaces:**
- Consumes: `figAsset.question`（Task 1）、`chat.question.count/custom` 文案（Task 2）、既有 `IconButton`/`FigIcon`。
- Produces: 默认导出 `QuestionCard({ interactionId, questions, onSubmit })`，与现签名完全一致（ChatPanel 零改动）。

- [ ] **Step 1: 重写测试（先写失败测试）**

`src/components/chat/QuestionCard.test.tsx` 全文替换：

```tsx
import { expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuestionCard from './QuestionCard';
import type { QuestionDef } from '@/koubou/protocol';

const single: QuestionDef[] = [
  { question: '美术风格?', header: '美术', options: [{ label: '像素风' }, { label: '手绘' }], multiSelect: false },
];

test('单问题单选:点选项即提交,且不渲染导航行', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i2" questions={single} onSubmit={onSubmit} />);
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /像素风/ }));
  expect(onSubmit).toHaveBeenCalledWith('i2', { '美术风格?': '像素风' });
});

test('渲染 header 与选项 description 与序号', () => {
  const qs: QuestionDef[] = [
    { question: '美术风格?', header: '美术', options: [{ label: '像素风', description: '复古 8-bit 颗粒感' }, { label: '手绘' }] },
  ];
  render(<QuestionCard interactionId="i4" questions={qs} onSubmit={vi.fn()} />);
  expect(screen.getByText('美术')).toBeInTheDocument();
  expect(screen.getByText('复古 8-bit 颗粒感')).toBeInTheDocument();
  expect(screen.getByText('1')).toBeInTheDocument(); // 选项序号方块
  expect(screen.getByText('2')).toBeInTheDocument();
});

test('单问题多选:点选只切换,右箭头门控并充当提交,无计数无左箭头', () => {
  const multi: QuestionDef[] = [
    { question: '支持平台?', options: [{ label: 'Web' }, { label: 'iOS' }, { label: 'Android' }], multiSelect: true },
  ];
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i3" questions={multi} onSubmit={onSubmit} />);
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.queryByText('1 of 1')).toBeNull();
  const confirm = screen.getByRole('button', { name: 'Submit' }); // 右箭头,末题 aria=Submit
  expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Web/ }));
  fireEvent.click(screen.getByRole('button', { name: /iOS/ }));
  fireEvent.click(screen.getByRole('button', { name: /Web/ })); // 再点取消
  expect(onSubmit).not.toHaveBeenCalled();
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  expect(onSubmit).toHaveBeenCalledWith('i3', { '支持平台?': ['iOS'] });
});

const twoQs: QuestionDef[] = [
  { question: '风格?', header: '风格', options: [{ label: 'A' }, { label: 'B' }] },
  { question: '难度?', header: '难度', options: [{ label: '简单' }] },
];

test('多问题:单选点选自动前进,末题点选即提交', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i6" questions={twoQs} onSubmit={onSubmit} />);
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /简单/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  // 自动前进到第二题
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /简单/ }));
  expect(onSubmit).toHaveBeenCalledWith('i6', { '风格?': 'A', '难度?': '简单' });
});

test('左箭头回退保留已选,首题禁用;右箭头未答禁用', () => {
  render(<QuestionCard interactionId="i7" questions={twoQs} onSubmit={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /A/ })).toHaveAttribute('aria-pressed', 'true');
  // 已答题,右箭头可用于前进
  expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});

test('进度条宽度随已答题数变化', () => {
  const { container } = render(<QuestionCard interactionId="i8" questions={twoQs} onSubmit={vi.fn()} />);
  const bar = container.querySelector('[data-testid="question-progress-fill"]') as HTMLElement;
  expect(bar.style.width).toBe('0%');
  fireEvent.click(screen.getByRole('button', { name: /A/ }));
  expect(bar.style.width).toBe('50%');
});

test('custom answer:点击展开输入,回车即答并提交(末题);Esc 收起', () => {
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i9" questions={single} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  const input = screen.getByPlaceholderText('Custom answer');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByPlaceholderText('Custom answer')).toBeNull(); // Esc 收起
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  fireEvent.change(screen.getByPlaceholderText('Custom answer'), { target: { value: ' 赛博朋克 ' } });
  fireEvent.keyDown(screen.getByPlaceholderText('Custom answer'), { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith('i9', { '美术风格?': '赛博朋克' }); // trim 后提交
});

test('custom answer 多选:回车并入数组,不提交,再点右箭头提交', () => {
  const multi: QuestionDef[] = [
    { question: '支持平台?', options: [{ label: 'Web' }], multiSelect: true },
  ];
  const onSubmit = vi.fn();
  render(<QuestionCard interactionId="i10" questions={multi} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: /Web/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Custom answer' }));
  fireEvent.change(screen.getByPlaceholderText('Custom answer'), { target: { value: 'Switch' } });
  fireEvent.keyDown(screen.getByPlaceholderText('Custom answer'), { key: 'Enter' });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(onSubmit).toHaveBeenCalledWith('i10', { '支持平台?': ['Web', 'Switch'] });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm exec vitest run src/components/chat/QuestionCard.test.tsx
```
Expected: FAIL（旧实现无自动前进/箭头/custom answer）。

- [ ] **Step 3: 重写组件**

`src/components/chat/QuestionCard.tsx` 全文替换：

```tsx
'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuestionDef } from '@/koubou/protocol';
import IconButton from '@/components/ui/IconButton';
import { FigIcon, figAsset } from '@/components/ui/figma';

// 选项行与 custom answer 行共用的外观(设计稿 Layer item:40px 高 12px 圆角)
// 选中态 = accent 描边(647-26220);hover = 填充(647-26356)
const rowClass = (active: boolean) =>
  `flex min-h-[40px] w-full items-center gap-3 rounded-[12px] border py-1 pl-1 pr-3 text-left motion-safe:transition-[border-color,background-color] motion-safe:duration-150 ${
    active ? 'border-[var(--color-accent)]' : 'border-transparent hover:bg-[var(--color-fill)]'
  }`;

export default function QuestionCard({ interactionId, questions, onSubmit }: {
  interactionId: string; questions: QuestionDef[];
  onSubmit: (interactionId: string, answers: Record<string, string | string[]>) => void;
}) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(0); // 多问题时:当前展示的问题下标
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  const multi = questions.length > 1;
  const last = page === questions.length - 1;
  const q = questions[page];
  const cur = sel[q.question] ?? [];
  const answeredCur = cur.length > 0;                 // 当前题已答:门控右箭头
  const answeredCount = questions.filter((x) => (sel[x.question] ?? []).length > 0).length;
  // 已提交的自定义答案 = 选中集里不属于任何选项 label 的值
  const customValue = cur.find((v) => !q.options.some((o) => o.label === v));
  // 导航行:多问题恒有;单问题仅多选需要(右箭头充当确认),纯单选点选即提交无需导航
  const showNav = multi || q.multiSelect;

  const closeCustom = () => { setCustomOpen(false); setCustomText(''); };

  // 单选点选即答即前进,setState 尚未落定,故提交/前进显式携带最新选择 map
  const submit = (map: Record<string, string[]>) => {
    const answers: Record<string, string | string[]> = {};
    for (const x of questions) {
      const v = map[x.question] ?? [];
      answers[x.question] = x.multiSelect ? v : (v[0] ?? '');
    }
    onSubmit(interactionId, answers);
  };
  const advance = (map: Record<string, string[]>) => {
    closeCustom();
    if (last) submit(map);
    else setPage((p) => p + 1);
  };
  const choose = (label: string) => {
    if (q.multiSelect) {
      // 多选:只切换选中态,确认交给右箭头
      setSel((prev) => {
        const v = prev[q.question] ?? [];
        return { ...prev, [q.question]: v.includes(label) ? v.filter((x) => x !== label) : [...v, label] };
      });
      return;
    }
    const map = { ...sel, [q.question]: [label] };
    setSel(map);
    advance(map);
  };
  const commitCustom = () => {
    const text = customText.trim();
    if (!text) return;
    const map = {
      ...sel,
      // 多选:替换旧自定义值后追加;单选:独占
      [q.question]: q.multiSelect ? [...cur.filter((v) => v !== customValue), text] : [text],
    };
    setSel(map);
    if (q.multiSelect) closeCustom();
    else advance(map);
  };

  return (
    <div className="anim-media-in flex flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-3">
      {showNav && (
        <div className="flex items-center gap-3">
          <div className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-[8px] bg-[var(--color-line)]" role="progressbar" aria-valuenow={answeredCount} aria-valuemax={questions.length} aria-label={t('chat.question.progress', { cur: page + 1, total: questions.length })}>
            <div data-testid="question-progress-fill" className="h-full rounded-[8px] bg-[var(--color-accent)] motion-safe:transition-[width] motion-safe:duration-150" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
          </div>
          {multi && (
            <IconButton variant="bordered" className="size-8 rounded-full" disabled={page === 0} aria-label={t('chat.question.back')} onClick={() => { closeCustom(); setPage((p) => p - 1); }}>
              <FigIcon src={figAsset.chevronRight} size={14} flipX />
            </IconButton>
          )}
          {multi && (
            <span className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
              {t('chat.question.count', { cur: page + 1, total: questions.length })}
            </span>
          )}
          <IconButton variant="raised" className="size-8 rounded-full" disabled={!answeredCur} aria-label={last ? t('chat.question.submit') : t('chat.question.next')} onClick={() => advance(sel)}>
            <FigIcon src={figAsset.chevronRight} size={14} />
          </IconButton>
        </div>
      )}

      {/* 一次只渲染当前问题;切页时 key 变化触发淡入 */}
      <div key={page} className="anim-media-in flex flex-col gap-4">
        <div>
          {q.header && <div className="mb-0.5 text-[12px] text-[var(--color-muted)]">{q.header}</div>}
          <div className="flex items-center gap-1">
            <FigIcon src={figAsset.question} size={16} />
            <p className="min-w-0 flex-1 text-[15px] font-bold leading-[1.5] text-[var(--color-ink)]">{q.question}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {q.options.map((o, i) => {
            const active = cur.includes(o.label);
            return (
              <button type="button" key={o.label} aria-pressed={active} onClick={() => choose(o.label)} className={rowClass(active)}>
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)] text-[12px] font-medium text-[var(--color-ink)]">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--color-ink)]">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-[12px] leading-[1.4] text-[var(--color-muted)]">{o.description}</span>}
                </span>
              </button>
            );
          })}

          {/* Custom answer:收起=可点行;展开=内联输入,回车确认(末题即提交)/Esc 收起 */}
          {customOpen ? (
            <div className={rowClass(true)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)]">
                <FigIcon src={figAsset.pencil} size={16} />
              </span>
              <input
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCustom(); }
                  else if (e.key === 'Escape') closeCustom();
                }}
                placeholder={t('chat.question.custom')}
                aria-label={t('chat.question.custom')}
                className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
              />
            </div>
          ) : (
            <button type="button" aria-pressed={!!customValue} aria-label={t('chat.question.custom')} onClick={() => { setCustomOpen(true); setCustomText(customValue ?? ''); }} className={rowClass(!!customValue)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)]">
                <FigIcon src={figAsset.pencil} size={16} />
              </span>
              <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${customValue ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}`}>
                {customValue ?? t('chat.question.custom')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

实现注意：
- `FigIcon` 的 `flipX` prop 若签名不同（以 `figma.tsx` 实际为准）按实际调整。
- `IconButton` `raised` 即 `.btn-raised` 恒浅色 CTA，与设计稿右箭头白色圆钮一致；禁用态走其自带 `disabled:opacity-30`。
- 测试里 `Custom answer` 行既有 aria-label 又有可见文本，`getByRole('button', { name: 'Custom answer' })` 可命中。

- [ ] **Step 4: 跑组件测试**

```bash
pnpm exec vitest run src/components/chat/QuestionCard.test.tsx
```
Expected: PASS（9 个用例全绿）。

- [ ] **Step 5: 全量验证**

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test
```
Expected: 全部通过（ChatPanel 等相邻测试不受影响，props 未变）。

- [ ] **Step 6: 提交**

```bash
git add src/components/chat/QuestionCard.tsx src/components/chat/QuestionCard.test.tsx
git commit -m "feat: 问答卡片重构——进度条箭头导航/点选即答/末题即提交/Custom answer 内联输入"
```

---

### Task 4: 运行态视觉核验

**Files:** 无代码改动（发现视觉偏差才回改 `QuestionCard.tsx`）

- [ ] **Step 1: 起 dev 或 prod 构建，渲染问答卡片两主题截图**

参考 memory 技巧：无后端时用 Playwright 挂 `window.__store` 注入含 `pendingInteractions`（AskUserQuestion）的完整态，或 mock `/api/pgc/**`；本地 dev 因字体被墙 500 时改跑 prod 构建。对照三张 Figma 截图核验：卡片圆角/进度条/箭头钮/序号方块/选中描边/hover 填充/custom 行，明暗两主题各截一张。

- [ ] **Step 2: 偏差回改并重跑 Task 3 Step 5 验证，追加提交**

```bash
git add -A && git commit -m "fix: 问答卡片视觉对齐设计稿细节修正"
```
（无偏差则跳过。）
