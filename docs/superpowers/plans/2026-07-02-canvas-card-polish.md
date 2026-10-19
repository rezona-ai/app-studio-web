# 画布资产卡片交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打磨画布资产卡片四项交互——hover 炫光阴影、右键菜单图标 tone 统一、Rename 落库、Delete 二次确认 + 删除中态。

**Architecture:** 全程走唯一 zustand store 的单向数据流；纯 UI 改样式（NodeCard/ContextMenu），IO 改动进 ServerActions（`renameAsset` 迁移 + `deleteCanvasItem` 悲观化），新增一个确认弹窗组件。Rename 复用既有 `PATCH canvas/items/{id}` 端点（后端已支持 `name`）。

**Tech Stack:** Next 16 + React 19 + zustand + @xyflow/react + Tailwind v4（globals.css 令牌）+ react-i18next（六语）+ Vitest/jsdom。

## Global Constraints

- 注释 / 计划 / commit message 一律**中文**，一句话总结变更。
- UI 只用 `globals.css` 既有令牌 / 基础组件 / 动效类；禁硬编码色值、禁一次性 keyframes、禁新按钮种类。accent `#3582ff` 恒定不翻主题。
- 状态变更走纯函数 / action + 唯一落库入口；组件只订阅 / 调 action；`await` 后校验 `currentProjectId`；瞬态不持久化。
- 只取后端文档约定字段（`name` 已核 apifox 8405123）；`guard` 之外不吞未知错误。
- i18n en 为单一真相源，新增文案补齐六语（en/zh/fr/ru/ja/vi）。
- 测试与源码同目录 `*.test.ts(x)`；收尾 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm lint` 全绿。
- ⚠️ 在 worktree 工作：所有 Edit/Write 用**相对路径或 worktree 绝对路径**，勿用主仓绝对路径（会静默写到主仓）。

---

### Task 1: Hover 弹跳 → 炫光阴影（NodeCard）

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`（根 div className，约 55-59 行）

**Interfaces:**
- Consumes: 无新增。
- Produces: 无对外接口变化；纯样式。

- [ ] **Step 1: 改根 div className**

去掉 `motion-safe:hover:-translate-y-px`，`transition-[transform,box-shadow,border-color]` 改为 `transition-[box-shadow,border-color]`，非选中分支加 hover 炫光：

```tsx
    <div
      style={{ width }}
      className={`anim-media-in relative rounded-[16px] bg-[var(--color-surface)] p-1.5 transition-[box-shadow,border-color] duration-150 ${
        selected
          ? 'border-[1.5px] border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)] shadow-[0_4px_14px_-6px_rgba(53,130,255,0.4)]'
          : 'border border-[var(--color-line-2)] shadow-[var(--shadow-card)] hover:shadow-[0_2px_8px_-4px_rgba(0,0,0,0.10),0_0_20px_-2px_rgba(53,130,255,0.28)]'
      }`}
    >
```

- [ ] **Step 2: 手验**

`pnpm exec tsc --noEmit` 通过（类型无关但确认无语法错）。样式为视觉项，运行态在收尾统一验证。

- [ ] **Step 3: Commit**

```bash
git add src/components/canvas/nodes/NodeCard.tsx
git commit -m "feat: 画布卡片 hover 弹跳改为蓝色炫光阴影"
```

---

### Task 2: 右键菜单图标 tone 统一（ContextMenu）

**Files:**
- Modify: `src/components/canvas/ContextMenu.tsx:66`
- Test: `src/components/canvas/ContextMenu.test.tsx`

**Interfaces:**
- Consumes: `FigIcon` 的 `tone` prop（`'primary' | 'secondary' | 'original'`）。
- Produces: 无。

- [ ] **Step 1: 写失败测试**

在 `ContextMenu.test.tsx` 补：菜单三项图标都以 ink 色（primary，即 `currentColor` mask）渲染，而非 muted。`FigIcon` secondary 用 `backgroundColor: var(--color-muted)`，primary 用 `currentColor`。断言 Use as reference 项内的图标 span 的 `background-color` style 不是 `var(--color-muted)`：

```tsx
test('三个菜单项图标均用 ink(primary) 色,非灰', () => {
  useStore.setState({ contextMenu: { id: 'a1', x: 0, y: 0 }, assets: [makeImageAsset('a1')] });
  render(<ContextMenu />);
  // primary tone → currentColor;secondary → var(--color-muted)
  const icons = document.querySelectorAll('span[aria-hidden="true"][style*="mask"]');
  expect(icons.length).toBe(3);
  icons.forEach((el) => {
    expect((el as HTMLElement).style.backgroundColor).not.toBe('var(--color-muted)');
  });
});
```

（`makeImageAsset` / setState 形态对齐该测试文件既有 helper；若无则按文件现有构造方式补一个最小 image asset：`{ id:'a1', key:'k1', kind:'image', label:'x', position:{x:0,y:0}, status:'ready' }`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx -t "ink"`
Expected: FAIL（at 图标当前是 `var(--color-muted)`）。

- [ ] **Step 3: 实现——传 tone="primary"**

`ContextMenu.tsx:66`：

```tsx
              <FigIcon src={it.icon} size={20} tone="primary" />
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx`
Expected: PASS（全部）。

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/ContextMenu.tsx src/components/canvas/ContextMenu.test.tsx
git commit -m "feat: 右键菜单 Use as reference 图标由灰改 ink 色,与其余项一致"
```

---

### Task 3: Rename 落库(乐观更新 + 失败回滚)

**Files:**
- Modify: `src/lib/pgc/types.ts`（`CanvasUpdateRequest` 加 `name`）
- Modify: `src/lib/pgc/client.ts`（新增 `renameCanvasItem`）
- Modify: `src/store/index.ts`（移除纯 `set` 版 `renameAsset`，改由 ServerActions 提供）
- Modify: `src/store/actions.ts`（新增 async `renameAsset`，加入 return 对象）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: `pgcApi.renameCanvasItem(pid: number, itemId: string, name: string): Promise<CanvasItemData>`。
- Produces: `renameAsset(id: string, label: string): Promise<void>`（签名从同步 void 改 async；调用方 `RenameAssetModal` 无需改）。

- [ ] **Step 1: 扩展类型与 client**

`types.ts`（约 167 行）：
```ts
export interface CanvasUpdateRequest { reference?: unknown | null; canvas_x?: number | null; canvas_y?: number | null; name?: string | null; }
```
`client.ts`（`deleteCanvasItem` 附近）新增：
```ts
  renameCanvasItem: (pid: number, itemId: string, name: string) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { name } satisfies CanvasUpdateRequest),
```
（`CanvasItemData` 已在 client.ts 顶部 import 列表；若未导入则补入。）

- [ ] **Step 2: 写失败测试**

`actions.test.ts`（仿既有 rename/delete 用例的 mock 结构，`api` 为 `pgcApi` mock，含 `renameCanvasItem: vi.fn()`）：
```ts
test('renameAsset 乐观改名并调 renameCanvasItem', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('img-1', { label: '旧' })] });
  api.renameCanvasItem.mockResolvedValue({});
  await useStore.getState().renameAsset('img-1', '新');
  expect(useStore.getState().assets[0].label).toBe('新');
  expect(api.renameCanvasItem).toHaveBeenCalledWith(42, 'img-1', '新');
});

test('renameAsset 失败回滚旧名并置 lastError', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('img-1', { label: '旧' })] });
  api.renameCanvasItem.mockRejectedValue(new PgcError('X', 'boom', 500));
  await useStore.getState().renameAsset('img-1', '新');
  expect(useStore.getState().assets[0].label).toBe('旧');
  expect(useStore.getState().lastError?.code).toBe('X');
});

test('renameAsset 对 pending_ 占位卡只本地改名,不调接口', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('pending_x', { label: '旧' })] });
  await useStore.getState().renameAsset('pending_x', '新');
  expect(useStore.getState().assets[0].label).toBe('新');
  expect(api.renameCanvasItem).not.toHaveBeenCalled();
});
```
（`seedProject`/`asset` 用该文件既有 helper 名；若命名不同则对齐现有写法——设置 `currentProjectId` 与构造 Asset。`renameCanvasItem` 需加进文件顶部 pgcApi mock 对象。）

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "renameAsset"`
Expected: FAIL（`renameAsset` 仍是纯本地 set，未调接口 / 未回滚）。

- [ ] **Step 4: 实现 async renameAsset(actions.ts)**

在 `createServerActions` 内、`deleteCanvasItem` 附近新增：
```ts
  // 乐观改名:立即本地改 label(弹窗随即关闭,跟手),再落库;失败回滚 + Toast。
  // pending_ 占位卡无服务端 item,仅本地改名。
  const renameAsset = async (id: string, label: string) => {
    const pid = get().currentProjectId; if (pid == null) return;
    const prev = get().assets.find((a) => a.id === id)?.label;
    set({ assets: get().assets.map((a) => (a.id === id ? { ...a, label } : a)) });
    if (id.startsWith('pending_') || prev === undefined) return;
    await guard(set, async () => {
      await pgcApi.renameCanvasItem(pid, id, label);
      if (get().currentProjectId !== pid) return;   // 切项目:丢弃
    });
    // guard 已把失败收敛为 lastError;回滚仅当仍是本次改的名(用户未再次改名)
    if (get().lastError && get().currentProjectId === pid) {
      set({ assets: get().assets.map((a) => (a.id === id && a.label === label ? { ...a, label: prev } : a)) });
    }
  };
```
> 注:回滚判据用 `lastError` 存在 + label 未再变。为避免误判历史 lastError,更稳妥是让 guard 返回是否出错——见 Step 4b。

- [ ] **Step 4b: 让 guard 可判成败(稳健回滚)**

改 `guard` 返回 `Promise<boolean>`（true=成功）：
```ts
async function guard(set: Set, fn: () => Promise<void>): Promise<boolean> {
  try { await fn(); return true; }
  catch (e) {
    if (e instanceof PgcError) {
      if (e.status === 401) set({ authRequired: true });
      else set({ lastError: { code: e.code, message: e.message } });
      return false;
    } else throw e;
  }
}
```
`renameAsset` 回滚改用返回值：
```ts
    const ok = await guard(set, async () => {
      await pgcApi.renameCanvasItem(pid, id, label);
    });
    if (!ok && get().currentProjectId === pid) {
      set({ assets: get().assets.map((a) => (a.id === id && a.label === label ? { ...a, label: prev } : a)) });
    }
```
（`guard` 返回值为新增,既有调用点忽略返回值,兼容。）

- [ ] **Step 5: 从 index.ts 移除旧 renameAsset,接 ServerActions**

`store/index.ts:231` 删除 `renameAsset: (id, label) => set(...)`；确认 `createServerActions` 的返回对象（actions.ts 约 615 行）把 `renameAsset` 列入展开，且 `AppStore`/`ServerActions` 类型含 `renameAsset: (id: string, label: string) => Promise<void>`（`index.ts:74` 的声明由 void 改 `Promise<void>`）。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "renameAsset"`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/store/index.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: Rename 接资产更新接口(乐观改名+失败回滚),不再纯前端"
```

---

### Task 4: Delete store 态 + 悲观删除中态(actions/index)

**Files:**
- Modify: `src/store/index.ts`（UIState 增 `deleteTarget`/`deletingIds` + open/close action + 初值 + 会话态清空 + persist 白名单不含二者）
- Modify: `src/store/actions.ts`（`deleteCanvasItem` 悲观化 + deletingIds）
- Test: `src/store/actions.test.ts`

**Interfaces:**
- Consumes: 无新增外部。
- Produces: `deleteTarget: { id: string } | null`；`deletingIds: string[]`；`openDeleteModal(id: string): void`；`closeDeleteModal(): void`；`deleteCanvasItem(itemId: string): Promise<void>`（签名不变，行为悲观化）。

- [ ] **Step 1: 写失败测试(actions.test.ts)**

```ts
test('deleteCanvasItem 成功:删除中入列→成功后移除卡与 deletingIds', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('img-1'), asset('img-2')], deletingIds: [] });
  let midDeleting: string[] = [];
  api.deleteCanvasItem.mockImplementation(async () => { midDeleting = [...useStore.getState().deletingIds]; return {}; });
  await useStore.getState().deleteCanvasItem('img-1');
  expect(midDeleting).toContain('img-1');              // 在途置删除中
  expect(useStore.getState().assets.map((a) => a.id)).toEqual(['img-2']);
  expect(useStore.getState().deletingIds).toEqual([]); // 收尾清空
});

test('deleteCanvasItem 失败:卡保留 + deletingIds 清空 + lastError', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('img-1')], deletingIds: [] });
  api.deleteCanvasItem.mockRejectedValue(new PgcError('X', 'boom', 500));
  await useStore.getState().deleteCanvasItem('img-1');
  expect(useStore.getState().assets.map((a) => a.id)).toEqual(['img-1']);
  expect(useStore.getState().deletingIds).toEqual([]);
  expect(useStore.getState().lastError?.code).toBe('X');
});

test('deleteCanvasItem 对 pending_ 直接移除,不调接口不入 deletingIds', async () => {
  seedProject(42);
  useStore.setState({ assets: [asset('pending_x')], deletingIds: [] });
  let entered = false;
  api.deleteCanvasItem.mockImplementation(async () => { entered = true; return {}; });
  await useStore.getState().deleteCanvasItem('pending_x');
  expect(useStore.getState().assets).toEqual([]);
  expect(entered).toBe(false);
});
```
（既有 `deleteCanvasItem 从 assets 移除` 用例仍应通过——它 mock resolve，最终 assets 去除该项。若既有用例断言了同步移除时序，需相应放宽为 `await` 后断言。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "deleteCanvasItem"`
Expected: 新增用例 FAIL（无 `deletingIds` 语义）。

- [ ] **Step 3: 实现 deleteCanvasItem 悲观化(actions.ts:374)**

```ts
  const deleteCanvasItem = async (itemId: string) => {
    const pid = get().currentProjectId; if (pid == null) return;
    // pending_ 占位卡:无服务端 item,直接本地移除(无网络等待,不进删除中态)
    if (itemId.startsWith('pending_')) {
      set({ assets: get().assets.filter((a) => a.id !== itemId) });
      commitGenTasks(get().genTasks.filter((t) => t.itemId !== itemId));
      return;
    }
    set({ deletingIds: [...get().deletingIds, itemId] });
    await guard(set, async () => {
      await pgcApi.deleteCanvasItem(pid, itemId);
      if (get().currentProjectId !== pid) return;   // 切项目:丢弃,卡保留由目标项目决定
      set({ assets: get().assets.filter((a) => a.id !== itemId) });
      commitGenTasks(get().genTasks.filter((t) => t.itemId !== itemId));
    });
    // 无论成功(卡已移除)/失败(卡复原)/切项目,都清删除中标记
    set({ deletingIds: get().deletingIds.filter((id) => id !== itemId) });
  };
```

- [ ] **Step 4: index.ts 增状态与 action**

`UIState`（约 36 行 `renameTarget` 附近）：
```ts
  deleteTarget: { id: string } | null;
  deletingIds: string[];
```
Actions 声明（约 67 行）：
```ts
  openDeleteModal: (id: string) => void;
  closeDeleteModal: () => void;
```
初值（约 107 行 `renameTarget: null` 附近）：
```ts
      deleteTarget: null,
      deletingIds: [],
```
action 实现（约 224 行 open/closeRenameModal 附近）：
```ts
      openDeleteModal: (id) => set({ deleteTarget: { id } }),
      closeDeleteModal: () => set({ deleteTarget: null }),
```
`deletingIds` 属 `deleteCanvasItem`（ServerActions）写入,但初值与类型在 index.ts。切项目清空会话态处（搜 `renameTarget: null` 在同一次 `set` 的清空点，或 switchProjectSession）一并加 `deleteTarget: null, deletingIds: []`。persist `partialize` 白名单**不含** `deleteTarget`/`deletingIds`（瞬态）。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（含既有用例）。

- [ ] **Step 6: Commit**

```bash
git add src/store/index.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 删除改悲观流程(删除中态 deletingIds)+ 新增 deleteTarget 弹窗态"
```

---

### Task 5: DeleteAssetModal 确认弹窗 + 接线 ContextMenu

**Files:**
- Create: `src/components/canvas/DeleteAssetModal.tsx`
- Test: `src/components/canvas/DeleteAssetModal.test.tsx`
- Modify: `src/components/canvas/ContextMenu.tsx`（Delete 项改调 `openDeleteModal`）
- Modify: `src/components/canvas/ContextMenu.test.tsx`（断言改调 open modal）
- Modify: 挂载点——`RenameAssetModal` 的渲染处（同级挂 `DeleteAssetModal`）

**Interfaces:**
- Consumes: `useStore` 的 `deleteTarget`/`closeDeleteModal`/`deleteCanvasItem`/`assets`；`useRequestClose`；`IconButton`。
- Produces: `<DeleteAssetModal />`。

- [ ] **Step 1: 写失败测试(DeleteAssetModal.test.tsx)**

```tsx
test('无 deleteTarget 时不渲染', () => {
  useStore.setState({ deleteTarget: null });
  const { container } = render(<DeleteAssetModal />);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test('渲染资产名,点 Delete 调 deleteCanvasItem 并关闭', () => {
  const del = vi.fn();
  useStore.setState({ deleteTarget: { id: 'a1' }, assets: [asset('a1', { label: '角色' })], deleteCanvasItem: del, closeDeleteModal: () => useStore.setState({ deleteTarget: null }) });
  render(<DeleteAssetModal />);
  expect(screen.getByRole('dialog').textContent).toContain('角色');
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(del).toHaveBeenCalledWith('a1');
});
```
（`asset` helper 对齐 store 测试；渲染需 i18n Provider——对齐该目录既有 modal 测试的 render 包装，如 RenameAssetModal.test.tsx 的 setup。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/DeleteAssetModal.test.tsx`
Expected: FAIL（组件不存在）。

- [ ] **Step 3: 实现 DeleteAssetModal(镜像 RenameAssetModal)**

```tsx
'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';

// 资产删除二次确认:复用 RenameAssetModal 模态语言(圆角卡 + backdrop + Esc/遮罩关闭 + 退场过渡)。
// 删除为破坏性操作:不绑定全局 Enter(防误删),autoFocus 落 Cancel;确认后删除中态显示在画布卡片。
export default function DeleteAssetModal() {
  const target = useStore((s) => s.deleteTarget);
  const assets = useStore((s) => s.assets);
  const del = useStore((s) => s.deleteCanvasItem);
  const close = useStore((s) => s.closeDeleteModal);
  const asset = assets.find((a) => a.id === target?.id);
  const { closing, requestClose } = useRequestClose(close, 200);
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  if (!asset) return null;
  const confirm = () => { void del(asset.id); requestClose(); };

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} role="dialog" aria-modal="true" aria-label={t('canvas.deleteConfirmTitle')} onClick={requestClose}>
      <div onClick={(e) => e.stopPropagation()} data-closing={closing} className="modal-pop flex w-[400px] flex-col gap-4 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('canvas.deleteConfirmTitle')}</span>
        <span className="text-[13px] leading-5 text-[var(--color-muted)]">{t('canvas.deleteConfirmBody', { name: asset.label })}</span>
        <div className="flex items-center justify-end gap-2">
          <button type="button" autoFocus onClick={requestClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('common.cancel')}</button>
          <button type="button" onClick={confirm} className="h-10 rounded-[10px] px-4 text-[13px] font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 接线 ContextMenu Delete 项**

`ContextMenu.tsx`：把 `deleteCanvasItem` 依赖换成 `openDeleteModal`；Delete 项 onClick 改：
```tsx
      onClick: () => { openDeleteModal(asset.id); close(null); },
```
（顶部 `const deleteCanvasItem = ...` 改 `const openDeleteModal = useStore((s) => s.openDeleteModal);`）
`ContextMenu.test.tsx`：把"Delete 调 deleteCanvasItem"的断言改为调 `openDeleteModal`。

- [ ] **Step 5: 挂载 DeleteAssetModal**

找到 `RenameAssetModal` 的渲染处（grep `RenameAssetModal` 在 Workspace/canvas 下的挂载文件），在其相邻处加 `<DeleteAssetModal />`。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/DeleteAssetModal.test.tsx src/components/canvas/ContextMenu.test.tsx`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/components/canvas/DeleteAssetModal.tsx src/components/canvas/DeleteAssetModal.test.tsx src/components/canvas/ContextMenu.tsx src/components/canvas/ContextMenu.test.tsx
git commit -m "feat: 新增删除二次确认弹窗 DeleteAssetModal 并接入右键菜单"
```

---

### Task 6: NodeCard 删除中态覆盖层

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`
- Test: `src/components/canvas/nodes/NodeCard.test.tsx`（若无则新建）

**Interfaces:**
- Consumes: `useStore((s) => s.deletingIds.includes(assetId))`。
- Produces: 无。

- [ ] **Step 1: 写失败测试(NodeCard.test.tsx)**

```tsx
test('deletingIds 含该卡时:aria-busy + spinner + 隐派生按钮', () => {
  useStore.setState({ deletingIds: ['a1'], assets: [asset('a1')] });
  render(<NodeCard kind="image" title="x" assetId="a1" selected>{null}</NodeCard>);
  expect(screen.getByRole('status', { name: /delet/i })).toBeInTheDocument();
});
```
（`asset`/i18n render 包装对齐目录既有测试；`role="status"` 来自 spinner。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现删除中态**

`NodeCard.tsx`:顶部加 `const deleting = useStore((s) => s.deletingIds.includes(assetId));`。根 div 加 `aria-busy={deleting}` 与条件类 `${deleting ? 'pointer-events-none opacity-60' : ''}`；派生「+」按钮渲染条件加 `&& !deleting`；`children` 之后加覆盖层：
```tsx
      {deleting && (
        <span aria-hidden className="anim-media-in absolute inset-0 grid place-items-center rounded-[16px] bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)]">
          <span role="status" aria-label={t('canvas.deleting')} className="size-5 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />
        </span>
      )}
```
（`t` 已在组件内。overlay `aria-hidden` 但内部 spinner 带 `role=status`+label——保留可访问的忙碌提示。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/nodes/NodeCard.tsx src/components/canvas/nodes/NodeCard.test.tsx
git commit -m "feat: 画布卡片删除中态(压暗+居中 spinner+禁交互)"
```

---

### Task 7: i18n 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`canvas.*` 增三键）

**Interfaces:**
- Produces: `canvas.deleteConfirmTitle`、`canvas.deleteConfirmBody`（`{{name}}`）、`canvas.deleting`。

- [ ] **Step 1: en 增键(单一真相源)**

`en.ts` 的 `canvas` 内（`rename`/`renamePlaceholder` 附近）加：
```ts
    deleteConfirmTitle: 'Delete asset?',
    deleteConfirmBody: '"{{name}}" will be permanently removed from the canvas.',
    deleting: 'Deleting',
```

- [ ] **Step 2: 补齐 zh/fr/ru/ja/vi**

各语言 `canvas` 内加对应翻译（示例 zh）：
```ts
    deleteConfirmTitle: '删除资产？',
    deleteConfirmBody: '“{{name}}”将从画布中永久移除。',
    deleting: '删除中',
```
（fr/ru/ja/vi 按各文件既有风格译；保留 `{{name}}` 插值。）

- [ ] **Step 3: i18n 一致性校验**

Run: `pnpm exec vitest run src/i18n`
Expected: PASS（若有键对齐测试则守护六语齐全）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 补删除确认/删除中六语文案"
```

---

### Task 8: 全量校验 + 运行态验证

- [ ] **Step 1: 全量检查**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
Expected: 三者全绿。

- [ ] **Step 2: 运行态验证(verify skill)**

用 `verify` / `run` 起 prod（Turbopack dev 因 Google Fonts 被墙可能 500，见 memory）驱动真实画布：hover 见炫光无位移；右键菜单三图标同色；改名落库（刷新仍在）；删除弹确认→卡转圈→消失；失败复原。

- [ ] **Step 3: 收尾**

按 `finishing-a-development-branch`：回合 dev + 清 worktree。

## Self-Review

- **Spec coverage**：#1→Task1；#2→Task2；#3→Task3；#4→Task4/5/6；i18n→Task7；验证→Task8。全覆盖。
- **Placeholder scan**：各步含实际代码 / 命令 / 期望；测试 helper 名以"对齐既有文件"说明（实现时读文件确认真实名），非空泛占位。
- **Type consistency**：`renameCanvasItem(pid,itemId,name)`、`renameAsset(id,label):Promise<void>`、`deletingIds:string[]`、`deleteTarget:{id}`、`openDeleteModal(id)` 在各 Task 一致；`guard` 返回 `Promise<boolean>` 全局兼容(既有调用忽略返回值)。
