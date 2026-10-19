# 实现计划：重发路径的两处修正

> 设计稿：`docs/superpowers/specs/2026-08-06-retry-lineage-and-no-discard.md`
> 分支：`feat/agent-provenance`（与 agent 溯源同一分支：两处 bug 都在同一机制上，且改的是同几个函数）

两个 bug 各自先写**复现测试**（铁律 1），确认红了再改。

---

## 任务 A · 血缘重建纯函数（TDD）

**改动**
- `src/lib/gen-retry.ts`（新）：`RetryLineage` + `retryLineage(asset, assets, prov?)`。
- 把上一轮内联在 `openRetryForm` 里的首帧判定搬进来（store 不该认识 koubou 字段名）。

**测试**（`src/lib/gen-retry.test.ts`）
1. 前端卡 + 图片父卡（ready）→ `sourceItemId` = 父卡 id
2. 前端卡 + **文本**父卡 → 带上（重现 `promptPrefix`）—— 与 agent 卡相反，这条是本轮的关键区分
3. 父卡不在 assets 里（已删）→ 不带，且不抛
4. 父卡 `status !== 'ready'`（占位卡 / 失败卡）→ 不带
5. agent 卡 + 文本父卡 → **不带**（prompt 已完整）
6. agent 卡 + 图片父卡 + `req.source_urls` 命中该父卡 → 带
7. agent 卡 + 图片父卡 + 只有 `ref_image_urls` / `last_frame_url` → 不带
8. `refIds` 过滤:仍存在且 ready 的保留，已删 / 生成中的剔除，全没了则不带该键
9. 无 provenance（`prov === undefined`）→ 按前端卡规则处理（失败卡刷新后无 prov 的降级路径不崩）

---

## 任务 B · `runRetry` 接血缘 + 成功卡不丢卡（TDD）

**改动**
- `actions.ts`:`runRetry(prov, topLeft: XY | undefined, lineage: RetryLineage)`，把 `sourceItemId` / `refItemIds` 并进 placement；`topLeft` 缺省则不传 `spawnAt`。
- `index.ts` `retryGeneration`:先算 `retryLineage`，`status === 'error'` 才 `discardFailedCard` 并传原位。
- `index.ts` `openRetryForm`:改用 `retryLineage`，删掉内联的首帧判定。

**测试**（`src/store/provenance.test.ts`，与既有重试测试同处）
1. **复现 Bug A**:图生图失败卡点重试 → `genImage` 的入参带 `source_item_id`（改前必红）
2. 多引用卡重试 → 新卡 `reference.ref_item_ids` 与原卡一致
3. 文本源卡重试 → 请求体 prompt 带回前缀，与原来那次 body **逐字节相同**
4. 源卡已删 → 不带 `source_item_id`，请求照发不抛
5. **复现 Bug B**:成功卡点再生成 → `deleteCanvasItem` **未被调用**、原卡仍在 assets（改前必红）
6. 成功卡再生成 → 不传 `spawnAt`（新卡走避让，不叠原卡）
7. 失败卡重试 → 行为不回退:原卡丢弃 + `deleteCanvasItem` 被调用 + 新占位卡落回原位
8. `openRetryForm` 对前端卡的文本父卡也带回 `sourceId`（上一轮丢的）

---

## 任务 C · 验证与回合

- 全量四道闸门（`lint` / `tsc` / `test` / `build`），输出与退出码贴进本文件。
- 派干净上下文子代理按 commit 范围评审，Critical / Important 修完才继续。
- 与 agent 溯源合成同一个 `--no-ff` 回合并回 dev（同一机制、同几个函数，拆两个 merge 反而割裂上下文），
  然后在合并结果上重跑全量。真机验收两轮的成功标准一起做。
