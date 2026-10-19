# Landing Page Remix 恢复设计稿

> 背景：早前 Remix 因后端未完成被注释暂停（`e983b8a`「暂停 Remix」、`da485b2`「Remix 恢复时改用 public_id」）。后端已上线 `POST /api/remixes`，本设计据此恢复 Landing 的 Remix 功能。
> Apifox（PGC 项目 8405123）：`Create Remix` = `POST /api/remixes`、`Get Remix Availability` = `GET /remix/{code}`、`Get/Update Project Remix Policy`。

## 1. 目标与范围

让 Landing（`/`）的游戏卡支持 **Remix**：把一款公开游戏 fork 成一份属于当前登录用户的新可编辑项目，并在新标签页打开工作台编辑。

**语义变化**：旧 Remix 是 `router.push('/studio?project=<public_id>')`——直接打开公开项目（无法编辑他人项目）。新接口让 Remix 变成**真正 fork**：后端复制源 `project_version` 的 agent 协作桶到目标 `v1/`+`current/`，并复制源项目级 `assets/` 与 ready 画布项；源项目保持只读，目标项目归当前登录用户。

**不做**（YAGNI）：
- 不预检 `GET /remix/{code}` 可用性（3 张 admin 游戏默认已开启 remix 策略，靠 Toast 兜底异常）。
- 不接 `remix-policy`（那是工作台侧「我的项目是否允许被 remix」，与 Landing 无关）。
- 不传 `version_id` / `name`（由后端取源项目当前版本与默认命名）。

## 2. 接口契约（`POST /api/remixes`，需登录）

请求体 `CreateRemixRequest`：

| 字段 | 类型 | 必填 | 本次取值 |
|---|---|---|---|
| `source_code` | string | 是 | `game.id`（public_id / play code，如 `DakkYXUy`） |
| `version_id` | string \| null | 否 | 省略 |
| `name` | string \| null | 否 | 省略 |

成功响应 `APIResponse<RemixProjectData>`（PGC 信封 `{ success, code, message, data, request_id }`）：

```ts
interface RemixProjectData {
  project: ProjectData;       // 新 fork:含 public_id / current_version_id / status ...
  source_code: string;
  source_version_id: string;
  target_version_id: string;
  play_url: string;
  working_preview_url: string;
}
```

前端只用 `data.project.public_id` 拼工作台 URL；`working_preview_url` / `play_url` 本次不用（工作台自行加载版本/预览）。

错误经 PGC 信封 `success:false` + `code`：未登录（鉴权失败，代理收敛为 502 信封或 401）、`REMIX_NOT_AVAILABLE`（源未开 remix / 非法 code / 源已删）、其余网络/服务端错误。

### `lib/pgc` 改动

`src/lib/pgc/types.ts` 新增：

```ts
export interface CreateRemixRequest { source_code: string; version_id?: string | null; name?: string | null; }
export interface RemixProjectData {
  project: ProjectData;
  source_code: string;
  source_version_id: string;
  target_version_id: string;
  play_url: string;
  working_preview_url: string;
}
```

`src/lib/pgc/client.ts` 的 `pgcApi` 新增（路径相对 `PREFIX=/api/pgc`，故上游命中 `/api/remixes`）：

```ts
createRemix: (body: CreateRemixRequest) => pgc<RemixProjectData>('POST', '/api/remixes', body),
```

## 3. 交互流程（关键：防弹窗拦截）

新标签页打开（Nick 选定，与现有 Open/Generate CTA 一致），但 `createRemix` 是异步的——`await` 之后再 `window.open` 会因脱离用户手势被浏览器弹窗拦截。故采用「同步抓句柄 → 异步重定向」：

1. 点 Remix（仍在用户手势内）**同步**抓空白新标签句柄：`const win = window.open('', '_blank');`
2. Remix 按钮进入 pending（转圈 + 禁用，防并发重复提交）。
3. `await pgcApi.createRemix({ source_code: game.id })`。
4. 成功：`const url = pagePath('/studio') + withProjectParam('', data.project.public_id);`
   - `win` 非空 → `win.location.href = url;`
   - `win` 为 `null`（被弹窗拦截）→ 当前页兜底 `window.location.assign(url);`（用 `assign` 而非赋值 `href`，便于测试 spy）
5. 失败：`win?.close();` + `setError(...)`（Toast）。
6. `finally` 清 `remixingId`。

新标签的工作台 `loadProjects`（`GET /api/projects` 列当前用户项目）会按 `?project=<public_id>` 自动选中这个 fork（见 `src/store/actions.ts` 选定优先级：URL ?project > 持久化最近 > 列表第一）。

> `pagePath('/studio')` 经 `src/lib/basePath.ts` 补 `/game` 前缀（部署在 `/game/*` 下）；`withProjectParam('', id)` 返回 `?project=<id>`。
> 不再依赖 `next/navigation`——句柄 + `window.location` 兜底即可，且天然带 basePath。
> 句柄方案无法用 `noopener`（需保留句柄重定向）；目标为同源 `/studio`，`window.opener` 可访问性无实际风险。

## 4. 组件改动

### `src/components/landing/games.ts`
- 移除死字段 `ctaLabel`（暂停期间三张卡都是 `'Play'`，新设计三张卡统一「hover Remix + footer Play」，该字段不再驱动任何分支）。
- `PopularGame` 保留 `id`（public_id，兼作 React key 与 `source_code`）/ `title` / `author` / `thumb` / `previewUrl`。

### `src/components/landing/GameCard.tsx`（还原 Figma `357:725`）
还原暂停前的 hover-Remix 浮层，并保留当前卡片的精修动效：

- **缩略图**：`relative` 容器（不再是 Play 按钮）。`<img>` 保留 hover 轻微放大（`group-hover:scale-[1.06]`）。hover 叠半透明压暗层 + 居中浮现青渐变 **Remix** pill（`REMIX_GRAD` 背景 + `#40c4aa` 边框 + `#f3f3f3` 文字，复用 `src/components/landing/styles.ts` 的 `REMIX_GRAD`）。
- **卡片整体**：保留现状 hover 上浮 + 青色辉光阴影。
- **footer**：`Play` 按钮（`.btn-raised`），点击触发原地预览 modal（沿用现状 `onPlay`）。
- **pending 态**：`remixing` 为真时，浮层强制可见（`opacity-100`，不随鼠标移出消失）、Remix 按钮禁用 + 转圈、`aria-busy`。转圈复用项目既有 spinner 表达（与工作台占位卡/LoadingScreen 同语汇，不引入新 keyframes）。
- props：`{ game; onPlay; onRemix; remixing }`。Remix 按钮 `aria-label={\`Remix ${game.title}\`}`。

### `src/components/landing/LandingPage.tsx`
- 放开并改写 Remix：新增本地态 `const [remixingId, setRemixingId] = useState<string | null>(null);`，`const setError = useStore((s) => s.setError);`
- 实现 §3 的 `remix(game)` handler（同步抓句柄 → `createRemix` → 重定向/兜底/错误/清态）。`if (remixingId) return;` 防并发。
- 挂全局 `<Toast />`（复用 `src/components/ui/Toast.tsx`，订阅 `store.lastError`）——Landing 当前无 Toast，远程错误需要它落地。
- 挂 `useAuthGuard()`（复用 `src/client/useAuthGuard.ts`）：未登录（401）置位 `authRequired` 后由它处理（生产整页跳 sign-in、本地清标志 + 弹既有 notice），与全局鉴权一致，不在 Landing 自造登录跳转。
- `<PopularGames>` 透传 `onRemix={remix}` 与每卡 `remixing={remixingId === game.id}`。
- 移除已注释的 `useRouter` / `withProjectParam`（remix 跳转）相关死代码；`withProjectParam` 改在 handler 内按需 import 使用。

### `src/components/landing/PopularGames.tsx`
- 透传 `onRemix` 与 `remixing`（按 `game.id` 比对）给每个 `GameCard`。

## 5. 错误处理

完全对齐 `src/store/actions.ts` 既有 `guard` 约定（不自造、不猜后端 code）：handler 内 `try/catch`，只处理 `PgcError`（`src/lib/pgc/client.ts` 抛出），非 `PgcError` 照抛（不吞未知错误，符合反模式约定）。

| 情况 | 处理 | 用户感知 |
|---|---|---|
| 未登录 `e.status === 401` | `useStore.setState({ authRequired: true })`，交 `useAuthGuard` | 生产跳 sign-in；本地清标志 + notice「本地未鉴权…」 |
| `REMIX_NOT_AVAILABLE` / 其他 `PgcError` | `setError({ code: e.code, message: e.message })`（默认红色 error） | 红色 Toast，透传后端 code/message |
| 非 `PgcError` | `throw e` | 不吞，暴露 bug |

> 不预置 REMIX_NOT_AVAILABLE 文案——直接透传后端 `code`/`message`（避免臆测后端契约，与 `guard` 一致）。Toast 4s 自动消失。

## 6. 视觉与动效

- Remix 青渐变：复用 `REMIX_GRAD`（`linear-gradient(to right, #1fd4cf, #033744)`）+ 边框 `#40c4aa`，跨主题恒定品牌色（不进主题变量）。
- 浮层压暗、按钮浮现、图片放大均复用现有 `transition` + `group-hover` 写法与缓动，**不新增一次性 keyframes**。
- pending 转圈复用既有 spinner；`@media (prefers-reduced-motion: reduce)` 下退化（沿用现状动效约束）。

## 7. 测试（同目录 `*.test.tsx`，Vitest + jsdom）

### `games.test.ts`
- 更新断言：移除 `ctaLabel` 相关，校验三条数据含 `id/title/author/thumb/previewUrl`。

### `GameCard.test.tsx`（新增或并入）
- 渲染后 footer `Play` 按钮在 DOM；hover 浮层 Remix 按钮在 DOM（`opacity` 由 CSS 控，元素始终挂载）。
- `remixing` 为真时 Remix 按钮 `disabled` / `aria-busy`。

### `LandingPage.test.tsx`
- mock `pgcApi.createRemix` 返回 `{ project: { public_id: 'NEWcode', ... }, ... }`。
- mock `window.open` 返回假句柄 `{ location: {}, close: vi.fn() }`：
  - 点 Remix → `await` 后断言 `win.location.href === '/studio?project=NEWcode'`（测试环境无 basePath）。
- `window.open` 返回 `null`（被拦）→ `vi.spyOn(window.location, 'assign')` 断言以 `/studio?project=NEWcode` 调用。
- `createRemix` reject 非 401 `PgcError`（如 `REMIX_NOT_AVAILABLE`）→ 断言 `win.close()` 调用 + `store.lastError` 被设置。
- `createRemix` reject 401 `PgcError` → 断言 `store.authRequired === true`（不写 `lastError`），交 `useAuthGuard`。
- 既有用例：`Play` 仍开 modal 不跳转；Open/Generate 新页签打开；主题 postMessage 实时更新——保持通过。

## 8. 验证

- `pnpm exec tsc --noEmit` + `pnpm lint`。
- `pnpm exec vitest run src/components/landing`。
- `pnpm build` 确认双路由正常。
- 本地手测（有 `DEV_COOKIE`）：点 Remix → 新标签打开工作台并加载到 fork 项目；未开 remix 的源 → Toast。

## 9. 风险与假设

- **假设 3 张 admin 游戏已开启 remix 策略**：不预检，靠 Toast 兜底。若日后 Popular Games 动态化或含未开放游戏，再引入 `GET /remix/{code}` 预检并条件渲染 Remix。
- **`source_code` = `game.id`（public_id）**：与 `/play/{code}`、`/pv/{code}` 同一 opaque 标识（games.ts 现有数据已用 public_id 作 `id`）。
- **弹窗拦截**：句柄方案规避 `await` 后 open 被拦；极端情况下连同步 open 也被拦（`win===null`）则当前页兜底，不丢失跳转。
- **basePath**：跳转一律经 `pagePath()`；`source_code` 走 `pgcApi`（已带 `apiPath`）。
