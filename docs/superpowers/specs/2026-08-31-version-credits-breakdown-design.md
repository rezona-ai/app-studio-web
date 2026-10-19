# 版本消耗积分：从内联字段预埋切到独立拆分端点

日期：2026-08-31 · 分支 `feat/version-credits-breakdown`

## 目的

版本时间线上「该版本消耗积分」的 UI 与映射在 2026-07-28 已按**后端契约提案**预埋（`VersionData.credits_spent` 内联字段），但后端最终没走内联，而是新开了独立端点：

```
GET /game/pgcserver/api/projects/{project_id}/versions/credits
```

本需求把这条链路接通：删掉永远不会到来的内联字段预埋，改由该端点驱动同一处 UI。

## 后端契约（Apifox 508851771，已 released）

```
data: {
  items: VersionCreditsSegment[],
  notes: string[],
}

VersionCreditsSegment {
  version_id: string | null      // null = 末段「在途」（尚未构建成下一版）
  from: string | null            // 区段起（闭开区间 (from, to]）
  to: string | null              // 该版本定稿时刻（dist/index.html 对象时间）；在途段为 null
  asset_credits: int             // 资产生成消费（默认 0）
  llm_credits: int | null        // koubou 对话 LLM 消费
  total_credits: int | null      // asset + llm
  by_type: Record<string, int>   // 资产消费按类型细分
}
```

关键口径（照抄文档，前端不得自行推导）：

- 区段按**时间切段归因**，边界是各已 build 稳定版本 `v{n}` 的定稿时刻；末段为「在途」。
- `llm_credits` / `total_credits` 在下列情况**一律为 null（后端不编数）**，`notes` 说明是哪一种：计费未启用 / PAT 凭据调用；上游取数失败或流水缺归因维度；流水拉不完（超 100×30 条或超 5s 预算）；**该账号动用过首创免费额度**（促销消费不进真实钱包流水）。
- `project_id` 接受 public_id 或 legacy int；项目不存在 404、非属主 403。

## 决策（盘问结论）

| 决策 | 结论 | 为什么 |
|---|---|---|
| 显示哪个数 | **只显示 `total_credits`**；为 null 整块不渲染 | 口径唯一。回落 `asset_credits` 会让同一位置在两种口径间静默切换，用户把「不含对话」的数字当成全量花费——比没有数字更坏。null 不渲染与既有 UI 的 `creditsSpent === undefined` 语义天然吻合 |
| 在途段 | **丢弃**（`version_id === null` 不入 state） | 时间线只表达已建版本；「在途」既可能没有对应行，也与「正在构建的那一版」不等价，硬挂会造出一个语义模糊的数字 |
| 拉取时机 | **ready 版本 id 集合变化时**拉一次 | 后端口径是「定稿时刻切段」，段只在新版本定稿时变。`pollVersions` 构建期每 2.5s 调一次 `loadVersions`，无脑搭车等于每 2.5s 一个请求 |
| 内联预埋 | **删**（`VersionData.credits_spent` + `versionToVersion` 映射 + 两个单测） | 后端已定走端点，内联字段永不会来，留着是 dead code（反模式「堆叠废弃机制」）。`Version.creditsSpent` 字段与 UI **保留**，只换数据来源 |
| `by_type` / `notes` | 不进 UI（非目标） | `total` 为 null 时整块不渲染，`notes` 无处落地；明细面板是另一件事 |

## 实现设计

### 1) 协议层（`src/lib/pgc/types.ts`）

新增（`VersionData.credits_spent` 同时删除）：

```ts
export interface VersionCreditsSegment {
  version_id: string | null;
  from?: string | null;
  to?: string | null;
  asset_credits?: number;
  llm_credits?: number | null;
  total_credits?: number | null;
  by_type?: Record<string, number>;
}
export interface VersionCreditsData { items: VersionCreditsSegment[]; notes: string[]; }
```

### 2) client（`src/lib/pgc/client.ts`）

```ts
getVersionCredits: (pid: number) => pgc<VersionCreditsData>('GET', `/api/projects/${pid}/versions/credits`),
```

默认超时档（只读聚合，上游自带 5s 墙钟预算，不需要 SLOW 档）。

### 3) 纯函数（`src/lib/pgc/map.ts`）

```ts
// 段 → { [version_id]: total_credits }：只收 version_id 非空且 total_credits 为数字的段。
// 在途段丢弃；total_credits 为 null（后端不编数）的段丢弃 —— 不回落 asset_credits。
export function versionCreditsMap(items: VersionCreditsSegment[]): Record<string, number>
```

同一 `version_id` 重复出现时后者覆盖前者（契约上不会重复，取后者即取更新的段，不额外造错误分支）。

### 4) store（`src/store/actions.ts`）

新增 action `loadVersionCredits()`，落 `ServerState.versionCreditsById: Record<string, number>`：

- **积分不挂在 `Version` 行上，独立成一张 map**（实现期修正，见下「评审处置」C1）：`loadVersions` 每次都用后端新对象整体替换 `versions`，挂在行上的数字会被每一次「不出新版本的刷新」静默擦掉。map 独立后 `loadVersions` 冲不掉它，落库也天然是全量覆盖，不需要「未命中清 undefined」的解构体操。
- 切项目在 `selectProject` 与 `versions` **同一次 `set`** 内清空（`version_id` 是项目内序号，跨项目必然撞 id）。
- `pid` 快照 + `await` 后 `if (get().currentProjectId !== pid) return;`（既有不变式）。
- 本地模式（`NEXT_PUBLIC_KOUBOU_BASE_URL`）直接 return：本地 koubou 快照没有 credits 概念。
- 失败**静默**（不弹 Toast）：这是装饰性信息，为它弹错会打断主流程。与 `refreshBalance` 同处置。
- **不设在途守卫**（实现期修正，见 I1）：触发是一次性事件（某版本定稿），在飞时吞掉后来者等于永久丢失那次刷新；落库幂等全量覆盖，晚到者覆盖早到者无害。

触发点在 `loadVersions` 内，落库那次 `set` 之后：

```ts
const readyKey = (vs: Version[]) => vs.filter(v => v.status === 'ready').map(v => v.id).sort().join(',');
// 首载（prev 为空）或 ready 集合发生变化 → 拉一次；构建轮询的空转不触发
if (readyKey(prev) !== readyKey(versions)) void loadVersionCredits();
```

`prev` 为空而新列表也为空时两边同为 `''`，不发请求（空项目不打无谓请求）。

### 5) UI（`src/components/preview/VersionTimeline.tsx`）

只换取数来源：`const spent = creditsById[v.id]`（订阅 `versionCreditsById`），判据由 `v.creditsSpent !== undefined` 变为 `spent !== undefined`。品牌橙闪电 + `formatCredit` / `formatCreditExact`、`preview.versionSpend` 文案全部沿用，视觉零改动。

## 影响面

| 文件 | 改动 |
|---|---|
| `src/lib/pgc/types.ts` | 加 `VersionCreditsSegment` / `VersionCreditsData`；删 `VersionData.credits_spent` |
| `src/lib/pgc/client.ts` | 加 `getVersionCredits` |
| `src/lib/pgc/map.ts` | 加 `versionCreditsMap`；`versionToVersion` 删 `credits_spent` 映射 |
| `src/lib/pgc/map.test.ts` | 删两个内联映射用例，加 `versionCreditsMap` 用例 |
| `src/store/actions.ts` | 加 `loadVersionCredits`；`loadVersions` 接触发判据 |
| `src/store/index.ts` | `ServerActions` 导出 `loadVersionCredits` |
| `src/store/types.ts` | 删 `Version.creditsSpent`，`ServerState` 加 `versionCreditsById` |
| `src/components/preview/VersionTimeline.tsx` | 改读 `versionCreditsById` |

## 成功标准

1. 项目有 2 个 ready 版本、端点给出对应段且 `total_credits` 为数字 → 两行各显示自己的数字，精确值在 `title`。
2. `total_credits` 为 null（任一不编数情形）→ 该行整块不渲染，且**不**显示 `asset_credits`。
3. 在途段（`version_id: null`）→ 不产生任何渲染。
4. 构建中的版本轮询 10 轮（ready 集合不变）→ `getVersionCredits` 只在最初被调 1 次；新版本变 ready 后再调 1 次。
5. 端点 4xx/5xx/超时 → 时间线照常渲染、无 Toast、无 `lastError`。
6. `await` 期间切项目 → 不把上一项目的数字写进新项目的 `versions`。

## 非目标

- `by_type` 明细 / `notes` 文案展示。
- 在途消费展示。
- 项目级消费汇总页、积分流水页。
- `total_credits` 为 null 时的任何回落估算。

## 评审处置（2026-08-31，干净上下文子代理，基于 commit 范围 fe2a790b..ecb013cd）

| 档 | 结论 | 处置 |
|---|---|---|
| Critical C1 | 积分挂在 `Version` 行上 ⟹ 任何「ready 集合不变」的 `loadVersions`（构建轮询、`run.finished`、断线回填、回放收尾）都把数字静默擦掉，而拉取判据恰好保证那时不重拉。最难看的是一次不产出版本的 agent run：所有行数字集体消失 | **采纳**（已自写复现测试确认）。改为独立 map `versionCreditsById`，`loadVersions` 从此冲不掉它；顺带消掉「未命中清 undefined」的解构与整列重建（原 M3） |
| Important I1 | 在途守卫无 pid、无排队，后来者直接丢弃 ⟹ v2 在飞期间 v3 定稿、或旧项目在飞挡住新项目，那次刷新永久丢失 | **采纳**。去掉守卫（触发是一次性事件而非轮询；落库幂等全量覆盖）。补两条用例：在飞期间新版本定稿仍刷、旧项目在飞不拦新项目 |
| Important I2 | 竞态用例切项目后把 `versions` 置空，map 作用在空数组上 ⟹ 删掉 pid 校验也全绿 | **采纳**。改为新项目持同名 id `v1`。变异验证：删掉 pid 校验该用例即红 |
| Minor M1 | `map.ts` 的溯源注释援引已删的 `credits_spent` 作先例 | 采纳，改注释并注明该先例已退役 |
| Minor M2 | 后端「上游取数失败 / 流水拉不完」是**瞬时**不编数，前端拿到一次 null 后要等下一版本 ready 才重拉 | 记为**已知取舍**：与请求失败同等处置（静默、下次版本变化再试）。要改得加退避重试，另开需求 |
| Minor M3 | 无变化也重建全部 version 对象 | 随 C1 的独立 map 方案自然消失 |
| Minor M4 | 本地模式判据在函数内而非触发点 | 不改：`loadVersionCredits` 是公开 action，判据留在函数内才对每个调用点都成立 |
