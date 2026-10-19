# 实现计划：画布多选批量操作

> 设计稿：`docs/superpowers/specs/2026-08-04-canvas-bulk-actions.md`
> 分支：`feat/canvas-bulk-actions`

先纯逻辑（零风险、可单测），再逐个能力接线，菜单最后一次性挂上。每步系统保持可运行、每任务一次提交。

---

## T1 选区能力判定与文件名去重（纯逻辑）

**改动**
- 新建 `src/lib/bulk-actions.ts`
  - `bulkMentionable / bulkDownloadable / bulkRetryable(assets) → { total, usable }`，各自复用既有单资产判定（`canMention` / `canDownloadAsset` / `status === 'error'`）。
  - `dedupeFileNames(names) → string[]` —— 画布允许重名、zip 内不允许；同名追加 `-2` / `-3`，**扩展名前插**（`a.png` → `a-2.png`，不是 `a.png-2`）。

**测试** 新建 `src/lib/bulk-actions.test.ts`
- 三个能力判定：全可用 / 部分可用 / 全不可用各一例。
- `dedupeFileNames`：无重名原样返回；两重名 → 第二个加 `-2`；三重名 → `-2` / `-3`；后缀插在扩展名前；无扩展名的也能加。
- 边界：空选区 → `{ total: 0, usable: 0 }`（菜单据此置灰，不能崩）。

**验证**
```bash
pnpm exec vitest run src/lib/bulk-actions.test.ts
```

---

## T2 批量 @ 引用

**改动**
- `src/store/index.ts` —— 新增 `addRefs(keys: string[])`：**一次 set** 内折叠计算 N 个 mention 后落库。
  ⚠️ 不要循环调 `addRef` —— 每次一轮 set + 重渲，N 张就是 N 次。

**测试** 新建 `src/store/bulk-actions.test.ts`
- 空草稿插 3 个 → 三个 mention 依次出现，格式与单个 `addRef` 一致。
- 已有草稿文字后追加，不吞原文。
- 只触发**一次** store 变更（订阅计数断言）—— 这是本任务的核心价值。
- 空数组 → no-op，不产生多余空格。

**验证**
```bash
pnpm exec vitest run src/store/bulk-actions.test.ts src/lib/refs.test.ts
```

---

## T3 批量下载（流式 zip）

**改动**
- `package.json` —— 新增 `client-zip` 依赖。
- `src/lib/download.ts` —— 新增 `downloadAssetsZip(assets, zipName) → { ok, skipped }`
  - 喂 `client-zip` 一个**惰性 async iterable**：逐个 `fetch(assetProxyUrl(src))`，把 **Response 本身**交给它（读 body 流，不缓冲）。
  - text 卡无 URL → `Blob` 直接入包。
  - 单个失败跳过、不中断整包，计入 `skipped`。
  - 文件名经 `assetFileName` + `dedupeFileNames`。

**测试** `src/lib/download.test.ts` 追加（mock `client-zip` 与 `fetch`）
- 三个资产 → `downloadZip` 收到三条，文件名去重后一致。
- 其中一个 fetch 失败 → 其余照常入包，`skipped === 1`。
- text 卡走 Blob 分支。
- **断言传给 client-zip 的是 Response 而非已读出的 ArrayBuffer** —— 流式是本任务的硬要求，退化成缓冲就失去意义。

**验证**
```bash
pnpm exec vitest run src/lib/download.test.ts
```

---

## T4 菜单接线与 Toast

**改动**
- `src/components/canvas/ContextMenu.tsx` —— 多选分支扩到四项（@ 引用 / 下载 / 重试 / 删除）；「批量重试」仅 `bulkRetryable().usable > 0` 时出现；部分可用仍可点，全不可用才 `disabled`。
- 各操作结束发 Toast：`已处理 N 个`（有跳过补 `，跳过 M 个`），走既有 `setSuccess`。
- i18n × 11 —— `canvas.context.bulk*` 若干键 + 结果文案（**带 count 插值，`resolveErrorMessage` 不支持插值，故这条 Toast 的文案在组件里本地化后传入**，沿用 `UPLOAD` 那条既有先例）。

**测试** `src/components/canvas/ContextMenu.test.tsx` 追加
- 多选时四项都在；选区无失败卡时「批量重试」不出现。
- 点批量 @ 引用 → `addRefs` 收到可引用的那些 key（跳过不可引用的）。
- 点批量下载 → 调 `downloadAssetsZip`，结束发 Toast 且文案含处理数与跳过数。
- 全不可用时该项 `disabled`；部分可用时**不** disabled（约束 2 的防线）。
- 单选四项行为不变（回归）。

**验证**
```bash
pnpm exec vitest run src/components/canvas/ContextMenu.test.tsx
```

---

## T5 全量验证与真机验收

- `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build`。
- 真机走成功标准 1–8，重点两条**只有真机能验**的：
  1. 批量下载真的落一个 zip、内容完整、**大文件不撑爆内存**（选几个视频/GLB，看 DevTools 内存曲线是否平稳 —— 这是选 client-zip 的全部理由）
  2. 批量 @ 引用后 composer 草稿格式正确、能正常发出
- **不需要真实生成**，用既有项目现成资产即可，不消耗积分。
- 验收后删 `.env` 副本、停 dev。

**验证**
```bash
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

---

## 提交约定

- 每任务一次提交，英文类型前缀 + 中文一句话总结。
- 本计划与 spec 先以 `docs:` 提交，随后 `feat:` 与之成对。
- 全部完成后提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。
