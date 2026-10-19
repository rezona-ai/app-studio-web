# 实现计划：agent 生成资产的创作溯源落库

> 设计稿：`docs/superpowers/specs/2026-08-06-agent-asset-provenance.md`
> 分支：`feat/agent-provenance`（worktree `.orca/worktrees/feat+agent-provenance`）

拆法：**纯逻辑先行、接线在后、UI 最后**。每个任务可独立跑测试、可独立评审，
提交后派干净上下文子代理按 commit 范围评审再继续。

---

## 任务 1 · 判别器与读侧归一（纯逻辑，TDD）

**改动**
- `store/types.ts`：`AssetProvenance` 加 `agent?: true`。
- `lib/agent-provenance.ts`（新）：`AGENT_MODEL_ALIAS`（四条，按 kind 分组）+ `provenanceReq(prov)`。
- `lib/gen-models.ts`：加 `modelLabel(kind, value)`。

**测试**（`lib/agent-provenance.test.ts` / `gen-models.test.ts`）
1. `agent` 缺省 → 返回**同一个** `req` 引用（恒等，不复制不加工）
2. 四条别名逐条翻译正确（image 两条、video 两条）
3. 未知别名 `some-new-alias` → 原样保留，不删键不置空（约束 5）
4. `req` 里没有 `model` 键（agent 未显式选模型）→ 不凭空造出 `model` 键
5. 3D 的 `model_version` 原样不动（无别名层）
6. audio 的 `req` 不含模型字段 → 不动
7. `modelLabel('image', 'gpt-image-2')` → `'GPT Image 2'`；`modelLabel('image', '未知')` → 原样

**边界**：本任务不碰任何组件与 store，跑 `pnpm exec vitest run src/lib/agent-provenance.test.ts src/lib/gen-models.test.ts`。

---

## 任务 2 · 落库往返不吃字段（映射层，TDD）

**改动**（`lib/pgc/map.ts`）
- `provenanceOf`：重建时带上 `agent`（仅 `=== true` 才带，脏值不采信）。
- `preserveFrontendOwned`：加 `if (!ref.provenance && local.provenance) next.provenance = local.provenance`。

**测试**（`lib/pgc/map.test.ts`）
1. `reference.provenance` 带 `agent: true` → 读回仍为 `true`（**这条是成功标准 8 的回归防线**）
2. `agent: 'yes'` / `agent: 1` 等脏值 → 读回**无** `agent` 键（不半信半疑）
3. 服务端 `reference` 无 provenance 而本地 Asset 有 → 整表替换后保留本地那份
4. 服务端 `reference` **有** provenance → 以服务端为准（本地旧值不得挡住新值，与既有口径一致）
5. 两边都无 → 仍为 `undefined`，不造空对象

**先写失败测试**：测试 1/3 在改动前必须红（当前 `provenanceOf` 逐字段重建会吃掉 `agent`，
`preserveFrontendOwned` 不含 provenance）。

---

## 任务 3 · 写侧提取（纯逻辑，TDD）

**改动**（`lib/agent-provenance.ts`）
```ts
export function agentProvenance(
  messages: readonly Message[], taskId: string, kind: AssetProvenance['kind'], at: string,
): AssetProvenance | undefined
```
按 `parseSubmittedTaskId(p.result) === taskId` 定位 tool part（与 `lineageForTask` **同一套定位**），
取 `p.input` 原样包成 `{ kind, req, at, agent: true }`。

**测试**
1. 命中 → `req` 与 `p.input` **深相等**（原样落库，约束 4）且 `agent === true`
2. `task_id` 对不上 → `undefined`（成功标准 9）
3. part 有 result 但 `input` 不是对象（`null` / 字符串）→ `undefined`，不造 `req: {}`
4. 多条 tool part 时只取 `task_id` 匹配那条（不取第一条 media part）
5. 消息里根本没有该 part（历史分页没加载到）→ `undefined`

**复用**：`gen-lineage.test.ts` 已有构造 tool part 的 fixture 套路，照抄不重造。

---

## 任务 4 · 两条落点接线（store，TDD）

**改动**（`store/actions.ts`）
- `importGeneratedAsset`：算血缘那处同时算 provenance；写进 `reference.provenance`，并挂到 `set` 的 Asset 上。
- `registerAgentGenTask`：同一处算，挂到**占位卡**上。
- `adoptAgentItem`：`lineage` 那个「前端所有字段」对象携带 `provenance`；
  **回写条件由 `if (lineage.parentId)` 放宽到「有 parentId 或有 provenance」**。

**测试**（`store/actions.test.ts`）
1. 同步导入：`writeCanvasItemFromUrl` 的入参 `reference.provenance.req` 深等于工具入参，`agent === true`
2. 同步导入无 `taskId` → 请求体**不含** `provenance` 键（不发 `undefined`）
3. 异步：占位卡带上 provenance；`adoptAgentItem` 后真实卡仍带（服务端那份没有，不得被 `undefined` 冲掉）
4. **纯文生 agent video**（无血缘、有 provenance）→ 仍打出一次 `batchUpdateCanvasItems` 回写
   （这条钉死放宽后的条件；改动前必须红）
5. `await` 后切项目 → 不写（沿用既有 pid 校验，回归防线）

---

## 任务 5 · 面板展示（UI，TDD）

**改动**（`components/canvas/AssetInspector.tsx`）
- `parseGenPrefill(prov.kind, provenanceReq(prov))`
- 模型那格改 `modelLabel(prov.kind, parsed.model)`

**测试**（`AssetInspector.test.tsx`）
1. agent 卡（`agent: true`，`model: 'gemini-flash-image'`）→ 面板显示 `Gemini 3.1 Flash Image`
2. 前端卡（`model: 'gpt-image-2'`）→ 显示 `GPT Image 2`（**成功标准 3 的既有缺失修复**，改动前红）
3. 未知别名 → 原样显示该字符串
4. agent 卡的提示词段渲染且可复制（现在整段不渲染，改动前红）

---

## 任务 6 · 再生成走预填表单（store + UI，TDD）

**改动**（`store/index.ts`）
- `retryGeneration`：`asset.provenance?.agent` → 转 `openRetryForm(assetId)` 后返回
- `openRetryForm`：`prefill: provenanceReq(prov)`；父卡存在且 `kind === 'image'` 时带 `sourceId: parentId`

**测试**（`store/index.test.ts` 或既有 store 测试文件）
1. agent 卡点再生成 → `genForm` 被打开且带 prefill，**不**调 `discardFailedCard`、**不**发生成请求
2. 前端卡点再生成 → 仍走 `runRetry` 直接重发（**不回退**，成功标准 5 后半句）
3. `openRetryForm` 的 prefill 是**归一后**的口径（agent 卡的 model 已翻译）
4. 父卡是 image → `genForm.sourceId === parentId`；父卡是 text / 无父卡 → 不带 `sourceId`

---

## 任务 7 · 全量验证 + 真机验收

**全量**：`pnpm lint` → `pnpm exec tsc --noEmit` → `pnpm test` → `pnpm build`，四条命令的完整输出与退出码贴进本文件。

**真机**（dev :3011 打 pgc dev，`DEV_COOKIE` 已配）——按成功标准逐条：
1. 让 agent 生成一张图 → 卡落画布 → 面板显示提示词 / 模型名 / 参数
2. **刷新页面** → 面板仍显示（这条是本轮的核心价值，必须真刷）
3. agent 生成一个 3D（异步路径）→ 产物 adopt 后面板有 provenance，刷新后仍在
4. 点「以相同参数再生成」→ 打开的是**预填表单**，prompt / 模型已填好，未点生成前不产生任何生成请求
5. 前端自己生成一张图 → 面板模型那格显示 label 而非裸 id
6. agent 图生图的卡 → 预填表单的引用格带回源卡

**已知会验不到的**：`transparent`（本轮不接，面板必然不显示它）——如实记录，不假装通过。

---

## 提交与回合

每个任务一个提交（`feat:` / `fix:` / `test:` 前缀 + 中文一句话），任务 1-6 各自派子代理评审；
任务 7 完成后终审全分支，再 `--no-ff` merge 回 dev、在合并结果上重跑全量。
worktree / 分支删除等清理动作**先问 Nick**。
