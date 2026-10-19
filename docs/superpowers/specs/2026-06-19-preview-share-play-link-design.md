# 预览面板分享按钮 + 游玩链接弹窗设计稿

设计稿来源：Figma `Taluna_game` node 23-190（下载 ZIP 左侧的「Icon Button (Large Icon)」，内嵌 share arrow 图标）。

## 一、背景与目标

预览面板（`PreviewPanel`）的 Live preview 状态栏当前只有「下载 ZIP」「刷新」两个图标按钮。需在**下载按钮左侧**新增一个**分享按钮**：点击弹出一个小型模态，展示**当前选中版本**游戏的公开游玩直链，并提供一键复制能力，方便把某个具体版本分享给他人试玩。

链接形如 `/game/pgcserver/pv/{code}/{version}/{path}`（PGC 公开页字节直出端点 `Serve Preview By Code`）。

## 二、关键决策：链接语义 = 锁定当前选中版本

后端存在两条可用路径，本设计**明确选用前者**：

| 方案 | 形态 | 语义 | 取舍 |
|---|---|---|---|
| **（采用）`/pv` 版本直链** | `…/pv/{code}/v{seq}/{path}` | **锁定**选中版本 | 符合「分享当前选中版本」需求；前端拼接，无对应「按版本取公开链接」接口，需前端推断格式 |
| （不采用）`Share Link` 接口 | `GET /api/projects/{id}/share` → `play_url`（`/play/{code}`） | 始终玩最新已 build 版（版本解耦） | 后端钦定的分享按钮路径、最稳健，但**不锁版本**，不满足需求 |

> 经与需求方确认，本期取「锁定当前选中版本」语义，故采用 `/pv` 版本直链方案。

## 三、链接构造

### 3.1 三段含义（已核实）

- `{code}` = 项目 `public_id`。**依据**：`2026-06-17-project-public-id-design.md` 明确「`public_id`（Sqids 纯字母如 `DakkYXUy`）用于正式域名 URL、分享/预览链」；且 `src/components/landing/games.ts` 线上游戏直链即 `…/pv/DakkYXUy/v5/dist/index.html`。
- `{version}` = `v{seq}`。前端 `Version.index` 即后端 `VersionData.seq`（见 `pgc/map.ts`），故 `v${active.index}`。
- `{path}` = 入口路径，默认 `dist/index.html`。**依据**：landing 三款线上游戏入口路径均为 `dist/index.html`。

### 3.2 纯函数（`src/lib/pgc/url.ts`）

新增可单测纯函数：

```ts
// 构造公开游玩直链 /game/pgcserver/pv/{code}/{version}/{path}
// 读 NEXT_PUBLIC_PGC_BASE_URL + PGC_PREFIX(同 resolveAssetUrl);缺料返回 null
export function buildPlayUrl(
  publicId: string | null | undefined,
  versionSeq: number | null | undefined,
  entryPath = 'dist/index.html',
): string | null
```

- 返回 `${base}${PGC_PREFIX}/pv/${publicId}/v${versionSeq}/${entryPath}`。
- `base` 缺失、`publicId` 空、`versionSeq` 非有限数 → 返回 `null`（按钮据此 disabled）。
- 与 `resolveAssetUrl` 共用 `NEXT_PUBLIC_PGC_BASE_URL` 读取方式（函数内读 env 便于测试 stub）。

### 3.3 原料来源（`PreviewPanel` 内取，传给纯函数）

- `publicId`：`projects.find((p) => p.id === currentProjectId)?.public_id`。
- `versionSeq`：选中版本 `selectActiveVersion(versions, activeVersionId)?.index`。

### 3.4 待运行时验证项

入口路径恒为 `dist/index.html` 属前端推断后端契约（虽有 landing 线上佐证）。落码后用真实项目打开拼出的链接验证可玩。**若入口路径会因项目而异**，降级方案：取该版本 `preview_url`（`previewVersionById`，即 in-app 预览所用、含真实 `v{seq}/{path}` 尾段），从中提取 `v{seq}` 起的尾段、仅把前缀换成 `/pv/{code}/`。本期先用默认入口，保留此降级路径。

## 四、UI 组件

### 4.1 分享按钮（`PreviewPanel.tsx`）

- **位置**：Live preview 状态栏，下载 ZIP 按钮**左侧**。
- **样式**：完全复用下载/刷新按钮 —— `IconButton variant="bordered"` + `rounded-[12px] bg-[var(--color-surface-2)] p-2`，内嵌 `<FigIcon src={figAsset.share} size={20} />`。`figAsset.share` 已注册（`public/figma/icons/share.svg` 与 node 23-190 同款），**无需新增资源**。
- **包裹**：`Tooltip`（`aria-label="Share"`）。
- **可见**：与下载一致，仅 `!compareOn` 时显示（对比态无单一选中版本）。
- **禁用**：`disabled={!hasGame || !shareUrl}`（无版本或链接构造失败）。

### 4.2 分享弹窗（新组件 `src/components/preview/SharePopover.tsx`）

采用**小型模态**，复用 `CreateGameModal` 范式：

- 容器：`modal-backdrop`（`z-40`、点遮罩关闭、`data-closing`）+ `modal-pop`（`rounded-[24px]` + `border-[var(--color-line)]` + `bg-[var(--color-surface)]` + `shadow-[var(--shadow-prompt)]` + `backdrop-blur-[6px]`）。
- 进出场 / 关闭：`useRequestClose(onClose, 200)`；监听 `Escape` 关闭。
- 内容：
  - 标题 `Share game`。
  - 只读 `input` 展示完整 URL，`autoFocus` + 聚焦自动全选（便于手动复制），样式沿用 `CreateGameModal` 的输入框 token。
  - **Copy 主按钮**：`navigator.clipboard.writeText(url)`；成功后按钮文案/图标短暂变 `Copied ✓`，约 2s 复位（就地反馈，不打扰全局 Toast）。复制失败兜底走全局 Toast（`setError({ kind: 'notice' })`）。

### 4.3 状态管理

- 弹窗开关用 `PreviewPanel` 内 `useState`（纯局部 UI，与现有 `downloading`/`refreshNonce` 同级；**非跨组件**，无需进 store）。

## 五、明确不做（out of scope）

- 不接入 `Share Link` 接口、不展示 remix 链。
- 不做始终最新版（版本解耦）链接。
- 不做二维码 / 社交平台分享 / 原生 share sheet。
- 对比模式下不提供分享（无单一选中版本）。

## 六、测试策略

- `src/lib/pgc/url.test.ts` 追加 `buildPlayUrl` 用例：正常拼接、缺 base/publicId/seq 返回 null、自定义 entryPath、base 末尾斜杠归一。
- `SharePopover` 组件测试（可选）：展示传入 URL、点击 Copy 调 `navigator.clipboard.writeText` 并显示 `Copied`。
- `PreviewPanel.test.tsx`：分享按钮渲染在下载按钮左侧；无版本时 disabled；`compareOn` 时不渲染。

## 七、涉及文件

| 文件 | 改动 |
|---|---|
| `src/lib/pgc/url.ts`（+ `url.test.ts`） | 新增 `buildPlayUrl` 纯函数 + 单测 |
| `src/components/preview/SharePopover.tsx` | 新建分享弹窗 |
| `src/components/preview/PreviewPanel.tsx` | 加分享按钮 / 计算 `shareUrl` / 渲染弹窗 |
| `public/figma/icons/762f833b2b7abb39b41419883a7c27b96c91cd0c.svg` | 删除（`figAsset.share` 已有同款） |
