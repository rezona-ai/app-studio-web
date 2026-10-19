# 压缩包导入体验优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入弹窗支持取消（行内二次确认 + abort 上传请求）、文件区拖放（虚线框 + 上传图标）、导入中展示步骤文案与真实上传进度。

**Architecture:** `importProjectArchive` client 函数从 fetch 改 XHR（复刻 `uploadCanvasItem`：onProgress + signal→abort）；store 新增瞬态 `importArchiveStatus` 驱动弹窗步骤/进度展示与取消按钮可见性；action 内持 AbortController，新增 `cancelImportArchive`；弹窗按「表单 / 导入中 / 行内确认」三态重构。

**Tech Stack:** Next.js 16 + React 19、zustand、vitest（jsdom + FakeXHR）、react-i18next。

**Spec:** `docs/superpowers/specs/2026-07-08-zip-import-ux-design.md`（实现前先读）。

## Global Constraints

- 执行前基于 dev 建 worktree `feat/zip-import-ux`（`.claude/worktrees/feat+zip-import-ux`）；完成后 `--no-ff` 回合 dev（message 含分支名）并清理。
- 注释 / commit message 一律中文；注释解释「为什么」。
- **仅上传阶段可取消**：后端返回后（项目已建成）取消按钮消失，`cancelImportArchive` no-op。
- **ABORTED 静默**：主动取消不写 `lastError`（不弹 Toast），但照样 reject 让弹窗回表单态、保留已选文件与名称。
- `importArchiveStatus` 是瞬态：不得加进 `src/store/index.ts` 的 persist `partialize`（该配置是白名单，无需改动，只须不加）。
- UI 全走既有令牌/组件/动效类；图标用 `FigIcon`（`figAsset.upload` 已登记，tone 默认 secondary）；交互元素带 `aria-label`。
- i18n 六语（en 真相源），新 key 全部落 `chat.importGame.*`。
- 每个 `await` 后校验 `currentProjectId` 才写 store。
- 验证只信命令退出码（worktree 内 IDE 诊断有已知误报）。

---

### Task 1: client `importProjectArchive` XHR 化（进度 + 中止）

**Files:**
- Modify: `src/lib/pgc/client.ts:146-157`（重写 `importProjectArchive`）
- Test: `src/lib/pgc/client.test.ts`（FakeXHR 提到文件级 + 新 describe + 改旧用例）

**Interfaces:**
- Produces: `importProjectArchive(file: File, name: string, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<ImportProjectData>`；abort → reject `PgcError('ABORTED', 'Upload aborted', 0)`。

- [ ] **Step 1: 调整测试**

`src/lib/pgc/client.test.ts`：
1. 把 `describe('uploadCanvasItem(XHR)')` 内部的 `class FakeXHR {...}` 整体**上移到文件顶层**（`mockJson` 定义之后），其内的 `beforeEach(() => { FakeXHR.instances = []; vi.stubGlobal('XMLHttpRequest', FakeXHR); })` 保留在原 describe 内不动，代码本身零改动——只是作用域提升供两个 describe 共用。
2. **删除**文件尾部旧的 `describe('importProjectArchive(压缩包导入)')`（fetch 版两用例），替换为：

```ts
describe('importProjectArchive(XHR 压缩包导入)', () => {
  beforeEach(() => { FakeXHR.instances = []; vi.stubGlobal('XMLHttpRequest', FakeXHR); });
  const okEnvelope = {
    success: true, code: 'OK', message: 'OK',
    data: {
      id: 7, public_id: 'pubx', name: 'My Game', cover_url: null, cover_source: null,
      current_version_id: 'v1', status: 'draft', created_at: '', updated_at: '',
      version_id: 'v1', version_status: 'ready', play_url: '/play/x', preview_url: '/pv/x',
      file_count: 12, assets: [],
    },
  };

  test('POST multipart 到 /api/projects/import,带进度回调,解出 data', async () => {
    const onProgress = vi.fn();
    const file = new File(['zipbytes'], 'game.zip');
    const p = importProjectArchive(file, 'My Game', onProgress);
    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/pgc/api/projects/import');
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBeInstanceOf(FormData);
    expect((xhr.body as FormData).get('file')).toBe(file);
    expect((xhr.body as FormData).get('name')).toBe('My Game');
    xhr.emitProgress(30, 100);
    expect(onProgress).toHaveBeenCalledWith(0.3);
    xhr.respond(200, okEnvelope);
    await expect(p).resolves.toMatchObject({ id: 7, public_id: 'pubx' });
  });

  test('422 错误信封 → PgcError 带后端 code/status', async () => {
    const p = importProjectArchive(new File(['x'], 'game.rar'), 'g');
    FakeXHR.instances[0].respond(422, { success: false, code: 'ARCHIVE_UNSUPPORTED_FORMAT', message: '不支持的格式', data: null });
    await expect(p).rejects.toMatchObject({ code: 'ARCHIVE_UNSUPPORTED_FORMAT', status: 422 });
  });

  test('signal abort → xhr.abort() 且抛 ABORTED', async () => {
    const ctrl = new AbortController();
    const p = importProjectArchive(new File(['x'], 'game.zip'), 'g', undefined, ctrl.signal);
    const xhr = FakeXHR.instances[0];
    ctrl.abort();
    expect(xhr.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('网络错误 → PgcError(NETWORK)', async () => {
    const p = importProjectArchive(new File(['x'], 'game.zip'), 'g');
    FakeXHR.instances[0].fail();
    await expect(p).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: FAIL —— 新 describe 的用例失败（现实现走 fetch，`FakeXHR.instances[0]` 为 undefined）。

- [ ] **Step 3: 重写实现**（`client.ts:146-157` 整段替换）

```ts
// 导入外部压缩包为新项目(multipart 字段 file+name)。格式/大小校验全在后端(422 ARCHIVE_*/413)。
// 走 XHR 而非 fetch:压缩包动辄几十 MB,需要 upload.onprogress 真实进度;
// signal 中止时 xhr.abort() → 抛 ABORTED(导入弹窗「取消导入」用),与 uploadCanvasItem 同构。
export function importProjectArchive(
  file: File, name: string,
  onProgress?: (ratio: number) => void, signal?: AbortSignal,
): Promise<ImportProjectData> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PREFIX}/api/projects/import`);
    xhr.withCredentials = true;   // 等价 fetch credentials:'include'(cookie 制鉴权)
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let env: ApiResponse<ImportProjectData> | null = null;
      try { env = JSON.parse(xhr.responseText); } catch { /* 非 JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      try { resolve(resolveEnvelope(env, ok, xhr.status)); }
      catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new PgcError('NETWORK', 'Network error', 0));
    xhr.onabort = () => reject(new PgcError('ABORTED', 'Upload aborted', 0));
    xhr.send(fd);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/pgc/client.test.ts`
Expected: PASS（全部，含 uploadCanvasItem 既有用例——FakeXHR 提升不改其行为）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pgc/client.ts src/lib/pgc/client.test.ts
git commit -m "feat: 压缩包导入接口 XHR 化(上传进度+可中止)"
```

---

### Task 2: store 导入状态机 + 取消 action

**Files:**
- Modify: `src/store/types.ts`（ServerState + 初始值）
- Modify: `src/store/actions.ts:545-585`（重构 `importProjectArchive`，新增 `cancelImportArchive`）
- Test: `src/store/actions.test.ts`（改既有断言 + 新增用例）

**Interfaces:**
- Consumes: Task 1 的 `importProjectArchive(file, name, onProgress?, signal?)`。
- Produces: `ServerState.importArchiveStatus: ImportArchiveStatus | null`；action `cancelImportArchive(): void`；`importProjectArchive(file, name): Promise<void>` 行为不变处：成功切项目、非 ABORTED 失败 reject + Toast。

- [ ] **Step 1: 写失败测试**

`src/store/actions.test.ts`：
1. 既有用例「成功:并入项目列表、切到新项目、逐条落画布」中的断言改为（mock 多收 onProgress/signal 两参）：

```ts
    expect(importArchiveMock).toHaveBeenCalledWith(file, 'Imported', expect.any(Function), expect.any(AbortSignal));
```

2. `describe('importProjectArchive(压缩包导入项目)')` 尾部追加：

```ts
  test('状态机:uploading(带进度)→creating→importing_assets(计数)→结束清 null', async () => {
    const seen: unknown[] = [];
    importArchiveMock.mockImplementation(async (_f: File, _n: string, onProgress: (r: number) => void) => {
      // 上传中回报进度:此刻应处 uploading 且 progress 跟随
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'uploading', progress: 0 });
      onProgress(0.4);
      expect(useStore.getState().importArchiveStatus).toMatchObject({ step: 'uploading', progress: 0.4 });
      return importedProject;
    });
    api.writeCanvasItemFromUrl.mockImplementation(async () => {
      seen.push(useStore.getState().importArchiveStatus);   // 素材阶段逐条采样
      return { item_id: 'ci' + seen.length, type: 'image', name: 'x', status: 'ready', canvas_x: 0, canvas_y: 0 };
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await useStore.getState().importProjectArchive(file, 'Imported');
    expect(seen[0]).toMatchObject({ step: 'importing_assets', done: 0, total: 2 });
    expect(seen[1]).toMatchObject({ step: 'importing_assets', done: 1, total: 2 });
    expect(useStore.getState().importArchiveStatus).toBeNull();   // 结束清态
  });

  test('cancelImportArchive:uploading 阶段 abort signal;非 uploading 阶段 no-op', async () => {
    let captured: AbortSignal | null = null;
    let release: (v: unknown) => void = () => {};
    importArchiveMock.mockImplementation((_f: File, _n: string, _p: unknown, signal: AbortSignal) => {
      captured = signal;
      return new Promise((res) => { release = res; });   // 挂起模拟上传在途
    });
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    const run = useStore.getState().importProjectArchive(file, 'Imported');
    await vi.waitFor(() => expect(captured).not.toBeNull());
    useStore.getState().cancelImportArchive();
    expect(captured!.aborted).toBe(true);   // uploading 阶段:真 abort
    release(importedProject);   // 假 client 不感知 abort,照常返回;真实 client 会 reject ABORTED
    await run;
    // 结束后再调:状态已清,no-op 不抛
    expect(() => useStore.getState().cancelImportArchive()).not.toThrow();
  });

  test('ABORTED 静默:不写 lastError、清状态,但照样 reject', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ABORTED', 'Upload aborted', 0));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ABORTED' });
    expect(useStore.getState().lastError).toBeNull();
    expect(useStore.getState().importArchiveStatus).toBeNull();
    expect(useStore.getState().currentProjectId).toBe(1);
  });

  test('非 ABORTED 失败:仍写 lastError 且清状态', async () => {
    importArchiveMock.mockRejectedValue(new PgcError('ARCHIVE_TOO_LARGE', '包太大', 413));
    useStore.setState({ currentProjectId: 1, projects: [proj(1)] });
    await expect(useStore.getState().importProjectArchive(file, 'g')).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE' });
    expect(useStore.getState().lastError?.code).toBe('ARCHIVE_TOO_LARGE');
    expect(useStore.getState().importArchiveStatus).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t importProjectArchive`
Expected: FAIL —— 无 `importArchiveStatus` / `cancelImportArchive`，mock 调用参数断言不匹配。

- [ ] **Step 3: 实现**

`src/store/types.ts`：
1. `ServerState` 内（`creditModalOpen` 行后）追加：

```ts
  // 压缩包导入进行中状态(弹窗步骤/进度展示 + 取消按钮可见性依据);瞬态不持久化
  importArchiveStatus: {
    step: 'uploading' | 'creating' | 'importing_assets';
    progress: number;   // 0..1,仅 uploading 阶段有意义
    done: number;       // 已落画布素材数,仅 importing_assets 阶段
    total: number;      // 素材总数
  } | null;
```

2. `createInitialServerState()` 返回对象加 `importArchiveStatus: null`。

`src/store/actions.ts`：把现有 `importProjectArchive`（545-585 行）整体替换为：

```ts
  // 导入中止控制器:仅上传阶段持有;上传完成(项目已建成)即置 null,取消随之失效。
  // 模块级单飞:同一时刻至多一个导入(弹窗是唯一入口,导入中弹窗不可再提交)
  let importAbort: AbortController | null = null;

  // 导入外部压缩包为新项目:上传(可取消,带进度) → 并入列表并切过去 → 素材逐条落画布。
  // 不用 guardRethrow:主动取消(ABORTED)须静默——不写 lastError、不弹 Toast,
  // 但仍 rethrow 让弹窗回表单态;其余错误按 guardRethrow 同构分支处理。
  const importProjectArchive = async (file: File, name: string) => {
    const controller = new AbortController();
    importAbort = controller;
    set({ importArchiveStatus: { step: 'uploading', progress: 0, done: 0, total: 0 } });
    try {
      const data: ImportProjectData = await importProjectArchiveApi(
        file, name,
        // 进度只在仍处 uploading 时写入(abort 竞态窗口内的迟到回调直接丢弃)
        (ratio) => {
          if (get().importArchiveStatus?.step === 'uploading') {
            set({ importArchiveStatus: { step: 'uploading', progress: ratio, done: 0, total: 0 } });
          }
        },
        controller.signal,
      );
      importAbort = null;   // 项目已建成,进入不可取消阶段
      set({ importArchiveStatus: { step: 'creating', progress: 1, done: 0, total: data.assets.length } });
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
      set({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 0, total: data.assets.length } });
      // 新项目画布恒空,从视口中心级联落位;occupied 随写入增长防重叠
      const occupied: XY[] = [];
      const origin = getViewportCenter() ?? { x: 0, y: 0 };
      let failed = 0;
      let done = 0;
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
          done += 1;
          set({
            assets: [...get().assets, canvasItemToAsset(item)],
            importArchiveStatus: { step: 'importing_assets', progress: 1, done, total: data.assets.length },
          });
        } catch { failed += 1; }
      }
      if (failed > 0 && get().currentProjectId === data.id) {
        set({ lastError: { code: 'IMPORT_ASSETS_PARTIAL', message: `${failed} asset(s) could not be added to the canvas` } });
      }
    } catch (e) {
      if (e instanceof PgcError && e.code !== 'ABORTED') {
        // guardRethrow 同构分支:401→authRequired / 积分→充值模态 / 其余→Toast
        if (e.status === 401) set({ authRequired: true });
        else if (isCreditError(e)) set({ creditModalOpen: true });
        else set({ lastError: { code: e.code, message: e.message } });
      }
      throw e;   // ABORTED 与其余错误都 rethrow:弹窗据 reject 回表单态
    } finally {
      importAbort = null;
      set({ importArchiveStatus: null });
    }
  };

  // 取消导入:仅上传阶段有效(项目未建成,abort 即干净回滚);其余阶段 controller 已置 null,天然 no-op
  const cancelImportArchive = () => { importAbort?.abort(); };
```

并在末尾 `return { ... }` 的 `importProjectArchive,` 后加 `cancelImportArchive,`。
注：`isCreditError` 已在文件顶部 import（`guard` 在用），无需新增。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts && pnpm exec vitest run src/store`
Expected: PASS（含 store 其余测试——`createInitialServerState` 加字段不破坏既有）。

- [ ] **Step 5: Commit**

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts
git commit -m "feat: 导入状态机(步骤/进度)与取消 action"
```

---

### Task 3: i18n 六语文案

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`importGame` 块内追加）

**Interfaces:**
- Produces: `chat.importGame.{dropRejected,cancelImport,confirmCancelText,keepImporting,confirmCancel,stepUploading,stepCreating,stepImportingAssets}`。

- [ ] **Step 1: en.ts 追加**（`importGame` 对象内，`import: 'Import',` 之后）

```ts
      dropRejected: 'Only .zip / .tar / .tar.gz / .tgz archives are supported',
      cancelImport: 'Cancel import',
      confirmCancelText: 'Cancel this import?',
      keepImporting: 'Keep importing',
      confirmCancel: 'Yes, cancel',
      stepUploading: 'Uploading archive… {{percent}}%',
      stepCreating: 'Creating project…',
      stepImportingAssets: 'Importing assets ({{done}}/{{total}})…',
```

- [ ] **Step 2: 其余五语同位置追加**

| key | zh | fr | ru | ja | vi |
|---|---|---|---|---|---|
| dropRejected | 仅支持 .zip / .tar / .tar.gz / .tgz 压缩包 | Seules les archives .zip / .tar / .tar.gz / .tgz sont prises en charge | Поддерживаются только архивы .zip / .tar / .tar.gz / .tgz | .zip / .tar / .tar.gz / .tgz のアーカイブのみ対応しています | Chỉ hỗ trợ tệp nén .zip / .tar / .tar.gz / .tgz |
| cancelImport | 取消导入 | Annuler l'importation | Отменить импорт | インポートをキャンセル | Hủy nhập |
| confirmCancelText | 确定要取消导入吗？ | Annuler cette importation ? | Отменить этот импорт? | このインポートをキャンセルしますか？ | Hủy lần nhập này? |
| keepImporting | 继续导入 | Continuer l'importation | Продолжить импорт | インポートを続ける | Tiếp tục nhập |
| confirmCancel | 确认取消 | Oui, annuler | Да, отменить | はい、キャンセル | Có, hủy |
| stepUploading | 正在上传压缩包… {{percent}}% | Téléversement de l'archive… {{percent}}% | Загрузка архива… {{percent}}% | アーカイブをアップロード中… {{percent}}% | Đang tải tệp nén lên… {{percent}}% |
| stepCreating | 正在创建项目… | Création du projet… | Создание проекта… | プロジェクトを作成中… | Đang tạo dự án… |
| stepImportingAssets | 正在导入素材 ({{done}}/{{total}})… | Importation des ressources ({{done}}/{{total}})… | Импорт ресурсов ({{done}}/{{total}})… | アセットをインポート中 ({{done}}/{{total}})… | Đang nhập tài nguyên ({{done}}/{{total}})… |

- [ ] **Step 3: 验证**

Run: `pnpm exec vitest run src/i18n && pnpm exec tsc --noEmit`
Expected: 全 PASS（六语 key 同构由 DeepStringify 类型约束）。

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales
git commit -m "feat: 导入取消/拖放/步骤进度六语文案"
```

---

### Task 4: 弹窗三态重构（拖放 + 导入态 + 行内确认取消）

**Files:**
- Modify: `src/components/chat/ImportProjectModal.tsx`（整文件重写，最终代码见 Step 3）
- Test: `src/components/chat/ImportProjectModal.test.tsx`（追加用例）

**Interfaces:**
- Consumes: store `importArchiveStatus`（Task 2 形状）、`cancelImportArchive()`、`setError({ code, message })`（既有 UIState action）、i18n `chat.importGame.*`（Task 3）。
- Produces: 无新对外接口（组件 props 不变）。

- [ ] **Step 1: 写失败测试**（`ImportProjectModal.test.tsx` 追加；沿用文件既有 store 重置/注入样板与文案匹配方式，若既有用例用正则匹配按其现状）

```tsx
const cancelAction = vi.fn();

const drop = (name: string) => {
  const zone = screen.getByRole('button', { name: /choose archive/i });
  fireEvent.drop(zone, { dataTransfer: { files: [new File(['z'], name)] } });
};

describe('拖放选文件', () => {
  test('合法压缩包 drop:设文件并派生默认名', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    drop('cool.tgz');
    expect(screen.getByPlaceholderText('Game name')).toHaveValue('cool');
  });

  test('非法类型 drop:setError 提示且不设文件', () => {
    const setError = vi.fn();
    useStore.setState({ setError } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    drop('cool.rar');
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: 'IMPORT_BAD_TYPE' }));
    expect(screen.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  });
});

describe('导入态与取消', () => {
  test('uploading:显示步骤文案+百分比+取消按钮,隐藏表单', () => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 0.42, done: 0, total: 0 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText(/Uploading archive… 42%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel import' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Game name')).toBeNull();
  });

  test('importing_assets:显示 n/m 计数且无取消按钮', () => {
    useStore.setState({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 2, total: 5 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText(/Importing assets \(2\/5\)…/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  });

  test('取消→行内确认→确认取消调 cancelImportArchive;继续导入则返回', () => {
    useStore.setState({
      importArchiveStatus: { step: 'uploading', progress: 0.1, done: 0, total: 0 },
      cancelImportArchive: cancelAction,
    } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.getByText('Cancel this import?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep importing' }));   // 返回导入态
    expect(screen.queryByText('Cancel this import?')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(cancelAction).toHaveBeenCalled();
  });

  test('导入中 Esc 走确认而非关闭', () => {
    const onClose = vi.fn();
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 0, done: 0, total: 0 } } as never);
    render(<ImportProjectModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel this import?')).toBeInTheDocument();
  });

  test('取消后(状态清空)回表单态且保留文件名', () => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 0, done: 0, total: 0 } } as never);
    const { rerender } = render(<ImportProjectModal onClose={() => {}} />);
    // 先在表单态设过文件的场景由组件本地 state 保留;此处直接验证状态清空后表单重新可见
    useStore.setState({ importArchiveStatus: null } as never);
    rerender(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByPlaceholderText('Game name')).toBeInTheDocument();
  });
});
```

> 若该测试文件既有 `useStore.setState` 重置样板（`beforeEach` 里 `createInitial*State`），新用例的 `setState` 放各自用例内即可；`setError`/`cancelImportArchive` 注入后无需还原（beforeEach 会重置）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx`
Expected: FAIL —— 无导入态/拖放/确认逻辑。

- [ ] **Step 3: 重写组件**（整文件替换）

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/store';
import { useIsDark } from '@/client/useIsDark';
import { useRequestClose } from '@/client/useRequestClose';
import IconButton, { submitVariant } from '@/components/ui/IconButton';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { isImeComposing } from '@/lib/keyboard';

// 支持的压缩包扩展名(与后端契约一致);大小不做前端预校验,413/422 由后端信封→Toast
const ACCEPT = '.zip,.tar,.tar.gz,.tgz';
const ARCHIVE_RE = /\.(tar\.gz|tgz|tar|zip)$/i;
// 去掉压缩扩展名作默认项目名(.tar.gz 双段优先)
const defaultName = (filename: string) => filename.replace(ARCHIVE_RE, '');

// 导入游戏弹窗,三态:表单(选文件+命名,支持拖放) / 导入中(步骤+进度,仅上传阶段可取消) / 行内确认取消。
// 导入中态由 store.importArchiveStatus 驱动(取消按钮可见性与步骤文案的单一真相源);
// 结构复刻 CreateGameModal(modal-pop + useRequestClose + Esc + dirty 拦截遮罩)
export default function ImportProjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const importProjectArchive = useStore((s) => s.importProjectArchive);
  const cancelImportArchive = useStore((s) => s.cancelImportArchive);
  const setError = useStore((s) => s.setError);
  const status = useStore((s) => s.importArchiveStatus);
  const dark = useIsDark();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // 行内二次确认(仅导入中可进入);导入结束(status 清空)自动退出
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const importing = status != null;
  const canSubmit = file != null && name.trim().length > 0 && !busy;
  const { closing, requestClose } = useRequestClose(onClose, 200);

  // 选定文件统一入口(点击选择与拖放共用):校验扩展名,合法则设文件+派生默认名
  const acceptFile = (f: File) => {
    if (!ARCHIVE_RE.test(f.name)) {
      setError({ code: 'IMPORT_BAD_TYPE', message: t('chat.importGame.dropRejected') });
      return;
    }
    setFile(f);
    setName(defaultName(f.name));
  };

  const submit = async () => {
    if (!canSubmit || file == null) return;
    setBusy(true);
    try {
      await importProjectArchive(file, name.trim());
      requestClose();
    } catch {
      // 失败/主动取消均回表单态(文件与名称保留);Toast 由 action 分流(取消静默)
      setConfirmingCancel(false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 导入中 Esc 不关弹窗:先走行内确认(与点「取消导入」同路径)
      if (useStore.getState().importArchiveStatus != null) setConfirmingCancel(true);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 已选文件或已有输入时拦截遮罩点击,防误触丢状态;导入中一律拦截
  const dirty = file != null || name.trim().length > 0;
  // 仅上传阶段可取消:项目建成后(creating/importing_assets)几秒内自然完成,无取消按钮
  const cancellable = status?.step === 'uploading';

  const stepText = status == null ? '' :
    status.step === 'uploading' ? t('chat.importGame.stepUploading', { percent: Math.round(status.progress * 100) })
    : status.step === 'creating' ? t('chat.importGame.stepCreating')
    : t('chat.importGame.stepImportingAssets', { done: status.done, total: status.total });

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={() => { if (!dirty && !importing) requestClose(); }}>
      <div
        onClick={(e) => e.stopPropagation()}
        data-closing={closing}
        className="modal-pop flex w-[400px] flex-col gap-5 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]"
      >
        <span className="text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">{t('chat.importGame.title')}</span>

        {importing ? (
          /* 导入中:spinner + 当前步骤(上传带真实百分比,素材带 n/m 计数) */
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 size={24} className="animate-spin text-[var(--color-teal)]" />
            <span className="text-[13px] tracking-[-0.13px] text-[var(--color-muted)]">{stepText}</span>
          </div>
        ) : (
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f) acceptFile(f);
            }} />
            {/* 拖放区:虚线框+上传图标;dragOver 时边框转品牌青 */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) acceptFile(f);
              }}
              aria-label={t('chat.importGame.chooseFile')}
              className={`flex h-[96px] w-full flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed bg-[var(--color-fill)] px-3 text-[13px] tracking-[-0.13px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-teal)] ${dragOver ? 'border-[var(--color-teal)]' : 'border-[var(--color-line-2)]'}`}
            >
              <FigIcon src={figAsset.upload} size={20} />
              <span className={`w-full truncate text-center ${file ? 'text-[var(--color-ink)]' : ''}`}>
                {file ? file.name : t('chat.importGame.chooseFile')}
              </span>
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isImeComposing(e)) { e.preventDefault(); void submit(); } }}
              placeholder={t('chat.importGame.namePlaceholder')}
              className="h-11 w-full rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] tracking-[-0.14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-teal)]"
            />
          </>
        )}

        {importing && confirmingCancel ? (
          /* 行内二次确认:就地替换底部按钮区,不叠第二层模态 */
          <div className="flex items-center justify-end gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-ink)]">{t('chat.importGame.confirmCancelText')}</span>
            <button type="button" onClick={() => setConfirmingCancel(false)} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.keepImporting')}</button>
            <button type="button" onClick={() => { cancelImportArchive(); setConfirmingCancel(false); }} className="h-10 shrink-0 rounded-[10px] px-4 text-[13px] font-semibold text-[#e5484d] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.confirmCancel')}</button>
          </div>
        ) : importing ? (
          cancellable && (
            <div className="flex items-center justify-end">
              <button type="button" onClick={() => setConfirmingCancel(true)} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">{t('chat.importGame.cancelImport')}</button>
            </div>
          )
        ) : (
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
        )}
      </div>
    </div>
  );
}
```

红色文案色 `#e5484d` 沿用 ProjectMenu 删除确认按钮的既有字面值（该值在仓库属既有先例，非新引入硬编码）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx src/components/chat/ProjectMenu.test.tsx src/components/chat/ChatPanel.test.tsx`
Expected: PASS（既有用例不回归——表单态 DOM 结构变化若致既有断言失败，按新结构修断言语义不变处）。

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ImportProjectModal.tsx src/components/chat/ImportProjectModal.test.tsx
git commit -m "feat: 导入弹窗三态重构(拖放/步骤进度/取消二次确认)"
```

---

### Task 5: 全量验证与收尾

**Files:** 无新增（验证 + 可能的修正）。

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 exit 0。

- [ ] **Step 2: 运行态验证**（Playwright + mock `/api/pgc/**`，prod 模式起独立端口；参考上一轮的验证脚本）

- 表单态：虚线框 + 上传图标可见；拖放合法文件 → 名称自动填充；拖放 `.rar` → Toast；
- 导入态：mock 慢响应（route 延迟 fulfill），提交后显示「正在上传压缩包… n%」+ 取消按钮；
- 取消流：点取消 → 行内确认 → 确认取消 → 弹窗回表单态、文件保留、无红色 Toast、请求已中止（route 观察 abort）；
- 成功流：切新项目 + 素材落画布（回归上一轮验证点）。

- [ ] **Step 3: 若有修正则提交**

```bash
git add -A && git commit -m "fix: 导入体验优化联调修正"
```

- [ ] **Step 4: 收尾**

按 superpowers:finishing-a-development-branch 回合 dev（`--no-ff`，message 含 `feat/zip-import-ux`），删分支清 worktree；合并前 `git log` 校验提交落点。
