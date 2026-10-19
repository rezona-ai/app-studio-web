# 回放优化:加载态 + 断点续播(2026-07-14)

## 背景与问题

现有回放(`enterReplay` → `useReplayPlayer`)有两个体验缺口:

1. **无加载态**:`enterReplay` 在 `selectProject` 后即撤全局 LoadingScreen(`booting:false`),
   此后 clone → finalize → 首页事件拉取期间聊天区一片空白,用户不知道发生了什么。
2. **进度不可恢复**:会话快照只在 `completeReplay` 收尾时落 `koubouByProject`;回放中途
   刷新 / 切项目 / 返回主站再回来,回放从头重播(素材导入靠 `importedByProject` 幂等兜底,
   但消息要全部重看一遍)。且回放期项目菜单被禁,用户被锁死在回放里。

## 目标

1. 进入回放后,直到**第一条消息开始重放**前,聊天区显示加载态。
2. **复用重连机制**(检查点快照 + `afterSequence` 增量续传)实现断点续播:
   - 回放中刷新页面 → 从上次进度继续播;
   - 回放中切到别的项目再切回来 → 继续播;
   - 返回主站再从 landing / URL 进入 → 继续播。

## 设计

### 1. 加载态(ChatPanel)

`replay != null && replay.phase !== 'error' && messages.length === 0` 时,消息区渲染
`LoadingScreen`(label = `chat.replay.provisioning`,既有文案「Preparing your replay…」)。
第一帧 `user.message` 派发后 `messages.length > 0`,加载态自然让位。断点恢复时快照消息
即刻载入,不闪加载态。

### 2. 断点续播:复用重连机制

live 连接的恢复机制是「每个非空 `sequence` 事件落 `koubouByProject` 检查点快照 +
重连按 `afterSequence` 增量续传」。回放照搬同一机制:

- **检查点**:`useReplayPlayer.dispatchAt` 每派发一帧(回放事件恒有 sequence),按 live
  `onEvent` 同构落 `koubouByProject[pid] = { sessionId, lastSequence, messages, turns, tasks }`
  (persist 层已有对象级节流,逐帧写安全)。
- **进度标记**:新增持久化字段 `replayProgressByProject: Record<string, { templateId, sessionId }>`
  —— 标记「该项目有未完成的回放」。起播时写入(`phase → playing`),`completeReplay` 删除。
  快照本身进 `koubouByProject`,不重复存消息。
- **续播坐标**:`ReplayState` 新增 `resumeAfterSequence: number`(全新回放为 0)。
  `useReplayPlayer` playing/skipping 两条拉取路径的起始 `after` 都改用它,与 live 重连的
  `afterSequence` 语义一致——快照之前的事件不重拉不重播。

### 3. 三条恢复路径

| 路径 | 入口 | 行为 |
|---|---|---|
| 刷新(URL 带 `?replay_template=`) | `enterReplay` status=`ready` 分支 | 读 `replayProgressByProject[pid]` + `koubouByProject[pid]`:有则灌快照消息 + `resumeAfterSequence = 快照 lastSequence` 续播;无则从 0 全播 |
| 切项目再切回(或 `?project=` 直进) | `selectProject` | 见下「切项目语义」 |
| 返回主站再回来 | 同上两条之一 | localStorage 快照仍在,同路径恢复 |

### 4. 切项目语义(回放期解禁项目菜单)

`selectProject(id)` 在**同一次 set**(维持不变式「messages 恒属于 currentProjectId」)内分流:

- `replay?.projectId === id`:enterReplay 编排在途,不动 replay(原路径);
- `replay != null` 且目标是别的项目:**挂起**——`replay: null`(进度已随检查点持久化),
  连接 hook 恢复正常建连;
- `replay == null` 且 `replayProgressByProject[id]` 存在:**恢复**——同一 set 内灌快照
  (sessionId/lastSequence/messages/turns/tasks)+ 置 `replay = { phase:'playing', …,
  resumeAfterSequence: 快照 lastSequence }`。`useKoubouConnection` 因 `replayActive` 早退出,
  不建连不种子(防剧透 + 防种子冲掉回放消息)。

ChatPanel 项目菜单解禁:回放期允许切走(编排 await 后的 `templateId` 校验守卫本就把
"replay 已被清"当作弃场安全退出)。

### 5. 不变式与边界

- 检查点只在事件派发后写,`lastSequence ↔ messages` 恒一致(与 live 同一保证)。
- 恢复后拉不到新事件(其实已播完,如另一设备播完但本地标记残留):首页空 → 播放器直接
  `completeReplay`,自愈收敛到续接握手,不卡死。
- `completeReplay` / 服务端 status=`completed` 均清理进度标记,防止已完成项目再触发恢复。
- 素材导入 `importedByProject` 持久去重不变:续播不重复导入已导资产。
- 跨设备无 localStorage:退化为从头重播(现状),可接受。

## 埋点

`replay_start` / `replay_complete` 维持不变;恢复续播不重复报 `replay_start`(仅全新
起播上报,恢复路径不报,避免完成率分母虚增)。
