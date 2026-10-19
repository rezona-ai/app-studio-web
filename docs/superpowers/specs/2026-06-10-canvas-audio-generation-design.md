# 设计文档：资产菜单支持生成音频 + 移除 Regenerate

- 日期：2026-06-10
- 设计稿：Figma node 219-3592（"Generate assets" 菜单：Text / Image / Video / Audio / 3D World）
- 接口：Apifox `POST /api/projects/{project_id}/canvas/items/generate/audio`

## 一、背景与目标

画布双击空白处会弹出 "Generate assets" 菜单，目前支持生成 Image / Video / 3D World。本次按设计稿在菜单中新增 **Audio** 项：点击后弹出生成表单（仅 prompt 文本），调用同步 TTS 接口生成音频并落到画布。

同时，按产品决定 **彻底移除右键菜单的 Regenerate 功能**，并清理其连带死代码。

展示层已就位（无需改动）：`AssetKind` 已含 `'audio'`、`KIND_META.audio`、`AudioNode` 卡片、`nodeTypes.audio` 注册、上传 `accept` 已含 `audio/*`、`ZONE_ORDER` 已含 audio。缺的只有"生成"这条链路。

## 二、接口约定

`POST /api/projects/{project_id}/canvas/items/generate/audio`（同步，Noiz text-to-speech）

请求体 `CanvasGenAudioRequest`：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string (1–5000) | 是 | 要合成的文本 |
| `voice_id` | string \| null (≤128) | 否 | 音色；不传用服务端默认 |
| `output_format` | `'mp3'` \| `'wav'` | 否 | 默认 `mp3` |

响应 `APIResponse<CanvasItemData>`：**返回单条** `CanvasItemData`（注意与 image 的 `CanvasItemListData` 列表不同）。同步返回，无需轮询（区别于 video / model3d 的异步任务）。

后端对音频返回的 `type` 字段为 `"audio"`。

## 三、改动清单

### Part A — 新增 audio 生成链路

1. **`src/lib/pgc/types.ts`**
   - 新增 `export interface CanvasGenAudioRequest { prompt: string; voice_id?: string | null; output_format?: 'mp3' | 'wav'; }`
   - `CanvasItemData.type` 行注释补充 `audio`（`// image | video | audio | model3d`）

2. **`src/lib/pgc/client.ts`**
   - `pgcApi` 新增：
     ```ts
     genAudio: (pid: number, body: CanvasGenAudioRequest) =>
       pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/generate/audio`, body),
     ```
   - 顶部 import 增加 `CanvasGenAudioRequest`（`CanvasItemData` 已在导入列表）

3. **`src/lib/pgc/map.ts`**（修隐藏 bug）
   - `TYPE_TO_KIND` 补 `audio: 'audio'`。否则后端返回 `type:'audio'` 会经 `?? 'image'` 兜底误判为 image，音频卡渲染错误。

4. **`src/store/actions.ts`**
   - 新增（紧邻 `generateImage`）：
     ```ts
     const generateAudio = async (req: CanvasGenAudioRequest) => guard(set, async () => {
       const pid = get().currentProjectId; if (pid == null) return;
       const item = await pgcApi.genAudio(pid, req);          // 单条
       set({ assets: [...get().assets, canvasItemToAsset(item)] });
     });
     ```
   - import 增加 `CanvasGenAudioRequest`
   - return 对象与 `ServerActions` 导出 `generateAudio`

5. **`src/store/index.ts`**
   - `GenFormState.kind` 由 `'image' | 'video' | '3d'` 改为 `'image' | 'video' | 'audio' | '3d'`

6. **`src/components/canvas/AddAssetMenu.tsx`**
   - `GenKind` 加 `'audio'`：`Extract<AssetKind, 'image' | 'video' | 'audio' | '3d'>`
   - `ITEMS` 在 Video 与 3D World 之间插入 `{ kind: 'audio', label: 'Audio', icon: figAsset.audio }`（顺序对齐设计稿）

7. **`src/components/canvas/GenerateForm.tsx`**
   - `kind` 类型加 `'audio'`
   - `submit` 增加 `else if (kind === 'audio') await generateAudio({ prompt });`，并从 store 取 `generateAudio`
   - `noun` 映射补 audio → `'audio'`
   - `placeholder`：audio 用 `"Enter the text to speak…"`，其余沿用 `"Describe what you want to generate…"`

### Part B — 移除 Regenerate（含死代码清理）

8. **`src/components/canvas/ContextMenu.tsx`**
   - 删除 `items` 中的 Regenerate 项
   - 连带删除：`derive` 函数、`client` prop、`openGenForm`，以及 `RefObject`、`KoubouClient` 导入
   - 保留：Use as reference / Rename / Delete

9. **`src/components/workspace/Workspace.tsx`**
   - `<ContextMenu client={client} />` → `<ContextMenu />`
   - `client`（`useKoubouConnection()`）仍由 `<ChatPanel client={client} />` 使用，不受影响

10. **`src/store/actions.ts`**
    - 删除 `regenerateAsset` 函数及其在 return 对象、`ServerActions` 中的导出

11. **`src/components/canvas/GenerateForm.tsx`**（与改动 7 同文件）
    - 删除 `regenerateTargetId` prop、`isRegenerate`、regenerate 分支
    - image 数量框守卫由 `kind === 'image' && !isRegenerate` 简化为 `kind === 'image'`
    - `title` 恒为 `Generate ${noun}`

12. **`src/store/index.ts` + `src/components/canvas/GenerateFormHost.tsx`**
    - 删除 `GenFormState.regenerateTargetId`
    - `prompt?`（GenFormState）与 `initialPrompt`（GenerateForm）已无写入方（仅 AddAssetMenu 以 `{ kind }` 打开表单），一并清理；`GenerateFormHost` 移除 `initialPrompt`/`regenerateTargetId` 传参
    - 更新 `GenFormState` 上方相关注释

## 四、数据流

```
双击空白 pane → AddAssetMenu 点 Audio → openGenForm({ kind: 'audio' })
→ GenerateFormHost 渲染 GenerateForm(kind=audio)
→ 输入文本 → generateAudio({ prompt })
→ pgcApi.genAudio → 单条 CanvasItemData → canvasItemToAsset → assets 追加
→ selectCanvasNodes → AudioNode 渲染（已存在）
```

## 五、已知边界（YAGNI，本次不做）

- 表单不暴露 `voice_id`、`output_format`，使用服务端默认（mp3）。
- `AudioNode` 沿用现有静态波形卡，不做内联播放、不显示时长（接口无 duration 字段，设计稿也未涉及）。
- Regenerate 整体移除，音频不涉及重新生成。

## 六、测试

- **`map` 单测**：`canvasItemToAsset({ type: 'audio', ... })` → `kind === 'audio'`（守护本次 bug 修复）。
- **`actions` 单测**：mock `pgcApi.genAudio` 返回单条 audio item，调用 `generateAudio` 后 `assets` 追加一条 `kind:'audio'` 资产。
- **回归**：`pnpm test` + `pnpm lint`，确保移除死代码后无未用导入 / 类型错误。
