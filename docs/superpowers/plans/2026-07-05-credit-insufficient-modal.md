# 积分不足模态提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 生成与对话两条链路命中「积分不足」时不再走 Toast/聊天气泡，改弹模态并提供「去充值」新标签跳转 `/studio/settings?section=recharge`。

**Architecture:** 源头分流——PGC 侧在 `guard`/`guardRethrow` 内用纯函数 `isCreditError` 识别后置 `creditModalOpen` 而不写 `lastError`；Koubou 侧在 `ingestKoubou` action 对未见过的 live `credit.insufficient` 帧置开关，并删除 reducer 里的气泡分支。UI 为挂在 Workspace 的 `CreditModal`，复用 DeleteAssetModal 的模态范式。

**Tech Stack:** Next.js 16 / React 19 / zustand / react-i18next / Vitest(jsdom)。

## Global Constraints

- 设计稿：`docs/superpowers/specs/2026-07-05-credit-insufficient-modal-design.md`。
- 注释 / commit message 一律中文；commit 一句话总结。
- 颜色/圆角/阴影只用 `globals.css` 令牌（`var(--color-*)` 等），禁止硬编码色值；模态复用 `.modal-backdrop` + `.modal-pop`，退场用 `useRequestClose`。
- i18n：en 为单一真相源，六语（en/zh/fr/ru/ja/vi）同步补齐。
- `creditModalOpen` 为瞬态，**不得**加入 persist 的 `partialize`。
- 充值页是主站外部路径，**不经** `apiPath()`。
- 每个任务收尾跑 `pnpm exec vitest run <相关文件>`，全部完成后跑 `pnpm exec tsc --noEmit`。

---

### Task 1: `isCreditError` 纯函数

**Files:**
- Create: `src/lib/credit-error.ts`
- Test: `src/lib/credit-error.test.ts`

**Interfaces:**
- Produces: `isCreditError(e: { code: string; failure?: { code: string } | null }): boolean` —— Task 2 的 guard 分流消费。

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/credit-error.test.ts
import { describe, expect, test } from 'vitest';
import { isCreditError } from './credit-error';

describe('isCreditError', () => {
  test('code 含 CREDIT/INSUFFICIENT(任意大小写)命中', () => {
    expect(isCreditError({ code: 'CREDIT_INSUFFICIENT' })).toBe(true);
    expect(isCreditError({ code: 'insufficient_credits' })).toBe(true);
    expect(isCreditError({ code: 'NoCredit' })).toBe(true);
  });
  test('failure.code 命中也算', () => {
    expect(isCreditError({ code: 'GEN_FAILED', failure: { code: 'credit_insufficient' } })).toBe(true);
  });
  test('普通错误码不命中', () => {
    expect(isCreditError({ code: 'INTERNAL' })).toBe(false);
    expect(isCreditError({ code: 'INPUT_MODERATION_REJECTED', failure: { code: 'content_policy' } })).toBe(false);
    expect(isCreditError({ code: 'FORBIDDEN', failure: null })).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/credit-error.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

```ts
// src/lib/credit-error.ts
// 后端未定稿积分不足错误码,按关键字模糊识别(code 或 failure.code 含 CREDIT/INSUFFICIENT,忽略大小写)。
// 命中者由 guard 分流到积分不足模态,不走 Toast(见设计稿 2026-07-05)。
const CREDIT_RE = /credit|insufficient/i;

export function isCreditError(e: { code: string; failure?: { code: string } | null }): boolean {
  return CREDIT_RE.test(e.code) || (e.failure != null && CREDIT_RE.test(e.failure.code));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/credit-error.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/credit-error.ts src/lib/credit-error.test.ts
git commit -m "feat: 积分不足错误的模糊识别纯函数 isCreditError"
```

---

### Task 2: store 开关 + PGC guard 分流

**Files:**
- Modify: `src/store/index.ts`（UIState 增字段 + action + 初始值）
- Modify: `src/store/actions.ts:26-51`（`guard` / `guardRethrow`）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isCreditError`。
- Produces: store 字段 `creditModalOpen: boolean` 与 action `setCreditModalOpen(open: boolean): void` —— Task 3/4 消费。同时 `Set` 类型可写 `creditModalOpen`（见 Step 3 注意点）。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 中「action 抛非 401 PgcError 时写 lastError 不抛出」（约 192 行）同一 describe 内追加（沿用该文件既有的 mock/工具函数写法，先阅读该用例照抄其触发方式）：

```ts
test('积分不足 PgcError → 开模态且不写 lastError', async () => {
  // 触发方式与「action 抛非 401 PgcError」用例相同,仅把 mock 错误换成:
  // new PgcError('CREDIT_INSUFFICIENT', 'no credits', 402)
  // 断言:
  expect(useStore.getState().creditModalOpen).toBe(true);
  expect(useStore.getState().lastError).toBeNull();
});

test('setCreditModalOpen(false) 关闭模态', () => {
  useStore.setState({ creditModalOpen: true });
  useStore.getState().setCreditModalOpen(false);
  expect(useStore.getState().creditModalOpen).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: FAIL（`creditModalOpen` 不存在 / 仍写 lastError）。

- [ ] **Step 3: 实现**

`src/store/index.ts`：
1. `interface UIState` 内追加（放 `libraryOpen` 附近）：

```ts
  // 积分不足模态打开态,瞬态不持久化(生成/对话两条链路命中积分不足时置位)
  creditModalOpen: boolean;
```

2. `interface Actions` 追加 `setCreditModalOpen: (open: boolean) => void;`
3. store 初始值处（与 `libraryOpen: false` 同一段）追加 `creditModalOpen: false,`；actions 实现处追加：

```ts
      setCreditModalOpen: (creditModalOpen) => set({ creditModalOpen }),
```

4. **不要**把该字段加进 persist `partialize`。

`src/store/actions.ts`：`guard` 与 `guardRethrow` 的 PgcError 分支各改为三路（401 → 积分 → 其余），并 import `isCreditError`：

```ts
import { isCreditError } from '@/lib/credit-error';

// guard 内:
    if (e instanceof PgcError) {
      // 401 = 未登录:只置 authRequired(见 useAuthGuard),不弹红色报错 Toast
      if (e.status === 401) set({ authRequired: true });
      // 积分不足:弹充值引导模态,不走 Toast(源头分流,见设计稿 2026-07-05)
      else if (isCreditError(e)) set({ creditModalOpen: true });
      else set({ lastError: { code: e.code, message: e.message } });
    } else throw e;
```

`guardRethrow` 同样插入 `else if (isCreditError(e)) set({ creditModalOpen: true });`（保持末尾 `throw e` 不变）。

注意：`actions.ts` 的 `type Set = (partial: Partial<StoreSlice>) => void` 中 `StoreSlice = KoubouState & ServerState` 不含 UI 字段。把 `creditModalOpen` 归入 `ServerState`（`src/store/types.ts` 的 `ServerState` 接口 + `createInitialServerState`/初始化对象中补 `creditModalOpen: false`）而非 UIState，即可让 guard 直接 `set`——语义上它也确实由服务端错误驱动。若 `types.ts` 中 ServerState 初始值在 `createInitialKoubouState` 同文件的初始化对象里（types.ts:138），在那里补字段；此时 `index.ts` 只需加 action，不需加初始值。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts src/lib/credit-error.test.ts`
Expected: PASS（含既有用例无回归）。

- [ ] **Step 5: 提交**

```bash
git add src/store/index.ts src/store/actions.ts src/store/types.ts src/store/actions.test.ts
git commit -m "feat: guard 识别积分不足错误改开模态,不再走 Toast"
```

---

### Task 3: Koubou 侧分流（ingestKoubou 置位 + 删气泡）

**Files:**
- Modify: `src/store/index.ts:144`（`ingestKoubou`）
- Modify: `src/koubou/apply-koubou.ts:70`（删 `credit.insufficient` 气泡分支）
- Modify: `src/i18n/errors.ts:17`、六语 locale（删 `creditInsufficient` 相关 dead key，Task 4 再加模态新 key）
- Test: `src/koubou/apply-koubou.test.ts:519-522`、`src/store/actions.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `creditModalOpen` 字段。
- Produces: 无新接口；行为契约「live `credit.insufficient` 帧且 sequence 未见过 → `creditModalOpen=true`，聊天无气泡」。

- [ ] **Step 1: 改测试（先红）**

`src/koubou/apply-koubou.test.ts` 519-522 行的用例改为断言不产气泡：

```ts
  test('credit.insufficient → 不产气泡(改由模态提示,见设计稿 2026-07-05)', () => {
    const s = applyKoubou(S(), ev({ type: 'credit.insufficient', sequence: 8, payload: { reason: 'mid_run' } }));
    expect(s.messages).toHaveLength(0);
  });
```

`src/store/actions.test.ts` 追加（用真实 store 的 `ingestKoubou`；`ServerEvent` 形状参照 apply-koubou.test 的 `ev()`）：

```ts
test('live credit.insufficient 帧 → 开模态;重放同 sequence 不二次触发', () => {
  const e = { type: 'credit.insufficient', session_id: 's1', sequence: 9, payload: {}, run_id: null } as ServerEvent;
  useStore.getState().ingestKoubou(e);
  expect(useStore.getState().creditModalOpen).toBe(true);
  useStore.getState().setCreditModalOpen(false);
  useStore.getState().ingestKoubou(e);   // 重连重放同一帧
  expect(useStore.getState().creditModalOpen).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/koubou/apply-koubou.test.ts src/store/actions.test.ts`
Expected: FAIL（旧行为产气泡；模态不置位）。

- [ ] **Step 3: 实现**

`src/koubou/apply-koubou.ts:70` 分支改为（保留事件被 seenSequences 登记的默认路径即可）：

```ts
    // credit.insufficient 不再产聊天气泡:由 store.ingestKoubou 分流到积分不足模态(见设计稿 2026-07-05)
    case 'credit.insufficient': return state;
```

`src/store/index.ts` 的 `ingestKoubou` 改为：

```ts
      // credit.insufficient 是 UI 级信号:仅对未见过的 live 帧弹积分模态(重连重放同 sequence 不二次弹);
      // 冷启动历史在 reducer 内部重放,不经过这里,天然不弹。
      ingestKoubou: (e) => set((s) => {
        const fresh = e.type === 'credit.insufficient'
          && (e.sequence == null || !s.seenSequences.includes(e.sequence));
        const next = applyKoubou(s, e);
        return fresh ? { ...next, creditModalOpen: true } : next;
      }),
```

（注意 `applyKoubou` 返回的是 KoubouState 切片，zustand `set` 做浅合并，展开后追加 `creditModalOpen` 即可。若 `credit.insufficient` 走 reducer 后 `seenSequences` 未登记该 sequence——检查 `applyKoubou` 入口的去重登记逻辑，它对所有带 sequence 的事件统一登记；若确实不登记，则在 `case 'credit.insufficient'` 返回前保持既有登记路径不变。）

i18n dead key 清理：删除 `src/i18n/errors.ts` 的 `CREDIT_INSUFFICIENT: 'errors.koubou.creditInsufficient',` 一行；删除六语 locale（en/zh/fr/ru/ja/vi 各自 `errors.koubou.creditInsufficient` 一行）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/koubou src/store src/i18n`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/koubou/apply-koubou.ts src/koubou/apply-koubou.test.ts src/store/index.ts src/store/actions.test.ts src/i18n
git commit -m "feat: 对话侧积分不足改弹模态,删除聊天气泡与 dead i18n key"
```

---

### Task 4: CreditModal 组件 + i18n + Workspace 挂载

**Files:**
- Create: `src/components/ui/CreditModal.tsx`
- Modify: `src/components/workspace/Workspace.tsx:122-125`（挂载）
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（新增 `creditModal` 命名空间）
- Test: `src/components/ui/CreditModal.test.tsx`

**Interfaces:**
- Consumes: `creditModalOpen` / `setCreditModalOpen`（Task 2）。
- Produces: 组件 `CreditModal`（无 props，自行订阅 store）。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/ui/CreditModal.test.tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '@/store';
import CreditModal from './CreditModal';

beforeEach(() => { useStore.setState({ creditModalOpen: true }); });

describe('CreditModal', () => {
  test('展示标题与说明', () => {
    render(<CreditModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Out of credits')).toBeInTheDocument();
  });
  test('取消关闭模态', () => {
    vi.useFakeTimers();
    render(<CreditModal />);
    fireEvent.click(screen.getByText('Cancel'));
    vi.advanceTimersByTime(250);   // useRequestClose 退场 200ms 后才真正关闭
    expect(useStore.getState().creditModalOpen).toBe(false);
    vi.useRealTimers();
  });
  test('去充值:新标签打开主站充值页并关闭', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<CreditModal />);
    fireEvent.click(screen.getByText('Recharge'));
    expect(open).toHaveBeenCalledWith(`${window.location.origin}/studio/settings?section=recharge`, '_blank');
    open.mockRestore();
  });
});
```

（若测试文件的 i18n 需初始化，参照 `src/components/canvas/DeleteAssetModal.test.tsx` 的既有做法照抄 setup。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/CreditModal.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现**

i18n：`src/i18n/locales/en.ts` 顶层追加：

```ts
  creditModal: {
    title: 'Out of credits',
    body: "You don't have enough credits to continue. Top up to keep creating.",
    recharge: 'Recharge',
  },
```

其余五语同结构（zh：`title: '积分不足'` / `body: '当前积分不足，无法继续生成。请前往充值后重试。'` / `recharge: '去充值'`；fr/ru/ja/vi 给对应译文，取消按钮复用 `common.cancel` 不新增 key）。

组件（范式照抄 `DeleteAssetModal.tsx`：backdrop z-40 + `.modal-pop` + `useRequestClose` + Esc 关闭）：

```tsx
// src/components/ui/CreditModal.tsx
'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import Button from '@/components/ui/Button';

// 积分不足提醒模态:生成/对话链路命中积分不足时由 store.creditModalOpen 驱动弹出,
// 主 CTA 新标签打开主站充值页(外部路径,不经 apiPath)。范式同 DeleteAssetModal。
const RECHARGE_PATH = '/studio/settings?section=recharge';

export default function CreditModal() {
  const setOpen = useStore((s) => s.setCreditModalOpen);
  const { closing, requestClose } = useRequestClose(() => setOpen(false), 200);
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const recharge = () => {
    window.open(window.location.origin + RECHARGE_PATH, '_blank');
    requestClose();
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={t('creditModal.title')}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-4 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('creditModal.title')}</span>
        <span className="text-[13px] leading-5 text-[var(--color-muted)]">{t('creditModal.body')}</span>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={requestClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('common.cancel')}</button>
          <Button autoFocus onClick={recharge} className="h-10 px-4 text-[13px]">{t('creditModal.recharge')}</Button>
        </div>
      </div>
    </div>
  );
}
```

Workspace 挂载（`src/components/workspace/Workspace.tsx`，与其他模态并排）：

```tsx
import CreditModal from '@/components/ui/CreditModal';
// 组件内订阅:
const creditModalOpen = useStore((s) => s.creditModalOpen);
// 122-125 行模态区追加:
{creditModalOpen && <CreditModal />}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/CreditModal.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS / 无类型错误。

- [ ] **Step 5: 全量校验并提交**

Run: `pnpm test && pnpm lint`
Expected: 全绿。

```bash
git add src/components/ui/CreditModal.tsx src/components/ui/CreditModal.test.tsx src/components/workspace/Workspace.tsx src/i18n
git commit -m "feat: 积分不足模态组件与六语文案,挂载 Workspace"
```
