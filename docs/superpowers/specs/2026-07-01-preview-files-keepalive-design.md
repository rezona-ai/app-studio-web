# Preview ↔ Files 切换 keep-alive 设计

日期：2026-07-01
状态：设计稿（待实现）

## 背景与问题

预览面板顶部有 Preview / Files 两个分段 tab（`PreviewPanel.tsx` 的 `PreviewTabs`）。当前舞台区（`PreviewPanel.tsx` 第 143-160 行）用**条件挂载**在二者间二选一：

```jsx
{filesTab ? <FilesView /> : <游戏预览 或 空态 />}
```

于是每次切换 tab 都会卸载一侧、挂载另一侧，代价是：

- **切到 Files**：`<GameFrame>` 卸载 → iframe 元素被销毁 → 正在运行的游戏 DOM/JS 运行态丢失。切回来重新挂载 → `previewVersionById` 重新取 URL → iframe 从头加载，游戏重来。
- **切回 Preview**：`<FilesView>` 卸载 → 其本地态全丢（`selectedPath`、树展开 `expanded`、搜索词 `query`、`cache.current` 的内容缓存）。再切回 Files → `useVersionFiles` 重新拉取文件清单。

结果就是两侧互相切换都不"丝滑"：游戏重载、文件重新请求。

## 关键约束（决定方案方向）

**正在运行的游戏活在 iframe 的 DOM / JS 运行时里，不在 React state。** 因此想保住"正在运行的游戏"，唯一办法是让 iframe 元素**留在 DOM 中（隐藏而非卸载）**——把状态提升进 store 也救不了运行态。这直接排除了"状态提升到 store"的思路，锁定为 **DOM 级 keep-alive**：用 CSS `display` 切显隐，而不是条件挂载。

## 范围（已与用户确认）

- **仅覆盖 Preview ↔ Files 的 tab 切换**。版本切换、刷新按钮、compare 开关**仍按现状走 `key` 重建（重载）**，不在本次保活范围。
- **后台运行可接受**：切到 Files 时被隐藏的游戏 iframe 仍在运行（计时器 / 背景音乐可能继续），用户已确认可接受。不尝试向任意第三方游戏发暂停指令（无统一协议，不可靠）。

## 方案

改动集中在 `src/components/preview/PreviewPanel.tsx` 一处，把舞台区的"二选一挂载"改成"两块常驻子树 + `display` 切显隐"。

### 舞台区结构（替换现 143-160 行）

```jsx
{/* 游戏预览:常驻挂载,Files 激活时仅 display:none 隐藏(keep-alive 保住 iframe 运行态)。
    外层只切显隐(不重挂、不参与动画);内层保留 key + anim-media-in,
    仅在 version.id / refreshNonce / compare 变化时重建并淡入(=预期的重载),tab 切换不触发。 */}
<div className={filesTab ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
  <div
    key={hasGame ? (compareOn ? `compare-${refreshNonce}` : `game-${refreshNonce}-${active?.id ?? 'none'}`) : 'empty'}
    className="anim-media-in flex min-h-0 flex-1 flex-col overflow-hidden"
  >
    {hasGame ? (
      compareOn ? <CompareView /> : <GameFrame version={active} />
    ) : (
      <空态提示 />
    )}
  </div>
</div>

{/* Files:首次激活后才挂载(lazy),此后常驻仅切显隐 —— 避免"从没开过 Files"也白拉一次清单 */}
{filesMounted && (
  <div className={filesTab ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
    <FilesView />
  </div>
)}
```

### lazy 挂载闩（遵守仓库 hooks 约束）

仓库禁止 effect 里 setState、禁止渲染期写 ref；改用"渲染期一次性 guard setState"：

```jsx
const [filesMounted, setFilesMounted] = useState(filesTab);
if (filesTab && !filesMounted) setFilesMounted(true); // 首次激活即置真,此后恒真
```

FilesView 一旦挂载就常驻，之后仅靠 `display` 切显隐，本地态与内容缓存全程保留。

## 为什么这样切分正确

- **`key` 语义不变**：内层 `key` 仍含 `refreshNonce` / `active.id` / compare。version 切换、刷新按钮、compare 开关会让内层重建 → GameFrame/CompareView 重挂 → iframe 重载并播 `anim-media-in`（预期行为，保留）。而 **filesTab 不参与 key**，所以 tab 切换只动外层 `display`，不重挂 → 丝滑。
- **动画不误触**：把 `anim-media-in` 放在**内层**（随 key 重建播放），外层只切 `display`。故 tab 切换是瞬时切显隐、无淡入闪烁；只有真正的重载才淡入。
- **`GameFrame` 的 ResizeObserver 无需改**：Files 激活时游戏舞台 `display:none`，RO 以 `h=0` 触发，被现有 `if (h <= 0 || h === lastH.current) return` 挡掉，`previewWidth` 不被污染；切回可见时 RO 拿到真实高 → 重新收敛面板宽。
- **project 切换自然成立**：切项目时 `activeVersionId` 变 → `active.id` 变 → 内层 key 变 → 游戏正常重载为新项目；`FilesView` 内部 effect 按 `projectId` 变化自动重取清单。`filesMounted` 闩跨项目保持为真即可，无需重置。
- **不引入新 token / 新动效 / 新组件**：纯改挂载与显隐逻辑，复用既有 `anim-media-in` 与布局类，符合 UI/UX 范式约束。

## 测试（TDD，落在 `src/components/preview/PreviewPanel.test.tsx`）

1. **游戏保活**：有版本 + 有游戏时，切到 Files 再切回 Preview，断言游戏区 iframe 为**同一个 DOM 节点**（未被重挂）。
2. **文件不重拉**：切到 Files（触发一次 `listVersionFiles`）→ 切回 Preview → 再切到 Files，断言 `pgcApi.listVersionFiles` **只被调用一次**（FilesView 保活，未重新拉清单）。
3. **lazy 挂载**：从未点开 Files 时，`listVersionFiles` **不被调用**（`filesMounted` 初始为 false，FilesView 未挂载）。

## 影响面

- 仅 `src/components/preview/PreviewPanel.tsx`（约 15 行）+ `PreviewPanel.test.tsx` 新增用例。
- `GameFrame.tsx` / `FilesView.tsx` / `useVersionFiles.ts` 无需改动。
- 无 store / 协议层 / 代理层改动。
