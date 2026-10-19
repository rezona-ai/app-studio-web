# Preview ↔ Files 切换 keep-alive 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让预览面板 Preview ↔ Files 两个 tab 互相切换时不卸载对方，游戏 iframe 与文件视图保活，切换丝滑无重载/重拉。

**Architecture:** 把 `PreviewPanel.tsx` 舞台区从"条件挂载二选一"改为"两块常驻子树 + CSS `display` 切显隐"。游戏预览常驻挂载（内层保留 `key` + `anim-media-in`，仅 version/refresh/compare 变化才重建重载）；FilesView 首次激活后 lazy 挂载并常驻。仅 filesTab 切换只动 `display`，不触发挂载/卸载。

**Tech Stack:** React 19 + Next 16 · zustand · Vitest + Testing Library（jsdom）。

## Global Constraints

- 注释 / commit message 一律用**中文**。
- **禁止 effect 里 setState、禁止渲染期写 ref**；lazy 挂载闩用"渲染期一次性 guard setState"。
- 不引入新颜色字面值 / 新 keyframes / 新按钮种类 / 新组件；复用既有 `anim-media-in` 与布局类。
- 只取后端文档约定字段，不臆测别名。
- 验证以 `pnpm exec tsc --noEmit` 与 `pnpm test` 退出码为准，忽略 worktree IDE 模块解析误报。

---

### Task 1: Preview ↔ Files keep-alive（测试 + 重构）

改动集中在两个文件，作为一个原子交付。

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`（新增 lazy 闩；替换舞台区第 143-160 行）
- Test: `src/components/preview/PreviewPanel.test.tsx`（补 import + 扩 beforeEach/afterEach + 3 条用例）

**Interfaces:**
- Consumes（现有，无需新增）：
  - store 选择器 `s.previewTab: 'preview' | 'files'`、action `s.setPreviewTab(tab)`；`s.currentProjectId`、`s.previewVersionById(id)`。
  - `pgcApi.listVersionFiles(pid: number, vid: string): Promise<{ version_id: string; items: { path: string; size: number; preview_url: string }[]; total: number }>`（`@/lib/pgc/client`）。
  - `FilesView`（`@/components/files/FilesView`，已 import）；`GameFrame` 渲染 `<iframe title="preview">`。
- Produces：无对外新接口，纯组件内部结构调整。

- [ ] **Step 1：测试文件加 import 并扩 before/after（为拦截清单拉取与 fetch 做准备）**

在 `src/components/preview/PreviewPanel.test.tsx`：

顶部 import 区新增（紧跟现有 `import type { Version } ...` 之后）：

```tsx
import { pgcApi } from '@/lib/pgc/client';

// Files 清单固定桩:含 index.html(text) 触发内容 fetch,故测试内 stub 掉 fetch
const filesFixture = {
  version_id: 'current',
  items: [
    { path: 'src/index.html', size: 10, preview_url: 'https://pgc.local/f/index.html' },
    { path: 'src/main.js', size: 20, preview_url: 'https://pgc.local/f/main.js' },
  ],
  total: 2,
};
```

`beforeEach` 的 `useStore.setState({ ... })` 里补一行（保证每例起始都在 Preview tab，避免用例间 previewTab 泄漏）：

```tsx
    previewTab: 'preview',
```

`afterEach` 改为（补 stub/spy 清理）：

```tsx
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
```

- [ ] **Step 2：写 3 条 keep-alive 失败测试（追加到文件末尾）**

```tsx
test('从未点开 Files 时不拉取文件清单(lazy 挂载)', async () => {
  const spy = vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();
  expect(spy).not.toHaveBeenCalled();
});

test('切到 Files 再切回,游戏 iframe 为同一 DOM 节点(未重挂,keep-alive)', async () => {
  vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x') }));
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();
  const before = document.querySelector('iframe[title="preview"]');
  expect(before).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await flush();

  const after = document.querySelector('iframe[title="preview"]');
  expect(after).toBe(before); // 未卸载 → 同一节点 → 游戏未重载
});

test('Preview↔Files 反复切换,文件清单只拉一次(FilesView 保活)', async () => {
  const spy = vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x') }));
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();

  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();

  expect(spy).toHaveBeenCalledTimes(1); // 首次挂载拉一次,之后仅切显隐不再拉
});
```

- [ ] **Step 3：运行新测试，确认 2 条按预期失败**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected:
- `从未点开 Files 时不拉取文件清单` **PASS**（当前条件挂载已是 lazy，作回归守卫）。
- `切到 Files 再切回,游戏 iframe 为同一 DOM 节点` **FAIL**（当前切 Files 卸载 GameFrame，切回重挂 → `after !== before`）。
- `Preview↔Files 反复切换,文件清单只拉一次` **FAIL**（当前 FilesView 每次挂载都拉 → 调用 2 次）。

- [ ] **Step 4：重构 `PreviewPanel.tsx` 实现 keep-alive**

4a. 在组件顶部 `const filesTab = useStore((s) => s.previewTab === 'files');`（第 59 行）**之后**新增 lazy 闩：

```tsx
  // Files 视图 lazy 保活闩:首次激活即挂载,此后常驻(仅切显隐),避免重复拉清单/丢本地态。
  // 渲染期一次性 guard setState(遵守仓库禁 effect-setState 约束)。
  const [filesMounted, setFilesMounted] = useState(filesTab);
  if (filesTab && !filesMounted) setFilesMounted(true);
```

（`useState` 已在第 2 行导入，无需新增 import。）

4b. 把舞台区（现第 143-160 行的 `{filesTab ? (<FilesView />) : (...)}` 整块）替换为：

```tsx
        {/* 舞台:游戏预览与 Files 并存,按 filesTab 切显隐(display 切换而非条件挂载),
            以保活游戏 iframe 运行态与 Files 视图的选中/展开/内容缓存。#13 */}
        {/* 游戏预览:常驻挂载,Files 激活时仅隐藏。外层只切显隐(不重挂、不动画);
            内层保留 key + anim-media-in,仅 version.id / refreshNonce / compare 变化才重建并淡入(=预期重载)。 */}
        <div className={filesTab ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
          <div
            key={hasGame ? (compareOn ? `compare-${refreshNonce}` : `game-${refreshNonce}-${active?.id ?? 'none'}`) : 'empty'}
            className="anim-media-in flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {hasGame ? (
              compareOn ? <CompareView /> : <GameFrame version={active} />
            ) : (
              <div className="flex h-full items-center justify-center bg-[var(--color-surface)] px-8 text-center">
                <span className="max-w-[206px] text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-muted)]">
                  {t('preview.emptyHint')}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Files:首次激活后才挂载(lazy),此后常驻仅切显隐,保住清单/选中/展开与内容缓存 */}
        {filesMounted && (
          <div className={filesTab ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <FilesView />
          </div>
        )}
```

- [ ] **Step 5：运行 PreviewPanel 测试，确认全绿**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: 全部 PASS（含原有用例：下载/刷新/分享/compare/账户条/tab 等）。特别核对：
- `点击刷新使预览 iframe 重建` 仍 PASS（内层 key 变仍重挂新 iframe）。
- 3 条新用例全 PASS。

- [ ] **Step 6：全量校验（类型 + lint + 测试）**

Run: `pnpm exec tsc --noEmit`
Expected: 无报错。

Run: `pnpm lint`
Expected: 无报错。

Run: `pnpm test`
Expected: 全套 PASS。

- [ ] **Step 7：提交**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/PreviewPanel.test.tsx
git commit -m "feat: Preview↔Files 切换 keep-alive——display 切显隐保活游戏 iframe 与文件视图,消除重载/重拉

Claude-Session: https://claude.ai/code/session_013TJ3ePbN5GhGL1JsjennbX"
```

---

## Self-Review

**Spec coverage：**
- keep-alive 用 `display` 切显隐而非条件挂载 → Step 4b ✓
- 游戏 iframe 保活（同节点）→ Step 2 测试 2 + Step 4b ✓
- FilesView 保活不重拉 → Step 2 测试 3 + Step 4b ✓
- FilesView lazy 挂载 → Step 4a 闩 + Step 2 测试 1 ✓
- `key` 语义不变（version/refresh/compare 仍重载）→ Step 4b 保留内层 key ✓
- 遵守仓库 hooks 约束（渲染期 guard setState）→ Step 4a ✓
- GameFrame/FilesView/useVersionFiles 不改动 → 计划未触及这些文件 ✓

**Placeholder scan：** 无 TBD/TODO；所有代码步骤含完整代码。✓

**Type consistency：** `filesMounted`/`setFilesMounted`、`filesTab`、`listVersionFiles` 返回 `{ version_id, items, total }` 与 `filesFixture` 一致；测试 spy/stub 与用法一致。✓
