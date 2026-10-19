import type { Message, Part } from '@/store/types';

type ToolPart = Extract<Part, { type: 'tool' }>;

// ChatPanel 渲染节点:普通消息(照旧走 MessageItem)/ 单个工具 / 合并组(≥2 同名可合并)
export type RenderNode =
  | { kind: 'message'; message: Message }
  | { kind: 'tool'; part: ToolPart }
  | { kind: 'toolGroup'; id: string; name: string; parts: ToolPart[] };

// 可合并:同名之外还要求无 diff、无 media —— diff/产图工具的关键产出不该藏进计数,保留独立 pill
export function isMergeable(p: ToolPart): boolean {
  return !p.diff && !(p.media && p.media.length > 0);
}

// 流式空壳 part:content_block_start 先建空 text/thinking 块再流内容,判定与拍平时一律忽略,
// 否则 generating 草稿会因空壳被判不可分组,正在跑的工具与前组断开(出现两个同名 pill)
function isBlankShell(p: Part): boolean {
  return (p.type === 'text' || p.type === 'thinking') && p.text.trim() === '';
}

// 可分组消息:忽略空壳后为纯工具的 assistant 消息,且不带 turn footer(footer 是回合边界,不并进组)
function isGroupable(m: Message, footerIds: ReadonlySet<string>): boolean {
  const parts = m.parts.filter((p) => !isBlankShell(p));
  return (
    m.role === 'assistant' &&
    parts.length > 0 &&
    parts.every((p) => p.type === 'tool') &&
    !footerIds.has(m.id)
  );
}

// 把一段连续可分组消息拍平出的 tool parts 切成组:同名+可合并+连续 ≥2 → toolGroup,否则单个 tool
function splitToolRun(parts: ToolPart[]): RenderNode[] {
  const out: RenderNode[] = [];
  let run: ToolPart[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: 'toolGroup', id: run[0].id, name: run[0].name, parts: run });
    else if (run.length === 1) out.push({ kind: 'tool', part: run[0] });
    run = [];
  };
  for (const p of parts) {
    if (!isMergeable(p)) { flush(); out.push({ kind: 'tool', part: p }); continue; }
    if (run.length > 0 && run[0].name !== p.name) flush();
    run.push(p);
  }
  flush();
  return out;
}

// 主入口:messages → 渲染节点序列。连续可分组消息内做同名合并,其余消息原样透出并打断连续段。
export function groupToolRuns(messages: readonly Message[], footerIds: ReadonlySet<string>): RenderNode[] {
  const nodes: RenderNode[] = [];
  let i = 0;
  while (i < messages.length) {
    if (!isGroupable(messages[i], footerIds)) {
      nodes.push({ kind: 'message', message: messages[i] });
      i++;
      continue;
    }
    const parts: ToolPart[] = [];
    while (i < messages.length && isGroupable(messages[i], footerIds)) {
      for (const p of messages[i].parts) { if (!isBlankShell(p)) parts.push(p as ToolPart); }
      i++;
    }
    nodes.push(...splitToolRun(parts));
  }
  return nodes;
}
