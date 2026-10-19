# 画布视口持久化 + 一键整理自动 fitView 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按项目持久化画布缩放/坐标（刷新/切项目恢复），并让一键整理后自动 fitView 取景。

**Architecture:** store 新增持久化切片 `viewportByProject` 记录每个项目的 `{x,y,zoom}`；`AssetCanvas` 在 `onMoveEnd`（仅用户手势，`event==null` 的程序化变更跳过）写入、首帧用 `defaultViewport` 恢复（无闪烁）、切项目用 effect 恢复；一键整理后 `requestAnimationFrame` 里 `fitView` 并在其完成后显式持久化整理框景。视口 zoom 夹取下沉为纯函数 `clampViewport`。

**Tech Stack:** Next.js 16 / React 19 / zustand(+persist) / `@xyflow/react` / vitest。

## Global Constraints

- 代码注释 / commit message 一律用**中文**，一句话总结变更。
- commit message 末尾追加：`Claude-Session: https://claude.ai/code/session_01KeCox3qPB8KjvtAVp7JEt4`
- 纯逻辑 TDD，测试与源码**同目录**（`*.test.ts(x)`）。
- 状态变更走**不可变更新**（`set` 返回新对象）；store 是唯一落库入口。
- react-hooks lint 约束：**禁 effect 内 setState、禁渲染期 ref 变更**。ReactFlow 的 `setViewport`/`fitView` 是命令式调用（非 React setState），可在 effect 内调用；ref 变更只在 effect / 事件回调内做，不在渲染期。
- 画布缩放范围恒为 `[0.1, 2]`（与 `<ReactFlow minZoom maxZoom>` 对齐）。
- 一键整理 fitView 用**默认全量缩放范围**（可放大到 200%）；初始 / 切项目兜底 fitView 仍锁 `{minZoom:1,maxZoom:1}`。
- persist key 恒为 `taluna-v4`（勿改，被 layout.tsx 防白闪脚本硬编码引用）；本计划只新增切片键，无 migration。
- 每个任务结束跑 `pnpm exec tsc --noEmit` + 相关测试；最终任务跑全量 `tsc + test + build`。
- worktree 内所有 Edit/Write 用 worktree 绝对路径 `/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-viewport-persist/...`，改后用 `git -C <worktree>` 校验落点。

---

## 文件结构

- **Create** `src/lib/viewport-clamp.ts` — 纯函数 `clampViewport` + 常量 `VIEWPORT_MIN_ZOOM`/`VIEWPORT_MAX_ZOOM`。（不放进已有 `src/lib/viewport.ts`——那是副作用注册表，职责不同。）
- **Create** `src/lib/viewport-clamp.test.ts` — `clampViewport` 单测。
- **Modify** `src/store/types.ts` — `ServerState` 增 `viewportByProject`；`createInitialServerState` 补初值；导入 `Viewport` 类型。
- **Modify** `src/store/actions.ts` — 实现 `setProjectViewport`；`deleteProject` 剔除对应 key；`return` 导出。
- **Modify** `src/store/index.ts` — `partialize` 增 `viewportByProject`。
- **Modify** `src/store/actions.test.ts` — `setProjectViewport` 与 `deleteProject` 清理的测试。
- **Modify** `src/components/canvas/AssetCanvas.tsx` — `onMoveEnd` 记录、首帧 `defaultViewport`/切项目恢复、`onTidy` 追加 fitView。

---

## Task 1: `clampViewport` 纯函数

**Files:**
- Create: `src/lib/viewport-clamp.ts`
- Test: `src/lib/viewport-clamp.test.ts`

**Interfaces:**
- Consumes: `Viewport`（`@xyflow/react`，形状 `{ x: number; y: number; zoom: number }`）。
- Produces:
  - `export const VIEWPORT_MIN_ZOOM = 0.1`
  - `export const VIEWPORT_MAX_ZOOM = 2`
  - `export function clampViewport(vp: Viewport, min?: number, max?: number): Viewport`

- [ ] **Step 1: 写失败测试**

`src/lib/viewport-clamp.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { clampViewport, VIEWPORT_MIN_ZOOM, VIEWPORT_MAX_ZOOM } from './viewport-clamp';

describe('clampViewport 视口 zoom 夹取', () => {
  test('范围内的 zoom 原样透传,x/y 不变', () => {
    expect(clampViewport({ x: 12, y: -34, zoom: 1 })).toEqual({ x: 12, y: -34, zoom: 1 });
  });
  test('zoom 低于下界 → 夹到 min,x/y 不变', () => {
    expect(clampViewport({ x: 7, y: 8, zoom: 0.01 })).toEqual({ x: 7, y: 8, zoom: VIEWPORT_MIN_ZOOM });
  });
  test('zoom 高于上界 → 夹到 max,x/y 不变', () => {
    expect(clampViewport({ x: 5, y: 6, zoom: 9 })).toEqual({ x: 5, y: 6, zoom: VIEWPORT_MAX_ZOOM });
  });
  test('可传自定义 min/max', () => {
    expect(clampViewport({ x: 0, y: 0, zoom: 3 }, 0.5, 1.5)).toEqual({ x: 0, y: 0, zoom: 1.5 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/viewport-clamp.test.ts`
Expected: FAIL — 找不到模块 `./viewport-clamp`。

- [ ] **Step 3: 写最小实现**

`src/lib/viewport-clamp.ts`:

```ts
import type { Viewport } from '@xyflow/react';

// 画布缩放范围(与 AssetCanvas 的 minZoom/maxZoom 对齐)
export const VIEWPORT_MIN_ZOOM = 0.1;
export const VIEWPORT_MAX_ZOOM = 2;

// 把视口 zoom 夹到 [min,max];x/y 原样透传。防止脏 localStorage / 越界值破坏画布。
export function clampViewport(
  vp: Viewport,
  min = VIEWPORT_MIN_ZOOM,
  max = VIEWPORT_MAX_ZOOM,
): Viewport {
  return { x: vp.x, y: vp.y, zoom: Math.min(max, Math.max(min, vp.zoom)) };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/viewport-clamp.test.ts`
Expected: PASS（4 个用例全绿）。

- [ ] **Step 5: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add src/lib/viewport-clamp.ts src/lib/viewport-clamp.test.ts
git commit -m "feat: 新增 clampViewport 纯函数——视口 zoom 夹取到 [0.1,2]

Claude-Session: https://claude.ai/code/session_01KeCox3qPB8KjvtAVp7JEt4"
```

---

## Task 2: store 视口切片 + `setProjectViewport` action

**Files:**
- Modify: `src/store/types.ts:111-135`（`ServerState` 接口 + `createInitialServerState`）
- Modify: `src/store/actions.ts:1-10`（import）、`:203-208`（`deleteProject`）、`:688-694`（`return`）、新增 action
- Modify: `src/store/index.ts:344-353`（`partialize`）
- Test: `src/store/actions.test.ts`（新增 describe 块）

**Interfaces:**
- Consumes: `clampViewport`（Task 1）、`Viewport`（`@xyflow/react`）。
- Produces:
  - `ServerState.viewportByProject: Record<string, Viewport>`
  - `ServerActions.setProjectViewport: (pid: number, vp: Viewport) => void`（`ServerActions = ReturnType<typeof createServerActions>`，加入 `return` 即自动纳入类型，无需单独声明接口）。

- [ ] **Step 1: 写失败测试**

在 `src/store/actions.test.ts` 末尾追加（`proj`/`api`/`beforeEach` 已在文件头部就绪）：

```ts
describe('setProjectViewport 画布视口按项目持久化', () => {
  test('写入 viewportByProject[String(pid)],zoom 经 clamp', () => {
    useStore.getState().setProjectViewport(7, { x: 100, y: 200, zoom: 9 });
    expect(useStore.getState().viewportByProject['7']).toEqual({ x: 100, y: 200, zoom: 2 });
  });

  test('多项目互不干扰', () => {
    useStore.getState().setProjectViewport(1, { x: 1, y: 1, zoom: 1 });
    useStore.getState().setProjectViewport(2, { x: 2, y: 2, zoom: 1.5 });
    expect(useStore.getState().viewportByProject).toEqual({
      '1': { x: 1, y: 1, zoom: 1 },
      '2': { x: 2, y: 2, zoom: 1.5 },
    });
  });

  test('deleteProject 同步剔除对应项目的视口', async () => {
    api.deleteProject.mockResolvedValue(undefined);
    useStore.setState({
      projects: [proj(1), proj(2)],
      currentProjectId: 2, // 删非当前项目,避免走 selectProject 分支
      viewportByProject: { '1': { x: 0, y: 0, zoom: 1 }, '2': { x: 5, y: 5, zoom: 1.2 } },
    });
    await useStore.getState().deleteProject(1);
    expect(useStore.getState().viewportByProject).toEqual({ '2': { x: 5, y: 5, zoom: 1.2 } });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "setProjectViewport"`
Expected: FAIL — `setProjectViewport is not a function` / `viewportByProject` 为 undefined。

- [ ] **Step 3: `types.ts` 加切片**

`src/store/types.ts` 顶部 import 段加入 Viewport 类型（与现有 import 并列）：

```ts
import type { Viewport } from '@xyflow/react';
```

`ServerState` 接口内，`agentTasksByProject` 那行下方新增（第 130 行后）：

```ts
  viewportByProject: Record<string, Viewport>;   // 按项目持久化画布视口(缩放+坐标),刷新/切项目恢复用
```

`createInitialServerState` 的返回对象末尾（`agentTasksByProject: {}` 后）追加：

```ts
, viewportByProject: {}
```

即该行变为：
```ts
  return { booting: true, projects: [], currentProjectId: null, assets: [], versions: [], activeVersionId: null, genTasks: [], deletingIds: [], pendingVersionId: null, buildingVersion: null, authRequired: false, userInfo: null, credit: null, lastError: null, rezonaEligible: null, koubouByProject: {}, genTasksByProject: {}, importedByProject: {}, agentTasksByProject: {}, viewportByProject: {} };
```

- [ ] **Step 4: `actions.ts` 实现 action + deleteProject 清理 + 导出**

`src/store/actions.ts` import 段加入（与现有 `@/lib/*` import 并列）：

```ts
import { clampViewport } from '@/lib/viewport-clamp';
import type { Viewport } from '@xyflow/react';
```

`deleteProject`（当前 203-208 行）在解构 `restAgentTasks` 后加一行解构，并把 `viewportByProject` 加进 `set`：

```ts
  const deleteProject = async (id: number) => guard(set, async () => {
    await pgcApi.deleteProject(id);
    const rest = get().projects.filter((p) => p.id !== id);
    const { [String(id)]: _removed, ...restGenTasks } = get().genTasksByProject;
    const { [String(id)]: _removedAgent, ...restAgentTasks } = get().agentTasksByProject;   // eslint 解构剔除,_ 前缀标记未用
    const { [String(id)]: _removedVp, ...restViewport } = get().viewportByProject;   // 同步剔除该项目视口
    set({ projects: rest, genTasksByProject: restGenTasks, agentTasksByProject: restAgentTasks, viewportByProject: restViewport });
```

（其余 `deleteProject` 内容不变。）

在 `tidyCanvas` 附近（如紧随 `persistAssetPosition`/`tidyCanvas` 定义之后）新增同步 action：

```ts
  // 记录某项目的画布视口(缩放+坐标),由 AssetCanvas 的 onMoveEnd 手势结束时调;写前 clamp zoom 防越界/脏数据。
  const setProjectViewport = (pid: number, vp: Viewport) =>
    set((s) => ({ viewportByProject: { ...s.viewportByProject, [String(pid)]: clampViewport(vp) } }));
```

`return {}`（当前 688-694 行）加入 `setProjectViewport`，例如放到 `persistAssetPosition, tidyCanvas` 一行：

```ts
    uploadAsset, deleteCanvasItem, persistAssetPosition, tidyCanvas, setProjectViewport, pollGenTasks, restoreGenTasks,
```

- [ ] **Step 5: `index.ts` partialize 持久化**

`src/store/index.ts` 的 `partialize`（当前 344-353 行）在 `agentTasksByProject` 行后新增：

```ts
        agentTasksByProject: s.agentTasksByProject,
        viewportByProject: s.viewportByProject,
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "setProjectViewport"`
Expected: PASS（3 个用例全绿）。

- [ ] **Step 7: 全量类型检查 + store 测试**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/store/actions.test.ts`
Expected: 无类型错误；store 测试全绿（含既有用例，未回归）。

- [ ] **Step 8: 提交**

```bash
git add src/store/types.ts src/store/actions.ts src/store/index.ts src/store/actions.test.ts
git commit -m "feat: store 新增 viewportByProject 持久切片 + setProjectViewport action

Claude-Session: https://claude.ai/code/session_01KeCox3qPB8KjvtAVp7JEt4"
```

---

## Task 3: AssetCanvas 视口记录与恢复接线

React Flow 命令式接线，无法对其内部视口做纯单测；本任务靠 `tsc`/`build` + 最终任务的运行态验证守护（沿用仓库"AssetCanvas 不做组件单测、纯逻辑下沉"的惯例）。

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`

**Interfaces:**
- Consumes: `clampViewport`（Task 1）、`setProjectViewport`（Task 2）、`Viewport`（`@xyflow/react`）、`useStore`。

- [ ] **Step 1: 补 import**

`AssetCanvas.tsx` 顶部 `@xyflow/react` 的 import 块内 `type Node,` 旁加 `type Viewport,`：

```tsx
  useViewport,
  type Node,
  type Viewport,
} from '@xyflow/react';
```

在文件已有 import 区加入：

```tsx
import { clampViewport } from '@/lib/viewport-clamp';
```

- [ ] **Step 2: Inner 内取 action / 扩展 useReactFlow 解构**

`Inner` 组件内，现有 `const tidyCanvas = useStore((s) => s.tidyCanvas);` 下方加一行：

```tsx
  const setProjectViewport = useStore((s) => s.setProjectViewport);
```

把 useReactFlow 解构（当前 `const { screenToFlowPosition, setCenter, getViewport, getNodes } = useReactFlow();`）改为：

```tsx
  const { screenToFlowPosition, setCenter, getViewport, getNodes, setViewport, fitView } = useReactFlow();
```

- [ ] **Step 3: 首帧视口快照 + 切项目订阅**

在 `Inner` 内（`wrapRef` 声明附近）新增。`currentProjectId` 订阅用于驱动切项目 effect；`initialViewport` 惰性读一次保存视口作首帧 defaultViewport：

```tsx
  const currentProjectId = useStore((s) => s.currentProjectId);

  // 首帧视口:惰性读一次当前项目的保存视口(读一次,之后 viewportByProject 变化不重建 defaultViewport,避免与用户实时平移打架)
  const [initialViewport] = useState<Viewport | undefined>(() => {
    const pid = useStore.getState().currentProjectId;
    const saved = pid != null ? useStore.getState().viewportByProject[String(pid)] : undefined;
    return saved ? clampViewport(saved) : undefined;
  });

  // 切项目恢复:AssetCanvas 全程只挂载一次,首帧由 defaultViewport/fitView prop 处理,故 ref 初值=挂载时 pid,只在真正切换时恢复。
  // 有保存视口 → 立即 setViewport(与节点无关);无 → 记 pending,待新项目节点就位后由下方 effect fitView(selectProject 切项目会先清空 assets,rfNodes 必然先空后填)。
  const restoredPidRef = useRef(currentProjectId);
  const pendingFitPidRef = useRef<number | null>(null);
  useEffect(() => {
    if (currentProjectId === restoredPidRef.current) return;
    restoredPidRef.current = currentProjectId;
    if (currentProjectId == null) return;
    const saved = useStore.getState().viewportByProject[String(currentProjectId)];
    if (saved) {
      pendingFitPidRef.current = null;
      void setViewport(clampViewport(saved));   // 瞬时,无动画
    } else {
      pendingFitPidRef.current = currentProjectId;   // 待节点就位后 fitView
    }
  }, [currentProjectId, setViewport]);
```

- [ ] **Step 4: 待节点就位后的 fitView 兜底 effect**

紧接上一个 effect 之后新增。依赖 `rfNodes`（在 Step 3 之后、`rfNodes` 声明之后放置——注意 `rfNodes` 定义在 `const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);`，本 effect 须放在其**下方**）：

```tsx
  // 切到"无保存视口"的项目:等该项目节点渲染出来后 fitView 取景(rfNodes 由空→有;pendingFitPidRef 只允许触发一次)
  useEffect(() => {
    if (pendingFitPidRef.current == null) return;
    if (pendingFitPidRef.current !== useStore.getState().currentProjectId) { pendingFitPidRef.current = null; return; }
    if (rfNodes.length === 0) return;
    pendingFitPidRef.current = null;
    const raf = requestAnimationFrame(() => void fitView({ minZoom: 1, maxZoom: 1 }));
    return () => cancelAnimationFrame(raf);
  }, [rfNodes, fitView]);
```

- [ ] **Step 5: ReactFlow 挂 onMoveEnd + 首帧 init props**

`<ReactFlow>` 上：新增 `onMoveEnd`（放在其它 `on*` handler 旁）：

```tsx
        onMoveEnd={(event, vp) => {
          // 只持久化用户手势(平移/缩放)。程序化 setViewport/fitView 触发的 onMoveEnd 其 event 为 null——
          // 必须跳过:panOnScroll 下 onMoveEnd 走共享定时器延迟 ~150ms,切项目时上一项目的 restore setViewport
          // 会调度一次延迟 onMoveEnd,若期间又切到无保存视口的项目,该回调按 fire 时的 currentProjectId 把旧视口误写进新项目槽位。
          // 程序化视口的持久化各自在提交处显式处理(tidy 见 Task 4;restore 用的就是已保存值,无需回写)。
          if (event == null) return;
          const pid = useStore.getState().currentProjectId;
          if (pid != null) setProjectViewport(pid, vp);
        }}
```

把当前的：

```tsx
        fitView
        // 默认缩放锁定 100%:fitView 仍把内容居中,但 min/maxZoom 同设为 1 强制初始缩放为 1(不影响用户后续自由缩放)
        fitViewOptions={{ minZoom: 1, maxZoom: 1 }}
```

替换为（有保存视口 → 首帧 defaultViewport 无闪烁;无 → 维持初始 fitView 锁 100%）：

```tsx
        {...(initialViewport
          ? { defaultViewport: initialViewport }
          : { fitView: true, fitViewOptions: { minZoom: 1, maxZoom: 1 } })}
```

（`minZoom={0.1}` / `maxZoom={2}` 两行保持不变。）

- [ ] **Step 6: 类型检查 + 构建**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: 无类型错误；构建成功。

- [ ] **Step 7: lint**

Run: `pnpm lint`
Expected: 无新增告警（尤其无 react-hooks/set-state-in-effect——本任务 effect 只调命令式 API + 改 ref，不 setState）。

- [ ] **Step 8: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 画布视口按项目记录与恢复——onMoveEnd 落库 + 首帧 defaultViewport + 切项目恢复

Claude-Session: https://claude.ai/code/session_01KeCox3qPB8KjvtAVp7JEt4"
```

---

## Task 4: 一键整理后自动 fitView + 手势持久化归属收尾

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`（`Inner.onTidy`，与 `onMoveStart`/`onMoveEnd` 接线）

**Interfaces:**
- Consumes: `fitView` / `getViewport`（useReactFlow 解构，Task 3 已引入 `fitView`；`getViewport` 是 Inner 既有解构）、`tidyCanvas`、`setProjectViewport`（Task 3 已在 Inner 选取）。

- [ ] **Step 1: onTidy 追加 fitView**

把 `onTidy`（当前）：

```tsx
  const onTidy = () => {
    setTidying(true);
    // 从 React Flow 取各节点量得的真实尺寸(measured 优先,回退声明值),喂给 tidyLayout 做按尺寸布局
    const sizeById: Record<string, { width: number; height: number }> = {};
    for (const n of getNodes()) {
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (typeof width === 'number' && typeof height === 'number') sizeById[n.id] = { width, height };
    }
    tidyCanvas(sizeById);
    if (tidyTimer.current) clearTimeout(tidyTimer.current);
    tidyTimer.current = setTimeout(() => setTidying(false), 340);
  };
```

改为在 `tidyCanvas` 之后、下一帧 fitView（等 store set → sync effect setRfNodes → ReactFlow 拿到新 position 后再取景；用默认全量缩放范围可放大到 200%）：

```tsx
  const onTidy = () => {
    setTidying(true);
    // 从 React Flow 取各节点量得的真实尺寸(measured 优先,回退声明值),喂给 tidyLayout 做按尺寸布局
    const sizeById: Record<string, { width: number; height: number }> = {};
    for (const n of getNodes()) {
      const width = n.measured?.width ?? n.width;
      const height = n.measured?.height ?? n.height;
      if (typeof width === 'number' && typeof height === 'number') sizeById[n.id] = { width, height };
    }
    // 整理时同步捕获项目 id:fitView 动画 + rAF 需 ~400ms,期间可能切项目,resolve 时才读 currentProjectId 会把 A 的框景误写进新项目槽位(同 onMoveEnd 竞态根因,源头定归属)。
    const pidAtTidy = useStore.getState().currentProjectId;
    tidyCanvas(sizeById);
    // 等重排后的新坐标经 store→sync effect 落到 ReactFlow,下一帧再 fitView 取景;fitView 带动画,与卡片位移过渡(.canvas-tidying 340ms)并行。
    // onMoveEnd 只记用户手势(event==null 的程序化变更被跳过),故 fitView 完成后显式记录整理后的视口,保证刷新后整理框景保持。
    // fitView() 返回 Promise,v12 约定在过渡结束后 resolve → then 里读到最终视口。
    requestAnimationFrame(() => {
      void fitView({ duration: 400 })
        .then(() => {
          // 切走了就不写,避免把整理框景污染进新项目;仍在原项目才持久化
          if (pidAtTidy != null && useStore.getState().currentProjectId === pidAtTidy) {
            setProjectViewport(pidAtTidy, getViewport());
          }
        })
        .catch(() => {});   // 过渡被切项目/再次整理打断时 RF 可能 reject,吞掉避免未处理拒绝
    });
    if (tidyTimer.current) clearTimeout(tidyTimer.current);
    tidyTimer.current = setTimeout(() => setTidying(false), 340);
  };
```

> **实现期须运行态核验**：确认 `fitView({duration:400})` 的 Promise 确实在动画结束后才 resolve（届时 `getViewport()` 为最终视口）。若实测提前 resolve(读到中途视口),改用 `setTimeout(() => { ... }, 420)`(略大于 duration)读 `getViewport()` 兜底。二者取其一,以刷新后整理框景与整理结束时一致为准。

- [ ] **Step 2: 手势持久化归属收尾（onMoveStart 捕获 pid）**

背景：Task 3 复审发现残余竞态——`panOnScroll` 下 `onMoveEnd` 走共享定时器延迟 ~150ms;若用户在项目 A 做**真实**平移/缩放手势后 150ms 内切到项目 C,该延迟回调触发时 `onMoveEnd` 读到的 `currentProjectId` 已是 C,会把 A 的手势视口误写进 C 槽位(永久,直到 C 被再次手动调整)。`event==null` gate 不覆盖此路径(它本就是真实手势)。根因是"fire 时才读 pid";修复=**手势起始时把 pid 捕获进 ref,onMoveEnd 写回该 pid**(把手势归属到它开始时的项目,即使期间切了项目)。

在 `Inner` 内其它 ref 旁新增：

```tsx
  // 手势起始时的项目 id:onMoveEnd 走 panOnScroll 150ms 共享定时器延迟触发,期间可能已切项目;
  // 把手势归属到起始项目,避免延迟回调按 fire 时的 currentProjectId 误写进新项目槽位。
  const moveStartPidRef = useRef<number | null>(null);
```

`<ReactFlow>` 新增 `onMoveStart`（放在 `onMoveEnd` 旁）。**必须**与 `onMoveEnd` 同款 `event == null` 网关——否则切到"有保存视口"的项目时,恢复用的程序化 `setViewport` 也会触发 `onMoveStart(event=null)` 无条件覆写 ref,把上一项目延迟 onMoveEnd 的手势归属篡改成新项目,竞态原样重现：

```tsx
        onMoveStart={(event) => {
          if (event == null) return;   // 程序化 setViewport/fitView 也会触发 onMoveStart(event=null),必须跳过,只在真实手势起始时捕获归属项目
          moveStartPidRef.current = useStore.getState().currentProjectId;
        }}
```

把 Task 3 的 `onMoveEnd`（当前）：

```tsx
        onMoveEnd={(event, vp) => {
          // 只持久化用户手势(平移/缩放)。程序化 setViewport/fitView 触发的 onMoveEnd 其 event 为 null——
          // 必须跳过:panOnScroll 下 onMoveEnd 走共享定时器延迟 ~150ms,切项目时上一项目的 restore setViewport
          // 会调度一次延迟 onMoveEnd,若期间又切到无保存视口的项目,该回调会按 fire 时的 currentProjectId 把旧视口误写进新项目槽位。
          if (event == null) return;
          const pid = useStore.getState().currentProjectId;
          if (pid != null) setProjectViewport(pid, vp);
        }}
```

改为读起始 pid（其余不变）：

```tsx
        onMoveEnd={(event, vp) => {
          // 只持久化用户手势(平移/缩放)。程序化 setViewport/fitView 触发的 onMoveEnd 其 event 为 null,跳过。
          if (event == null) return;
          // 归属到手势起始时的项目(见 moveStartPidRef 注释):防 150ms 延迟窗口内切项目把旧视口误写进新项目槽位。
          const pid = moveStartPidRef.current;
          if (pid != null) setProjectViewport(pid, vp);
        }}
```

- [ ] **Step 3: 类型检查 + 构建 + lint**

Run: `pnpm exec tsc --noEmit && pnpm build && pnpm lint`
Expected: 无类型错误；构建成功；AssetCanvas.tsx 无新增告警。

- [ ] **Step 4: 提交**

```bash
git add src/components/canvas/AssetCanvas.tsx
git commit -m "feat: 一键整理后自动 fitView + onMoveStart 捕获 pid 修手势跨项目误写

Claude-Session: https://claude.ai/code/session_01KeCox3qPB8KjvtAVp7JEt4"
```

---

## Task 5: 全量校验 + 运行态验证

**Files:** 无（仅验证）。

- [ ] **Step 1: 全量 CI 契约**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全绿。

- [ ] **Step 2: 运行态验证（Playwright，prod build）**

参照 memory「无后端驱动前端流程截图」「运行态验证本地坑与技巧」：用独立端口跑 prod build（避免与其它 worktree 的 dev 端口冲突渲染错代码），必要时 `page.route('**/api/pgc/**')` 注入信封 mock 或注入 `window.__store` 完整态。逐项确认：

1. **平移/缩放后刷新**：拖动/缩放画布 → 刷新 → 视口保持不变（读 localStorage `taluna-v4` 应含 `viewportByProject`）。
2. **切项目再切回**：项目 A 调好视口 → 切到项目 B → 切回 A → A 视口恢复；切到从未访问的项目 → fitView 取景（非沿用上一个项目视口）。
3. **一键整理**：点整理 → 卡片重排 + 视口自动 fitView 框住全部（卡少时可放大到 200%）；整理后刷新，整理后的视口保持。
4. **降低动态**：`prefers-reduced-motion` 下无异常（fitView duration 由 ReactFlow 处理，不属新增 keyframes，无需改 globals.css 禁用列表）。

- [ ] **Step 3: 校验提交落点在 worktree 分支**

Run: `git -C /Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-viewport-persist log --oneline -6`
Expected: Task 1-4 的 4 个 feat/docs 提交均在 `worktree-feat+canvas-viewport-persist` 分支上（防子 agent 误提交到 main）。

---

## Self-Review 记录

- **Spec 覆盖**：数据模型(Task 2)、记录时机 onMoveEnd(Task 3)、恢复时机 首帧+切项目(Task 3)、clampViewport(Task 1)、deleteProject 清理(Task 2)、一键整理 fitView(Task 4)、边界/测试(各任务 + Task 5)。均有对应任务。
- **无占位**：所有代码步骤均给出完整可粘贴代码与确切命令/预期。
- **类型一致**：`clampViewport(vp, min?, max?)`、`setProjectViewport(pid, vp)`、`viewportByProject: Record<string, Viewport>` 在 Task 1/2/3 引用一致；`Viewport` 均来自 `@xyflow/react`。
