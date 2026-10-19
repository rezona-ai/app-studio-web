# 性能审计与优化方案

> 日期:2026-07-11 · 范围:`game-create-platform` 前端(Next.js 16 + React 19)
> 方法:5 路并行子系统审计(重渲染 / Koubou 流式 reducer / 画布 xyflow / effect·轮询·网络 / bundle·加载)+ 对每个关键文件的第一手核验;bundle 结论经**真实 `pnpm build` + `next start` 实测 chunk**得出。

## 一、结论摘要(TL;DR)

现状**工程质量很高**——最容易踩的经典大坑作者基本都规避了(见 §二)。真正的隐患集中在三条主线,且都在**核心交互(agent 边生成、画布上有资产)**时才显现:

1. **重渲染扇出**:单一 `s.assets` 数组被广泛订阅,任一资产变化会连锁触发聊天历史全量 Markdown 重解析、画布全部节点重渲、每张卡的 O(N) 扫描。这是**用户能直接感到的卡顿主因**。
2. **画布扩展性硬上限**:无视口虚拟化 + 每个 3D 卡常驻一个 `auto-rotate` 的 WebGL 上下文 → 3D 资产多到 ~16 个即触发浏览器 "Too many active WebGL contexts",且离屏节点持续烧 GPU。
3. **轮询健壮性**:两个 REST 轮询无在途守卫、`fetch` 无超时 → 后端一慢就叠加重复请求;`pollGenTasks` 逐任务串行 await,一个卡住的请求拖垮整轮。

**实测加载数据(单路由 `/`,真实生产构建):**
- 首屏 JS:9 chunk,≈ **1.34MB raw / 406KB gzip**;其中主 chunk **735KB raw / 218.5KB gzip**。
- 首屏 CSS:≈ 90KB raw / 17KB gzip。
- 已正确排除首屏:model-viewer + three.js ≈ 1.04MB raw(动态加载,验证不在首屏 HTML)。
- 首屏可省:6 个"交互才用"的弹窗全静态进包;i18n 六语中 5 种未用语言 ≈ **21KB gzip / 80KB raw**。

## 二、已做对的部分(不要重复劳动)

审计对以下点逐一核验,**均实现正确**,不需改动:

- **xyflow `nodeTypes`/`edgeTypes`/pan 数组**都是模块级常量,无"内联导致全量重挂载"经典坑。
- **`MessageItem`/`ToolCard`/`ToolGroupCard` 已 `memo`**,基于不可变更新的引用比较,流式每 token 只重渲变化的那一条消息。
- **流式 reducer 热路径已优化**:`patchDraft` 尾扫定位草稿(O(1)-ish)+ 仅浅拷贝数组(不可变更新的不可约成本),避免了每 token 全量 `.map`/深拷贝;文本增量走 V8 cons-string。
- **per-token 去重不存在成本**:流式 `StreamEvent` 的 `sequence == null`,顶部 `seenSequences.includes/slice(-500)` 对每个 token **跳过**(仅 checkpoint 事件付费,每轮几十次)。
- **持久化写盘已节流**:`createThrottledStorage` 把 localStorage 写合并到每秒≤1 次 + pagehide/隐藏时 flush(灾难性同步写盘已修)。**但序列化残留未修,见 §D1。**
- **媒体代理流式透传**(`res.body`,含 Range/206),不把大文件缓冲进内存。
- **WS 重连**:指数退避 `min(1000·2^retry, 8000)` + ticket 失败 5 次转 `stalled`,无紧密重连环;句柄/定时器/监听清理干净。
- **effect 依赖稳定**:`useKoubouConnection` 依赖是稳定基元;所有 store action 一次性创建、引用恒定;全站 ~30 处 `addEventListener` 都有对应清理;`await` 后写状态处普遍带 `currentProjectId` 守卫(actions.ts 全 1124 行未见违反)。
- **无冗余网络**:`loadCanvas`/`loadVersions` 仅由 `run.finished(succeeded)` 触发,无 focus/render 重复拉取;mount-once 拉取都带 aborted 守卫。
- **依赖体积**:`three` 是 model-viewer 的必需 peerDep 且只落在懒加载 chunk(**不是冗余,勿删**);`dd-trace` 仅服务端(首屏 chunk 零命中);`lucide-react` 正常 tree-shake;字体走 `next/font` 自托管 `display:swap`;GA4 `afterInteractive`。
- **自定义 server 仍走 Next 的 gzip 压缩**(已在 next 源码验证经同一 `compression()` 中间件)——"自定义 server 会丢自动压缩"的常见假设在此不成立。

## 三、确认的隐患(按主线分组)

标注:**影响**(高/中/低)· **成本**(小/中/大)· **风险**(改动引入回归的风险)。位置均为 `file:line`。

### 主线 A —— 重渲染扇出(agent 生成期卡顿主因)

| # | 位置 | 问题 | 成本场景 | 影响 |
|---|---|---|---|---|
| **A1** | `chat/MessageItem.tsx:18` | 已 `memo` 的消息卡**无条件订阅整个 `s.assets`**,但仅 `role==='user'` 分支用到;`memo` 不拦截内部订阅 | 任一资产变化(auto-import / gen 轮询 / 上传进度 / 落位回写)→ 全部已挂载消息卡重渲 → 各自重跑**未 memo 的 Markdown**(react-markdown + remark-gfm 全量重解析)。100 条历史 ≈ 每次资产变化 100 次全量 markdown 重解析 | **高** |
| **A2** | `chat/StreamingText.tsx:16-23` + `Markdown.tsx`(均未 memo) | 正在流式的消息每 24ms typewriter tick 把**整段已揭示 markdown** 重新喂给 ReactMarkdown 从头解析 | ~40Hz 对增长中的字符串全量重解析,累计 ≈ O(最终长度²);仅限当前流式那一条,但长回复(计划/spec)该条可能很大 | 中 |
| **A3** | `canvas/nodes/NodeCard.tsx:50,57` | 每张卡用 2 个 `s.assets.find(...)`(hasParent/progress)派生;而完整 asset 已由 `data.asset` 传入 | zustand 对**每次 set()**(含每个不碰 assets 的流式 token)重跑所有订阅者 selector → M 张卡 × 2 次全表 find = O(M×N)/token 纯浪费(n=200 ≈ 8 万次迭代/token) | 中 |
| **A4** | `chat/ChatPanel.tsx:31,229-245` | 唯一 `s.messages` 订阅者,每 token 重建 O(N) 元素数组 + 重算 `selectTurnAnchors`/`groupToolRuns`;无虚拟化 | 子项已 memo 能跳过,但仍每 token 分配 N 个元素、协调 N 个子组件;数百条历史时每 token O(N) 协调会 jank | 中 |

> 交叉主题:A1/A3/B1 都源于**单一 `assets` 数组在一个巨型 store 里被广泛订阅**,一处变化四处扇出——这是统一根因。

### 主线 B —— 画布渲染与扩展性

| # | 位置 | 问题 | 成本场景 | 影响 |
|---|---|---|---|---|
| **B1** | `store/selectors.ts:9-15` + `canvas/AssetCanvas.tsx:607-622` | `selectCanvasNodes` 每次同步都给每个节点造**全新节点对象 + 全新 `data:{asset}`**,击穿 xyflow 的 `checkEquality` 节点复用(已读 xyflow 源码 `adoptUserNodes` 确认:仅引用相同才复用) | 选中一张卡 / 一个生成落地 / 搜索每敲一键 → **全部 N 个节点重渲**,而非只有变化的那个 | **高** |
| **B2** | `canvas/AssetCanvas.tsx:646-716`(未设 `onlyRenderVisibleElements`)+ `nodes/ThreeDNode.tsx:53-61` | 无视口虚拟化;每个 ready 的 3D 卡挂 `<model-viewer camera-controls auto-rotate>`,常驻 WebGL 上下文 + 永续渲染循环,离屏也不停 | >~16 个 3D 资产 → 浏览器 "Too many active WebGL contexts" 上下文丢失;离屏模型持续 auto-rotate 烧 GPU/CPU。`loading="lazy"` 只延迟首次拉取,进过视口后上下文永久保留 | **高**(3D 密集画布) |
| **B3** | `canvas/AssetCanvas.tsx:607-622` | 搜索高亮寄生在节点数组重建里(`query` 是 effect 依赖) | ⌘K 搜索每敲一字符重算 `selectCanvasNodes` + 全表 `map(toLowerCase/includes)` + `setRfNodes` 新数组 → 每字符全量重渲(叠加 B1) | 中 |
| **B4** | `canvas/nodes/ImageNode.tsx:43-49`、`chat/AssetChip.tsx:56-57`、`canvas/CreativeLibraryModal.tsx:255` | 全站媒体都是裸 `<img>/<video>`,无 `loading="lazy"`/`decoding="async"`,无缩略图;canvas 图片卡数量随资产数无上限 | 每张图片卡(含远在视口外的)预先下载全分辨率原图 → 带宽 + 解码开销随资产总数增长 | 中 |

> **重要澄清**:B1/B3 的重渲染**不等于媒体重新加载**——`NodeWrapper` 按 id 保持挂载,`<img>/<video>/<model-viewer>` DOM 不重建、媒体不重下;成本是 **React 协调 CPU**(被 A3 放大),不是网络。

### 主线 C —— 轮询 / 网络健壮性

| # | 位置 | 问题 | 成本场景 | 影响 |
|---|---|---|---|---|
| **C1** | `store/actions.ts:770-824`(pollGenTasks)、`:835-838`(pollVersions);`lib/pgc/client.ts:47-55`(`pgc()`) | 两个轮询**无在途守卫**;`pgc()` 对 `fetch` **不传 signal/timeout**;`pollGenTasks` 还**逐任务串行 await** | 后端一慢(单次 >间隔)→ `setInterval` 再触发,叠加 N 个并发同请求;`pollGenTasks` 里一个卡住/挂起的请求会**永久阻塞**同轮其余任务卡的状态更新;无并发生成任务上限 | **高** |
| **C2** | `client/useCanvasPolling.ts:15-29` | 轮询不看 `document.visibilityState` | 后台标签页在(常达数分钟的)视频/3D 生成期间仍每 10s/2.5s 打后端,纯浪费;`useKoubouConnection` 已有 visibilitychange 范式可复用 | 中 |

### 主线 D —— 流式持久化与历史(Koubou)

| # | 位置 | 问题 | 成本场景 | 影响 |
|---|---|---|---|---|
| **D1** | `store/persist-storage.ts` + zustand persist 中间件(经 `store/index.ts:178-183,462-475`) | **per-token 序列化未节流,只节流了写盘**。每次 set()(含每个 `sequence==null` 流式 token)都同步跑 `partialize` + `capPersistedSessions(所有项目)` + `JSON.stringify(整棵树)`;节流层只推迟 `localStorage.setItem` | koubouByProject 仅在 checkpoint 变,故每 token 产出**字节相同**的大串被节流丢弃 → 流式期(40-80×/s)在主线程重复全量序列化 + GC churn,恰在最想流畅的时刻 | 中(重流式/低端机偏高) |
| **D2** | `koubou/apply-koubou.ts:167-179`(prependHistory)+ `134-149` | 每次向上翻页对**整个累积事件日志**重跑 `rebuild` → 翻页深度上 O(E²);`historyEvents` 内存无上限增长 | 翻一个 20 页/1000 事件会话:第 K 页重处理 ~50·K 事件,越翻越慢(用户手势触发,非 per-token) | 中 |
| **D3** | `koubou/apply-koubou.ts:290-307`(foldResults) | 每个 tool_result 重建**整个 messages 数组 + 每条的 parts**,内层 `results.find` → O(N·P·R),虽只一个 tool part 变 | 长会话多工具调用:每个 tool_result 全量重建。带 sequence 故限每轮几十次(非 per-token),但可避免的 GC;在 rebuild 内放大(喂 D2) | 低-中 |

### 主线 E —— bundle / 首屏加载

| # | 位置 | 问题 | 成本场景(实测) | 影响 |
|---|---|---|---|---|
| **E1** | `workspace/Workspace.tsx:16-27,130-136` | 除 model-viewer 外**零代码分割**;6 个"交互才渲染"的弹窗全静态 import(CreativeLibraryModal / RenameAssetModal / TextEditorModal / DeleteAssetModal / CreditModal / RezonaPublishModal·CompareView) | 主 chunk 735KB raw / **218.5KB gzip**;grep 证实 CreativeLibraryModal test-id、react-markdown 内部、xyflow 都在这一个首屏 chunk 里,无论是否打开过弹窗 | **高** |
| **E2** | `i18n/index.ts:3-8,14-22` | 六套词典无视当前语言全量 init | 实测:6 文件同流 gzip 27,360B vs `en` 单独 5,299B → 5 种未用语言 ≈ **21KB gzip / 80KB raw**/会话。已有注释"总量小"是**有意取舍**,非疏漏,但并非免费 | 中 |
| **E3** | `app/fonts.ts:12-19`、`globals.css:92` | 自定义字体 Sekuya 无 next/font size-matched fallback(构建有 warning) | `.font-display` 文本先 Inter 后 swap 到 Sekuya,无度量匹配兜底 → swap 时可能换行位移(CLS)。blast radius 小 | 低-中 |

### 主线 F —— 配置级杠杆(横切)

| # | 位置 | 问题 | 方向 | 影响 |
|---|---|---|---|---|
| **F1** | `next.config.ts`(近乎空) | 未启用 React 19 **React Compiler**(`experimental.reactCompiler`) | 自动 memo 化组件渲染,可**广泛缓解主线 A 的重渲染/重解析成本**(尤其 A1 的 Markdown 重解析、A4)。是针对重渲染类问题**单点杠杆最大**的改动 | 中(评估型) |

> **勿神化 React Compiler**:它记不掉 zustand 的 selector 订阅成本(A3)也解不了 xyflow 的引用相等问题(B1)——这些仍需 §四的定向修复。它主要缓解**组件渲染/Markdown 重解析**一侧。务必 before/after 度量再决定。

## 四、分阶段优化方案

按 (核心循环felt影响 × 成本 × 风险) 排序。每阶段可独立交付、独立度量。

### 第 0 阶段 —— 低风险速赢(建议先落,几乎无争议)

| 项 | 动作 | 成本 | 风险 |
|---|---|---|---|
| A3 | `NodeCard` 改从 `data.asset` 读 `parentId`/`progress`,删掉 2 个 `s.assets.find` 订阅 | 小 | 低 |
| C1 | 两个轮询加**在途布尔守卫**(复用同文件 `loadingProjects` 范式);`pgc()` 加 `AbortSignal.timeout(...)` 让卡死请求快速失败 | 小 | 低 |
| C2 | 轮询加 `document.visibilityState` 门(隐藏暂停,转可见时立即补一次) | 小 | 低 |
| B4 | 裸 `<img>/<video>` 补 `loading="lazy" decoding="async"`(零 bundle 成本,与"不用 next/image"的既有取舍正交) | 小 | 低 |

### 第 1 阶段 —— 核心循环重渲染(中等成本,收益最直接)

| 项 | 动作 | 成本 | 风险 |
|---|---|---|---|
| A1 | 收窄 `MessageItem` 的 assets 依赖:`@` 引用解析改走更窄 selector / 或下沉到已按 key 订阅的 `AssetChip` 类 memo 子组件,让无关资产变化不再重解析每条消息 | 中 | 低-中 |
| B1 | sync effect 里**按 asset id 缓存节点对象**:asset 引用未变则复用上一次的节点(含 `data` 引用)→ 恢复 xyflow `checkEquality` 复用,只有变化节点重渲 | 中 | 中(需回归验证选中/框选/拖拽) |
| B3 | 搜索高亮/减淡移出节点重建:改用 CSS class 或按 match Set 派生的 per-node flag,不重建 nodes 数组 | 中 | 低 |
| D1 | 把**序列化本身**也节流:自定义 storage 在 `delayMs` 内至多 `stringify` 一次;或按 partialize 分片的引用相等做记忆化(`capPersistedSessions` 已对未变会话零拷贝透传,引用相等 memo 即可跳过每 token 的 stringify) | 中 | 低-中 |
| B2 | 开 `onlyRenderVisibleElements`(视口外节点不挂载,直接缓解 WebGL 上限) | 小 | 中(须验证 minimap / fitView / 空态 overlay / 拖拽仍正常) |

### 第 2 阶段 —— 扩展性与首屏加载(较大或需先度量)

| 项 | 动作 | 成本 | 风险 |
|---|---|---|---|
| B2+ | 3D 卡默认渲染静态海报(poster),仅 hover/打开时激活 model-viewer;离屏禁用 auto-rotate | 中 | 中 |
| E1 | `next/dynamic(..., { ssr:false })` 拆 6 个交互弹窗 + compare/publish 流;ChatPanel/AssetCanvas/PreviewPanel 保持 eager(首屏必现) | 中(机械) | 低 |
| A2 | Markdown 流式分段:已定块只解析一次(memo),仅增长的 tail 用轻量文本/内联渲染直到"毕业";或把解析降频到低于揭示节奏 | 中 | 中 |
| A4 | 长会话聊天**虚拟化/窗口化**(仅 tail 流式)——仅当长会话常见 | 大 | 中 |
| D2/D3 | 只重建新页并在边界拼接(本地折叠跨页 tool_use/tool_result)/ 缓存已重建前缀;foldResults 改定向更新单条 message——仅当深度翻页常见 | 大 | 中(正确性敏感) |
| E2 | i18n 按 host config 解析出的语言**动态 import** 对应词典(−21KB gzip);取舍型,可选 | 小-中 | 低 |

### 第 3 阶段 —— 评估型

| 项 | 动作 | 说明 |
|---|---|---|
| F1 | 试启用 React Compiler,before/after 度量 | A1/A4 的力量倍增器;需 `babel-plugin-react-compiler`,注意与自定义 server/Turbopack 的兼容与构建影响 |
| E3 | 若实测 `.font-display` 有 CLS,给 fallback `@font-face` 手调 `size-adjust` | 仅当度量证明有问题才做 |

## 五、度量与验证建议

改动前后都应量化,避免凭感觉:

- **重渲染主线(A/B1/B3)**:React DevTools Profiler 录制"agent 边生成 + 画布有 N 个资产"一段,看每 token/每次资产变化的 commit 数与耗时;用 `why-did-you-render` 或临时 `console.count` 定位 `MessageItem`/节点卡重渲次数。目标:资产变化不再重渲无关消息;选中/搜索只重渲相关节点。
- **流式主线(A3/D1)**:Performance 面板录一段长流式,看主线程 Scripting/GC 占比;A3 可临时在 `NodeCard` selector 里计数确认调用频率骤降;D1 看 `JSON.stringify` 采样是否从热点消失。
- **画布 3D(B2)**:开多个 3D 资产,DevTools 看 WebGL 上下文数 / "context lost" 告警;离屏时看 GPU 占用。
- **轮询(C1/C2)**:Network 面板故意 throttle 后端,确认不再叠加并发同请求;切后台确认轮询暂停。
- **bundle(E1/E2)**:`pnpm build` 对比首屏 chunk gzip 尺寸;可临时接 `@next/bundle-analyzer` 做逐包归因(本次未跑,是精确归因的下一步)。

## 六、备注

- 本文档为分析 + 优化方案,**未改动任何代码、未提交**。落地时按 CLAUDE.md 约定:先在 worktree(`feat/perf-*`)基于当前分支开发,纯逻辑 TDD,中文 commit,回合主分支用 `--no-ff`。
- 未深度剖析的维度:CSS 绘制成本(`backdrop-blur`、`.node-beam` 扫光、大量 box-shadow)——若观察到绘制 jank 再单独用 Performance 面板 paint profile 定位,目前无证据不列为隐患。
