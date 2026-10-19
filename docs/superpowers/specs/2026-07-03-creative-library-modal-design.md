# 素材库弹窗(Creative Library)设计稿

日期:2026-07-03
Figma:`TALUNA DEVELOPER SITE` node `955:47107`

## 目标

恢复画布左上角资产库按钮(撤销 `4cf9b41` 的隐藏),点击打开「Creative Library」弹窗,浏览运营预置的全局素材库并一键 Use 导入当前项目画布。视觉**像素级还原设计稿**(经 Nick 确认):弹窗恒深色、青色 #1fd4cf 强调,不随浅/深主题翻转。

## 后端契约(apifox 8405123,已核实)

- `GET /api/library/assets`(经现有 `/api/pgc/[...path]` 代理):query `type`(bgm/sfx/image/video/meme/audio)/`q`(名称/描述子串)/`sort`(curated 默认/popular/recent)/`limit`(≤200)/`offset`。
- 成功信封 `{ success, code, message, data: { items, total } }`;item 为 `LibraryAssetData`:`id/key/type/media_kind/name/url/thumbnail_url/content_type/size_bytes/duration_seconds/tags/usage/use_count`。素材全局共享、无 per-user 归属。
- Use 复用既有导入通路:`pgcApi.writeCanvasItemFromUrl(pid, { source_url: url, type, name, canvas_x, canvas_y, reference })` → `/canvas/items/import`,后端 server-side 拉字节落库。

## 组件与数据流

### 入口按钮(改 `AssetLibraryButton.tsx`)

- `AssetCanvas` 恢复渲染该按钮(还原 `4cf9b41` 删掉的两行)。
- 移除「即将推出」Tooltip 与 no-op;点击调 store action `setLibraryOpen(true)`;Tooltip 文案改为 `canvas.assetLibrary`。

### store(UIState)

- 新增 `libraryOpen: boolean` + action `setLibraryOpen`,不持久化。按项目惯例:弹窗打开态进 store,列表数据是弹窗**局部态**(全局素材、非项目态,组件内 useState,不进 persist)。

### PGC client(`src/lib/pgc/client.ts` + `types.ts`)

- 新增类型 `LibraryAssetData` / `LibraryAssetListData`(snake_case,严格按契约,不加臆测别名)。
- 新增 `listLibraryAssets(params: { type?: string; q?: string; sort?: string; limit?: number; offset?: number })` → `GET /api/library/assets`,`sort` 调用侧固定传 `curated`。

### 弹窗 `CreativeLibraryModal.tsx`(新,`src/components/canvas/`)

挂在 `Workspace` 层(与其他 modal 同级),`libraryOpen` 时渲染;进出场复用 `.modal-pop` + `.modal-backdrop` + `useRequestClose`,Esc/遮罩点击可关。

数据行为:
- 打开时请求第一页(`limit=40, offset=0, sort=curated`);tab / 搜索变化即重置 offset 重新请求;滚动到底部且 `items.length < total` 时追加下一页。
- 搜索防抖 300ms 传 `q`。请求失败走 `setError` Toast;竞态用「最后一次请求胜出」的序号 guard 丢弃过期响应。
- 加载态:骨架卡(复用微光样式,尺寸与真实卡一致:220px 宽 + 195.75px 缩略图块 + 两行文字条)。首屏加载渲染两行(8 张)骨架卡(弹窗可视区约两行,整页 40 张无意义);**滚动加载下一页时在已有卡片后追加一行(4 张)骨架卡作为过渡**,数据到达后原位替换,失败则移除骨架。空态:居中灰字提示。

Use 行为:
- 点击 Use:视口中心 `avoidOverlap` 落位(与 `importGeneratedAsset` 同法),调 `writeCanvasItemFromUrl`,`type` 由 `media_kind` 映射(image/video/audio/model3d;bgm/sfx/meme 按其 media_kind 归口),`name` 用素材 `name ?? key`,`reference: { library_key: key }` 溯源。
- 进行中该卡按钮转 loading 防重复点击;成功后新卡并入 `assets`(不关弹窗),失败 Toast。同一素材允许多次导入(每次新卡),不做去重。

### 视觉(像素级,专属令牌)

设计稿颜色/阴影集中新增为 `globals.css` 的 `--lib-*` 令牌组(恒定值,不进 `[data-theme]` 分支),组件内不写字面色值:

- 弹窗容器:`rounded-[28px]`,底 `#f1f1f1`→实际深色浮层按截图为 `#2a2a2a` 系(以 Figma 变量 fallback 与截图核准),边框 `#1e1e1e`,Depth/Popover 五层阴影 + `backdrop-blur-[6px]`,内边距 `px-24 py-16`,标题区与内容 gap 9px。
- 头部:`Creative Library` Inter SemiBold 18/28 白;右侧 16px 关闭 X(FigIcon 新登记或复用既有 close 图标,恒白色调)。
- 工具行:左 tab 胶囊流(gap 8、可横向滚动):13px 字、`rounded-[8px]`、`px-[13px] py-[7px]`、边框 `rgba(255,255,255,0.12)`;选中态字 `#f7f7f7` 底 `rgba(255,255,255,0.1)`,未选字 `#a8a8a8` 无底。tab = All + 后端 type(Image/Video/Audio/BGM/SFX/Meme,i18n)。右侧固定 280px 搜索框:40px 高 `rounded-full`,底 `#171717` 边框 `#404040`,placeholder 14px `#737373`,右端 14px 放大镜图标。
- 网格:`grid-cols-4` gap 16,卡宽 220px。卡片:缩略图 195.75px 高 `rounded-[12px]` 底 `#171717` `object-cover`;下方(gap 12,pb 12)名称 14/22 `#f7f7f7` 截断 + 副标题 12/18 `#a8a8a8`(显示类型文案;设计稿的头像+项目名不适用素材数据,省略头像)。hover:缩略图 3px `#1fd4cf` 描边 + `rgba(0,0,0,0.65)` 遮罩 + 底部居中青色胶囊 Use 按钮(30px 高 `rounded-full` 底 `#1fd4cf`,字 Inter Bold 13 白)。
- 非图像素材缩略图:`thumbnail_url` 缺失时用 `#171717` 底 + 居中类型 FigIcon 占位。
- 弹窗尺寸:宽约 990px(4×220+3×16+2×24)居中,最大高 `85vh`,网格区 `overflow-y-auto .scrollbar-auto`。
- reduced-motion:仅复用既有动效类,无新增 keyframes,无需扩充禁用列表。
- z-index:遮罩/弹窗沿用 Modal 层(`z-40`)。

### i18n

`library.*` 文案六语(en 真相源):标题、tab 名、搜索 placeholder、Use、空态、导入成功/失败。`canvas.assetLibrarySoon` 删除。

## 错误处理

- 列表请求失败:`setError` Toast,保留已有列表;可重试(切 tab/搜索即重发)。
- Use 失败:Toast,按钮恢复可点。
- `await` 后校验 `currentProjectId` 未变(项目切换丢弃导入结果——writeCanvasItemFromUrl 后并卡前校验)。

## 测试

- `client.test.ts`:`listLibraryAssets` 的 URL/query 拼装与信封解析。
- `CreativeLibraryModal.test.tsx`:打开请求首屏、tab 切换传 type、搜索防抖传 q、Use 调 `writeCanvasItemFromUrl` 并并入 assets、失败 Toast。
- `AssetLibraryButton.test.tsx`:点击触发 `setLibraryOpen(true)`,不再是 no-op。

## 非目标

- 不做素材收藏/上传/管理;不做 popular/recent 排序切换 UI;不改后端。
