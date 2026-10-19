# 画布缩放菜单实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个向上弹出的缩放浮层菜单替换画布底部的 `+/−/fit` 三个按钮与旧三档预设下拉,并把缩放区间扩到 10%–200%、绑定 `⌘` 快捷键。

**Architecture:** 纯逻辑(输入解析 / 快捷键匹配)下沉到 `src/lib/zoom.ts` 并单测;副作用(keydown 监听、`zoomTo`/`fitView` 调用)留在 `AssetCanvas.tsx` 的薄组件与 hook 里。新增自包含的 `ZoomMenu` / `ZoomInput` / `ZoomMenuRow` 组件,改造 `ZoomBar`。缩放上下限同时改 `MIN_ZOOM/MAX_ZOOM` 常量与 `<ReactFlow minZoom/maxZoom>` prop。

**Tech Stack:** Next 16 / React 19 / `@xyflow/react` / react-i18next / Tailwind(CSS 变量令牌) / Vitest。

## Global Constraints

- 颜色 / 阴影 / 圆角 / 字体一律走 `globals.css` 的 CSS 变量与既有令牌,**禁硬编码色值**。
- 图标一律用 `FigIcon` + `figAsset` 注册表;新图标先放 `public/figma/icons/` 再登记。
- 动画复用既有 `.anim-*` 类(本功能用 `.anim-pop-in` + `origin-bottom-right`);不写一次性 keyframes。
- 交互元素配 `aria-label`。
- 缩放区间:`MIN_ZOOM = 0.1`(10%)、`MAX_ZOOM = 2`(200%)。
- i18n 六语(en/zh/fr/ru/ja/vi),**en 为真相源**;新增文案补齐六套。
- **禁 effect-setState**(不在 `useEffect` 体内同步 `setState`;事件回调里 `setState` 允许);**禁渲染期 ref**。
- 注释用中文,commit message 用中文。
- ⚠️ 全程在 worktree `.claude/worktrees/feat+canvas-zoom-menu` 内操作;每次改完用 `git -C <worktree>` 校验落点,勿写进主仓。

---

### Task 1: 纯逻辑与单测(`src/lib/zoom.ts`)

**Files:**
- Modify: `src/lib/zoom.ts`
- Test: `src/lib/zoom.test.ts`

**Interfaces:**
- Produces:
  - `parseZoomInput(raw: string, min: number, max: number): number | null` —— 解析百分比文本为缩放比并 clamp;空 / 非数字返回 `null`。
  - `type ZoomShortcut = 'in' | 'out' | 'reset' | 'double' | 'fit'`
  - `matchZoomShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): ZoomShortcut | null`
  - 保留既有 `stepZoom(current, deltaPercent, min, max): number`。

- [ ] **Step 1: 追加失败测试**

在 `src/lib/zoom.test.ts` 顶部导入改为:

```ts
import { describe, it, expect } from 'vitest';
import { stepZoom, parseZoomInput, matchZoomShortcut } from './zoom';
```

在文件末尾(`describe('stepZoom'…)` 之后)追加:

```ts
describe('parseZoomInput', () => {
  it('解析带百分号', () => {
    expect(parseZoomInput('150%', 0.1, 2)).toBeCloseTo(1.5, 5);
  });
  it('解析纯数字', () => {
    expect(parseZoomInput('150', 0.1, 2)).toBeCloseTo(1.5, 5);
  });
  it('容忍首尾空白', () => {
    expect(parseZoomInput('  120 ', 0.1, 2)).toBeCloseTo(1.2, 5);
  });
  it('低于下界 clamp 到 min(10%)', () => {
    expect(parseZoomInput('5', 0.1, 2)).toBeCloseTo(0.1, 5);
  });
  it('高于上界 clamp 到 max(200%)', () => {
    expect(parseZoomInput('300', 0.1, 2)).toBe(2);
  });
  it('空串返回 null', () => {
    expect(parseZoomInput('', 0.1, 2)).toBeNull();
  });
  it('非数字返回 null', () => {
    expect(parseZoomInput('abc', 0.1, 2)).toBeNull();
  });
});

describe('matchZoomShortcut', () => {
  it('⌘+ / ⌘= → in', () => {
    expect(matchZoomShortcut({ key: '+', metaKey: true, ctrlKey: false })).toBe('in');
    expect(matchZoomShortcut({ key: '=', metaKey: true, ctrlKey: false })).toBe('in');
  });
  it('Ctrl+ 也认(跨平台)', () => {
    expect(matchZoomShortcut({ key: '+', metaKey: false, ctrlKey: true })).toBe('in');
  });
  it('⌘- → out', () => {
    expect(matchZoomShortcut({ key: '-', metaKey: true, ctrlKey: false })).toBe('out');
  });
  it('⌘0 → reset / ⌘2 → double / ⌘1 → fit', () => {
    expect(matchZoomShortcut({ key: '0', metaKey: true, ctrlKey: false })).toBe('reset');
    expect(matchZoomShortcut({ key: '2', metaKey: true, ctrlKey: false })).toBe('double');
    expect(matchZoomShortcut({ key: '1', metaKey: true, ctrlKey: false })).toBe('fit');
  });
  it('无修饰键返回 null', () => {
    expect(matchZoomShortcut({ key: '1', metaKey: false, ctrlKey: false })).toBeNull();
  });
  it('无关按键返回 null', () => {
    expect(matchZoomShortcut({ key: 'a', metaKey: true, ctrlKey: false })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/zoom.test.ts`
Expected: FAIL —— `parseZoomInput`/`matchZoomShortcut` is not a function(未导出)。

- [ ] **Step 3: 实现纯函数**

在 `src/lib/zoom.ts` 末尾(`stepZoom` 之后)追加:

```ts
// 解析缩放输入框文本(如 "150%" / "150" / " 150 ")为缩放比并 clamp 到 [min, max]。
// 空串 / 非数字返回 null(调用方回退当前值)。
export function parseZoomInput(raw: string, min: number, max: number): number | null {
  const cleaned = raw.replace('%', '').trim();
  if (cleaned === '') return null;
  const percent = Number(cleaned);
  if (!Number.isFinite(percent)) return null;
  const ratio = percent / 100;
  return Math.min(max, Math.max(min, ratio));
}

// 缩放快捷键动作。
export type ZoomShortcut = 'in' | 'out' | 'reset' | 'double' | 'fit';

// 把键盘事件映射为缩放动作:须按住 ⌘(mac)或 Ctrl(win)。不匹配返回 null。
export function matchZoomShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): ZoomShortcut | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  switch (e.key) {
    case '+':
    case '=':
      return 'in';
    case '-':
      return 'out';
    case '0':
      return 'reset';
    case '2':
      return 'double';
    case '1':
      return 'fit';
    default:
      return null;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/zoom.test.ts`
Expected: PASS(全部用例,含既有 `stepZoom`)。

- [ ] **Step 5: 提交**

```bash
W=/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-zoom-menu
git -C "$W" add src/lib/zoom.ts src/lib/zoom.test.ts
git -C "$W" commit -m "feat: 缩放纯逻辑 parseZoomInput/matchZoomShortcut + 单测

Claude-Session: https://claude.ai/code/session_013TJ3ePbN5GhGL1JsjennbX"
```

---

### Task 2: check 图标 + i18n 六语文案

**Files:**
- Create: `public/figma/icons/check.svg`
- Modify: `src/components/ui/figma.tsx`(注册 `check`)
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`

**Interfaces:**
- Produces:
  - `figAsset.check`(默认 tone = primary,随 currentColor 翻转)。
  - i18n key:`canvas.zoomTo100` / `canvas.zoomTo200` / `canvas.zoomToFit` / `canvas.zoomValue`。
  - 移除已无消费者的 `canvas.fitView`(其唯一使用点是被删的 fit 按钮)。

- [ ] **Step 1: 新建 check.svg**

写入 `public/figma/icons/check.svg`(沿用 minus/frame 的 stroke 风格,mask 取形):

```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M4.5 10.5L8 14L15.5 6.5" stroke="#121212" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
```

- [ ] **Step 2: 注册 check 图标**

在 `src/components/ui/figma.tsx` 的 `figAsset` 对象里,`frame` 一行(`frame: \`${F}/frame.svg\`,`)后新增一行:

```ts
  check: `${F}/check.svg`,
```

(无需改 `ICON_TONE`:未登记默认 `primary`,随 `--color-ink` 翻转。)

- [ ] **Step 3: en 新增键、删除 fitView**

在 `src/i18n/locales/en.ts` 的 `canvas` 块:删除 `fitView: 'Fit view',` 一行,并把 `zoomPresets: 'Zoom presets',` 一行替换为:

```ts
    zoomPresets: 'Zoom presets',
    zoomTo100: 'Zoom to 100%',
    zoomTo200: 'Zoom to 200%',
    zoomToFit: 'Zoom to fit',
    zoomValue: 'Zoom level',
```

- [ ] **Step 4: 其余五语同步**

分别在对应 `canvas` 块删除各自的 `fitView: …,` 行,并在 `zoomPresets` 行后插入四条:

`zh.ts`:
```ts
    zoomTo100: '缩放到 100%',
    zoomTo200: '缩放到 200%',
    zoomToFit: '缩放以适应',
    zoomValue: '缩放比例',
```

`fr.ts`:
```ts
    zoomTo100: 'Zoom à 100 %',
    zoomTo200: 'Zoom à 200 %',
    zoomToFit: 'Ajuster le zoom',
    zoomValue: 'Niveau de zoom',
```

`ru.ts`:
```ts
    zoomTo100: 'Масштаб 100 %',
    zoomTo200: 'Масштаб 200 %',
    zoomToFit: 'Вписать в экран',
    zoomValue: 'Масштаб',
```

`ja.ts`:
```ts
    zoomTo100: '100% にズーム',
    zoomTo200: '200% にズーム',
    zoomToFit: '全体を表示',
    zoomValue: 'ズーム倍率',
```

`vi.ts`:
```ts
    zoomTo100: 'Thu phóng 100%',
    zoomTo200: 'Thu phóng 200%',
    zoomToFit: 'Vừa khung nhìn',
    zoomValue: 'Mức thu phóng',
```

- [ ] **Step 5: 校验类型与六语一致**

Run:
```bash
pnpm exec tsc --noEmit
grep -c "zoomToFit" src/i18n/locales/en.ts src/i18n/locales/zh.ts src/i18n/locales/fr.ts src/i18n/locales/ru.ts src/i18n/locales/ja.ts src/i18n/locales/vi.ts
grep -rn "canvas\.fitView" src | grep -v locales/
```
Expected:`tsc` 无错;每个 locale `zoomToFit` 计数为 `1`;`canvas.fitView` 无残留使用点(第三条无输出——它的消费者将在 Task 4 删除;若此刻仍有,说明顺序错)。

> 注:`en.ts` 是 `t()` 的类型真相源。此步删 `fitView` 后,Task 4 之前的 `AssetCanvas.tsx` 仍引用 `t('canvas.fitView')` 会 tsc 报错。因此本 Task 的 `tsc` 校验放到 Task 4 之后统一跑;本步仅跑 `grep` 计数,`tsc` 允许暂时失败。**执行者注意:Task 2 与 Task 4 需连续完成再整体校验。**

- [ ] **Step 6: 提交**

```bash
W=/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-zoom-menu
git -C "$W" add public/figma/icons/check.svg src/components/ui/figma.tsx src/i18n/locales/
git -C "$W" commit -m "feat: 新增 check 图标与缩放菜单六语文案,移除废弃 fitView 键

Claude-Session: https://claude.ai/code/session_013TJ3ePbN5GhGL1JsjennbX"
```

---

### Task 3: 缩放区间扩到 10%–200%(`<ReactFlow>` prop)

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(`<ReactFlow>` 元素 prop,line ~370)

**Interfaces:**
- Consumes: 无。
- Produces: `<ReactFlow>` 显式 `minZoom={0.1} maxZoom={2}`,使后续 `zoomTo(0.1)` 生效(否则被 React Flow 默认下限 0.5 夹回)。

- [ ] **Step 1: 给 ReactFlow 补 minZoom/maxZoom**

在 `src/components/canvas/AssetCanvas.tsx`,把:

```tsx
        zoomOnDoubleClick={false}
        fitView
```

改为:

```tsx
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        fitView
```

(初始锁定 100% 的 `fitViewOptions={{ minZoom: 1, maxZoom: 1 }}` 保持不变。)

- [ ] **Step 2: 校验类型**

Run: `pnpm exec tsc --noEmit`
Expected: 无错(此时 Task 2 若已删 `fitView` 键,`ZoomBar` 里 `t('canvas.fitView')` 仍会报错——见 Task 2 Step 5 注,连续完成 Task 4 后统一校验)。

- [ ] **Step 3: 提交**

```bash
W=/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-zoom-menu
git -C "$W" add src/components/canvas/AssetCanvas.tsx
git -C "$W" commit -m "feat: 画布缩放区间扩到 10%–200%(ReactFlow minZoom/maxZoom)

Claude-Session: https://claude.ai/code/session_013TJ3ePbN5GhGL1JsjennbX"
```

---

### Task 4: ZoomMenu 浮层 + 键盘 hook + ZoomBar 改造

**Files:**
- Modify: `src/components/canvas/AssetCanvas.tsx`(import 行 line 2、line 26;整块替换 line ~90–212 的 `MIN_ZOOM`/`MAX_ZOOM` 常量与 `ZoomBar` 函数)

**Interfaces:**
- Consumes: `stepZoom` / `parseZoomInput` / `matchZoomShortcut`(Task 1);`figAsset.check`(Task 2);`canvas.zoomTo100/zoomTo200/zoomToFit/zoomValue`(Task 2)。
- Produces: 新 `ZoomBar`(props 签名不变:`{ minimapOpen, onToggleMinimap, onTidy, canTidy }`),内部含 `useZoomShortcuts` / `ZoomMenu` / `ZoomInput` / `ZoomMenuRow` / `ShortcutChip`。

- [ ] **Step 1: 补 import**

`src/components/canvas/AssetCanvas.tsx` line 2,`react` 导入补 `useCallback` 无需;确认 `useEffect, useRef, useState` 已在(现状:`import { useEffect, useMemo, useRef, useState } from 'react';` —— 已满足,无需改)。

line 26 的:

```tsx
import { stepZoom } from '@/lib/zoom';
```

改为:

```tsx
import { stepZoom, parseZoomInput, matchZoomShortcut } from '@/lib/zoom';
```

- [ ] **Step 2: 整块替换 MIN_ZOOM/MAX_ZOOM 与 ZoomBar**

把从注释 `// 缩放范围沿用 React Flow 默认(50%–200%)` / `const MIN_ZOOM = 0.5;` 起,到 `ZoomBar` 函数结束(其闭合 `}` ,line ~212)之间的整段,替换为:

```tsx
// 缩放范围:10%–200%(与 <ReactFlow minZoom/maxZoom> 对齐)
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

// 全局缩放快捷键(⌘/Ctrl + +/-/0/2/1)。焦点在输入类元素时放行给输入,不误触。
function useZoomShortcuts() {
  const { getViewport, zoomTo, fitView } = useReactFlow();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = matchZoomShortcut(e);
      if (!action) return;
      const el = document.activeElement as HTMLElement | null;
      // 输入 / 文本域 / 可编辑区聚焦时不拦截,交给输入自身
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault(); // 拦截浏览器缩放 / 切标签页默认行为
      const { zoom } = getViewport();
      if (action === 'in') void zoomTo(stepZoom(zoom, 5, MIN_ZOOM, MAX_ZOOM), { duration: 200 });
      else if (action === 'out') void zoomTo(stepZoom(zoom, -5, MIN_ZOOM, MAX_ZOOM), { duration: 200 });
      else if (action === 'reset') void zoomTo(1, { duration: 200 });
      else if (action === 'double') void zoomTo(2, { duration: 200 });
      else if (action === 'fit') void fitView({ duration: 200 });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [getViewport, zoomTo, fitView]);
}

// 快捷键 chip:复用搜索栏 chip 样式
function ShortcutChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[6px] bg-[var(--color-fill)] px-1.5 py-0.5 text-[11px] tracking-[-0.11px] text-[var(--color-muted)] shadow-[var(--shadow-shortcut)]">
      {children}
    </span>
  );
}

// 缩放菜单单行:行首勾选位 + 标签 + 快捷键 chip
function ZoomMenuRow({
  label,
  shortcut,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string;
  shortcut: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)] hover:bg-[var(--color-fill)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="grid w-3.5 shrink-0 place-items-center">
        {active ? <FigIcon src={figAsset.check} size={14} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ShortcutChip>{shortcut}</ShortcutChip>
    </button>
  );
}

// 缩放菜单顶部可编辑输入框:回车/失焦 clamp 到 [MIN,MAX] 后跳转;非法回退当前值。
function ZoomInput() {
  const { t } = useTranslation();
  const { zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  // 仅在菜单打开时挂载,故用 lazy 初始值读一次当前缩放,避免 effect-setState
  const [draft, setDraft] = useState(() => String(Math.round(zoom * 100)));
  const commit = () => {
    const next = parseZoomInput(draft, MIN_ZOOM, MAX_ZOOM);
    if (next == null) {
      setDraft(String(Math.round(zoom * 100)));
      return;
    }
    void zoomTo(next, { duration: 200 });
    setDraft(String(Math.round(next * 100)));
  };
  return (
    <div className="composer-card mb-1 flex items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-fill)] px-2.5 py-1.5">
      <FigIcon src={figAsset.frame} size={16} tone="secondary" />
      <input
        aria-label={t('canvas.zoomValue')}
        value={draft}
        inputMode="numeric"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-[12px] font-medium tracking-[-0.12px] text-[var(--color-ink)] outline-none"
      />
      <span className="text-[12px] text-[var(--color-muted)]">%</span>
    </div>
  );
}

// 缩放菜单浮层:顶部输入 + 五个操作项。从 100%▼ 药丸向上弹出。
function ZoomMenu({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { zoomTo, fitView } = useReactFlow();
  const { zoom } = useViewport();
  const pct = Math.round(zoom * 100);
  const run = (fn: () => void) => {
    fn();
    onClose();
  };
  return (
    <div
      data-zoom-menu
      className="anim-pop-in origin-bottom-right absolute bottom-[52px] right-0 w-[204px] rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-[6px]"
    >
      <ZoomInput />
      <ZoomMenuRow
        label={t('canvas.zoomIn')}
        shortcut="⌘+"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => run(() => void zoomTo(stepZoom(zoom, 5, MIN_ZOOM, MAX_ZOOM), { duration: 200 }))}
      />
      <ZoomMenuRow
        label={t('canvas.zoomOut')}
        shortcut="⌘−"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => run(() => void zoomTo(stepZoom(zoom, -5, MIN_ZOOM, MAX_ZOOM), { duration: 200 }))}
      />
      <ZoomMenuRow
        label={t('canvas.zoomTo100')}
        shortcut="⌘0"
        active={pct === 100}
        onClick={() => run(() => void zoomTo(1, { duration: 200 }))}
      />
      <ZoomMenuRow
        label={t('canvas.zoomTo200')}
        shortcut="⌘2"
        active={pct === 200}
        onClick={() => run(() => void zoomTo(2, { duration: 200 }))}
      />
      <ZoomMenuRow
        label={t('canvas.zoomToFit')}
        shortcut="⌘1"
        onClick={() => run(() => void fitView({ duration: 200 }))}
      />
    </div>
  );
}

// 底部居中浮动工具条:一键整理 | 小地图切换 | 缩放菜单
function ZoomBar({
  minimapOpen,
  onToggleMinimap,
  onTidy,
  canTidy,
}: {
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  onTidy: () => void;
  canTidy: boolean;
}) {
  const { zoom } = useViewport();
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  useZoomShortcuts();

  // 打开时:点击菜单/药丸之外、滚轮、Esc 均关闭(滚轮放行画布缩放)。
  // 注:外层容器有 -translate-x-1/2 transform,fixed 遮罩会被其困住,故改用 document 监听 + data 属性判定。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('[data-zoom-menu]') || el.closest('[data-zoom-pill]')) return;
      setOpen(false);
    };
    const onWheel = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="absolute bottom-5 left-1/2 z-10 -translate-x-1/2">
      {open && <ZoomMenu onClose={() => setOpen(false)} />}
      <div className="flex items-center gap-2 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-toolbar)]">
        {/* ⓪ 一键整理 */}
        <Tooltip label={t('canvas.tidy')}>
          <IconButton
            variant="ghost"
            onClick={onTidy}
            disabled={!canTidy}
            aria-label={t('canvas.tidy')}
            className="size-10"
          >
            <FigIcon src={figAsset.tidy} size={20} />
          </IconButton>
        </Tooltip>

        <span className="h-6 w-px bg-[var(--color-line)]" />

        {/* ① minimap 切换 */}
        <Tooltip label={t('canvas.minimap')}>
          <IconButton
            variant={minimapOpen ? 'raised-active' : 'ghost'}
            onClick={onToggleMinimap}
            aria-label={t('canvas.minimapToggle')}
            aria-pressed={minimapOpen}
            className="size-10"
          >
            <FigIcon src={figAsset.map} size={20} />
          </IconButton>
        </Tooltip>

        <span className="h-6 w-px bg-[var(--color-line)]" />

        {/* ② 缩放百分比 → 打开缩放菜单 */}
        <button
          data-zoom-pill
          onClick={() => setOpen((v) => !v)}
          aria-label={t('canvas.zoomPresets')}
          aria-expanded={open}
          className="flex h-10 w-[89px] items-center justify-between rounded-[12px] border border-[var(--color-line)] bg-[var(--color-fill)] px-3 py-1 text-[14px] font-medium tracking-[-0.14px] text-[var(--color-ink)]"
        >
          {Math.round(zoom * 100)}%
          <FigIcon src={figAsset.chevronDown} size={16} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 类型 + lint 校验**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```
Expected: 均无错。特别确认:不再有 `t('canvas.fitView')` 引用;`figAsset.plus`(Composer 仍用)未被误删;`stepZoom`/`parseZoomInput`/`matchZoomShortcut` 均已导入且被使用。

- [ ] **Step 4: 跑测试确认无回归**

Run: `pnpm test`
Expected: 全绿。

- [ ] **Step 5: 手动验证(dev)**

Run: `pnpm dev`,浏览器打开画布:
- 底部条为 `[整理] | [小地图] | [100%▼]`,无 `+/−/fit`。
- 点 `100%▼` 向上弹出菜单:顶部输入框(取景框图标 + 可编辑百分比,自动聚焦全选)、Zoom in ⌘+ / Zoom out ⌘− / ✓Zoom to 100% ⌘0 / Zoom to 200% ⌘2 / Zoom to fit ⌘1。
- 输入 `150` 回车 → 缩到 150%,当前档勾选随之更新;输入非法(如 `abc`)回退当前值。
- `⌘+`/`⌘−` 步进、`⌘0`→100%、`⌘2`→200%、`⌘1`→fit;在 Composer / 搜索框输入时按这些键**不触发**画布缩放。
- 能缩到 10%(Zoom out 到底置灰)与 200%(Zoom in 到底置灰)。
- 点菜单外 / 滚轮 / Esc 关闭菜单;滚轮同时能缩放画布。
- 明暗主题切换下浮层与 chip 颜色正确(无硬编码色)。

- [ ] **Step 6: 提交**

```bash
W=/Users/nickhopps/Documents/taluna/game-create-platform/.claude/worktrees/feat+canvas-zoom-menu
git -C "$W" add src/components/canvas/AssetCanvas.tsx
git -C "$W" commit -m "feat: 画布缩放菜单(替换 +/−/fit,顶部可编辑输入 + ⌘ 快捷键)

Claude-Session: https://claude.ai/code/session_013TJ3ePbN5GhGL1JsjennbX"
```

---

## Self-Review 记录

- **Spec 覆盖**:区间 10–200%(Task 3 + Task 4 常量)· 菜单五项复用按钮逻辑(Task 4 `stepZoom`/`fitView`)· 可编辑输入(Task 4 `ZoomInput` + Task 1 `parseZoomInput`)· 全局快捷键(Task 4 `useZoomShortcuts` + Task 1 `matchZoomShortcut`)· 保留整理/小地图仅删 +/−/fit(Task 4 `ZoomBar`)· 六语文案(Task 2)· ⌘ 恒显示(Task 4 chip 字面量)—— 均有对应任务。
- **占位符扫描**:无 TBD/TODO;每个代码步给出完整代码。
- **类型一致**:`parseZoomInput`/`matchZoomShortcut`/`ZoomShortcut`/`stepZoom` 签名在 Task 1 定义,Task 4 按同名同参调用;`figAsset.check` Task 2 定义、Task 4 使用;i18n key 命名一致。
- **执行顺序坑**:Task 2 删 `canvas.fitView` 会让 Task 4 之前的 `AssetCanvas` 暂时 tsc 报错 —— 已在 Task 2 Step 5 标注,Task 2→3→4 连续完成后由 Task 4 Step 3 统一校验 `tsc`/`lint`。
