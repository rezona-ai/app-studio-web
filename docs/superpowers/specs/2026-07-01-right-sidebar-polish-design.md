# 完善右边栏(PreviewPanel)设计稿

- 日期:2026-07-01
- Figma:`vtfn5ZttNgStezVfJR6wgB` · node `1527-40918`(Right Sidebar)
- 分支:`feat/right-sidebar-i18n-width-versions`(基于 dev)

## 背景与目标

对照设计稿继续完善右边栏(`src/components/preview/PreviewPanel.tsx` 及其子组件),完成三件事:

1. **语言下拉**:账户条头像旁加国际化下拉,切换后**同步修改主站的 i18n 配置**。
2. **宽度自适应**:右边栏宽度按游戏预览的实际宽度自适应,让游戏预览**横向铺满**整个右边栏(去黑边)。
3. **Versions 时间线**:版本区按设计稿改为**竖向时间线**样式重新实现。

三者都局限在右边栏及其数据流(store UIState + Workspace 布局 + i18n),互不阻塞,合并为一份 spec。

## 现状约束(实现须尊重)

- **i18n 当前是纯下行**:主站经 `postMessage`(`taluna-config` 帧)下发 `{ theme, lang }`,`src/client/useHostConfig.ts` 监听并实时套用到 `<html>`;刷新时由 `src/app/layout.tsx` 的防白闪内联脚本读取 `localStorage['taluna-config']`。代码明确注释「分站不回写 localStorage —— taluna-config 完全由主站管理」。**本需求引入一个受控例外**:用户主动切换语言时分站回写 `taluna-config.lang`。
- `normalizeLocale`(`src/i18n/config.ts`)已存在:任意入参归一为合法 `Locale`(en/zh/fr/ru/ja/vi),回退 en。
- 设计令牌全在 `src/app/globals.css`:青绿 `--color-teal:#1fd4cf`、accent `--color-accent:#3582ff`、描边 `--color-line`/`--color-line-2`。**禁止硬编码色值**。
- 组件复用优先:`Select`(公共单值下拉,plain variant 已带描边胶囊+chevron+Esc/外点关闭+视口夹取+`.anim-pop-in`)、`IconButton`、`Button`、`FigIcon`(`chevronDown` 已注册)。
- store 是唯一真相源;跨组件协调走 store 字段;瞬态不持久化(persist key `taluna-v4`,partialize 白名单)。
- 坐标/布局归前端所有;`await` 后校验 `currentProjectId`(本需求不涉异步 action,但沿用不变式意识)。

---

## 功能 #1:语言下拉(同步主站 i18n 配置)

### 位置与外观

账户条右侧,credit 与头像之间(设计稿 `⚡0 credit ┆ En ▾ ┆ 头像`)。渲染进 `UserInfo` 的右侧 flex,插在 credit `<span>` 与首字母头像之间。

### 组件:复用 `Select` + 新增可选 `triggerLabel`

- `Select` 新增**可选** prop `triggerLabel?: string`:提供时触发钮显示该文本(紧凑短码),不提供时维持现状(显示选中项 `label`)。**向后兼容**,不影响既有调用(ModelSelector / GenerateForm)。
- 新增 `src/components/preview/LanguageMenu.tsx`:
  - 选项 = 6 个 locale,`label` 为**母语全称**(English / 中文 / Français / Русский / 日本語 / Tiếng Việt),`value` 为 locale code。母语名是语言无关常量,**不进 i18n 词典**。
  - 触发钮短码:`EN / ZH / FR / RU / JA / VI`(大写 2 字母,统一风格)。
  - `variant='plain'`、`align='right'`(贴右侧,菜单向左展开夹进视口)。
  - `ariaLabel` = `t('preview.language')`。

### 数据流

- **当前值** = `normalizeLocale(i18n.language)`(经 `useTranslation()` 的 `i18n` 取,react-i18next 响应式;主站运行期 postMessage 改语言时下拉自动跟随重渲)。
- **选择 locale 时**:
  1. `i18n.changeLanguage(locale)` —— 本地即时重渲。
  2. `document.documentElement.lang = locale` —— 对齐 `<html lang>`(与 useHostConfig 同路径)。
  3. **合并写** `localStorage['taluna-config']`:读现有 → 只覆盖 `lang` 字段(**保留 `theme` 等其余字段**) → 写回。主站下次读取该同源 key 即生效。

### 纯逻辑下沉

`src/lib/host-config.ts` 新增纯函数:

```ts
// 合并生成新的 taluna-config JSON 串:容错解析现有(非法/空 → {}),浅合并 patch,序列化。
// 仅做纯变换,IO(读写 localStorage)由调用方负责。
export function serializeHostConfigPatch(rawExisting: string | null, patch: Partial<HostConfig>): string
```

`LanguageMenu` 负责 `localStorage.getItem/setItem` 的副作用,调用 `serializeHostConfigPatch` 得到写回串。

### 约定注释更新

`src/app/layout.tsx`、`src/client/useHostConfig.ts`、`src/lib/host-config.ts` 中「分站不回写 localStorage / 完全由主站管理」的注释,补充「**除用户主动切换语言外**(见 LanguageMenu):此时分站合并写 `taluna-config.lang`」。

### i18n 键

6 语各补:`preview.language`(下拉 aria-label,如 "Language" / "语言" / …)。母语名不入词典。

---

## 功能 #2:右边栏宽度自适应游戏预览

### 思路(按可用高度反推宽度 + 上下限夹取)

游戏固定竖屏比例 **282:519**。面板宽度由**预览舞台可用高度**反推,使游戏横向铺满、无黑边。

### 无循环依赖(关键论证)

面板 `h-full` = 视口高;账户条 / 版本控制行 / tab 行为固定行高,Versions 与预览区按纵向 flex 分高——**舞台高度只由视口高决定,与面板宽无关**。因此「测高 → 算宽 → 改宽」不会反过来改高;改宽只改变游戏在舞台内的**渲染宽度**(黑边收窄至 0),不改变舞台高度,一帧收敛。为进一步屏蔽 ResizeObserver 因宽度变化的空转,用 `lastHeight` ref 去抖:测得高度未变则不重算。

### 实现

- **纯函数** `computePreviewWidth(stageInnerHeight, { ratio, min, max })`(建议放 `src/lib/viewport.ts` 或新建 `src/lib/preview-width.ts`):
  `clamp(Math.round(stageInnerHeight * ratio), min, max)`,`ratio = 282/519`。单测覆盖夹取边界。
- **store**:UIState 加瞬态字段 `previewWidth: number | null`(初始 `null`) + action `setPreviewWidth(px: number | null)`。**不进 partialize**(瞬态,随视口变化实时算)。
- **PreviewPanel**:游戏舞台外层挂 `ref`,`ResizeObserver` 观测其 content 高度 → `computePreviewWidth` → `setPreviewWidth`;`lastHeight` ref 去抖;卸载时 `disconnect`。参数 max 常量 **520**;min 见下「优化」小节(演进 340→240→360→330,承担「账户条最小宽 + 触发时增高舞台」双重下限)。
- **Workspace**:读 `previewWidth`。
  - 常态(非 compare、非 files):spacer 与 overlay 均用 `style={{ width: previewWidth ?? DEFAULT }}`(`DEFAULT = 380`,首帧/未测得时兜底)。移除固定 `PREVIEW_W` 类作为常态宽度来源(该类保留为兜底默认值来源可选)。
  - compare / files:维持现状 `calc(100% - chatW)` 铺满覆盖画布。
  - 保留 `transition-[width] duration-300`;拖拽 Chat 分隔条期间不受影响(previewWidth 只随视口高变化)。
- **GameFrame**:舞台去左右内边距(或减到最小)让游戏贴面板边;保留 `min(100%, calc(100cqh * 282 / 519))` 作为 clamp 触发(极端视口)时的**居中留黑边兜底**。

### 边界

- 视口极高 → clamp 到 max(520),游戏回退居中留黑边(可接受)。
- 视口触发下限 MIN → 见下「优化」:优先增高舞台填满 MIN 宽、压缩版本区;版本区触底(≈110px)仍不够才留少量黑边。
- SSR / 首帧:`previewWidth === null` → 用 `DEFAULT`,避免水合不一致。

### 优化(2026-07-01):账户条完整显示 + 触发下限时增高舞台填宽

原始设计 min=340,后为消黑边降到 240(commit `5303a68`)。但 240 过窄暴露两问题:①顶部**账户条**(分享按钮 · credit · 语言下拉 · 头像)放不下,右端头像被裁;②credit 数字宽度**无界**(`String(balance)`),大额积分会顶到分享按钮——单纯抬下限治不了本。故两处联动优化,并把 **min 定为 330**(按「~900px 视口 + 版本区 2 行」反推,见 B;仍 > 账户条硬底 ~305)。

**A. 账户条永不裁 / 永不碰撞**
- `formatCredit` 改紧凑记法:`< 1000` 精确(`856`),`≥ 1000` 缩写 `K/M/B`(`1.2K` / `3.4M` / `1.5B`),固定 `en` 记法(不随 i18n 出现 万/億),宽度有界。新增 `formatCreditExact`(千分位)供 credit 悬停 `title` 显示精确值。
- `UserInfo`:`ml-auto` 右对齐 + `min-w-0`;credit 数字 `min-w-0 truncate` 为唯一可让位者(图标 / 单位 / 语言下拉 / 头像均 `shrink-0`)。账户条容器 `justify-between → gap-3`(保底 12px)+ 分享按钮 `shrink-0`——结构上保证 credit 永不顶到分享按钮。
- min=330(> 账户条硬底 ~305)使紧凑账户条在六语下仍不截断完整显示。

**B. 触发下限时增高舞台、压版本区(消黑边)**
游戏窄竖屏(282:519),填满 MIN=330 宽需舞台内容高 `330/比例 ≈ 607px`(连 tab48 + py16 ≈ 671 的预览块);多数笔记本按 7:3 分高够不到 → 露黑边。改为:**预览块优先增高到填满 MIN 宽,不足的高度从版本区借**(版本区变矮可接受,触底 ≈178px = 表头 + 2 行,其余滚动)。MIN=330 即按「填满高 671 + 版本区 178 ≈ 849 可用高(≈900px 视口)」反推,使常见 13–14" 笔记本正好落在填满档。
- 纯函数 `computePreviewBlockHeight(available)`(放 `preview-width.ts`,单测):
  `理想高 I = MIN/比例 + TAB(48) + STAGE_PAD(16)`;`版本区最小 Vm = 110`;
  `预览块高 = max(available × 7/10, min(I, available − Vm))`(恒 ≤ available,版本区 = 余量)。
- `PreviewPanel`:预览块 + 版本区外包一层测量容器,callback-ref + ResizeObserver 量 `available`(沿用 GameFrame 去抖模式,只用高度、与宽无关 → 无循环);**仅常态预览**按公式给预览块设显式高、版本区 `flex-1 min-h-0`;**compare / files 维持 7:3**。
- 游戏渲染宽仍由现有 `computePreviewWidth(舞台高)` 链路自动跟随——只控制舞台高,宽度自动到位。
- 三档(available = 面板高 − 账户条 ≈ 视口高 − 52):大显示器(available ≥ ~959)按 7:3、游戏 >330 至 MAX;中高笔记本(~849–959,≈901–1011px 视口)填满 330、版本区 178–288;普通/矮笔记本(< ~849,如 768 available≈680)物理填不满 → 版本区触底 178、游戏留少量黑边(优雅降级,不溢出)。
- 测试:`computePreviewBlockHeight` 覆盖三档 + 退化;`formatCredit` 紧凑分档 + 进位;`formatCreditExact` 千分位。

---

## 功能 #3:Versions 竖向时间线

### 布局(对齐设计稿,去封面 / 去摘要)

- **头部不变**:`Versions` 标题 + `⟳ Compare` 按钮(既有逻辑保留:≥2 版本才可启用,空版本不显示)。
- **列表 → 竖向时间线**:
  - 左侧**轨道列**:每项一个圆点标记,圆心间由竖线连接(首项只向下、尾项只向上、中间双向)。
  - 右侧**内容**:版本名(粗体)+ 时间戳(右对齐、muted)。
- **标记态**:
  - 激活/选中 → **实心青绿圆** `--color-teal`(对齐设计稿 Version 3)。
  - compare 模式的对比对象(`compareWithId`)→ **accent 蓝描边圆** `--color-accent`。
  - 其余 → 空心圆(`--color-line-2` 描边、透明填充)。
  - `buildingVersion`(构建中占位)→ 顶部脉冲空心圆 + spinner。
- **连接线** `--color-line`。
- **时间戳格式** 改为 `HH:MM; DD/MM/YYYY`(24 小时,对齐设计稿 `17:35; 20/07/2026`)。无效时间返回空串、不渲染。
- **点击**:常态 `setActive(v.id)`;compare 模式 `setCompareWith(v.id)`(不能选激活项,沿用现有守卫)。
- **顺序**:最新在上(保留 `.reverse()`)。

### 清理

- `VersionCover.tsx` 与 `VersionCover.test.tsx` 改版后成为 dead code(仅被 VersionTimeline 引用)→ **删除**(遵循「不留 dead code」)。

### 动效 / 无障碍

- 沿用既有令牌与动画类,不新增一次性 keyframes;脉冲态在 `prefers-reduced-motion: reduce` 下退化(若新增 `.anim-*` 类须补进 globals 该媒体查询禁用列表)。
- 每项 `aria-pressed`(选中态)+ 可读 `aria-label`。

---

## 测试(TDD,同目录 `*.test.ts(x)`)

- **纯逻辑**:
  - `serializeHostConfigPatch`:保留 theme、写 lang、malformed/空 JSON 容错。
  - `computePreviewWidth`:min/max 夹取、round。
  - `formatVersionTime`:新 24h 格式(`17:35; 20/07/2026`)、无效时间空串。
- **组件**:
  - `LanguageMenu`:渲染当前 locale 短码;选择某语言 → `i18n.changeLanguage` 生效 + `localStorage['taluna-config']` 合并写入(theme 保留)。
  - `VersionTimeline`:时间线标记态(激活青绿 / compare 蓝 / 其余空心)、点击 setActive、compare 模式 setCompareWith、时间戳格式。
  - `Select`:新增 `triggerLabel` 时触发钮显示该文本(回归既有行为)。
- **更新**:`PreviewPanel.test.tsx`(账户条含 LanguageMenu、宽度自适应挂载不炸)、`VersionTimeline.test.tsx`(去封面后断言调整)。

## 文件影响

- **新增**:`src/components/preview/LanguageMenu.tsx`(+test)、`src/lib/preview-width.ts`(+test,或并入 viewport.ts)。
- **改**:`Select.tsx`(+`triggerLabel`)、`UserInfo.tsx`、`PreviewPanel.tsx`、`VersionTimeline.tsx`、`GameFrame.tsx`、`Workspace.tsx`、`store/index.ts`+`store/types.ts`(`previewWidth`/`setPreviewWidth`)、`lib/host-config.ts`(+`serializeHostConfigPatch`,test)、`app/layout.tsx` / `client/useHostConfig.ts` 注释、6 个 locale(+`preview.language`)。
- **删**:`VersionCover.tsx`(+test)。

## 开放参数(默认值,可调)

- 面板宽度 min **330**(演进 340→240→360→330,见功能 #2「优化」;按 ~900px 视口 + 版本区 2 行反推,仍 > 账户条硬底 ~305) / max 520 / 默认 380px。
- 版本区触发下限时最小高 Vm **178px**(表头 + 2 行);预览块与版本区分高比例 7:3。
- 触发钮短码大写 2 字母(`EN/ZH/FR/RU/JA/VI`)。
