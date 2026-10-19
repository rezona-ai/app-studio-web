# 实现计划：会话落库模型回填选择器（含下架自动切换）

设计稿：`docs/superpowers/specs/2026-09-11-session-model-adopt-design.md`
分支：`feat/session-model-adopt`

任务按"最小可独立测试 + 可独立评审"拆分，纯逻辑先行（TDD：先写失败测试）。
T1→T3 是主链，T4 收口副作用，T5/T6 是独立清理与既有缺陷修补，各自可单独评审。

## T1 纯函数 `resolveReadyModel`（`src/lib/koubou/models.ts`）

先在 `src/lib/koubou/models.test.ts` 补失败用例，再实现：

| 输入（readyModel, readyAvailable, storeAvailable） | 期望 |
|---|---|
| `('claude-fable-5', ['Rez1','claude-fable-5'], [])` | `{kind:'adopt', model:'claude-fable-5'}` |
| `('claude-fable-5', undefined, ['Rez1','claude-fable-5'])` | `adopt`（store 兜底） |
| `('claude-fable-5', ['Rez1'], ['Rez1'])` | `{kind:'retired', fallback:'Rez1'}` |
| `('claude-opus-4-8', ['gpt-5.6','claude-opus-5'], ['Rez1'])` | `retired`，`fallback:'gpt-5.6'`（**取判定所用那份列表**的首项，不是 store 的） |
| `('claude-fable-5', undefined, [])` | `none`（判不出，不猜） |
| `(null / undefined / '', 任意, 任意)` | `none` |
| `('Rez1', ['Rez1','claude-fable-5'], [])` | `adopt`（与当前选中相同也返回 adopt，幂等由写入口承担） |

要点：可用列表 `readyAvailable` 优先、`storeAvailable` 兜底——**不依赖 `/models` effect 的时序**；
`fallback` 必须与判定同源，否则 store 列表未就绪时会「判出下架却拿不到目标」。
注释写明与 spec `2026-06-17:114` 不冲突（判定依据 ≠ 列表数据源）。

## T2 toast 文案（`src/i18n/errors.ts` + 11 份 locale）

- `ERROR_KEYS` 加 `MODEL_RETIRED: 'errors.modelRetired'`。
- 11 份 locale 的 `errors` 下加 `modelRetired`，带 `{{from}}` / `{{to}}` 两个插值（模型**展示名**，
  由调用方 `modelLabel()` 算好再传）。中文口径：`'{{from}} 已下架,已自动切换到 {{to}}'`。
- 语言清单与既有 key 对齐：`zh / zh-TW / en / ja / ko / de / fr / es / pt / ru / vi`。

## T3 store action `syncSessionModel`（`src/store/index.ts`）

先在**新建** `src/store/session-model-sync.test.ts` 写失败用例，再实现。

- 签名：`(pid: number, readyModel: string | null | undefined, readyAvailable: string[] | undefined)
  => string | null`。返回值 = "要发 `session.set_model` 的模型 id"，`null` = 不发帧
  （先例：`applyDragSnap` 回报 `handled`）。
- 调用点是 T4 的 hook，在 `ingestKoubou(e)` 之后调用——**不放进 `ingestKoubou`**：那是
  `set((s) => …)`，拿不到返回值，而"该切到哪"必须回报给持有 client 的调用方。分层不变：
  状态只在 store 里写，hook 仍只做 IO。
- `pid` 形参先行做上下文校验（`s.currentProjectId !== pid` → `null`）：不变式归写入口所有。
- `adopt` → `setSelectedModel(model)`（写入口不变式：含门禁收口 + 同步落 `modelByProject`）。
- `retired` → 直接写 `toast`（`code:'MODEL_RETIRED'`、`kind:'warning'`、`params:{from,to}` 为展示名）
  并返回 `action.fallback`。带 params 的 toast 走 `set({ toast })` 而非 `setError`（后者签名不带
  params，先例 `actions.ts` 的 `POSITION_SAVE_FAILED`）。
- **门禁优先**（只作用于 `retired`）：`modelGateLocked` 为真时返回 `null` 不发帧。
  `adopt` 刻意在门禁判定**之前**返回——理由见设计稿「方案 2」。

测试用例：
1. 旧项目 adopt：ready 带 `claude-fable-5` 且在列表 → `selectedModel` 与 `modelByProject['7']` 都变，
   返回 `null`。
2. retired：返回判定列表首项，`toast.code === 'MODEL_RETIRED'`、`kind === 'warning'`、
   `params` 是两个**展示名**；**选择器不被乐观改写**（等 `model.changed`）。
3. store 列表未就绪（`availableModels: []`）但 ready 自带列表 → 仍切得出目标。
4. 门禁锁定 + Rez1 会话模型 → 正常回填；门禁锁定 + 付费会话模型 → 回填被 `gatedModel` 改写成 Rez1；
   门禁锁定 + 已下架 → 不发帧不弹 toast。
5. 过期 ready（`pid` 不符）→ 三条：不回填不落记忆、retired 不弹 toast、门禁锁定态也不落记忆。
6. `readyModel` 为空 / 两个列表都空 → 返回 `null`、state 不变。
7. 幂等：ready 模型 === 当前 `selectedModel` 时**值**保持不变。

## T4 发帧（`src/client/useKoubouConnection.ts`）

在 `onEvent` 的 `if (e.type === 'session.ready')` 块内，传**闭包 `pid`** 与 payload 的
`model` / `available_models` 调 action，返回非空则 `client.setModel(next)`。
`client` 改为先声明 `let koubouClient` 再赋值（回调里引用初始化中的 const 落在 TDZ 内，
真实 WS 不可达但测试注入的 fake 可能构造期同步 emit）。

在 `src/client/useKoubouConnection.test.tsx` 补两例（该文件的范式是 mock `createKoubouClient` 后
从 `mock.calls` 取 `onEvent` 直接喂帧，断言 fake client 的 `setModel`）：
- ready 带已下架模型 → `setModel('<判定列表首项>')` 被调用一次，且 `toast.code` 为 `MODEL_RETIRED`；
- ready 带可用模型 → **不发任何帧**，但选择器与项目记忆已回填。

**实现期发现并修掉的既有缺陷**：该文件的 `beforeEach` 只重置 `createInitialKoubouState()` +
`createInitialServerState()`，而 `availableModels` / `selectedModel` / `modelByProject` /
`modelBackend` 属 **UIState**，不在这两个工厂里——跨用例泄漏。泄漏的 `availableModels` 会让
`switchProjectSession` 把后续用例的 `selectedModel` 回落成首项（本轮实测：「建连带同 backend 的
模型」用例因此从 `gpt-5.5` 变成 `Rez1` 而失败）。已在 `beforeEach` 显式重置这四个字段。

## T5 清掉 attach 的死参数（`src/koubou/protocol.ts`）

`buildWsUrl` 的 `if (opts.model)` 改为 `if (!opts.sessionId && opts.model)`，与 `backend` 同口径；
注释写明 koubou `attach_session_ws` 不读该参数（附源码落点），**已骗过一轮修复**。
`src/koubou/protocol.test.ts`：**推翻**原先「恢复会话也带 model」的断言，改为断言 attach 不含
`model=`；create 照旧含。

## T6 堵掉过期帧的两个源头（既有缺陷，非本需求引入）

pid 守卫只护住模型回填；过期帧照样进 `ingestKoubou` 的 messages，还会被那处用闭包 pid 当 key 的
快照落盘写成「新项目消息存进旧项目槽位」。

1. `src/koubou/client.ts` 的 `close()` 解绑 `onmessage`。**只解绑 `onmessage`**——`onclose` 里的
   `if (closedByUser)` 分支还要上报 `'closed'`，照重连路径四个全解绑会弄丢它。
   `src/koubou/client.test.ts` 补一例：close 后 emit 一帧，`onEvent` 不增长且 `statuses` 末位仍是
   `'closed'`（先红后绿）。
2. `src/client/useKoubouConnection.ts`：`listEvents` 的 `catch {}` 之后补 `if (aborted) return`
   ——成功路径在 catch 前已有该守卫，失败路径缺这一道。

## T7 验证（铁律 3：本轮跑出的完整命令 + 输出 + 退出码）

```bash
pnpm exec vitest run src/lib/koubou/models.test.ts src/store/session-model-sync.test.ts \
  src/client/useKoubouConnection.test.tsx src/koubou/protocol.test.ts src/koubou/client.test.ts
pnpm lint && ./node_modules/.bin/tsc --noEmit && pnpm test && pnpm test:tz && pnpm build
```

注：`pnpm exec tsc --noEmit` 在本机会打出 pnpm 的安装输出而非类型检查结果，直接调
`./node_modules/.bin/tsc` 才拿得到真实退出码。

真机（dev）待 Nick 复核的三条见设计稿末节。

## T8 回合收口

- `scripts/release-board/epics.json`：把 `feat/session-model-adopt` 登记到「模型选择」需求
  （CLAUDE.md 要求自主完成，不等提醒）。
- 提交边界：`docs:`（spec + plan）与 `feat:` 成对；T5 / T6 各自独立成条。
- 合并前派干净上下文子代理按 commit 范围独立评审（只给 spec 与 diff）。
