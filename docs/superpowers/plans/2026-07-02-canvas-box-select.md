# 画布框选 + 整体删除/移动 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布支持左键拖动框选多个资产,并对选区做整体删除与整体移动。

**Architecture:** store 作单一真相源,`selectedAssetId: string | null` 升级为 `selectedIds: string[]`;ReactFlow 的框选/点击/加选经 `onSelectionChange` 单向镜像进 store;删除复用现有单卡 `deleteCanvasItem`(悲观删除 + deletingIds),移动复用 `persistAssetPosition`;右键菜单与二次确认弹窗按选区数量切单/多模式。

**Tech Stack:** Next.js 16 + React 19 · zustand + persist · `@xyflow/react` · react-i18next(六语) · Vitest + jsdom + Testing Library。

## Global Constraints

- 代码注释 / 计划 / commit message 一律用**中文**;commit 一句话总结。
- 状态变更走**纯函数 + 不可变更新**;store 是唯一真相源,组件只订阅/调 action,跨组件协调走 store 字段。
- 瞬态不落盘:`selectedIds` **不进** `partialize`。
- 位置归前端所有:整体移动本地即时落位,回写 reference 为 fire-and-forget(失败不阻塞 UI)。
- 不臆测后端字段;沿用既有 `pgcApi.deleteCanvasItem` / `updateCanvasReference`,`canvas_x/y` 取整。
- 错误分层:已知 `PgcError` 经 `guard` → Toast,非预期错误照抛。
- UI 复用 `globals.css` 令牌 / 既有基础组件 / 动效类,禁硬编码色值、禁造新组件/新 keyframes。
- i18n:en 为单一真相源,新增文案补齐 en/zh/fr/ru/ja/vi 六套。
- 每个 `await` 后校验 `get().currentProjectId` 未变(沿用现状,`deleteCanvasItem` 内已有)。
- 验证只信 `pnpm exec tsc --noEmit` 与 `pnpm test` 退出码(worktree 内 IDE 诊断可能误报)。

---

### Task 1: 选中态升级为多选(store + selectors)

把单选 `selectedAssetId` 升级为 `selectedIds: string[]`,新增 `setSelection`(幂等)/`clearSelection`,更新 selector 与 AssetCanvas 读取点。完成后单选行为不变、可表达多选,build 绿。

**Files:**
- Modify: `src/store/index.ts`(UIState 字段、init、actions、switchProjectSession)
- Modify: `src/store/selectors.ts:7-15`(`selectCanvasNodes` 签名)
- Modify: `src/components/canvas/AssetCanvas.tsx:388,474,485`(读 `selectedIds`)
- Create: `src/store/selection.test.ts`
- Modify: `src/store/selectors.test.ts`(补多选用例)

**Interfaces:**
- Produces:
  - `UIState.selectedIds: string[]`
  - `selectAsset(id: string | null): void` — 置 `[id]` 或 `[]`
  - `setSelection(ids: string[]): void` — 批量置,集合相等则 no-op
  - `clearSelection(): void` — 置 `[]`
  - `selectCanvasNodes(assets: Asset[], selectedIds: string[]): RFNode[]`

- [ ] **Step 1: 写失败测试(selectors 多选)**

在 `src/store/selectors.test.ts` 顶部已有 `selectCanvasNodes` 相关用例区补充(若无则新增 describe)。追加:

```ts
import { selectCanvasNodes } from './selectors';
import { makeAsset } from '@/lib/assets';

describe('selectCanvasNodes 多选', () => {
  test('selectedIds 内的节点 selected=true,其余 false', () => {
    const a = makeAsset('image', { label: 'A' });
    const b = makeAsset('image', { label: 'B' });
    const c = makeAsset('image', { label: 'C' });
    const nodes = selectCanvasNodes([a, b, c], [a.id, c.id]);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n.selected]));
    expect(byId[a.id]).toBe(true);
    expect(byId[b.id]).toBe(false);
    expect(byId[c.id]).toBe(true);
  });

  test('空 selectedIds:全部 false', () => {
    const a = makeAsset('image', { label: 'A' });
    expect(selectCanvasNodes([a], []).every((n) => n.selected === false)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: FAIL(`selectCanvasNodes` 仍是旧签名 `(assets, selectedId?)`,传数组时 `asset.id === selectedId` 恒为 false → 多选用例断言 true 失败)

- [ ] **Step 3: 改 `selectCanvasNodes` 签名收数组**

`src/store/selectors.ts:7-15` 改为:

```ts
export function selectCanvasNodes(assets: Asset[], selectedIds: string[] = []): RFNode[] {
  const set = new Set(selectedIds);
  return assets.map((asset) => ({
    id: asset.id,
    type: asset.kind,
    position: asset.position,
    data: { asset },
    selected: set.has(asset.id),
  }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: 写失败测试(store 选中 actions)**

Create `src/store/selection.test.ts`:

```ts
import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

beforeEach(() => {
  useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState(), selectedIds: [] } as never);
});

describe('选中态 actions', () => {
  test('selectAsset(id) 置单元素,selectAsset(null) 清空', () => {
    useStore.getState().selectAsset('x');
    expect(useStore.getState().selectedIds).toEqual(['x']);
    useStore.getState().selectAsset(null);
    expect(useStore.getState().selectedIds).toEqual([]);
  });

  test('setSelection 置多元素', () => {
    useStore.getState().setSelection(['a', 'b']);
    expect(useStore.getState().selectedIds).toEqual(['a', 'b']);
  });

  test('setSelection 幂等:集合相同(乱序)不换引用', () => {
    useStore.getState().setSelection(['a', 'b']);
    const before = useStore.getState().selectedIds;
    useStore.getState().setSelection(['b', 'a']);
    expect(useStore.getState().selectedIds).toBe(before); // 同引用 → 未触发变更
  });

  test('clearSelection 清空', () => {
    useStore.getState().setSelection(['a', 'b']);
    useStore.getState().clearSelection();
    expect(useStore.getState().selectedIds).toEqual([]);
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selection.test.ts`
Expected: FAIL(`selectedIds` / `setSelection` / `clearSelection` 未定义)

- [ ] **Step 7: 升级 store 选中态**

在 `src/store/index.ts` 依次改:

(a) `UIState` 接口(约 line 34):`selectedAssetId: string | null;` → `selectedIds: string[];`

(b) `Actions` 接口(约 line 66):`selectAsset: (id: string | null) => void;` 保留,并在其下新增:

```ts
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
```

(c) `ContextMenuState`(约 line 24)先保持不动(Task 3 再改)。init(约 line 108):`selectedAssetId: null,` → `selectedIds: [],`

(d) action 实现(约 line 229,替换 `selectAsset` 那一行):

```ts
      selectAsset: (id) => set({ selectedIds: id ? [id] : [] }),
      setSelection: (ids) =>
        set((s) => {
          const cur = s.selectedIds;
          // 集合相同(忽略顺序)→ no-op:阻断 onSelectionChange 回环、省重渲染
          if (cur.length === ids.length && ids.every((id) => cur.includes(id))) return {};
          return { selectedIds: ids };
        }),
      clearSelection: () => set({ selectedIds: [] }),
```

(e) `switchProjectSession`(约 line 141-154):在返回对象里补 `selectedIds: [],`(与现有 `deletingIds: []` / `deleteTarget: null` 同批清):

```ts
            // 切项目清瞬态:选区 / 删除中态 / 待确认删除弹窗不跨项目残留
            selectedIds: [],
            deletingIds: [],
            deleteTarget: null,
```

- [ ] **Step 8: 修 AssetCanvas 读取点(保持编译 + 单选不变)**

`src/components/canvas/AssetCanvas.tsx`:
- line 388:`const selectedAssetId = useStore((s) => s.selectedAssetId);` → `const selectedIds = useStore((s) => s.selectedIds);`
- line 474:`selectCanvasNodes(visibleAssets, selectedAssetId)` → `selectCanvasNodes(visibleAssets, selectedIds)`
- line 485 依赖数组:`selectedAssetId` → `selectedIds`

(`selectAsset` 在 onNodeClick/onNodeContextMenu/onPaneClick 的调用此步不动,语义已兼容:置 `[id]` / `[]`。)

- [ ] **Step 9: 跑测试 + 类型检查确认通过**

Run: `pnpm exec vitest run src/store/selection.test.ts src/store/selectors.test.ts && pnpm exec tsc --noEmit`
Expected: PASS + 无类型错误

- [ ] **Step 10: Commit**

```bash
git add src/store/index.ts src/store/selectors.ts src/store/selection.test.ts src/store/selectors.test.ts src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 画布选中态升级为多选 selectedIds(setSelection 幂等/clearSelection),selector 与画布读取点适配"
```

---

### Task 2: 整体移动(store `setAssetPositions` + 画布拖停批量落位)

新增批量落位 action,并把画布拖停 handler 改为对回调给的所有节点落位 + 逐个回写坐标(单卡是 `nodes.length===1` 特例)。

**Files:**
- Modify: `src/store/index.ts`(新增 `setAssetPositions`)
- Modify: `src/components/canvas/AssetCanvas.tsx`(拖停 handler)
- Modify: `src/store/selection.test.ts`(补 `setAssetPositions` 用例)

**Interfaces:**
- Consumes:`persistAssetPosition(itemId: string): Promise<void>`(现有 ServerAction)
- Produces:`setAssetPositions(list: { id: string; x: number; y: number }[]): void`

- [ ] **Step 1: 写失败测试**

在 `src/store/selection.test.ts` 追加:

```ts
import { makeAsset } from '@/lib/assets';

describe('setAssetPositions 批量落位', () => {
  test('仅更新列表内资产的 position,其余不动', () => {
    const a = { ...makeAsset('image', { label: 'A' }), position: { x: 0, y: 0 } };
    const b = { ...makeAsset('image', { label: 'B' }), position: { x: 0, y: 0 } };
    useStore.setState({ assets: [a, b] } as never);
    useStore.getState().setAssetPositions([{ id: a.id, x: 100, y: 200 }]);
    const next = useStore.getState().assets;
    expect(next.find((x) => x.id === a.id)!.position).toEqual({ x: 100, y: 200 });
    expect(next.find((x) => x.id === b.id)!.position).toEqual({ x: 0, y: 0 });
  });

  test('空列表 no-op', () => {
    const a = makeAsset('image', { label: 'A' });
    useStore.setState({ assets: [a] } as never);
    const before = useStore.getState().assets;
    useStore.getState().setAssetPositions([]);
    expect(useStore.getState().assets).toBe(before);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selection.test.ts`
Expected: FAIL(`setAssetPositions` 未定义)

- [ ] **Step 3: 实现 `setAssetPositions`**

`src/store/index.ts`:Actions 接口在 `setAssetPosition` 下补:

```ts
  setAssetPositions: (list: { id: string; x: number; y: number }[]) => void;
```

action 实现(紧邻现有 `setAssetPosition`,约 line 225):

```ts
      setAssetPositions: (list) =>
        set((s) => {
          if (list.length === 0) return {};
          const byId = new Map(list.map((p) => [p.id, p]));
          return {
            assets: s.assets.map((a) => {
              const p = byId.get(a.id);
              return p ? { ...a, position: { x: p.x, y: p.y } } : a;
            }),
          };
        }),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/selection.test.ts`
Expected: PASS

- [ ] **Step 5: 画布拖停 handler 改批量落位**

`src/components/canvas/AssetCanvas.tsx`:

(a) 在 `Inner()` 拿 action 处(约 line 385-392 区)补:

```ts
  const setAssetPositions = useStore((s) => s.setAssetPositions);
```

(b) 在 `Inner()` 内、`onTidy` 之后新增共用落位器:

```ts
  // 拖停统一落位:对回调给的所有节点(单卡拖=1,选区拖=N)一次性落位,再逐个 fire-and-forget 回写坐标(占位卡跳过)
  const persistDraggedNodes = useCallback(
    (nodes: Node[]) => {
      if (nodes.length === 0) return;
      setAssetPositions(nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })));
      for (const n of nodes) {
        if (!n.id.startsWith('pending_')) void useStore.getState().persistAssetPosition(n.id);
      }
    },
    [setAssetPositions],
  );
```

(c) 替换现有 `onNodeDragStop`(line 520-526),并新增选区拖起/拖停:

```tsx
        onNodeDragStart={() => {
          isDraggingRef.current = true;
        }}
        onNodeDragStop={(_, _node, nodes) => {
          persistDraggedNodes(nodes);
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 0);
        }}
        onSelectionDragStart={() => {
          isDraggingRef.current = true;
        }}
        onSelectionDragStop={(_, nodes) => {
          persistDraggedNodes(nodes);
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 0);
        }}
```

> 注:删掉原 `onNodeDragStop` 里对单节点的 `setAssetPosition` + `persistAssetPosition` 调用,统一走 `persistDraggedNodes`。`setAssetPosition`(单数)action 仍保留供他处使用,不删。

- [ ] **Step 6: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 通过(RF 拖停为交互行为,单测不覆盖,Task 6 手动验证)

- [ ] **Step 7: Commit**

```bash
git add src/store/index.ts src/store/selection.test.ts src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 画布拖停批量落位 setAssetPositions,单卡与选区拖动统一回写坐标"
```

---

### Task 3: 整体删除管线(store + 右键菜单 + 二次确认弹窗 + 六语文案)

把 `contextMenu` / `deleteTarget` 改带 `ids` 数组,新增 `deleteSelected`(复用单卡 `deleteCanvasItem`),右键命中多选走批量,弹窗按数量切单/多文案。

**Files:**
- Modify: `src/store/index.ts`(`ContextMenuState`、`deleteTarget`、`openDeleteModal`、`deleteSelected`)
- Modify: `src/components/canvas/AssetCanvas.tsx`(`onNodeContextMenu` 多选判定)
- Modify: `src/components/canvas/ContextMenu.tsx`(单/多模式)
- Modify: `src/components/canvas/DeleteAssetModal.tsx`(单/多文案 + 调 `deleteSelected`)
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`(三条新 key)
- Modify: `src/components/canvas/ContextMenu.test.tsx`、`src/components/canvas/DeleteAssetModal.test.tsx`
- Modify: `src/store/selection.test.ts`(补 `deleteSelected`)

**Interfaces:**
- Consumes:`deleteCanvasItem(itemId: string): Promise<void>`、`clearSelection()`
- Produces:
  - `ContextMenuState = { ids: string[]; x: number; y: number }`
  - `UIState.deleteTarget: { ids: string[] } | null`
  - `openDeleteModal(ids: string[]): void`
  - `deleteSelected(ids: string[]): Promise<void>`

- [ ] **Step 1: 加六语文案(en 真相源)**

`src/i18n/locales/en.ts`:
- `context` 对象(line 229-231)内补:`deleteN: 'Delete {{count}} items',`
- `deleteConfirmBody`(line 152)之后补:

```ts
    deleteConfirmTitleN: 'Delete {{count}} assets?',
    deleteConfirmBodyN: '{{count}} assets will be permanently removed from the canvas.',
```

其余五语在对应位置补(键名一致,值本地化):

`zh.ts`:`deleteN: '删除 {{count}} 项',`;`deleteConfirmTitleN: '删除 {{count}} 个资产？',`;`deleteConfirmBodyN: '{{count}} 个资产将从画布中永久移除。',`

`fr.ts`:`deleteN: 'Supprimer {{count}} éléments',`;`deleteConfirmTitleN: 'Supprimer {{count}} ressources ?',`;`deleteConfirmBodyN: '{{count}} ressources seront définitivement retirées du canevas.',`

`ru.ts`:`deleteN: 'Удалить {{count}} эл.',`;`deleteConfirmTitleN: 'Удалить ресурсов: {{count}}?',`;`deleteConfirmBodyN: '{{count}} ресурсов будут безвозвратно удалены с холста.',`

`ja.ts`:`deleteN: '{{count}} 件を削除',`;`deleteConfirmTitleN: '{{count}} 件のアセットを削除しますか？',`;`deleteConfirmBodyN: '{{count}} 件のアセットがキャンバスから完全に削除されます。',`

`vi.ts`:`deleteN: 'Xóa {{count}} mục',`;`deleteConfirmTitleN: 'Xóa {{count}} tài nguyên?',`;`deleteConfirmBodyN: '{{count}} tài nguyên sẽ bị xóa vĩnh viễn khỏi canvas.',`

- [ ] **Step 2: 跑类型检查(en 是 `as const` 真相源,六语须同构)**

Run: `pnpm exec tsc --noEmit`
Expected: PASS(若某语漏键,`DeepStringify` 会报缺失字段)

- [ ] **Step 3: 写失败测试(store `deleteSelected`)**

`src/store/selection.test.ts` 追加:

```ts
import { vi } from 'vitest';

describe('deleteSelected 整体删除', () => {
  test('对每个 id 调 deleteCanvasItem 并末尾清空选区', async () => {
    const del = vi.fn(async () => {});
    useStore.setState({ deleteCanvasItem: del, selectedIds: ['a', 'b'] } as never);
    await useStore.getState().deleteSelected(['a', 'b']);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith('a');
    expect(del).toHaveBeenCalledWith('b');
    expect(useStore.getState().selectedIds).toEqual([]);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/selection.test.ts`
Expected: FAIL(`deleteSelected` 未定义)

- [ ] **Step 5: store 类型与 action 改造**

`src/store/index.ts`:

(a) `ContextMenuState`(line 24):

```ts
export interface ContextMenuState { ids: string[]; x: number; y: number; }
```

(b) `UIState`(line 37):`deleteTarget: { id: string } | null;` → `deleteTarget: { ids: string[] } | null;`

(c) `Actions` 接口:`openDeleteModal: (id: string) => void;` → `openDeleteModal: (ids: string[]) => void;`;在其附近新增:

```ts
  deleteSelected: (ids: string[]) => Promise<void>;
```

(d) action 实现:`openDeleteModal`(line 233)改:

```ts
      openDeleteModal: (ids) => set({ deleteTarget: { ids } }),
```

在 `closeDeleteModal` 附近新增(复用现有单卡删除 action + 清选区,DRY):

```ts
      // 整体删除:逐个复用 deleteCanvasItem(内含 pending 处理 / deletingIds 删除中态 / guard 悲观流),末尾清空选区
      deleteSelected: async (ids) => {
        await Promise.all(ids.map((id) => get().deleteCanvasItem(id)));
        get().clearSelection();
      },
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/selection.test.ts`
Expected: PASS

- [ ] **Step 7: 改右键菜单组件(单/多模式)**

`src/components/canvas/ContextMenu.tsx` 整体替换 body(保留顶部 import + `POPOVER_SHADOW`):

```tsx
export default function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const assets = useStore((s) => s.assets);
  const close = useStore((s) => s.openContextMenu);
  const addRef = useStore((s) => s.addRef);
  const openRenameModal = useStore((s) => s.openRenameModal);
  const openDeleteModal = useStore((s) => s.openDeleteModal);

  const { t } = useTranslation();

  if (!menu) return null;
  const multi = menu.ids.length > 1;
  // 单选:需能取到该资产;多选:不依赖单个资产
  const asset = multi ? null : assets.find((a) => a.id === menu.ids[0]);
  if (!multi && !asset) return null;

  const items: { icon: string; label: string; onClick: () => void }[] = multi
    ? [
        {
          icon: figAsset.trash,
          label: t('canvas.context.deleteN', { count: menu.ids.length }),
          onClick: () => {
            openDeleteModal(menu.ids);
            close(null);
          },
        },
      ]
    : [
        {
          icon: figAsset.at,
          label: t('canvas.context.useAsRef'),
          onClick: () => {
            addRef(asset!.key);
            close(null);
          },
        },
        {
          icon: figAsset.pencil,
          label: t('canvas.rename'),
          onClick: () => {
            openRenameModal(asset!.id);
            close(null);
          },
        },
        {
          icon: figAsset.trash,
          label: t('common.delete'),
          onClick: () => {
            openDeleteModal(menu.ids);
            close(null);
          },
        },
      ];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => close(null)} onWheel={() => close(null)} />
      <div
        className="anim-pop-in origin-top-left fixed z-50 flex w-[276px] flex-col gap-0.5 overflow-hidden rounded-[20px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 backdrop-blur-[12px]"
        style={{ left: menu.x, top: menu.y, boxShadow: POPOVER_SHADOW }}
      >
        {items.map((it) => (
          <button
            key={it.label}
            onClick={it.onClick}
            className="flex h-10 items-center gap-3 self-stretch rounded-[12px] py-1 pl-1 pr-3 text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="grid size-8 shrink-0 place-items-center">
              <FigIcon src={it.icon} size={20} tone="primary" />
            </span>
            <span className="flex-1 text-[12px] font-semibold leading-4 tracking-[-0.12px] text-[var(--color-ink)]">
              {it.label}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 8: 改画布右键判定(命中多选不塌陷)**

`src/components/canvas/AssetCanvas.tsx` 的 `onNodeContextMenu`(line 512-516)替换为:

```tsx
        onNodeContextMenu={(e, n) => {
          e.preventDefault();
          const sel = useStore.getState().selectedIds;
          // 右击已在多选内的节点 → 对整个选区操作(不塌陷);否则单选该卡
          if (sel.includes(n.id) && sel.length > 1) {
            openContextMenu({ ids: sel, x: e.clientX, y: e.clientY });
          } else {
            selectAsset(n.id);
            openContextMenu({ ids: [n.id], x: e.clientX, y: e.clientY });
          }
        }}
```

- [ ] **Step 9: 改二次确认弹窗(单/多文案 + 调 deleteSelected)**

`src/components/canvas/DeleteAssetModal.tsx` 替换 body:

```tsx
export default function DeleteAssetModal() {
  const target = useStore((s) => s.deleteTarget);
  const assets = useStore((s) => s.assets);
  const del = useStore((s) => s.deleteSelected);
  const close = useStore((s) => s.closeDeleteModal);
  const { closing, requestClose } = useRequestClose(close, 200);
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const ids = target?.ids ?? [];
  const single = ids.length === 1 ? assets.find((a) => a.id === ids[0]) : null;
  if (!target || ids.length === 0) return null;
  if (ids.length === 1 && !single) return null;   // 单删但资产已不在(竞态)→ 不渲染

  const multi = ids.length > 1;
  const title = multi ? t('canvas.deleteConfirmTitleN', { count: ids.length }) : t('canvas.deleteConfirmTitle');
  const body = multi
    ? t('canvas.deleteConfirmBodyN', { count: ids.length })
    : t('canvas.deleteConfirmBody', { name: single!.label });

  const confirm = () => { void del(ids); requestClose(); };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8"
      data-closing={closing}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={requestClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-4 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{title}</span>
        <span className="text-[13px] leading-5 text-[var(--color-muted)]">{body}</span>
        <div className="flex items-center justify-end gap-2">
          <button type="button" autoFocus onClick={requestClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('common.cancel')}</button>
          <button type="button" onClick={confirm} className="h-10 rounded-[10px] px-4 text-[13px] font-semibold text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]">{t('common.delete')}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: 更新组件测试(单模式适配 + 多模式新增)**

`src/components/canvas/ContextMenu.test.tsx`:
- `seed()` 内 `contextMenu: { id: asset.id, ... }` → `contextMenu: { ids: [asset.id], x: 100, y: 100 }`
- 「点 Delete」用例断言 `deleteTarget` 由 `{ id: asset.id }` → `{ ids: [asset.id] }`
- 追加多选用例:

```ts
test('多选:仅显示「删除 N 项」,点击置 deleteTarget={ids} 并关菜单', () => {
  const a = makeAsset('image', { label: 'A' });
  const b = makeAsset('image', { label: 'B' });
  useStore.setState({ assets: [a, b], contextMenu: { ids: [a.id, b.id], x: 10, y: 10 } } as never);
  const { getByText, queryByText } = render(<ContextMenu />);
  expect(queryByText('Use as reference')).toBeNull();
  fireEvent.click(getByText('Delete 2 items'));
  expect(useStore.getState().deleteTarget).toEqual({ ids: [a.id, b.id] });
  expect(useStore.getState().contextMenu).toBeNull();
});
```

`src/components/canvas/DeleteAssetModal.test.tsx`:
- `seed()` 内 `deleteTarget: { id: asset.id }` → `deleteTarget: { ids: [asset.id] }`
- 三处 `useStore.setState({ deleteCanvasItem: del } ...)` → `useStore.setState({ deleteSelected: del } ...)`
- 「点 Delete」断言 `expect(del).toHaveBeenCalledWith(asset.id)` → `expect(del).toHaveBeenCalledWith([asset.id])`
- 追加多选用例:

```ts
test('多选:正文含数量,确认调 deleteSelected(ids)', () => {
  const a = makeAsset('image', { label: 'A' });
  const b = makeAsset('image', { label: 'B' });
  const del = vi.fn();
  useStore.setState({ assets: [a, b], deleteTarget: { ids: [a.id, b.id] }, deleteSelected: del } as never);
  render(<DeleteAssetModal />);
  expect(screen.getByRole('dialog').textContent).toContain('2');
  fireEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(del).toHaveBeenCalledWith([a.id, b.id]);
});
```

- [ ] **Step 11: 跑相关测试 + 类型检查**

Run: `pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx src/components/canvas/DeleteAssetModal.test.tsx src/store/selection.test.ts && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/store/index.ts src/components/canvas/AssetCanvas.tsx src/components/canvas/ContextMenu.tsx src/components/canvas/DeleteAssetModal.tsx src/i18n/locales src/components/canvas/ContextMenu.test.tsx src/components/canvas/DeleteAssetModal.test.tsx src/store/selection.test.ts
git commit -m "feat: 画布整体删除管线 deleteSelected(复用单卡悲观删除),右键菜单/二次确认弹窗按选区数量切单多模式,补六语文案"
```

---

### Task 4: 画布导航与框选接线 + 键盘删除(AssetCanvas + globals.css)

启用左键框选、中键/触控板平移、禁用 RF 原生删除键;`onSelectionChange` 镜像选中入 store;接 Delete/Backspace 键开确认弹窗;框选矩形令牌化样式。

**Files:**
- Create: `src/lib/canvas-keys.ts`(键盘删除判定纯函数)
- Create: `src/lib/canvas-keys.test.ts`
- Modify: `src/components/canvas/AssetCanvas.tsx`(RF props、onSelectionChange、键盘、移除 onNodeClick)
- Modify: `src/app/globals.css`(`.react-flow__selection`)

**Interfaces:**
- Consumes:`setSelection(ids)`、`openDeleteModal(ids)`、`selectedIds`
- Produces:`shouldTriggerCanvasDelete(key: string, hasSelection: boolean, activeEl: Element | null): boolean`

- [ ] **Step 1: 写失败测试(键盘删除判定)**

Create `src/lib/canvas-keys.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { shouldTriggerCanvasDelete } from './canvas-keys';

const input = document.createElement('input');
const div = document.createElement('div');

describe('shouldTriggerCanvasDelete', () => {
  test('Delete/Backspace + 有选中 + 焦点非输入 → true', () => {
    expect(shouldTriggerCanvasDelete('Delete', true, div)).toBe(true);
    expect(shouldTriggerCanvasDelete('Backspace', true, null)).toBe(true);
  });
  test('非删除键 → false', () => {
    expect(shouldTriggerCanvasDelete('a', true, div)).toBe(false);
  });
  test('无选中 → false', () => {
    expect(shouldTriggerCanvasDelete('Delete', false, div)).toBe(false);
  });
  test('焦点在输入框 → false(放行输入删字)', () => {
    expect(shouldTriggerCanvasDelete('Backspace', true, input)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/canvas-keys.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现判定纯函数**

Create `src/lib/canvas-keys.ts`:

```ts
// 画布框选删除的键盘触发判定(纯函数,便于单测)。
// Delete/Backspace + 有选中 + 焦点不在输入类元素时才触发(否则放行输入自身删字)。
export function shouldTriggerCanvasDelete(
  key: string,
  hasSelection: boolean,
  activeEl: Element | null,
): boolean {
  if (key !== 'Delete' && key !== 'Backspace') return false;
  if (!hasSelection) return false;
  const el = activeEl as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return false;
  return true;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/canvas-keys.test.ts`
Expected: PASS

- [ ] **Step 5: 画布接线(RF props + onSelectionChange + 键盘 + 移除 onNodeClick)**

`src/components/canvas/AssetCanvas.tsx`:

(a) 顶部 import 补:

```ts
import { shouldTriggerCanvasDelete } from '@/lib/canvas-keys';
```

(b) 模块级常量(靠近 `edgeTypes` 定义,约 line 31)新增:

```ts
// 中键(button 1)拖平移;左键留给框选。模块级常量避免每次渲染新建数组触发 RF 重init
const PAN_ON_DRAG = [1];
```

(c) `Inner()` 拿 action 处补:

```ts
  const setSelection = useStore((s) => s.setSelection);
  const openDeleteModal = useStore((s) => s.openDeleteModal);
```

(d) `Inner()` 内新增 onSelectionChange 与键盘删除 effect(放在 ⌘K effect 附近):

```ts
  // RF 选中(点击/加选/框选)→ store 单向镜像(setSelection 幂等,防回环)
  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => setSelection(nodes.map((n) => n.id)),
    [setSelection],
  );

  // Delete/Backspace:有选中且焦点非输入 → 开二次确认弹窗(不直删,安全优先)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ids = useStore.getState().selectedIds;
      if (!shouldTriggerCanvasDelete(e.key, ids.length > 0, document.activeElement)) return;
      e.preventDefault();
      openDeleteModal(ids);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDeleteModal]);
```

(e) `<ReactFlow>` 上:
- **删除** `onNodeClick={(_, n) => selectAsset(n.id)}` 这一行(选中改由 onSelectionChange 回流)
- `onPaneClick` 改为只关右键菜单(选区清空交给 RF pane 点击 → onSelectionChange([])):

```tsx
        onPaneClick={() => {
          openContextMenu(null);
        }}
```
- 新增/调整以下 props(与现有 `zoomOnDoubleClick={false}` 等并列):

```tsx
        selectionOnDrag
        panOnDrag={PAN_ON_DRAG}
        panOnScroll
        deleteKeyCode={null}
        onSelectionChange={onSelectionChange}
```

> `selectAsset` 若在本文件已无其他引用,则从 `useStore` 解构处一并删除以免 unused(`onNodeContextMenu` 仍用 `useStore.getState().selectedIds` 与 `selectAsset` —— 注意 Task 3 的 `onNodeContextMenu` 单选分支调用了 `selectAsset(n.id)`,故 `selectAsset` 仍需保留)。

- [ ] **Step 6: 框选矩形令牌化样式**

`src/app/globals.css`:在 `.canvas-tidying .react-flow__node { transition: transform ... }`(约 line 593)之后追加:

```css
/* 画布左键框选矩形:复用 accent 令牌(RF 默认偏灰),对齐画布选中态蓝色系 */
.react-flow__selection {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border: 1px solid var(--color-accent);
}
```

- [ ] **Step 7: 类型检查 + 全量测试**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 通过

- [ ] **Step 8: Commit**

```bash
git add src/lib/canvas-keys.ts src/lib/canvas-keys.test.ts src/components/canvas/AssetCanvas.tsx src/app/globals.css
git commit -m "feat: 画布纯左键框选(selectionOnDrag)+中键/触控板平移,onSelectionChange 镜像选中,Delete/Backspace 开确认弹窗,框选矩形令牌化"
```

---

### Task 5: 节点卡单选专属操作收敛(NodeCard)

多选时不在每张卡冒出「+」(从此生成)与左连接点蓝点——仅当选区恰为本卡(soleSelected)时显示;蓝框/流光仍按 `selected`(所有框选卡高亮)。

**Files:**
- Modify: `src/components/canvas/nodes/NodeCard.tsx`
- Modify: `src/components/canvas/nodes/NodeCard.test.tsx`

**Interfaces:**
- Consumes:`UIState.selectedIds`

- [ ] **Step 1: 写失败测试**

`src/components/canvas/nodes/NodeCard.test.tsx` 追加(注意 image 可派生 → 单选时应出现「Generate from this asset」按钮):

```ts
describe('NodeCard 单选专属「+」', () => {
  test('soleSelected(选区恰为本卡):显示从此生成按钮', () => {
    const asset = makeAsset('image', { label: '主角' });
    useStore.setState({ assets: [asset], selectedIds: [asset.id] } as never);
    renderCard(asset.id);
    expect(screen.getByRole('button', { name: /generate from/i })).toBeInTheDocument();
  });

  test('多选(选区不止本卡):不显示从此生成按钮', () => {
    const asset = makeAsset('image', { label: '主角' });
    useStore.setState({ assets: [asset], selectedIds: [asset.id, 'other'] } as never);
    renderCard(asset.id);
    expect(screen.queryByRole('button', { name: /generate from/i })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: FAIL(现「+」按钮由 `selected` prop 控制,`renderCard` 未传 `selected` → 单选用例拿不到按钮)

- [ ] **Step 3: NodeCard 用 soleSelected 收敛**

`src/components/canvas/nodes/NodeCard.tsx`:

(a) 在 `hasParent` 那行(line 50)之后补:

```ts
  // 选区恰为本卡:仅此时露出单选专属操作(从此生成「+」/ 左连接点),多选不逐卡冒出
  const soleSelected = useStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === assetId);
```

(b) `showLeftDot`(line 51)改:

```ts
  const showLeftDot = soleSelected && hasParent;
```

(c) 「+」按钮条件(line 78)`selected && !deleting && derivableKinds(kind).length > 0` → `soleSelected && !deleting && derivableKinds(kind).length > 0`

(蓝框/流光 `.node-beam`(line 61-67)仍用 `selected`,不改。)

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/canvas/nodes/NodeCard.test.tsx`
Expected: PASS

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/nodes/NodeCard.tsx src/components/canvas/nodes/NodeCard.test.tsx
git commit -m "feat: 画布节点卡「+」与左连接点收敛为 soleSelected(多选不逐卡冒出),高亮仍随 selected"
```

---

### Task 6: 全量校验与运行态验证

**Files:** 无(仅校验)

- [ ] **Step 1: 全量门禁**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test`
Expected: lint 无错;tsc 无错;测试全绿(基线 934 + 本次新增)

- [ ] **Step 2: 构建**

Run: `pnpm build`
Expected: 成功(Tailwind 扫描六语文档无非法 class;无类型/编译错误)

- [ ] **Step 3: 运行态手动验证(参考 verify/run skill)**

启动 dev(注意端口占用:`runtime-verification-local-gotchas` 记忆),逐项确认:
- 空白处**左键拖** → 出现蓝色框选矩形,框住的卡全部高亮(蓝框)。
- **中键拖** / **触控板双指滚动** → 平移画布;**捏合** → 缩放(滚轮此时为平移,符合权衡)。
- 框选多张后**拖动其中一张** → 整体移动;刷新后位置保留(已回写)。
- 框选多张 **右键** → 菜单仅「删除 N 项」;点它 → 弹「删除 N 个资产？」;确认 → 多卡同时进删除中态并移除。
- 框选多张按 **Delete/Backspace** → 同样弹确认弹窗(焦点在搜索框时按 Backspace 不误触发)。
- 单选一张 → 右键为完整菜单(引用/改名/删除);卡右侧「+」正常;多选时各卡不再冒「+」。
- 点空白 → 选区清空。

- [ ] **Step 4:(若运行态发现问题)记录并回到对应 Task 修复,否则进入收尾**

按 `superpowers:finishing-a-development-branch` 决定合并回 dev / 清理 worktree。

---

## Self-Review(计划对照 spec)

**Spec 覆盖:**
- §1 交互模型 → Task 4(selectionOnDrag / panOnDrag=[1] / panOnScroll / deleteKeyCode=null)✓
- §2 选中态模型 → Task 1(selectedIds / setSelection 幂等 / clearSelection / selectCanvasNodes / switchProjectSession 清)+ Task 4(onSelectionChange 唯一入口、移除 onNodeClick)✓
- §3 整体移动 → Task 2(setAssetPositions + 拖停批量落位 + persistAssetPosition)✓
- §4 整体删除 → Task 3(contextMenu/deleteTarget 改 ids、openDeleteModal(ids)、deleteSelected、右键多选、单/多弹窗)+ Task 4(键盘删除)✓
- §5 节点卡收敛 → Task 5(soleSelected 收敛 +/连接点)✓
- §6 i18n → Task 3 Step 1(六语三键)✓
- §7 视觉 → Task 4 Step 6(`.react-flow__selection` 令牌化)✓
- §8 测试 → 各 Task 内 TDD(selectors / selection / ContextMenu / DeleteAssetModal / NodeCard / canvas-keys)✓

**占位符扫描:** 无 TBD/TODO;每个代码步含完整代码。

**类型一致性:** `selectedIds`/`setSelection`/`clearSelection`/`setAssetPositions`/`deleteSelected`/`openDeleteModal(ids)`/`ContextMenuState{ids}`/`deleteTarget{ids}`/`shouldTriggerCanvasDelete` 在定义与消费处签名一致。

**权衡点(spec §开放点,已在 Task 6 手动验证覆盖):** `panOnScroll` 致鼠标滚轮由缩放变平移;Delete/Backspace 只开弹窗不直删。
