# 对话输入区模型选择组件设计

日期：2026-06-17
状态：已与 Nick 确认方向（切换发 `session.set_model` 不重连；`selectedModel` 全局单值持久化）

参考设计稿：Figma `node-id=424-3595` / `node-id=33-463`（输入卡右下角胶囊：模型名 + 上扬 chevron，向上弹出下拉列表）。

## 背景

对话输入区（`Composer.tsx`）当前固定走后端默认模型，用户无法选择。需在输入卡右下角（send 按钮左侧）增加模型选择组件：拉取 Koubou 可用模型列表、默认取第一项、本地持久化用户手动选择、建连时带上、运行中切换发 `set_model`。

## 后端契约（Koubou，apifox 项目 8405123 / Koubou Agent 模块「List Models」+ `websocket-events.md` 已核实）

- **可用模型**：`GET /models?backend=cc`（经代理 `GET /api/koubou/models?backend=cc`）。Koubou 信封 `{ code, message, data }`，`code===0` 为成功；`data` 形状已确认：
  ```jsonc
  {
    "backend": "cc",                 // 列表所属 backend
    "default_model": "string|null",  // 后端默认模型;null = 后端自行决定
    "models": ["claude-opus-4-8", "claude-fable-5"]  // 可选模型 ID 数组(含默认)
  }
  ```
  - `backend` 缺省 `cc`，当前仅支持 `cc`（`codex`/`single` 返 400，分类外值返 422）。本期固定传 `backend=cc`，不会触发这两类错误。
  - 鉴权走代理 cookie 透传（文档列的 `Authorization: Bearer` 为 `pgc_bearer` 模式，非本项目路径），client 无需额外改动。
  - 同一列表亦镜像在 `session.ready.payload.available_models`；本期仍以 `/models` 为数据源（任务要求）。
- **列表项为裸 ID 字符串**，无展示名 → 展示名（Figma 的「Opus 4.8」）由前端从 ID 派生。
- **默认模型取 `models[0]`**（Nick 指定）。注：契约另有 `default_model` 字段语义上即后端默认,本期不采用,如需改用为一行调整。
- **建连带模型**：WS URL 查询参数 `?model=<id>`（与 `ws_ticket`、`after_sequence` 并列）。
- **运行中切换**：发客户端帧 `{ "type": "session.set_model", "payload": { "model": "<id>" } }`，**不重连**；后端热切换并将模型落库到会话（重连后仍生效）。

## 核心设计决策

- **切换发 `session.set_model` 不重连**：避免打断 running agent 与历史续传，符合文档推荐。
- **`selectedModel` 全局单值、本地持久化**：随 `taluna-v4` 落盘，跨项目共用；非按项目记忆。
- **默认模型 = `/models` 列表第一项**：仅当本地无持久化选择、或持久化值已不在最新列表时回落到 `models[0]`。

## 整体架构

### 1. `src/lib/koubou/client.ts` — 新增 `listModels`

```ts
// /models 返回 { code, message, data: { models: string[] } };backend 本期固定 cc
listModels: () => koubou<{ models: string[] }>('GET', '/models?backend=cc').then((d) => d.models),
```

### 2. `src/lib/koubou/models.ts`（新，纯函数）

由模型 ID 派生展示名，无硬编码映射表（避免随后端列表变更而陈旧）：

```ts
// claude-opus-4-8 → "Opus 4.8";claude-fable-5 → "Fable 5";claude-sonnet-4-6 → "Sonnet 4.6"
// 规则：去 `claude-` 前缀 → 丢弃末尾纯数字日期段(≥6 位) → 首段族名 Title case → 其余数字段用 "." 连接
// 无法识别(空/异常)回退原 id
export function modelLabel(id: string): string { ... }
```

### 3. `src/koubou/protocol.ts` — `buildWsUrl` 增加可选 `model`

`opts` 新增 `model?: string | null`；有值则 `params.set('model', opts.model)`（与 `ws_ticket` 同为 query 参数）。

### 4. `src/koubou/client.ts` — 透传 model + `setModel`

- `KoubouClientOpts` 新增 `model?: string | null`，`connect()` 内透传给 `buildWsUrl`。
- `KoubouClient` 新增 `setModel(model: string)` → `send({ type: 'session.set_model', payload: { model } })`。

### 5. `src/store/`（`index.ts` + `types.ts`）

- UIState 新增 `availableModels: string[]`（初始 `[]`）、`selectedModel: string | null`（初始 `null`）。
- 新增 action：
  - `setAvailableModels(models)`：写列表；若 `selectedModel` 为空或不在新列表，则置为 `models[0] ?? null`。
  - `setSelectedModel(id)`：写持久化选择。
- `partialize` 白名单加入 `selectedModel`（`availableModels` 为瞬态不落盘，每次启动重新拉取）。

### 6. `src/client/useModelList.ts`（新 hook）

挂载时 `koubouApi.listModels()` → `setAvailableModels(models)`（内部解析默认）。失败静默（保持空列表，组件不渲染）。在 `Workspace` 挂载，早于 WS 建连。

### 7. `src/client/useKoubouConnection.ts`

`createKoubouClient` 调用处传 `model: useStore.getState().selectedModel`（建连时读取当前值，**不进 effect deps**，避免默认解析时抖动重连）。

### 8. `src/components/chat/ModelSelector.tsx`（新）+ `Composer.tsx`

- `ModelSelector` 接收 `client` ref；读 `availableModels` / `selectedModel`。
- 渲染 Figma 胶囊：`modelLabel(selectedModel)` + 上扬 chevron；点击向上弹出下拉卡，列出 `availableModels.map(modelLabel)`，选中项打勾。
- 选择：`setSelectedModel(id)` + `client.current?.setModel(id)`。
- `availableModels` 为空时不渲染（无模型可选）。
- `Composer` 把 send 按钮与 `ModelSelector` 包进右侧分组（`flex items-center gap-2`），`ModelSelector` 在 send 左侧；run 中/非 run 态都展示选择器。

## 数据流

```
useModelList(挂载) ──GET /api/koubou/models?backend=cc──▶ setAvailableModels ──▶ selectedModel 默认=models[0]
ModelSelector 选择 ──▶ setSelectedModel(id)[持久化] + client.setModel(id) ──WS──▶ session.set_model
useKoubouConnection 建连 ── model: selectedModel ──▶ createKoubouClient ──▶ buildWsUrl(?model=)
```

## 时序权衡

`/models` 在 `Workspace` 挂载即拉取，通常先于 WS 建连（建连前还有 `resolveSession` + `listEvents` 两跳）完成。万一建连时 `selectedModel` 仍为空，则该次连接走后端默认模型，待用户切换由 `set_model` 兜底，下次自然重连再带上。这是「不让连接依赖模型解析（避免抖动重连）」接受的取舍。

## 测试（同目录 TDD，vitest）

- `models.test.ts`（纯函数）：`claude-opus-4-8`→"Opus 4.8"、`claude-fable-5`→"Fable 5"、`claude-sonnet-4-6`→"Sonnet 4.6"、`claude-haiku-4-5-20251001`→"Haiku 4.5"、未知/空 ID 回退原值。
- `lib/koubou/client.test.ts` 补充：`listModels` 解析 `data.models`；非 0 code 抛 `KoubouError`。
- `koubou/protocol.test.ts` 补充：`buildWsUrl` 带 `model` 拼出 `model=` query；不带时无该参数。
- `koubou/client.test.ts` 补充：`setModel` 发出 `session.set_model` 帧、payload.model 正确；建连 URL 含 `model=`。
- `store` 补充：`setAvailableModels` 空选择时默认 `models[0]`、持久化值不在列表时回落、在列表时保留；`setSelectedModel` 写值；`partialize` 含 `selectedModel`。
- `ModelSelector.test.tsx`：渲染当前模型展示名；展开列出全部；选择触发 `setSelectedModel` + `client.setModel`；空列表不渲染。

## YAGNI 取舍

- **不做 `backend` 切换 UI**：当前仅支持 `cc`，固定传 `backend=cc`。
- **不按项目记忆模型**：全局单值，与 Figma 的输入区单选一致。
- **不与 `session.ready.model` 做双向同步**：选择器以前端持久化值为准；不读取后端会话已落库模型回填选择器（避免与「建连带 model」的先后次序纠缠）。`available_models` 不作为列表数据源（任务明确用 `/models`）。
- **不复用 `KoubouState.model`**：该字段来自 `SystemMessage`，语义是「运行会话上报的模型」，与用户选择偏好分离，保持不动。
