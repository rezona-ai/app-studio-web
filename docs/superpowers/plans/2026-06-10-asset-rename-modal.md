# 资产重命名弹窗 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用独立弹窗组件替换资产右键菜单 Rename 项的浏览器原生 `prompt()`,视觉与 CreateGameModal 一致。

**Architecture:** 弹窗开关状态(`renameTarget`)放在 zustand store,与现有 `contextMenu` 模式一致;ContextMenu 触发 `openRenameModal`,新组件 `RenameAssetModal` 挂在 Workspace,订阅 store 渲染。重命名为纯本地 store 变更,复用现有 `renameAsset` action。

**Tech Stack:** React 19 / Next 16 / zustand 5 / Tailwind v4 / vitest + @testing-library/react

参考 spec:`docs/superpowers/specs/2026-06-10-asset-rename-modal-design.md`

---

## 文件结构

- 修改:`src/store/index.ts` — 新增 `renameTarget` 状态 + `openRenameModal`/`closeRenameModal` action
- 创建:`src/components/canvas/RenameAssetModal.tsx` — 重命名弹窗组件
- 创建:`src/components/canvas/RenameAssetModal.test.tsx` — 弹窗测试
- 修改:`src/components/canvas/ContextMenu.tsx` — Rename 项改为触发 `openRenameModal`,移除 `prompt()` 与 TODO
- 修改:`src/components/workspace/Workspace.tsx` — 条件挂载 `RenameAssetModal`

---

### Task 1: store 新增 renameTarget 状态与 action

**Files:**
- Modify: `src/store/index.ts:23-34`(UIState 接口)、`:45`(Actions 接口)、`:79`(初始值)、`:131`(action 实现)

- [ ] **Step 1: 在 UIState 接口新增字段**

`src/store/index.ts` 的 `interface UIState` 中,`contextMenu` 行下方新增:

```ts
  renameTarget: { id: string } | null;
```

- [ ] **Step 2: 在 Actions 接口新增 action 声明**

`interface Actions` 中,`openContextMenu` 行下方新增:

```ts
  openRenameModal: (id: string) => void;
  closeRenameModal: () => void;
```

- [ ] **Step 3: 在初始状态新增字段**

`create` 的初始对象中,`contextMenu: null,` 行下方新增:

```ts
      renameTarget: null,
```

- [ ] **Step 4: 在 action 实现区新增实现**

`openContextMenu: (contextMenu) => set({ contextMenu }),` 行下方新增:

```ts
      openRenameModal: (id) => set({ renameTarget: { id } }),
      closeRenameModal: () => set({ renameTarget: null }),
```

注:`partialize`(`:193`)是白名单,`renameTarget` 不在其中,天然不持久化,无需改动。

- [ ] **Step 5: 编译校验**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增类型错误。

- [ ] **Step 6: Commit**

```bash
git add src/store/index.ts
git commit -m "feat: store 新增资产重命名弹窗开关状态"
```

---

### Task 2: RenameAssetModal 组件(TDD)

**Files:**
- Test: `src/components/canvas/RenameAssetModal.test.tsx`
- Create: `src/components/canvas/RenameAssetModal.tsx`

- [ ] **Step 1: 写失败测试**

创建 `src/components/canvas/RenameAssetModal.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RenameAssetModal from './RenameAssetModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';
import { makeAsset } from '@/lib/assets';

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }));
afterEach(() => vi.restoreAllMocks());

function seed() {
  const asset = makeAsset('doc', { label: '旧名字' });
  useStore.setState({ assets: [asset], renameTarget: { id: asset.id } } as never);
  return asset;
}

describe('RenameAssetModal', () => {
  test('预填当前资产名', () => {
    seed();
    render(<RenameAssetModal />);
    expect(screen.getByRole('textbox')).toHaveValue('旧名字');
  });

  test('空名时确认按钮禁用', () => {
    seed();
    render(<RenameAssetModal />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: /rename/i })).toBeDisabled();
  });

  test('回车提交调用 renameAsset(去空) 并关闭', () => {
    const asset = seed();
    render(<RenameAssetModal />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '  新名字  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().assets.find((a) => a.id === asset.id)?.label).toBe('新名字');
    expect(useStore.getState().renameTarget).toBeNull();
  });

  test('Esc 关闭弹窗', () => {
    seed();
    render(<RenameAssetModal />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().renameTarget).toBeNull();
  });

  test('找不到目标资产时渲染 null', () => {
    useStore.setState({ assets: [], renameTarget: { id: 'missing' } } as never);
    const { container } = render(<RenameAssetModal />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test src/components/canvas/RenameAssetModal.test.tsx`
Expected: FAIL(模块不存在 / 无法解析 `./RenameAssetModal`)。

- [ ] **Step 3: 写组件实现**

创建 `src/components/canvas/RenameAssetModal.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/store';
import IconButton, { submitVariant } from '@/components/ui/IconButton';

// 资产重命名弹窗:复用 CreateGameModal 卡片语言(圆角卡 + backdrop + Esc 关闭 + Enter 提交)
export default function RenameAssetModal() {
  const target = useStore((s) => s.renameTarget);
  const assets = useStore((s) => s.assets);
  const renameAsset = useStore((s) => s.renameAsset);
  const close = useStore((s) => s.closeRenameModal);
  const dark = useStore((s) => s.theme) === 'dark';
  const asset = assets.find((a) => a.id === target?.id);
  const [name, setName] = useState(asset?.label ?? '');

  const canSubmit = name.trim().length > 0;

  const submit = () => {
    if (!canSubmit || !asset) return;
    renameAsset(asset.id, name.trim());
    close();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!asset) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={close} />
      <div className="fixed left-1/2 top-1/2 z-50 flex w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">Rename</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Asset name"
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">Cancel</button>
          <IconButton
            variant={submitVariant(canSubmit, dark)}
            className="h-10 rounded-[10px] px-4 text-[13px] font-semibold"
            aria-label="Rename"
            disabled={!canSubmit}
            onClick={submit}
          >
            Rename
          </IconButton>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test src/components/canvas/RenameAssetModal.test.tsx`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/RenameAssetModal.tsx src/components/canvas/RenameAssetModal.test.tsx
git commit -m "feat: 新增资产重命名弹窗组件"
```

---

### Task 3: ContextMenu 接入弹窗,移除 prompt

**Files:**
- Modify: `src/components/canvas/ContextMenu.tsx:14,31-39`

- [ ] **Step 1: 替换 store action 依赖**

将 `:14` 的:

```ts
  const renameAsset = useStore((s) => s.renameAsset);
```

改为:

```ts
  const openRenameModal = useStore((s) => s.openRenameModal);
```

- [ ] **Step 2: 改写 Rename 项 onClick**

将 Rename 项(`:30-39`)整段替换为:

```tsx
    {
      icon: figAsset.pencil,
      label: 'Rename',
      onClick: () => {
        openRenameModal(asset.id);
        close(null);
      },
    },
```

(移除 `prompt()` 调用与 `// TODO(U10): 换内联编辑/modal` 注释)

- [ ] **Step 3: 编译校验**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误(确认 `renameAsset` 已无其他引用)。

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/ContextMenu.tsx
git commit -m "feat: 右键菜单 Rename 改用弹窗组件"
```

---

### Task 4: Workspace 挂载弹窗

**Files:**
- Modify: `src/components/workspace/Workspace.tsx:9-12,21-22,51`

- [ ] **Step 1: 引入组件**

在 `import ContextMenu ...`(`:10`)下方新增:

```tsx
import RenameAssetModal from '@/components/canvas/RenameAssetModal';
```

- [ ] **Step 2: 订阅 renameTarget**

在 `const compareOn = useStore((s) => s.compare.on);`(`:23`)下方新增:

```tsx
  const renameTarget = useStore((s) => s.renameTarget);
```

- [ ] **Step 3: 条件挂载**

在 `<ContextMenu />`(`:51`)下方新增:

```tsx
      {renameTarget && <RenameAssetModal />}
```

- [ ] **Step 4: 编译校验**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace/Workspace.tsx
git commit -m "feat: Workspace 挂载资产重命名弹窗"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 跑全部测试**

Run: `pnpm test`
Expected: 全绿,无回归。

- [ ] **Step 2: 跑 lint**

Run: `pnpm lint`
Expected: 无 error。

---

## 自查清单(已核对)

- **Spec 覆盖**:store 状态(Task 1)、新组件+测试(Task 2)、ContextMenu 改动(Task 3)、Workspace 挂载(Task 4)、验证(Task 5)——spec 各节均有对应任务。
- **类型一致**:`renameTarget: { id: string } | null`、`openRenameModal(id)`、`closeRenameModal()` 在 store / 组件 / 测试 / ContextMenu / Workspace 中命名一致。
- **无占位符**:所有代码步骤均含完整代码与确切命令。
