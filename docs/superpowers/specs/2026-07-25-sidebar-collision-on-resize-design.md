# 窗口缩放时的左右边栏碰撞消解 — 设计稿

日期：2026-07-25

## 背景

三栏壳（`src/components/workspace/Workspace.tsx`）当前的宽度约束**只在拖拽时**生效：

- Chat 列宽 `chatW`（本地 state，`CHAT_W_MIN=360` / `CHAT_W_MAX=800`，持久化 `workspace.chatWidth`）；
- 预览列宽 `previewW`（本地 state，动态上下限 `maxPreviewWidth` / `minPreviewWidth`，持久化 `workspace.previewWidth`）；
- 画布列 `flex-1 min-w-0`，内层 `minWidth: CANVAS_WIDTH_MIN` + 自身横向滚动；
- 拖 Chat 分隔条时上限再夹「视口 − 预览列 − 2」，拖预览分隔条时上限含 `bySpace = 视口 − Chat − 2`——即**对称的互不越界规则**。

问题在于窗口本身缩小时没有任何一侧重新夹取：Chat 与预览都是 `shrink-0`，画布列被压到 0 之后整行溢出容器，而预览 overlay 是 `absolute right-0`（相对视口宽的 flex 容器），于是**预览面板直接压在 Chat 面板上**——两栏视觉重叠、Chat 右半被盖住，且没有任何滚动兜底可以把被盖住的部分拉出来。

## 目标

- 窗口尺寸变化时做边栏碰撞检测：两栏合计（含 2px 分隔条）超出视口即消解，不再出现重叠。
- 消解优先级：**先压右边栏（预览）到其动态下限；右边栏已到下限则压左边栏（Chat）到 `CHAT_W_MIN`**。
- 页面最小宽度 = 左右边栏各自最小宽度之和（+ 分隔条）。视口窄于此不再压栏，改由**页面横向滚动**兜底。
- 自动消解**不覆盖用户期望宽度**：窗口重新变大时两栏回到用户拖拽/展开选择的宽度。
- 不改变拖拽、一键全宽/恢复、Compare / Files 全宽覆盖的既有语义。

## 约束

- 宽度真相源仍是 `Workspace` 本地 state（本需求不引入 store 字段，跨组件无人需要它）。
- 纯几何计算必须是无副作用纯函数并单测（`src/lib/`），副作用（`resize` 监听、`localStorage`）留在组件。
- 画布列不参与最小宽度预算：Nick 明确页面最小宽 = 两边栏最小宽之和，故极窄视口下画布列可被压到 0（其内层 `CANVAS_WIDTH_MIN` + 横向滚动保持覆盖组件可用性不变）。
- 首屏 SSR 无 `window`：视口相关派生值挂载后才可测，不得引入 hydration mismatch（会抹掉 `<html data-theme>`）。

## 方案比较

### 方案 A：期望宽 ref + `resize` 时统一重夹（推荐）

把「用户期望宽」与「本次视口下的实际宽」分离：

- 期望宽存 ref（`desiredChatW` / `desiredPreviewW`），只在用户动作（拖拽落手、一键全宽/恢复、挂载时读 `localStorage`）时更新，并与 `localStorage` 同写；
- 实际宽存 state，由纯函数 `fitSidebars(期望宽, 视口宽, 视口高)` 在挂载与每次 `resize` 时算出；
- 视口尺寸进 state（`viewport`），`minPageWidth(视口高)` 与 `maxPreviewWidth` 等派生值不再在渲染期读 `window`。

优点：

- 碰撞消解与「窗口变大后复原」是同一条式子的两个方向，不需要额外的复原分支；
- 自动消解天然不写 `localStorage`，用户偏好不被窗口抖动腐蚀（刷新后仍是自己拖的宽度）；
- 复用既有 `maxPreviewWidth`（其 `bySpace` 项本就是「视口 − Chat − 2」）表达「先压右栏」，优先级规则只剩一行 Chat 兜底夹取；
- 视口入 state 顺带修掉一个既有小毛病：仅缩放窗口（未触发宽度变化）时 `previewFull` 派生值不刷新，把手箭头方向会停在旧态。

代价：期望宽与实际宽两套值，写入点必须成对维护（拖拽落手 / 一键展开 / 恢复），靠 `persistWidth(key, ref, w)` 一处收口。

### 方案 B：直接把 state 夹小并回写 `localStorage`

`resize` 时把 `chatW` / `previewW` 夹小并落盘。

优点：改动最小，无第二套值。

缺点：用户偏好被窗口尺寸单向腐蚀——缩小窗口再放大回不去原宽，且分屏/投屏一次就永久丢掉拖拽结果。否决。

### 方案 C：改用百分比 / `flex` 布局让浏览器自己避让

把两栏改成 `minmax()` 百分比列。

优点：无需 JS 监听。

缺点：与「像素宽 + 持久化 + 16:9 舞台比例反推上限」的既有模型冲突，`maxPreviewWidth` / `minPreviewWidth` / 一键全宽全部要重做，且百分比下无法表达「先压右栏、右栏到底再压左栏」的优先级。否决。

**推荐方案 A。**

## 消解规则（方案 A 的式子）

```
previewMin = minPreviewWidth(视口高)                      // 既有动态下限(账户条硬底 / 竖屏比例)
chatWanted = clamp(期望 Chat, CHAT_MIN, CHAT_MAX)
previewW   = clamp(期望预览, previewMin, maxPreviewWidth(视口宽, 视口高, chatWanted))
                                                          // maxPreviewWidth 内含 bySpace = 视口 − chatWanted − 2 ⇒ 先压右栏
chatW      = max(CHAT_MIN, min(chatWanted, 视口宽 − previewW − 2))
                                                          // 右栏已到下限仍不够 ⇒ 再压左栏
minPageW   = CHAT_MIN + previewMin + 2                    // 页面最小宽,窄于此进入横向滚动
```

三段行为（视口 900 高，`previewMin=330`，期望 Chat 518 / 预览 380）：

| 视口宽 | Chat | 预览 | 说明 |
|---|---|---|---|
| 1440 | 518 | 380 | 无碰撞，原样 |
| 800 | 468 | 330 | 预览先压到下限，Chat 再让出 50 |
| 600 | 360 | 330 | 双方到底，合计 692 > 600 → 页面横向滚动 |

## 滚动兜底的挂载点

外层结构改为「滚动容器 + 定宽内容行」，弹窗 / Toast / 加载层留在滚动容器**之外**，避免被 `overflow` 影响：

```
<div class="h-full">                                  ← 壳
  <div class="h-full overflow-x-auto overflow-y-hidden">   ← 横向滚动兜底
    <div class="relative flex h-full" style="min-width: minPageW">  ← 三栏内容行
  </div>
  ContextMenu / 各弹窗 / GenerateFormHost / Toast / LoadingScreen
</div>
```

预览 overlay 仍是内容行的 `absolute right-0`，随内容行滚动，不会再盖到 Chat 上。

## 验收标准

- 缩小窗口宽度：预览列先收窄，到下限后 Chat 列收窄，两栏永不重叠；
- 视口窄于「两边栏最小宽之和 + 2」：两栏停在各自下限，页面出现横向滚动条且可完整拉出两栏；
- 放大窗口：两栏恢复到用户拖拽/展开选择的宽度；
- 自动消解期间 `localStorage` 的 `workspace.chatWidth` / `workspace.previewWidth` 不被改写；
- 拖拽、一键全宽/恢复、Compare / Files 覆盖、新版本自动展开等既有行为回归通过。
