# 模型选择按项目区分

日期:2026-07-23 · 分支:feat/model-per-project

## 目的

当前 `selectedModel` 是全局 UIState 且整份持久化(`taluna-v4.selectedModel`):在项目 A 选了模型 X,切到项目 B(或另开窗口开项目 B)后也变成 X。目标:**模型选择按项目记忆**,多个窗口用不同模型开发不同项目互不干扰。

## 现状

- `selectedModel: string | null` 全局唯一,persist 落盘;`setSelectedModel` 直接写。
- 消费点:建连 URL(`useKoubouConnection` 读快照)、热切换(`ModelSelector` → `client.setModel`)、乐观计时展示(`ChatPanel`)、埋点(`Composer`)。
- `applyStudioPrelude` 在 `createProject` **之前**写模型(建连竞态,见 store 注释)。
- `setAvailableModels` 经 `resolveSelectedModel` 解析默认(沿用有效旧选/否则首项)。

## 方案

**A(选定)— 加 `modelByProject` 持久化映射,`selectedModel` 降级为「当前项目视图 + 新项目全局兜底」**

- 新增 `modelByProject: Record<string, string>`(键 = projectId 字符串,与 `koubouByProject` 等既有 per-project 映射同构),进 persist(版本 2)。
- `setSelectedModel(id)`:写 `selectedModel`,且 `currentProjectId != null` 时同步写 `modelByProject[pid]`。
- `switchProjectSession(nextPid)`(切项目唯一咽喉,建连前同步执行):`selectedModel := modelByProject[pid] ?? 沿用当前值`(即新项目继承上次全局选择);`availableModels` 非空时经 `resolveSelectedModel` 校验回落。
- `applyStudioPrelude`:保持建项目前先写(建连时序不变);`createProject` 成功拿到 pid 后**再写一次**以落进映射。
- `setAvailableModels` 的回落只改视图 `selectedModel`,**不回写映射**(模型列表暂时缺项不冲掉用户的项目级选择)。

其余消费点(建连/热切换/展示/埋点)读 `selectedModel` 不变——它恒等于「当前项目的选择」。

**B(否)— 把 model 并进 `koubouByProject` 快照**:该快照语义是「会话回显缓存」且被 `capPersistedSessions` 裁剪、由 onEvent 检查点整体覆写,塞 UI 偏好进去会被高频覆写路径冲掉,耦合重。

**C(否)— 模型落服务端项目字段**:PGC 无此字段,改后端超出本需求;且模型本就是连接参数,前端记忆足够。

## 多窗口边界

persist 整份覆写 localStorage:窗口 A 落盘会带上自己内存里项目 B 条目的旧值。**运行中的窗口互不影响**(各自内存态独立,rehydrate 只在加载时发生);仅「B 改选后 A 再落盘、B 刷新」的窗口会读到旧值——与既有 `koubouByProject` 等映射同等边界,接受。

## 成功标准

1. 项目 A 选 X、切到 B 选 Y、切回 A → 仍是 X;刷新后各项目保持各自选择。
2. 新项目(无记忆)继承最近一次全局选择;列表缺项回落首项。
3. prelude 带 model 进入 → 该新项目落映射。
4. 既有测试(model-selection / studio-prelude / Composer / ModelSelector)全绿。
