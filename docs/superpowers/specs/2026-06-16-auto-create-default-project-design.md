# 无项目时自动建默认项目 —— 设计稿

日期:2026-06-16

## 背景与根因

「最新代码登录后不发起 ws-ticket、问答不可用」的根因不在登录 gate,而在**无项目**:

- ws-ticket 由 `useKoubouConnection` 内 `createKoubouClient` 一创建即 `mintTicket()` 发起;而该 hook 开头 `if (currentProjectId == null) return;` 硬门控,只有 `currentProjectId` 非空才会建连。
- `currentProjectId` 的 boot 落地唯一路径是 `loadProjects → selectProject`。`loadProjects` 拉到**空列表**时 `pick == null` → 置 `currentProjectId: null` → WS 永不建连 → ws-ticket 永不发起 → Composer 的 `client.current` 为 null,发送是 no-op,工作台死掉。
- 落地页 PromptBox 的「Generate my game」只把点子写进 `composer.draft` 并 `router.push('/studio')`,**不建项目**;新用户(零项目)落到 /studio 即死工作台。
- 现存唯一建项目入口是 `ProjectMenu → CreateGameModal`,零项目用户无从被引导过去。

## 目标

确立不变式:**平台恒有 ≥1 个项目**。无项目时静默自动建一个默认项目,使 `currentProjectId` 落地 → WS 连上 → ws-ticket 发起 → 工作台可用。落地页带来的 `composer.draft` 原样保留在 Composer,由用户手动发送(不自动发送)。

## 方案:静默自动建默认项目

复用既有 `createProject` action(`pgcApi.createProject` → 入项目列表 → `selectProject` 置 `currentProjectId` + `syncProjectToUrl` + 拉画布/版本)。改动集中在 `src/store/actions.ts`。

### 改动点

1. 新增常量 `DEFAULT_PROJECT_NAME = 'Untitled game'`。

2. **boot 路径** —— `loadProjects` 的 `else if (pick == null)` 分支:
   把 `set({ currentProjectId: null })` 换成 `await createProject(DEFAULT_PROJECT_NAME)`。
   建完后 `currentProjectId` 为新 id,`pick` 仍为 null,故尾部 `if (get().currentProjectId !== pick) return` 触发,跳过 `syncProjectToUrl(null)`(URL 已由 `createProject` 内 `selectProject` 同步为新 id),正确。

3. **删光路径** —— `deleteProject` 删掉当前且无下一个(`next == null`)的 `else` 分支(现为手动重置 `currentProjectId: null, assets: [] …` + `syncProjectToUrl(null)`):
   整体换成 `await createProject(DEFAULT_PROJECT_NAME)`。此时 `get().projects` 已是删除后的 `rest`(空),`createProject` 会建出 `[p]` 并经 `selectProject` 完成 `currentProjectId` / URL / 画布 / 版本的落地与重置,旧的手动重置被完全覆盖。

### 并发幂等(关键风险)

`loadProjects` 的唯一调用方 `useProjectBootstrap` 的 effect 在 React StrictMode 下双触发 → 两个 `loadProjects` 并发。

当前代码对并发天然幂等(两次 `set({ projects: data.items })` 同值无害);但一旦引入「建项目」这个会改 `projects` 的副作用,**第二个并发调用的 `set({ projects: data.items })`(空)会回灌覆盖第一个刚建出的项目,并可能建出两个项目**。

对策:在 `createServerActions` 闭包内加瞬态在途标志 `let loadingProjects = false`(纯控制态,不入 store、不持久化),在 `loadProjects` 最外层做**重入护卫**:已在途则直接 return。检查—置位之间无 `await`,原子;并发的第二个调用被挡掉。`finally` 复位以保证后续顺序调用仍可工作。匹配 CLAUDE.md「多道幂等去重 / StrictMode 重复挂载 ≠ 项目切换」既有范式。

> 删光路径由用户手动触发、无双触发问题,不需此护卫。

### 防空态闪屏

`createProject` 在 `loadProjects` 的 `try` 内被 `await`,`booting=false` 仍落在 `finally` —— 全局加载层覆盖整个「建项目 + 拉画布/版本」过程,不闪出空工作台。WS 建连一如既往在 `currentProjectId` 变化后由 effect 异步触发(与现状一致,加载层只盖画布/版本首拉)。

## 错误处理

`createProject` 自带 `guard`:若建项目失败(如 401),`guard` 写 `lastError`、401 置 `authRequired`,`currentProjectId` 仍为 null。`loadProjects` 的 `finally` 照常撤加载层,随后由 `useAuthGuard` 跳登录(生产)或清标志 + Toast(本地)。即鉴权失败回落到既有 gate,不退化。

## 不做(YAGNI)

- 不从 `composer.draft` 派生项目名(默认名即可,用户/agent 可后续改名)。
- 不自动发送首条消息(草稿保留,用户手动发送)。
- 不改落地页「Generate my game」的建项目时机。

## 测试(TDD,`src/store/actions.test.ts` 同目录)

- `loadProjects` 拉到空列表 → 以 `DEFAULT_PROJECT_NAME` 建项目、`currentProjectId` 落地、拉了画布。
- 并发两次 `loadProjects`(空列表)→ `createProject` 只调一次、只建一个项目(重入护卫生效)。
- `loadProjects` 拉到非空列表 → 不触发自动建(回归保护)。
- `deleteProject` 删掉最后一个项目 → 自动以 `DEFAULT_PROJECT_NAME` 建项目,`currentProjectId` 落地非 null。
