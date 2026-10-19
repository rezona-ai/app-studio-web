# 资产引用 chip + 用户消息布局 设计

## 背景

两张 Figma 设计稿要求统一对话内的资产引用样式,并重做用户消息布局:

- **133-2007 `Prompt Input`**:组合输入框,顶部带资产引用 chip(`Layer item`),底部为 `+` / `@` / 发送 三个动作按钮。
- **41-654 用户消息**:灰底气泡,顶部一枚资产引用 chip,下方为消息正文。

现状关键事实:

1. `AssetChip.tsx` 已存在但是**孤儿组件**(无任何引用)。
2. 用户消息的资产引用当前以 `@key` 字面量**折进文本**显示(`Composer.send()` 里 `refs.map(r => '@'+r)`),`MessageItem` 直接把整段文本丢给 `RichText`。
3. `AttachmentBar` 用**内联**样式画 chip,与 `AssetChip` 重复且更小。
4. 组合框容器(`--shadow-prompt`、`rounded-24`、`bordered` 按钮)、发送按钮**默认态**(`.btn-raised` / `--shadow-btn` / `--grad-btn`)已与设计稿一致。

## 目标

1. 抽出**单一来源**的资产引用 chip,对齐设计稿尺寸,对话内与组合框共用。
2. 用户消息:把已知 `@key` 提到气泡顶部渲染为 chip,正文在下方。
3. 组合框整体对齐设计稿:chip 移入卡片内部;发送按钮新增 active 深色态。

## 设计

### 1. 共享资产引用 chip(`AssetChip.tsx` 重写)

导出两个组件:

- `Chip`(展示型基座,无 store 依赖):
  - 外形:`bg-surface(#fcfcfc)` + `border-line-2(#e2e2e2)` + `rounded-[12px]`,`h-10`、`pl-1 pr-3 py-1`、`gap-2`、`w-fit max-w-full`
  - 图标贴片:`size-8(32px)` `rounded-[8px]` `bg-fill(#f1f1f1)` `overflow-hidden`,内容由 `icon` 插槽决定
  - 标签:Inter Medium `text-[12px]` `leading-16` `tracking-[-0.12px]` ink,`truncate`
  - `onRemove?`:存在时渲染 `×` 按钮,默认 `hidden`,`group-hover` 浮现(`group` 加在 chip 上),`aria-label="移除引用"`
- 默认导出 `AssetChip`(资产感知):按 `assetKey` 查 store,`asset.preview.src ?? asset.preview.dataUrl` 存在时贴片内 `object-cover` 显示缩略图,否则回退 `KIND_META[kind].icon`(16px);label 用 `asset.label ?? assetKey`;透传 `onRemove`。

> 圆角统一为 `12px`(41-654 标 10px,与 133-2007 的 12px 取一致)。

### 2. 文本引用提取(`src/lib/refs.ts` 新增)

```ts
// 从用户消息文本提取已知资产引用 @key:返回命中 keys(去重、保序)与剥离引用后的纯文本
export function extractRefs(text: string, knownKeys: Set<string>): { keys: string[]; text: string }
```

- 用 `/@(\S+)/g` 匹配 `@token`;`token ∈ knownKeys` 才算命中并从正文剔除,否则原样保留(避免误伤邮箱等)。
- keys 去重保序;剥离后多余空白折叠并 `trim`。

### 3. 用户消息布局(`MessageItem.tsx` 用户分支)

- 外层 `mb-5 pl-6`(24px 左缩进)。
- 气泡:`w-full bg-fill(#f1f1f1) rounded-[12px] p-3 flex flex-col gap-1`。
- 由 `extractRefs(rawText, knownKeys)` 得 `{ keys, text }`:
  - `keys.length > 0` → 顶部 `flex flex-wrap gap-1` 一排 `AssetChip`(无 `onRemove`)。
  - `text` 非空 → 下方 `RichText`(沿用 `15px/leading-24/tracking-[-0.3px]`)。
- `knownKeys` 来源:`useStore(s => s.assets)` 派生的 key 集合(`useMemo`),资产后到时 `@key` 可由文本自动转为 chip。
- 助手分支不变。

### 4. 组合框对齐(`Composer.tsx` + 样式)

- `<AttachmentBar />` 从卡片外移入卡片内部、置于 `textarea` 之上。
- `AttachmentBar.tsx`:改用共享组件——资产引用用 `AssetChip`(带 `onRemove={() => removeRef(r)}`);文件附件用 `Chip`(`doc` 类型图标 + `onRemove`);容器改为 `flex flex-wrap gap-1`(去掉原 `px-3 pt-2`,padding 交给卡片)。
- 发送按钮 active 深色态:
  - 新增 `.btn-raised-active`(globals.css):`linear-gradient(to bottom,#323232,#222)` + `box-shadow: 0 2px 4px -1px rgba(13,13,13,.5), 0 0 0 1px #333, inset 0 .5px 1px 0 rgba(255,255,255,.15), inset 0 -1px 1.2px .35px #121212`;`color:#fff`;hover `brightness(1.08)`。
  - `IconButton` 增加 `raised-active` variant → `btn-raised-active`。
  - Composer:`canSend = draft.trim() || attachments.length || refs.length`。`canSend`(或运行中的 Stop)用 `raised-active` + `size-10 rounded-[10px]`;空闲态用现有 `raised` + `size-10 rounded-[12px]`。箭头/Stop 图标在深色态为白色。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/components/chat/AssetChip.tsx` | 重写为 `Chip` + `AssetChip` |
| `src/lib/refs.ts` | 新增 `extractRefs` |
| `src/components/chat/MessageItem.tsx` | 用户分支:chip + 正文 + 缩进气泡 |
| `src/components/chat/AttachmentBar.tsx` | 改用共享 chip,容器去外边距 |
| `src/components/chat/Composer.tsx` | AttachmentBar 移入卡片;发送按钮 active 态 |
| `src/components/ui/IconButton.tsx` | 新增 `raised-active` variant |
| `src/app/globals.css` | 新增 `.btn-raised-active` |

## 测试(TDD)

- `src/lib/refs.test.ts`:`extractRefs` —— 命中已知 key、未知 token 原样保留、去重保序、空白折叠、无引用。
- `src/components/chat/AssetChip.test.tsx`(新):有 preview 显示 `<img>`、无 preview 显示类型图标、`onRemove` 渲染移除按钮并触发回调。
- `src/components/chat/MessageItem.test.tsx`:用户消息把已知 `@key` 渲染为 chip 且正文去掉 `@key`;未知 `@token` 留在正文。
- `src/components/chat/AttachmentBar.test.tsx`(新或补):引用 chip 显示资产名并可移除;文件附件 chip 可移除。

## 非目标(YAGNI)

- 不引入新的资产数据模型(引用仍走 wire 文本 `@key`)。
- 不改助手消息、不改 `+`/`@` 按钮与卡片容器既有样式。
- 不处理 chip 拖拽/排序、不做引用编辑。
