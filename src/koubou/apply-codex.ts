// Codex backend 的 agent 消息 reducer(纯函数,与 apply-koubou 共用 KoubouState / Message / Part 模型)。
//
// 契约要点(koubou docs/frontend/codex-backend-integration.md):
// - 所有 app-server 通知统一包成 `codex.message`,payload = { method, payload, task_list? }。
// - **只有 `item/completed` 持久化**(带 sequence,历史回放的内容主体);delta / plan / goal / usage
//   / turn 生命周期都是瞬时态,断线即丢。
// - 同一 `item.id` 的 live 增量与 completed 必须合并成同一个 UI item —— 故 item.id 直接用作
//   Message.id(以及 tool part 的 id),重放/落定天然是原位替换。
// - 未知 method / 未知 item.type / 缺字段一律无副作用(向前兼容,app-server 仍在演进)。
//
// 映射到既有渲染件(不新建 codex 专用视图):agentMessage→text、reasoning→thinking、
// commandExecution / fileChange / mcpToolCall / 其他活动→tool part(ToolCard + DiffView 复用)。
import type { KoubouState, Message, Part, Status } from '@/store/types';
import type { CodexMessagePayload, PlanTask, PlanTaskStatus } from './protocol';
import { parseUnifiedDiff } from './unified-diff';

// ---- 小工具:防御式读取(app-server 字段仍在演进,缺字段一律降级而非抛错) ----
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
// 增量文本:不同 method 的字段名不统一(delta / text / textDelta),也可能包一层 { delta: { text } }
function deltaText(p: Record<string, unknown>): string | undefined {
  const direct = str(p.delta) ?? str(p.text) ?? str(p.textDelta) ?? str(p.summaryTextDelta);
  if (direct) return direct;
  const nested = obj(p.delta);
  return nested ? str(nested.text) : undefined;
}

// item 执行态 → 既有 Status。in_progress 等中间态给转圈;失败给 error(ToolCard 内联 danger 展示)
function itemStatus(raw: unknown, fallback: Status): Status {
  const s = str(raw);
  if (!s) return fallback;
  if (s === 'failed' || s === 'error' || s === 'aborted' || s === 'canceled' || s === 'cancelled') return 'error';
  if (s === 'completed' || s === 'success' || s === 'succeeded') return 'ready';
  return fallback;
}

// reasoning 文本:summary 可能是字符串数组 / 字符串 / 带 text 的对象数组;都取不到则丢弃该 item
function reasoningText(item: Record<string, unknown>): string | undefined {
  const s = item.summary;
  if (Array.isArray(s)) {
    const joined = s.map((x) => str(x) ?? str(obj(x)?.text) ?? '').filter(Boolean).join('\n');
    if (joined) return joined;
  }
  return str(s) ?? str(item.text) ?? str(item.content);
}

// 工具结果文本:结构化结果优先序列化(media 等 JSON 结果前端另有解析),否则拼 content[].text
function resultText(result: unknown): string | undefined {
  const r = obj(result);
  if (!r) return str(result);
  if (r.structuredContent !== undefined) {
    try { return JSON.stringify(r.structuredContent); } catch { /* 循环引用等:退到 content */ }
  }
  if (Array.isArray(r.content)) {
    const text = r.content.map((c) => str(obj(c)?.text) ?? '').filter(Boolean).join('\n');
    if (text) return text;
  }
  try { return JSON.stringify(r); } catch { return undefined; }
}

// 文件变更 kind → 工具名(沿用 Claude 侧的工具名,ToolCard 图标/文案直接复用)
function fileToolName(kind: string | undefined): string {
  if (kind === 'add' || kind === 'create') return 'Write';
  if (kind === 'delete' || kind === 'remove') return 'Delete';
  return 'Edit';
}

// 通用活动卡:入参保留原 item 的可读字段(去掉大块内容与已单列的字段)
const GENERIC_OMIT = new Set(['id', 'type', 'status', 'result', 'content', 'contentItems', 'aggregatedOutput']);
function genericInput(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (!GENERIC_OMIT.has(k)) out[k] = v;
  return out;
}

// 走通用工具卡的已知活动类型;此外的未知类型静默忽略(不进对话流)
const GENERIC_ITEM_TYPES = new Set(['webSearch', 'dynamicToolCall', 'plan', 'imageGeneration', 'imageView']);

// item → parts。返回空数组 = 该 item 不成泡(无可读内容 / 未知类型)
export function codexItemToParts(item: Record<string, unknown>, live: boolean): Part[] {
  const id = str(item.id);
  const type = str(item.type);
  if (!id || !type) return [];
  const fallback: Status = live ? 'generating' : 'ready';
  switch (type) {
    case 'agentMessage': {
      const text = str(item.text) ?? str(item.content);
      return text ? [{ type: 'text', text }] : live ? [{ type: 'text', text: '' }] : [];
    }
    case 'reasoning': {
      const text = reasoningText(item);
      return text ? [{ type: 'thinking', text }] : live ? [{ type: 'thinking', text: '' }] : [];
    }
    case 'commandExecution': {
      const command = str(item.command) ?? '';
      const input: Record<string, unknown> = { command };
      const cwd = str(item.cwd);
      if (cwd) input.cwd = cwd;
      // exitCode 不进 input:ToolCard 的入参区按工具契约展示,失败已由 status=error + 输出体现
      const result = str(item.aggregatedOutput) ?? str(item.output);
      return [{ type: 'tool', id, name: 'Bash', input, status: itemStatus(item.status, fallback), ...(result ? { result } : {}) }];
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const status = itemStatus(item.status, fallback);
      const parts: Part[] = [];
      changes.forEach((raw, i) => {
        const c = obj(raw);
        const path = c && (str(c.path) ?? str(c.file_path));
        if (!c || !path) return;
        const kind = str(c.kind);
        const diff = parseUnifiedDiff(str(c.diff) ?? str(obj(c.diff)?.diff), path, kind);
        // part id 需全局唯一:同一 item 内多文件用 `${item.id}#${i}` 派生
        parts.push({ type: 'tool', id: `${id}#${i}`, name: fileToolName(kind), input: { file_path: path }, status, ...(diff ? { diff } : {}) });
      });
      return parts;
    }
    case 'mcpToolCall': {
      const server = str(item.server);
      const tool = str(item.tool) ?? 'mcp';
      const result = resultText(item.result) ?? str(item.error);
      return [{
        type: 'tool',
        id,
        name: server ? `${server}.${tool}` : tool,
        input: obj(item.arguments) ?? {},
        status: item.error ? 'error' : itemStatus(item.status, fallback),
        ...(result ? { result } : {}),
      }];
    }
    default: {
      if (!GENERIC_ITEM_TYPES.has(type)) return [];   // 未知类型静默忽略,保持向前兼容
      const result = resultText(item.result) ?? str(item.aggregatedOutput);
      return [{ type: 'tool', id, name: type, input: genericInput(item), status: itemStatus(item.status, fallback), ...(result ? { result } : {}) }];
    }
  }
}

// 文本/推理类才用 generating 消息态(渲染流式光标);工具类消息恒 ready,转圈由 tool part 自己的 status 承担
function messageStatus(parts: Part[], live: boolean): Status {
  if (!live) return 'ready';
  return parts.some((p) => p.type === 'text' || p.type === 'thinking') ? 'generating' : 'ready';
}

// 按 id 原位替换 / 追加,并把当前 running 轮的 footer 锚点指向该消息
function upsertMessage(state: KoubouState, msg: Message): KoubouState {
  const messages = state.messages.slice();
  const idx = messages.findIndex((m) => m.id === msg.id);
  if (idx === -1) messages.push(msg);
  else messages[idx] = msg;
  return { ...state, messages, turns: patchActiveTurn(state.turns, msg.id) };
}

function patchActiveTurn(turns: KoubouState['turns'], lastMessageId: string): KoubouState['turns'] {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].status === 'running') {
      const next = turns.slice();
      next[i] = { ...next[i], lastMessageId };
      return next;
    }
  }
  return turns;
}

// item → Message(不成泡时 null)。live 与历史重建共用同一映射,保证冷启动与实时渲染一致
export function codexItemMessage(rawItem: unknown, live: boolean): Message | null {
  const item = obj(rawItem);
  const id = item && str(item.id);
  if (!item || !id) return null;
  const parts = codexItemToParts(item, live);
  if (!parts.length) return null;
  return { id, role: 'assistant', parts, status: messageStatus(parts, live) };
}

// item/started(草稿) 与 item/completed(落定) 同一路径:live 决定状态与空内容是否成泡
function applyItem(state: KoubouState, rawItem: unknown, live: boolean): KoubouState {
  const msg = codexItemMessage(rawItem, live);
  return msg ? upsertMessage(state, msg) : state;
}

// 文本/推理增量:按 itemId 找草稿(没有则建),追加到同类型的尾部 part
function applyDelta(state: KoubouState, p: Record<string, unknown>, kind: 'text' | 'thinking'): KoubouState {
  const id = str(p.itemId) ?? str(p.item_id) ?? str(p.id);
  const text = deltaText(p);
  if (!id || !text) return state;
  const idx = state.messages.findIndex((m) => m.id === id);
  if (idx === -1) {
    return upsertMessage(state, { id, role: 'assistant', parts: [{ type: kind, text }], status: 'generating' });
  }
  const messages = state.messages.slice();
  const target = messages[idx];
  const parts = target.parts.slice();
  const last = parts.length - 1;
  if (last >= 0 && parts[last].type === kind) {
    parts[last] = { type: kind, text: (parts[last] as { text: string }).text + text };
  } else {
    parts.push({ type: kind, text });
  }
  messages[idx] = { ...target, parts, status: 'generating' };
  return { ...state, messages };
}

const PLAN_STATUS: Record<string, PlanTaskStatus> = {
  pending: 'pending',
  in_progress: 'in_progress',
  inProgress: 'in_progress',
  in_Progress: 'in_progress',
  running: 'in_progress',
  completed: 'completed',
  complete: 'completed',
  done: 'completed',
};
function planStatus(raw: unknown): PlanTaskStatus {
  return PLAN_STATUS[str(raw) ?? ''] ?? 'pending';
}

// 计划清单:优先 Koubou 附加的 task_list(已归一成与 Claude 任务清单同构),
// 缺失时降级读 app-server 原生 plan[](只有 step / status,故 id 用序号派生)
function planTasks(p: CodexMessagePayload): PlanTask[] {
  const tasks = p.task_list?.tasks;
  if (Array.isArray(tasks)) {
    return tasks
      .map((t) => obj(t))
      .filter((t): t is Record<string, unknown> => !!t)
      .map((t, i) => ({ id: str(t.id) ?? `task-${i}`, subject: str(t.subject) ?? '', status: planStatus(t.status) }))
      .filter((t) => t.subject);
  }
  const plan = Array.isArray(p.payload?.plan) ? (p.payload.plan as unknown[]) : null;
  if (!plan) return [];
  return plan
    .map((raw, i) => {
      const t = obj(raw);
      const subject = t ? str(t.step) ?? str(t.subject) ?? '' : '';
      return { id: `plan-${i}`, subject, status: planStatus(t?.status) };
    })
    .filter((t) => t.subject);
}

export function applyCodexMessage(state: KoubouState, p: CodexMessagePayload): KoubouState {
  const method = str(p.method);
  if (!method) return state;
  const payload = obj(p.payload) ?? {};
  switch (method) {
    case 'item/completed': return applyItem(state, payload.item, false);
    case 'item/started': return applyItem(state, payload.item, true);
    case 'item/agentMessage/delta': return applyDelta(state, payload, 'text');
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': return applyDelta(state, payload, 'thinking');
    // 计划清单是瞬时态(不回放);plan 为空即清空(与 Claude 侧「按轮独立」口径一致)
    case 'turn/plan/updated': return { ...state, tasks: planTasks(p) };
    // 其余(turn 生命周期 / goal / usage / diff / 各类 progress 与未知 method)本期不呈现:
    // run 终态以可回放的 run.finished 为权威,goal/usage/diff 现 UI 无承载位置(见设计稿排除项)
    default: return state;
  }
}
