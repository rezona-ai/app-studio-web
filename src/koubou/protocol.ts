// Koubou WebSocket 协议类型 + 纯 helper(前后端共享语义,以 Claude Agent SDK 消息为主)

// ---- 关闭码 ----
export type CloseAction = 'reauth' | 'recreate' | 'superseded' | 'fatal' | 'retry';
export function classifyClose(code: number): CloseAction {
  switch (code) {
    case 4401: return 'reauth';      // 重新签 ticket
    case 4404: return 'recreate';    // 会话不存在 → 改新建
    case 4000: return 'superseded';  // 被新连接顶替 → 不重连
    case 4400:
    case 4403: return 'fatal';       // 协议/权限错误 → 不重连
    default: return 'retry';         // 网络断开 → 退避重连
  }
}

// ---- Claude content block(raw Anthropic 形状) ----
export interface TextBlock { type: 'text'; text: string }
export interface ThinkingBlock { type: 'thinking'; thinking: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

// ---- 文件修改 diff(UserMessage.payload.tool_use_result) ----
export interface StructuredPatchHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
export interface ToolUseResultRaw {
  type?: 'create' | 'update';
  filePath?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  structuredPatch?: StructuredPatchHunk[];
  userModified?: boolean;
  [k: string]: unknown;
}

// 归一后的 diff(UI 直接消费)
export type DiffLineKind = 'context' | 'add' | 'del';
export interface DiffLine { kind: DiffLineKind; text: string }
export interface DiffHunk { lines: DiffLine[] }
export interface FileDiff {
  type: 'create' | 'update';
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  userModified?: boolean;
}

// ---- 原始 stream event(Anthropic streaming 子集) ----
export type RawStreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: string; id?: string; name?: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; thinking?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: string; [k: string]: unknown };

// ---- sdk 消息类型 ----
export function isFullMessage(sdkType: string): boolean {
  return sdkType === 'AssistantMessage' || sdkType === 'UserMessage'
    || sdkType === 'SystemMessage' || sdkType === 'ResultMessage';
}

export interface ClaudeMessagePayload {
  sdk_type: string;
  payload: {
    content?: ContentBlock[] | string;
    model?: string;
    uuid?: string;        // 每条事件唯一(同一 API 消息拆 block 下发时仍各异),与历史 visible_state 的 uuid 一致
    message_id?: string;  // API 消息 id,同一消息拆出的多条事件共享
    id?: string;
    event?: RawStreamEvent;
    tool_use_result?: ToolUseResultRaw;   // 文件修改 diff(snake_case key,内部字段 camelCase)
    [k: string]: unknown;
  };
}

// ---- Codex app-server 通知(codex.message)----
// 外层信封稳定,内层 payload 跟随 app-server 演进 → 保留为结构化未知值,按 method 渐进解析。
// task_list 是 Koubou 在 turn/plan/updated 上附加的归一清单(与 Claude 任务清单同构)。
export interface CodexTask { id: string; subject: string; status: string; blockedBy?: string[] }
export interface CodexMessagePayload {
  method: string;
  payload: Record<string, unknown>;
  task_list?: { tasks: CodexTask[] };
}

// ---- 服务端 envelope ----
export interface ServerEvent {
  type: string;
  project_id: string;
  session_id: string;
  payload: Record<string, unknown>;
  event_id?: string;
  run_id?: string | null;
  sequence?: number | null;
  created_at?: string;
}

// ---- 客户端 envelope ----
export interface ClientEvent { type: string; payload?: unknown; event_id?: string }
export type UserMessageContent = { role: 'user'; content: string | ContentBlock[] };

// ---- AskUserQuestion 题目 ----
export interface QuestionOption { label: string; description?: string }
export interface QuestionDef { question: string; header?: string; options: QuestionOption[]; multiSelect?: boolean }

// ---- media 生成(进程内 MCP 工具结果:嵌在 claude.message 的 text block,文本是 JSON)----
// 两阶段:submit_*_generation → media.task_submitted(仅提交回执,无资产);
//        check_generation_tasks → media.tasks.status(items 携带 status/asset_path/preview_url)。
// 前端只关心「已就绪资产」:就绪预览 + 自动导入画布。生成中/失败等中间态不在聊天呈现——
// agent 不保证把就绪状态发回聊天,资产最终经 run.finished 后 loadCanvas 从 PGC 拉取。
export interface MediaItem {
  kind: string;              // image / video / audio / model3d / text / doc
  path: string;              // asset_path:相对 workspace 的 pgc 资产路径
  previewUrl: string | null; // 可浏览预览直链(preview_base 已配置时)
  taskId?: string;           // pgc 任务 id:血缘归因的配对键(回溯提交它的那次工具调用,见 lib/gen-lineage.ts)
}

// 解析 media 工具结果文本(Claude backend:结果是 text block 里的 JSON 串)。
// 返回 null = 非 media 结果(交通用文本渲染);返回数组(可空) = media 结果,仅含已就绪
// (status==='ready')资产;task_submitted / 未就绪项不产出条目。
export function parseMediaItems(text: string): MediaItem[] | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  return parseMediaPayload(j);
}

// 同上,但直接吃已解析的 JSON 值:Codex backend 的 media 结果是 mcpToolCall item 的
// `result.structuredContent`(结构化对象,无需再 JSON.parse),两个 backend 共用这一层判定
export function parseMediaPayload(j: unknown): MediaItem[] | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.type === 'media.task_submitted') return [];
  if (o.type === 'media.tasks.status') {
    const items = Array.isArray(o.items) ? o.items : [];
    return items
      .filter((it): it is Record<string, unknown> =>
        !!it && typeof it === 'object' && it.status === 'ready' && typeof it.asset_path === 'string')
      .map((it) => ({
        kind: typeof it.kind === 'string' ? it.kind : 'image',
        path: it.asset_path as string,
        previewUrl: typeof it.preview_url === 'string' ? it.preview_url : null,
        ...(typeof it.task_id === 'string' && it.task_id ? { taskId: it.task_id } : {}),
      }));
  }
  return null;
}

// ---- 提交回执(submit_*_generation 的 media.task_submitted)----
// 仅放行有 PGC 轮询端点的 video/3d(image/audio 同步、无 poll 端点,由 onEvent→importFromLiveEvent 直接导入)。
// kind 归一到 'video' | 'model3d' 以对齐 GenTask.kind。
export interface SubmittedTask { taskId: string; kind: 'video' | 'model3d' }

export function parseSubmittedTask(text: string): SubmittedTask | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  return parseSubmittedTaskPayload(j);
}

// 同 parseMediaPayload:吃已解析的 JSON 值(Codex 的 structuredContent 路径)
export function parseSubmittedTaskPayload(j: unknown): SubmittedTask | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.type !== 'media.task_submitted') return null;
  if (typeof o.task_id !== 'string' || !o.task_id) return null;
  const kind = o.kind === 'video' ? 'video' as const
    : (o.kind === '3d' || o.kind === 'model3d') ? 'model3d' as const
    : null;
  if (!kind) return null;
  return { taskId: o.task_id, kind };
}

// 提交回执里的 task_id,**不限 kind**(image/audio 也取)。
// 与 parseSubmittedTaskPayload 的区别:那个只放行 video/3d,是 GenTask 登记的门槛(它们才有 poll 端点);
// 这里只作「按 task_id 把产物回溯到提交它的那次工具调用」的配对键(血缘归因,见 lib/gen-lineage.ts)。
export function parseSubmittedTaskId(text: string): string | null {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  if (o.type !== 'media.task_submitted') return null;
  return typeof o.task_id === 'string' && o.task_id ? o.task_id : null;
}

// ---- 任务清单(TaskCreate/TaskUpdate/TaskList/TaskGet)----
// agent 用这组工具跟踪多步骤工作;没有整单快照型独立事件,前端按 run/session 累积
// tool_use_result 维护清单状态(见 koubou 文档「任务清单」节)。
export type PlanTaskStatus = 'pending' | 'in_progress' | 'completed';
export interface PlanTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;   // 进行中态的现在进行时文案,in_progress 时优先展示
  status: PlanTaskStatus;
}

const TASK_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'];
export function isTaskTool(name: string): boolean {
  return TASK_TOOLS.includes(name);
}

// 归一后的清单变更(reducer 消费)。ID/状态机只信 tool_use_result:
// TaskUpdate 的 statusChange.to 比入参可靠(入参缺省字段时结果仍给完整变化);
// 但 result 不含文案新值(TaskCreate 只有 id/subject、TaskUpdate 只有字段名),
// 文案由 parseTaskInput 从落定 input 补齐。
export type TaskEffect =
  | { kind: 'create'; id: string; subject: string }
  | { kind: 'update'; taskId: string; to: string | null; updatedFields: string[] }
  | { kind: 'snapshot'; tasks: { id: string; subject: string; status: string }[] }
  | { kind: 'get'; task: { id: string; subject?: string; description?: string; status?: string } };

export function parseTaskResult(toolName: string, raw: unknown): TaskEffect | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (toolName === 'TaskCreate' || toolName === 'TaskGet') {
    const t = o.task;
    if (!t || typeof t !== 'object') return null;
    const task = t as Record<string, unknown>;
    if (typeof task.id !== 'string' || !task.id) return null;
    if (toolName === 'TaskCreate') {
      return { kind: 'create', id: task.id, subject: typeof task.subject === 'string' ? task.subject : '' };
    }
    return {
      kind: 'get',
      task: {
        id: task.id,
        ...(typeof task.subject === 'string' ? { subject: task.subject } : {}),
        ...(typeof task.description === 'string' ? { description: task.description } : {}),
        ...(typeof task.status === 'string' ? { status: task.status } : {}),
      },
    };
  }
  if (toolName === 'TaskUpdate') {
    if (typeof o.taskId !== 'string' || !o.taskId) return null;
    const sc = o.statusChange;
    const to = sc && typeof sc === 'object' && typeof (sc as Record<string, unknown>).to === 'string'
      ? (sc as Record<string, unknown>).to as string : null;
    const updatedFields = Array.isArray(o.updatedFields)
      ? o.updatedFields.filter((f): f is string => typeof f === 'string') : [];
    return { kind: 'update', taskId: o.taskId, to, updatedFields };
  }
  if (toolName === 'TaskList') {
    if (!Array.isArray(o.tasks)) return null;
    const tasks = o.tasks
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object' && typeof (t as Record<string, unknown>).id === 'string')
      .map((t) => ({
        id: t.id as string,
        subject: typeof t.subject === 'string' ? t.subject : '',
        status: typeof t.status === 'string' ? t.status : 'pending',
      }));
    return { kind: 'snapshot', tasks };
  }
  return null;
}

// 从落定的 tool_use.input 提取文案字段。CLI 会修复模型写错的字段名,但流式下发的
// input 保留修复前原始键 → 做别名兜底(active_form→activeForm、id/task_id→taskId)。
export interface TaskInputMeta { taskId?: string; subject?: string; description?: string; activeForm?: string }

export function parseTaskInput(input: unknown): TaskInputMeta | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) { const v = o[k]; if (typeof v === 'string' && v) return v; }
    return undefined;
  };
  const meta: TaskInputMeta = {};
  const taskId = pick('taskId', 'task_id', 'id');
  const subject = pick('subject');
  const description = pick('description');
  const activeForm = pick('activeForm', 'active_form');
  if (taskId) meta.taskId = taskId;
  if (subject) meta.subject = subject;
  if (description) meta.description = description;
  if (activeForm) meta.activeForm = activeForm;
  return Object.keys(meta).length ? meta : null;
}

// ---- 后台任务生命周期(TaskStarted/TaskUpdated/TaskNotification/TaskProgress)----
// 与上面的「任务清单」是两回事:清单是 agent 自己的待办工具,这里是后台任务(子 agent /
// 后台 shell)的生命周期端点。归属唯一判据是服务端盖章的 parent_tool_use_id
// (见 koubou docs/websocket-events.md「子 agent 归属与渲染」)。
export type SubagentKind = 'agent' | 'bash' | 'unknown';   // task_type: local_agent / local_bash / 其它
export type WireTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped';
// 末项是**仅客户端**的合成态:run 结束而任务从未发终态时由前端收尾,不得伪造成 wire 终态
export type SubagentStatus = WireTaskStatus | 'ended_without_terminal';
export type SealReason = 'interrupted' | 'failed' | 'unknown';   // 合成态措辞跟 run.finished.status 走

// 归一后的生命周期事件(状态机消费)
export type TaskLifecycle =
  | { kind: 'started'; taskId: string; toolUseId: string | null; parentToolUseId: string | null;
      taskType: SubagentKind; description: string; subagentType?: string }
  | { kind: 'updated'; taskId: string; parentToolUseId: string | null;
      status: WireTaskStatus | null; result?: string; error?: string; endTime?: string }
  | { kind: 'notification'; taskId: string; parentToolUseId: string | null;
      status: WireTaskStatus | null; summary?: string; outputFile?: string }
  | { kind: 'progress'; taskId: string; parentToolUseId: string | null; lastToolName?: string };

const TASK_LIFECYCLE_TYPES = ['TaskStartedMessage', 'TaskUpdatedMessage', 'TaskNotificationMessage', 'TaskProgressMessage'];
export function isTaskLifecycleType(sdkType: string): boolean {
  return TASK_LIFECYCLE_TYPES.includes(sdkType);
}

// 两套词表描述同一件事:task_updated 的 killed 与 notification 的 stopped 是同一状态,
// 这里统一归到 stopped。未知取值返回 null —— 绝不能当终态,否则卡片会被提前收掉
const WIRE_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed', 'stopped'];
export function normalizeWireStatus(raw: unknown): WireTaskStatus | null {
  if (typeof raw !== 'string' || !raw) return null;
  if (raw === 'killed') return 'stopped';
  return WIRE_STATUSES.includes(raw) ? raw as WireTaskStatus : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

export function parseTaskLifecycle(sdkType: string, payload: unknown): TaskLifecycle | null {
  if (!isTaskLifecycleType(sdkType)) return null;
  if (!payload || typeof payload !== 'object') return null;
  const o = payload as Record<string, unknown>;
  const taskId = str(o.task_id);
  if (!taskId) return null;
  // 盖章可能缺失(服务端 _attribute_background_task_message 拿不到 tool_use_id 时照常下发),
  // 缺失即「无归属」,由状态机按待定区处理,解析层不臆造
  const parentToolUseId = str(o.parent_tool_use_id);
  if (sdkType === 'TaskStartedMessage') {
    const rawType = o.task_type;
    const taskType: SubagentKind = rawType === 'local_agent' ? 'agent' : rawType === 'local_bash' ? 'bash' : 'unknown';
    const data = o.data && typeof o.data === 'object' ? o.data as Record<string, unknown> : {};
    const subagentType = str(data.subagent_type);
    return {
      kind: 'started', taskId, toolUseId: str(o.tool_use_id), parentToolUseId, taskType,
      description: str(o.description) ?? '',
      ...(subagentType ? { subagentType } : {}),
    };
  }
  if (sdkType === 'TaskUpdatedMessage') {
    const patch = o.patch && typeof o.patch === 'object' ? o.patch as Record<string, unknown> : {};
    // patch 不一定带 status(只有 end_time/result/error 的补丁合法且**不是终态**);
    // 顶层 status 与 patch.status 同源,patch 缺时回退
    const status = normalizeWireStatus(patch.status ?? o.status);
    const result = str(patch.result);
    const error = str(patch.error);
    const endTime = str(patch.end_time);
    return {
      kind: 'updated', taskId, parentToolUseId, status,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
      ...(endTime ? { endTime } : {}),
    };
  }
  if (sdkType === 'TaskNotificationMessage') {
    const summary = str(o.summary);
    const outputFile = str(o.output_file);   // 后台命令的 output_file 是空串 → 视为无
    return {
      kind: 'notification', taskId, parentToolUseId, status: normalizeWireStatus(o.status),
      ...(summary ? { summary } : {}),
      ...(outputFile ? { outputFile } : {}),
    };
  }
  const lastToolName = str(o.last_tool_name);
  return { kind: 'progress', taskId, parentToolUseId, ...(lastToolName ? { lastToolName } : {}) };
}

// tool_result.content 可能是字符串或 block 数组,拍平成文本
export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).join('');
  }
  return '';
}

// 把原始 tool_use_result 归一成 FileDiff;无法构成 diff 时返回 null
export function parseFileDiff(raw: ToolUseResultRaw | null | undefined): FileDiff | null {
  if (!raw || typeof raw !== 'object') return null;
  const filePath = raw.filePath;
  if (typeof filePath !== 'string' || !filePath) return null;
  const type: FileDiff['type'] = raw.type === 'create' ? 'create' : 'update';
  let hunks: DiffHunk[] = [];
  let additions = 0;
  let deletions = 0;
  if (Array.isArray(raw.structuredPatch)) {
    for (const h of raw.structuredPatch) {
      const lines: DiffLine[] = [];
      for (const ln of h.lines ?? []) {
        const c = ln[0];
        if (c === '\\') continue; // 无换行标记行,不渲染
        if (c === '+') { lines.push({ kind: 'add', text: ln.slice(1) }); additions++; }
        else if (c === '-') { lines.push({ kind: 'del', text: ln.slice(1) }); deletions++; }
        else lines.push({ kind: 'context', text: ln.slice(1) });
      }
      if (lines.length) hunks.push({ lines });
    }
  }
  // create 常无 structuredPatch,只给 content → 整文件按全新增
  if (!hunks.length && type === 'create' && typeof raw.content === 'string') {
    const arr = raw.content.split('\n');
    if (arr.length && arr[arr.length - 1] === '') arr.pop(); // 末尾换行不算一行
    if (arr.length) {
      hunks = [{ lines: arr.map((t) => ({ kind: 'add' as const, text: t })) }];
      additions = arr.length;
    }
  }
  if (!hunks.length) return null;
  return { type, filePath, hunks, additions, deletions, userModified: raw.userModified === true || undefined };
}

// 拼 WS URL:有 sessionId→恢复(可带 after_sequence);否则新建。
// ticket=null:本地 Koubou 调试(mock 鉴权,服务端不校验 ticket)不带 ws_ticket 参数
export function buildWsUrl(
  base: string,
  projectId: string,
  opts: { sessionId?: string | null; afterSequence?: number | null; ticket: string | null; model?: string | null; backend?: string | null },
): string {
  const root = base.replace(/\/$/, '');
  const path = opts.sessionId ? `/projects/${projectId}/sessions/${opts.sessionId}/ws` : `/projects/${projectId}/ws`;
  const params = new URLSearchParams();
  if (opts.ticket) params.set('ws_ticket', opts.ticket);
  if (opts.sessionId && opts.afterSequence != null) params.set('after_sequence', String(opts.afterSequence));
  // backend 建会话时固定:仅新建路径带;attach 时后端沿用会话记录的 backend
  if (!opts.sessionId && opts.backend) params.set('backend', opts.backend);
  // model 与 backend 同口径:仅新建路径带。attach 时后端**不读**这个参数(koubou
  // app/api/websocket.py:只有 create_session_ws 读并校验 model,attach_session_ws 里没有它),
  // 在世会话的模型只能靠 session.set_model 改 —— 留着它会让人以为建连能纠正模型(已骗过一轮修复)
  if (!opts.sessionId && opts.model) params.set('model', opts.model);
  const qs = params.toString();
  return `${root}${path}${qs ? `?${qs}` : ''}`;
}
