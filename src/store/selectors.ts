import type { Message, Part, RunStatus, TurnMeta, Version } from './types';
import type { AppStore } from './index';
import { modelGateLocked } from '@/lib/subscription/model-gate';

export function selectActiveVersion(versions: Version[], activeVersionId: string | null): Version | null {
  return versions.find((v) => v.id === activeVersionId) ?? versions.find((v) => v.current) ?? null;
}

// 消息中最后一个"可见"部分(非空文本 / 思考块 / 工具卡);无可见内容返回 undefined
function lastVisiblePart(m: Message): Part | undefined {
  for (let i = m.parts.length - 1; i >= 0; i--) {
    const p = m.parts[i];
    if (p.type === 'thinking' || p.type === 'tool' || (p.type === 'text' && p.text.trim() !== '')) return p;
  }
  return undefined;
}

// 是否展示"生成中"加载动画:
// run 运行中,且助手没有"正在流式输出可见正文(文本/思考)"——正文本身即反馈,不必叠加骨架。
// 故覆盖:空窗期 / 工具调用中或等待工具结果 / 重连到尚未 finish 的会话(历史已落定但 run 仍在跑)。
export function selectAwaitingResponse(messages: Message[], runStatus: RunStatus): boolean {
  if (runStatus !== 'running') return false;
  const last = messages[messages.length - 1];
  if (!last) return false;
  if (last.role === 'user') return true;
  const vp = lastVisiblePart(last);
  // 草稿正在流式输出文本/思考 → 已有可见进展,不展示骨架
  if (last.status === 'generating' && (vp?.type === 'text' || vp?.type === 'thinking')) return false;
  return true;
}

export interface TurnAnchors {
  byMessageId: Map<string, TurnMeta>;
  copyTextByMessageId: Map<string, string>;
  trailing: TurnMeta | null;
}

// 已结束轮的 footer 锚到其最后一条消息；running 轮始终归入 trailing 渲染到底部，
// 保证计时器跟随最新的可见内容（包括等待骨架）。同时按已结束轮边界聚合助手原始文本，
// 让回复级操作只出现在整轮结束处；已结束且锚点不在 messages 的空轮直接跳过。
export function selectTurnAnchors(messages: Message[], turns: TurnMeta[]): TurnAnchors {
  const ids = new Set(messages.map((m) => m.id));
  const byMessageId = new Map<string, TurnMeta>();
  const copyTextByMessageId = new Map<string, string>();
  let trailing: TurnMeta | null = null;
  for (const t of turns) {
    if (t.status === 'running') trailing = t;
    else if (t.lastMessageId && ids.has(t.lastMessageId)) byMessageId.set(t.lastMessageId, t);
  }

  let textParts: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      textParts = [];
    } else {
      for (const part of message.parts) {
        if (part.type === 'text' && part.text.trim()) textParts.push(part.text);
      }
    }
    if (byMessageId.has(message.id)) {
      if (textParts.length > 0) copyTextByMessageId.set(message.id, textParts.join('\n\n'));
      textParts = [];
    }
  }

  return { byMessageId, copyTextByMessageId, trailing };
}


// 新用户模型门禁是否生效(判据见 lib/subscription/model-gate.ts;三项输入任一未知则放行)
export function selectModelGateLocked(s: Pick<AppStore, 'newUserStatus' | 'plansCache' | 'availableModels'>): boolean {
  return modelGateLocked({
    isNewUser: s.newUserStatus, tier: s.plansCache?.current_tier ?? null, models: s.availableModels,
  });
}

// 模型下拉此刻不可操作:codex 只在 run 空闲时接受切模型(活跃 run 返回 run already active);cc 支持热切换。
// ModelSelector 的 disabled 与报错气泡的 Switch model 共用这一份 —— 各写一份的话,按钮会在下拉禁用时
// 照常显示,点了毫无反应
export function selectModelSelectorLocked(s: Pick<AppStore, 'backend' | 'runStatus'>): boolean {
  return s.backend === 'codex' && s.runStatus === 'running';
}

// 红色报错气泡是否附带「换模型」提示与 Switch model 按钮(设计稿 2026-09-03)。reducer 只记
// agentError.retryable === false 这个事实,值不值得提示在这里判:门禁锁定或只剩一个模型时无可换,
// 下拉被锁(codex 活跃 run,error 事件不关轮、这个窗口无上界)时点了开不了,都不提示
export function selectModelSwitchHint(
  s: Pick<AppStore, 'agentError' | 'newUserStatus' | 'plansCache' | 'availableModels' | 'backend' | 'runStatus'>,
): boolean {
  if (s.agentError?.retryable !== false) return false;
  if (selectModelGateLocked(s) || selectModelSelectorLocked(s)) return false;
  return s.availableModels.length >= 2;
}
