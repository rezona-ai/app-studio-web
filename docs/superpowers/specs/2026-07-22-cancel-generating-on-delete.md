# 删除生成中卡片：中断在飞请求 + 删除动效对齐新占位设计

## 背景

画布资产生成期间，卡片以 `pending_` 占位卡（尚无服务端 item）或 generating 服务端 item 的形态存在。当前删除这类卡片有两处断层：

1. **请求不中断，删卡会"还魂"**。`deleteCanvasItem` 的 `pending_` 分支只做本地移除（仅上传路径有 `uploads` Map 可 abort XHR）。同步生成（图像/音频，后端跑几十秒到分钟级）与异步生成（视频/3D/绑骨/重纹理）起步 POST 的 fetch 都仍在飞：
   - 同步路径返回后 `settleGenPlaceholders` 无条件把真实资产落画布——用户刚删掉的卡片重新出现；
   - 异步 POST 返回后 `startAsyncGen → adoptAgentItem` 同样把卡重新加回（占位卡不在则落视口中心）并登记轮询任务。
2. **删除中覆盖层是旧视觉**。`NodeCard` 的 deleting 覆盖层还是 `animate-spin` 双色圆环 spinner，而 2026-07-22 资产卡片生成占位改版（`4999956`）已把"处理中"统一为「类型色状态光环（ring + 中心点 + `brand-float` 漂浮 + backdrop-blur）」，两套语汇并存。

## 目标与成功标准

- 删除在飞生成/上传占位卡时，前端**中止对应 HTTP 请求**；请求被中止后不落卡、不弹 Toast、不报生成失败埋点（用户主动取消不是失败）。
- 图像批量（n>1）删除其中一张：该张不再落卡；其余占位卡不受影响，请求继续；全批都删完才 abort 整个请求。
- 请求已在服务端完成（abort 竞态输了 / 批量部分删除）时，对应服务端 item 以 fire-and-forget 方式清除，避免刷新后还魂。
- 删除中覆盖层复用新占位设计的状态光环语汇（类型色、中心点、漂浮动效），保留 `role="status"` 语义与 reduced-motion 退化。
- 不改后端协议；已进入服务端异步任务的生成（POST 已返回）删除行为维持现状（删服务端 item + 清本地轮询任务），后端任务是否取消不在本需求范围。

## 现状约束

- `pgc()`（`src/lib/pgc/client.ts`）目前只有 `AbortSignal.timeout(timeoutMs)`，不接受外部 signal；abort 语义已有先例：上传 XHR 中止抛 `PgcError('ABORTED')`，`doUploadAsset` 对 ABORTED 静默返回。
- **占位卡消失 ≠ 用户删除**：`loadCanvas`（agent run.finished 触发）整表替换 assets 可能抹掉在飞占位卡（`doUploadAsset` 注释已踩过此坑）。判定"用户删了"必须以 `deleteCanvasItem` 显式路径为准，不能用"占位卡还在不在"倒推。
- `settleGenPlaceholders` 按下标对位 anchors；`startAsyncGen` 恒单占位卡。
- 项目切换已有独立语义（persistGenTaskForProject 续接），不得与删除混淆。

## 方案比较

### 方案 A：删卡只删本地，settle 时按"占位卡是否还在"决定落不落卡

不 abort 请求，settle 检查占位卡存活。

- 优点：改动最小。
- 缺点：与"占位卡消失 ≠ 用户删除"约束冲突——loadCanvas 抹占位卡会误杀刚生成的合法资产；请求继续白跑（长达分钟级），不满足"中断请求"的诉求。

### 方案 B：显式删除登记 + AbortController 组句柄（推荐）

把 `uploads` Map 泛化为**在飞请求注册表**：一次生成请求的所有占位卡共享一个组句柄 `{ controller, group, deleted }`。`deleteCanvasItem` 显式标删单张；全组删完才 `abort()`。settle/startAsyncGen 用组句柄的 `deleted` 集合（显式用户意图）决定丢弃哪些资产并清服务端残留。

- 优点：删除意图显式登记，与 loadCanvas 抹卡天然区分；批量语义正确；上传路径（组恒为 1）自然收编，删掉双轨。
- 缺点：注册表结构比单 controller 复杂一档。

### 方案 C：等后端提供任务取消接口

- 优点：语义最完整（服务端也停算）。
- 缺点：PGC 现无该端点（client.ts 全部端点核对过）；阻塞在后端排期。前端 abort 与其不冲突，后续有接口再叠加。

## 推荐设计

采用方案 B。

### 请求中止链路

1. `pgc()` 增加可选 `signal` 参数，与超时组合为 `AbortSignal.any([signal, AbortSignal.timeout(ms)])`；`AbortError` 归一为 `PgcError('ABORTED', …, 0)`（与上传 XHR 同码）。六个生成端点（genImage/genAudio/genVideo/genModel3d/genRig3d/genRetexture）透传 signal。
2. `runGen` 为每次生成建 `AbortController`，把全部占位卡 id 登记进在飞注册表，signal 传给 `call`；结束（成败）后注销全组。
3. `deleteCanvasItem` 的 `pending_` 分支改调注册表的 `markDeleted(id)`：把该 id 记入组的 `deleted` 集合；`deleted` 覆盖全组时 `abort()`。上传占位卡组恒为 1，行为与现状（立即 abort XHR）一致。
4. ABORTED 静默：`generate*` 的 catch 里 ABORTED 不上报失败埋点、不照抛（不弹 Toast）；`runGen` 的 catch 对 ABORTED 不再调 `removeGenPlaceholders`（能 abort 说明全组占位卡已被删除路径移除）。

### 结果落地与残留清理

- `settleGenPlaceholders`：按下标对位时，占位卡 id ∈ 组 `deleted` 的那张**跳过落卡**，并 fire-and-forget `deleteCanvasItem` 清其服务端 item（同步生成此刻 item 已建）。
- `startAsyncGen`：唯一占位卡已标删（abort 竞态输了，POST 已成功返回 task）时，fire-and-forget 删服务端 item，不 adopt、不登记 GenTask。
- 项目切换路径不动：`persistGenTaskForProject` 语义不变（切项目≠删除）。

### 删除中覆盖层视觉

- 从 `GeneratingPlaceholder` 抽出共享的状态光环子组件（size-10 类型色 ring + 中心 7px 点 + `brand-float` + backdrop-blur），`GeneratingPlaceholder` 与 `NodeCard` deleting 覆盖层共用。
- `NodeCard` deleting 覆盖层：保留半透明表面色压暗 + `pointer-events-none`，居中 spinner 换为该光环，颜色取卡片类型色（`KIND_META[kind].colorVar`），`role="status"` + `aria-label`（canvas.deleting）语义不变。
- reduced-motion：`brand-float` 已在 `globals.css` 的 reduce 查询内禁用，无需新增。

## 无障碍与降级

- 光环容器仍以 `role="status"` 承载删除中语义；图形层 `aria-hidden`。
- 不新增 keyframes；`prefers-reduced-motion: reduce` 下光环静止，仅保留压暗与状态文案。

## 非目标

- 不做后端任务取消（无端点）；POST 已返回的异步任务删除行为维持现状。
- 不改上传进度层与生成占位图本体。
- 不为文本卡（同步秒回）新增取消交互。
