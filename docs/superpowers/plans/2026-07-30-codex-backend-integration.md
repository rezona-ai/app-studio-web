# Codex backend 接入实现计划

设计稿：`docs/superpowers/specs/2026-07-30-codex-backend-integration.md`

原则：每个任务独立可测 / 可评审，完成即提交一次；纯逻辑先写失败测试再实现；每步保持系统可运行（cc 链路零倒退）。

---

## T1 backend 开关与解析

**改动**
- 新增 `src/lib/agent-backend.ts`：`AgentBackend`、`AGENT_BACKEND_KEY`、`normalizeBackend`、`resolveAgentBackend(search, read)`。
- 新增 `src/lib/agent-backend.test.ts`：`?agent=codex` 命中 / `?agent=cc` 命中 / 非法值忽略 / 无参数读存储 / 存储非法回落 `cc`。
- `src/store/index.ts`：`UIState.agentBackend`（初值 `'cc'`，**不进 persist 切片**）+ action `setAgentBackend`。
- 新增 `src/client/useAgentBackend.ts`：挂载时按 `window.location.search` + localStorage 解析并写 store、写回存储；在 `Workspace` 顶层（与其他 bootstrap hook 同处）调用。

**验证**：`pnpm exec vitest run src/lib/agent-backend.test.ts src/store` · `pnpm exec tsc --noEmit`

---

## T2 会话按 backend 分槽 + backend-aware 会话恢复

**改动**
- 新增 `src/store/session-slot.ts` + 测试：`sessionSlotKey(pid, backend)`（`cc` → `String(pid)`，其余 → `${pid}:${backend}`，保证老快照零迁移）。
- `src/store/types.ts`：`KoubouState` 增 `backend: AgentBackend`、`permissionMode: string | null`；`createInitialKoubouState` 补默认。
- `src/store/index.ts`：`switchProjectSession` 按槽位读快照 + 写入当前 `backend`；`modelByProject` 也改按槽位 key。
- `src/client/useKoubouConnection.ts`：检查点持久化写槽位 key。
- `src/lib/koubou/client.ts`：`SessionSummary` 增 `backend`。
- `src/lib/koubou/recoverSession.ts`：`resolveSession` 增 backend 过滤（只在匹配会话里挑最近一条）。
- `src/koubou/apply-koubou.ts`：`onReady` 用 `payload.backend` 校正 `state.backend`、存 `permission_mode`。

**验证**：`pnpm exec vitest run src/store src/lib/koubou src/koubou` · `pnpm exec tsc --noEmit`

---

## T3 建连携带 backend

**改动**
- `src/koubou/protocol.ts`：`buildWsUrl` 增 `backend?: AgentBackend`，**仅无 sessionId（新建）时**拼 `backend=`。
- `src/koubou/protocol.test.ts`：新建带 backend / attach 不带 backend / `cc` 也显式带（服务端缺省同值，显式更可诊断）。
- `src/koubou/client.ts` + `src/client/useKoubouConnection.ts`：透传 `backend`（读 `useStore.getState().agentBackend`）。

**验证**：`pnpm exec vitest run src/koubou` · `pnpm exec tsc --noEmit`

---

## T4 模型与 skills 按 backend

**T4a 接口与 store**
- `src/lib/koubou/client.ts`：`listModels(backend)` / `listSkills(backend)`（返回 `{ name, invocation }[]`）。
- `src/store/index.ts`：`skills: SkillDef[]`；`setSkills` 签名随之更新。
- `src/client/useModelList.ts` / `useSkillList.ts`：依赖 `agentBackend` 重新拉取，切换时整体替换并 `resolveSelectedModel` 回落。
- `src/components/chat/ModelSelector.tsx`：codex + `runStatus==='running'` 时禁用；消费 `model.changed` 校正（reducer 侧）。

**T4b skill token 泛化**
- `src/lib/skills.ts`：激活前缀集合与 token 匹配改由 `invocation` 驱动（`/name` 与 `$name` 同构处理）；更新 `src/lib/skills.test.ts`。
- `src/components/chat/SkillPopover.tsx` / `Composer.tsx` / `RichText.tsx`：插入与高亮改用 `invocation`。

**验证**：`pnpm exec vitest run src/lib/skills.test.ts src/components/chat src/client src/store` · `pnpm exec tsc --noEmit`

---

## T5 codex.message reducer

**T5a `parseUnifiedDiff`**
- `src/koubou/protocol.ts` + 测试：unified diff 文本 → 既有 `FileDiff`（`@@` 头解析、`+/-/空格` 计数、`\ No newline` 跳过、无法解析返回 `null`）。

**T5b `item/completed` 映射**
- `src/koubou/protocol.ts`：`CodexMessagePayload` / `CodexItem` / `CodexTask` 类型。
- 新增 `src/koubou/apply-codex.ts` + `apply-codex.test.ts`：五类 item → `Message`/`Part`；`item.id` 作消息身份；未知 type 忽略；缺字段降级；`lastMessageId` patch。
- `src/koubou/apply-koubou.ts`：`case 'codex.message'` 分流，`claude.message` 仅 `backend==='cc'` 处理（反之亦然）。

**T5c live 增量与计划卡**
- `apply-codex.ts`：`item/started` 建草稿、`item/agentMessage/delta`、`item/reasoning/*Delta` 按 `itemId` 追加、`turn/plan/updated` → `tasks`（优先 `task_list`，降级 `payload.plan[]`，`inProgress`→`in_progress`）、`turn/started|completed` 无副作用。
- 测试覆盖「delta → completed 同 id 合并为一条」与「未知 method 无副作用」。

**验证**：`pnpm exec vitest run src/koubou` · `pnpm exec tsc --noEmit`

---

## T6 历史重建支持 codex

**改动**
- `src/koubou/apply-koubou.ts` 的 `rebuild()`：按事件所属 backend 重放 `codex.message`（复用 T5 同一映射函数，保证冷启动 / 翻页 / gap 补偿与 live 结果一致）。
- 测试：codex 事件日志冷启动重建；跨页 `item/completed` 幂等；混合 `user.message` + `run.*` 的轮次脚注正确。

**验证**：`pnpm exec vitest run src/koubou src/store/history-pagination.test.ts src/store/backfill.test.ts`

---

## T7 审批扩展

**改动**
- `src/store/types.ts`：`ApprovalInteraction` 增 `method?: string`。
- `src/koubou/apply-koubou.ts`：`tool.approval.requested` 带出 `method`；`onReady` 的 `pending_interactions` 同步；新增 `tool.approval.resolved` / `pending_interactions.cancelled` 按 `interaction_id` 幂等清 pending。
- `src/components/chat/ToolApprovalCard.tsx`：按 method 出标题；form 类（`mcpServer/elicitation/request` 且 `input.mode !== 'url'`）只渲染拒绝 + 不支持提示。
- `src/i18n/locales/*.ts`：新增 5 条文案 × 11 语（`en` 先行）。

**验证**：`pnpm exec vitest run src/components/chat/ToolApprovalCard.test.tsx src/koubou` · `pnpm exec vitest run src/i18n`（若有一致性测试）· `pnpm exec tsc --noEmit`

---

## T8 checkpoint.created 驱动版本刷新

**改动**
- `src/client/useKoubouConnection.ts`：`checkpoint.created` → `loadVersions()` + `loadCanvas()`（幂等，与 `run.finished` 现有刷新并存）。
- 测试：`useKoubouConnection.test.tsx` 补一例。

**验证**：`pnpm exec vitest run src/client/useKoubouConnection.test.tsx`

---

## T9 资产落画布对等打通

**改动**
- `src/koubou/protocol.ts`：抽 `parseMediaPayload` / `parseSubmittedTaskPayload`（JSON 层），`parseMediaItems` / `parseSubmittedTask` 改为其文本包装（行为不变，回归测试保护）。
- 新增 codex 提取：`mcpToolCall` 的 `item.result.structuredContent` 优先、`content[].text` 兼容。
- `src/store/actions.ts`：`importFromLiveEvent` / `importMediaFromEvent` 增 `codex.message` 分支，复用占位卡 / `GenTask` 登记 / 去重表。

**验证**：`pnpm exec vitest run src/koubou src/store/actions.assetgen.test.ts src/store/actions.test.ts`

---

## T10 真实运行态验证与映射校准

- 本地 `pnpm dev`（`.env` 已配 `DEV_COOKIE` + `tlndev`），浏览器带 `?agent=codex` 打开工作台。
- 抓真实帧（Playwright + `browser_network_requests` / WS 帧日志或临时 `onEvent` 打点）核对：`commandExecution` / `fileChange` / `mcpToolCall` 的真实字段名与文档表格是否一致；据实修正映射并补 fixture 测试（用真实帧做 fixture）。
- 逐项过设计稿「成功标准 1–8」，含 `?agent=cc` 回归。
- 抓帧结论回写设计稿「风险」一节。

**验证**：截图 / 帧日志 + 完整命令输出留痕。

---

## T11 收尾

- `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm test` · `pnpm build` 全绿（贴完整输出与退出码）。
- 提醒 Nick 是否 `--no-ff` 回合 dev 并清理 worktree。

---

## 实施记录（2026-07-30 完成）

按 T1→T11 顺序落地，每任务一次提交。与计划的差异：

- **T4b** 的 `getActiveSlash` 改名为 `getActiveSkillToken(text, caret, prefixes)`，前缀集合由 `skillPrefixes(skills)` 从 `invocation` 首字符派生；`RichText.tsx` 无需改动（skill 高亮走 Composer 的镜像层）。
- **T10 追加一项计划外修复**（真实抓帧发现）：新建会话若带非本 backend 的模型，后端回 `invalid model` 并以 **4400** 关闭 → `classifyClose` 判 fatal **不重连**，且刷新复发。故新增 `UIState.modelBackend`（与 `selectedModel` 成对持久化）：建连只带确属当前 backend 的模型，跨 backend 不继承模型选择。详见设计稿「真实抓帧核对」。
- **T10 另一项固化**：后端会把用户输入也作为 `item/completed`（`item.type='userMessage'`）下发，必须忽略，否则重复用户气泡；已由「未知 item.type 静默忽略」覆盖并补真实帧回归测试。
- **未做运行态验证的两项**：`checkpoint.created` 驱动版本刷新、agent 生成资产落画布 —— 二者都需要一次会修改工程 / 产出资产的真实 codex 回合（会在 dev 项目里新增版本与资产），本轮刻意不做以免改动 Nick 的真实项目；行为由单测覆盖（`useKoubouConnection.test.tsx`、`media-import.test.ts`），链路与 cc 侧共用同一段刷新/导入代码。

### 本轮验证输出

- `pnpm exec tsc --noEmit` 退出码 0
- `pnpm lint` 0 errors（8 warnings 全部为改动前既有：loadtest 两处、Workspace 冗余 disable、actions 未用变量）
- `pnpm exec vitest run` **204 → 206 文件、2118 tests 全绿**
- `pnpm build` 退出码 0
- dev 后端真实 codex 会话（项目 629 / gpt-5.6）：建连 `backend=codex` → `session.ready.backend='codex'`、`permission_mode='default'`；模型选择器只列 codex 模型；skill picker 插入 `$game-plan `；一次真实回合渲染出「用户气泡 → 流式正文 → Bash 命令卡 → 结论正文 → GPT-5.6 · Ran for 2m 19s」；刷新后经 REST events 恢复同样 4 条消息；`?agent=cc` 切回连到原 cc 会话（50 条历史、`/` 前缀 skills、cc 模型列表），两个槽位 `629` 与 `629:codex` 并存。
