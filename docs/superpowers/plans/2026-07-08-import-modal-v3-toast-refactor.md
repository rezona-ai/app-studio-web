# 导入弹窗 v3 + Toast 语义化重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Toast 通道按语义拆分方法（setError/setSuccess/setWarning/clearToast，字段 `lastError`→`toast`）；导入弹窗改为「选文件即上传、x 承载关闭/取消、完成态延迟关闭、成功 Toast」。

**Architecture:** Part A 先行做 store 级重命名与语义化入口（全触点一次迁移，不留双轨）；Part B 在其上给导入 action 增加 `done` 完成态与 success Toast，弹窗按四态（表单/上传/落素材/完成）重构。

**Tech Stack:** Next.js 16 + React 19、zustand、vitest（fake timers）、react-i18next、Figma 955-49013。

**Spec:** `docs/superpowers/specs/2026-07-08-import-modal-v3-toast-refactor-design.md`（实现前先读）。

## Global Constraints

- 执行前基于 dev 建 worktree `feat/import-modal-v3`（`.claude/worktrees/feat+import-modal-v3`）；完成后 `--no-ff` 回合 dev（message 含分支名）并清理。
- 注释 / commit message 中文；注释解释「为什么」。
- Toast 通道字段名 `toast`，`ToastMessage.kind` 必填；语义入口固定 kind，调用方不传 kind；**不留 `lastError` 双轨**（全仓源码+测试一次迁完）。
- 上传按钮对齐 Figma 955-49013：`bg-[var(--color-teal)]`、`rounded-[360px]`、高 32px、`px-[32px]`、Inter Bold `text-[15px] leading-[18px] tracking-[0.26px]`、文字恒 `#171717`（恒色 CTA 例外，同 `.btn-raised` 语义）。
- 完成态停留 1200ms（常量 `IMPORT_DONE_DELAY_MS`）后关闭；素材阶段与完成态 x disabled。
- action 层 Toast 文案用英文字面值（`PROJECT_IMPORTED` → `New project created`，同 `IMPORT_ASSETS_PARTIAL` 先例）。
- i18n 六语同构（en 真相源）；x 的 aria-label 复用既有 `common.close`。
- 验证只信命令退出码（worktree IDE 诊断有已知误报）。

---

### Task 1: Toast 系统语义化重构（全触点迁移）

**Files:**
- Modify: `src/store/types.ts`（`ToastMessage.kind` 必填；`ServerState.lastError` → `toast`；初始值同步）
- Modify: `src/store/index.ts`（UIState 声明与实现：setError/setSuccess/setWarning/clearToast；两处直接 `set({ lastError })` → `toast`）
- Modify: `src/store/actions.ts`（7 处 `set({ lastError: ... })` → `set({ toast: { ..., kind: 'error' } })`；注释同步）
- Modify: `src/components/ui/Toast.tsx`（订阅 `s.toast`；两处 `setError(null)` → `clearToast()`）
- Modify（语义归位）: `src/components/preview/SharePopover.tsx`、`src/components/preview/rezona/PublishedStep.tsx`、`src/client/useAuthGuard.ts`（`kind:'warning'` → `setWarning`）；`src/components/preview/RezonaPublishModal.tsx`（`VERSION_NOT_FOUND` 一处 → `setWarning`，其余仍 `setError`，全部去掉 kind 字段）；`src/components/canvas/CreativeLibraryModal.tsx`（去掉多余 `kind:'error'`）；`src/client/useKoubouConnection.ts`（`connErrorToast` 返回含 kind，按 kind 分发 `setWarning`/`setError`）
- Test: 全部含 `lastError` 断言的测试文件（`grep -rl lastError src --include='*.test.*'`）字段改 `toast`；`src/store/index.test.ts`（或就近 store 测试文件）新增语义方法用例

**Interfaces:**
- Produces：`ServerState.toast: ToastMessage | null`（`kind` 必填）；UIState actions `setError(msg: { code: string; message: string })` / `setSuccess(msg)` / `setWarning(msg)` / `clearToast()`。Task 2/4 依赖 `toast` 字段与 `setError` 签名（组件侧签名不变，仅不再传 kind/null）。

- [ ] **Step 1: 写失败测试**（放 store 既有测试文件，如 `src/store/index.test.ts`；若无则新建，样板抄 `actions.test.ts` 顶部的 store 重置方式）

```ts
describe('Toast 语义化入口', () => {
  test('setError/setSuccess/setWarning 写入对应 kind,clearToast 清空', () => {
    const s = useStore.getState();
    s.setError({ code: 'E', message: 'boom' });
    expect(useStore.getState().toast).toEqual({ code: 'E', message: 'boom', kind: 'error' });
    s.setSuccess({ code: 'OK', message: 'done' });
    expect(useStore.getState().toast).toEqual({ code: 'OK', message: 'done', kind: 'success' });
    s.setWarning({ code: 'W', message: 'careful' });
    expect(useStore.getState().toast).toEqual({ code: 'W', message: 'careful', kind: 'warning' });
    s.clearToast();
    expect(useStore.getState().toast).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run -t "Toast 语义化入口"`
Expected: FAIL —— 无 `toast` 字段 / 新方法。

- [ ] **Step 3: 实现**

1. `types.ts`：

```ts
export type ToastMessage = { code: string; message: string; kind: ToastKind };
```

`ServerState.lastError: ToastMessage | null;` → `toast: ToastMessage | null;`（注释：全局 Toast 通道，语义入口见 index.ts 的 setError/setSuccess/setWarning）；`createInitialServerState()` 中 `lastError: null` → `toast: null`。

2. `index.ts` UIState 声明区（替换原 `setError` 一行）：

```ts
  // Toast 语义化入口:kind 由方法名承载,调用方不传 kind(杜绝用 setError 发成功提示)
  setError: (e: { code: string; message: string }) => void;
  setSuccess: (e: { code: string; message: string }) => void;
  setWarning: (e: { code: string; message: string }) => void;
  clearToast: () => void;
```

实现区（替换 `setError: (lastError) => set({ lastError }),`）：

```ts
      setError: (e) => set({ toast: { ...e, kind: 'error' } }),
      setSuccess: (e) => set({ toast: { ...e, kind: 'success' } }),
      setWarning: (e) => set({ toast: { ...e, kind: 'warning' } }),
      clearToast: () => set({ toast: null }),
```

`index.ts:313`、`index.ts:385` 附近两处 `set({ lastError: { code: e.code, message: e.message } })` → `set({ toast: { code: e.code, message: e.message, kind: 'error' } })`。

3. `actions.ts`：`grep -n "lastError" src/store/actions.ts` 全部命中处——`set({ lastError: X })` 改 `set({ toast: { ...X 展开后补 kind: 'error' } })`（7 处写入 + 注释里的 `lastError` 字样同步改 `toast`）。

4. `Toast.tsx`：`useStore((s) => s.lastError)` → `s.toast`；`setError(null)`（自动消失 + 关闭按钮两处）→ `clearToast()`（订阅 `s.clearToast`）；`shown.kind ?? 'error'` 可简化为 `shown.kind`（kind 已必填）。

5. 组件语义归位（逐个）：
   - `SharePopover.tsx:34`、`PublishedStep.tsx:23`：`setError({ ..., kind: 'warning' })` → `setWarning({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually' })`（订阅行同步换 `s.setWarning`）；
   - `useAuthGuard.ts:19`：同上 → `setWarning`；
   - `RezonaPublishModal.tsx:135`：`VERSION_NOT_FOUND` → `setWarning`（该组件需同时订阅 `setError` 与 `setWarning`）；其余三处 `setError` 保留、如有 kind 字段删除；
   - `CreativeLibraryModal.tsx:61`：删 `kind: 'error'`；
   - `useKoubouConnection.ts:93-94`：

```ts
          const toast = connErrorToast(s);
          if (toast) {
            const { kind, ...msg } = toast;
            (kind === 'warning' ? useStore.getState().setWarning : useStore.getState().setError)(msg);
          }
```

6. 测试迁移：`grep -rln "lastError" src --include='*.test.*'` 逐个把断言字段 `lastError` 改 `toast`；涉及直接 `useStore.setState({ lastError: ... })` 的注入同步改 `toast`（对象须补 `kind`，按用例语义通常 `'error'`）。

- [ ] **Step 4: 全量验证**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿（tsc 是这次重命名的安全网——kind 必填会把漏迁的调用点全部暴露为类型错误，逐一清零）。
另跑残留扫描：`grep -rn "lastError" src --include='*.ts*'` 应零命中。

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor: Toast 通道语义化(lastError→toast,按 kind 拆分 setError/setSuccess/setWarning/clearToast)"
```

---

### Task 2: 导入 action 完成态 + 成功 Toast

**Files:**
- Modify: `src/store/types.ts`（`importArchiveStatus.step` 联合类型加 `'done'`）
- Modify: `src/store/actions.ts`（import action 尾部：done 态 + 延迟清态 + success toast）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `toast` 字段。
- Produces: `importArchiveStatus.step` 含 `'done'`；上传 resolve 后 `toast` 收到 `{ code: 'PROJECT_IMPORTED', kind: 'success' }`；素材完成后 status 停留 `done` 1200ms 再清 null、action 才 resolve。

- [ ] **Step 1: 写失败测试**（`actions.test.ts` 的 importProjectArchive describe 内追加；文件顶部按需 `vi.useFakeTimers`——只在新用例内启用，避免影响既有用例）

```ts
  test('上传成功→success toast;素材完成→done 态停留 1.2s 后清态才 resolve', async () => {
    vi.useFakeTimers();
    try {
      importArchiveMock.mockResolvedValue(importedProject);
      api.writeCanvasItemFromUrl.mockResolvedValue({ item_id: 'ci1', type: 'image', name: 'x', status: 'ready', canvas_x: 0, canvas_y: 0 });
      useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
      let resolved = false;
      const run = useStore.getState().importProjectArchive(file, 'Imported').then(() => { resolved = true; });
      // 推进到素材完成:微任务耗尽后应处于 done 态且尚未 resolve
      await vi.advanceTimersByTimeAsync(0);
      expect(useStore.getState().toast).toMatchObject({ code: 'PROJECT_IMPORTED', kind: 'success' });
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'done', done: 2, total: 2 });
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1200);
      await run;
      expect(useStore.getState().importArchiveStatus).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "done 态"`
Expected: FAIL —— 无 done 态 / success toast。

- [ ] **Step 3: 实现**

1. `types.ts`：`step: 'uploading' | 'creating' | 'importing_assets'` → `step: 'uploading' | 'creating' | 'importing_assets' | 'done'`（注释补：done=素材处理完的展示态，停留后由 action 清）。
2. `actions.ts` import action 改造（在既有实现上）：

- 常量（`importAbort` 声明旁）：

```ts
  // 完成态展示时长:素材处理完后弹窗停留「导入已完成」再关闭
  const IMPORT_DONE_DELAY_MS = 1200;
```

- 上传 resolve 后（`importAbort = null;` 与置 creating 的 set 合并为一次）：

```ts
      importAbort = null;   // 项目已建成,进入不可取消阶段
      set({
        // 项目创建成功即提示(素材落画布是后续增强,不阻塞用户感知)
        toast: { code: 'PROJECT_IMPORTED', message: 'New project created', kind: 'success' },
        importArchiveStatus: { step: 'creating', progress: 1, done: 0, total: data.assets.length },
      });
```

- 素材循环结束、partial toast 判断之后追加（注意 done 计数变量已存在）：

```ts
      // 完成态:弹窗展示「导入已完成」,停留后由 finally 统一清态;resolve 延后到停留结束
      set({ importArchiveStatus: { step: 'done', progress: 1, done, total: data.assets.length } });
      await new Promise((r) => setTimeout(r, IMPORT_DONE_DELAY_MS));
```

（`finally` 的 `set({ importArchiveStatus: null })` 保持不变——延迟结束后正常走到 finally 清态并 resolve；中途切走项目的 early return 不进 done 态，直接被 finally 清。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts && pnpm exec tsc --noEmit`
Expected: PASS（既有用例不回归——它们不推进 fake timers，且真实计时器路径 1.2s 在 `await run` 前自然流逝？**注**：既有「成功」用例是真实计时器，新增 1.2s 延迟会拖慢该用例——在该既有用例外层同样包 fake timers 或把断言改为 `await vi.waitFor`；实现者按最小改动处理，语义不变）。

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 导入完成态(done+1.2s 停留)与项目创建成功 Toast"
```

---

### Task 3: i18n 增删（六语）

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Produces: `chat.importGame.{chooseFileButton,importDone}`；移除 `chat.importGame.{namePlaceholder,import,cancelImport}`（Task 4 后不再被引用）。

- [ ] **Step 1: en.ts 修改** `importGame` 块：删 `namePlaceholder` / `import` / `cancelImport` 三行，追加：

```ts
      chooseFileButton: 'Choose File',
      importDone: 'Import complete',
```

- [ ] **Step 2: 其余五语同构增删**

| key | zh | fr | ru | ja | vi |
|---|---|---|---|---|---|
| chooseFileButton | 选择文件 | Choisir un fichier | Выбрать файл | ファイルを選択 | Chọn tệp |
| importDone | 导入已完成 | Importation terminée | Импорт завершён | インポートが完了しました | Nhập hoàn tất |

- [ ] **Step 3: 验证**

Run: `pnpm exec vitest run src/i18n && pnpm exec tsc --noEmit`
Expected: 全绿。注：为保持每任务独立绿，本任务只**新增**两 key；`namePlaceholder`/`import`/`cancelImport` 的删除挪到 Task 4（组件改完后同 commit 删除，否则组件仍引用会 tsc 红）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 导入弹窗 v3 六语文案(选择文件按钮/导入已完成)"
```

---

### Task 4: 弹窗 v3 重构（四态 + x 按钮 + 即选即传）

**Files:**
- Modify: `src/components/chat/ImportProjectModal.tsx`（整文件重写，代码见 Step 3）
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（删除 `namePlaceholder` / `import` / `cancelImport` 三 key，六语同步）
- Test: `src/components/chat/ImportProjectModal.test.tsx`（整文件重写）

**Interfaces:**
- Consumes: Task 1 `setError`；Task 2 `importArchiveStatus`（含 `done`）、`importProjectArchive`（resolve 已含 1.2s 停留）、`cancelImportArchive`；Task 3 i18n。
- Produces: 组件 props 不变。

- [ ] **Step 1: 重写测试**（整文件替换；store 重置样板沿用原文件 `beforeEach`）

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportProjectModal from './ImportProjectModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const importAction = vi.fn();
const cancelAction = vi.fn();
const setError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    importProjectArchive: importAction, cancelImportArchive: cancelAction, setError,
  } as never);
});

const pickFile = (name = 'my-game.zip') => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['z'], name)] } });
};

describe('表单态', () => {
  test('展示拖放区+Choose File 按钮,无名称输入框', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Game name')).toBeNull();
  });

  test('选中文件立即以默认名开始上传', () => {
    importAction.mockResolvedValue(undefined);
    render(<ImportProjectModal onClose={() => {}} />);
    pickFile('cool-game.tar.gz');
    expect(importAction).toHaveBeenCalledWith(expect.any(File), 'cool-game');
  });

  test('拖放非法扩展名:setError 且不开始上传', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    const zone = screen.getByRole('button', { name: /choose archive/i });
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['z'], 'bad.rar')] } });
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: 'IMPORT_BAD_TYPE' }));
    expect(importAction).not.toHaveBeenCalled();
  });

  test('表单态点 x 直接关闭', async () => {
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });
});

describe('上传阶段', () => {
  beforeEach(() => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 0.3, done: 0, total: 0 } } as never);
  });

  test('无底部取消按钮;点 x 进入行内确认,确认取消调 cancelImportArchive', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Cancel this import?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(cancelAction).toHaveBeenCalled();
  });

  test('Esc 同走确认;继续导入返回', () => {
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep importing' }));
    expect(screen.queryByText('Cancel this import?')).toBeNull();
  });
});

describe('落素材与完成态', () => {
  test('importing_assets:x disabled,Esc 无效', () => {
    const onClose = vi.fn();
    useStore.setState({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 1, total: 3 } } as never);
    render(<ImportProjectModal onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancel this import?')).toBeNull();
  });

  test('done:渲染导入已完成,x 仍 disabled', () => {
    useStore.setState({ importArchiveStatus: { step: 'done', progress: 1, done: 3, total: 3 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText('Import complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  test('action resolve 后自动关闭', async () => {
    let release: () => void = () => {};
    importAction.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    pickFile();
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });
});
```

> 文案匹配（'Close'/'Choose File' 等）以测试环境 i18n 实际输出为准，若返回 key 则按 key 匹配——以原文件既有匹配方式为准。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 重写组件**（整文件替换）

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import IconButton from '@/components/ui/IconButton';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 支持的压缩包扩展名(与后端契约一致);大小不做前端预校验,413/422 由后端信封→Toast
const ACCEPT = '.zip,.tar,.tar.gz,.tgz';
const ARCHIVE_RE = /\.(tar\.gz|tgz|tar|zip)$/i;
// 去掉压缩扩展名作项目名(.tar.gz 双段优先);v3 起名称不可编辑,恒取文件名
const defaultName = (filename: string) => filename.replace(ARCHIVE_RE, '');

// 导入游戏弹窗 v3,四态:表单(选文件即上传) / 上传中(x→行内确认取消) / 落素材(x disabled) / 完成(1.2s 后自动关)。
// 关闭/取消统一收敛到右上角 x;导入态由 store.importArchiveStatus 单一驱动
export default function ImportProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const importProjectArchive = useStore((s) => s.importProjectArchive);
  const cancelImportArchive = useStore((s) => s.cancelImportArchive);
  const setError = useStore((s) => s.setError);
  const status = useStore((s) => s.importArchiveStatus);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const importing = status != null;
  const cancellable = status?.step === 'uploading';
  // 落素材与完成态不可关(项目已建成,让流程自然走完;done 由 action 延迟后 resolve 自动关)
  const closeDisabled = importing && !cancellable;
  const { closing, requestClose } = useRequestClose(onClose, 200);

  // 上传恰好完成的竞态:确认框失去意义,渲染期 guard 收起(仓库约定,不用 effect-setState)
  if (confirmingCancel && !cancellable) setConfirmingCancel(false);

  // 选定文件统一入口(点击选择与拖放共用):校验扩展名后立即上传;结束(含 done 停留)自动关闭,
  // 失败/取消 reject 则回表单态(Toast 由 action 分流,取消静默)
  const start = (f: File) => {
    if (!ARCHIVE_RE.test(f.name)) {
      setError({ code: 'IMPORT_BAD_TYPE', message: t('chat.importGame.dropRejected') });
      return;
    }
    void importProjectArchive(f, defaultName(f.name))
      .then(() => requestClose())
      .catch(() => setConfirmingCancel(false));
  };

  // x/Esc 统一意图:表单直接关;上传中先行内确认;其余阶段禁用(x disabled,Esc 忽略)
  const onCloseIntent = () => {
    const st = useStore.getState().importArchiveStatus;
    if (st == null) requestClose();
    else if (st.step === 'uploading') setConfirmingCancel(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseIntent(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // onCloseIntent 内部读 getState,无过期闭包;requestClose 稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onCloseIntent 每渲染新建但行为恒定,不入 deps 防重复绑定
  }, [requestClose]);

  const stepText = status == null ? '' :
    status.step === 'uploading' ? t('chat.importGame.stepUploading', { percent: Math.round(status.progress * 100) })
    : status.step === 'creating' ? t('chat.importGame.stepCreating')
    : status.step === 'importing_assets' ? t('chat.importGame.stepImportingAssets', { done: status.done, total: status.total })
    : t('chat.importGame.importDone');

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={() => { if (!importing) requestClose(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('chat.importGame.title')}</span>
          <IconButton aria-label={t('common.close')} disabled={closeDisabled} onClick={onCloseIntent}>
            <FigIcon src={figAsset.close} size={20} />
          </IconButton>
        </div>

        {importing ? (
          status.step === 'done' ? (
            /* 完成态:√ + 导入已完成;停留由 action 承担,resolve 后自动退场 */
            <div className="flex flex-col items-center gap-3 py-8">
              <FigIcon src={figAsset.checkCircle} size={28} className="text-[var(--color-teal)]" />
              <span className="text-[13px] tracking-[-0.13px] text-[var(--color-ink)]">{stepText}</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={24} className="animate-spin text-[var(--color-teal)]" />
              <span className="text-[13px] tracking-[-0.13px] text-[var(--color-muted)]">{stepText}</span>
            </div>
          )
        ) : (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) start(f);
              e.target.value = '';   // 允许再次选择同名文件(取消后重试同文件)
            }} />
            {/* 拖放区(拉高):虚线框+上传图标+提示+显式 Choose File 按钮(Figma 955-49013) */}
            <div
              role="button"
              tabIndex={0}
              aria-label={t('chat.importGame.chooseFile')}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) start(f);
              }}
              className={`flex h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-4 rounded-[12px] border border-dashed bg-[var(--color-fill)] px-3 transition-colors hover:border-[var(--color-teal)] ${dragOver ? 'border-[var(--color-teal)]' : 'border-[var(--color-line-2)]'}`}
            >
              <FigIcon src={figAsset.upload} size={24} />
              <span className="w-full truncate text-center text-[13px] tracking-[-0.13px] text-[var(--color-muted)]">{t('chat.importGame.chooseFile')}</span>
              {/* 恒色 CTA(同 .btn-raised 例外语义):teal 胶囊,文字恒深色,不随主题翻转 */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                className="flex h-[32px] items-center rounded-[360px] bg-[var(--color-teal)] px-[32px] text-[15px] font-bold leading-[18px] tracking-[0.26px] text-[#171717] transition-transform motion-safe:active:scale-[0.97]"
              >
                {t('chat.importGame.chooseFileButton')}
              </button>
            </div>
          </>
        )}

        {importing && confirmingCancel && (
          /* 行内二次确认:就地出现在底部,不叠第二层模态 */
          <div className="flex items-center justify-end gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-ink)]">{t('chat.importGame.confirmCancelText')}</span>
            <button type="button" onClick={() => setConfirmingCancel(false)} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.keepImporting')}</button>
            <button type="button" onClick={() => { cancelImportArchive(); setConfirmingCancel(false); }} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-semibold text-[#e5484d] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.confirmCancel')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

实现注意：
- `figAsset.checkCircle`：`public/figma/icons/check-circle.svg` 已存在，若 `figma.tsx` 未登记则登记（`checkCircle: \`${F}/check-circle.svg\``，tone 走默认解析；若 ICON_TONE 需显式配置则设 `primary` 以支持 teal 着色）。着色若 mask 方案不吃 `text-[var(--color-teal)]`，改用 `style={{ color: 'var(--color-teal)' }}` 配 tone primary（FigIcon primary 随 currentColor）。
- 同 commit 删除六语的 `namePlaceholder` / `import` / `cancelImport` 三 key（Task 3 Step 3 的约定）。
- 若 `IconButton` 无 `disabled` 样式异常，沿用其内建 `disabled:opacity-30`。

- [ ] **Step 4: 验证**

Run: `pnpm exec vitest run src/components/chat && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿；另扫 `grep -rn "importGame.import'\|namePlaceholder\|cancelImport" src` 零命中（死 key 未残留）。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ImportProjectModal.tsx src/components/chat/ImportProjectModal.test.tsx src/i18n/locales
git commit -m "feat: 导入弹窗 v3(选文件即上传/x 统一关闭取消/完成态延迟关闭)"
```

---

### Task 5: 全量验证与收尾

**Files:** 无新增（验证 + 可能的修正）。

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 exit 0。

- [ ] **Step 2: 运行态验证**（Playwright + mock `/api/pgc/**`，prod 起独立端口，套路同前两轮）

- 表单态：拉高拖放区 + Choose File teal 胶囊 + 右上角 x，截图对照 Figma；
- 选文件（不点任何按钮）即出现「正在上传… n%」；
- 上传中点 x → 行内确认 → 确认取消 → 回表单态、无红 Toast；
- 成功流（mock 挂起后放行）：上传完成出现绿色 success Toast「New project created」；素材阶段 x disabled；完成态「Import complete」展示后 ~1.2s 弹窗自动关闭、已切到新项目；
- 全局回归：随便触发一个错误（mock 422）确认 Toast 仍正常（重命名后通道无断裂）。

- [ ] **Step 3: 若有修正则提交**

```bash
git add -A && git commit -m "fix: 导入弹窗 v3 联调修正"
```

- [ ] **Step 4: 收尾**

按 superpowers:finishing-a-development-branch 回合 dev（`--no-ff`，message 含 `feat/import-modal-v3`），删分支清 worktree；合并前 `git log` 校验提交落点。
