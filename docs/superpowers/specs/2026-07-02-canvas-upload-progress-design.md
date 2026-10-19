# 画布上传资产的占位卡 + 真实进度条

- 日期：2026-07-02
- 分支：`feat/canvas-upload-progress`
- 状态：设计定稿

## 背景与问题

画布上传本地资产（图片 / 视频 / 音频）时**没有任何状态反馈**。`uploadAsset`（`src/store/actions.ts`）是「裸 `await uploadCanvasItem` → 一次性落卡」：整个上传阻塞在一个 `await` 上，期间画布无占位卡、无 loading、无进度，用户看不到上传是否在进行、还要等多久。大文件（视频 / 音频上限 20MB）尤其明显。

对比之下，**资产生成**流程已有成熟的「占位卡 → 原位替换」UX（`addGenPlaceholders` / `settleGenPlaceholders` / `removeGenPlaceholders` 三件套 + `runGen` 骨架），但生成的 loading 只有无限转圈，没有进度概念。

## 目标

上传本地资产时：

1. **立即落占位卡**：选文件后马上在画布出现一张 loading 卡（复用生成的占位卡机制）。
2. **展示真实上传进度**：占位卡上显示真实的上传百分比进度条（不是无限转圈）。
3. **完成原位替换 / 失败移除**：上传成功后原位替换为真实资产卡；失败移除占位卡并弹 Toast。

非目标（YAGNI）：

- 不做多文件批量上传（当前上传入口本就单文件）。
- 不做 3D / 文档上传（上传策略 `UPLOAD_POLICY.canvas` 本就只允许 image/video/audio）。
- 不做显式「取消上传」按钮（删除占位卡即隐式取消，见下）。

## 关键约束（来自现有代码事实）

- `uploadCanvasItem`（`src/lib/pgc/client.ts:108`）用 `fetch + FormData`（multipart）。**`fetch` 无法观测上传进度**，要拿真实百分比必须改 `XMLHttpRequest`（`xhr.upload.onprogress`）。
- `unwrap<T>`（`src/lib/pgc/client.ts:28`）是信封解析 + `PgcError` 的唯一处，XHR 版必须复用同一语义，**不重复造判定逻辑**。
- 上传经**同源 Next 代理**（`/api/pgc/[...path]` → PGC）。`xhr.upload.onprogress` 反映的是「浏览器 → Next 服务器」这一段字节；100% 后还有「Next → PGC 转发 + 后端转存」的短暂尾巴。进度语义须对此**诚实**。
- 节点卡 loading 判定统一是 `asset.status === 'generating'`（各节点卡内的分支），不是 `pending_` id 前缀。
- `assets` **不在 persist 白名单**（`src/store/index.ts:373`）→ 上传占位卡刷新后随画布从 PGC 重载而消失，**无孤儿占位卡问题**。
- 占位卡 id 用 `pending_` 前缀（`newId('pending')`），`deleteCanvasItem` 据此跳过服务端删除，仅本地移除。

## 方案总览

复用生成流程的占位卡三件套骨架，仅在两处扩展：

1. **底层**：`uploadCanvasItem` 从 `fetch` 改 `XMLHttpRequest`，暴露 `onProgress` 回调。
2. **UI**：占位卡渲染进度条（由 `Asset.progress` 驱动）。

上传天然同步返回（无 GenTask 轮询），最接近的模板是 `generateAudio`（`src/store/actions.ts`）。

## 详细设计

### 1. 底层：`uploadCanvasItem` 改 XHR（`src/lib/pgc/client.ts`）

从 `unwrap` 抽出**信封判定**纯函数（吃已解析的信封对象），供 `fetch` 版与 XHR 版共用。**关键**：`unwrap` 仍用 `res.json()` 解析（不改成 `res.text()`），否则会打断现有 `client.test.ts` 的 `mockJson`（只 stub 了 `json()` 没 stub `text()`）。差异仅在「怎么拿到信封对象」：fetch 走 `res.json()`，XHR 走 `JSON.parse(responseText)`；判定逻辑共用。

```ts
// 已解析信封(或 null)+ HTTP 状态 → data 或抛 PgcError。fetch/XHR 共用,不重复造判定
function resolveEnvelope<T>(env: ApiResponse<T> | null, ok: boolean, status: number): T {
  if (!ok || !env || env.success === false) {
    throw new PgcError(env?.code ?? 'HTTP_ERROR', env?.message ?? `HTTP ${status}`, status, env?.failure ?? null);
  }
  return env.data as T;
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: ApiResponse<T> | null = null;
  try { env = (await res.json()) as ApiResponse<T>; } catch { /* 非 JSON */ }
  return resolveEnvelope(env, res.ok, res.status);   // 行为与原 unwrap 完全一致
}
```

新上传签名（`onProgress` 回报字节比例，`signal` 支持中止）：

```ts
// 上传(multipart);onProgress 回报「浏览器→服务器」字节比例(0..1),仅字节上传阶段可观测;
// signal 中止时 xhr.abort() → 抛 ABORTED(删除占位卡时用)
export function uploadCanvasItem(
  pid: number, file: File,
  onProgress?: (ratio: number) => void, signal?: AbortSignal,
): Promise<CanvasItemData> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PREFIX}/api/projects/${pid}/canvas/items/upload`);
    xhr.withCredentials = true;   // 等价 fetch credentials:'include'(cookie 制鉴权)
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let env: ApiResponse<CanvasItemData> | null = null;
      try { env = JSON.parse(xhr.responseText); } catch { /* 非 JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      try { resolve(resolveEnvelope(env, ok, xhr.status)); }
      catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new PgcError('NETWORK', 'Network error', 0));
    xhr.onabort = () => reject(new PgcError('ABORTED', 'Upload aborted', 0));
    xhr.send(fd);
  });
}
```

采用 `AbortSignal`（Web 标准、易测、与将来 fetch 回迁兼容）而非返回 `{ promise, abort }`。

### 2. 状态：`Asset` 加 `progress?: number`（`src/store/types.ts`）

```ts
export interface Asset {
  // ...现有字段
  progress?: number;   // 上传字节进度 0..1;仅上传占位卡在字节上传阶段有值,其余态为 undefined
}
```

- `progress ∈ [0, 1)` → 占位卡渲染进度条。
- `progress == null` → 回退原有语义（生成中转圈 / 就绪 / 失败）。
- **`status` 仍用 `'generating'`**：节点卡的 `status === 'generating'` 判定一行不动，只是叠加进度条覆盖层。不引入 `'pending'` 值，避免改所有节点卡的条件分支。

### 3. Action：改写 `uploadAsset`（`src/store/actions.ts`）

```ts
// opts 透传 spawnAt:占位卡落在用户触发点(双击点 / 视口中心),与生成一致
const uploadAsset = async (file: File, opts?: GenPlacement) => guard(set, async () => {
  const pid = get().currentProjectId; if (pid == null) return;
  const kind = kindFromMime(file.type);
  const [phId] = addGenPlaceholders(kind, 1, opts);
  setAssetProgress(phId, 0);                    // 初始 0%,立即显示进度条
  const controller = new AbortController();
  registerUpload(phId, controller);             // 记录以便删除占位卡时 abort
  try {
    const item = await uploadCanvasItem(pid, file, throttleRatio(phId), controller.signal);
    if (get().currentProjectId !== pid) return; // await 后切项目:丢弃
    // 按 item_id upsert(复用 adoptAgentItem):占位卡在→原位替换;占位卡被 loadCanvas 抹掉但 item 已加载
    // →原位更新不重复;都没有→落视口中心。成功上传永不被删。
    // source 覆盖为 'uploaded':canvasItemToAsset 无 opts,展开后覆写真实字段(不臆造签名)
    adoptAgentItem(pid, phId, { ...canvasItemToAsset(item), source: 'uploaded' });
  } catch (e) {
    if (get().currentProjectId === pid) removeGenPlaceholders([phId]);
    if (e instanceof PgcError && e.code === 'ABORTED') return; // 主动 abort 不弹 Toast
    throw e;                                     // 其余交 guard 弹 Toast
  } finally {
    unregisterUpload(phId);
  }
});
```

要点：

- **进度节流**：`xhr.upload.onprogress` 每秒触发多次，`throttleRatio(phId)` 只在取整百分比变化时 `set`（≤100 次），避免 xyflow 逐帧重渲抖动。
- **100% 尾巴**：字节传完后 `ratio` 逼近 1，但仍在等服务端响应。此时把 `progress` 置回 `undefined`（保留 `status: 'generating'`）→ 覆盖层从进度条**回退为 spinner**，语义 = 「处理中」。因此进度条只覆盖真实字节上传段，spinner 覆盖服务端转存段。（`throttleRatio` 在 `ratio >= 1` 时 `setAssetProgress(phId, undefined)`。）
- **原位替换（upsert）**：成功路径统一走 `adoptAgentItem(pid, phId, {...})` 按 item_id upsert，真实卡接管占位卡坐标，`source: 'uploaded'` 溯源。**不用**「占位卡不在就删服务端 item」的 ghost 守卫——`loadCanvas`（agent `run.finished` 触发、整表替换 assets）会抹掉在途占位卡，ghost 守卫会因此误删刚上传成功的合法 item。upsert 覆盖三情形：占位卡在→原位替换；占位卡被抹但 item 已加载→按 item_id 原位更新（不重复、保留其坐标）；都没有→落视口中心。
- **中止/删除**：`deleteCanvasItem` 的 `pending_` 分支里调 `abortUpload(itemId)` → XHR abort → promise reject `ABORTED` → catch 静默返回（不走成功路径）。

新增小工具（`actions.ts` 内闭包 + 一个瞬态 map）：

- `setAssetProgress(id, ratio)`：`set` 更新对应 asset 的 `progress`。
- `throttleRatio(id)`：返回一个闭包，内部记住上次取整百分比，变化才 `setAssetProgress`；`ratio >= 1` 时置 `undefined`。
- `registerUpload / unregisterUpload / abortUpload`：以 `Map<placeholderId, AbortController>` 追踪在飞上传（瞬态、不落 store、不持久化）。

### 4. UI：进度条覆盖层（`src/components/canvas/nodes/NodeCard.tsx`）

在 `NodeCard` 外框渲染一层进度覆盖层（仿现有「删除中」覆盖层模式），一处覆盖 image / video / audio 全类型：

- 条件：`asset.progress != null`（上传字节阶段）。
- 视觉走令牌：`bg-black/35 backdrop-blur-[1px]` 遮罩 + `--color-accent` 填充的细进度条 + `--font-mono` 百分比文字。
- 无障碍：`role="progressbar"` + `aria-valuenow` + `aria-label={t('common.uploading')}`。
- 尊重降低动态：进度条宽度过渡加 `motion-safe:`，并在 `prefers-reduced-motion` 下退化。

```
┌──────────────┐
│              │
│     47%      │  ← 居中百分比(mono)
│  ▓▓▓▓▓░░░░░  │  ← 底部细进度条(accent 填充)
└──────────────┘
```

放在 `NodeCard`（而非各节点卡）的理由：跨类型统一、DRY、audio 占位卡当前只有静态波形无 spinner，这样也能获得进度反馈。字节传完 `progress` 置 `undefined` 后，覆盖层消失，回落到各节点卡自身的 `generating` spinner（处理中）。

### 5. 上传入口透传落位（`AddAssetMenu.tsx` / `EmptyStateChips.tsx`）

`uploadAsset` 新增可选 `opts?: GenPlacement`：

- `AddAssetMenu`：`onFile` 传 `{ spawnAt }`（双击点画布坐标），占位卡落在触发点，与生成表单一致。
- `EmptyStateChips`：传 `{ spawnAt: getViewportCenter() }`。

（当前上传落在视口中心级联位；改为触发点是与生成一致的小体验提升。）

## 错误处理与边界

| 场景 | 处理 |
|---|---|
| 上传失败（网络 / 4xx / 5xx） | `removeGenPlaceholders` + rethrow → `guard` 写 `lastError` → Toast |
| 401 鉴权 | `guard` 置 `authRequired`，不弹红报错（现有行为） |
| 主动中止（删除占位卡） | `abort` → `catch` 到 `ABORTED` 静默返回，不弹 Toast |
| await 后切项目 | `if (currentProjectId !== pid) return` 守卫，丢弃 |
| 占位卡被 loadCanvas 抹掉后上传才 resolve | `adoptAgentItem` 按 item_id upsert：item 已加载→原位更新不重复；未加载→落卡。成功上传不被删 |
| 刷新页面 | `assets` 不落盘，占位卡随画布重载消失，无需处理 |

## i18n（六语，en 单一真相源）

新增 `common.uploading`（"Uploading" / "上传中" …），补齐 en/zh/fr/ru/ja/vi 六套。抽取时扫 `aria-label` 盲点。

## 测试计划（同目录 TDD）

- `src/lib/pgc/client.test.ts`：注入 FakeXHR，覆盖
  - `onProgress` 按 `loaded/total` 回报比例；
  - 成功 → `resolveEnvelope` 解出 `data`；
  - 失败信封 / 非 2xx → 抛 `PgcError`（code/message/status 正确）；
  - `abort` → 抛 `ABORTED`。
  - `resolveEnvelope` 抽取后，原有 `unwrap` 行为回归不变。
- `src/store/actions.test.ts`：
  - `uploadAsset` 落 1 张 `generating` 占位卡（`progress=0`）；
  - progress 回调推进 `Asset.progress`（含取整节流：仅百分比变化才更新）；
  - `ratio>=1` 时 `progress` 置 `undefined`（回退 spinner）；
  - 成功 → 原位替换为 `source:'uploaded'` 真实卡；
  - 失败 → 移除占位卡 + `lastError` 弹 Toast；
  - 删除占位卡 → abort 且不弹 Toast；占位卡被 loadCanvas 抹掉后上传才成功 → upsert 落卡且不删服务端 item（含 item 已加载时不产生重复卡）。
- 节点卡进度覆盖层可选组件测试（渲染 `progress` 时出现 `role="progressbar"`）。

## 改动文件清单

- `src/lib/pgc/client.ts`：抽 `resolveEnvelope`；`uploadCanvasItem` 改 XHR + `onProgress` + `AbortSignal`。
- `src/store/types.ts`：`Asset.progress?: number`。
- `src/store/actions.ts`：改写 `uploadAsset`；`deleteCanvasItem` pending 分支 abort；新增进度/上传追踪小工具。
- `src/components/canvas/nodes/NodeCard.tsx`：进度覆盖层。
- `src/components/canvas/AddAssetMenu.tsx` / `EmptyStateChips.tsx`：`uploadAsset` 透传落位 opts。
- `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`：`common.uploading`。
- 对应 `*.test.ts` 测试。
