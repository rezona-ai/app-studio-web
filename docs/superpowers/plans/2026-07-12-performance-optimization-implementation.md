# 性能优化实现计划

> 日期:2026-07-12 · 分支:`feat/perf-optimization`(基于 dev @ dbd9c33)
> 依据:`docs/superpowers/specs/2026-07-11-performance-audit-and-optimization-plan.md`(下称「审计」)。
> 本计划按审计 §四的阶段推进,每项独立提交、每阶段跑全量 gate(lint / tsc / test),收尾跑 build + 运行态冒烟。

## 范围决策(对审计中「条件型」条目的取舍)

- **A4(聊天虚拟化)——不做**。理由:持久化已按 `PERSIST_MAX_MESSAGES=100` 截尾、重连只种子化最新一页,单页规模下每 token 的 O(N) 协调可接受;虚拟化对流式尾部锚定/动态高度侵入大、风险中,审计自身标注「仅当长会话常见」,当前无此证据。A1/A2 落地后聊天侧主要成本已消除。
- **D2(翻页前缀缓存)——按预案退回不做,只落地 D3**。实现期核验:`prependHistory` 的整体重建是**刻意的正确性保证**(源码注释明示「整体重建保证跨页边界的 tool_use(旧页)/tool_result(新页)能正确折叠」,还涉及跨页 turns 闭合与任务清单以现值为准的覆盖规则);翻页是用户手势路径(非 per-token),线性单遍重建千级事件量级为毫秒级,felt 影响不足以承担拆缝合边界的正确性风险。D3(foldResults 定向更新)已落地:只重建含目标 tool part 的消息,其余引用透传(附带让下游 memo 生效)。
- **F1(React Compiler)——评估后保留**。实测:lint/tsc/1548 测试/build 全绿,构建总耗时 ~10s 无感;首屏 +67KB raw/+29KB gzip(编译器运行时与生成的缓存代码)。保留理由:桌面端工作台带宽敏感度低,换取未手工优化长尾组件(ChatPanel 每 token 协调、ToolCard/Composer 等)的广谱自动记忆化——审计标注的「重渲染类单点杠杆最大」项,也让 A4(聊天虚拟化)的跳过更稳。独立提交,不认可可单独 revert。
- **E3(Sekuya 字体 fallback)——评估后按标准搁置**:构建警告根因确认为 Sekuya 经 next/font/google 加载而其度量库无此字体,无法自动生成 size-matched fallback;手写 `@font-face` size-adjust 需先有实测 CLS 证据(审计 §四第 3 阶段的既定门槛),当前无证据不做。

## 分项实现要点

### 阶段 0(速赢)

1. **A3** `NodeCard`:`parentId`/`progress` 改由各节点组件从 `data.asset` 传入(props),删除 2 个 `s.assets.find` 订阅;`selectedIds`/`deletingIds` 等窄订阅保留。
2. **C1** 轮询健壮性:
   - `lib/pgc/client.ts` 的 `pgc()` 统一加 `AbortSignal.timeout`;默认超时取保守值,**同步生成类端点**(图像/音频 generate)单独放宽——它们本就要跑几十秒,不能被误杀。
   - `pollGenTasks`/`pollVersions` 加在途布尔守卫(闭包内,复用 `loadingProjects` 范式);
   - `pollGenTasks` 逐任务串行 `await` 改并行(每任务独立 try/catch,互不拖累)。
3. **C2** `useCanvasPolling`:`document.visibilityState === 'hidden'` 时暂停两个 interval,转可见立即补一轮。
4. **B4** 全站裸 `<img>` 补 `loading="lazy" decoding="async"`;`<video>` 核对 `preload`。

### 阶段 1(核心循环重渲染)

5. **A1** `MessageItem` 停止整表订阅 `assets`:`extractRefs` 拆成纯 tokenize(只依赖文本)+ 逐 token 解析;token 渲染下沉到窄订阅子组件(按 token 解析出 key/游离信息,选择器返回基元或稳定引用)。不可变更新保证未变资产引用稳定 → 无关资产变化不再触发消息卡重渲。
6. **A2** `Markdown` 组件 `memo`(已落定消息在任何父级重渲下跳过重解析);`StreamingText` 流式分段:fence 感知地在「块边界」切出稳定前缀(memo 只解析一次)+ 增长尾部(每 tick 只解析当前块)。边界规则:仅在围栏外的空行切,且尾部起始不是列表/表格/引用/缩进续行,避免有序列表重新编号等视觉差异。
7. **B1+B3** 画布节点构建改为**带缓存的纯函数**(下沉 `lib/`,单测):按 id 缓存上次节点,`(asset 引用, selected, 搜索匹配态)` 未变则原引用复用,恢复 xyflow `checkEquality` 的节点级复用;搜索 match/dim 并入缓存键,敲字只重建状态翻转的节点。
8. **D1** 持久化:改用自定义 `PersistStorage`(不经 `createJSONStorage`),`setItem` 收**对象**并在节流窗口内只 `JSON.stringify` 一次;保留 pagehide / visibilitychange=hidden 立即 flush。TDD(假计时器)。
9. **B2** `<ReactFlow>` 开 `onlyRenderVisibleElements`;回归:minimap、fitView、框选、空态、jsdom 测试(必要时在测试环境 mock 尺寸测量)。

### 阶段 2(扩展性与首屏)

10. **B2+** 3D 卡降耗:优先用资产预览图作 `poster` + 按需激活(交互才建 WebGL 上下文);无预览图时保底「离屏/失焦停 auto-rotate」。以实际 Asset 数据形状为准。
11. **E1** 交互弹窗 `next/dynamic(..., { ssr:false })`:CreativeLibraryModal / RenameAssetModal / TextEditorModal / DeleteAssetModal / CreditModal / RezonaPublishModal / CompareView;确认条件渲染位于宿主层(否则先挂载后 return null 拆不出收益);`pnpm build` 前后对比首屏 chunk。
12. **E2** i18n:仅 `en` 静态兜底,其余语言在切换时动态 `import` 词典 + `addResourceBundle` 后 `changeLanguage`;首帧仍 en,与现状一致。
13. **D3(+D2)** `foldResults` 改定向更新单条消息(只重建含目标 tool_use 的 message);`prependHistory` 增加已重建前缀缓存,新页只重建增量并在边界拼接;以 `apply-koubou` 现有测试为安全网,新增跨页折叠边界用例。

### 阶段 3(评估型)

14. **F1** React Compiler:`experimental.reactCompiler` + `babel-plugin-react-compiler`;gate 全绿才保留。**E3** 字体 fallback 顺带评估。

## 验证

- 每项:相关单测(纯逻辑 TDD)+ `pnpm exec tsc --noEmit`;每阶段:`pnpm lint && pnpm test`。
- 收尾:`pnpm build` 成功且记录首屏 chunk 对比;prod 起服 + Playwright(mock PGC 信封)冒烟:画布节点渲染、弹窗打开、聊天流式路径。
- 回合:`--no-ff` 合回 dev,merge message 含分支名,合并后删分支、清 worktree,`git log` 校验落点。
