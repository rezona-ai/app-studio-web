# 项目标识全量切到 public_id 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把工作台的项目标识从数值 `id` 全量切到 `public_id`（字符串），URL/store/PGC/Koubou/持久化 key 全部用 public_id，数值 `id` 退化为仅展示/兼容字段。

**Architecture:** 后端所有 `{project_id}` 端点已同时接受 public_id 与 legacy int，故前端无解析层——拿到 public_id 直接传。核心是把 `currentProjectId: number` 翻成 `string`，并让其所有生产者（`loadProjects` 选定逻辑）与消费者（PGC client、actions、`ProjectMenu`/`ChatPanel`、koubou hook）一致改为字符串。URL 兼容旧数值链：命中后归一为 public_id。

**Tech Stack:** Next.js 16 / React 19 / TypeScript / zustand / Vitest（jsdom + globals，`@`→`src`）。

## Global Constraints

- 代码注释 / commit message 一律**中文**；commit 一句话总结。
- 测试与源码同目录（`*.test.ts(x)`）；用 Vitest globals，不引入新框架。
- 不臆测后端字段，只取契约约定字段（`public_id` 已是 `ProjectData` 必填字段）。
- 不留 dead code、不留转型期 String() 桥接；类型翻转一次到位。
- 不恢复 landing Remix（后端就绪后独立处理）。
- 所有命令在 **worktree 根目录**执行：`/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/project-public-id`。
- 收口三件套：`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm lint` 全绿。

---

## Task 0: worktree 装依赖

**Files:** 无（仅环境准备）

git worktree 不带 `node_modules`，跑测试前必须装依赖。

- [ ] **Step 1: 安装依赖**

Run（在 worktree 根目录）：
```bash
pnpm install
```
Expected: 安装完成，出现 `node_modules/`。

- [ ] **Step 2: 基线验证**

Run:
```bash
pnpm exec tsc --noEmit && pnpm test
```
Expected: 全绿（这是改动前的基线）。

---

## Task 1: landing 死字段 projectId 清理

Remix 已在 main 上暂停（注释保留，恢复时放开），`PopularGame.projectId` 是死字段。本任务清掉它，并让注释着的 Remix 恢复时直接用 `g.id`（public_id）。此任务与核心翻转完全独立。

**Files:**
- Modify: `src/components/landing/games.ts`
- Modify: `src/components/landing/games.test.ts`
- Modify: `src/components/landing/LandingPage.tsx`
- Modify: `src/components/landing/LandingPage.test.tsx`

**Interfaces:**
- Produces: `PopularGame` 接口不再含 `projectId` 字段。

- [ ] **Step 1: 更新 games.test.ts —— 移除 projectId 断言**

`src/components/landing/games.test.ts` 中删除这一行（在「每条含必填字段」用例内）：
```ts
      // Remix 跳工作台用数值库 id
      expect(typeof g.projectId).toBe('number');
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```bash
pnpm exec vitest run src/components/landing/games.test.ts
```
Expected: PASS（删断言后测试本身仍绿；此步确认测试文件可运行，下一步删字段后仍绿）。

- [ ] **Step 3: 从 games.ts 移除 projectId**

`src/components/landing/games.ts`：

接口删除 `projectId` 行：
```ts
export interface PopularGame {
  id: string;
  title: string;
  author: string;
  thumb: string;       // 缩略图(线上 cover_url,直链 PGC 公开页,无需补 basePath)
  previewUrl: string;  // Play 弹窗 iframe src(线上 preview_url)
  ctaLabel: 'Play' | 'Remix';
}
```

注释改为（id 即 public_id，Remix 恢复时用它跳 `?project=`）：
```ts
// 线上真实游戏(taluna-admin 出品):cover_url / preview_url 直链 PGC 公开页。
// id 用 public_id 作 React key;Remix 恢复时直接用 id(public_id)跳 /studio?project=<public_id>。
```

三条数据各删 `projectId: NN, `（只删该字段，其余不动），例如：
```ts
  { id: 'DakkYXUy', title: '猫咪模拟器3D', author: '@taluna-admin', thumb: 'https://pgcgame.taluna.ai/pv/DakkYXUy/v3/cover.png', previewUrl: 'https://pgcgame.taluna.ai/pv/DakkYXUy/v5/dist/index.html', ctaLabel: 'Play' },
  { id: 'ikQGtsXv', title: '图书馆的初遇', author: '@taluna-admin', thumb: 'https://pgcgame.taluna.ai/pv/ikQGtsXv/v10/cover.png', previewUrl: 'https://pgcgame.taluna.ai/pv/ikQGtsXv/v10/dist/index.html', ctaLabel: 'Play' },
  { id: 'zYfrtJVc', title: '美女消消乐', author: '@taluna-admin', thumb: 'https://pgcgame.taluna.ai/pv/zYfrtJVc/v6/cover.png', previewUrl: 'https://pgcgame.taluna.ai/pv/zYfrtJVc/v6/dist/index.html', ctaLabel: 'Play' },
```

- [ ] **Step 4: 修正 LandingPage.test.tsx mock（移除 projectId，否则 excess-property 报错）**

`src/components/landing/LandingPage.test.tsx` 第 16 行 mock 删除 `projectId: 42, `：
```tsx
    { id: 'with-pid', title: 'WITH PID', author: '@t', thumb: '/games/a.png', previewUrl: 'about:blank', ctaLabel: 'Play' },
```
（第 17 行那条本就无 projectId，不动；上方注释里 projectId 字样可一并淡化为「一张 Play、一张 Remix」，非必须。）

- [ ] **Step 5: 让注释着的 remix 改用 public_id（恢复时即 public_id-native）**

`src/components/landing/LandingPage.tsx` 把注释着的 remix 跳转引用从 `g.projectId` 改为 `g.id`：
```tsx
  // Remix 暂停(后端未完成):暂时注释 router 与 remix 跳转,恢复时放开。
  // const router = useRouter();
  const [preview, setPreview] = useState<PopularGame | null>(null);

  // Remix:用 id(public_id)跳工作台(复用 URL ?project 最高优先级)。
  // const remix = (g: PopularGame) =>
  //   router.push('/studio' + withProjectParam('', g.id));
```

- [ ] **Step 6: 运行 landing 测试 + tsc**

Run:
```bash
pnpm exec vitest run src/components/landing/ && pnpm exec tsc --noEmit
```
Expected: 测试全绿，tsc 无报错。

- [ ] **Step 7: 提交**

```bash
git add src/components/landing/
git commit -m "refactor: landing 移除死字段 projectId,Remix 恢复时改用 public_id"
```

---

## Task 2: 核心翻转 —— 项目标识改用 public_id

这是一次跨文件类型迁移（`number → string`），中途无法单独编译通过，故作为一个整体任务：先改全部生产代码，再改全部测试，最后 `tsc + test + lint` 作为集成门禁。

**Files:**
- Modify: `src/lib/pgc/types.ts`（加 `public_id`）
- Modify: `src/lib/project-url.ts`
- Modify: `src/lib/project-url.test.ts`
- Modify: `src/lib/pgc/client.ts`
- Modify: `src/store/types.ts`
- Modify: `src/store/index.ts`
- Modify: `src/store/actions.ts`
- Modify: `src/components/chat/ProjectMenu.tsx`
- Modify: `src/components/chat/ProjectMenu.test.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/client/useKoubouConnection.ts`
- Modify: `src/store/actions.test.ts`
- Modify: `src/client/useCanvasAutoImport.test.tsx`
- Modify: `src/store/koubou-seed.test.ts`
- Modify: `src/store/history-pagination.test.ts`

**Interfaces（本任务结束后的对外签名）:**
- `ProjectData.public_id: string`（必填）
- `readProjectIdFromSearch(search: string): string | null`
- `withProjectParam(search: string, id: string | null): string`
- `syncProjectToUrl(id: string | null): void`
- store `currentProjectId: string | null`
- `selectProject(id: string)` / `renameProject(id: string, name: string)` / `deleteProject(id: string)` / `setCurrentProject(id: string | null)` / `switchProjectSession(nextPid: string | null)`
- `pgcApi.*` 项目方法形参 `pid/id: string`

### 生产代码

- [ ] **Step 1: `ProjectData` 加 public_id / cover_source**

`src/lib/pgc/types.ts` 的 `ProjectData`：
```ts
export interface ProjectData {
  id: number;
  public_id: string;       // 对外不可枚举标识(Sqids 纯字母);正式 URL / 寻址一律用它
  name: string;
  cover_url: string | null;
  cover_source: string | null;
  current_version_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: 重写 `project-url.ts` 为字符串契约**

`src/lib/project-url.ts` 全文改为：
```ts
// 页签与项目绑定:当前项目 public_id 以 ?project=<public_id> 形式存在本页签 URL 中,
// 多页签互不干扰;只动 query 不动 pathname,天然兼容部署 basePath(/game)。

// 解析 search 串中的 project 参数;作为 opaque token 返回:
// 既容 public_id(纯字母),也容旧数值链(?project=73)兼容期访问。非法 token 返回 null。
export function readProjectIdFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('project');
  if (raw == null || !/^[A-Za-z0-9]+$/.test(raw)) return null;
  return raw;
}

// 返回更新(或 id 为 null 时移除)project 参数后的 search 串;保留其他参数
export function withProjectParam(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id == null) params.delete('project');
  else params.set('project', id);
  const s = params.toString();
  return s ? `?${s}` : '';
}

// 薄副作用包装:把项目 public_id 写回本页签 URL(replaceState 不产生历史记录);非浏览器环境 no-op
export function syncProjectToUrl(id: string | null): void {
  if (typeof window === 'undefined') return;
  const next = withProjectParam(window.location.search, id);
  if (next === window.location.search) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
}
```

- [ ] **Step 3: 翻转 `pgc/client.ts` 项目方法形参为 string**

`src/lib/pgc/client.ts`：把所有项目相关方法的 `id` / `pid` 形参类型由 `number` 改为 `string`（路径插值对 string 原样可用，逻辑不动）。逐个：
```ts
  getProject: (id: string) => pgc<ProjectData>('GET', `/api/projects/${id}`),
  updateProject: (id: string, body: UpdateProjectRequest) => pgc<ProjectData>('PATCH', `/api/projects/${id}`, body),
  deleteProject: (id: string) => pgc<{ id: number }>('DELETE', `/api/projects/${id}`),

  listCanvasItems: (pid: string) => ...
  updateCanvasReference: (pid: string, itemId: string, reference: unknown) => ...
  deleteCanvasItem: (pid: string, itemId: string) => ...
  genImage: (pid: string, body: CanvasGenImageRequest) => ...
  genAudio: (pid: string, body: CanvasGenAudioRequest) => ...
  genVideo: (pid: string, body: CanvasGenVideoRequest) => ...
  pollVideo: (pid: string, taskId: string) => ...
  genModel3d: (pid: string, body: CanvasGenModel3DRequest) => ...
  pollModel3d: (pid: string, taskId: string) => ...
  writeCanvasItemFromUrl: (pid: string, body: CanvasWriteFromUrlRequest) => ...

  listVersions: (pid: string) => ...
  createVersion: (pid: string) => ...
  getVersion: (pid: string, vid: string) => ...
  previewVersion: (pid: string, vid: string) => ...
```
以及顶层两个函数：
```ts
export async function uploadCanvasItem(pid: string, file: File): Promise<CanvasItemData> { ... }
export async function downloadVersion(pid: string, vid: string): Promise<Blob> { ... }
```
（方法体一律不变。`deleteProject` 返回 `{ id: number }` 保持不变——后端回传数值 id。）

- [ ] **Step 4: 翻转 store 类型 `currentProjectId`**

`src/store/types.ts` 第 83 行：
```ts
  currentProjectId: string | null;
```

- [ ] **Step 5: 翻转 `store/index.ts` 的 action 签名**

`src/store/index.ts`：
- 第 43 行：`switchProjectSession: (nextPid: string | null) => void;`
- 第 76 行：`setCurrentProject: (id: string | null) => void;`

其余 `String(s.currentProjectId)` 作 key、`get().currentProjectId !== pid` 比较均对字符串天然成立，不动。

- [ ] **Step 6: 翻转 `actions.ts` 内部 helper 与项目 action 签名**

`src/store/actions.ts` 形参类型 `number → string`：
```ts
  const restoreGenTasks = (pid: string) => { ... }
  const selectProject = async (id: string) => guard(set, async () => { ... });
  const renameProject = async (id: string, name: string) => guard(set, async () => { ... });
  const deleteProject = async (id: string) => guard(set, async () => { ... });
  const placeAndLink = (pid: string, fresh: Asset[], opts?: GenPlacement, anchor?: XY): Asset[] => { ... }
  const settleGenPlaceholder = (pid: string, placeholderId: string, fresh: Asset[], opts?: GenPlacement) => { ... }
  const runGen = async (kind: AssetKind, opts: GenPlacement | undefined, call: (pid: string, placeholderId: string) => Promise<void>) => { ... }
  const startAsyncGen = (kind: 'video' | 'model3d', task: CanvasGenTask, pid: string, placeholderId: string, opts?: GenPlacement) => { ... }
```
方法体内的 `currentProjectId` 比较、`String(pid)`、`syncProjectToUrl(id)` 调用均保持。

- [ ] **Step 7: `loadProjects` 选定逻辑改用 public_id（含旧数值链兼容）**

`src/store/actions.ts` 的 `loadProjects` 内，把原 `fromUrl / urlValid / stillThere / pick` 段替换为：
```ts
          // 选定优先级:本页签 URL ?project(页签↔项目绑定) > 持久化的最近使用 > 列表第一个
          const token = typeof window === 'undefined' ? null : readProjectIdFromSearch(window.location.search);
          // token 可能是 public_id 或旧数值链;命中后一律归一到该项目的 public_id
          const fromUrl = token == null ? null
            : (data.items.find((p) => p.public_id === token || String(p.id) === token)?.public_id ?? null);
          const cur = get().currentProjectId;
          const stillThere = cur != null && data.items.some((p) => p.public_id === cur);
          const pick = fromUrl ?? (stillThere ? cur! : (data.items[0]?.public_id ?? null));
```
下方 `if (pick != null && pick !== cur) await selectProject(pick);` 等逻辑保持；`syncProjectToUrl(pick)` 现写入 public_id（含把旧数值链归一为 public_id）。

- [ ] **Step 8: `createProject` / `renameProject` / `deleteProject` 改用 public_id 寻址**

`src/store/actions.ts`：
```ts
  const createProject = async (name: string) => guard(set, async () => {
    const p = await pgcApi.createProject(name);
    set({ projects: [p, ...get().projects] });
    await selectProject(p.public_id);
  });

  const renameProject = async (id: string, name: string) => guard(set, async () => {
    const p = await pgcApi.updateProject(id, { name });
    set({ projects: get().projects.map((x) => (x.public_id === id ? p : x)) });
  });

  const deleteProject = async (id: string) => guard(set, async () => {
    await pgcApi.deleteProject(id);
    const rest = get().projects.filter((p) => p.public_id !== id);
    const { [String(id)]: _removed, ...restGenTasks } = get().genTasksByProject;
    set({ projects: rest, genTasksByProject: restGenTasks });
    if (get().currentProjectId === id) {
      const next = rest[0]?.public_id ?? null;
      if (next != null) await selectProject(next);
      else await createProject(DEFAULT_PROJECT_NAME);
    }
  });
```

- [ ] **Step 9: 翻转 `useKoubouConnection.ts`**

`src/client/useKoubouConnection.ts`：`currentProjectId` 现为 string，`pid` 直接是 public_id 字符串；把传给 client 的 `projectId: String(pid)` 改为 `projectId: pid`：
```ts
      const client = createKoubouClient({
        wsBaseUrl,
        projectId: pid,
        sessionId,
        ...
```
（`switchProjectSession(pid)`、`koubouApi.listSessions(pid)`、`koubouApi.listEvents(pid, ...)`、持久化 `[String(pid)]` 均已兼容字符串，不动。）

- [ ] **Step 10: 翻转 `ProjectMenu.tsx`（props/state/身份比较一律用 public_id）**

`src/components/chat/ProjectMenu.tsx`：props 与本地 state 类型 `number → string`，所有把 `p.id` 当项目身份用的地方改 `p.public_id`：
```tsx
}: {
  projects: ProjectData[];
  currentId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const finishedRef = useRef<string | null>(null);
  ...
  const choose = (id: string) => { onSelect(id); onClose(); };
  const startRename = (p: ProjectData) => { finishedRef.current = null; setConfirmId(null); setDraft(p.name); setEditingId(p.public_id); };
  const commitRename = (p: ProjectData) => {
    if (finishedRef.current === p.public_id) return;
    finishedRef.current = p.public_id;
    const name = draft.trim();
    if (name && name !== p.name) onRename(p.public_id, name);
    setEditingId(null);
  };
  const cancelRename = (p: ProjectData) => { finishedRef.current = p.public_id; setEditingId(null); };
  const startDelete = (id: string) => { setEditingId(null); setConfirmId(id); };
  const confirmDelete = (id: string) => { onDelete(id); setConfirmId(null); };
```
渲染段所有 `p.id` 用作 key / 比较 / 入参的，改 `p.public_id`：`key={p.public_id}`、`editingId === p.public_id`、`confirmId === p.public_id`、`onClick={() => confirmDelete(p.public_id)}`、`onClick={() => choose(p.public_id)}`、`p.public_id === currentId`、`onClick={(e) => { e.stopPropagation(); startDelete(p.public_id); }}`。

- [ ] **Step 11: 翻转 `ChatPanel.tsx` 当前项目名查找**

`src/components/chat/ChatPanel.tsx` 第 38 行：
```tsx
  const currentName = projects.find((p) => p.public_id === currentProjectId)?.name ?? 'Project name';
```
（第 99–105 的 `currentId={currentProjectId}` 与 `onSelect/onRename/onDelete` 透传无需改——类型随 store/ProjectMenu 自动对齐。）

### 测试

- [ ] **Step 12: 重写 `project-url.test.ts`**

`src/lib/project-url.test.ts` 全文改为：
```ts
import { describe, expect, test } from 'vitest';
import { readProjectIdFromSearch, withProjectParam } from './project-url';

describe('readProjectIdFromSearch', () => {
  test('解析 public_id(纯字母)', () => {
    expect(readProjectIdFromSearch('?project=DakkYXUy')).toBe('DakkYXUy');
  });
  test('兼容旧数值链(opaque token)', () => {
    expect(readProjectIdFromSearch('?project=73')).toBe('73');
  });
  test('缺失参数返回 null', () => {
    expect(readProjectIdFromSearch('')).toBeNull();
    expect(readProjectIdFromSearch('?foo=1')).toBeNull();
  });
  test('非法值(含非字母数字字符)返回 null', () => {
    expect(readProjectIdFromSearch('?project=ab-cd')).toBeNull();
    expect(readProjectIdFromSearch('?project=1.5')).toBeNull();
    expect(readProjectIdFromSearch('?project=')).toBeNull();
  });
});

describe('withProjectParam', () => {
  test('空 search 写入参数', () => {
    expect(withProjectParam('', 'DakkYXUy')).toBe('?project=DakkYXUy');
  });
  test('更新已有参数并保留其他参数', () => {
    expect(withProjectParam('?foo=1&project=aaa', 'bbb')).toBe('?foo=1&project=bbb');
  });
  test('id 为 null 时移除参数;移除后无参数返回空串', () => {
    expect(withProjectParam('?project=aaa', null)).toBe('');
    expect(withProjectParam('?foo=1&project=aaa', null)).toBe('?foo=1');
  });
});
```

- [ ] **Step 13: 更新 `actions.test.ts`（mock 补 public_id + 断言改 public_id + 旧数值链兼容用例）**

规则：`src/store/actions.test.ts` 中**每个 `ProjectData` 字面量都补 `public_id: 'p<id>'`**（如 id 7 → `public_id: 'p7'`），并补 `cover_source: null`。`currentProjectId` 的设置与断言由数值改为对应 public_id 字符串。逐处：

- L40 mock：`{ id: 7, public_id: 'p7', name: 'A', cover_url: null, cover_source: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' }`；L45 断言 `toBe('p7')`。
- L51 createProject mock：`{ id: 99, public_id: 'p99', ... cover_source: null, ... }`；L57 断言 `toBe('p99')`；L58 `objectContaining({ id: 99 })` 保持。
- L63 同上补 `public_id: 'p99'` / `cover_source: null`。
- L72 mock 补 `public_id: 'p7'` / `cover_source: null`；L77 断言 `toBe('p7')`。
- L82–88 selectProject 用例：`useStore.setState({ currentProjectId: 'p1', ... })`，`await selectProject('p2')`（mock 项目需含 id1/p1、id2/p2；若该用例只切 id 不读 list，直接把 `selectProject(2)` 改 `selectProject('p2')`、`currentProjectId: 1` 改 `'p1'`）。
- L96 createProject mock：`{ id: 9, public_id: 'p9', ... cover_source: null }`；L100 断言 `toBe('p9')`。
- L105–114 deleteProject 用例：两条 mock 补 `public_id: 'p1'` / `'p2'` / `cover_source: null`；`currentProjectId: 'p1'`；`deleteProject('p1')`；断言 `toBe('p2')`（`api.deleteProject.mockResolvedValue({ id: 1 })` 不变）。
- L137–148「URL ?project 优先」用例：改为 public_id 形式——
  ```ts
  window.history.replaceState(null, '', '/?project=p8');
  // items 含 { id: 7, public_id: 'p7', ... } 与 { id: 8, public_id: 'p8', ... }(均补 cover_source: null)
  useStore.setState({ currentProjectId: 'p7' });
  await useStore.getState().loadProjects();
  expect(useStore.getState().currentProjectId).toBe('p8');
  expect(window.location.search).toBe('?project=p8');
  ```
- 「URL 项目不在列表中则回退」用例：URL 用 `/?project=zzz`，mock 项目 `{ id: 7, public_id: 'p7', ... }`，`currentProjectId: 'p7'`，断言 `toBe('p7')` 且 `window.location.search` 为 `?project=p7`。
- 「无 URL 参数沿用现状」用例：mock `public_id: 'p7'`，断言 `toBe('p7')`、URL `?project=p7`。
- 其余 mock（含「await 期间切走」用例等）一律补 `public_id` / `cover_source: null`。

- [ ] **Step 14: 新增「旧数值链归一为 public_id」用例**

在 `src/store/actions.test.ts` 追加：
```ts
  test('loadProjects:旧数值链 ?project=<id> 命中后归一为 public_id 并纠正 URL', async () => {
    window.history.replaceState(null, '', '/?project=8');
    api.listProjects.mockResolvedValue({ items: [
      { id: 7, public_id: 'p7', name: 'A', cover_url: null, cover_source: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
      { id: 8, public_id: 'p8', name: 'B', cover_url: null, cover_source: null, current_version_id: null, status: 'draft', created_at: '', updated_at: '' },
    ], total: 2, page: 1, page_size: 100 });
    api.listCanvasItems.mockResolvedValue({ items: [], total: 0 });
    api.listVersions.mockResolvedValue({ items: [], total: 0 });
    await useStore.getState().loadProjects();
    expect(useStore.getState().currentProjectId).toBe('p8');
    expect(window.location.search).toBe('?project=p8');
  });
```

- [ ] **Step 15: 更新 `ProjectMenu.test.tsx`**

`src/components/chat/ProjectMenu.test.tsx`：`proj` 工厂补 `public_id`，`currentId` 改字符串：
```tsx
const proj = (id: number, name: string): ProjectData => ({
  id, public_id: `p${id}`, name, cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '',
});
...
    projects: [proj(1, 'Alpha'), proj(2, 'Beta')],
    currentId: 'p1',
```
若用例断言 `onSelect`/`onRename`/`onDelete` 的入参，改为期望对应 `public_id`（如 `'p1'`/`'p2'`）。

- [ ] **Step 16: 更新 `useCanvasAutoImport.test.tsx`**

`src/client/useCanvasAutoImport.test.tsx`：`currentProjectId: 42 → 'p42'`、`currentProjectId: 7 → 'p7'`，且按项目 key 同步：`importedByProject: { '42': [...] } → { 'p42': [...] }`。

- [ ] **Step 17: 更新 `koubou-seed.test.ts`**

`src/store/koubou-seed.test.ts`：`currentProjectId: 42 → 'p42'`；断言 `importedByProject['42'] → importedByProject['p42']`（两处）。

- [ ] **Step 18: 更新 `history-pagination.test.ts`**

`src/store/history-pagination.test.ts`：`currentProjectId: 42 → 'p42'`；`listEvents` 断言 `toHaveBeenCalledWith(42, 's1', ...) → toHaveBeenCalledWith('p42', 's1', ...)`；`switchProjectSession(99) → switchProjectSession('p99')`、`currentProjectId: 99 → 'p99'`。（事件 payload 里的 `project_id: '42'` 属协议元数据，不动。）

### 收口

- [ ] **Step 19: 类型检查 + 全量测试 + lint**

Run:
```bash
pnpm exec tsc --noEmit && pnpm test && pnpm lint
```
Expected: tsc 无报错；全部测试 PASS；lint 无报错。若有遗漏的 `number` 项目 id 引用，tsc 会精确指出，按同样规则补改。

- [ ] **Step 20: 提交**

```bash
git add -A
git commit -m "feat: 项目标识从数值 id 全量切到 public_id"
```

---

## Self-Review（计划 vs spec 覆盖核对）

- ✅ 后端契约 / 核心决策：Task 2 Step 1（public_id 字段）+ 全量翻转覆盖。
- ✅ URL 契约含旧数值链兼容：Step 2（解析）+ Step 7（选定归一）+ Step 12/14（用例）。
- ✅ 逐文件改动：types/client/store-types/store-index/actions/koubou-hook 均有对应 step；spec 未列全的 `ChatPanel`/`ProjectMenu` 在 Step 10/11 补齐。
- ✅ landing 调整：Task 1 完整覆盖（games.ts/test、LandingPage.tsx/test）。
- ✅ 边界/迁移：旧持久化数值 `currentProjectId` 不命中回退 → 由 Step 7 `stillThere` 逻辑保证（不匹配则走 URL/首个）；无需额外代码。
- ✅ 测试：project-url、actions（含旧链归一新用例）、ProjectMenu、useCanvasAutoImport、koubou-seed、history-pagination 全部更新。
- ✅ 非目标：未恢复 Remix、未引入解析层/缓存、未改 Koubou 协议——计划中无相关任务。
- 类型一致性：`public_id`（非 `publicId`）、`readProjectIdFromSearch` 返回 `string|null`、`currentProjectId: string|null`、各 action 形参 `string` —— 全文一致。
