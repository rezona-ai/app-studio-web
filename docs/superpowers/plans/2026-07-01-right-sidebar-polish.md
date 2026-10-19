# 完善右边栏(PreviewPanel)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计稿(Figma `1527-40918`)完善右边栏:账户条加语言下拉(切换同步回写主站 `taluna-config`)、面板宽度按游戏预览高度反推自适应、Versions 改竖向时间线。

**Architecture:** 纯逻辑(配置合并 `serializeHostConfigPatch`、宽度反推 `computePreviewWidth`、时间格式化 `formatVersionTime`)下沉到 `lib/` 单测;UI 复用 `Select`(新增 `triggerLabel`/`direction` 两个可选 prop 向后兼容);宽度经 store 瞬态字段 `previewWidth` 由 `GameFrame` 测量、`Workspace` 消费;Versions 时间线在 `VersionTimeline` 内重写并删除废弃的 `VersionCover`。

**Tech Stack:** Next 16 / React 19 / TypeScript / zustand + persist / react-i18next / Tailwind v4(令牌在 globals.css)/ Vitest + jsdom + Testing Library。

## Global Constraints

- 注释 / commit message 一律**中文**;注释解释「为什么」。
- **颜色只走 CSS 变量**(`--color-teal` #1fd4cf / `--color-accent` #3582ff / `--color-line` / `--color-line-2` / `--color-ink` / `--color-muted` / `--color-fill` / `--color-pop`),禁硬编码色值。
- **组件优先复用**:下拉用 `Select`;图标用 `FigIcon`;不新建按钮种类、不自造 toast、不写一次性 keyframes。
- Tailwind 类名必须是**字面量**(禁动态拼接 `origin-${...}`,否则 CSS 不生成)。
- store 是唯一真相源;瞬态字段**不进 persist partialize**;persist key 为 `taluna-v4`(勿改)。
- i18n 六语(en/zh/fr/ru/ja/vi),en 为源;新增文案补齐六套。母语名(English/中文/…)语言无关,**不进词典**。
- `eslint-disable` 必带 `-- 理由`;仓库禁 effect 内直接 setState —— 本计划的 setState 均在 ResizeObserver 回调 / 事件回调(非 effect 同步体),不触发该规则。
- 每步跑对应 `pnpm exec vitest run <file>`;最终跑 `pnpm test` + `pnpm lint` + `pnpm exec tsc --noEmit` + `pnpm build`。
- 工作目录:worktree `.claude/worktrees/feat+right-sidebar-i18n-width-versions`,分支 `worktree-feat+right-sidebar-i18n-width-versions`。

---

## Task 1: `serializeHostConfigPatch` 配置合并纯函数

**Files:**
- Modify: `src/lib/host-config.ts`
- Test: `src/lib/host-config.test.ts`

**Interfaces:**
- Consumes: 现有 `HostConfig`(`{ theme: 'light'|'dark'; lang?: string }`)。
- Produces: `serializeHostConfigPatch(rawExisting: string | null, patch: Partial<HostConfig>): string` —— 容错解析现有 JSON、浅合并 patch、返回序列化串。供 Task 3 的 LanguageMenu 写回 localStorage。

- [ ] **Step 1: 写失败测试**

在 `src/lib/host-config.test.ts` 末尾追加(文件已存在,保留原有 import 与用例;若无 `serializeHostConfigPatch` import 需补):

```ts
import { parseHostConfig, serializeHostConfigPatch } from './host-config';

test('serializeHostConfigPatch:合并写 lang 时保留既有 theme', () => {
  const out = serializeHostConfigPatch('{"theme":"light","lang":"en"}', { lang: 'zh' });
  expect(JSON.parse(out)).toEqual({ theme: 'light', lang: 'zh' });
});

test('serializeHostConfigPatch:现有为 null 时仅写入 patch', () => {
  const out = serializeHostConfigPatch(null, { lang: 'ja' });
  expect(JSON.parse(out)).toEqual({ lang: 'ja' });
});

test('serializeHostConfigPatch:非法 JSON 视作空对象,不抛错', () => {
  const out = serializeHostConfigPatch('not-json{', { lang: 'fr' });
  expect(JSON.parse(out)).toEqual({ lang: 'fr' });
});

test('serializeHostConfigPatch:保留 patch 未覆盖的其余字段', () => {
  const out = serializeHostConfigPatch('{"theme":"dark","lang":"en","extra":1}', { lang: 'vi' });
  expect(JSON.parse(out)).toEqual({ theme: 'dark', lang: 'vi', extra: 1 });
});
```

> 注:原 `host-config.test.ts` 顶部若已 `import { parseHostConfig } from './host-config';`,把它改成上面的合并 import(或另加一行 import `serializeHostConfigPatch`)。不要重复声明。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/host-config.test.ts`
Expected: FAIL —— `serializeHostConfigPatch is not a function` / 导出不存在。

- [ ] **Step 3: 实现**

在 `src/lib/host-config.ts` 末尾追加:

```ts
// 用户主动切换语言时,分站合并回写主站同源配置 localStorage['taluna-config'] 的纯逻辑:
// 容错解析现有(非法 / 空 → {}),浅合并 patch(仅覆盖给定字段,保留 theme 等),序列化。
// IO(读 / 写 localStorage)由调用方(LanguageMenu)负责,本函数无副作用。
export function serializeHostConfigPatch(rawExisting: string | null, patch: Partial<HostConfig>): string {
  let base: Record<string, unknown> = {};
  if (rawExisting) {
    try {
      const parsed = JSON.parse(rawExisting);
      if (parsed && typeof parsed === 'object') base = parsed as Record<string, unknown>;
    } catch {
      // 非法 JSON 视作空对象(沿用"非法帧 try/catch 跳过"哲学)
    }
  }
  return JSON.stringify({ ...base, ...patch });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/host-config.test.ts`
Expected: PASS(含原有 parseHostConfig 用例)。

- [ ] **Step 5: 提交**

```bash
git add src/lib/host-config.ts src/lib/host-config.test.ts
git commit -m "feat: host-config 增加 serializeHostConfigPatch(合并回写主站语言,保留 theme)"
```

---

## Task 2: `Select` 增加 `triggerLabel` 与 `direction`

**Files:**
- Modify: `src/components/ui/Select.tsx`
- Test: `src/components/ui/Select.test.tsx`(新建)

**Interfaces:**
- Consumes: 无。
- Produces: `Select` 新增两个**可选** prop:`triggerLabel?: string`(触发钮显示文本覆盖,菜单项仍显示 `label`)、`direction?: 'up' | 'down'`(默认 `'up'` 保持底部锚定既有行为;`'down'` 顶部锚定向下弹)。供 Task 3。

- [ ] **Step 1: 写失败测试**

新建 `src/components/ui/Select.test.tsx`:

```tsx
import { afterEach, expect, test } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Select from './Select';

afterEach(() => cleanup());

const OPTS = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

test('triggerLabel 覆盖触发钮显示文本(不显示完整 label)', () => {
  render(<Select value="en" options={OPTS} onChange={() => {}} triggerLabel="EN" ariaLabel="Language" />);
  const trigger = screen.getByRole('button', { name: 'Language' });
  expect(trigger).toHaveTextContent('EN');
  expect(trigger).not.toHaveTextContent('English');
});

test('未传 triggerLabel 时触发钮显示选中项 label(回归既有行为)', () => {
  render(<Select value="zh" options={OPTS} onChange={() => {}} ariaLabel="Lang" />);
  expect(screen.getByRole('button', { name: 'Lang' })).toHaveTextContent('中文');
});

test('展开后菜单项显示完整 label,点击回调选中值', () => {
  let picked = '';
  render(<Select value="en" options={OPTS} onChange={(v) => { picked = v; }} triggerLabel="EN" ariaLabel="Language" direction="down" />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  fireEvent.click(screen.getByRole('button', { name: '中文' }));
  expect(picked).toBe('zh');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/ui/Select.test.tsx`
Expected: FAIL —— triggerLabel 未生效(触发钮仍显示 "English")。

- [ ] **Step 3: 实现**

改 `src/components/ui/Select.tsx`。

(3a) 解构与类型增加两个 prop:

```tsx
export default function Select({
  value,
  options,
  onChange,
  align = 'left',
  variant = 'plain',
  ariaLabel,
  onOpenChange,
  triggerLabel,
  direction = 'up',
}: {
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  align?: 'left' | 'right';
  variant?: 'plain' | 'filled';
  ariaLabel?: string;
  // 通知父级展开态:父级据此让 Esc 优先收下拉再关弹窗(见 GenerateForm)
  onOpenChange?: (open: boolean) => void;
  // 触发钮显示文本覆盖(默认显示选中项 label);用于紧凑触发(如语言下拉显示短码 EN/ZH)
  triggerLabel?: string;
  // 菜单弹出方向:'up' 上弹(默认,底部锚定的 Composer/生成弹窗);'down' 下弹(顶部锚定,如账户条语言下拉)
  direction?: 'up' | 'down';
}) {
```

(3b) 单项静态标签分支的 label 支持覆盖:

```tsx
  // 仅一项:静态标签,无 chevron / 不可交互
  if (options.length === 1) {
    return <div className={`${PILL} ${TRIGGER[variant]}`}><span className={LABEL}>{triggerLabel ?? current.label}</span></div>;
  }
```

(3c) 在 `const pick = ...` 之后、`return` 之前,加方向派生(全字面量,勿动态拼接):

```tsx
  const pick = (v: string) => { onChange(v); toggle(false); };

  // 方向派生(Tailwind 需字面量类名):up=菜单在触发钮上方、chevron 关闭朝上;down=菜单在下方、chevron 关闭朝下
  const menuPos = direction === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]';
  const menuOrigin =
    direction === 'up'
      ? (align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left')
      : (align === 'right' ? 'origin-top-right' : 'origin-top-left');
  const chevronRot =
    direction === 'up'
      ? (open ? 'rotate-0' : 'rotate-180')
      : (open ? 'rotate-180' : 'rotate-0');
```

(3d) 触发钮 label 与 chevron 用新变量:

```tsx
      <button
        type="button"
        aria-label={ariaLabel ?? current.label}
        onClick={() => toggle(!open)}
        className={`${PILL} ${TRIGGER[variant]}`}
      >
        <span className={LABEL}>{triggerLabel ?? current.label}</span>
        <FigIcon src={figAsset.chevronDown} size={16} className={`shrink-0 opacity-70 transition-transform duration-150 ${chevronRot}`} />
      </button>
```

(3e) 菜单容器用 `menuPos` / `menuOrigin` 替换原写死的 `bottom-[calc(100%+6px)]` 与 `origin-bottom-*`:

```tsx
          <div className={`anim-pop-in ${menuOrigin} absolute ${menuPos} ${align === 'right' ? 'right-0' : 'left-0'} z-[56] flex min-w-[200px] flex-col gap-1 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]`}>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/ui/Select.test.tsx`
Expected: PASS。

- [ ] **Step 5: 回归既有 Select 使用方**

Run: `pnpm exec vitest run src/components/chat/ModelSelector.test.tsx src/components/canvas`
Expected: PASS(默认 `direction='up'` 未改变既有行为;无 ModelSelector.test 时忽略该文件,只要 canvas 相关通过)。

- [ ] **Step 6: 提交**

```bash
git add src/components/ui/Select.tsx src/components/ui/Select.test.tsx
git commit -m "feat: Select 增加 triggerLabel 与 direction(支持顶部锚定向下弹的紧凑下拉)"
```

---

## Task 3: `LanguageMenu` 语言下拉组件 + 六语 `preview.language`

**Files:**
- Create: `src/components/preview/LanguageMenu.tsx`
- Test: `src/components/preview/LanguageMenu.test.tsx`
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Consumes: `serializeHostConfigPatch`(Task 1)、`Select` 的 `triggerLabel`/`direction`(Task 2)、`normalizeLocale`/`Locale`(`@/i18n/config`)。
- Produces: `LanguageMenu`(默认导出,无 props)。供 Task 4 接入账户条。

- [ ] **Step 1: 加六语 `preview.language`**

在每个 locale 的 `preview` 块 `account:` 之后加一行:

- `src/i18n/locales/en.ts`(在 `account: 'Account',` 后):`    language: 'Language',`
- `src/i18n/locales/zh.ts`(在 `account: '账户',` 后):`    language: '语言',`
- `src/i18n/locales/fr.ts`(在 `account: 'Compte',` 后):`    language: 'Langue',`
- `src/i18n/locales/ru.ts`(在 `account: 'Аккаунт',` 后):`    language: 'Язык',`
- `src/i18n/locales/ja.ts`(在 `account: 'アカウント',` 后):`    language: '言語',`
- `src/i18n/locales/vi.ts`(在 `account: 'Tài khoản',` 后):`    language: 'Ngôn ngữ',`

- [ ] **Step 2: 写失败测试**

新建 `src/components/preview/LanguageMenu.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import LanguageMenu from './LanguageMenu';
import i18n from '@/i18n';

beforeEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); localStorage.clear(); });
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('en'); }); });

test('触发钮显示当前语言短码(en → EN)', () => {
  render(<LanguageMenu />);
  expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('EN');
});

test('选择中文:切换 i18n 语言 + 合并写 taluna-config(保留 theme)', async () => {
  localStorage.setItem('taluna-config', JSON.stringify({ theme: 'dark', lang: 'en' }));
  render(<LanguageMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '中文' })); });
  expect(i18n.language).toBe('zh');
  expect(document.documentElement.lang).toBe('zh');
  expect(JSON.parse(localStorage.getItem('taluna-config')!)).toEqual({ theme: 'dark', lang: 'zh' });
});

test('无既有 taluna-config 时也能写入 lang', async () => {
  render(<LanguageMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Language' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '日本語' })); });
  expect(JSON.parse(localStorage.getItem('taluna-config')!)).toEqual({ lang: 'ja' });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/LanguageMenu.test.tsx`
Expected: FAIL —— 模块不存在 / 组件未定义。

- [ ] **Step 4: 实现**

新建 `src/components/preview/LanguageMenu.tsx`:

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import Select from '@/components/ui/Select';
import { normalizeLocale, type Locale } from '@/i18n/config';
import { serializeHostConfigPatch } from '@/lib/host-config';

// 主站同源配置 key(与 layout.tsx 防白闪脚本、useHostConfig 一致)
const HOST_CONFIG_KEY = 'taluna-config';

// 语言母语名 + 触发钮短码。母语名语言无关,故为常量,不进 i18n 词典。
const LANGS: { value: Locale; label: string; short: string }[] = [
  { value: 'en', label: 'English', short: 'EN' },
  { value: 'zh', label: '中文', short: 'ZH' },
  { value: 'fr', label: 'Français', short: 'FR' },
  { value: 'ru', label: 'Русский', short: 'RU' },
  { value: 'ja', label: '日本語', short: 'JA' },
  { value: 'vi', label: 'Tiếng Việt', short: 'VI' },
];

// 账户条语言下拉:切换即时套用本地 i18n + <html lang>,并合并回写主站同源 localStorage['taluna-config']。
// 受控例外:分站平时不回写该 key,仅用户主动切语言时写 lang(保留 theme 等其余字段,见 serializeHostConfigPatch)。
export default function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const current = normalizeLocale(i18n.language);

  const onChange = (value: string) => {
    const locale = normalizeLocale(value);
    void i18n.changeLanguage(locale); // 本地即时重渲(react-i18next 订阅)
    document.documentElement.lang = locale;
    try {
      localStorage.setItem(HOST_CONFIG_KEY, serializeHostConfigPatch(localStorage.getItem(HOST_CONFIG_KEY), { lang: locale }));
    } catch {
      // localStorage 不可用(隐私模式等)时静默:本地语言已切,仅未持久化到主站配置
    }
  };

  const short = LANGS.find((l) => l.value === current)?.short ?? 'EN';
  return (
    <Select
      value={current}
      options={LANGS.map((l) => ({ value: l.value, label: l.label }))}
      onChange={onChange}
      triggerLabel={short}
      direction="down"
      align="right"
      ariaLabel={t('preview.language')}
    />
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/LanguageMenu.test.tsx`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/components/preview/LanguageMenu.tsx src/components/preview/LanguageMenu.test.tsx src/i18n/locales/en.ts src/i18n/locales/zh.ts src/i18n/locales/fr.ts src/i18n/locales/ru.ts src/i18n/locales/ja.ts src/i18n/locales/vi.ts
git commit -m "feat: 新增账户条语言下拉 LanguageMenu(切换回写主站 taluna-config,六语 preview.language)"
```

---

## Task 4: 账户条接入 LanguageMenu + 更新回写约定注释

**Files:**
- Modify: `src/components/preview/UserInfo.tsx`
- Modify: `src/app/layout.tsx`(注释)
- Modify: `src/client/useHostConfig.ts`(注释)
- Modify: `src/lib/host-config.ts`(注释)
- Test: `src/components/preview/PreviewPanel.test.tsx`(加断言)

**Interfaces:**
- Consumes: `LanguageMenu`(Task 3)。
- Produces: 账户条渲染顺序 credit → LanguageMenu(aria-label=Language)→ 头像。

- [ ] **Step 1: 写失败测试**

在 `src/components/preview/PreviewPanel.test.tsx` 末尾追加:

```ts
test('账户条渲染语言下拉(位于 credit 与头像之间)', async () => {
  useStore.setState({
    userInfo: { id: 7, username: 'nick', display_name: 'Nick' },
    credit: { balance: 42, held: 0, spendable: 42 },
  });
  render(<PreviewPanel />);
  await flush();
  const lang = screen.getByRole('button', { name: 'Language' });
  expect(lang).toBeInTheDocument();
  expect(lang).toHaveTextContent('EN'); // 默认 en → 短码 EN
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx -t "语言下拉"`
Expected: FAIL —— 找不到 aria-label 为 Language 的按钮。

- [ ] **Step 3: 接入 LanguageMenu**

改 `src/components/preview/UserInfo.tsx`:顶部加 import,在 credit `<span>` 与头像 `<span>` 之间插入 `<LanguageMenu />`。

import(在现有 import 之后):

```tsx
import LanguageMenu from './LanguageMenu';
```

外层容器与插入(把 credit span 与头像 span 之间加入 LanguageMenu):

```tsx
  return (
    <div className="flex items-center gap-3">
      {/* credit:闪电图标 + 数字恒青绿(--color-teal,不随主题翻);单位文字随主题 ink */}
      <span className="flex items-center gap-1">
        <span className="inline-flex text-[var(--color-teal)]">
          <FigIcon src={figAsset.credit} size={14} tone="primary" />
        </span>
        <span className="text-[14px] font-bold leading-6 text-[var(--color-teal)]">{formatCredit(credit?.balance)}</span>
        <span className="text-[12px] leading-[18px] tracking-[0.18px] text-[var(--color-ink)]">{t('preview.credit')}</span>
      </span>
      {/* 语言下拉:切换同步回写主站 taluna-config(设计稿 credit 与头像之间) */}
      <LanguageMenu />
      {/* 首字母头像 */}
      <span
        className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--color-line-2)] bg-[var(--color-fill)] text-[13px] font-semibold text-[var(--color-ink)]"
        aria-label={name}
      >
        {initial}
      </span>
    </div>
  );
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: PASS(含既有账户条 / 分享 / 下载等用例)。

- [ ] **Step 5: 更新回写约定注释**

(5a) `src/app/layout.tsx` —— 在 `运行期由主站经 postMessage 下发变更,见 src/client/useHostConfig.ts。` 之后补一句(改注释块结尾):

将
```
            运行期由主站经 postMessage 下发变更,见 src/client/useHostConfig.ts。 */}
```
改为
```
            运行期由主站经 postMessage 下发变更,见 src/client/useHostConfig.ts;
            用户在分站主动切换语言时会合并回写该 key 的 lang(见 LanguageMenu),theme 等其余字段保留。 */}
```

(5b) `src/client/useHostConfig.ts` —— 第 8 行注释:

将
```
// 分站不回写 localStorage —— taluna-config 完全由主站管理(刷新后由防白闪脚本读取)。
```
改为
```
// 分站默认不回写 localStorage —— taluna-config 由主站管理(刷新后由防白闪脚本读取);
// 唯一例外是用户主动切换语言(见 LanguageMenu),此时合并写 lang。
```

(5c) `src/lib/host-config.ts` —— 第 3 行注释:

将
```
// 分站不回写 localStorage —— taluna-config 完全由主站管理。
```
改为
```
// 分站默认不回写 localStorage;唯一例外是用户主动切语言(LanguageMenu 合并写 lang,见 serializeHostConfigPatch)。
```

- [ ] **Step 6: 提交**

```bash
git add src/components/preview/UserInfo.tsx src/components/preview/PreviewPanel.test.tsx src/app/layout.tsx src/client/useHostConfig.ts src/lib/host-config.ts
git commit -m "feat: 账户条接入语言下拉,更新分站回写主站配置的约定注释"
```

---

## Task 5: `computePreviewWidth` 宽度反推纯函数

**Files:**
- Create: `src/lib/preview-width.ts`
- Test: `src/lib/preview-width.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `GAME_RATIO = 282 / 519`
  - `PREVIEW_WIDTH_MIN = 340` / `PREVIEW_WIDTH_MAX = 520` / `PREVIEW_WIDTH_DEFAULT = 380`
  - `computePreviewWidth(stageHeight: number): number` —— `clamp(round(stageHeight * GAME_RATIO), MIN, MAX)`。供 Task 6。

- [ ] **Step 1: 写失败测试**

新建 `src/lib/preview-width.test.ts`:

```ts
import { expect, test } from 'vitest';
import { computePreviewWidth, GAME_RATIO, PREVIEW_WIDTH_MIN, PREVIEW_WIDTH_MAX } from './preview-width';

test('常规高度:按 282:519 比例反推并取整', () => {
  // 700 * 282/519 ≈ 380.3 → 380
  expect(computePreviewWidth(700)).toBe(Math.round(700 * GAME_RATIO));
  expect(computePreviewWidth(700)).toBe(380);
});

test('过矮:夹到下限', () => {
  expect(computePreviewWidth(100)).toBe(PREVIEW_WIDTH_MIN);
});

test('过高:夹到上限', () => {
  expect(computePreviewWidth(5000)).toBe(PREVIEW_WIDTH_MAX);
});

test('非正高度:回退下限(不产生 0 / 负宽)', () => {
  expect(computePreviewWidth(0)).toBe(PREVIEW_WIDTH_MIN);
  expect(computePreviewWidth(-10)).toBe(PREVIEW_WIDTH_MIN);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/preview-width.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现**

新建 `src/lib/preview-width.ts`:

```ts
// 右边栏宽度自适应游戏预览:游戏固定竖屏比例 282:519(与 GameFrame 的 SINGLE_FRAME_SIZE 同源)。
// 面板宽由预览舞台可用高度反推,使游戏横向铺满、无黑边;夹到上下限避免超高 / 超矮视口下过宽 / 过窄。
export const GAME_RATIO = 282 / 519;
export const PREVIEW_WIDTH_MIN = 340;
export const PREVIEW_WIDTH_MAX = 520;
export const PREVIEW_WIDTH_DEFAULT = 380; // 首帧 / 未测得 / 空态兜底宽

// stageHeight = 游戏舞台内容高(100cqh)。非正值回退下限,恒返回合法正宽。
export function computePreviewWidth(stageHeight: number): number {
  if (!(stageHeight > 0)) return PREVIEW_WIDTH_MIN;
  const raw = Math.round(stageHeight * GAME_RATIO);
  return Math.min(PREVIEW_WIDTH_MAX, Math.max(PREVIEW_WIDTH_MIN, raw));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/preview-width.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/lib/preview-width.ts src/lib/preview-width.test.ts
git commit -m "feat: 新增 computePreviewWidth(按舞台高按 282:519 反推面板宽,含上下限夹取)"
```

---

## Task 6: 宽度自适应接入(store + GameFrame 测量 + Workspace 消费)

**Files:**
- Modify: `src/store/index.ts`(UIState/Actions 声明 `previewWidth`/`setPreviewWidth` + 初值 + action 实现;**不进 partialize**。注:`UIState` interface 定义在 index.ts,不在 types.ts)
- Modify: `src/components/preview/GameFrame.tsx`(舞台去左右内边距 + ResizeObserver 测高上报)
- Modify: `src/components/workspace/Workspace.tsx`(用 `previewWidth` 驱动 spacer / overlay 宽)
- Modify: `src/components/preview/CompareView.tsx`(补回 `p-2`,因 STAGE 基类去了内边距)
- Modify: `vitest.setup.ts`(补 no-op ResizeObserver)
- Test: `src/store/preview-width-state.test.ts`(新建,验证 action)

**Interfaces:**
- Consumes: `computePreviewWidth` / `PREVIEW_WIDTH_DEFAULT`(Task 5)。
- Produces: `previewWidth: number | null` + `setPreviewWidth(px: number | null): void`。

- [ ] **Step 1: 写失败测试(store action)**

新建 `src/store/preview-width-state.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { useStore } from '@/store';

beforeEach(() => useStore.setState({ previewWidth: null }));

test('setPreviewWidth 写入瞬态宽度', () => {
  expect(useStore.getState().previewWidth).toBeNull();
  useStore.getState().setPreviewWidth(420);
  expect(useStore.getState().previewWidth).toBe(420);
  useStore.getState().setPreviewWidth(null);
  expect(useStore.getState().previewWidth).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/store/preview-width-state.test.ts`
Expected: FAIL —— `setPreviewWidth is not a function` / `previewWidth` 未定义。

- [ ] **Step 3: store 加字段 + action**

`UIState` 与 `Actions` interface 均定义在 `src/store/index.ts`(非 types.ts),以下全部改 index.ts。

(3a) UIState interface 内(在 `autoSendArmed: boolean;` 之后)加:

```tsx
  // 右边栏宽度(px):由 GameFrame 按游戏舞台高反推并上报,Workspace 消费。瞬态,不持久化。null=用默认宽。
  previewWidth: number | null;
```

Actions interface 内(在 `setAutoSendArmed: (v: boolean) => void;` 之后)加:

```tsx
  setPreviewWidth: (px: number | null) => void;
```

初始 state(在 `autoSendArmed: false,` 之后)加:

```tsx
      previewWidth: null,
```

action 实现(在 `setAutoSendArmed: ...` 附近的 action 定义处加一行;例如放在 `setPreviewTab: (previewTab) => set({ previewTab }),` 之后):

```tsx
      setPreviewWidth: (previewWidth) => set({ previewWidth }),
```

> **不要**把 `previewWidth` 加进 `partialize`(保持瞬态,随视口实时算)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/store/preview-width-state.test.ts`
Expected: PASS。

- [ ] **Step 5: 补 no-op ResizeObserver(测试环境)**

在 `vitest.setup.ts` 的 localStorage polyfill 之后、i18n import 之前加:

```ts
// jsdom 未实现 ResizeObserver(GameFrame 用它测舞台高反推面板宽);测试补 no-op,避免构造报错。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
```

- [ ] **Step 6: GameFrame 舞台去左右内边距 + 测高上报**

改 `src/components/preview/GameFrame.tsx`:

(6a) 顶部 import 增补:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
```
(把原 `import { useEffect, useState } from 'react';` 替换为上面这行)

新增:
```tsx
import { computePreviewWidth } from '@/lib/preview-width';
```

(6b) STAGE 基类去掉 `p-2`(内边距下放到各消费方):

将
```tsx
export const STAGE = 'relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--color-canvas)] p-2 [container-type:size]';
```
改为
```tsx
// 舞台基类不含内边距:单预览(GameFrame)只留竖向 py-2、横向铺满面板宽;对比(CompareView)自行补 p-2。
export const STAGE = 'relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--color-canvas)] [container-type:size]';
```

(6c) 组件内(`GameFrame` 函数体,在现有 `const [frameLoaded, ...]` 附近)加测量逻辑:

```tsx
  const setPreviewWidth = useStore((s) => s.setPreviewWidth);
  const lastH = useRef(0);
  const roRef = useRef<ResizeObserver | null>(null);
  // 回调 ref:观测舞台内容高(=100cqh),按 282:519 反推面板宽并上报。高度未变则跳过(屏蔽宽度变化引发的空转;
  // 面板宽由本值反推,而舞台高只由视口高决定、与宽无关 → 无循环依赖,一帧收敛)。key 变化致舞台重挂时,
  // 回调 ref 以 null 触发一次 → disconnect 旧节点,再以新节点 observe。
  const measureStage = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0;
      if (h <= 0 || h === lastH.current) return;
      lastH.current = h;
      setPreviewWidth(computePreviewWidth(h));
    });
    ro.observe(node);
    roRef.current = ro;
  }, [setPreviewWidth]);
  // 组件卸载兜底断开(callback ref 已在卸载时以 null 调用断开,此为双保险)
  useEffect(() => () => roRef.current?.disconnect(), []);
```

(6d) 渲染的舞台 div 挂 ref 并补竖向内边距(横向铺满):

将
```tsx
  return (
    <div className={STAGE}>
```
改为
```tsx
  return (
    <div className={`${STAGE} py-2`} ref={measureStage}>
```

- [ ] **Step 7: CompareView 补回 p-2**

改 `src/components/preview/CompareView.tsx` 的 `CompareView` 返回:

将
```tsx
    <div className={`${STAGE} gap-2.5`}>
```
改为
```tsx
    <div className={`${STAGE} gap-2.5 p-2`}>
```

- [ ] **Step 8: Workspace 用 previewWidth 驱动宽度**

改 `src/components/workspace/Workspace.tsx`:

(8a) 顶部加 import:

```tsx
import { PREVIEW_WIDTH_DEFAULT } from '@/lib/preview-width';
```

(8b) 删除常量 `PREVIEW_W`(下面全部改用像素宽):

删除
```tsx
// 常态预览列宽:约 28% 视宽,360~460 之间(加宽以保证预览区有足够宽度,与底部占位 spacer 保持一致)
const PREVIEW_W = 'w-[28%] min-w-[360px] max-w-[460px]';
```

(8c) 组件内订阅 previewWidth(在 `const compareOn = ...` 附近):

```tsx
  const previewWidth = useStore((s) => s.previewWidth);
```

在 return 之前算常态宽:
```tsx
  // 常态预览列宽:由 GameFrame 测游戏舞台高反推(previewWidth);首帧 / 空态用默认。compare / files 覆盖为全宽。
  const normalPreviewW = previewWidth ?? PREVIEW_WIDTH_DEFAULT;
```

(8d) spacer 用像素宽:

将
```tsx
        {/* 占位 spacer:为 absolute 预览面板在常态下保留布局位置 */}
        <div className={`${PREVIEW_W} shrink-0`} aria-hidden />
```
改为
```tsx
        {/* 占位 spacer:为 absolute 预览面板在常态下保留布局位置(常态宽跟随游戏比例) */}
        <div className="shrink-0" style={{ width: normalPreviewW }} aria-hidden />
```

(8e) overlay 用像素宽:

将
```tsx
        <div
          className={`absolute inset-y-0 right-0 z-20 ${
            resizing ? '' : 'transition-[width] duration-300 ease-in-out'
          } ${compareOn || filesTab ? '' : PREVIEW_W}`}
          style={compareOn || filesTab ? { width: `calc(100% - ${chatW}px)` } : undefined}
        >
```
改为
```tsx
        <div
          className={`absolute inset-y-0 right-0 z-20 ${
            resizing ? '' : 'transition-[width] duration-300 ease-in-out'
          }`}
          style={{ width: compareOn || filesTab ? `calc(100% - ${chatW}px)` : normalPreviewW }}
        >
```

- [ ] **Step 9: 跑相关测试**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx src/store/preview-width-state.test.ts`
Expected: PASS(ResizeObserver mock 就位,PreviewPanel 挂载不炸)。

- [ ] **Step 10: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误(previewWidth / setPreviewWidth 已在 UIState / Actions 声明并实现)。

- [ ] **Step 11: 提交**

```bash
git add src/store/index.ts src/components/preview/GameFrame.tsx src/components/preview/CompareView.tsx src/components/workspace/Workspace.tsx vitest.setup.ts src/store/preview-width-state.test.ts
git commit -m "feat: 右边栏宽度按游戏舞台高反推自适应(GameFrame 测量 → store → Workspace 消费)"
```

---

## Task 7: Versions 竖向时间线重写 + 删除 VersionCover

**Files:**
- Modify: `src/components/preview/VersionTimeline.tsx`(重写列表为时间线 + 导出 `formatVersionTime` 改 24h 格式)
- Delete: `src/components/preview/VersionCover.tsx`
- Delete: `src/components/preview/VersionCover.test.tsx`
- Test: `src/components/preview/VersionTimeline.test.tsx`(补时间线用例 + formatVersionTime 单测)

**Interfaces:**
- Consumes: store `versions` / `activeVersionId` / `compare` / `buildingVersion` 及 `setActiveVersion` / `toggleCompare` / `setCompareWith`(均已存在)。
- Produces: `formatVersionTime(iso: string): string`(具名导出,格式 `HH:MM; DD/MM/YYYY`,无效时间空串)。

- [ ] **Step 1: 写失败测试**

改 `src/components/preview/VersionTimeline.test.tsx`。保留现有 3 个 Compare 用例,顶部 import 增补 `fireEvent` 与 `formatVersionTime`,并追加用例:

顶部 import 改为:
```tsx
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import VersionTimeline, { formatVersionTime } from './VersionTimeline';
import { useStore } from '@/store';
import type { Version } from '@/store/types';
```

末尾追加:
```tsx
test('formatVersionTime:本地时间 24h 格式 HH:MM; DD/MM/YYYY', () => {
  // 无 Z → 按本地时区解析,结果确定
  expect(formatVersionTime('2026-07-20T17:35:00')).toBe('17:35; 20/07/2026');
});

test('formatVersionTime:无效时间返回空串', () => {
  expect(formatVersionTime('nope')).toBe('');
});

test('时间线渲染版本名与时间戳,激活项标记 aria-current', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1'), makeVersion('v2', 'Version 2', true)],
    activeVersionId: 'v2',
  });
  render(<VersionTimeline />);
  // 最新在上:Version 2 在 Version 1 之前
  const items = screen.getAllByRole('button').filter((b) => /Version/.test(b.textContent ?? ''));
  expect(items[0]).toHaveTextContent('Version 2');
  expect(items[0]).toHaveAttribute('aria-current', 'true');
  expect(items[1]).not.toHaveAttribute('aria-current');
});

test('常态点击非激活版本 → setActive', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
  });
  render(<VersionTimeline />);
  fireEvent.click(screen.getByRole('button', { name: /Version 2/ }));
  expect(useStore.getState().activeVersionId).toBe('v2');
});

test('compare 模式点击非激活版本 → setCompareWith(不改 active)', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: null },
  });
  render(<VersionTimeline />);
  fireEvent.click(screen.getByRole('button', { name: /Version 2/ }));
  expect(useStore.getState().compare.withId).toBe('v2');
  expect(useStore.getState().activeVersionId).toBe('v1');
});
```

> `makeVersion` 已在文件中定义(id/label/current)。时间戳用例走 `formatVersionTime` 纯函数,不依赖渲染时区。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/preview/VersionTimeline.test.tsx`
Expected: FAIL —— `formatVersionTime` 未导出 / aria-current 不存在 / 新格式不符。

- [ ] **Step 3: 重写 VersionTimeline**

整体替换 `src/components/preview/VersionTimeline.tsx` 为:

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { Version } from '@/store/types';

// 设计稿时间格式:17:35; 20/07/2026(24h);无效时间返回空串(不渲染 "Invalid Date")
export function formatVersionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${hh}:${mi}; ${dd}/${mm}/${d.getFullYear()}`;
}

export default function VersionTimeline() {
  const { t } = useTranslation();
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const setActive = useStore((s) => s.setActiveVersion);
  const toggleCompare = useStore((s) => s.toggleCompare);
  const compareOn = useStore((s) => s.compare.on);
  const compareWithId = useStore((s) => s.compare.withId);
  const setCompareWith = useStore((s) => s.setCompareWith);
  const buildingVersion = useStore((s) => s.buildingVersion);
  const canCompare = versions.length >= 2; // 至少两个版本才可对比

  // 行序:构建中占位在最顶,其余版本最新在上(reverse)
  const rows: { v: Version; building: boolean }[] = [
    ...(buildingVersion ? [{ v: buildingVersion, building: true }] : []),
    ...[...versions].reverse().map((v) => ({ v, building: false })),
  ];

  return (
    <div className="flex min-h-0 flex-[3] flex-col border-t border-[var(--color-line-strong)]">
      {/* Versions 头部 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-3">
        <span className="text-[12px] font-semibold leading-4 tracking-[-0.12px] text-[var(--color-ink)]">{t('preview.versions')}</span>
        {/* Compare:空版本区不展示(对齐设计稿空态);有版本时按 canCompare(≥2)启用 */}
        {versions.length > 0 && (
          <button
            onClick={toggleCompare}
            disabled={!canCompare}
            aria-pressed={compareOn}
            className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-surface-2)] px-4 py-2 text-[12px] font-medium text-[var(--color-ink)] transition-[background-color,opacity,filter] duration-200 hover:bg-[var(--color-fill)] disabled:cursor-not-allowed disabled:opacity-30 ${compareOn ? 'bg-[var(--color-fill)] brightness-95' : ''}`}
          >
            <FigIcon src={figAsset.repeat} size={16} />
            {t('preview.compare')}
          </button>
        )}
      </div>

      {/* 竖向时间线:左轨道(圆点 + 贯穿连接线)+ 右内容(版本名 + 时间戳);超出滚动 */}
      <div className="scrollbar-auto flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-1">
        {rows.map(({ v, building }, i) => {
          const active = !building && v.id === activeId;
          const comparePicked = !building && compareOn && v.id === compareWithId;
          const isFirst = i === 0;
          const isLast = i === rows.length - 1;
          // 圆点态:构建中=青绿 spinner;激活=青绿实心;compare 对比对象=accent 蓝实心;其余=空心
          const dot = building
            ? <span className="size-3 animate-spin rounded-full border-2 border-[var(--color-teal)]/30 border-t-[var(--color-teal)]" />
            : active
              ? <span className="size-3 rounded-full border-2 border-[var(--color-teal)] bg-[var(--color-teal)]" />
              : comparePicked
                ? <span className="size-3 rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-accent)]" />
                : <span className="size-3 rounded-full border-2 border-[var(--color-line-2)] bg-transparent" />;
          const time = formatVersionTime(v.createdAt);
          const highlighted = active || comparePicked;

          return (
            <button
              key={building ? 'building' : v.id}
              type="button"
              aria-current={active ? 'true' : undefined}
              disabled={building}
              onClick={() => {
                if (building) return;
                // compare 模式:点非激活版本切换对比对象(不能与自己比较)
                if (compareOn) { if (v.id !== activeId) setCompareWith(v.id); }
                else setActive(v.id);
              }}
              className={`group relative flex min-h-[48px] w-full items-center gap-3 rounded-[12px] pr-2 text-left transition-colors duration-200 ${building ? '' : 'hover:bg-[var(--color-fill)]'} ${highlighted ? 'bg-[var(--color-fill)]' : ''}`}
            >
              {/* 轨道列:连接线(圆心两侧,首项无上、尾项无下)+ 圆点(垂直居中) */}
              <span className="relative flex w-4 shrink-0 self-stretch justify-center">
                {!isFirst && <span className="absolute left-1/2 top-0 h-[calc(50%-8px)] w-px -translate-x-1/2 bg-[var(--color-line)]" />}
                {!isLast && <span className="absolute bottom-0 left-1/2 h-[calc(50%-8px)] w-px -translate-x-1/2 bg-[var(--color-line)]" />}
                <span className="absolute top-1/2 flex -translate-y-1/2 items-center justify-center">{dot}</span>
              </span>
              {/* 内容:版本名(粗体)+ 时间戳(右对齐 muted) */}
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate text-[14px] font-semibold leading-5 tracking-[-0.28px] text-[var(--color-ink)]">{v.label}</span>
                {time && <span className="shrink-0 text-[11px] leading-4 tracking-[-0.1px] text-[var(--color-muted)]">{time}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 删除废弃的 VersionCover**

```bash
git rm src/components/preview/VersionCover.tsx src/components/preview/VersionCover.test.tsx
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/preview/VersionTimeline.test.tsx`
Expected: PASS(3 个原 Compare 用例 + 新增 formatVersionTime / 时间线 / 点击用例)。

- [ ] **Step 6: 确认无残留引用 VersionCover**

Run: `grep -rn "VersionCover" src`
Expected: 无输出(全部清除)。

- [ ] **Step 7: 提交**

```bash
git add src/components/preview/VersionTimeline.tsx src/components/preview/VersionTimeline.test.tsx
git commit -m "feat: Versions 改竖向时间线(圆点+连接线,去封面/摘要),时间戳改 24h,删除废弃 VersionCover"
```

---

## Task 8: 全量校验 + 运行态验证

**Files:** 无(校验)

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全绿(基线 820 + 新增用例;删除 VersionCover 的 test 后总文件数相应变化)。

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: 0 error(若报 `set-state-in-effect` 等,复核 setState 是否落在 effect 同步体;本计划应无)。

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: 成功。

- [ ] **Step 5: 运行态目视验证(右边栏)**

启动 dev(`pnpm dev`),用浏览器 / Playwright 打开工作区,确认三点:
1. 账户条 credit 与头像之间有语言下拉,点开显示六语母语名,切换后界面文案即时变化,且 `localStorage['taluna-config'].lang` 更新、`theme` 保留。
2. 改变浏览器窗口高度时,右边栏宽度随游戏预览高度变化,游戏横向铺满面板(无左右黑边);极端高度下夹取生效。
3. Versions 呈竖向时间线:圆点 + 连接线,激活项青绿实心圆,时间戳 `HH:MM; DD/MM/YYYY`;compare 模式对比对象为蓝点。

> 若通过 Playwright:`browser_navigate` 到 dev 地址 → `browser_take_screenshot` 截右边栏比对设计稿。此步为人工确认,不阻塞自动化测试。

- [ ] **Step 6: 收尾**

回主分支流程见 `superpowers:finishing-a-development-branch`(合并回 dev / 清理 worktree)。

---

## Self-Review 记录

- **Spec 覆盖**:功能#1 → Task 1/3/4;功能#2 → Task 5/6;功能#3 → Task 7;测试/校验 → 各任务 TDD + Task 8。✅ 全覆盖。
- **占位扫描**:无 TBD/TODO;每个代码步给出完整代码与命令。✅
- **类型一致**:`serializeHostConfigPatch`(Task1)↔ LanguageMenu(Task3)、`computePreviewWidth`/`PREVIEW_WIDTH_DEFAULT`(Task5)↔ GameFrame/Workspace(Task6)、`formatVersionTime` 具名导出(Task7)↔ 其测试签名一致。✅
- **已知取舍**:面板宽 min340/max520/默认380;触发钮短码大写 2 字母;时间线去 summary/cover(经 Nick 确认)。
