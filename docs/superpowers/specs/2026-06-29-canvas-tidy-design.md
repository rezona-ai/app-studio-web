# 资产画布「一键整理」设计稿

> 日期:2026-06-29 · 分支:`worktree-feat+canvas-tidy`

## 背景与目标

资产画布的位置**归前端所有**:卡片在创建那一刻落位一次,系统此后永不挪动(`card-layout.ts` 注释、CLAUDE.md「轮询/重连结果不得覆盖已有 position」)。用户手动生成、派生、拖拽多了之后,画布容易杂乱。

本需求新增**一键整理**:用户主动点一个按钮,把画布上所有卡片重排成整齐的树形布局。这是对「系统永不挪动卡片」原则的**有意例外**——只在用户显式触发时发生,不是后台自动行为。

按钮放在画布下方的浮动工具栏(`ZoomBar`)。

## 关键决策(已与用户确认)

| 决策 | 选择 | 理由 |
|---|---|---|
| 布局算法 | **树形/血缘布局** | 尊重 `parentId` 森林,与现有 `childPosition` 语义、beam 连线天然对齐,保留派生血缘 |
| 作用范围 | **全部卡片** | 整个画布彻底归位,避免被类型过滤隐藏的卡片与新位置重叠 |
| 反馈 | **平滑动画** | 卡片滑到新位置,符合项目动效语汇;`prefers-reduced-motion` 下退化为瞬间到位 |
| 相机 | **不动** | 锚点取当前卡片 min(x,y),整理后仍停在用户视野;不做 fitView |

## 架构与单向数据流

沿用项目分层:纯落位逻辑下沉 `lib/`,状态变更走 store action,UI 只调 action。

```
ZoomBar「整理」按钮 ──onTidy──▶ store.tidyCanvas()
                                   │ 1. tidyLayout(assets)  ← lib/card-layout.ts(纯函数)
                                   │ 2. 一次 set 写入全部新 position
                                   │ 3. 逐个 persistAssetPosition(变位且非 pending_ 的卡)
                                   ▼
                              assets 更新 → AssetCanvas 节点同步 → CSS transition 平滑滑动
```

## 组件设计

### ① `tidyLayout(nodes)` —— 纯函数(`src/lib/card-layout.ts`)

- **输入**:资产的最小形状 `{ id: string; parentId?: string; position: XY }[]`(不引入 store 的 `Asset` 类型,保持 `card-layout.ts` 无业务依赖)。
- **输出**:`Map<string, XY>`(id → 新坐标)。
- **算法**(经典 tidy-tree,O(n),保证无重叠):
  1. **建森林**:`parentId` 缺失,或指向不在集合内的 id(孤儿边)→ 视为根。与 `selectCanvasEdges` 的「parentId 存在于集合才连线」一致。
  2. **列 = 深度**:`x = baseX + depth · (CARD_W + GAP_X)`,根在最左,派生链向右。
  3. **行 = DFS 叶序 + 父节点居中**:
     - 叶子:占据当前行,`row += 1`。
     - 内部节点:先递归布完全部子节点,自身行 = 首末子节点行的中点 → 父卡纵向居中于其子树。
     - `y = baseY + nodeRow · (CARD_H + GAP_Y)`(nodeRow 可为分数,坐标连续不影响无重叠)。
  4. **多根分带**:每棵树之间额外留一行空隙。
  5. **排序**:根之间、兄弟之间均按各自**当前 (y, x)** 升序排 → 整理结果贴近现有排布,像「梳理」而非「打乱」,且确定性可测。
  6. **锚点**:`baseX = min(当前所有卡 x)`、`baseY = min(当前所有卡 y)` → 整理后停在原区域。最终坐标 `Math.round`(后端 `canvas_x/y` 是 int)。
  7. **防环**:visited 集合兜底(派生理论无环,防御性避免无限递归)。
- **无重叠论证**:同列(同深度)不同行间距 ≥ `CARD_H + GAP_Y`;不同子树占据互斥的行区间(DFS 一棵子树连续布完才进下一棵,row 单调递增),父节点居中只发生在自己列内、自己子树的行区间内,故不与他树同列节点碰撞。

### ② `tidyCanvas()` —— store action(`src/store/actions.ts`,`createServerActions` 闭包)

```
tidyCanvas():
  pid = currentProjectId; if null return
  layout = tidyLayout(assets)
  收集 moved = 位置真正改变的资产 id
  一次 set:assets 全部套用 layout 新坐标
  for id of moved where !id.startsWith('pending_'):
    void persistAssetPosition(id)   // fire-and-forget,复用现有回写
```

- `pending_` 占位卡**参与布局**(保持整齐)但**不回写**(无后端 item)。
- 逐项 PUT 沿用现有 fire-and-forget 模式(`persistAssetPosition` 内已 try/catch、await 后校验 pid)。画布卡数量级为几十,可接受;后端无批量坐标端点,不为此新增。
- 暴露到 store:在 `actions.ts` 返回对象加入 `tidyCanvas`,在 `index.ts` 的 `ServerActions` 类型补声明。

### ③ 平滑动画(`AssetCanvas.tsx` + `globals.css`)

- `Inner` 持有瞬态 `tidying` 态;`onTidy` handler:`setTidying(true) → tidyCanvas() → setTimeout(()=>setTidying(false), 340)`。
- `tidying` 为真时给画布容器加 `canvas-tidying` 类。
- `globals.css` 新增**一条 transition**(非一次性 keyframes,符合动效约定):
  ```css
  .canvas-tidying .react-flow__node { transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1); }
  ```
  并补进 `@media (prefers-reduced-motion: reduce)` 的禁用列表(置 `transition: none`)。
- 节点位置更新触发 React Flow 重渲,transform 变化即被该 transition 平滑过渡;约 340ms 后移除类,使拖拽恢复瞬时(不受过渡影响)。

### ④ 按钮(`ZoomBar`,`AssetCanvas.tsx`)

- 位置:`ZoomBar` **最左一组**,后接分隔条 → `[整理] | [minimap] | [缩放组] | [百分比]`。
- `IconButton variant="ghost"` + `figAsset.tidy` 图标 + `Tooltip`/`aria-label`(`t('canvas.tidy')`);`assets.length === 0` 时 `disabled`。
- `ZoomBar` 新增 props:`onTidy: () => void`、`canTidy: boolean`,由 `Inner` 传入。

### ⑤ 图标 + i18n

- **图标**:新增 `public/figma/icons/tidy.svg`(20×20、`fill="none"`、`stroke-width="1.5"`、currentColor,匹配现有线性图标风格),在 `figma.tsx` 注册 `figAsset.tidy`,tone 默认 primary(随主题翻转)。
- **i18n**:新增键 `canvas.tidy`(Tooltip 与 aria 复用同一键),补全 en(真相源)/ zh / vi / es 四套。zh:「一键整理」,en:「Tidy up」。

## 测试(TDD)

- `src/lib/card-layout.test.ts` 新增 `tidyLayout` 用例:
  - 空数组 → 空 Map。
  - 扁平多卡(无 parentId)→ 单列纵向堆叠、列内无重叠、行距正确。
  - 单棵树(父+多子)→ 父列 < 子列;子节点纵向堆叠;父纵向居中于子。
  - 森林(多根)→ 各树分带、整体无重叠。
  - 孤儿 parentId(指向不存在 id)→ 当作根处理。
  - 坐标取整为整数。
  - 锚点取 min(x,y)(整体平移到既有左上角)。
  - 防环:parentId 自指 / 互指不死循环。
- `src/store/` 轻量 store 测试:`tidyCanvas` 后 `assets` 坐标等于 `tidyLayout` 输出;只对变位且非 `pending_` 卡触发回写(可对 `persistAssetPosition`/`pgcApi` 打桩断言调用集合)。

## 不做(YAGNI)

- 不动相机(锚点已保证留在视野,用户可自行点 Fit view)。
- 不新增批量坐标回写端点(复用逐项 fire-and-forget)。
- 不做「按类型分组 / 紧凑网格」布局(已否决)。
- 不持久化「整理」开关或动画态(纯瞬态)。

## 落地约束清单

- 颜色 / 圆角 / 阴影 / 动效全走既有令牌与动画类,无硬编码、无一次性 keyframes。
- 图标走 `FigIcon` + `figAsset` 注册表;按钮走 `IconButton`;Tooltip + aria-label 齐全。
- `tidyLayout` 为纯函数、不可变返回;`tidyCanvas` 通过唯一 store 入口落库;坐标 int 化尊重后端契约。
- 新增 `.anim`/transition 必须同步进 `prefers-reduced-motion` 禁用列表。
