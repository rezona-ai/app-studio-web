# File menu + Rezona 发布流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把预览面板顶栏分享入口改为 File menu 下拉（Share Game 复用现有 SharePopover / Share to Rezona 打开一整套扫码绑定→发布表单→发布中→发布成功的真实后端发布流程）。

**Architecture:** 遵循项目分层——PGC 类型/client 加 rezona 端点；纯逻辑下沉 `lib/rezona/`；绑定轮询隔离到 `client/` hook；eligibility 作用户级 store 字段；UI 用一个有限状态机模态 `RezonaPublishModal` + 步骤子件 + 新增可复用 `Switch`；开合态本地于 `PreviewPanel`。

**Tech Stack:** Next 16 / React 19 / TypeScript / zustand / @xyflow / react-i18next / vitest(jsdom) / lucide-react / Tailwind v4(CSS 变量令牌)。

设计稿：File menu=`1527:41218`(Right Sidebar 内)；Link=`1174:33248`；发布表单=`1174:33713`；组件库=`1099:25061`。
契约：见 `docs/superpowers/specs/2026-07-02-rezona-publish-flow-design.md` §3。

## Global Constraints

- **注释/commit message 一律中文**；每个 Task 末尾 commit（`feat:`/`test:` 前缀）。
- **颜色只用 CSS 变量令牌**（`bg-[var(--color-...)]`），禁硬编码色值；复用既有基础组件/`.anim-*` 动效类；新动画须进 `globals.css` 的 `prefers-reduced-motion` 禁用列表。
- **i18n 六语**（en/zh/fr/ru/ja/vi），en 为真相源；新增 key 必须补齐六套，`src/i18n/i18n.test.ts` 的 key 对齐测试必须过。
- **lint 约束**：禁 effect 内 setState（用渲染期 guard setState）；`eslint-disable` 必带 `-- 理由`。
- **PGC 契约**：只取文档约定字段（snake_case），不臆测别名；client 路径带 `/api` 前缀经 `apiPath()`。
- **测试**：与源码同目录 `*.test.ts(x)`；`vi.mock('@/lib/pgc/client')` 时保留真实导出（`PgcError` 供 `instanceof`）。
- 运行命令：`pnpm exec vitest run <file>`（单测）、`pnpm exec tsc --noEmit`（类型）、`pnpm lint`。
- 契约精确值（发布请求体，OAS `PublishRequest`）：`version_id`(必填,`v{n}`,`current` 拒) · `name`(必填,1..255) · `summary`(≤2000,默认"") · `cover_ref`(默认 `"version_cover"`,本期恒此值) · `public`(默认 true) · `remixable`(默认 false;R11:public=false 强制 false) · `sync_to_community`(默认 false) · `idempotency_key`(可空)。

---

### Task 1: `lib/rezona/publish.ts` 纯逻辑

**Files:**
- Create: `src/lib/rezona/publish.ts`
- Test: `src/lib/rezona/publish.test.ts`

**Interfaces:**
- Produces:
  - `POLL_INTERVAL_MS: number`（2500）、`POLL_TIMEOUT_MS: number`（120000）
  - `newIdempotencyKey(): string`
  - `interface PublishToggles { public: boolean; remixable: boolean; sync_to_community: boolean }`
  - `normalizePublishToggles(t: PublishToggles): PublishToggles`（R11 归一）
  - `interface RezonaErrorUX { messageKey: string; restartBinding: boolean }`
  - `mapRezonaError(code: string): RezonaErrorUX`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/rezona/publish.test.ts
import { expect, test } from 'vitest';
import { normalizePublishToggles, mapRezonaError, newIdempotencyKey, POLL_INTERVAL_MS } from './publish';

test('R11:public=false 时 remixable 归一为 false', () => {
  expect(normalizePublishToggles({ public: false, remixable: true, sync_to_community: true }))
    .toEqual({ public: false, remixable: false, sync_to_community: true });
});

test('public=true 时保留 remixable', () => {
  expect(normalizePublishToggles({ public: true, remixable: true, sync_to_community: false }))
    .toEqual({ public: true, remixable: true, sync_to_community: false });
});

test('mapRezonaError:绑定过期类要求重启绑定', () => {
  expect(mapRezonaError('REZONA_BIND_EXPIRED').restartBinding).toBe(true);
  expect(mapRezonaError('REZONA_PUBLISH_FAILED').restartBinding).toBe(false);
  expect(mapRezonaError('SOMETHING_UNKNOWN').messageKey).toBe('preview.rezona.err.generic');
});

test('newIdempotencyKey 返回非空且两次不同', () => {
  const a = newIdempotencyKey(); const b = newIdempotencyKey();
  expect(a).toBeTruthy(); expect(a).not.toBe(b);
});

test('轮询间隔常量为 2.5s', () => { expect(POLL_INTERVAL_MS).toBe(2500); });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/rezona/publish.test.ts`
Expected: FAIL（模块不存在 / 导出未定义）

- [ ] **Step 3: 实现**

```ts
// src/lib/rezona/publish.ts
// Rezona 发布流程的纯逻辑:轮询常量、幂等键、开关归一(R11)、错误码→UX 文案映射。无副作用,易测。

export const POLL_INTERVAL_MS = 2500;         // 契约:绑定会话轮询 ~2.5s
export const POLL_TIMEOUT_MS = 2 * 60 * 1000; // QR ≤2min 有效,超时即当过期

// 幂等键:每次发布意图生成一次,重试复用(契约 KTD16)
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export interface PublishToggles { public: boolean; remixable: boolean; sync_to_community: boolean }

// R11:public=false 时 remixable 强制归 false(与服务端一致,UI 镜像)
export function normalizePublishToggles(t: PublishToggles): PublishToggles {
  return t.public ? t : { ...t, remixable: false };
}

export interface RezonaErrorUX {
  messageKey: string;     // i18n key
  restartBinding: boolean; // 是否需回到扫码步骤重新绑定
}

// 发布/绑定错误码 → UX(文案 key + 是否重启绑定)。未知码回落通用文案。
export function mapRezonaError(code: string): RezonaErrorUX {
  switch (code) {
    case 'REZONA_BIND_EXPIRED':
    case 'REZONA_SESSION_NOT_FOUND':
      return { messageKey: 'preview.rezona.err.bindExpired', restartBinding: true };
    case 'VERSION_NOT_FOUND':
      return { messageKey: 'preview.rezona.err.versionNotFound', restartBinding: false };
    case 'VALIDATION_ERROR':
      return { messageKey: 'preview.rezona.err.validation', restartBinding: false };
    case 'REZONA_COVER_INVALID':
      return { messageKey: 'preview.rezona.err.cover', restartBinding: false };
    case 'IDEMPOTENCY_CONFLICT':
      return { messageKey: 'preview.rezona.err.idempotency', restartBinding: false };
    case 'REZONA_PACKAGE_TOO_LARGE':
      return { messageKey: 'preview.rezona.err.tooLarge', restartBinding: false };
    case 'REZONA_PUBLISH_FAILED':
    case 'REZONA_UNAVAILABLE':
      return { messageKey: 'preview.rezona.err.unavailable', restartBinding: false };
    default:
      return { messageKey: 'preview.rezona.err.generic', restartBinding: false };
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/rezona/publish.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: commit**

```bash
git add src/lib/rezona/publish.ts src/lib/rezona/publish.test.ts
git commit -m "feat: Rezona 发布纯逻辑(幂等键/R11 开关归一/错误码映射/轮询常量)"
```

---

### Task 2: Rezona 类型 + `pgcApi.rezona` client 方法

**Files:**
- Modify: `src/lib/pgc/types.ts`（尾部追加 Rezona 类型）
- Modify: `src/lib/pgc/client.ts`（`pgcApi` 内加 `rezona` 分组，导入新类型）
- Test: `src/lib/pgc/rezona-client.test.ts`

**Interfaces:**
- Produces（`src/lib/pgc/types.ts`）:
  - `interface RezonaAccount { id: string; name?: string; avatar_url?: string }`
  - `interface RezonaEligibilityData { eligible: boolean }`
  - `type RezonaBindingState = 'unbound' | 'bound' | 'expired'`
  - `interface RezonaBindingData { state: RezonaBindingState; account?: RezonaAccount }`
  - `interface RezonaBindData { session_id: string; qr_content: string; qr_image: string; expires_at: string }`
  - `type RezonaBindStatus = 'pending' | 'confirmed' | 'rejected' | 'expired'`
  - `interface RezonaBindSessionData { status: RezonaBindStatus; account?: RezonaAccount; reason?: string }`
  - `interface RezonaPublishRequest { version_id: string; name: string; summary?: string; cover_ref?: string; public: boolean; remixable: boolean; sync_to_community: boolean; idempotency_key?: string }`
  - `interface RezonaPublishResultData { share_url: string; rezona_work_id: string }`
- Produces（`src/lib/pgc/client.ts`）: `pgcApi.rezona = { eligibility, binding, bind, pollBind, unbind, publish }`，签名见下。

- [ ] **Step 1: 追加类型（`src/lib/pgc/types.ts` 文件末尾）**

```ts
// ---- Rezona 发布流程(见 docs/.../2026-07-02-rezona-publish-flow-design.md §3) ----
export interface RezonaAccount { id: string; name?: string; avatar_url?: string }
export interface RezonaEligibilityData { eligible: boolean }
export type RezonaBindingState = 'unbound' | 'bound' | 'expired';
export interface RezonaBindingData { state: RezonaBindingState; account?: RezonaAccount }
export interface RezonaBindData { session_id: string; qr_content: string; qr_image: string; expires_at: string }
export type RezonaBindStatus = 'pending' | 'confirmed' | 'rejected' | 'expired';
export interface RezonaBindSessionData { status: RezonaBindStatus; account?: RezonaAccount; reason?: string }
export interface RezonaPublishRequest {
  version_id: string;          // v{n};须已 build 的稳定版本,current 会被拒
  name: string;                // 1..255
  summary?: string;            // ≤2000
  cover_ref?: string;          // 默认/本期恒 "version_cover"
  public: boolean;
  remixable: boolean;
  sync_to_community: boolean;
  idempotency_key?: string;    // 可空,缺则服务端生成
}
export interface RezonaPublishResultData { share_url: string; rezona_work_id: string }
```

- [ ] **Step 2: 加 client 方法**

`src/lib/pgc/client.ts` 顶部 `import type { … }` 追加上述类型名。然后在 `pgcApi` 对象内（`listVersionFiles` 之后、对象闭合 `}` 之前）加：

```ts
  // Rezona 发布流程(路径带 /api 前缀,对齐 Apifox /game/pgcserver/api/rezona/*)
  rezona: {
    eligibility: () => pgc<RezonaEligibilityData>('GET', '/api/rezona/eligibility'),
    binding: () => pgc<RezonaBindingData>('GET', '/api/rezona/binding'),
    bind: () => pgc<RezonaBindData>('POST', '/api/rezona/bind'),
    pollBind: (sessionId: string) => pgc<RezonaBindSessionData>('GET', `/api/rezona/bind/${sessionId}`),
    unbind: () => pgc<{ ok: boolean }>('DELETE', '/api/rezona/binding'),
    publish: (pid: number, body: RezonaPublishRequest) =>
      pgc<RezonaPublishResultData>('POST', `/api/projects/${pid}/rezona/publish`, body),
  },
```

- [ ] **Step 3: 写测试（stub `global.fetch` 验路径/方法/信封解包）**

```ts
// src/lib/pgc/rezona-client.test.ts
import { afterEach, expect, test, vi } from 'vitest';
import { pgcApi } from './client';

function mockFetchOnce(data: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ success: true, code: 'OK', message: '', data, request_id: 'r1' }),
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
afterEach(() => vi.unstubAllGlobals());

test('publish:POST 正确路径 + body,解包 data', async () => {
  const spy = mockFetchOnce({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  const body = { version_id: 'v3', name: 'G', public: true, remixable: true, sync_to_community: true };
  const res = await pgcApi.rezona.publish(42, body);
  expect(res.share_url).toBe('https://rezona.app/p/x');
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain('/api/pgc/api/projects/42/rezona/publish');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body)).toMatchObject(body);
  expect(init.credentials).toBe('include');
});

test('pollBind:GET 带 session_id', async () => {
  const spy = mockFetchOnce({ status: 'pending' });
  const res = await pgcApi.rezona.pollBind('sess_9');
  expect(res.status).toBe('pending');
  expect(String(spy.mock.calls[0][0])).toContain('/api/rezona/bind/sess_9');
});

test('eligibility:GET', async () => {
  const spy = mockFetchOnce({ eligible: true });
  expect((await pgcApi.rezona.eligibility()).eligible).toBe(true);
  expect(String(spy.mock.calls[0][0])).toContain('/api/rezona/eligibility');
});
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `pnpm exec vitest run src/lib/pgc/rezona-client.test.ts && pnpm exec tsc --noEmit`
Expected: 测试 3 passed；tsc 无错

- [ ] **Step 5: commit**

```bash
git add src/lib/pgc/types.ts src/lib/pgc/client.ts src/lib/pgc/rezona-client.test.ts
git commit -m "feat: PGC client 加 rezona 端点(eligibility/binding/bind/pollBind/unbind/publish)"
```

---

### Task 3: i18n key（六语）

**Files:**
- Modify: `src/i18n/locales/en.ts`（真相源）、`zh.ts`、`fr.ts`、`ru.ts`、`ja.ts`、`vi.ts`

**Interfaces:**
- Produces：`preview.fileMenu.shareToRezona` 与 `preview.rezona.*` 全部叶子 key（见下 en 定义；其余五语同结构翻译）。

- [ ] **Step 1: en.ts —— 在 `preview: { … }` 内追加**

在 `preview` 对象内（`openInNewTab` 之后）追加：

```ts
    fileMenu: {
      shareToRezona: 'Share to Rezona',
    },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: 'Link the Rezona account',
      linkSubtitle: 'Scan the code with Rezona App',
      linkInstruction: 'Open Rezona → App Settings in the upper right corner of the personal homepage → Scan is in the upper right corner of the setting page',
      qrExpired: 'QR code expired',
      refresh: 'Refresh',
      rejected: 'Scan rejected: {{reason}}',
      resolving: 'Loading…',
      switchAccount: 'Switch',
      previewLabel: 'PREVIEW',
      coverHint: 'Open Preview to capture, or upload a custom cover.',
      gameTitle: 'GAME TITLE',
      titlePlaceholder: 'Title Here',
      briefIntro: 'Brief introduction',
      briefPlaceholder: 'Introduce your game in one sentence...',
      public: 'Public',
      publicDesc: 'Everyone can see',
      sync: 'Sync to community',
      syncDesc: 'Appeared in Rezona feed',
      remixable: 'Remixable',
      remixableDesc: 'Others can remix based on your work.',
      settingsNote: 'The above settings cannot be modified in Taluna after they are released. If you need to adjust them, please go to Rezona.',
      postCta: 'Post to Rezona',
      postFooter: 'Visible to the community the moment you release.',
      posting: 'Posting...',
      publishedTitle: 'Published to Rezona',
      noVersion: 'Build a version first to publish.',
      err: {
        generic: 'Something went wrong. Please try again.',
        bindExpired: 'Binding expired. Please scan again.',
        versionNotFound: 'Selected version not found. Pick a built version.',
        validation: 'Please check the form fields.',
        cover: 'Invalid cover. Using the default cover.',
        idempotency: 'Conflict detected. Retrying…',
        tooLarge: 'The build exceeds the size limit.',
        unavailable: 'Rezona is unavailable. Please try again later.',
      },
    },
```

- [ ] **Step 2: zh.ts —— 同结构追加**

```ts
    fileMenu: {
      shareToRezona: '分享到 Rezona',
    },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: '绑定 Rezona 账号',
      linkSubtitle: '用 Rezona App 扫描二维码',
      linkInstruction: '打开 Rezona → 个人主页右上角 App 设置 → 设置页右上角扫一扫',
      qrExpired: '二维码已过期',
      refresh: '刷新',
      rejected: '扫码被拒绝：{{reason}}',
      resolving: '加载中…',
      switchAccount: '切换',
      previewLabel: '预览',
      coverHint: '打开预览截取，或上传自定义封面。',
      gameTitle: '游戏标题',
      titlePlaceholder: '标题',
      briefIntro: '简介',
      briefPlaceholder: '用一句话介绍你的游戏…',
      public: '公开',
      publicDesc: '所有人可见',
      sync: '同步到社区',
      syncDesc: '出现在 Rezona 动态',
      remixable: '允许二创',
      remixableDesc: '他人可基于你的作品二次创作。',
      settingsNote: '以上设置发布后无法在 Taluna 修改；如需调整请前往 Rezona。',
      postCta: '发布到 Rezona',
      postFooter: '发布后立即对社区可见。',
      posting: '发布中…',
      publishedTitle: '已发布到 Rezona',
      noVersion: '请先构建一个版本再发布。',
      err: {
        generic: '出错了，请重试。',
        bindExpired: '绑定已过期，请重新扫码。',
        versionNotFound: '所选版本不存在，请选择已构建版本。',
        validation: '请检查表单内容。',
        cover: '封面无效，已回落默认封面。',
        idempotency: '检测到冲突，正在重试…',
        tooLarge: '构建包体积超出限制。',
        unavailable: 'Rezona 暂不可用，请稍后重试。',
      },
    },
```

- [ ] **Step 3: fr.ts / ru.ts / ja.ts / vi.ts —— 同结构追加**

各文件在 `preview` 内追加相同 key 结构，值翻译如下（`badge` 恒 `Post to Rezona`；`{{reason}}` 插值保留）：

fr.ts：
```ts
    fileMenu: { shareToRezona: 'Partager sur Rezona' },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: 'Lier le compte Rezona',
      linkSubtitle: 'Scannez le code avec l’app Rezona',
      linkInstruction: 'Ouvrez Rezona → Paramètres de l’app en haut à droite de la page personnelle → Scanner en haut à droite de la page des paramètres',
      qrExpired: 'QR code expiré',
      refresh: 'Actualiser',
      rejected: 'Scan refusé : {{reason}}',
      resolving: 'Chargement…',
      switchAccount: 'Changer',
      previewLabel: 'APERÇU',
      coverHint: 'Ouvrez l’aperçu pour capturer, ou importez une couverture.',
      gameTitle: 'TITRE DU JEU',
      titlePlaceholder: 'Titre',
      briefIntro: 'Brève description',
      briefPlaceholder: 'Présentez votre jeu en une phrase...',
      public: 'Public',
      publicDesc: 'Visible par tous',
      sync: 'Synchroniser à la communauté',
      syncDesc: 'Apparaît dans le fil Rezona',
      remixable: 'Remixable',
      remixableDesc: 'D’autres peuvent remixer votre travail.',
      settingsNote: 'Ces réglages ne pourront pas être modifiés dans Taluna après publication. Pour les ajuster, allez sur Rezona.',
      postCta: 'Publier sur Rezona',
      postFooter: 'Visible par la communauté dès la publication.',
      posting: 'Publication…',
      publishedTitle: 'Publié sur Rezona',
      noVersion: 'Construisez d’abord une version pour publier.',
      err: {
        generic: 'Une erreur est survenue. Réessayez.',
        bindExpired: 'Liaison expirée. Rescannez.',
        versionNotFound: 'Version introuvable. Choisissez une version construite.',
        validation: 'Vérifiez les champs du formulaire.',
        cover: 'Couverture invalide. Couverture par défaut utilisée.',
        idempotency: 'Conflit détecté. Nouvelle tentative…',
        tooLarge: 'Le build dépasse la taille limite.',
        unavailable: 'Rezona est indisponible. Réessayez plus tard.',
      },
    },
```

ru.ts：
```ts
    fileMenu: { shareToRezona: 'Поделиться в Rezona' },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: 'Привязать аккаунт Rezona',
      linkSubtitle: 'Отсканируйте код в приложении Rezona',
      linkInstruction: 'Откройте Rezona → Настройки приложения в правом верхнем углу личной страницы → «Сканировать» в правом верхнем углу страницы настроек',
      qrExpired: 'QR-код истёк',
      refresh: 'Обновить',
      rejected: 'Сканирование отклонено: {{reason}}',
      resolving: 'Загрузка…',
      switchAccount: 'Сменить',
      previewLabel: 'ПРЕВЬЮ',
      coverHint: 'Откройте превью для захвата или загрузите обложку.',
      gameTitle: 'НАЗВАНИЕ ИГРЫ',
      titlePlaceholder: 'Название',
      briefIntro: 'Краткое описание',
      briefPlaceholder: 'Опишите игру одним предложением...',
      public: 'Публично',
      publicDesc: 'Видно всем',
      sync: 'Синхронизировать с сообществом',
      syncDesc: 'Появится в ленте Rezona',
      remixable: 'Разрешить ремикс',
      remixableDesc: 'Другие могут делать ремиксы вашей работы.',
      settingsNote: 'Эти настройки нельзя изменить в Taluna после публикации. Для изменений перейдите в Rezona.',
      postCta: 'Опубликовать в Rezona',
      postFooter: 'Видно сообществу сразу после публикации.',
      posting: 'Публикация…',
      publishedTitle: 'Опубликовано в Rezona',
      noVersion: 'Сначала соберите версию для публикации.',
      err: {
        generic: 'Что-то пошло не так. Повторите.',
        bindExpired: 'Привязка истекла. Отсканируйте снова.',
        versionNotFound: 'Версия не найдена. Выберите собранную версию.',
        validation: 'Проверьте поля формы.',
        cover: 'Неверная обложка. Использована обложка по умолчанию.',
        idempotency: 'Обнаружен конфликт. Повтор…',
        tooLarge: 'Сборка превышает лимит размера.',
        unavailable: 'Rezona недоступна. Повторите позже.',
      },
    },
```

ja.ts：
```ts
    fileMenu: { shareToRezona: 'Rezona に共有' },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: 'Rezona アカウントを連携',
      linkSubtitle: 'Rezona アプリでコードをスキャン',
      linkInstruction: 'Rezona を開く → 個人ホーム右上のアプリ設定 → 設定ページ右上のスキャン',
      qrExpired: 'QR コードの有効期限切れ',
      refresh: '更新',
      rejected: 'スキャンが拒否されました：{{reason}}',
      resolving: '読み込み中…',
      switchAccount: '切り替え',
      previewLabel: 'プレビュー',
      coverHint: 'プレビューを開いてキャプチャ、またはカバーをアップロード。',
      gameTitle: 'ゲームタイトル',
      titlePlaceholder: 'タイトル',
      briefIntro: '概要',
      briefPlaceholder: 'ゲームを一文で紹介...',
      public: '公開',
      publicDesc: '全員に表示',
      sync: 'コミュニティに同期',
      syncDesc: 'Rezona フィードに表示',
      remixable: 'リミックス可',
      remixableDesc: '他のユーザーがあなたの作品をリミックスできます。',
      settingsNote: '公開後、これらの設定は Taluna で変更できません。調整するには Rezona へ。',
      postCta: 'Rezona に投稿',
      postFooter: '公開した瞬間にコミュニティへ表示されます。',
      posting: '投稿中…',
      publishedTitle: 'Rezona に公開しました',
      noVersion: '公開するにはまずバージョンをビルドしてください。',
      err: {
        generic: '問題が発生しました。もう一度お試しください。',
        bindExpired: '連携の有効期限が切れました。再度スキャンしてください。',
        versionNotFound: 'バージョンが見つかりません。ビルド済みを選択してください。',
        validation: 'フォームの入力を確認してください。',
        cover: 'カバーが無効です。デフォルトのカバーを使用します。',
        idempotency: '競合を検出しました。再試行中…',
        tooLarge: 'ビルドがサイズ上限を超えています。',
        unavailable: 'Rezona は利用できません。後でお試しください。',
      },
    },
```

vi.ts：
```ts
    fileMenu: { shareToRezona: 'Chia sẻ lên Rezona' },
    rezona: {
      badge: 'Post to Rezona',
      linkTitle: 'Liên kết tài khoản Rezona',
      linkSubtitle: 'Quét mã bằng ứng dụng Rezona',
      linkInstruction: 'Mở Rezona → Cài đặt ứng dụng ở góc trên bên phải trang cá nhân → Quét ở góc trên bên phải trang cài đặt',
      qrExpired: 'Mã QR đã hết hạn',
      refresh: 'Làm mới',
      rejected: 'Quét bị từ chối: {{reason}}',
      resolving: 'Đang tải…',
      switchAccount: 'Đổi',
      previewLabel: 'XEM TRƯỚC',
      coverHint: 'Mở Xem trước để chụp, hoặc tải ảnh bìa tùy chỉnh.',
      gameTitle: 'TÊN TRÒ CHƠI',
      titlePlaceholder: 'Tiêu đề',
      briefIntro: 'Giới thiệu ngắn',
      briefPlaceholder: 'Giới thiệu trò chơi của bạn trong một câu...',
      public: 'Công khai',
      publicDesc: 'Mọi người đều thấy',
      sync: 'Đồng bộ tới cộng đồng',
      syncDesc: 'Xuất hiện trong bảng tin Rezona',
      remixable: 'Cho phép remix',
      remixableDesc: 'Người khác có thể remix từ tác phẩm của bạn.',
      settingsNote: 'Các thiết lập trên không thể sửa trong Taluna sau khi phát hành. Cần điều chỉnh, hãy vào Rezona.',
      postCta: 'Đăng lên Rezona',
      postFooter: 'Hiển thị với cộng đồng ngay khi phát hành.',
      posting: 'Đang đăng…',
      publishedTitle: 'Đã đăng lên Rezona',
      noVersion: 'Hãy build một phiên bản trước khi phát hành.',
      err: {
        generic: 'Đã xảy ra lỗi. Vui lòng thử lại.',
        bindExpired: 'Liên kết đã hết hạn. Vui lòng quét lại.',
        versionNotFound: 'Không tìm thấy phiên bản. Hãy chọn phiên bản đã build.',
        validation: 'Vui lòng kiểm tra các trường biểu mẫu.',
        cover: 'Ảnh bìa không hợp lệ. Dùng ảnh bìa mặc định.',
        idempotency: 'Phát hiện xung đột. Đang thử lại…',
        tooLarge: 'Bản build vượt quá giới hạn kích thước.',
        unavailable: 'Rezona không khả dụng. Vui lòng thử lại sau.',
      },
    },
```

- [ ] **Step 4: 跑 key 对齐测试 + 类型检查**

Run: `pnpm exec vitest run src/i18n/i18n.test.ts && pnpm exec tsc --noEmit`
Expected: `zh/vi/fr/ru/ja 的 key 集合与 en 完全一致` PASS；tsc 无错

- [ ] **Step 5: commit**

```bash
git add src/i18n/locales/
git commit -m "feat: 补 Rezona 发布流程 i18n 文案(六语)"
```

---

### Task 4: `Switch` 可复用开关组件

**Files:**
- Create: `src/components/ui/Switch.tsx`
- Test: `src/components/ui/Switch.test.tsx`

**Interfaces:**
- Produces：`export default function Switch(props: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string }): JSX.Element`

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/ui/Switch.test.tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Switch from './Switch';

afterEach(cleanup);

test('role=switch + aria-checked 反映 checked', () => {
  render(<Switch checked onChange={() => {}} ariaLabel="Public" />);
  const el = screen.getByRole('switch', { name: 'Public' });
  expect(el).toHaveAttribute('aria-checked', 'true');
});

test('点击切换回调传相反值', () => {
  const onChange = vi.fn();
  render(<Switch checked={false} onChange={onChange} ariaLabel="Public" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('disabled 时点击不回调', () => {
  const onChange = vi.fn();
  render(<Switch checked onChange={onChange} disabled ariaLabel="Public" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  expect(onChange).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/Switch.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（令牌化，对齐 Figma switch 组件 `1743:31418`：轨道 39×24，开态 accent）**

```tsx
// src/components/ui/Switch.tsx
'use client';

// 可复用开关(Figma switch 1743:31418):轨道 39×24,滑块 20;开态 accent 底,关/禁用走中性令牌。
// role=switch + aria-checked;disabled 降透明 + not-allowed;位移过渡加 motion-safe。
export default function Switch({
  checked, onChange, disabled = false, ariaLabel,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!checked); }}
      className={`relative inline-flex h-6 w-[39px] shrink-0 items-center rounded-full transition-colors duration-150 ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-2)]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow-[var(--shadow-btn)] transition-transform duration-150 motion-safe:will-change-transform ${
          checked ? 'translate-x-[17px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/Switch.test.tsx`
Expected: PASS（3 passed）

- [ ] **Step 5: commit**

```bash
git add src/components/ui/Switch.tsx src/components/ui/Switch.test.tsx
git commit -m "feat: 新增可复用 Switch 开关组件(令牌化,支持禁用置灰)"
```

---

### Task 5: eligibility store 字段 + `loadRezonaEligibility` action + bootstrap 接线

**Files:**
- Modify: `src/store/types.ts`（`ServerState` + `createInitialServerState` 加 `rezonaEligible`）
- Modify: `src/store/actions.ts`（加 `loadRezonaEligibility`，并入 return）
- Modify: `src/client/useProjectBootstrap.ts`（挂载触发一次）
- Test: `src/store/actions.test.ts`（加 rezona mock + 用例）

**Interfaces:**
- Consumes：`pgcApi.rezona.eligibility`（Task 2）
- Produces：`ServerState.rezonaEligible: boolean | null`；action `loadRezonaEligibility(): Promise<void>`

- [ ] **Step 1: 写失败测试（`src/store/actions.test.ts`）**

在文件顶部 `vi.mock('@/lib/pgc/client', …)` 的 `pgcApi` 对象里追加：

```ts
      rezona: { eligibility: vi.fn(), binding: vi.fn(), bind: vi.fn(), pollBind: vi.fn(), unbind: vi.fn(), publish: vi.fn() },
```

在文件末尾追加用例：

```ts
describe('loadRezonaEligibility(入口门控)', () => {
  test('eligible=true 写入 rezonaEligible', async () => {
    (api.rezona as unknown as { eligibility: ReturnType<typeof vi.fn> }).eligibility.mockResolvedValue({ eligible: true });
    await useStore.getState().loadRezonaEligibility();
    expect(useStore.getState().rezonaEligible).toBe(true);
  });

  test('403 REZONA_NOT_ELIGIBLE → false,不弹 Toast', async () => {
    (api.rezona as unknown as { eligibility: ReturnType<typeof vi.fn> }).eligibility
      .mockRejectedValue(new PgcError('REZONA_NOT_ELIGIBLE', 'no', 403));
    await useStore.getState().loadRezonaEligibility();
    expect(useStore.getState().rezonaEligible).toBe(false);
    expect(useStore.getState().lastError).toBeNull();
  });

  test('401 → 置 authRequired,不置 rezonaEligible', async () => {
    (api.rezona as unknown as { eligibility: ReturnType<typeof vi.fn> }).eligibility
      .mockRejectedValue(new PgcError('UNAUTHORIZED', 'x', 401));
    await useStore.getState().loadRezonaEligibility();
    expect(useStore.getState().authRequired).toBe(true);
    expect(useStore.getState().rezonaEligible).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/actions.test.ts -t "loadRezonaEligibility"`
Expected: FAIL（`loadRezonaEligibility` 不是函数 / `rezonaEligible` undefined）

- [ ] **Step 3a: `src/store/types.ts`**

`ServerState` 接口内（`lastError` 附近）加一行：

```ts
  rezonaEligible: boolean | null;   // 用户级:能否发布到 Rezona。null=未查;瞬态不持久化(随 bootstrap 重取)
```

`createInitialServerState()` 返回对象里加 `rezonaEligible: null,`。

- [ ] **Step 3b: `src/store/actions.ts`**

在 `loadUserInfo` 定义之后、`return { … }` 之前加：

```ts
  // 入口门控(用户级,一次会话查一次):合格才显示 Share to Rezona。
  // 403/404(不合格/功能关)及其余非 401 错误一律视为不合格(防御性,不弹 Toast);401 交给全局登录跳转。
  const loadRezonaEligibility = async () => {
    try {
      const data = await pgcApi.rezona.eligibility();
      set({ rezonaEligible: !!data.eligible });
    } catch (e) {
      if (e instanceof PgcError && e.status === 401) { set({ authRequired: true }); return; }
      set({ rezonaEligible: false });
    }
  };
```

并把 `loadRezonaEligibility` 加进 `return { … }`（与 `loadUserInfo` 并列）。

- [ ] **Step 4: 跑 store 测试确认通过**

Run: `pnpm exec vitest run src/store/actions.test.ts && pnpm exec tsc --noEmit`
Expected: 新增 3 用例 PASS；tsc 无错

- [ ] **Step 5: bootstrap 接线（`src/client/useProjectBootstrap.ts`）**

在 `useProjectBootstrap` 内取 action 并在 effect 内一次性触发（放在 `ran.current = true` 之后、remix/prelude 分支之前，保证任何入口路径都触发一次）：

```ts
  const loadRezonaEligibility = useStore((s) => s.loadRezonaEligibility);
  // …effect 内:
    ran.current = true;
    void loadRezonaEligibility();   // 用户级能力,一次会话查一次(自身静默失败)
```

并把 `loadRezonaEligibility` 加进 effect 依赖数组。

- [ ] **Step 6: 类型检查 + commit**

Run: `pnpm exec tsc --noEmit`
Expected: 无错

```bash
git add src/store/types.ts src/store/actions.ts src/store/actions.test.ts src/client/useProjectBootstrap.ts
git commit -m "feat: Rezona 入口门控(eligibility 进项目查一次存 store)"
```

---

### Task 6: `FileMenu` 下拉组件

**Files:**
- Create: `src/components/preview/FileMenu.tsx`
- Test: `src/components/preview/FileMenu.test.tsx`

**Interfaces:**
- Consumes：i18n `preview.shareGame` / `preview.fileMenu.shareToRezona`（Task 3）；`figAsset`/`FigIcon`（`@/components/ui/figma`）。
- Produces：`export default function FileMenu(props: { onClose: () => void; onShareGame: () => void; onShareToRezona: () => void; showRezona: boolean }): JSX.Element`

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/preview/FileMenu.test.tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import FileMenu from './FileMenu';

afterEach(cleanup);
const noop = () => {};

test('showRezona=true 渲染两项;点击各触发回调 + onClose', () => {
  const onShareGame = vi.fn(); const onShareToRezona = vi.fn(); const onClose = vi.fn();
  render(<FileMenu onClose={onClose} onShareGame={onShareGame} onShareToRezona={onShareToRezona} showRezona />);
  fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
  expect(onShareGame).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Share to Rezona' }));
  expect(onShareToRezona).toHaveBeenCalled();
});

test('showRezona=false 不渲染 Rezona 项', () => {
  render(<FileMenu onClose={noop} onShareGame={noop} onShareToRezona={noop} showRezona={false} />);
  expect(screen.queryByRole('button', { name: 'Share to Rezona' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Share game' })).toBeInTheDocument();
});

test('Esc 触发 onClose', () => {
  const onClose = vi.fn();
  render(<FileMenu onClose={onClose} onShareGame={noop} onShareToRezona={noop} showRezona />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/FileMenu.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现（仿 `ProjectMenu` 锚定下拉范式）**

```tsx
// src/components/preview/FileMenu.tsx
'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 预览面板 File menu(Figma 1527:41218 内):锚定顶栏分享钮的下拉。
// Share Game 复用现有 SharePopover;Share to Rezona 由 eligibility 门控(showRezona)。
// 范式对齐 ProjectMenu:全屏点击遮罩关闭 + anim-pop-in + pop 面 + Esc 关闭。
export default function FileMenu({
  onClose, onShareGame, onShareToRezona, showRezona,
}: { onClose: () => void; onShareGame: () => void; onShareToRezona: () => void; showRezona: boolean }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const itemCls = 'flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]';
  const labelCls = 'min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]';

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div className="anim-pop-in origin-top-left absolute left-0 top-[calc(100%+4px)] z-50 flex w-[220px] flex-col items-start overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-[8px] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        <button type="button" className={itemCls} onClick={() => { onShareGame(); onClose(); }}>
          <FigIcon src={figAsset.forward} size={16} flipX />
          <span className={labelCls}>{t('preview.shareGame')}</span>
        </button>
        {showRezona && (
          <button type="button" className={itemCls} onClick={() => { onShareToRezona(); onClose(); }}>
            <FigIcon src={figAsset.forward} size={16} />
            <span className={labelCls}>{t('preview.fileMenu.shareToRezona')}</span>
          </button>
        )}
      </div>
    </>
  );
}
```

> **Figma 对齐（执行时）**：`get_design_context(1527:41218)` 抓 File menu 精确宽/圆角/图标（Rezona 项若有专属图标，落 `public/figma/icons/` 并在 `figAsset` 登记，tone 按 `ICON_TONE`；临时资产事后清理）。当前用 `figAsset.forward` 占位。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/FileMenu.test.tsx`
Expected: PASS（3 passed）

- [ ] **Step 5: commit**

```bash
git add src/components/preview/FileMenu.tsx src/components/preview/FileMenu.test.tsx
git commit -m "feat: File menu 下拉(Share Game + Share to Rezona,eligibility 门控)"
```

---

### Task 7: `useRezonaBindPoll` 轮询 hook

**Files:**
- Create: `src/client/useRezonaBindPoll.ts`
- Test: `src/client/useRezonaBindPoll.test.tsx`

**Interfaces:**
- Consumes：`pgcApi.rezona.pollBind`（Task 2）、`POLL_INTERVAL_MS`/`POLL_TIMEOUT_MS`（Task 1）、`RezonaBindSessionData`（Task 2 类型）。
- Produces：`export function useRezonaBindPoll(sessionId: string | null, onTerminal: (r: RezonaBindSessionData) => void): void`
  - 语义：`sessionId` 非空即每 `POLL_INTERVAL_MS` 轮询 `pollBind`；`status !== 'pending'` 或超时→`onTerminal` 一次并停；单次网络失败跳过（下轮再试）；卸载/`sessionId` 变化清 interval。`onTerminal` 须由调用方 `useCallback` 记忆化。

- [ ] **Step 1: 写失败测试（假计时器 + mock pgcApi）**

```tsx
// src/client/useRezonaBindPoll.test.tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRezonaBindPoll } from './useRezonaBindPoll';

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return { ...actual, pgcApi: { ...actual.pgcApi, rezona: { pollBind: vi.fn() } } };
});
import { pgcApi } from '@/lib/pgc/client';
const pollBind = (pgcApi.rezona as unknown as { pollBind: ReturnType<typeof vi.fn> }).pollBind;

function Probe({ sid, onTerminal }: { sid: string | null; onTerminal: (r: unknown) => void }) {
  useRezonaBindPoll(sid, onTerminal);
  return null;
}

beforeEach(() => { vi.useFakeTimers(); pollBind.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

test('confirmed 时回调一次并停止后续轮询', async () => {
  pollBind.mockResolvedValueOnce({ status: 'pending' })
          .mockResolvedValueOnce({ status: 'confirmed', account: { id: 'u1' } });
  const onTerminal = vi.fn();
  render(<Probe sid="s1" onTerminal={onTerminal} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); // 第一次 pending
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); // 第二次 confirmed
  expect(onTerminal).toHaveBeenCalledTimes(1);
  expect(onTerminal).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); // 已停,不再调
  expect(onTerminal).toHaveBeenCalledTimes(1);
});

test('sessionId=null 不轮询', async () => {
  render(<Probe sid={null} onTerminal={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(pollBind).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useRezonaBindPoll.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/client/useRezonaBindPoll.ts
'use client';
import { useEffect } from 'react';
import { pgcApi } from '@/lib/pgc/client';
import { POLL_INTERVAL_MS, POLL_TIMEOUT_MS } from '@/lib/rezona/publish';
import type { RezonaBindSessionData } from '@/lib/pgc/types';

// 绑定会话轮询:sessionId 非空即每 2.5s 轮询;终态/超时回调一次并停;单次失败跳过;卸载清理。
// onTerminal 须由调用方 useCallback 记忆化(作 effect 依赖)。
export function useRezonaBindPoll(
  sessionId: string | null,
  onTerminal: (r: RezonaBindSessionData) => void,
): void {
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const data = await pgcApi.rezona.pollBind(sessionId);
        if (stopped) return;
        if (data.status !== 'pending') { stopped = true; clearInterval(id); onTerminal(data); return; }
      } catch {
        // 单次网络失败:跳过,下个 interval 再试(不炸整流程)
      }
      if (!stopped && Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        stopped = true; clearInterval(id); onTerminal({ status: 'expired' });
      }
    };
    const id = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [sessionId, onTerminal]);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useRezonaBindPoll.test.tsx`
Expected: PASS（2 passed）

- [ ] **Step 5: commit**

```bash
git add src/client/useRezonaBindPoll.ts src/client/useRezonaBindPoll.test.tsx
git commit -m "feat: Rezona 绑定会话轮询 hook(2.5s/终态/超时/卸载清理)"
```

---

### Task 8: Rezona 步骤子件（LinkStep / PublishForm / PostingStep / PublishedStep）

**Files:**
- Create: `src/components/preview/rezona/LinkStep.tsx`
- Create: `src/components/preview/rezona/PublishForm.tsx`
- Create: `src/components/preview/rezona/PostingStep.tsx`
- Create: `src/components/preview/rezona/PublishedStep.tsx`
- Test: `src/components/preview/rezona/PublishForm.test.tsx`
- Test: `src/components/preview/rezona/PublishedStep.test.tsx`

**Interfaces:**
- Consumes：`Switch`（Task 4）、i18n（Task 3）、`figAsset`/`FigIcon`、`RezonaAccount`（类型）、`PublishToggles`/`normalizePublishToggles`（Task 1）。
- Produces：
  - `LinkStep(props: { qrImage: string | null; expired: boolean; onRefresh: () => void; rejectedReason?: string })`
  - `interface PublishFormValue { name: string; summary: string; toggles: PublishToggles }`
  - `PublishForm(props: { account: RezonaAccount; coverUrl?: string; value: PublishFormValue; onChange: (v: PublishFormValue) => void; onSwitchAccount: () => void; onSubmit: () => void })`
  - `PostingStep(): JSX.Element`
  - `PublishedStep(props: { shareUrl: string })`

- [ ] **Step 1: 写失败测试（PublishForm 的 R11 联动 + PublishedStep 复制）**

```tsx
// src/components/preview/rezona/PublishForm.test.tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PublishForm, { type PublishFormValue } from './PublishForm';

afterEach(cleanup);
const base: PublishFormValue = { name: 'My Game', summary: '', toggles: { public: true, remixable: true, sync_to_community: true } };

test('关闭 Public 时 remixable 归 false 且置灰(R11)', () => {
  const onChange = vi.fn();
  render(<PublishForm account={{ id: 'u1', name: 'nick' }} value={base} onChange={onChange}
    onSwitchAccount={() => {}} onSubmit={() => {}} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  // R11:onChange 收到的新值里 remixable 应为 false
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    toggles: expect.objectContaining({ public: false, remixable: false }),
  }));
});

test('Post to Rezona 触发 onSubmit', () => {
  const onSubmit = vi.fn();
  render(<PublishForm account={{ id: 'u1', name: 'nick' }} value={base} onChange={() => {}}
    onSwitchAccount={() => {}} onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  expect(onSubmit).toHaveBeenCalled();
});
```

```tsx
// src/components/preview/rezona/PublishedStep.test.tsx
import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PublishedStep from './PublishedStep';

afterEach(cleanup);

test('展示 share_url;点复制写剪贴板', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<PublishedStep shareUrl="https://rezona.app/p/ganbei" />);
  expect(screen.getByText('Published to Rezona')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith('https://rezona.app/p/ganbei');
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/rezona/`
Expected: FAIL（模块不存在）

- [ ] **Step 3a: `PostingStep.tsx`**

```tsx
// src/components/preview/rezona/PostingStep.tsx
'use client';
import { useTranslation } from 'react-i18next';

export default function PostingStep() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 py-10">
      <span role="status" aria-label={t('preview.rezona.posting')}
        className="block size-8 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />
      <span className="text-[18px] font-semibold text-[var(--color-ink)]">{t('preview.rezona.posting')}</span>
    </div>
  );
}
```

- [ ] **Step 3b: `LinkStep.tsx`**

```tsx
// src/components/preview/rezona/LinkStep.tsx
'use client';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/ui/Button';

// 扫码绑定步骤:标题/副标题 + info 图标(装饰) + QR(后端 qr_image base64) + 底部说明;过期显示刷新。
export default function LinkStep({
  qrImage, expired, onRefresh, rejectedReason,
}: { qrImage: string | null; expired: boolean; onRefresh: () => void; rejectedReason?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <span className="text-[20px] font-semibold text-[var(--color-ink)]">{t('preview.rezona.linkTitle')}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[13px] text-[var(--color-muted)]">{t('preview.rezona.linkSubtitle')}</span>
        <Info size={16} className="text-[var(--color-muted)]" aria-hidden="true" />
      </div>
      <div className="mx-auto my-2 grid size-[204px] place-items-center overflow-hidden rounded-[12px] bg-white">
        {qrImage
          ? <img src={qrImage} alt="" width={204} height={204} className="size-full object-contain" />
          : <span role="status" aria-label={t('preview.rezona.resolving')}
              className="block size-6 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />}
      </div>
      {rejectedReason && (
        <span className="text-[13px] text-[#e5484d]">{t('preview.rezona.rejected', { reason: rejectedReason })}</span>
      )}
      {expired
        ? <div className="flex flex-col items-center gap-2">
            <span className="text-[13px] text-[var(--color-muted)]">{t('preview.rezona.qrExpired')}</span>
            <Button type="button" onClick={onRefresh}>{t('preview.rezona.refresh')}</Button>
          </div>
        : <p className="text-[12px] leading-[16px] text-[var(--color-muted)]">{t('preview.rezona.linkInstruction')}</p>}
    </div>
  );
}
```

- [ ] **Step 3c: `PublishForm.tsx`**

```tsx
// src/components/preview/rezona/PublishForm.tsx
'use client';
import { Repeat, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Switch from '@/components/ui/Switch';
import Button from '@/components/ui/Button';
import { normalizePublishToggles, type PublishToggles } from '@/lib/rezona/publish';
import type { RezonaAccount } from '@/lib/pgc/types';

export interface PublishFormValue { name: string; summary: string; toggles: PublishToggles }

// 发布表单(Figma 1174:33713):账号行 + 只读版本封面 + 标题/简介 + 三开关(R11) + 说明 + CTA。
// 本期封面只读(cover_ref 恒 version_cover),不做自定义封面控件。
export default function PublishForm({
  account, coverUrl, value, onChange, onSwitchAccount, onSubmit,
}: {
  account: RezonaAccount; coverUrl?: string; value: PublishFormValue;
  onChange: (v: PublishFormValue) => void; onSwitchAccount: () => void; onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const setToggle = (patch: Partial<PublishToggles>) =>
    onChange({ ...value, toggles: normalizePublishToggles({ ...value.toggles, ...patch }) });
  const label = 'text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--color-muted)]';
  const toggleRow = (name: string, key: keyof PublishToggles, title: string, desc: string, disabled = false) => (
    <div className="flex items-center justify-between">
      <div className="flex min-w-0 flex-col">
        <span className={`text-[14px] font-medium text-[var(--color-ink)] ${disabled ? 'opacity-50' : ''}`}>{title}</span>
        <span className="text-[12px] text-[var(--color-muted)]">{desc}</span>
      </div>
      <Switch ariaLabel={name} checked={value.toggles[key]} disabled={disabled}
        onChange={(v) => setToggle({ [key]: v } as Partial<PublishToggles>)} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 账号行 */}
      <div className="flex items-center gap-2">
        {account.avatar_url
          ? <img src={account.avatar_url} alt="" width={40} height={40} className="size-10 rounded-full object-cover" />
          : <span className="size-10 rounded-full bg-[var(--color-fill)]" />}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[var(--color-ink)]">
          {account.name ? `@${account.name}` : `@${account.id}`}
        </span>
        <button type="button" onClick={onSwitchAccount}
          className="flex items-center gap-1 rounded-[10px] bg-[var(--color-fill)] px-3 py-1.5 text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]">
          <Repeat size={16} /> {t('preview.rezona.switchAccount')}
        </button>
      </div>

      {/* 封面(只读版本封面) */}
      <div className="flex flex-col gap-2">
        <span className={label}>{t('preview.rezona.previewLabel')}</span>
        <div className="flex gap-3">
          <div className="size-[126px] shrink-0 overflow-hidden rounded-[12px] bg-[var(--color-fill)]">
            {coverUrl && <img src={coverUrl} alt="" className="size-full object-cover" />}
          </div>
          <p className="flex-1 text-[12px] leading-[16px] text-[var(--color-muted)]">{t('preview.rezona.coverHint')}</p>
        </div>
      </div>

      {/* 标题 */}
      <label className="flex flex-col gap-2">
        <span className={label}>{t('preview.rezona.gameTitle')}</span>
        <input value={value.name} maxLength={255} placeholder={t('preview.rezona.titlePlaceholder')}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
          className="h-11 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]" />
      </label>

      {/* 简介 */}
      <label className="flex flex-col gap-2">
        <span className={label}>{t('preview.rezona.briefIntro')}</span>
        <textarea value={value.summary} maxLength={2000} rows={2} placeholder={t('preview.rezona.briefPlaceholder')}
          onChange={(e) => onChange({ ...value, summary: e.target.value })}
          className="resize-none rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 py-2 text-[14px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]" />
      </label>

      <div className="h-px bg-[var(--color-line)]" />

      {/* 三开关(R11:public 关时 remixable 置灰) */}
      <div className="flex flex-col gap-3">
        {toggleRow(t('preview.rezona.public'), 'public', t('preview.rezona.public'), t('preview.rezona.publicDesc'))}
        {toggleRow(t('preview.rezona.sync'), 'sync_to_community', t('preview.rezona.sync'), t('preview.rezona.syncDesc'))}
        {toggleRow(t('preview.rezona.remixable'), 'remixable', t('preview.rezona.remixable'), t('preview.rezona.remixableDesc'), !value.toggles.public)}
      </div>

      <p className="text-[12px] leading-[16px] text-[var(--color-muted)]">{t('preview.rezona.settingsNote')}</p>

      <Button type="button" onClick={onSubmit} className="w-full justify-center">
        <Rocket size={16} /> {t('preview.rezona.postCta')}
      </Button>
      <span className="text-center text-[12px] text-[var(--color-muted)]">{t('preview.rezona.postFooter')}</span>
    </div>
  );
}
```

- [ ] **Step 3d: `PublishedStep.tsx`**

```tsx
// src/components/preview/rezona/PublishedStep.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import Button from '@/components/ui/Button';

// 发布成功:✓ + 标题 + share_url + 复制(复用 SharePopover 剪贴板容错范式)。
export default function PublishedStep({ shareUrl }: { shareUrl: string }) {
  const { t } = useTranslation();
  const setError = useStore((s) => s.setError);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ code: 'CLIPBOARD', message: 'Copy failed, please copy manually', kind: 'warning' });
    }
  };
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <FigIcon src={figAsset.checkCircle} size={48} tone="original" />
      <span className="text-[20px] font-semibold text-[var(--color-ink)]">{t('preview.rezona.publishedTitle')}</span>
      <div className="flex w-full items-center gap-2">
        <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-[12px] border border-[var(--color-line-2)] bg-[var(--color-fill)] px-3 text-[13px] text-[var(--color-ink)] outline-none" />
        <Button type="button" aria-label={t('preview.copyLink')} className="h-11 shrink-0 px-4" onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? t('preview.copied') : t('preview.copy')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/rezona/`
Expected: PASS（PublishForm 2 + PublishedStep 1）

- [ ] **Step 5: commit**

```bash
git add src/components/preview/rezona/
git commit -m "feat: Rezona 发布流程步骤子件(LinkStep/PublishForm/PostingStep/PublishedStep)"
```

---

### Task 9: `RezonaPublishModal` 状态机编排

**Files:**
- Create: `src/components/preview/RezonaPublishModal.tsx`
- Test: `src/components/preview/RezonaPublishModal.test.tsx`

**Interfaces:**
- Consumes：`pgcApi.rezona`（Task 2）、`useRezonaBindPoll`（Task 7）、步骤子件（Task 8）、`newIdempotencyKey`/`normalizePublishToggles`/`mapRezonaError`（Task 1）、`useRequestClose`（现有 `@/client/useRequestClose`）、`Version` 类型（`@/store/types`）、`useStore`（setError）。
- Produces：`export default function RezonaPublishModal(props: { projectId: number; version: Version | null; onClose: () => void }): JSX.Element`

- [ ] **Step 1: 写失败测试（注入 mock pgcApi + 假计时器）**

```tsx
// src/components/preview/RezonaPublishModal.test.tsx
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return { ...actual, pgcApi: { ...actual.pgcApi, rezona: {
    eligibility: vi.fn(), binding: vi.fn(), bind: vi.fn(), pollBind: vi.fn(), unbind: vi.fn(), publish: vi.fn(),
  } } };
});
import RezonaPublishModal from './RezonaPublishModal';
import { pgcApi } from '@/lib/pgc/client';
const rezona = pgcApi.rezona as unknown as Record<string, ReturnType<typeof vi.fn>>;

const version = { id: 'v3', index: 3, label: 'Version 3', summary: '', createdAt: '', current: true, cover: 'https://c/x.png', assetKeys: [], game: { title: 'Nightcap', palette: '' } };

beforeEach(() => { Object.values(rezona).forEach((f) => f.mockReset()); });
afterEach(cleanup);

test('binding=bound → 直接进发布表单', async () => {
  rezona.binding.mockResolvedValue({ state: 'bound', account: { id: 'u1', name: 'nick' } });
  render(<RezonaPublishModal projectId={42} version={version} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Post to Rezona' })).toBeInTheDocument());
  expect(screen.getByDisplayValue('Nightcap')).toBeInTheDocument(); // name 默认取 version.game.title
});

test('binding=unbound → 扫码;发布成功 → published(share_url)', async () => {
  rezona.binding.mockResolvedValue({ state: 'unbound' });
  rezona.bind.mockResolvedValue({ session_id: 's1', qr_content: '', qr_image: 'data:image/png;base64,AA', expires_at: '2999-01-01T00:00:00Z' });
  rezona.pollBind.mockResolvedValue({ status: 'confirmed', account: { id: 'u1', name: 'nick' } });
  rezona.publish.mockResolvedValue({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  vi.useFakeTimers();
  render(<RezonaPublishModal projectId={42} version={version} onClose={() => {}} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });     // binding 解析 → link
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });  // 轮询 confirmed → form
  vi.useRealTimers();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Post to Rezona' })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(screen.getByText('Published to Rezona')).toBeInTheDocument());
  expect(rezona.publish).toHaveBeenCalledWith(42, expect.objectContaining({ version_id: 'v3', name: 'Nightcap' }));
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/RezonaPublishModal.test.tsx`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```tsx
// src/components/preview/RezonaPublishModal.tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useRequestClose } from '@/client/useRequestClose';
import { useRezonaBindPoll } from '@/client/useRezonaBindPoll';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { newIdempotencyKey, mapRezonaError } from '@/lib/rezona/publish';
import type { Version } from '@/store/types';
import type { RezonaAccount, RezonaBindSessionData } from '@/lib/pgc/types';
import LinkStep from './rezona/LinkStep';
import PublishForm, { type PublishFormValue } from './rezona/PublishForm';
import PostingStep from './rezona/PostingStep';
import PublishedStep from './rezona/PublishedStep';

type Step = 'resolving' | 'link' | 'form' | 'posting' | 'published';

export default function RezonaPublishModal({
  projectId, version, onClose,
}: { projectId: number; version: Version | null; onClose: () => void }) {
  const { t } = useTranslation();
  const setError = useStore((s) => s.setError);
  const { closing, requestClose } = useRequestClose(onClose, 200);

  const [step, setStep] = useState<Step>('resolving');
  const [account, setAccount] = useState<RezonaAccount | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [rejected, setRejected] = useState<string | undefined>(undefined);
  const [shareUrl, setShareUrl] = useState('');
  const [form, setForm] = useState<PublishFormValue>({
    name: '', summary: '',
    toggles: { public: true, remixable: true, sync_to_community: true },
  });
  const idemKey = useRef<string>(newIdempotencyKey());

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  // 进表单:name 默认取版本游戏名
  const enterForm = useCallback((acc: RezonaAccount) => {
    setAccount(acc);
    setForm((f) => ({ ...f, name: f.name || version?.game.title || '' }));
    setStep('form');
  }, [version]);

  // 打开:查绑定态
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const b = await pgcApi.rezona.binding();
        if (!alive) return;
        if (b.state === 'bound' && b.account) enterForm(b.account);
        else void startBind();
      } catch (e) {
        if (!alive) return;
        if (e instanceof PgcError && e.status === 401) { setError({ authRequired: true } as never); }
        void startBind();
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅打开时执行一次
  }, []);

  // 发起扫码(过期刷新亦复用)
  const startBind = useCallback(async () => {
    setExpired(false); setRejected(undefined); setQrImage(null); setStep('link');
    try {
      const d = await pgcApi.rezona.bind();
      setSessionId(d.session_id); setQrImage(d.qr_image);
    } catch (e) {
      if (e instanceof PgcError) setError({ code: e.code, message: e.message });
    }
  }, [setError]);

  // 轮询终态处理
  const onTerminal = useCallback((r: RezonaBindSessionData) => {
    setSessionId(null);
    if (r.status === 'confirmed' && r.account) enterForm(r.account);
    else if (r.status === 'rejected') setRejected(r.reason || 'rejected');
    else setExpired(true); // expired
  }, [enterForm]);
  useRezonaBindPoll(sessionId, onTerminal);

  // 切换账号:解绑 → 回扫码
  const switchAccount = useCallback(async () => {
    try { await pgcApi.rezona.unbind(); } catch { /* 幂等,忽略 */ }
    idemKey.current = newIdempotencyKey();
    void startBind();
  }, [startBind]);

  // 发布
  const submit = useCallback(async () => {
    if (!version) { setError({ code: 'VERSION_NOT_FOUND', message: t('preview.rezona.noVersion'), kind: 'warning' }); return; }
    setStep('posting');
    try {
      const res = await pgcApi.rezona.publish(projectId, {
        version_id: `v${version.index}`,
        name: form.name.trim() || version.game.title,
        summary: form.summary.trim(),
        cover_ref: 'version_cover',
        public: form.toggles.public,
        remixable: form.toggles.remixable,
        sync_to_community: form.toggles.sync_to_community,
        idempotency_key: idemKey.current,
      });
      setShareUrl(res.share_url); setStep('published');
    } catch (e) {
      if (e instanceof PgcError) {
        const ux = mapRezonaError(e.code);
        setError({ code: e.code, message: t(ux.messageKey) });
        if (ux.restartBinding) { idemKey.current = newIdempotencyKey(); void startBind(); }
        else setStep('form');
      } else { setStep('form'); throw e; }
    }
  }, [projectId, version, form, startBind, setError, t]);

  return (
    <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center bg-black/40 p-8" data-closing={closing} onClick={requestClose}>
      <div onClick={(e) => e.stopPropagation()} data-closing={closing}
        className="modal-pop flex max-h-[85vh] w-[400px] flex-col overflow-y-auto scrollbar-none rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[1px] text-[var(--color-accent)]">
            {`> ${t('preview.rezona.badge')}`}
          </span>
          <button type="button" aria-label="Close" onClick={requestClose}
            className="grid size-6 place-items-center rounded-[6px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-fill)]">
            <X size={16} />
          </button>
        </div>
        {step === 'resolving' && (
          <div className="grid min-h-[200px] place-items-center">
            <span role="status" aria-label={t('preview.rezona.resolving')}
              className="block size-6 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-accent)]" />
          </div>
        )}
        {step === 'link' && <LinkStep qrImage={qrImage} expired={expired} rejectedReason={rejected} onRefresh={() => void startBind()} />}
        {step === 'form' && account && (
          <PublishForm account={account} coverUrl={version?.cover} value={form} onChange={setForm}
            onSwitchAccount={() => void switchAccount()} onSubmit={() => void submit()} />
        )}
        {step === 'posting' && <PostingStep />}
        {step === 'published' && <PublishedStep shareUrl={shareUrl} />}
      </div>
    </div>
  );
}
```

> 注：`setError({ authRequired: true } as never)` 是占位——实际应调 store 的 `authRequired`。执行时改为在 `binding()` catch 内 `if (e.status === 401) useStore.getState().clearAuthRequired?.()`……**改用现有范式**：直接 `set({ authRequired })` 不可从组件调；改为忽略 401（bootstrap 的 loadRezonaEligibility 已处理登录态），catch 里仅 `void startBind()`。执行时删除该行 `setError(... as never)`，401 与其它错误一并回落到 `startBind()`（登录态由全局链路兜底）。

- [ ] **Step 3-fix: 清理 401 占位**

把 `binding()` 的 catch 改为：

```ts
      } catch {
        if (!alive) return;
        void startBind();  // 查询失败(含 401)一律回落到扫码;登录跳转由全局鉴权链路处理
      }
```

删除未用的 `PgcError` 于该处的 401 分支（`submit`/`startBind` 仍用 `PgcError`，保留 import）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/RezonaPublishModal.test.tsx && pnpm exec tsc --noEmit`
Expected: 2 用例 PASS；tsc 无错

- [ ] **Step 5: commit**

```bash
git add src/components/preview/RezonaPublishModal.tsx src/components/preview/RezonaPublishModal.test.tsx
git commit -m "feat: RezonaPublishModal 状态机(绑定查询/扫码轮询/发布/成功编排)"
```

---

### Task 10: `PreviewPanel` 接线（File menu + Rezona 模态）

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`
- Test: `src/components/preview/PreviewPanel.test.tsx`（新增用例）

**Interfaces:**
- Consumes：`FileMenu`（Task 6）、`RezonaPublishModal`（Task 9）、`store.rezonaEligible`（Task 5）、现有 `SharePopover`。

- [ ] **Step 1: 写失败测试（追加到 `PreviewPanel.test.tsx`）**

> 参考文件内现有 render 辅助/store 预置方式（复用其顶部 setup）。新增：

```tsx
test('点触发钮出现 File menu;点 Share game 出 SharePopover', async () => {
  // 预置:有游戏 + shareUrl 可用(沿用文件内既有的 store 预置 helper)
  // …seedStoreWithGame()…
  render(<PreviewPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument());
});

test('rezonaEligible=true 时 File menu 含 Share to Rezona;否则不含', () => {
  useStore.setState({ rezonaEligible: false });
  render(<PreviewPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.queryByRole('button', { name: 'Share to Rezona' })).toBeNull();
});
```

> 若 `PreviewPanel.test.tsx` 尚无「有游戏」预置 helper，则在用例内用 `useStore.setState({ versions:[…], activeVersionId, projects:[{…public_id}], currentProjectId })` 直接铺满（参考 Task 9 的 `version` 工厂与 actions.test 的 `proj` 工厂）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: FAIL（触发钮点开后无 File menu / 直接开了 SharePopover）

- [ ] **Step 3: 改 `PreviewPanel.tsx`**

3a. import：

```tsx
import FileMenu from './FileMenu';
import RezonaPublishModal from './RezonaPublishModal';
```

3b. 组件内新增本地态 + 读 eligibility：

```tsx
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [rezonaOpen, setRezonaOpen] = useState(false);
  const rezonaEligible = useStore((s) => s.rezonaEligible);
```

3c. 触发钮：外包 `relative` 锚点，`onClick` 改为 toggle，并挂 FileMenu。把原来的：

```tsx
        <Tooltip>
          <IconButton … onClick={() => setShareOpen(true)}>
            <FigIcon src={figAsset.forward} size={16} flipX />
          </IconButton>
        </Tooltip>
```

替换为：

```tsx
        <div className="relative shrink-0">
          <Tooltip>
            <IconButton
              variant="ghost"
              className="rounded-[8px]! bg-[var(--color-surface-2)] px-4 py-2"
              aria-label={t('preview.share')}
              disabled={!hasGame || !shareUrl}
              aria-expanded={fileMenuOpen}
              onClick={() => setFileMenuOpen((o) => !o)}
            >
              <FigIcon src={figAsset.forward} size={16} flipX />
            </IconButton>
          </Tooltip>
          {fileMenuOpen && (
            <FileMenu
              showRezona={rezonaEligible === true}
              onClose={() => setFileMenuOpen(false)}
              onShareGame={() => setShareOpen(true)}
              onShareToRezona={() => setRezonaOpen(true)}
            />
          )}
        </div>
```

3d. 底部模态渲染(现有 `{shareOpen && …}` 之后)追加：

```tsx
      {rezonaOpen && currentProjectId != null && (
        <RezonaPublishModal projectId={currentProjectId} version={active} onClose={() => setRezonaOpen(false)} />
      )}
```

- [ ] **Step 4: 跑测试 + 类型 + lint**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx && pnpm exec tsc --noEmit && pnpm lint`
Expected: 全绿

- [ ] **Step 5: commit**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/PreviewPanel.test.tsx
git commit -m "feat: PreviewPanel 顶栏分享钮改 File menu(Share Game/Share to Rezona 接线)"
```

---

### Task 11: 全量回归 + Figma 精确对齐 + 运行态验证

**Files:** 无新增（打磨既有）

- [ ] **Step 1: 全量测试 + 类型 + lint + 构建**

Run: `pnpm exec vitest run && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全绿（CI 五步等价）

- [ ] **Step 2: Figma 精确对齐**

对 `1527:41218`(File menu)、`1174:33248`(Link)、`1174:33713`(发布表单)、`1099:25061`(Posting/Published) 逐屏 `get_design_context` 取精确 px/字号/图标/间距；核对本实现（取精确 px + 渲染 mock 逐项比对，列对照表后再宣称"已对齐"）。新图标落 `public/figma/icons/` 并在 `figAsset` 登记；临时导出资产事后清理（勿把无关资产留在 `public/figma`）。

- [ ] **Step 3: 运行态验证（/run 或本地起服务）**

用 `verify` skill 或本地起 prod（Turbopack dev 受 Google Fonts 墙影响时改跑 `pnpm build && pnpm start`）：注入含 `rezonaEligible`/`versions`/`projects` 的完整 store 态，逐态截图 File menu → Link → Form(R11 联动) → Posting → Published，比对设计稿。

- [ ] **Step 4: commit（若有对齐微调）**

```bash
git add -A
git commit -m "feat: File menu + Rezona 发布流程按设计稿精确对齐(px/图标/间距)"
```

---

## Self-Review

**1. Spec 覆盖核对（对照 spec 各节）：**
- §3 契约端点 → Task 2（全 6 端点）✅ · 错误码→UX → Task 1 `mapRezonaError` + Task 9 消费 ✅
- §4 决策：封面 version_cover → Task 9 `cover_ref:'version_cover'` ✅ · eligibility 存 store → Task 5 ✅ · 发布当前预览版本 `v{index}` → Task 9 ✅ · R11 → Task 1 + Task 8 PublishForm ✅
- §5 分层落位 → Task 1(lib) 2(types/client) 5(store+bootstrap) 7(hook) 6/8/9/10(UI) 4(Switch) 3(i18n) ✅
- §6 状态机 → Task 9 ✅
- §7 组件 → Task 4/6/8/9/10 ✅
- §9 i18n → Task 3 ✅
- §10 Figma 对齐 → Task 6/11 ✅
- §11 错误处理/不变式 → Task 5(guard 静默)/7(单次失败跳过)/9(await 后 alive 校验) ✅
- §12 测试 → 各 Task 内 TDD + Task 11 回归 ✅

**2. 占位扫描：** 无 TBD/TODO；Task 9 的 401 占位已在 Step 3-fix 显式清除（给出确切替换代码）。✅

**3. 类型一致性：** `PublishToggles`(Task1)↔PublishForm/Modal 一致；`RezonaBindSessionData`(Task2)↔hook(Task7)/Modal(Task9) 一致；`PublishFormValue`(Task8)↔Modal(Task9) 一致；`FileMenu` props(Task6)↔PreviewPanel(Task10) 一致；`loadRezonaEligibility`/`rezonaEligible`(Task5)↔bootstrap/PreviewPanel 一致。✅

**已知执行注意：**
- Task 10 依赖 `PreviewPanel.test.tsx` 现有 store 预置方式；执行者先读该文件顶部 setup 再决定复用或自铺 `useStore.setState`。
- Task 9 的 `binding()` catch 按 Step 3-fix 落地（不引 `authRequired` 组件级写入）。
- lucide 图标（`X`/`Info`/`Repeat`/`Rocket`/`Check`/`Copy`）已在依赖内（`lucide-react` 现用）；`figAsset.checkCircle`/`forward` 已存在。
