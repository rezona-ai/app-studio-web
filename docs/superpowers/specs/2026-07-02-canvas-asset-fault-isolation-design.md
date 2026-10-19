# 画布资产故障隔离设计

## 背景与问题

画布上部分资产会出现加载 / 轮询报错。期望:**单个资产报错不应影响其他资产**。
实际:一旦有报错,整块画布就不加载(白屏 / 空态)。

## 根因分析

画布"一坏全崩"有两处结构性单点,任一处出问题都会波及全部资产:

1. **数据层——整表映射无单项容错**
   `loadCanvas` 一次性 `set({ assets: canvasItemsToAssets(items) })`,而 `canvasItemsToAssets`
   用 `items.filter(...).map(canvasItemToAsset)` 整表处理。只要某个脏 item(字段缺失、
   `reference` 非对象、甚至整项为 `null` 等后端异常)让处理抛错,整个 `.map` 就抛,
   `loadCanvas` 随之抛出 → `guard` 吞成 Toast,但 `assets` 一个都进不来 → 整块画布不加载。

2. **渲染层——无任何 ErrorBoundary,单卡崩溃连坐整树**
   全仓没有一个 React 错误边界。画布节点卡片(`nodeTypes` 里的 5 类)若在渲染期抛错
   (脏数据触发的非法访问、三方媒体组件 `model-viewer` 等的意外抛错),没有边界隔离,
   会把整棵画布 React 子树(乃至整个 client 树)带崩 → 白屏。

> 注:静态排查未能锁定"必然抛错"的确定输入(各层对常规输入都做了 `??` 兜底),
> 故按**故障隔离**思路在上述两个单点各加一道防线——无论具体触发点是脏数据还是三方组件,
> 都能保证"单卡故障不外溢"。若后续拿到真实报错堆栈,可在更精确的源头再补针对性修复。

## 设计

分层加隔离,happy-path 行为完全不变:

### 数据层:`canvasItemsToAssets` 单项容错(`src/lib/pgc/map.ts`)

把整表 `filter+map` 改为逐项 `for + try/catch`:某项处理抛错则 `console.warn` 留痕并跳过,
其余资产照常映射。与既有"非法 WS 帧 try/catch 跳过"同思路。
`fallbackIdx`(无坐标历史资产的级联序号)只对**成功映射**的项自增,级联序号保持连续。

### 渲染层:per-node 错误边界(`src/components/canvas/nodes/CanvasNodeBoundary.tsx`)

- `CanvasNodeBoundary`:类组件错误边界(React 要求)。子树抛错时 `getDerivedStateFromError`
  置 `failed`,`componentDidCatch` 打 `console.error` 保留现场(哪张卡 / 什么错,不吞)。
- fallback 刻意**极简**:纯 `div`,不含 store / `Handle` / 会失败的逻辑,文案由外部传入——
  避免 fallback 自身再抛、把错误向上冒泡到无边界处。外观复用各节点 `ErrorBody` 的红色提示,
  保留卡片外框 + 标题,使布局不塌陷、用户能认出是哪张卡。
- `withNodeBoundary(Node)`:HOC,在 `nodeTypes` 注册处给每类节点统一套边界;在此(函数组件)
  取 i18n 文案 `canvas.renderError` 再传给类边界,保证类边界本身无 hook。

### i18n

新增 `canvas.renderError`(六语:en 真相源 + zh/fr/ru/ja/vi)。

## 验证

- `src/lib/pgc/map.test.ts`:数组混入 `null` 脏项 → 跳过坏项、其余资产照常映射,且 `console.warn` 留痕。
- `src/components/canvas/nodes/CanvasNodeBoundary.test.tsx`:子组件渲染抛错 → 退化为错误占位
  (含资产名 + 传入文案),不向上冒泡;子组件正常 → 原样渲染。
- 全量 `tsc --noEmit` / `lint` / `vitest`(937)/ `next build` 均通过。
