# 生成失败卡保留与原地重试

> 状态：设计稿 · 2026-08-03
> 关联：P0 第三块「创作溯源」的**第一步**。同块的「属性面板露出 prompt/模型」与「以相同参数再生成」需要动数据层（provenance 落库），单独立项；本稿刻意不碰数据层。
> 前两块：`2026-08-03-canvas-undo.md`、`2026-08-03-canvas-search-jump.md`（均已回合 dev）。

## 目的

生成失败时别把用户的上下文一起扔掉。

现状：用户为一次视频生成付了积分、等了几分钟，失败后得到的是 **卡片消失 + 一条 4 秒 Toast**。等他反应过来，失败原因和自己填过什么都找不回来了。

具体落点（`store/actions.ts`）：

| 失败路径 | 现状 |
|---|---|
| 同步生成（image / audio） | `runGen` catch → `removeGenPlaceholders` 删占位卡 → 抛给 `guard` 弹 Toast |
| 异步任务级失败（video / 3d） | `failGenTask(deleteRemote=true)` 删卡 + Toast + 清服务端残留 |
| 异步 item 级失败 | 同上 |
| 派生失败（rig3d / retexture） | `settleDerivedFailure` —— **保留卡**并挂 `failure`，`status='error'` |

也就是说「保留失败卡」这条路只有派生任务走过，而它恰好是最低频的那类。

而且即使保留下来，卡片上的失败态渲染也有三个问题：

1. **三份重复实现**：`AudioNode` / `VideoNode` / `ThreeDNode` 各自写了一份几乎相同的 `ErrorBody`；`ImageNode` **完全没有** error 分支。
2. **硬编码色值**：`bg-[color-mix(in_srgb,#ef4444_14%,white)]` / `text-[#b91c1c]` —— 违反项目「颜色一律走 CSS 变量」的约定，且深色主题下不适配。仓库已有 `--color-danger` / `--color-danger-soft`（两个主题都定义了）。
3. **不显示具体原因**：只渲染通用文案 `canvas.genError`，而后端 `CanvasGenFailure.message` 是**已本地化、面向用户的可读说明**（如内容审核拒绝的具体缘由），被丢掉了。

## 约束

1. **不碰数据层、不改后端契约**。provenance 落库是同块的后续议题；本稿不写 `reference`、不动 `assetReference`、不加后端字段。
2. **重试参数只活在本会话**：记在 actions 闭包注册表（类比既有 `inflight` / `pendingDeletes`），**不进 store、不持久化**。刷新后参数消失，重试入口降级为「打开生成表单」。
   - 这与「本地失败卡刷新即消失」的降级窗口一致，语义自洽：失败卡的价值是即时的。
3. **四类失败路径行为统一**：都保留卡 + 显示原因 + 给重试入口。接受一个不一致：**无服务端 item 的失败卡（同步生成、以及服务端无残留的异步失败）刷新后消失**；有 `failed` item 的会被 `loadCanvas` 带回（`statusOf('failed') → 'error'` 已存在）。不为此把瞬态失败态写进 localStorage（仓库明列的反模式）。
4. **尊重 `failure.retryable`**：`false`（如内容审核拒绝，原参数重发必然再失败）时按钮语义改为「修改后重试」→ 打开预填的生成表单，而不是白等一次甚至再扣一次费。
   > ⚠️ **本条的契约假设是错的**（2026-08-13 对账）：pgc 的 `retryable` 意为「**调整后**能否重试」，内容审核类真机恒 `true`，
   > 该分支因此从未在真机生效（用例 R07-6 复现不出来）。判据已改为 `failure.category === 'content_policy'`，
   > 见 `2026-08-13-retry-route-content-policy.md`。**本文全篇**凡以 `retryable` 表述该分支的地方
   > （成功标准 5 / 6、实现方案里「按 `retryable` 二选一文案」）都应按此订正读。
5. **UI 收敛而非新增**：把三份 `ErrorBody` 合成一个共用组件，色值改走 `--color-danger` / `--color-danger-soft`，补上 `ImageNode` 缺失的分支。按钮复用 `IconButton`，不新建按钮种类。
6. **Toast 保留不动**：卡上显示原因与 Toast 不冲突 —— 异步任务几分钟后失败时用户视线可能不在那张卡上，Toast 承担「把注意力拉回来」的职责。

## 成功标准

1. 四类失败路径（同步生成 / 异步任务级 / 异步 item 级 / 派生）失败后**卡片都留在画布原位**，不再消失。
2. 失败卡显示后端给的 `failure.message`；`failure` 缺失时回退通用文案 `canvas.genError`。
3. 失败卡在 image / video / audio / 3d 四种类型上都有失败态渲染（`ImageNode` 不再漏）。
4. 失败态色值全部走 `--color-danger` / `--color-danger-soft`，深浅主题都正确；仓库内不再有 `#ef4444` / `#b91c1c` 这类硬编码。
5. `failure.retryable !== false` 时，失败卡上「重试」按钮用**原参数**重发；卡片原位变回 generating 态。
6. `failure.retryable === false` 时，按钮为「修改后重试」，点击打开该类型的生成表单并预填原参数。
7. 本会话内的参数在页面刷新后消失；此时重试入口降级为打开**空**生成表单，不报错、不发空请求。
8. 失败卡可以像普通卡一样被删掉（无服务端 item 的走即时移除，有的走延迟删除）。
9. 失败卡不可作为生成源、不可 @ 引用（无字节，`canMention` 已天然拦住）—— 回归验证不被破坏。
10. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 现状要点（实现前必读）

- `Asset.failure?: CanvasGenFailure | null` 与 `status: 'error'` **字段都已存在**，映射层 `statusOf('failed') → 'error'`、`failure: it.failure` 都已接好。缺的只是「让失败路径别删卡」+「把 failure 渲染出来」。
- `CanvasGenFailure = { code, category, message, retryable, provider_code? }`，`message` 已本地化可直接展示。
- `runGen`（`actions.ts`）是**六种生成的共同骨架**：占位卡落位、在飞注册表、失败清理都在这里 —— 「失败保留占位卡」的改动应落在这一处，而不是散到各 `generate*`。
- `removeGenPlaceholders` / `failGenTask` / `settleDerivedFailure` 是三个删卡点。
- 占位卡 id 是 `pending_` 前缀（无服务端 item），`requestDeleteAssets` 已按前缀分流（即时移除 vs 延迟删除），失败卡删除可直接复用。
- `openGenForm({ kind, sourceId, x, y, spawnAt })` 已是 store action；`GenerateForm` 目前从空白开始，**预填需要新增入参**。
- `ABORTED` 是用户主动取消（删占位卡中止在飞请求）的错误码，**不是失败** —— 现有 `runGen` 已静默处理，改动后仍不得留失败卡。

## 方案

### 1. 失败即保留：改造 runGen 与三个删卡点

- `runGen` 的 catch：`ABORTED` 仍静默；其余错误**不再** `removeGenPlaceholders`，改为把占位卡就地标成 `status: 'error'` + 挂 `failure`（`PgcError.failure` 已带结构化详情，缺失则 `null`）。
- `failGenTask`：去掉删卡，改为标记失败态。`deleteRemote` 语义保留（服务端残留仍要清），但**本地卡留下**。
- `settleDerivedFailure`：已是保留语义，只需确保 `failure` 一致落到卡上。

### 2. 重试参数注册表（闭包，不进 store）

```ts
// actions.ts 闭包内,类比 inflight / pendingDeletes
type RetrySpec =
  | { kind: 'image'; req: CanvasGenImageRequest; opts?: GenPlacement }
  | { kind: 'audio'; req: CanvasGenAudioRequest; opts?: GenPlacement }
  | { kind: 'video'; req: CanvasGenVideoRequest; opts?: GenPlacement }
  | { kind: '3d';    req: CanvasGenModel3DRequest; opts?: GenPlacement };
const retrySpecs = new Map<string, RetrySpec>();   // 失败卡 id → 重发所需的一切
```

- `runGen` 落占位卡时登记（占位卡 id 即键）；成功替换后删除该键（成功的卡不需要重试）。
- 异步任务失败时键仍是那张卡的 id（占位卡被真实 item 原位替换过 → 需在替换处迁移键）。
- 上限：与撤销栈同思路给个有界上限（如 50），防长会话无界增长。

### 3. 两个 action

- `retryGeneration(assetId)`：取 `retrySpecs`，按 `kind` 分派到既有 `generateImage/Audio/Video/Model3d`，落点为**该失败卡的位置**（`opts.spawnAt` 用卡片当前坐标），并先移除失败卡 —— 视觉上就是「原位变回 generating」。无 spec 时降级为 `openGenForm`。
- `openRetryForm(assetId)`：`openGenForm` + 预填。`GenerateForm` 新增可选 `prefill` 入参（prompt / model / params），无 spec 时为空表单。

### 4. 统一失败卡组件

新建 `src/components/canvas/nodes/GenErrorBody.tsx`：

- 三份重复的 `ErrorBody` 全部替换为它；`ImageNode` 补上分支。
- 渲染：danger 底（`--color-danger-soft`）+ danger 文字（`--color-danger`）+ `failure.message`（缺失回退 `canvas.genError`）+ 一个重试按钮（按 `retryable` 二选一文案）。
- 文案区限高可滚（`.scrollbar-none`）：后端 message 可能较长，不能把卡撑变形。
- 按钮用 `IconButton`（`variant="bordered"`），不新建按钮种类。

## 取舍与明确不做

- **不做属性面板 / prompt 展示** —— 需要 provenance 落库，同块后续议题。
- **不做跨刷新重试** —— 需要把参数写进 `reference`，同上。见约束 2 的降级设计。
- **不做失败卡持久化** —— 违反「不持久化瞬态」，且失败卡会长期堆积。
- **不做自动重试 / 退避重试** —— 生成是付费操作，必须用户显式发起。
- **不改 Toast 行为** —— 见约束 6。
- **不动 `ABORTED`（用户主动取消）路径** —— 那不是失败，不该留失败卡。
