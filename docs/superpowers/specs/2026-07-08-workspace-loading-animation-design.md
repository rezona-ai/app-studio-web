# Workspace 加载动画优化 设计稿

日期:2026-07-08

## 背景与目标

全屏启动加载层(`LoadingScreen` variant='brand',由 `Workspace.tsx` 的 `booting || authRequired` 驱动)当前存在三点不足:

1. **视觉气质**:全屏底复用生成骨架卡的 `.skeleton-shimmer`(灰底横扫微光),嘈杂、"骨架屏感",与中心精致的品牌动画气质不搭;
2. **进度反馈**:booting 期间(拉项目列表 → 选定项目 → 并行拉画布+版本,通常 1~3s)文案恒定一句,无进行感;
3. **完成退场**:仅 200ms 整层淡出,无"加载完成"的收束仪式。

目标:在**不动数据流、不引入人为延迟**的前提下,提升启动层的品牌质感、进行感与退场衔接。

## 范围

- **只改** `variant="brand"` 全屏启动层。
- `variant="spinner"`(预览 / CompareView 等小容器)**不动**,保留 shimmer 底——骨架语义在小容器里是正确的。
- 不改 store / actions:不做真实阶段上报(总时长太短、阶段边界穿插在 `guard/finally` 中,侵入成本高、收益低——被否决的方案 2);不做固定时长品牌开场(人为拖慢进入,被否决的方案 3)。

## 设计

### 1. 视觉气质

- 全屏底弃用 `.skeleton-shimmer`,新增 **`.brand-backdrop`**:`background: var(--color-canvas)` 之上叠中心 radial 柔光(`radial-gradient(closest-side, var(--color-teal-soft), transparent)`,大直径、低强度),**静态不动画**。
- 入场编排(在现有动画上只调延迟,不改动画本体):
  - logo 弹入:0ms 起(现状不变);
  - 字标逐字浮现:整体延迟 **+150ms**(每字仍 +50ms 递增);
  - label 文案:再 **+250ms** 淡入。
- logo 呼吸浮动、字标循环扫光保持现状。

### 2. 假进度文案轮播

- `LoadingScreen` 内部(仅 brand 分支)本地 interval:每 **900ms** 顺序切换文案,走到最后一条**停住不循环**。
- 文案 i18n key `workspace.bootHints.0..2`,六语补齐(en 为单一真相源):
  - 「正在连接工作台…」→「载入项目与画布…」→「马上就好…」
- 切换动效复用既有类:旧文案 `.anim-fade-out`、新文案 `.anim-media-in`;`prefers-reduced-motion` 下直接换字。
- 纯展示层假进度:booting 撤层即整层退场,轮播走到哪算哪,不等播完。

### 3. 揭幕退场

- `Workspace.tsx` 的 `useExitTransition` 时长 **200 → 240ms**。
- `closing` 时(brand 分支):整层 `.anim-fade-out` 之外,中心内容容器加新类 **`.brand-exit`**(240ms:scale 1 → 1.06 + 淡出,缓动 ease-in)。
- workspace 主内容不加进场动画(避免 re-render 反复触发),揭幕感由加载层的放大淡出承担。

### 4. 降低动态

- `.brand-exit` 补进 `globals.css` 的 `prefers-reduced-motion` 禁用列表;`.brand-backdrop` 静态无需禁。
- 文案轮播在 reduced-motion 下仍切换(信息性内容),仅去掉淡入淡出。

## 测试

`LoadingScreen.test.tsx` 补充:

- brand 变体渲染 `.brand-backdrop` 而非 `.skeleton-shimmer`;spinner 变体仍渲染 shimmer;
- fake timers 推进:文案按 900ms 顺序切换,停在最后一条不回绕;
- `closing=true` 时中心容器带 `.brand-exit`。

## 改动面

| 文件 | 变更 |
|---|---|
| `src/components/ui/LoadingScreen.tsx` | brand 分支换底、入场延迟编排、文案轮播、退场类 |
| `src/app/globals.css` | 新增 `.brand-backdrop` / `.brand-exit`,补 reduced-motion 列表 |
| `src/components/workspace/Workspace.tsx` | `useExitTransition` 200 → 240ms |
| `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts` | 新增 `workspace.bootHints.0..2` |
| `src/components/ui/LoadingScreen.test.tsx` | 上述测试 |
