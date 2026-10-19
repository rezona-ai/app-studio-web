# Text 类型画布卡片 设计稿

日期：2026-07-03
状态：已与 Nick 对齐通过

## 背景与目标

画布现有资产类型 `image / video / audio / 3d / doc` 中，doc 是半成品占位：后端画布 item 无 doc 类型、无法上传/生成，`DocNode` 正文是假骨架线。本次新增真正可用的 **text 类型卡片**，并**删除 doc**。

Text 卡片的三个用途：

1. **用户手动创建的文本便签**——在画布上记灵感/设定；
2. **agent 产出的文档**——对话中生成的策划案/设定文档（md/txt）自动导入画布；
3. **生成参考输入**——text 卡可作为派生生成的 prompt 参考素材。

交互形态：卡片展示 **Markdown 渲染摘要**，点击打开**弹窗**查看全文/编辑。

## 后端契约（推动 PGC；已查 apifox 8405123 确认现状）

现状：import 请求的 `type` 枚举为 `image | video | audio | model3d`，`CanvasItemData` 无文本内容字段。

向后端提的契约（前端按此先行，可 mock 联调）：

- `type` 枚举新增 `'text'`：import 请求、upload MIME 白名单放行 `text/markdown` / `text/plain`。
- **内容存桶为 `.md` 文件，经 `url` 取回**——`CanvasItemData` 结构零新增字段，复用现有 upload / import / download 通道。
- **能力缺口：替换已有 item 的文件内容**（编辑保存用）。建议 `PATCH /canvas/items/{item_id}` 支持带新 `source_url`，或 upload 端点支持 `item_id` 覆盖写。
  - **后端落地前的降级方案**：编辑保存 = 上传新文件 → 新 item 原位替换旧 item（继承 position/parentId）→ 删旧 item，纯用现有端点跑通。

## 前端设计

### 1. 类型体系：text 取代 doc

- `AssetKind` = `'image' | 'video' | 'audio' | '3d' | 'text'`；删除 `DocNode.tsx`、`KIND_META/KIND_LABEL/LEGEND_KINDS` 的 doc 分支。
- `kindFromMime`：文本类 MIME（`text/*`）归 text；其余未知 MIME 拒绝并 Toast（不再兜底归 doc）。
- 类型色 `--color-doc`（#f2c64b）改名 `--color-text`，色值沿用。
- text 进入 `visibleKinds` 过滤图例，成为正常可过滤类型（移除 doc 的"恒可见"特例）。
- `pgc/map.ts` 的 `TYPE_TO_KIND` 加 `text → 'text'`；未知 type 兜底回退 image 不变。

### 2. TextNode 卡片

- 新 `src/components/canvas/nodes/TextNode.tsx`，复用 `NodeCard` 外壳，`withNodeBoundary` 注册进 `nodeTypes`。
- 正文：fetch `url`（经 `apiPath()` 同源代理）拿 markdown 原文，渲染摘要区——限高 + 底部渐隐遮罩。
- md 渲染用 `react-markdown`，只开基础语法、**禁 raw HTML**（防注入）。
- `AssetPreviewData` 新增 `text?: string` 字段：存截断的前 N 字符供摘要即时渲染，全文按需 fetch。
- 加载态骨架微光占位，失败态可重试。

### 3. 弹窗查看/编辑

- 点击卡片打开弹窗（`.modal-pop` + `.modal-backdrop`，`useRequestClose` 退场）。
- 默认展示渲染态全文；点「编辑」切 textarea 源码编辑；保存走上文替换流程，保存中弹窗内 loading，失败走全局 Toast（`setError`）。

### 4. 创建入口与生成参考

- **手动创建**：`AddAssetMenu` 新增 Text 项（不走 GenerateForm）。点击在画布落一张空 text 卡并直接打开编辑弹窗；**首次保存时才上传落库**，避免产生空文件；未保存关闭则移除空卡。
- **agent 自动导入**：`media-import.ts` 事件解析放行 md/txt 产物，经 `/canvas/items/import`（type='text'）落库。依赖后端契约就位。
- **生成参考**：text 卡进入 `derivableKinds` / reference 体系，派生生成时文本内容作为 prompt 参考注入（注入细节在实现计划展开）。

### 5. 测试

- 纯逻辑单测：`asset-kind` 变更、`map.ts` 新映射、摘要截断、编辑保存"新替旧" action（mock PGC client）。
- 组件测：TextNode 三态（loading / 内容 / 失败）、弹窗编辑保存流。

## 风险与取舍

- **doc 删除是破坏面**：`kindFromMime` 兜底行为变更（未知归 doc → 文本归 text、其余拒绝）需过一遍所有调用点。
- **依赖后端排期**：agent 自动导入与正式编辑保存都依赖后端 `type='text'` 落地；手动创建/展示/降级编辑可先用现有端点 + mock 验证。
- **react-markdown 是新依赖**：轻量、只开基础语法；不引入代码高亮等重型插件。
