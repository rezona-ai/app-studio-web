# File menu + Rezona 发布流程设计

> ⚠️ **本稿的扫码绑定部分已于 2026-08-12 作废**（后端把账号匹配/建号收进发布接口，绑定态与扫码端点全部下线）。
> 现行发布流程见 [`2026-08-12-rezona-publish-direct-design.md`](2026-08-12-rezona-publish-direct-design.md)；
> 本稿仅 File menu 与发布表单布局部分仍有参考价值。

> 日期：2026-07-02 · 分支：`feat/rezona-publish-flow`
> 设计稿节点：File menu = `1527:41218`(Right Sidebar) 内子层；Rezona 弹窗 = `1174:33248`(Link)/`1174:33713`(发布表单)；完整组件库 = `1099:25061`
> 后端契约：`rezona-ai/pgc-server` `docs/rezona-contract/frontend-integration.md` + Apifox PGC(8405123) rezona 端点(均 released)

## 1. 背景与目标

预览面板（Right Sidebar）顶栏左上的分享按钮，当前**直接打开** `SharePopover`（居中模态，展示公开游玩直链 + 复制）。设计稿要把这个入口改成一个 **File menu 下拉**，含两项：

- **Share Game** —— 复用现有 `SharePopover`（零改动）。
- **Share to Rezona** —— 触发一整套 **发布到 Rezona 平台** 的多步流程（扫码绑定 → 填写发布表单 → 发布中 → 发布成功）。

Rezona 发布是**真实后端集成**（PGC 已上线 6 个 rezona 端点），不是纯 UI 占位。

## 2. 范围

### In scope（本期）

1. `FileMenu` 下拉：Share Game / Share to Rezona 两项。
2. Rezona 发布全流程 4 态：Link 扫码 → 发布表单 → Posting → Published。
3. 真实接口对接：eligibility 门控、绑定查询、扫码轮询、切换账号、发布。
4. 可复用 `Switch` 开关组件（项目当前无）。
5. i18n 六语。

### Out of scope（本期不做，记录以便后续）

- **自定义封面上传**：后端 `cover_ref` 实际支持「受控上传 asset id」（见 §4 注），但本期封面**恒为 `version_cover`**（只读展示当前版本封面）；实例稿里的 `Upload`、组件库稿里的 `AI Cover`/`Capture` 控件本期不做。
- Rezona 侧的 `callback` / `jwks.json`（后端内部，前端不碰）。

## 3. 后端契约（PGC，`/api/pgc` 代理，成功信封 `{ success, code, message, data, request_id }`）

> 注：契约文档写的是逻辑路径（`/rezona/...`），实际 client 路径按项目既有约定带 `/api` 前缀（对齐 Apifox：`/game/pgcserver/api/rezona/...`）。

| 用途 | Method | 路径（相对 client PREFIX `/api/pgc`） | 关键返回 |
|---|---|---|---|
| 入口资格 | GET | `/api/rezona/eligibility` | `{ eligible: boolean }` |
| 绑定状态 | GET | `/api/rezona/binding` | `{ state: 'unbound'\|'bound'\|'expired', account? }` |
| 发起扫码 | POST | `/api/rezona/bind` | `{ session_id, qr_content, qr_image: 'data:image/png;base64,…', expires_at }` |
| 轮询会话 | GET | `/api/rezona/bind/{session_id}` | `{ status: 'pending'\|'confirmed'\|'rejected'\|'expired', account?, reason? }` |
| 解绑/切换 | DELETE | `/api/rezona/binding` | `{ ok: true }`（幂等） |
| 发布 | POST | `/api/projects/{project_id}/rezona/publish` | `{ share_url, rezona_work_id }` |

**发布请求体**（OAS `PublishRequest`）：

```jsonc
{
  "version_id": "v{n}",          // 必填,≥1;须已 build 的稳定版本,"current" 会被拒
  "name": "string",              // 必填,1..255,默认取项目名
  "summary": "string",           // 可选,≤2000,默认 ""
  "cover_ref": "version_cover",  // 默认/本期恒为 version_cover
  "public": true,                // 默认 true
  "remixable": false,            // 默认 false;R11:public=false 时服务端强制归 false
  "sync_to_community": false,    // 默认 false
  "idempotency_key": "uuid-v4"   // 可空;缺则服务端按(uid,project,version,内容指纹)生成
}
```

`account` 形状：`{ id: string; name?: string; avatar_url?: string }`。

**错误码 → UX**：

| Code | HTTP | UX |
|---|---|---|
| `UNAUTHORIZED` | 401 | 跳登录（现有鉴权链路兜底） |
| `REZONA_NOT_ELIGIBLE` / `REZONA_NOT_FOUND` | 403 / 404 | 隐藏入口（防御性） |
| `VERSION_NOT_FOUND` | 404 | 提示选择已 build 版本 |
| `REZONA_SESSION_NOT_FOUND` | 404 | 重启绑定 |
| `VALIDATION_ERROR` | 422 | 表单标红 |
| `REZONA_COVER_INVALID` | 422 | 回落默认封面 |
| `REZONA_BIND_EXPIRED` | 409 | 重启绑定流程 |
| `IDEMPOTENCY_CONFLICT` | 409 | 换新 key 重试 |
| `REZONA_PUBLISH_IN_PROGRESS` | 409 | 显示"发布中…" |
| `REZONA_PACKAGE_TOO_LARGE` | 413 | Toast 提示体积超限 |
| `REZONA_PUBLISH_FAILED` / `REZONA_UNAVAILABLE` | 502 / 503 | Toast 稍后重试 |

## 4. 关键决策（已与 Nick 确认）

1. **封面**：本期 `cover_ref` 恒 `version_cover`，PREVIEW 区只读展示当前版本封面，不做自定义封面控件。
   > 后端事实：OAS `cover_ref` 描述为「只接受 `version_cover` 哨兵**或受控上传 asset id**（拒任意远程 URL）」——即自定义封面**后端已支持**（上传拿 asset id 路线），列为后续。
2. **入口门控**：进项目时 `GET /api/rezona/eligibility` 查一次，存 store（`rezonaEligible`）；`FileMenu` 据此决定是否渲染 Share to Rezona 项。403/404 视为不合格（隐藏）。
3. **发布版本**：`version_id` 取**当前预览选中版本**的 `v{index}`（`activeVersionId` → `Version.index`）；无稳定版本时该项禁用。
4. **流转**：真实轮询 + 发布（非模拟）。
5. **实例稿 vs 组件库稿**：有实例的屏（Link/表单）以实例稿为准（Link 底部用长说明文字而非 "Contact support"；封面区只 `Upload` 视觉、且本期隐藏）；Posting/Published 用组件库稿。

## 5. 分层落位（遵循项目架构：协议纯类型 · server 不知 UI · store 唯一落库 · lib 纯逻辑 · client 副作用 · UI 只订阅）

| 层 | 文件 | 内容 |
|---|---|---|
| 类型 | `src/lib/pgc/types.ts` | `RezonaAccount` / `RezonaEligibilityData` / `RezonaBindingData` / `RezonaBindSessionData` / `RezonaPublishRequest` / `RezonaPublishResultData` |
| client | `src/lib/pgc/client.ts` | `pgcApi.rezona = { eligibility, binding, bind, pollBind, unbind, publish }` |
| 纯逻辑 | `src/lib/rezona/publish.ts` | `newIdempotencyKey()`（uuid-v4）· `POLL_INTERVAL_MS=2500` / `POLL_TIMEOUT_MS` · `normalizePublishToggles()`（R11 归一）· `mapRezonaError(code)`（→ 文案 key / 是否重启绑定） |
| store | `src/store/types.ts` + `index.ts` | `ServerState.rezonaEligible: boolean \| null`（切项目清空，随 bootstrap 填） |
| store action | `src/store/actions.ts` | `loadRezonaEligibility(pid)`（在 bootstrap 内调用；`await` 后校验 `currentProjectId` 不变） |
| client hook | `src/client/useRezonaBindPoll.ts` | 绑定会话轮询：`session_id` 变化即启，2.5s 间隔，终态/超时/卸载停 |
| UI | `src/components/preview/FileMenu.tsx` | 锚定下拉，仿 `ProjectMenu` |
| UI | `src/components/preview/RezonaPublishModal.tsx` | 有限状态机模态外壳 + 步骤分发 |
| UI | `src/components/preview/rezona/{LinkStep,PublishForm,PostingStep,PublishedStep}.tsx` | 各步内容 |
| UI 基础件 | `src/components/ui/Switch.tsx` | 可复用开关（tokens 化，支持 disabled/置灰） |
| i18n | `src/i18n/locales/*.ts` | `preview.fileMenu.*` + `preview.rezona.*` 六语（en 真相源） |

## 6. 状态机（`RezonaPublishModal`）

内部 `step` 状态：`resolving | link | form | posting | published`，共享同一模态外壳（`modal-backdrop`/`modal-pop` + `useRequestClose`）。

```
点击 Share to Rezona ─▶ 打开模态(step=resolving)
  │ GET /api/rezona/binding
  ├─ bound ───────────────────────────────────────────▶ step=form (带回 account)
  └─ unbound|expired ─▶ step=link
        │ POST /api/rezona/bind → { session_id, qr_image, expires_at }
        │ useRezonaBindPoll(session_id) 每 2.5s GET /bind/{session_id}
        │   status=confirmed(account) ──────────────────▶ step=form
        │   status=rejected(reason)    → 内联显示 reason,停轮询,给"重试"
        │   status=expired 或 到 expires_at → 停轮询,显示"二维码过期" + 刷新按钮(重新 POST /bind)
        │
  step=form:
        │ 表单:account 行(头像+@name + Switch) · 只读版本封面 · GAME TITLE(默认项目名) ·
        │       BRIEF INTRODUCTION · 三开关(public/sync_to_community/remixable,R11) · 说明注记
        │ Switch(切换账号): DELETE /api/rezona/binding → step=link(重新扫码)
        │ 点 Post to Rezona ─▶ step=posting
        │   POST /api/projects/{pid}/rezona/publish (idempotency_key 复用)
        │     成功 { share_url } ─────────────────────────▶ step=published
        │     409 REZONA_BIND_EXPIRED → step=link(重启绑定)
        │     其余错误 → 回 step=form + Toast(mapRezonaError)
  step=published: ✓ + "Published to Rezona" + share_url + Copy link(复用剪贴板范式)
```

- `idempotency_key`：模态打开(或进入 form)时 `newIdempotencyKey()` 生成一次，发布重试复用；`IDEMPOTENCY_CONFLICT` 时换新 key。
- 关闭/Esc/点遮罩 → 关模态 + 复位所有内部态；`useRezonaBindPoll` 卸载即清 interval。

## 7. 组件设计

### 7.1 `FileMenu`（仿 `ProjectMenu`）

```tsx
FileMenu({ onClose, onShareGame, onShareToRezona, showRezona }: {
  onClose: () => void;
  onShareGame: () => void;
  onShareToRezona: () => void;
  showRezona: boolean;   // = store.rezonaEligible === true
})
```

- 全屏点击遮罩 `fixed inset-0 z-40` + 锚定下拉 `anim-pop-in origin-top-left absolute top-[calc(100%-1px)] z-50`，面 `bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]`。
- 菜单项按钮：左图标(FigIcon) + 文字，`hover:bg-[var(--color-fill)]`。
- **Share Game**：`onClick={() => { onShareGame(); onClose(); }}`（父层开 `SharePopover`）。
- **Share to Rezona**：仅 `showRezona` 时渲染；`onClick={() => { onShareToRezona(); onClose(); }}`。
- Esc 关闭（window keydown）。

### 7.2 `PreviewPanel` 接线

- 触发钮外包 `relative` 作锚点；`onClick` 从 `setShareOpen(true)` 改为 `setFileMenuOpen(o => !o)`；沿用禁用条件 `!hasGame || !shareUrl`。
- 本地态：`fileMenuOpen` + 现有 `shareOpen` + 新增 `rezonaOpen`。
- 渲染：
  - `{fileMenuOpen && <FileMenu … showRezona={rezonaEligible === true} onShareGame={() => setShareOpen(true)} onShareToRezona={() => setRezonaOpen(true)} />}`
  - `{shareOpen && shareUrl && <SharePopover …/>}`（原样）
  - `{rezonaOpen && <RezonaPublishModal projectId={currentProjectId} version={active} onClose={() => setRezonaOpen(false)} />}`

### 7.3 `RezonaPublishModal` + 步骤子件

- 外壳复用 `SharePopover` 模态范式（`modal-backdrop`/`modal-pop`、Esc/遮罩关闭、`useRequestClose`）。
- 宽 400、`rounded-[24px]`、padding 32；`bg-[var(--color-surface)]`（深色稿按令牌自动压暗）。
- 顶部：`> Post to Rezona` accent 小标签 + 右上关闭（lucide `X`）。
- 步骤子件（`rezona/`）：
  - **LinkStep**：标题 `Link the Rezona account` + 副标题 `Scan the code with Rezona App` + info 图标（lucide `Info`，装饰性，可选 Tooltip）+ QR（后端 `qr_image` base64，204×204）+ 底部说明文字；过期态显示刷新按钮。
  - **PublishForm**：见 §6；`Switch` × 3，**初始默认对齐 Figma：public/sync_to_community/remixable 三者皆 on**（注意 OAS 默认 remixable/sync 为 false，此处以设计意图为准；R11 下 public 关时 remixable 强制关+置灰）；`name` 默认取项目名，`summary` 默认空；封面只读版本封面缩略图（126×126）；CTA `Post to Rezona`（lucide `Rocket` + `.btn-raised`/accent 填充）+ 底部 "Visible to the community the moment you release."。
  - **PostingStep**：spinner + `Posting…`。
  - **PublishedStep**：`checkCircle`(figAsset 已有) + `Published to Rezona` + `share_url` 只读输入 + `Copy link`（复用 SharePopover 剪贴板逻辑：`navigator.clipboard` + 失败走 Toast）。

### 7.4 `Switch`（新增基础件，`components/ui/`）

```tsx
Switch({ checked, onChange, disabled, ariaLabel }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string;
})
```

- `role="switch"` + `aria-checked`；轨道 39×24，开态 `--color-accent`（Figma switch 组件 `1743:31418` 对齐），关/禁用走 `--color-line-2`/`--color-fill`；`motion-safe:` 过渡；`disabled` 时降透明度 + `cursor-not-allowed`。
- 降低动态：过渡在 `prefers-reduced-motion` 内退化。

## 8. eligibility 门控与 store

- `ServerState.rezonaEligible: boolean | null`（null = 未查）。
- `useProjectBootstrap` 载入项目后调 `loadRezonaEligibility(pid)`：`GET /api/rezona/eligibility` → set `rezonaEligible`；`guard()` 内 403/404(`REZONA_NOT_ELIGIBLE`/`REZONA_NOT_FOUND`) → `false`（不弹 Toast）。
- 切项目在同一次 `set` 内把 `rezonaEligible` 复位 `null`，维持「与 currentProjectId 一致」不变式；`await` 后校验 `currentProjectId` 未变。
- **不持久化**（瞬态，随 bootstrap 重查）。

## 9. i18n（六语，en 真相源；Rezona 品牌名不译）

`preview.fileMenu`：`shareGame`(复用现有 `preview.shareGame`) · `shareToRezona`。
`preview.rezona`：`badge`(`Post to Rezona`,渲染前缀 `>`) · `linkTitle`(`Link the Rezona account`) · `linkSubtitle`(`Scan the code with Rezona App`) · `linkInstruction`(`Open Rezona → App Settings … → Scan …`) · `qrExpired` · `refresh` · `rejected`(带 reason 插值) · `switchAccount`(`Switch`) · `preview`(`PREVIEW`) · `gameTitle`(`GAME TITLE`) · `titlePlaceholder` · `briefIntro`(`Brief introduction`) · `briefPlaceholder`(`Introduce your game in one sentence...`) · `public`/`publicDesc`(`Everyone can see`) · `sync`(`Sync to community`)/`syncDesc`(`Appeared in Rezona feed`) · `remixable`/`remixableDesc`(`Others can remix based on your work.`) · `settingsNote`(`The above settings cannot be modified in Taluna after they are released. If you need to adjust them, please go to Rezona.`) · `postCta`(`Post to Rezona`) · `postFooter`(`Visible to the community the moment you release.`) · `posting`(`Posting...`) · `publishedTitle`(`Published to Rezona`) · 复制链接复用现有 `preview.copyLink`/`preview.copy`/`preview.copied` · 错误文案键(对齐 §3 表)。

> 新增文案须同步补齐 en/zh/fr/ru/ja/vi 六套；抽取时扫 aria-label 盲点（见 memory：i18n 约定）。

## 10. 设计对齐（Figma 精确 px）

实现阶段用 `get_design_context` 抓 File menu(`1527:41218` 内)、Link(`1174:33248`)、发布表单(`1174:33713`)、组件库(`1099:25061`)的精确间距/字号/图标；图标资产写临时目录、事后清理（见 memory：Figma get_design_context 会写 public/figma 需清理）。逐项核对（取精确 px + 渲染 mock 比对，列对照表）后再宣称"已对齐"（见 memory：对齐设计稿先核对再宣称完成）。

发布表单精确骨架（`1174:33713`，模态 400 宽 · padding 32）：header 32/y32 → account 行 y64(h64) → PREVIEW y144(封面 126×126 + 控件) → GAME TITLE y310 → Brief y393 → 分隔线 y489 → 三开关 y506/558/610(每行 36,switch 39×24 右对齐) → 说明注记 y662 → CTA+footer y702。

## 11. 错误处理与不变式

- `guard()` 只把已知 `PgcError` 转 `lastError`(→Toast)，其余照抛（不吞未知错误）。
- 轮询 hook：网络错误单次跳过（不炸整流程），连续失败/超时兜底停轮询并给刷新。
- `await` 后校验 `currentProjectId`/step 未变，丢弃过期响应。
- 位置/坐标不涉及（本功能无画布落位）。

## 12. 测试（同目录 `*.test.ts(x)`，vitest + jsdom）

- `lib/rezona/publish.test.ts`：`normalizePublishToggles`（public=false 时 remixable 归 false）· `mapRezonaError` 映射 · `newIdempotencyKey` 形状。
- `components/ui/Switch.test.tsx`：受控切换 · disabled 不触发 · `role="switch"`/`aria-checked`。
- `components/preview/FileMenu.test.tsx`：两项回调 + `onClose`；`showRezona=false` 时不渲染 Rezona 项；Esc/遮罩关闭。
- `components/preview/RezonaPublishModal.test.tsx`：注入假 `pgcApi.rezona`——binding=bound 直进 form；unbound → link，轮询 confirmed → form；表单 R11 联动；Post 成功 → published(share_url)；409 bind_expired → 回 link。用假实现 + 微任务 flush，不依赖真实计时器/网络（依赖注入范式）。
- `client/useRezonaBindPoll.test.ts`：假计时器驱动轮询，终态/卸载停。

## 13. 后续（本期外）

1. 自定义封面上传（后端 `cover_ref` 支持受控 asset id；接 `AI Cover`/`Capture`/`Upload` 控件）。
2. `account` 头像走同源媒体代理（若 `avatar_url` 跨域）。
