# 页签与项目绑定（URL 参数持久化）设计稿

日期：2026-06-12

## 背景与问题

当前 `currentProjectId` 经 zustand `persist` 落在共享的 localStorage（key `taluna-v4`）。多个页签打开不同项目时，最后一次切换会覆盖该值；刷新任意页签都会跳到「全局最近打开」的项目，而不是该页签自己的项目。

## 目标

- 每个页签的「当前项目」与页签自身绑定，刷新后还原本页签的项目。
- 新开页签（无绑定信息）沿用现状：打开最近使用的项目。
- 附带收益：URL 可复制/收藏，直接打开指定项目。

## 决策

- **绑定载体：URL 查询参数 `?project=<id>`**（非 sessionStorage、非动态路由）。只动 query 不动 pathname，用 `history.replaceState` 写回，不引入路由跳转，天然兼容部署时的 basePath（`/game`）。
- **无参数回退：localStorage 持久化的 `currentProjectId`**（最近使用），其次项目列表第一个。`persist` 配置不变。

## 设计

### 1. 纯函数模块 `src/lib/project-url.ts`（同目录单测）

- `readProjectIdFromSearch(search: string): number | null` — 解析 `?project=123`；非正整数等非法值返回 `null`。
- `withProjectParam(search: string, id: number | null): string` — 返回更新（或 `id` 为 `null` 时移除）`project` 参数后的 search 串，纯函数。
- `syncProjectToUrl(id: number | null): void` — 薄副作用包装：浏览器环境下基于当前 `location` 调 `history.replaceState` 写回；非浏览器环境 no-op。

### 2. `loadProjects`（`src/store/actions.ts`）选定优先级

```
URL ?project（且存在于项目列表） > 持久化的 currentProjectId（且仍存在） > 列表第一个 > null
```

选定后无论来源，调 `syncProjectToUrl(pick)` 把结果写回本页签 URL——URL 中非法或已删除的项目 id 由此被纠正。

### 3. 项目变更时同步 URL

- `selectProject` 内部在切换落定后 `syncProjectToUrl(id)`（`createProject` 复用此路径）。
- `deleteProject` 删除当前项目后的回退分支同样同步 URL；项目清空时移除参数。

### 4. 不变的部分

- localStorage 仍持久化 `currentProjectId`（作为新页签回退）。
- `koubouByProject` / `genTasksByProject` / `importedByProject` 等按项目持久化的数据不受影响。
- 不新增路由，不改 `layout.tsx` 防白闪脚本。

## 行为效果

| 场景 | 结果 |
|---|---|
| 页签 A 开项目 1，页签 B 切到项目 2，刷新 A | A 仍还原项目 1（URL `?project=1`） |
| 新开页签（无参数） | 打开最近使用的项目，并立刻把该 id 写入本页签 URL |
| URL 指向已删除/非法项目 | 回退到最近使用或首个项目，并纠正 URL |
| 复制带 `?project=` 的链接打开 | 直接进入该项目 |

## 测试

- `project-url.test.ts`：解析合法/非法/缺失参数；`withProjectParam` 的更新/移除/保留其他参数。
- `actions` 现有测试补充：URL 参数优先于持久化值；URL 项目不存在时回退；选定后写回 URL（注入或 mock 副作用）。
