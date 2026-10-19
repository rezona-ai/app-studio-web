# 预览设备切换（移动/桌面 16:9）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 游戏预览支持移动端（现状 282:519 竖屏）/ 桌面端（16:9 横屏、面板展开覆盖画布）切换，默认移动端。

**Architecture:** store UIState 新增非持久化 `previewDevice`；桌面端复用 compare/Files 的面板展开机制（`calc(100% - chatW)`）；GameFrame 按 device 切换框比例，切换不重建 iframe；切换控件重写遗留 `DeviceToggle.tsx` 为分段图标控件。

**Tech Stack:** Next.js 16 + React 19 + zustand + Vitest(jsdom) + Tailwind（CSS 变量令牌）。

## Global Constraints

- 颜色/圆角/阴影一律走 `globals.css` CSS 变量，禁止硬编码色值。
- 图标一律 `FigIcon`（`src/components/ui/figma.tsx` 的 `figAsset` 注册表），不直接 `<img>`。
- 交互元素带 `aria-label`，外包 `Tooltip`。
- 注释/commit message 用中文；commit 尾部带 `Claude-Session: https://claude.ai/code/session_01HoZJz1R9gGTvvXWZe73m1m`。
- 测试与源码同目录 `*.test.tsx`；验证只信 `pnpm exec tsc --noEmit` 与 `pnpm exec vitest run` 退出码（worktree IDE 诊断有误报）。
- `previewDevice` 不持久化（不进 persist `partialize`）。

---

### Task 1: store 新增 previewDevice 状态

**Files:**
- Modify: `src/store/index.ts`（UIState 接口 ~L42 附近、Actions 接口 ~L91 附近、初始值 ~L124 附近、action 实现 ~L301 附近）
- Test: `src/store/preview-device.test.ts`（新建）

**Interfaces:**
- Produces: `previewDevice: 'mobile' | 'desktop'`（初始 `'mobile'`）、`setPreviewDevice: (d: 'mobile' | 'desktop') => void`，后续任务经 `useStore` 消费。

- [ ] **Step 1: 写失败测试**

```ts
// src/store/preview-device.test.ts
import { describe, expect, it } from 'vitest';
import { useStore } from '@/store';

describe('previewDevice', () => {
  it('默认移动端', () => {
    expect(useStore.getState().previewDevice).toBe('mobile');
  });
  it('setPreviewDevice 切换', () => {
    useStore.getState().setPreviewDevice('desktop');
    expect(useStore.getState().previewDevice).toBe('desktop');
    useStore.getState().setPreviewDevice('mobile');
    expect(useStore.getState().previewDevice).toBe('mobile');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/store/preview-device.test.ts`
Expected: FAIL（`previewDevice` 为 undefined）

- [ ] **Step 3: 最小实现**

`src/store/index.ts` 四处修改：

UIState 接口（`previewTab` 声明旁）：
```ts
  // 预览设备形态:desktop 时面板展开覆盖画布、游戏框转 16:9。瞬态,不持久化。
  previewDevice: 'mobile' | 'desktop';
```

Actions 接口（`setPreviewTab` 旁）：
```ts
  setPreviewDevice: (d: 'mobile' | 'desktop') => void;
```

初始值（`previewTab: 'preview',` 旁）：
```ts
      previewDevice: 'mobile',
```

action 实现（`setPreviewTab` 实现旁）：
```ts
      setPreviewDevice: (previewDevice) => set({ previewDevice }),
```

注意：**不要**改 persist 的 `partialize`（保持不持久化）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/store/preview-device.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/index.ts src/store/preview-device.test.ts
git commit -m "feat: store 新增 previewDevice 预览设备状态(默认 mobile,不持久化)"
```

### Task 2: 新增手机/显示器图标并登记 figAsset

**Files:**
- Create: `public/figma/icons/device-mobile.svg`、`public/figma/icons/device-desktop.svg`
- Modify: `src/components/ui/figma.tsx`（`figAsset` 注册表 + `ICON_TONE` 表）

**Interfaces:**
- Produces: `figAsset.deviceMobile` / `figAsset.deviceDesktop`（Task 3 消费）。

- [ ] **Step 1: 写入两个 SVG（20×20、stroke=currentColor；FigIcon 经 CSS mask 按 alpha 重着色，具体颜色无所谓）**

`public/figma/icons/device-mobile.svg`：
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="2" stroke="#1D1D1D" stroke-width="1.5"/>
  <path d="M9 15h2" stroke="#1D1D1D" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

`public/figma/icons/device-desktop.svg`：
```svg
<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2.75" y="3.75" width="14.5" height="9.5" rx="1.5" stroke="#1D1D1D" stroke-width="1.5"/>
  <path d="M8 16.25h4M10 13.5v2.5" stroke="#1D1D1D" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 2: 登记 figAsset 与 ICON_TONE**

`src/components/ui/figma.tsx`：在 `figAsset` 表按字母序附近插入
```ts
  deviceDesktop: `${F}/device-desktop.svg`,
  deviceMobile: `${F}/device-mobile.svg`,
```
在 `ICON_TONE` 表插入（未选中恒灰、选中态由调用处显式 `tone="primary"` 覆盖，与 PreviewTabs 的 folder/eyeShow 同法）：
```ts
  [figAsset.deviceDesktop]: 'secondary',
  [figAsset.deviceMobile]: 'secondary',
```

- [ ] **Step 3: 类型检查**

Run: `pnpm exec tsc --noEmit`
Expected: 退出码 0

- [ ] **Step 4: Commit**

```bash
git add public/figma/icons/device-mobile.svg public/figma/icons/device-desktop.svg src/components/ui/figma.tsx
git commit -m "feat: 新增手机/显示器设备图标并登记 figAsset"
```

### Task 3: 重写 DeviceToggle 为分段图标控件

**Files:**
- Modify: `src/components/preview/DeviceToggle.tsx`（整文件重写，原为无引用的遗留 `<select>`）
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`deviceMobile`/`deviceDesktop` 去 emoji）
- Test: `src/components/preview/DeviceToggle.test.tsx`（新建）

**Interfaces:**
- Consumes: Task 1 的 `previewDevice`/`setPreviewDevice`；Task 2 的 `figAsset.deviceMobile/deviceDesktop`。
- Produces: `DeviceToggle({ disabled }: { disabled?: boolean })` 默认导出，自行读写 store（Task 4 直接挂载）。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/preview/DeviceToggle.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeviceToggle from './DeviceToggle';
import { useStore } from '@/store';

describe('DeviceToggle', () => {
  it('渲染两个按钮,默认移动端选中', () => {
    useStore.getState().setPreviewDevice('mobile');
    render(<DeviceToggle />);
    const mobile = screen.getByRole('button', { name: 'Mobile' });
    const desktop = screen.getByRole('button', { name: 'Desktop' });
    expect(mobile.getAttribute('aria-pressed')).toBe('true');
    expect(desktop.getAttribute('aria-pressed')).toBe('false');
  });
  it('点击桌面端写入 store', () => {
    useStore.getState().setPreviewDevice('mobile');
    render(<DeviceToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(useStore.getState().previewDevice).toBe('desktop');
  });
  it('disabled 时按钮禁用', () => {
    render(<DeviceToggle disabled />);
    expect(screen.getByRole('button', { name: 'Desktop' })).toHaveProperty('disabled', true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/preview/DeviceToggle.test.tsx`
Expected: FAIL（找不到 aria-pressed / 点击无效——现实现是 `<select>`）

- [ ] **Step 3: 重写实现**

```tsx
// src/components/preview/DeviceToggle.tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';

// 预览设备切换:手机/显示器分段控件,样式语汇与 PreviewTabs 同款(浅底容器 + 选中态 line-strong 底)。
// desktop 时 Workspace 将面板展开覆盖画布、GameFrame 切 16:9(见 2026-07-03 设计稿)。
export default function DeviceToggle({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const device = useStore((s) => s.previewDevice);
  const setPreviewDevice = useStore((s) => s.setPreviewDevice);
  const items = [
    { key: 'mobile' as const, label: t('preview.deviceMobile'), icon: figAsset.deviceMobile },
    { key: 'desktop' as const, label: t('preview.deviceDesktop'), icon: figAsset.deviceDesktop },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-[12px] bg-[var(--color-surface)] p-1">
      {items.map((it) => {
        const active = device === it.key;
        return (
          <Tooltip key={it.key} label={it.label}>
            <button
              type="button"
              aria-label={it.label}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => setPreviewDevice(it.key)}
              className={`inline-flex items-center justify-center rounded-[8px] px-3 py-1 transition-[background-color,color] duration-150 disabled:opacity-40 ${
                active
                  ? 'bg-[var(--color-line-strong)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <FigIcon src={it.icon} size={16} tone={active ? 'primary' : 'secondary'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
```

六个 locale 文件去 emoji（各文件 `deviceMobile`/`deviceDesktop` 两行，保留原译文）：
- `en.ts`: `deviceMobile: 'Mobile',` / `deviceDesktop: 'Desktop',`
- `zh.ts`: `deviceMobile: '移动',` / `deviceDesktop: '桌面',`
- `fr.ts`: `deviceMobile: 'Mobile',` / `deviceDesktop: 'Bureau',`
- `ru.ts`: `deviceMobile: 'Телефон',` / `deviceDesktop: 'Компьютер',`
- `ja.ts`: `deviceMobile: 'モバイル',` / `deviceDesktop: 'デスクトップ',`
- `vi.ts`: `deviceMobile: 'Di động',` / `deviceDesktop: 'Máy tính',`
（先读各文件现值，desktop 原译若已合适则只去掉 emoji 前缀。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/components/preview/DeviceToggle.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/preview/DeviceToggle.tsx src/components/preview/DeviceToggle.test.tsx src/i18n/locales
git commit -m "feat: 重写 DeviceToggle 为分段图标控件并接入 previewDevice"
```

### Task 4: PreviewPanel 接入切换控件 + adaptiveStage 仅移动端

**Files:**
- Modify: `src/components/preview/PreviewPanel.tsx`
- Test: `src/components/preview/PreviewPanel.test.tsx`（追加用例，先读现有 mock/render 模式并沿用）

**Interfaces:**
- Consumes: Task 3 的 `DeviceToggle`；Task 1 的 `previewDevice`。
- Produces: 无新接口（GameFrame 的 device prop 在 Task 5 接线）。

- [ ] **Step 1: 追加失败测试（沿用该文件既有 setup 模式）**

追加用例（依既有 helper 适配写法，断言意图如下）：
```tsx
it('preview tab 下渲染设备切换,files tab 与对比模式下隐藏', () => { /* 见下 */ });
it('无游戏时设备切换禁用', () => { /* 见下 */ });
```
断言：
- 常态（有版本、preview tab、非 compare）：`screen.getByRole('button', { name: 'Desktop' })` 存在且未禁用。
- `setPreviewTab('files')` 后：`queryByRole('button', { name: 'Desktop' })` 为 null。
- `compare.on = true` 后：同上为 null。
- 无版本时：按钮存在但 `disabled` 为 true。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: 新用例 FAIL（控件尚未挂载）

- [ ] **Step 3: 实现**

`PreviewPanel.tsx`：
1. `import DeviceToggle from './DeviceToggle';`
2. 订阅：`const desktopDevice = useStore((s) => s.previewDevice === 'desktop');`
3. tab 行右侧按钮组（下载钮之前）挂控件——与下载钮同规则仅 `!compareOn` 显示；Files tab 时整个 tab 行仍在但设备切换需隐藏 → 条件 `!compareOn && !filesTab`：
```tsx
            {!compareOn && !filesTab && <DeviceToggle disabled={!hasGame} />}
```
4. `adaptiveStage` 仅移动端（桌面端面板全宽，短屏增高逻辑失效且不适用）：
```ts
  const adaptiveStage = !compareOn && !filesTab && !desktopDevice && availH != null;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/components/preview/PreviewPanel.test.tsx`
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add src/components/preview/PreviewPanel.tsx src/components/preview/PreviewPanel.test.tsx
git commit -m "feat: PreviewPanel 接入设备切换,adaptiveStage 仅移动端生效"
```

### Task 5: GameFrame 按 device 切 16:9 + 桌面端停用宽度上报

**Files:**
- Modify: `src/components/preview/GameFrame.tsx`
- Modify: `src/components/preview/PreviewPanel.tsx`（传 prop）、`src/components/preview/CompareView.tsx`（若 GameFrame 签名要求则显式传 `device="mobile"`，先读该文件确认调用方式）
- Test: `src/components/preview/GameFrame.test.tsx`（若无则新建，mock `previewVersionById`）

**Interfaces:**
- Consumes: Task 1 的 `previewDevice`。
- Produces: `GameFrame({ version, device }: { version: Version | null; device?: 'mobile' | 'desktop' })`，`device` 默认 `'mobile'`（CompareView 不传即维持现状）。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/preview/GameFrame.test.tsx（若已存在则追加）
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import GameFrame from './GameFrame';
import { useStore } from '@/store';

describe('GameFrame 设备比例', () => {
  it('移动端框为 282:519', () => {
    useStore.setState({ previewVersionById: vi.fn(async () => null) });
    const { container } = render(<GameFrame version={null} device="mobile" />);
    const frame = container.querySelector('.rounded-\\[10px\\]') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('282 / 519');
  });
  it('桌面端框为 16:9', () => {
    useStore.setState({ previewVersionById: vi.fn(async () => null) });
    const { container } = render(<GameFrame version={null} device="desktop" />);
    const frame = container.querySelector('.rounded-\\[10px\\]') as HTMLElement;
    expect(frame.style.aspectRatio).toBe('16 / 9');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/components/preview/GameFrame.test.tsx`
Expected: FAIL（无 device prop，恒 282:519）

- [ ] **Step 3: 实现**

`GameFrame.tsx`：
1. 尺寸表替换 `SINGLE_FRAME_SIZE`：
```ts
// 单预览框:按设备定比例,宽度在「面板可用宽 / 可用高反推宽」间取小(contain 适配)。
// 移动 282:519(竖屏);桌面 16:9(横屏,面板已由 Workspace 展开为全宽)。
const FRAME_SIZE = {
  mobile: { width: 'min(100%, calc(100cqh * 282 / 519))', aspectRatio: '282 / 519' },
  desktop: { width: 'min(100%, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' },
} as const;
```
2. 签名：`export default function GameFrame({ version, device = 'mobile' }: { version: Version | null; device?: 'mobile' | 'desktop' }) {`
3. 框样式：`style={FRAME_SIZE[device]}`
4. 宽度上报仅移动端（桌面端面板宽不由比例反推;切回移动端要恢复上报,故 ResizeObserver 回调内判 device）——`measureStage` 的 ro 回调加卫：
```ts
      if (deviceRef.current === 'desktop') return;
```
配套（回调 ref 只建一次，device 变化经 ref 透传避免重挂 observer）：
```ts
  const deviceRef = useRef(device);
  deviceRef.current = device;
```
并在 device 从 desktop 切回 mobile 时强制补报一次（高度未变也要报，因 lastH 未变会被跳过——将 `lastH.current = 0` 重置放在渲染期 guard）：
```ts
  // 渲染期一次性 guard:切回移动端时重置去抖水位,让下一次 RO 回调必上报(遵守仓库禁 effect-setState 约束)
  const prevDevice = useRef(device);
  if (prevDevice.current !== device) {
    prevDevice.current = device;
    if (device === 'mobile') lastH.current = 0;
  }
```

`PreviewPanel.tsx`：`<GameFrame version={active} device={desktopDevice ? 'desktop' : 'mobile'} />`。
注意父级 key **不含 device**（切换设备不重建 iframe、游戏运行态保活）。

`CompareView.tsx`：读文件确认；`device` 有默认值 `'mobile'`，不传则无需改动。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/components/preview/GameFrame.test.tsx src/components/preview/PreviewPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/preview/GameFrame.tsx src/components/preview/PreviewPanel.tsx src/components/preview/GameFrame.test.tsx
git commit -m "feat: GameFrame 按设备切 16:9 横屏,桌面端停用面板宽上报"
```

### Task 6: Workspace 桌面端展开面板

**Files:**
- Modify: `src/components/workspace/Workspace.tsx`（~L36-38 订阅、~L110 宽度条件）

**Interfaces:**
- Consumes: Task 1 的 `previewDevice`。

- [ ] **Step 1: 实现**

订阅处（`filesTab` 旁）：
```ts
  const desktopDevice = useStore((s) => s.previewDevice === 'desktop');
```
展开条件（overlay width 一处，spacer 不动——桌面端与 compare/files 同为「覆盖画布」语义，常态 spacer 保持游戏比例宽）：
```tsx
          style={{ width: compareOn || filesTab || desktopDevice ? `calc(100% - ${chatW}px)` : normalPreviewW }}
```

- [ ] **Step 2: 全量验证**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm lint`
Expected: 全部退出码 0

- [ ] **Step 3: Commit**

```bash
git add src/components/workspace/Workspace.tsx
git commit -m "feat: 桌面端预览时面板展开覆盖画布"
```

### Task 7: 运行态验证

- [ ] **Step 1**: 起 dev（或按 memory 的 prod 方式），Playwright 打开工作区：确认默认移动端竖屏 → 点显示器图标 → 面板 300ms 展开、游戏框 16:9、iframe 未重载（可在 iframe 内 console 标记验证或观察无重新 loading 态）→ 切回移动端面板收窄恢复。截图移动/桌面两态。
- [ ] **Step 2**: 验证边界:进对比模式控件消失、退出恢复;切 Files 控件消失;无游戏项目控件禁用。
- [ ] **Step 3**: 深浅主题各看一眼图标着色(mask 重着色是否正常)。
