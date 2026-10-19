# 外部页 Remix 跳转(进入即 fork)设计稿

> 日期:2026-06-24 · 状态:已与用户确认设计,待 spec 评审
> 关联:`2026-06-19-landing-remix-design.md`(已落地的 `createRemix` 与 Landing 卡内 Remix)、`2026-06-23-studio-prelude-design.md`(外部页带参进工作台的分层范式)。

## 背景与目标

Remix 不再只在本应用 Landing 页(`/`)的游戏卡上触发。**外部页面(host 主站)现在也支持 Remix 跳转**:外部页携带「待 remix 的 project public_id」跳进工作台 `/studio`,进入后工作台**自动 fork** 该项目成一份属于当前登录用户的新可编辑项目,并加载到这份 fork 上。

当前 `/studio` 的 bootstrap(`useProjectBootstrap`)已是「二选一」:URL 带 prelude 参数(`model/prompt/assets`)则新建项目预填,否则 `loadProjects` 复用最近项目。本设计**新增第三条分支**:URL 带 `?remix=<public_id>` 时进入即 fork。

**纯新增,不改 Landing**:Landing 页卡内 Remix 按钮与逻辑(`LandingPage.tsx` 的 `createRemix` → 新标签 `?project=`)保持现状不动;两条路径共用同一个 `pgcApi.createRemix`。

### 已确认的产品决策

| 决策点 | 选择 | 含义 |
|---|---|---|
| 进入方式 | **整页跳转 / 新标签,URL 携带参数** | 与 studio-prelude 同范式;外部页负责拼 `pagePath('/studio') + '?remix=<public_id>'`。我方只读 `location.search`。 |
| 携带标识 | **`?remix=<public_id>`** | 值是 public_id / play code(如 `DakkYXUy`),与全站「URL 只暴露 public_id、不暴露数值主键」一致,**直接作 `createRemix` 的 `source_code`**,无需映射。 |
| 与 Landing Remix | **纯新增,Landing 保留** | 二者无耦合,共用 `pgcApi.createRemix`。 |
| 与 prelude 关系 | **互斥,remix 优先** | 外部 remix 页只带 `?remix=`,不与 `model/prompt/assets` 组合(YAGNI)。 |
| fork 失败兜底 | **回退 `loadProjects`** | 进入即 fork 失败(源未开放 / 网络错)时,兜底载入用户自己的项目,避免空工作台;错误经 Toast 透传。 |
| 刷新语义 | **消费一次** | fork 成功后 URL 收敛成 `?project=<fork public_id>`,刷新复用 fork,**绝不重复 fork**。 |

## 接口契约(复用现有 `pgcApi.createRemix`)

接口 `POST /api/remixes` 与类型 `CreateRemixRequest` / `RemixProjectData` **已存在**(landing-remix 已落地),本设计**不改接口、不改 `lib/pgc`**:

```ts
// 已有:src/lib/pgc/types.ts
interface CreateRemixRequest { source_code: string; version_id?: string | null; name?: string | null; }
interface RemixProjectData {
  project: ProjectData;       // 新 fork:含 public_id / id / current_version_id / status ...
  source_code: string; source_version_id: string; target_version_id: string;
  play_url: string; working_preview_url: string;
}
// 已有:src/lib/pgc/client.ts
createRemix: (body) => pgc<RemixProjectData>('POST', '/api/remixes', body)
```

- 本次只取 `data.project`(`id` 选中、`public_id` 写 URL);`play_url` / `working_preview_url` 不用(工作台自行加载版本/预览)。
- **不传 `version_id` / `name`**:由后端取源项目当前版本与默认命名(与 Landing Remix 一致)。

## 架构:纯解析 + 副作用分层(镜像 studio-prelude)

### 1. `src/lib/studio-prelude.ts`(纯函数,新增同级导出)

```ts
// 解析 ?remix=<public_id>;空/缺省返回 null。public_id 直接作 createRemix 的 source_code
export function parseRemixSource(search: string): string | null {
  const v = new URLSearchParams(search).get('remix');
  return v && v.trim() ? v : null;   // 空串 / 缺省 → null
}
```

- 归属:`studio-prelude.ts` 已是「外部页经 /studio URL 进参」的解析归属地,`parseRemixSource` 与 `parseStudioPrelude` 并列。**不为单函数新建文件**。
- 纯函数、无副作用、不依赖 store —— 副作用(fork / 选中 / 剥 URL)由 store action 负责。

### 2. `src/store/actions.ts`(新增 ServerAction `applyStudioRemix`)

> 放 `actions.ts` 而非 `index.ts`:本 action 纯服务端编排(fork / 选中 / 失败兜底 / 剥 URL),不碰 composer/model 等 UI 态;且 `guard`、`selectProject`、`loadProjects` 均是 `actions.ts` 内本地闭包,`withProjectParam` 亦可在此导入。`ServerActions = ReturnType<typeof createServerActions>` 自动并入 `AppStore`,无需单独声明类型。(对比:`applyStudioPrelude` 因要写 composer/selectedModel 这些 UI 态才留在 `index.ts`。)

```
applyStudioRemix(sourceCode):
  forkedPublicId = null                      // 本地成败标志,不读 get().currentProjectId(被 persist 回灌,见下)
  await guard(set):
    data = await pgcApi.createRemix({ source_code: sourceCode })   // 不传 name/version_id
    set({ projects: [data.project, ...get().projects] })
    await selectProject(data.project.id)   // 落地 currentProjectId + 同步 URL + loadCanvas/loadVersions/restoreGenTasks
    forkedPublicId = data.project.public_id  // guard 吞错时到不了这行,保持 null → 走失败兜底
  if (forkedPublicId != null):              // ── fork 成功 ──
    // 剥掉 ?remix=,仅留 ?project=<fork public_id>(selectProject 内 syncProjectToUrl 用 withProjectParam 会保留旧参数,须从空串重写)
    if (window):
      next = withProjectParam('', forkedPublicId)
      window.history.replaceState(window.history.state, '', `${pathname}${next}${hash}`)
    set({ booting: false })                 // 撤全局加载层(remix 分支不经 loadProjects 的 finally)
  else:                                     // ── fork 失败(guard 已置 lastError/authRequired)──
    if (window):                            // 先显式删 remix 参(withProjectParam 只管 project 参,删不掉 remix)
      params = URLSearchParams(location.search); params.delete('remix')
      window.history.replaceState(..., 仅余参数)
    await loadProjects()                    // 兜底:载入用户自己的项目,避免空工作台;其内撤 booting + 选定项目并补 ?project=
```

> **为何用本地 `forkedPublicId` 而非 `get().currentProjectId` 判定成败**:`currentProjectId` 在 persist `partialize` 内被持久化回灌。老用户带着上次选中的项目进来时,`applyStudioRemix` 运行前它本就非空——若 fork 失败(`guard` 吞错、不改 `currentProjectId`),用 `pid != null` 判定会被**误判为成功**,跳过失败兜底,把用户留在本会话未加载画布的旧项目上 → 空工作台。故改用仅在 fork+选中都成功时才落值的本地标志。
> **失败路径也要剥 `?remix=`**:`loadProjects` 内 `syncProjectToUrl` 走 `withProjectParam(当前 search, id)`,只增删 `project` 参、**保留** `remix`,故失败后须在调用 `loadProjects` 前显式删 `remix`,否则 URL 残留 `?remix=` → 刷新重复 fork(破坏「消费一次」)。两条分支因此都收敛到无 `remix` 的 URL。

类型自动并入:`applyStudioRemix` 加进 `createServerActions` 的返回对象即由 `ReturnType` 推导进 `ServerActions`/`AppStore`,无需手写接口声明(与 `loadProjects` 等同)。

**关键不变式 / 约定(全部沿用现有)**:
- **消费一次 + 刷新**:成功后 URL = `?project=<fork public_id>`(刷新复用 fork);失败后 URL 也已删掉 `remix`(刷新走兜底项目,不再 fork)——**两条分支都收敛到无 `remix` 的 URL**。`ran` ref 另防 StrictMode 双挂载。`remix` 是「进来即 fork」的一次性动作,**绝不可重复执行**(重复会建重复 fork 项目)。
- **加载态**:fork 异步期间 `booting` 保持 true(全局 LoadingScreen),与 prelude 分支一致。
- **嵌套 guard**:`applyStudioRemix` 外层 guard 内调 guard 包裹的 `selectProject` —— 与现有 `createProject`(guard 内调 `selectProject`)同构,安全。
- **不臆测后端字段**:只取 `data.project`;不传/不读契约外字段。

### 3. `src/client/useProjectBootstrap.ts`(二选一 → 三选一)

`ran` once 守护内改为三选一(remix 优先):

```
挂载时(once):
  remix = parseRemixSource(location.search)
  if (remix) applyStudioRemix(remix)          // 新增:进入即 fork
  else:
    prelude = parseStudioPrelude(location.search)
    if (prelude) applyStudioPrelude(prelude)   // 现有:新建预填
    else loadProjects()                          // 现有:复用最近
```

hook 依赖数组补 `applyStudioRemix`。

## 错误处理(对齐现有 `guard`,不自造、不猜后端 code)

| 情况 | 处理 | 用户感知 |
|---|---|---|
| 未登录 `e.status === 401` | guard 置 `authRequired` → 后续 `pid==null` 兜底 `loadProjects`(其内首个请求多半也 401,再次置 authRequired) | 交 `useAuthGuard`:生产跳 sign-in;本地 notice |
| `REMIX_NOT_AVAILABLE` / 其他 `PgcError`(源未开放 / 已删 / 非法 code / 网络) | guard 写 `lastError`(→Toast)→ `pid==null` 兜底 `loadProjects` 进自己的工作台 | 红色 Toast(透传后端 code/message)+ 落在自己的项目列表 |
| 非 `PgcError` | guard 照抛 | 不吞,暴露 bug |

> 不预置 `REMIX_NOT_AVAILABLE` 文案,直接透传后端 `code`/`message`(与 `guard` 一致)。Toast 4s 自动消失。
> Toast 已在工作台壳全局挂载(订阅 `lastError`),无需像 Landing 那样额外挂。

## 测试(同目录 `*.test`,Vitest + jsdom)

### `src/lib/studio-prelude.test.ts`(`parseRemixSource` 用例)
- `?remix=DakkYXUy` → `'DakkYXUy'`;`?remix=` 空串 → `null`;无 `remix` 参 → `null`。
- 与 prelude 参数共存(`?remix=x&model=y`)→ `parseRemixSource` 取 `'x'`,各自独立解析。

### store 层(action `applyStudioRemix`,复用现有 fake/guard + 微任务 flush)
- **成功**:`pgcApi.createRemix` 以 `{ source_code }` 调用 1 次;`data.project` 入 `projects` 头并被选中(`currentProjectId === data.project.id`);URL 收敛为 `?project=<fork public_id>`(`?remix=` 被剥)。
- **失败(REMIX_NOT_AVAILABLE)**:`lastError` 被置;兜底 `loadProjects` 被调用(载入用户项目);`booting` 最终为 false。
- **失败(401)**:`authRequired === true`(不写 `lastError`)。

### bootstrap 层(`useProjectBootstrap.test.tsx`,扩充)
- URL 带 `?remix=` → 只调 `applyStudioRemix`,不调 `applyStudioPrelude` / `loadProjects`。
- 无 `remix` 但有 prelude → 走 `applyStudioPrelude`(现有用例不回归)。
- 无 `remix` 无 prelude → 走 `loadProjects`(现有用例不回归)。

## 验证

- `pnpm exec tsc --noEmit` + `pnpm lint`。
- `pnpm exec vitest run src/lib/studio-prelude.test.ts src/store src/client/useProjectBootstrap.test.tsx`。
- `pnpm build` 确认双路由正常。
- 本地手测(有 `DEV_COOKIE`):外部模拟 `/studio?remix=<已开放 public_id>` → 进入即 fork、加载到新项目、URL 变 `?project=<新 code>`、刷新不再重复 fork;`?remix=<未开放/非法>` → Toast + 落自己的工作台。

## 风险与假设

- **`?remix=` 的值是 public_id**:与 `/play/{code}`、`/pv/{code}`、Landing `game.id` 同一 opaque 标识,可直接作 `source_code`。若外部页误传数值主键,后端按 `source_code` 查不到 → `REMIX_NOT_AVAILABLE` → Toast 兜底,不崩。
- **remix 与 prelude 互斥**:本期外部 remix 页不组合 `model/prompt/assets`。若日后需「fork 后再预填提示词」,再扩 `applyStudioRemix` 接收可选 prelude(YAGNI,暂不做)。
- **重复 fork 防护**:仅靠 `ran` once 守护 + 成功后即剥 URL。两者缺一不可——若只剥 URL 不防双挂载,StrictMode 下会 fork 两次。
- **basePath**:外部页拼 URL 用 `pagePath('/studio')` 补 `/game` 前缀(外部页负责);我方只读 `location.search`,无 basePath 顾虑。

## 不做(YAGNI)

- 不改 `lib/pgc`(`createRemix` 已存在)、不改 Landing、不改 `Composer.send` 与 koubou 发送链路。
- 不预检 `GET /remix/{code}` 可用性(靠 Toast 兜底)。
- 不传 `version_id` / `name`(后端取默认)。
- 不组合 remix + prelude 预填;不依据源项目名命名 fork(后端默认命名)。
