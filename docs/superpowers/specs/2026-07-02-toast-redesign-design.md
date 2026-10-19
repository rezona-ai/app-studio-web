# 全局 Toast 重构设计稿

> 日期:2026-07-02 · 对齐 Figma `TALUNA DEVELOPER SITE` node `955-49756`(及分型 `955-49849` / `955-43601` / `955-49848`)

## 背景

现有全局 `Toast`(`src/components/ui/Toast.tsx`)订阅 `store.lastError`,以「状态点 + 加粗 code 前缀 + 迷你 ✕」的形态展示,仅支持 `error` / `notice` 两类。设计稿给出了全新的三型 toast 规格:实心状态图标 + 单行消息 + 标准关闭 X,视觉差异较大,需按稿重做。

## 设计决策(已与用户确认)

1. **恒浅色,像素还原**:toast 永远浅色(白底 + 10% accent 底纹 + 深色文字),不随主题翻转——类比 `.btn-raised` 这一既有「恒浅色」例外。深色主题下不写分支,直接沿用同一套固定色。
2. **扩展三型 + 去 code 前缀**:`kind` 由 `error | notice` 扩为 `error | success | warning`;现有 4 处 `notice` 调用迁移到 `warning`;toast 只渲染消息文本,`code` 仍传入用于 i18n 解析,但不再作为加粗前缀可见。

## 视觉规格(严格对齐 Figma)

### 容器(node `955:49756`)
- 布局:`display:flex; align-items:center; gap:16px`。
- 内边距:`padding: 12px 12px 12px 16px`(上 12 / 右 12 / 下 12 / 左 16)。
- 圆角:`8px`。
- 宽度:**定宽 `473px`**(`w-[473px] max-w-full`,窄画布收缩),文案 `flex:1` 左对齐撑满、短文案右侧留白 X 靠右——对齐 Figma 定宽框 + 文案 `flex:1 0 0`。
- 底色:白底叠 10% accent → `color-mix(in srgb, <accent> 10%, #ffffff)`。
- 边框:1px accent 淡边。Figma 帧高 50px、内容高 48px(icon 24 + 上下 padding 24),差 2px ⇒ 存在 1px 描边。`1px solid color-mix(in srgb, <accent> 22%, transparent)`(像素比对已确认)。
- 定位(对齐 Figma 955-49756 的画布内摆放):**画布中列底部居中、落在缩放条上方**。toast 仍挂 Workspace 根做 `fixed` + `z-[100]` 恒在最上(不被预览覆盖层/模态遮挡);由 Workspace 传入画布列左右内缩(`leftInset=chatW+1` / `rightInset=normalPreviewW`),使横向中心与缩放条(`bottom-5 left-1/2`)一致;纵向 `bottom-[100px]`(距缩放条顶 22px,经运行态 rect 实测与设计换算 ≈23px 吻合)。外框 `pointer-events-none` 放行画布交互、卡片 `pointer-events-auto`。

### 文案(node `I955:49756;219:931`)
- 字体:Inter Regular `14px`,行高 `22px`,`letter-spacing: 0.22px`。
- 颜色:`#262626`。
- 仅显示消息文本(`resolveErrorMessage(code, message, t)` 的解析结果);**不再有加粗 code 前缀**。
- 换行:`word-break: break-word`。

### 状态图标(24×24,双色 baked)
| kind | accent 值 | 图标形态 |
|---|---|---|
| `error` | `#ff5630` | 实心圆 + 白色 `!` |
| `success` | `#22c55e` | 实心圆 + 白色 ✓ |
| `warning` | `#ffab00` | 实心三角 + 白色 `!` |

> 注:`error` 采用设计稿的 `#ff5630`(比现有 `--color-danger` #e5484d 更偏橙),以严格还原设计,不复用 danger。

### 关闭按钮(node `365:4316`,24×24)
- X 图标,颜色 `#202020`。
- 命中区 24px;hover 加浅色 `--color-fill` 底 + 轻微 `active:scale`(沿用 `IconButton` 语汇的 `motion-safe:active:scale-[0.92]`)。
- `aria-label` 走 i18n `common.close`。

## 涉及改动

### 1. 设计令牌(`src/app/globals.css`)
在 `@theme` 内新增三个**恒定**(不进 `[data-theme="dark"]` 覆盖块)的 toast accent 令牌:
```css
--color-toast-error: #ff5630;
--color-toast-success: #22c55e;
--color-toast-warning: #ffab00;
```
底色/边框在组件内用 `color-mix` 由这三个令牌派生,避免再堆叠 6 个派生令牌。文字色 `#262626` / 关闭色 `#202020` 为 toast 专用固定值,组件内直接写(恒浅色语境下的 sanctioned 固定色,类比 `.btn-raised` 的固定深色字)。

### 2. 图标资产(`public/figma/icons/` + `src/components/ui/figma.tsx`)
手写 4 个干净 SVG(Figma 导出为碎片化矢量片段,不适合直接用):
- `toast-error.svg` / `toast-success.svg` / `toast-warning.svg`:双色 baked(accent 形 + 白字形),`viewBox 0 0 24 24`;经 `FigIcon` 以 `tone="original"` 渲染(`<img>`,保留原配色)。
- `close.svg`:单色可 mask 的 X;`FigIcon` 渲染,toast 内以固定 `#202020` 着色。

在 `figAsset` 注册表登记 `toastError` / `toastSuccess` / `toastWarning` / `close` 四个键。状态图标无需进 `ICON_TONE`(默认 primary,但调用处显式传 `tone="original"`);`close` 保持默认 primary 以便他处复用。

### 3. store 契约(`src/store/types.ts`)
```ts
export type ToastKind = 'error' | 'success' | 'warning';
export type ToastMessage = { code: string; message: string; kind?: ToastKind }; // 默认 error
```
迁移调用点(`notice` → `warning`):
- `src/components/preview/SharePopover.tsx`(CLIPBOARD 复制失败)
- `src/client/useAuthGuard.ts`(AUTH dev-cookie)
- `src/i18n/errors.ts` `connErrorToast`:返回类型 `'error' | 'notice'` → `'error' | 'warning'`,`SESSION_SUPERSEDED` 分支 `notice` → `warning`。

### 4. 组件重写(`src/components/ui/Toast.tsx`)
- 结构:`[状态图标] [消息文本 flex-1] [关闭 X]`,替换旧的「点 + 加粗 code + ✕」。
- 按 `shown.kind`(默认 `error`)映射图标资产与 accent 令牌;底色/边框用 `color-mix` 派生。
- **保留**:自动消失 4s + hover 暂停计时;`useExitTransition` + `.toast-pop` 退场。a11y role 按新 kind 归类:`error` → `role=alert` + `aria-live=assertive`;`success` / `warning` → `role=status` + `aria-live=polite`。
- 渲染期 `adjust state during render` 保留末次内容(现有模式不变)。

### 5. 测试(`src/components/ui/Toast.test.tsx` + 相关)
- 去掉「加粗 code 前缀可见」的断言。
- 新增三型断言:各 kind 渲染对应图标 `src` 与 accent 派生底色;默认 kind = error。
- 保留 auto-dismiss / hover-pause / 关闭按钮 / a11y role 断言。
- `connErrorToast` 相关测试(若有)同步 `notice` → `warning`。

## 保持不变(不在本次范围)
- toast 的顶部居中定位与触发链路(`setError` → `lastError` → 订阅渲染)。
- i18n 解析 `resolveErrorMessage` / `common.close`。
- 动效令牌 `toast-in` / `toast-out` / `.toast-pop`(已符合 motion spec)。

## 验收标准
1. `pnpm exec tsc --noEmit` + `pnpm lint` + `pnpm test` 全绿。
2. 本地以 `NODE_ENV=production tsx server.ts` 渲染 error/success/warning 三型 toast,与 Figma 截图**逐项像素比对**(间距 / 图标 / 配色 / 边框 / 字体),产出对照表,逐项达标后才宣称完成。
3. 深色主题下 toast 仍为恒浅色卡片、文字/图标清晰可读。

## 反模式规避
- 不硬编码零散色值:三型 accent 走新令牌;固定文字/关闭色是恒浅色语境的 sanctioned 例外并注明理由。
- 图标走 `FigIcon` + `figAsset` 注册表,不裸 `<img>` / 不留字符 `✕`。
- 不新增按钮种类、不自造 toast、不写一次性 keyframes(复用 `.toast-pop`)。
- worktree 内改动用 worktree 绝对路径,避免误写主仓。
