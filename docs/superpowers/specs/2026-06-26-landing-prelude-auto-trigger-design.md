# Landing 传参后立刻触发对话 —— 设计稿

> 日期:2026-06-26 · 分支:`feat/auto-trigger-prelude`

## 背景与问题

外部 landing page 通过工作台 URL query 传参(`?prompt=...&model=...&assets=...`)进入平台时,当前只把 `prompt` 填进对话框、`assets` 填成附件、切换 `model`,**到此为止不发送**——用户还得在工作台里再手点一次发送键才能开始对话。

期望:带可发送内容的 prelude 进入后**立刻触发对话**,无需用户再点发送。

## 现状链路(改动前)

```
landing ?prompt → useProjectBootstrap(挂载一次) → applyStudioPrelude
  → createProject(强制新建) → setSelectedModel(model)
  → composerSet({ draft: prompt, attachments: assets→ready 附件 })
  → 剥 URL(仅留 ?project=<public_id>)
  → 停在「输入框已填、等用户点发送」
```

- 解析:`src/lib/studio-prelude.ts` 的 `parseStudioPrelude`(纯函数)。
- 落库:`src/store/index.ts` 的 `applyStudioPrelude`(action)。
- 真正发送:`src/components/chat/Composer.tsx` 的 `send()`——依赖 `client`(`KoubouClient` 的 React ref),**不在 store 内**,`applyStudioPrelude` 够不到。
- 连接:`src/client/useKoubouConnection.ts` 在 `currentProjectId` 变化时(异步)创建 `KoubouClient` 并填 `clientRef.current`;`KoubouClient` 已有「socket open 前命令排队、open 后按 FIFO 冲刷」机制(`src/koubou/client.ts`)。

## 触发范围(已确认)

**有可发送内容就触发**:`prompt` 文本 **或** `assets` 附件存在时立刻发送;仅带 `model`(无内容)时只切模型、不发送,行为同现状。

## 设计

核心思路:不另写一套发送逻辑。prelude 填完输入框后 **armed 一个瞬态标志**,由 `Composer` 在 client ref 就绪时复用现有 `send()` 自动发送一次。发送路径保持唯一(手点 / 自动都走 `Composer.send()`)。

### 改动点

**1. store 新增瞬态字段 `autoSendArmed: boolean`**(`src/store/index.ts` + `src/store/types.ts`)

- 默认 `false`。
- **不进 `partialize`**(persist 不落盘)→ 刷新不重放;且 URL 已被剥,prelude 也不会再次解析。
- 配 setter `setAutoSendArmed(v: boolean)`。

**2. `applyStudioPrelude`(`src/store/index.ts`)**

- 现有 `composerSet({ draft, attachments })` 之后,若 `prelude.prompt || prelude.assets.length > 0` → `set({ autoSendArmed: true })`。
- 仅 `model` 的 prelude 不 arm,只 `setSelectedModel`,行为同现状。

**3. `Composer.tsx`(`src/components/chat/Composer.tsx`)**

- 订阅 `autoSendArmed` 与 `connStatus`。
- 新增 effect,依赖 `[autoSendArmed, connStatus]`:当 `autoSendArmed && connStatus === 'open' && client.current && 无 uploading 附件` 时,先 `setAutoSendArmed(false)`(即时清标志即可防 StrictMode 双挂载重发,无需额外 ref),再调用现有 `send()`。
- **必须等 WS 真正连上(`connStatus === 'open'`)再发**:两道前置分别保证「新项目已成功建立」与「WS 已连上」——
  - ① 新项目成功建立:`applyStudioPrelude` 仅在 `createProject` 成功(`pid != null`)后才 arm,故 armed 即意味着项目已建。
  - ② WS 已连上:prelude 必新建项目 → `useKoubouConnection` 因 `currentProjectId` 变化重连 → `connStatus` 走 `connecting → open`,每次变化驱动 Composer 重渲染、effect 重判;显式门控 `connStatus === 'open'` 才发,**不依赖**「open 前排队、open 后冲刷」的乐观发送——避免连接最终失败时留下一条发不出去、却已显示在对话里的消息。

### 数据流(改动后)

```
landing ?prompt → useProjectBootstrap → applyStudioPrelude
  → createProject → setSelectedModel → composerSet({ draft, attachments })
  → (有 prompt 或 assets) autoSendArmed = true → 剥 URL
useKoubouConnection(currentProjectId 变) → createKoubouClient
  → clientRef.current 就绪, connStatus: connecting → open
Composer effect [autoSendArmed, connStatus]:
  armed && connStatus==='open' && client.current && !uploading   ← 等 WS 连上才发
  → setAutoSendArmed(false)(即时清标志防重)→ send()(复用)→ resetComposer(清空输入框)
```

## 边界与不变式

- **防重发(三重)**:① `useProjectBootstrap` 的 `ran` ref(prelude 只解析一次);② effect 内**即时清标志**(`send()` 前先 `setAutoSendArmed(false)`,防 StrictMode 双挂载);③ `autoSendArmed` 不持久化 + URL 剥参(刷新不重放)。
- **仅 model 的 prelude**:不 arm,只切模型,行为不变。
- **发送后**:`send()` 末尾 `resetComposer` 清空输入框,prompt 不残留。
- **`runStatus`**:新项目恒非 `running`,走 `sendUserMessage` 路径(非 `steer`)。
- **附件就绪态**:prelude 附件均为 `status:'ready'` + 公网 url,不卡上传,`send()` 的 uploading 拦截不会误伤。
- **连接慢/失败**:只在 `connStatus === 'open'` 才发——连接期间用户消息气泡**不**提前落地;若 WS 最终连上,armed 仍在则补发;若始终连不上,输入框保留预填草稿供用户手动重发(不会出现一条已显示却发不出去的消息)。
- **门控时序的稳健性**:landing 冷启动无既有连接,`connStatus` 初值 `connecting`,仅当新项目 WS 握手成功才变 `open`,故 `connStatus === 'open'` 必然对应新项目的连接;不会被陈旧连接的 open 状态误触发。

## 测试

- `src/store/studio-prelude.test.ts`:补断言——
  - 带 `prompt`(或 `assets`)的 prelude → `autoSendArmed === true`;
  - 仅 `model` 的 prelude → `autoSendArmed === false`(且仍切模型)。
- `src/components/chat/Composer.test.tsx`:用现成 fake client(`makeSpyClient`)直接验证 effect 行为——
  - armed + `connStatus==='open'` + client 就绪 → 自动发送一次、清 armed、清空输入框;
  - 未 armed → 不发;
  - armed 但 client 未就绪 → 暂不发,client 就绪且 `connStatus` 变化后补发一次;
  - **armed + client 已就绪但 `connStatus` 非 open(connecting)→ 不发,转 open 后才发**(本次新增要求);
  - 自动发送后 `connStatus` 再抖动 → 不重发。
- 端到端「真实 landing → agent 回包」需后端(PGC/Koubou + cookie),以本地实跑确认。

## 非目标

- 不改 URL 参数协议、不改 `parseStudioPrelude` 解析逻辑。
- 不改发送逻辑本身(`send()` 复用,不重写)。
- 不引入新的连接/发送通道。
