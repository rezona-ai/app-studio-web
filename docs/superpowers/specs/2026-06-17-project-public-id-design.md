# 项目标识：URL/展示用 public_id，内部接口用数值 id

日期：2026-06-17（2026-06-17 修订）
分支：`fix/project-id-display-only`

> **修订说明**：本稿原方案为「前端项目身份**全量**切 public_id（含 store / 所有 PGC·Koubou 调用 / 持久化 key）」，已实现并合入 main（`45b49c1`）。经复核该范围过宽——**只有前端展示面应暴露 public_id，内部接口交互仍用数值 `id`**。本稿据此收窄：保留展示层 public_id，内部回退数值 id，中间加一层 id↔public_id 解析。

## 背景与目标

`public_id` 是后端对外的不可枚举标识（Sqids 编码，纯字母如 `DakkYXUy`），用于**不暴露明文主键**的场合：正式域名 URL、分享/预览链。数值 `id` 是内部主键，用于一切接口寻址与本地存储。

目标：

- **展示面用 public_id**：浏览器地址栏 `?project=<public_id>`、landing 的 Remix 链。
- **内部用数值 id**：store `currentProjectId`、所有 PGC REST、Koubou WS/会话、持久化映射 key。
- 两者之间在**进入（读 URL）**和**写回（改 URL）**两个点上做 id↔public_id 解析。

## 后端契约（apifox `pgc` 项目，已确认）

- `ProjectData` / `ProjectListItemData` 含 `public_id: string`（必填）与 `id: number`——解析层据此双向映射。
- 所有 `{project_id}` 端点接受 public_id 或 legacy int（但本设计内部一律传**数值 id**，不依赖该宽容）。
- Koubou 会话/WS 的 `project_id` 传**数值 id 的字符串形式**（内部接口）。

## 核心决策

**展示 public_id、内部数值 id、边界解析**。数据流：

```
URL ?project=<public_id>  ──读──▶ 解析为数值 id ──▶ store.currentProjectId: number
                                                         │
                          所有 PGC/Koubou 调用、持久化 key 用数值 id
                                                         │
store.currentProjectId ──写──▶ 由 id 映回 public_id ──▶ 写回 URL ?project=<public_id>
```

解析依据 `get().projects`（列表项含 `id` 与 `public_id`）。

## URL 契约（`src/lib/project-url.ts`，保持现状不改）

该文件已是「URL token = 字符串」形状，恰好承载 public_id 展示层，**无需改动**：

- `readProjectIdFromSearch(search): string | null`：返回 `?project=` 原始 token（public_id；亦容旧数值链作 opaque token），校验 `/^[A-Za-z0-9]+$/`。**注意**：返回的是 URL token，不是数值 id，解析为数值 id 的职责在 store 层。
- `withProjectParam(search, publicId: string | null)` / `syncProjectToUrl(publicId: string | null)`：写入 public_id 字符串。

## 解析层（`src/store/actions.ts`）

**读（loadProjects 选定）**：
```ts
const token = readProjectIdFromSearch(window.location.search);        // public_id 或旧数值链
const fromUrlId = token == null ? null
  : (data.items.find((p) => p.public_id === token || String(p.id) === token)?.id ?? null);  // → 数值 id
const cur = get().currentProjectId;                                   // number | null
const stillThere = cur != null && data.items.some((p) => p.id === cur);
const pick = fromUrlId ?? (stillThere ? cur! : (data.items[0]?.id ?? null));  // number | null
```

**写（URL 写回，由数值 id 映回 public_id）**：
- `selectProject(id: number)` 末尾：`syncProjectToUrl(get().projects.find((p) => p.id === id)?.public_id ?? null)`。
- `loadProjects` 末尾（pick===cur 未走 selectProject 的纠正路径）：同样由 pick 映回 public_id 再 `syncProjectToUrl`。

## 逐文件改动（相对当前 main 的 public_id 全量态回退）

| 文件 | 改动 |
|---|---|
| `src/lib/pgc/types.ts` | 不变（保留 `public_id` / `cover_source`，解析层要用） |
| `src/lib/project-url.ts` | 不变（URL token 字符串层，承载 public_id） |
| `src/lib/pgc/client.ts` | 所有项目方法形参 `string → number` 回退 |
| `src/store/types.ts` | `currentProjectId: string → number` 回退 |
| `src/store/index.ts` | `setCurrentProject`/`switchProjectSession` 形参 `string → number` 回退 |
| `src/store/actions.ts` | 内部 helper 与 `selectProject`/`renameProject`/`deleteProject` 形参 `string → number` 回退；`loadProjects` 改为「读 URL token→解析数值 id」；`selectProject`/`loadProjects` 写回处「数值 id→public_id」再 `syncProjectToUrl`；`renameProject`/`deleteProject` 用 `p.id` 匹配；`createProject` 用 `selectProject(p.id)` |
| `src/client/useKoubouConnection.ts` | `projectId: pid` → `projectId: String(pid)`（数值 id 字符串化传 WS） |
| `src/client/useCanvasAutoImport.ts` | `lastPidRef` `string → number` 回退 |
| `src/components/chat/ProjectMenu.tsx` | props/state/身份比较 `public_id → id` 回退（数值 id 作内部标识） |
| `src/components/chat/ChatPanel.tsx` | `p.public_id === currentProjectId` → `p.id === currentProjectId` 回退 |
| `src/components/landing/games.ts` | 不变（`id` 即 public_id，展示链用） |
| `src/components/landing/LandingPage.tsx` | 不变（注释 remix 用 `g.id`=public_id，展示链） |

## 测试

- `src/lib/project-url.test.ts`：不变（仍测 URL public_id 字符串 token 解析）。
- `src/store/actions.test.ts`：项目相关用例回退为数值 id（mock 保留 `public_id` 供解析）；URL 用例：`?project=<public_id>` 解析为数值 id；旧数值链 `?project=8` 解析为对应 id；写回 URL 为 public_id（断言 `?project=p8` 等）。
- `src/components/chat/ProjectMenu.test.tsx`、`useCanvasAutoImport.test.tsx`、`koubou-seed.test.ts`、`history-pagination.test.ts`、`pgc/client.test.ts`：项目标识回退数值 id。
- 收口：`pnpm exec tsc --noEmit` + `pnpm test` + `pnpm lint` 全绿。

## 边界 / 迁移

- 持久化的 `currentProjectId`：上一版（全量 public_id）落盘的是字符串 public_id；本版期望数值 → 不命中 `p.id === cur` 时优雅回退到 URL/列表首个。上一版未上线，影响仅本地缓存，一次性。
- 持久化映射 key（`koubouByProject`/`genTasksByProject`/`importedByProject`）回到数值 id 字符串；旧 public_id key 残留为孤儿（缓存，按项目重建，无害）。

## 非目标 / YAGNI

- 不恢复 landing Remix（后端就绪后独立处理）。
- 不在 UI 文案里展示任何项目 id（展示面只有 URL 与 landing 链）。
- 不改 Koubou 协议或会话存储语义。
