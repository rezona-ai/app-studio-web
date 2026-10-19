# 实现计划：生成前估价

> 设计稿：`docs/superpowers/specs/2026-08-06-canvas-generate-estimate.md`
> 分支：`feat/canvas-estimate`（worktree `.orca/worktrees/canvas-estimate`）

自下而上：纯函数 → 协议层 → 副作用 hook → UI。每步系统保持可运行、每任务一次提交，
提交后派干净上下文子代理按 commit 范围评审（只给 spec 与 diff）。

---

## T1 纯函数 + 协议层（不接线）

**改动**

- `src/lib/pgc/types.ts`
  ```ts
  // 判别器叫 type 不叫 kind:音频入参自己就有 kind(auto/speech/music/sound),会撞名
  export type CanvasEstimateType = 'image' | 'video' | 'audio' | 'model3d' | 'sprite' | 'rig3d' | 'retexture';
  // 其余字段与对应生成端点的入参**完全同构**(扁平,真机已确认),故用索引签名承接
  export interface CanvasEstimateRequest { type: CanvasEstimateType; [k: string]: unknown }
  export interface CanvasEstimateData {
    type: string;
    credits?: number | null;                        // 确定值
    credits_min?: number | null;                    // 区间
    credits_max?: number | null;
    currency: string;                               // 恒 'credit'
    model_id?: string | null;                       // 计价所用定价目录模型 id(排障/对账)
    billable: boolean;                              // 该用户当前是否真会被扣费(计费双闸门)
  }
  ```
- `src/lib/pgc/client.ts`
  ```ts
  // 零副作用:不调 provider、不预留额度、不落任务行 → ARTGEN/TRIPO 未配也能报价(不 503)
  estimateGenerate: (pid: number, body: CanvasEstimateRequest, signal?: AbortSignal) =>
    pgc<CanvasEstimateData>('POST', `/api/projects/${pid}/canvas/items/generate/estimate`, body, DEFAULT_TIMEOUT_MS, signal),
  ```
- `src/lib/gen-estimate.ts`（新）
  - `ESTIMATE_DEBOUNCE_MS = 300`
  - `ESTIMATE_TYPE_BY_KIND: Record<GenKind, CanvasEstimateType>` —— `image/video/audio` 同名，
    **`'3d' → 'model3d'`**（`GenKind` 是 `AssetKind` 子集，与后端判别器不同名，约束 2）
  - `estimateBody(kind, prompt, params, refs, model)` → `CanvasEstimateRequest`
    = `{ type: ESTIMATE_TYPE_BY_KIND[kind], ...buildGenBody(kind, prompt, params, refs, model) }`
    —— **复用提交那条 body 构造**，不写第二套映射（约束 1）
  - `export type Estimate = { kind: 'exact'; credits: number } | { kind: 'range'; min: number; max: number }`
  - `normalizeEstimate(data): Estimate | null` —— 三形态归一 + `billable === false → null`（约束 4）

**测试** 新建 `src/lib/gen-estimate.test.ts`；`src/lib/pgc/client.test.ts` 追加一条

- `ESTIMATE_TYPE_BY_KIND`：四类逐个断言，**重点钉死 `'3d' → 'model3d'`**（写错就整类报不出价）。
- `estimateBody`：产出带 `type`；键集与提交体**双向相等**（估价少发/多发都会红）。
  ⚠️ **原先这条写的是「其余字段与 `buildGenBody` 同一次调用的结果逐键相同（将来有人给提交
  那条加了参数却忘了估价，这条会红）」——那是不实的**：两边调的是同一个 `buildGenBody`、
  同一批实参，是重言式；且单向遍历抓不到「估价多发」。评审指出后改为：把
  `buildGenBody + modelBody` 的组合抽成共享的 `submitGenBody`（提交路径也走它），
  护栏改成双向键集相等。已做变异验证：让估价少发一个字段，这条会红。
- `normalizeEstimate`：
  - `{credits: 8, billable: true}` → `{kind:'exact', credits:8}`
  - `{credits_min:20, credits_max:40, billable:true}` → `{kind:'range', min:20, max:40}`
  - 三者皆空 → `null`
  - `{credits: 8, billable: false}` → **`null`**（决策 2：灰度关闸不渲染金额）
  - `credits: 0` → `{kind:'exact', credits:0}`（**0 是有效价格**，不能被 falsy 判成无价）
  - `min === max` → 收敛成 `exact`（后端说过两条路价一样时不摆 `[20,20]` 这种假区间，
    但前端也要能兜住）
- `client`：`estimateGenerate` 打对 URL/method/body，且 `signal` 被透传。

**验证** `pnpm exec vitest run src/lib/gen-estimate.test.ts src/lib/pgc/client.test.ts`

**提交** `feat(canvas): 生成估价的契约层与三形态归一纯函数`

---

## T2 `useGenEstimate` hook（debounce + 取消）

**改动** `src/client/useGenEstimate.ts`（新）

```ts
export function useGenEstimate(args: {
  pid: number | null;
  kind: GenKind;
  prompt: string;          // 只为拼 body,**不进依赖数组**(约束:prompt 与定价无关)
  params: GenParamValues;
  refs: RefSelection;
  model?: string;
}): Estimate | null
```

- `useEffect` 依赖：`pid / kind / model / JSON.stringify(params) / refs 的 id 摘要` —— **不含 prompt**。
- 每次触发：清上一个 timer、abort 上一个 controller → `setTimeout(ESTIMATE_DEBOUNCE_MS)` 后发请求。
- 响应回来先判 `controller.signal.aborted`，再 `setEstimate(normalizeEstimate(data))`。
- **catch 静默**：不弹 Toast、不进 `lastError`，只 `setEstimate(null)`（spec 的有意例外）。
- cleanup：清 timer + abort（覆盖「关弹窗」「切类型」两条路径）。
- `kind` 变化时**立即** `setEstimate(null)`（不等新报价回来），否则旧类型的价会停在新表单上。

**测试** 新建 `src/client/useGenEstimate.test.tsx`（用 `@testing-library/react` 的 `renderHook`，
mock `pgcApi.estimateGenerate`，注入假计时器）

- 挂载后 debounce 到点发**一次**请求，报价落定（标准 1/2）。
- 连改三次参数 → 只发**一次**请求（最后那次），且前两个 controller 被 abort（标准 3）。
- 只改 `prompt` → **不发请求**（标准 4）。
- 请求 reject → `estimate` 为 `null`，**未调 `setError`**（标准 6/9）。
- `billable: false` → `null`（决策 2）。
- 卸载 → timer 被清、controller 被 abort（标准 8）。
- `kind` 变化 → 立即变 `null`，随后按新类型重报（标准 7）。

**验证** `pnpm exec vitest run src/client/useGenEstimate.test.tsx`

**提交** `feat(canvas): 估价 hook —— debounce 300ms + 取消旧请求,失败静默`

---

## T3 接进 `GenerateForm` + i18n

**改动**

- `src/components/canvas/GenerateForm.tsx`
  - 调 `useGenEstimate({ pid, kind, prompt, params, refSel, model: modelId })`。
  - 在提交 `IconButton` **之前**插一段 `shrink-0` 文本：
    ```tsx
    {estimate && (
      <span className="shrink-0 text-[12px] text-[var(--color-muted)]">
        {estimate.kind === 'exact'
          ? t('canvas.gen.estimateExact', { credits: estimate.credits })
          : t('canvas.gen.estimateRange', { min: estimate.min, max: estimate.max })}
      </span>
    )}
    ```
    数字用 `font-mono`（**不是** `font-[var(--font-mono)]` —— tailwind v4 会把它编译成非法
    `font-weight`，上一轮踩过并已修过一次）。
- i18n × 11：`canvas.gen.estimateExact` = `{{credits}} credits` / `estimateRange` = `{{min}}–{{max}} credits`
  （中文「{{credits}} 积分」；其余语言按既有风格）。

**测试** `src/components/canvas/GenerateForm.test.tsx` 追加

- 有报价 → 文本出现在 DOM 里，且**与提交按钮同一个 flex 行**（断言父容器，锁死决策 3）。
- 无报价（hook 返回 `null`）→ 该文本**不在** DOM 里（不渲染空壳，标准 6）。
- 区间形态 → 文案含 `–`。

**验证** `pnpm exec vitest run src/components/canvas/GenerateForm.test.tsx`

**提交** `feat(canvas): 生成表单显示报价(提交按钮左侧,报不出则整行不渲染)`

---

## T4 全量验证 + 真机验收

```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

真机按 spec 的 9 条成功标准跑（dev :3011 打 pgc dev，项目 1044）。**手法沿用上两轮的教训**：

- 用 **Playwright 真实鼠标/键盘**（`page.mouse` / `page.keyboard`），合成事件驱动不了很多交互；
- 装 `window.fetch` 探针**只统计估价那条**（`/generate/estimate`），用来验请求次数与取消；
- 拖拽/点选前先清选中态。

估价是**零副作用**端点（不落任务、不扣费），故本轮真机验收**不会在项目上留下任何写入**——
不需要基线还原（与前两轮不同，这点值得庆幸）。

---

## 风险与预案

- **`params` 进依赖数组要用稳定摘要**：`GenParamValues` 是每次渲染新建的对象，直接进依赖会
  每帧重触发。用 `JSON.stringify(params)`（键少、值都是标量，成本可忽略）。真机第一件事
  就看请求次数，若发现每帧一发就是这里漏了。
- **`refs` 变化也影响价**（图生图/参考图数量可能影响计价）：refs 的 id 列表进依赖摘要。
  若后端实测「refs 不影响价」，可以再收窄依赖（但先按影响处理，宁可多报一次）。
- **估价端点可能对某些参数组合 422**（如 fast 模型 + 1080p）：按决策 2 静默不显示即可，
  不必特判 —— 用户改回合法值后自然重报。
