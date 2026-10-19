# 项目压缩包导入（Import Project）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 ProjectMenu 选「导入项目」，上传 `.zip/.tar/.tar.gz/.tgz` 压缩包 → 后端建新项目（v1）→ 前端自动切过去并把包内素材落画布。

**Architecture:** 沿单向数据流：新增 pgc client 函数（multipart）→ 新增 store action（guardRethrow 让模态感知失败）→ 新组件 `ImportProjectModal` + `ProjectMenu` 菜单项。落画布复用 `/canvas/items/import` 通路与 `card-layout` 落位。

**Tech Stack:** Next.js 16 + React 19、zustand、vitest（jsdom）、react-i18next。

**Spec:** `docs/superpowers/specs/2026-07-08-project-zip-import-design.md`（含后端契约要点，实现前先读）。

## Global Constraints

- 执行前按用户约定基于 dev 创建 worktree：`feat/project-zip-import`（superpowers:using-git-worktrees）；完成后回合 dev（`--no-ff`，message 含分支名）并清理。
- 注释 / commit message 一律中文；注释解释「为什么」。
- 只取后端文档字段（snake_case），不加臆测兜底别名。
- 颜色/圆角/阴影/动效全走 `globals.css` 既有令牌与 `.modal-pop` 等动效类；无硬编码色值。
- i18n 六语（en/zh/fr/ru/ja/vi），en 为真相源；交互元素带 `aria-label`。
- 每个 `await` 后校验 `currentProjectId` 才写 store。
- 验证只信命令退出码：`pnpm exec vitest run <file>` / `pnpm exec tsc --noEmit` / `pnpm lint`（worktree 内 IDE 诊断误报不作数）。
- 与 spec 的一处偏差（已确认合理）：导入中态用模态本地 `busy`（对齐 CreateGameModal 先例），不加 UIState `importingProject`。

---

### Task 1: pgc 类型 + client `importProjectArchive`

**Files:**
- Modify: `src/lib/pgc/types.ts`（文件尾追加）
- Modify: `src/lib/pgc/client.ts`（`uploadProjectCover` 附近追加）
- Test: `src/lib/pgc/client.test.ts`（文件尾追加 describe）

**Interfaces:**
- Produces: `importProjectArchive(file: File, name: string): Promise<ImportProjectData>`；类型 `ImportProjectData` / `ImportAssetData`。

- [ ] **Step 1: 写失败测试**（`client.test.ts` 尾部追加；沿用文件顶部既有 `mockJson` 与 `vi.stubGlobal('fetch')`）

```ts
describe('importProjectArchive(压缩包导入)', () => {
  const importData = {
    id: 7, public_id: 'pubx', name: 'My Game', cover_url: null, cover_source: null,
    current_version_id: 'v1', status: 'draft', created_at: '', updated_at: '',
    version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x',
    file_count: 12, assets: [],
  };

  test('POST multipart 到 /api/projects/import,FormData 带 file+name', async () => {
    const f = fetch as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(mockJson({ success: true, code: 'OK', message: 'OK', data: importData }));
    const file = new File(['zipbytes'], 'game.zip', { type: 'application/zip' });
    const d = await importProjectArchive(file, 'My Game');
    expect(d.id).toBe(7);
    expect(d.assets).toEqual([]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/pgc/api/projects/import');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    const fd = init.body as FormData;
    expect(fd.get('file')).toBe(file);
    expect(fd.get('name')).toBe('My Game');
  });

  test('422 错误信封抛 PgcError 带后端 code/message', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJson({ success: false, code: 'ARCHIVE_UNSUPPORTED_FORMAT', message: '不支持的格式', data: null }, false, 422),
    );
    const file = new File(['x'], 'game.rar');
    await expect(importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ARCHIVE_UNSUPPORTED_FORMAT', status: 422 });
  });
});
```

同时把文件顶部 import 改为：

```ts
import { PgcError, pgcApi, uploadCanvasItem, downloadVersion, importProjectArchive } from './client';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: FAIL —— `importProjectArchive` 未导出。

- [ ] **Step 3: 实现类型与函数**

`src/lib/pgc/types.ts` 尾部追加：

```ts
// ---- 项目压缩包导入(POST /api/projects/import;契约见 apifox Import Project) ----
// 包内 src/assets/ 下识别出的可上画布资产;source_url 交 /canvas/items/import 落库
export interface ImportAssetData {
  type: string;                     // 与画布 import 的 type 同枚举(image/video/audio/model3d)
  rel_path: string;
  name: string;
  source_url: string;
  thumbnail_url?: string | null;    // 3D 缩略图 sidecar
  meta_url?: string | null;         // 3D 元数据 sidecar
}
// ProjectData 超集 + 导入版本状态/链接;导入不写 canvas_items,assets 由前端逐条登记
export interface ImportProjectData extends ProjectData {
  version_id: string;
  version_status: string;           // ready(含 dist/index.html) | needs_build
  play_url: string;
  preview_url: string;
  file_count: number;
  assets: ImportAssetData[];
}
```

`src/lib/pgc/client.ts`：import 类型清单里加 `ImportProjectData`，并在 `uploadProjectCover` 后追加：

```ts
// 导入外部压缩包为新项目(multipart 字段 file+name)。格式/大小校验全在后端
// (422 ARCHIVE_* / 413),前端不预校验;无进度需求,fetch + FormData 即可
// (浏览器自动生成 multipart 边界,不能手写 Content-Type)。
export async function importProjectArchive(file: File, name: string): Promise<ImportProjectData> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', name);
  const res = await fetch(`${PREFIX}/api/projects/import`, {
    method: 'POST', credentials: 'include', body: fd,
  });
  return unwrap<ImportProjectData>(res);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS（全部用例，含既有）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: pgc client 新增压缩包导入项目接口"
```

---

### Task 2: store action `importProjectArchive`

**Files:**
- Modify: `src/store/actions.ts`
- Test: `src/store/actions.test.ts`（尾部追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `importProjectArchive`（client）与 `ImportProjectData`。
- Produces: store action `importProjectArchive(file: File, name: string): Promise<void>`——失败 reject（供模态保留弹窗），成功后 `currentProjectId` 切到新项目且 `assets` 含已导入素材。

- [ ] **Step 1: 写失败测试**（`actions.test.ts`：顶部 `vi.mock('@/lib/pgc/client', ...)` 的返回对象里**新增一行** `importProjectArchive: vi.fn(),`；import 行加 `importProjectArchive`；尾部追加）

```ts
describe('importProjectArchive(压缩包导入项目)', () => {
  const importArchiveMock = importProjectArchive as unknown as ReturnType<typeof vi.fn>;
  const importedProject = {
    ...proj(9, 'Imported'),
    version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x', file_count: 3,
    assets: [
      { type: 'image', rel_path: 'src/assets/hero.png', name: 'hero', source_url: '/pv/x/hero.png', thumbnail_url: null, meta_url: null },
      { type: 'audio', rel_path: 'src/assets/bgm.mp3', name: 'bgm', source_url: '/pv/x/bgm.mp3', thumbnail_url: null, meta_url: null },
    ],
  };
  const file = new File(['z'], 'game.zip');

  beforeEach(() => {
    // selectProject 内 loadCanvas/loadVersions 需要可解析的返回
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
  });

  test('成功:并入项目列表、切到新项目、逐条落画布', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    api.writeCanvasItemFromUrl
      .mockResolvedValueOnce({ item_id: 'ci1', type: 'image', name: 'hero', status: 'ready', canvas_x: 0, canvas_y: 0 })
      .mockResolvedValueOnce({ item_id: 'ci2', type: 'audio', name: 'bgm', status: 'ready', canvas_x: 0, canvas_y: 260 });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    const s = useStore.getState();
    expect(importArchiveMock).toHaveBeenCalledWith(file, 'Imported');
    expect(s.currentProjectId).toBe(9);
    expect(s.projects.map((p) => p.id)).toContain(9);
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(2);
    // type 直传枚举、name/reference 对齐契约
    expect(api.writeCanvasItemFromUrl.mock.calls[0][1]).toMatchObject({
      type: 'image', name: 'hero', reference: { import_rel_path: 'src/assets/hero.png' },
    });
    expect(s.assets.map((a) => a.id)).toEqual(['ci1', 'ci2']);
  });

  test('上传失败:reject + lastError,不切项目', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ARCHIVE_TOO_LARGE', '包太大', 413));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE' });
    expect(useStore.getState().currentProjectId).toBe(1);
    expect(useStore.getState().lastError?.code).toBe('ARCHIVE_TOO_LARGE');
  });

  test('落画布途中切走项目:丢弃后续写入', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    // 第一条 import 返回时模拟用户已切走
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      useStore.setState({ currentProjectId: 1 });
      return { item_id: 'ci1', type: 'image', name: 'hero', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    expect(api.writeCanvasItemFromUrl).toHaveBeenCalledTimes(1);   // 第二条不再发起
    expect(useStore.getState().assets).toEqual([]);                 // 过期写入被丢弃
  });

  test('单条素材失败:其余照常,弹一次部分失败 Toast', async () => {
    importArchiveMock.mockResolvedValue(importedProject);
    api.writeCanvasItemFromUrl
      .mockRejectedValueOnce(new PgcError('IMPORT_FAILED', 'x', 500))
      .mockResolvedValueOnce({ item_id: 'ci2', type: 'audio', name: 'bgm', status: 'ready', canvas_x: 0, canvas_y: 0 });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    const s = useStore.getState();
    expect(s.assets.map((a) => a.id)).toEqual(['ci2']);
    expect(s.lastError?.code).toBe('IMPORT_ASSETS_PARTIAL');
  });
});
```

import 行改为（在既有 client import 中追加）：

```ts
import { pgcApi, PgcError, uploadCanvasItem, importProjectArchive } from '@/lib/pgc/client';
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t importProjectArchive`
Expected: FAIL —— store 无 `importProjectArchive` action。

- [ ] **Step 3: 实现 action**

`src/store/actions.ts`：
1. 顶部 import 从 `@/lib/pgc/client` 追加 `importProjectArchive as importProjectArchiveApi`；从 `@/lib/pgc/types` 追加 `ImportProjectData`（类型 import 行）。
2. 在 `importLibraryAsset` 之后追加（`IMPORT_TYPES` 常量已在其上方定义，直接复用）：

```ts
  // 导入外部压缩包为新项目:上传 → 并入列表并切过去 → 包内识别素材逐条落画布。
  // guardRethrow:上传失败需让 Modal 感知(保留弹窗换文件重试),同时照常写 lastError→Toast。
  // 素材落画布失败不阻断(项目已建成),逐条累计后只弹一次部分失败 Toast。
  const importProjectArchive = async (file: File, name: string) => guardRethrow(set, async () => {
    const data: ImportProjectData = await importProjectArchiveApi(file, name);
    // ImportProjectData 是 ProjectData 超集:摘取列表字段并入 projects(与 createProject 同构)
    const p = {
      id: data.id, public_id: data.public_id, name: data.name,
      cover_url: data.cover_url, cover_source: data.cover_source,
      current_version_id: data.current_version_id, status: data.status,
      created_at: data.created_at, updated_at: data.updated_at,
    };
    set({ projects: [p, ...get().projects] });
    await selectProject(data.id);
    if (get().currentProjectId !== data.id) return;   // await 期间用户已切走:放弃落画布
    // 新项目画布恒空,从视口中心级联落位;occupied 随写入增长防重叠
    const occupied: XY[] = [];
    const origin = getViewportCenter() ?? { x: 0, y: 0 };
    let failed = 0;
    for (const [i, asset] of data.assets.entries()) {
      if (get().currentProjectId !== data.id) return;   // 每轮 await 后复查,过期即弃
      const sourceUrl = resolveAssetUrl(asset.source_url);
      if (!sourceUrl) { failed += 1; continue; }
      const pos = avoidOverlap(cascadePosition(origin, i), occupied);
      occupied.push(pos);
      try {
        const item = await pgcApi.writeCanvasItemFromUrl(data.id, {
          source_url: sourceUrl,
          // 域内枚举直传;域外(后端新增形态)传 null 由后端按 content-type 推断(对齐素材库导入)
          type: (IMPORT_TYPES as readonly string[]).includes(asset.type)
            ? (asset.type as (typeof IMPORT_TYPES)[number]) : null,
          name: asset.name,
          canvas_x: Math.round(pos.x), canvas_y: Math.round(pos.y),   // 后端 int,取整
          reference: { import_rel_path: asset.rel_path },   // 溯源:后端原样回显
        });
        if (get().currentProjectId !== data.id) return;
        set({ assets: [...get().assets, canvasItemToAsset(item)] });
      } catch { failed += 1; }
    }
    if (failed > 0 && get().currentProjectId === data.id) {
      set({ lastError: { code: 'IMPORT_ASSETS_PARTIAL', message: `${failed} asset(s) could not be added to the canvas` } });
    }
  });
```

3. 末尾 `return { ... }` 里在 `importLibraryAsset` 后加 `importProjectArchive,`。

注意 `IMPORT_TYPES` 定义于 `importLibraryAsset` 上方（`actions.ts:518` 附近）——新代码须放在其后。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts`
Expected: PASS（全部用例，含既有）。

- [ ] **Step 5: Commit**

```bash
git add src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: store 新增压缩包导入项目 action(切项目+素材落画布)"
```

---

### Task 3: i18n 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Produces: `chat.importGame.{menu,title,chooseFile,namePlaceholder,import}` 六语齐备，供 Task 4/5 使用。

- [ ] **Step 1: en.ts 加 key**（真相源；放在 `createGame` 行后，结构对齐）

```ts
    importGame: {
      menu: 'Import game...',
      title: 'Import game',
      chooseFile: 'Choose archive (.zip / .tar / .tar.gz / .tgz)',
      namePlaceholder: 'Game name',
      import: 'Import',
    },
```

- [ ] **Step 2: 其余五语补齐**（同一位置插入；译文如下）

| key | zh | fr | ru | ja | vi |
|---|---|---|---|---|---|
| menu | 导入游戏... | Importer un jeu... | Импортировать игру... | ゲームをインポート... | Nhập trò chơi... |
| title | 导入游戏 | Importer un jeu | Импорт игры | ゲームをインポート | Nhập trò chơi |
| chooseFile | 选择压缩包（.zip / .tar / .tar.gz / .tgz） | Choisir une archive (.zip / .tar / .tar.gz / .tgz) | Выберите архив (.zip / .tar / .tar.gz / .tgz) | アーカイブを選択（.zip / .tar / .tar.gz / .tgz） | Chọn tệp nén (.zip / .tar / .tar.gz / .tgz) |
| namePlaceholder | 游戏名称 | Nom du jeu | Название игры | ゲーム名 | Tên trò chơi |
| import | 导入 | Importer | Импортировать | インポート | Nhập |

- [ ] **Step 3: 验证六语 key 同构**

Run: `pnpm exec vitest run src/i18n && pnpm exec tsc --noEmit`
Expected: PASS（i18n 目录有 key 同构校验测试则过；无则以 tsc 通过为准）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 导入游戏六语文案"
```

---

### Task 4: `ImportProjectModal` 组件

**Files:**
- Create: `src/components/chat/ImportProjectModal.tsx`
- Test: `src/components/chat/ImportProjectModal.test.tsx`

**Interfaces:**
- Consumes: store action `importProjectArchive(file, name)`（Task 2，失败 reject）；i18n key `chat.importGame.*`（Task 3）。
- Produces: `<ImportProjectModal onClose={() => void} />`。

- [ ] **Step 1: 写失败测试**（mock store 的写法对齐 `CreateGameModal.test.tsx`；先读该文件抄其 store mock 样板）

```tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportProjectModal from './ImportProjectModal';
import { useStore } from '@/store';

const importAction = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ importProjectArchive: importAction } as never);
});

const pick = (name = 'my-game.zip') => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['z'], name)] } });
};

describe('ImportProjectModal', () => {
  test('未选文件时提交禁用;选中后名称默认取文件名去扩展名', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    pick('my-game.tar.gz');
    expect(screen.getByPlaceholderText('Game name')).toHaveValue('my-game');
  });

  test('提交:调 action(file+名称),成功后关闭', async () => {
    importAction.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    pick();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importAction).toHaveBeenCalledWith(expect.any(File), 'my-game'));
    // useRequestClose 退场 200ms 后回调
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });

  test('失败:保留弹窗(不关闭),按钮恢复可点', async () => {
    importAction.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    pick();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importAction).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled());
  });

  test('名称清空后提交禁用', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    pick();
    fireEvent.change(screen.getByPlaceholderText('Game name'), { target: { value: '  ' } });
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });
});
```

> 注意：先阅读 `CreateGameModal.test.tsx` 的实际 store/i18n mock 方式；若其用不同样板（如 `vi.mock('@/store')` 整体替换），本测试改用同样板，断言不变。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx`
Expected: FAIL —— 组件文件不存在。

- [ ] **Step 3: 实现组件**（复刻 CreateGameModal 结构：backdrop + modal-pop + useRequestClose + Esc + dirty 拦截遮罩）

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useIsDark } from '@/client/useIsDark';
import { useRequestClose } from '@/client/useRequestClose';
import IconButton, { submitVariant } from '@/components/ui/IconButton';
import { isImeComposing } from '@/lib/keyboard';

// 支持的压缩包扩展名(与后端契约一致);大小不做前端预校验,413/422 由后端信封→Toast
const ACCEPT = '.zip,.tar,.tar.gz,.tgz';
// 去掉压缩扩展名作默认项目名(.tar.gz 双段优先)
const defaultName = (filename: string) => filename.replace(/\.(tar\.gz|tgz|tar|zip)$/i, '');

// 导入游戏弹窗:选压缩包 + 项目名 → store.importProjectArchive(失败 reject 保留弹窗)。
// 结构复刻 CreateGameModal(modal-pop + useRequestClose + Esc + dirty 拦截遮罩)
export default function ImportProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const importProjectArchive = useStore((s) => s.importProjectArchive);
  const dark = useIsDark();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = file != null && name.trim().length > 0 && !busy;
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const submit = async () => {
    if (!canSubmit || file == null) return;
    setBusy(true);
    try {
      await importProjectArchive(file, name.trim());
      requestClose();
    } catch {
      // 失败已由 action 落 lastError→Toast:保留弹窗让用户换文件/改名重试
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 已选文件或已有输入时拦截遮罩点击,防误触丢状态
  const dirty = file != null || name.trim().length > 0;

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={() => { if (!dirty) requestClose(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('chat.importGame.title')}</span>
        <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          if (f) setName(defaultName(f.name));
        }} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="h-11 w-full truncate rounded-[12px] border border-dashed border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-left text-[14px] tracking-[-0.14px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-teal)]"
        >
          {file ? <span className="text-[var(--color-ink)]">{file.name}</span> : t('chat.importGame.chooseFile')}
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); void submit(); } }}
          placeholder={t('chat.importGame.namePlaceholder')}
          className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-teal)]"
        />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={requestClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('common.cancel')}</button>
          <IconButton
            variant={submitVariant(canSubmit, dark)}
            className="h-10 rounded-[10px] px-4 text-[13px] font-semibold"
            aria-label={t('chat.importGame.import')}
            disabled={!canSubmit}
            onClick={submit}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : t('chat.importGame.import')}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ImportProjectModal.tsx src/components/chat/ImportProjectModal.test.tsx
git commit -m "feat: 导入游戏弹窗组件"
```

---

### Task 5: ProjectMenu 菜单项 + ChatPanel 接线

**Files:**
- Modify: `src/components/chat/ProjectMenu.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`
- Test: `src/components/chat/ProjectMenu.test.tsx`（追加用例）

**Interfaces:**
- Consumes: Task 4 的 `ImportProjectModal`；i18n `chat.importGame.menu`。
- Produces: `ProjectMenu` 新 prop `onImport: () => void`。

- [ ] **Step 1: 写失败测试**（`ProjectMenu.test.tsx` 追加；props 样板抄同文件既有用例，补 `onImport`）

```tsx
test('导入游戏菜单项:点击回调并关闭菜单', () => {
  const onImport = vi.fn();
  const onClose = vi.fn();
  render(<ProjectMenu {...baseProps} onImport={onImport} onClose={onClose} />);
  fireEvent.click(screen.getByText('Import game...'));
  expect(onImport).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});
```

> 既有用例的 props 若无 `baseProps` 抽象，则按该文件现状把全量 props 写开，并给所有既有用例补 `onImport={() => {}}`（新必填 prop）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx`
Expected: FAIL —— 无该菜单项 / prop 类型错误。

- [ ] **Step 3: 实现**

`ProjectMenu.tsx`：props 增加 `onImport: () => void;`（解构同步加），在「Create new game」按钮后插入同构按钮：

```tsx
          <button
            type="button"
            onClick={() => { onImport(); onClose(); }}
            className="flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]"
          >
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]">
              {t('chat.importGame.menu')}
            </span>
          </button>
```

`ChatPanel.tsx`：
1. `import ImportProjectModal from './ImportProjectModal';`
2. `createOpen` 旁加 `const [importOpen, setImportOpen] = useState(false);`
3. `<ProjectMenu ...>` 加 `onImport={() => setImportOpen(true)}`
4. `{createOpen && ...}` 旁加 `{importOpen && <ImportProjectModal onClose={() => setImportOpen(false)} />}`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ProjectMenu.test.tsx src/components/chat/ChatPanel.test.tsx`
Expected: PASS（ChatPanel 既有用例不回归）。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ProjectMenu.tsx src/components/chat/ProjectMenu.test.tsx src/components/chat/ChatPanel.tsx
git commit -m "feat: 项目菜单新增导入游戏入口"
```

---

### Task 6: 全量验证与收尾

**Files:** 无新增（验证 + 可能的修正）。

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 exit 0。任何失败先按 systematic-debugging 定位再修，不得跳过。

- [ ] **Step 2: 运行态验证**（superpowers:verification-before-completion；参考记忆「运行态验证本地坑」：dev 端口冲突则换端口，必要时 Playwright + mock `/api/pgc/**` 信封逐态截图）

- 打开工作台 → ProjectMenu 出现「导入游戏...」；
- 点击弹出模态,选文件后名称自动填充;
- mock 成功响应:切到新项目、素材落画布;mock 422:Toast 展示后端 message 且弹窗保留。

- [ ] **Step 3: 若有修正则提交**

```bash
git add -A && git commit -m "fix: 导入项目联调修正"
```

- [ ] **Step 4: 收尾**

按 superpowers:finishing-a-development-branch 回合 dev（`--no-ff`，message 含 `feat/project-zip-import`），删除分支并清理 worktree；合并前用 `git log` 校验提交落点（记忆「子 agent 可能提交到错分支」）。
