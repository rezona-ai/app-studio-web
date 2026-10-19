# 重纹理弹窗布局重设计

## 背景与目的

后端契约文档（pgc-server `docs/api/rig-retexture-frontend.md`）明确了重纹理接口的关键约束：

- `text_prompt` 与 `image_prompt_item_id` **互斥**，不能同传；
- `style_image_item_id` 可与任一提示**组合**使用；
- `texture` / `pbr` / `texture_quality` / `texture_alignment` 是一组材质参数；
- 三类输入（文字、参考图、纯材质开关）可单独或组合发起。

现有 `Derived3DForm` 重纹理分支的问题：

1. **互斥关系是隐式的**：填文字会静默清空已选图片提示、反之亦然（`onChange` 里互相 set 空）。用户不知情输入被清掉，事后发现只能重填。
2. **信息架构混乱**：双列参数区把「提示类」（Image prompt / Style image）与「材质类」（Texture / PBR / quality / align）混排，语义不同的字段视觉上同级并列，看不出 style image 与 image prompt 的角色差异。
3. **二值枚举用下拉**：quality / alignment 各只有两个值，却用 `Select` 弹层，多一次点击且遮挡表单。

## 方案

对比业界同类实现（Meshy / Tripo 的 retexture 面板均为「提示方式 tab + 材质参数组」结构）：

- **方案 A（推荐）：Segmented 显式切换提示方式 + 材质参数分组**
  - 「纹理提示」区顶部放 `Segmented`（文字 / 图片），互斥直接体现在 UI 结构上——同一时刻只显示一种输入；提交只携带当前模式的值，切换不清空另一侧草稿（回切可恢复）。
  - 图片模式不用下拉：画布已就绪 image 资产以**缩略图平铺网格**展示（复用 `RefPicker` 的 tile 语汇：方形圆角缩略图，选中转 teal 描边 + 角标；单选，再点取消），所见即所选。
  - 不提供「风格图片」入口：`style_image_item_id` 对非专业用户与 image prompt 难以区分，按 YAGNI 裁剪，契约上该字段可选、不传即不启用。
  - 「材质」独立分组：Texture / PBR 双列 Toggle；quality / alignment 改用 `Segmented`（二值枚举免下拉）。
- 方案 B：保留双列布局，仅给互斥字段加禁用态 + 说明文案。改动最小但没解决信息架构问题，字段禁用原因仍需用户读文案理解。弃。
- 方案 C：拆成向导式两步（提示 → 材质）。对一个 4~6 字段的表单过度设计，违反 YAGNI。弃。

## 布局（方案 A）

```
┌─ Retexture 3D model ───────────── ✕ ┐
│  <源资产名>                          │
│                                      │
│  Texture prompt                      │
│  [ Text ┃ Image ]      ← Segmented   │
│  ┌──────────────────────────────┐    │
│  │ textarea（文字模式）          │    │
│  │ / 缩略图平铺网格（图片模式）: │    │
│  │   [🖼][🖼][🖼][🖼]  单选可取消 │    │
│  └──────────────────────────────┘    │
│                                      │
│  Material                            │
│  [ Texture ✓ ]      [ PBR ✓ ]        │
│  Texture quality    Texture align    │
│  [Standard┃Detailed] [Image┃Geometry]│
│                                      │
│  Asset name                          │
│  [ input ]                           │
│                                      │
│  ( Cancel )        ( Generate )      │
└──────────────────────────────────────┘
```

- 全部复用既有令牌与基础组件：`Segmented` / `Select` / `Toggle`（组件内已有）/ `SECTION_LABEL` / `SUB_LABEL` / `DARK_FIELD`，无新色值、无新动效。
- rig3d 分支、头部、Asset name、底部按钮对、modal 壳不动。

## 提交语义

- 文字模式：`text_prompt`（trim 非空才带），不带 `image_prompt_item_id`。
- 图片模式：`image_prompt_item_id`（选了才带），不带 `text_prompt`。
- `style_image_item_id` 不提供 UI 入口，永不携带。
- 材质四参数照旧全带。空提示 + 纯材质开关是合法请求（契约允许），Generate 不因提示为空而禁用。

## 成功标准

- 任何操作路径下请求体不可能同时含 `text_prompt` 与 `image_prompt_item_id`（测试断言）。
- 切换提示方式不丢另一侧已填草稿。
- `pnpm exec tsc --noEmit`、`pnpm test` 通过；新增文案覆盖 11 套 locale。
