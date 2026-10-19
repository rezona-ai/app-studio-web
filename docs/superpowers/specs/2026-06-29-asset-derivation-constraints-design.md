# 资产派生约束（设计稿）

> 2026-06-29 · 画布资产卡片「+号」派生功能的可派生类型约束

## 背景

画布上每张资产卡片选中后，右侧会浮出一个「+号」按钮（`NodeCard.tsx`，`aria-label=canvas.generateFrom`「从此资产生成」）。点击它打开 `AddAssetMenu`，从中选一种生成类型即打开 `GenerateForm`，把当前资产作为「源」派生出一个新资产。

**现状问题**：`AddAssetMenu` 对任何源资产都列出全部 4 种生成类型（image/video/audio/3d），且 store action 无脑把源资产 id 注入 `source_item_id`。但后端各生成接口对「源/参考」输入有严格的类型要求，导致大量组合注定 422：

- 视频源 → 视频：源视频被塞进「首帧」（`source_item_id`，后端要求必须是图片）→ 422。
- 音频/3D/文档源 → 任何类型：同样把非图片源塞进 `source_item_id` → 422。
- 唯一现在正确的只有「图片源」的那几种。

## 约束依据（apifox PGC 文档）

读了 4 个生成接口的 OAS 定义，关键在于**每个接口接受什么资产作为「源/参考」输入**：

| 生成接口 | 源/参考入参 | 输入类型要求 |
|---|---|---|
| Generate Image | `source_item_id` / `source_item_ids`（≤8） | 图生图参考图 → **仅图片** |
| Generate Video | `source_item_id`（首帧）、`last_frame_item_id`（尾帧）、`ref_image_item_ids`（≤9） | 这几项 → **仅图片**；`ref_video_item_ids`（≤3） → **仅视频** |
| Generate Model3D | `source_item_id`（图生3D） | → **仅图片** |
| Generate Audio | **无任何源/参考入参** | 纯文本 TTS/音效，**不吃任何资产** |

**关键结论**：`source_item_id` 在三个接口里语义统一 = **必须是图片**；视频只能经 `ref_video_item_ids` 喂给视频生成；音频/3D 模型/文档**不被任何接口接受为输入**。

## 可派生矩阵

「严格派生」语义：`+号` = 从此资产派生，仅当源资产能作为输入喂给目标接口时才提供该选项。

| 源资产 | → 图片 | → 视频 | → 音频 | → 3D |
|---|:---:|:---:|:---:|:---:|
| **图片** | ✅ 图生图 | ✅ 首帧/参考图 | ❌ | ✅ 图生3D |
| **视频** | ❌ | ✅ 参考视频 | ❌ | ❌ |
| **音频** | ❌ | ❌ | ❌ | ❌ |
| **3D** | ❌ | ❌ | ❌ | ❌ |
| **文档** | ❌ | ❌ | ❌ | ❌ |

- 音频不消费任何输入 → 任何源都不提供「派生音频」（包括图片源）。
- 音频 / 3D / 文档源不被任何接口接受为输入 → 派生选项为空。

## 实现设计

### 1. 纯函数 `derivableKinds`（唯一真相源）

在 `src/components/canvas/gen-params.ts`（已是生成约束的归属地：`REF_LIMITS` / `GEN_FIELDS`）新增：

```ts
// 按源资产类型可派生的目标生成类型（严格派生：仅当源能作为输入喂给目标接口）。
// 依据 apifox：source_item_id 三处语义统一=图片；视频仅经 ref_video_item_ids；
// 音频/3D/文档不被任何接口接受为输入。
const DERIVE_MATRIX: Record<AssetKind, GenKind[]> = {
  image: ['image', 'video', '3d'],
  video: ['video'],
  audio: [],
  '3d': [],
  doc: [],
};
export const derivableKinds = (source: AssetKind): GenKind[] => DERIVE_MATRIX[source];
```

菜单与卡片都从这个函数取，避免两处各写一份。

### 2. `NodeCard`：无可派生项就不浮出 +号

`NodeCard.tsx` 里 `selected && (...+按钮...)` 的条件加上 `derivableKinds(kind).length > 0`。
→ 音频 / 3D / 文档卡片选中时不再出现 +号（隐藏，而非禁用）。

### 3. `AddAssetMenu`：派生模式按源类型过滤

- 有 `sourceId`（从卡片 +号进来 = 派生）：查源资产 `kind`，把 `ITEMS` 过滤成 `derivableKinds(sourceKind)`。
- 无 `sourceId`（双击空白画布 = 新建）：维持现状（全部 4 种 + 上传组），不受约束。

源资产 kind 从 store `assets` 按 `sourceId` 查得。

### 4. `GenerateForm`：按源类型把源喂到正确的字段（真正修 bug 处）

核心事实：`source_item_id` 恒为图片。故在表单里：

```ts
const sourceKind = source?.kind;
const primarySourceId = sourceKind === 'image' ? sourceId : undefined; // 仅图片源走 source_item_id
```

- **图片源 → 图片 / 视频 / 3D**：`primarySourceId = sourceId`，行为完全不变（图生图 / 首帧 / 图生3D）。
- **视频源 → 视频**：`primarySourceId = undefined`，转而把源视频**预选进 `refIds`**（omni 参考模式）。它作为可移除的参考 chip 展示，`buildGenBody` 自动归入 `ref_video_item_ids`。

把表单内现在用 `sourceId` 表达「源 = source_item_id」语义的地方统一换成 `primarySourceId`：
`refSel.sourceId`、`placement.sourceItemId`、`canMultiRef`、`RefPicker exclude`、只读源 chip（`{source && <RefChip/>}` → 仅图片源显示）、视频尾帧 `extra`。

预选源进 refIds：

```ts
const [refIds, setRefIds] = useState<string[]>(
  () => (sourceId && sourceKind && sourceKind !== 'image') ? [sourceId] : [],
);
```

**`buildGenBody` 和 store actions 一行都不用改**——只是表单把源路由到对的入参。

### 5. 错误处理

矩阵从构造上消除了注定 422 的组合。后端仍是最终裁判：残余 `PgcError`（如内容审核拒绝、上游失败）照走 `guard → Toast`，不新增错误路径。

## 测试（TDD，同目录）

- `gen-params.test.ts`：测 `derivableKinds` 全 5 种源类型返回正确矩阵。
- `AddAssetMenu.test.tsx`：派生模式（有 sourceId）按源 kind 过滤选项（图片源 3 项、视频源 1 项）；无源模式保持 4 种 + 上传组。
- `GenerateForm.test.tsx`：视频源→视频提交后 body 含 `ref_video_item_ids`（含源 id）、且 **无** `source_item_id`；图片源→图片保持 `placement.sourceItemId` 原样。

## 不做（YAGNI）

- 不改 store action 注入逻辑、不改 `buildGenBody`、不动后端契约。
- 不加 doc 类型生成（后端无此能力）。
- 不为图片源扩展「源作 ref_image 而非首帧」之类的新交互（保持现有图片源 UX）。
