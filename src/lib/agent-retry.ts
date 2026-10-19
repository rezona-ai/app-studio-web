// Agent 回合失败的应用层自动重试判据(纯函数)。设计稿 2026-08-25-agent-error-passthrough-auto-retry。
//
// 与**传输层**重连(client.ts 的 scheduleReconnect)划清:那套管「连接断了」,这套管
// 「连接开着、run 却失败了」。两者互不调用,只共用退避语汇。
import type { ContentBlock } from '@/koubou/protocol';

export const MAX_AGENT_RETRIES = 10;

// 发送 payload 的内容形态:纯文本,或带附件时的 content block 数组
type UserContent = string | ContentBlock[];

// 重试要发什么:resend = 原样重发上一条用户消息;continue = 隐式发 continue 让 agent 接着做。
// 按「本轮是否已有助手输出」分流 —— 已经花过钱、动过文件的部分不该让它从头重做。
export type RetryMode = 'resend' | 'continue';

// 自动重试发出的消息前缀:两个连续的不可见分隔符(U+2063 INVISIBLE SEPARATOR)。
//
// 自愈发出的两种消息 —— continue(接着做)与 resend(原样重发用户原话)—— 都必须真实落进
// 后端事件日志(agent 侧得看得见),却都不推本地气泡。不打标记的话,刷新后历史里
// 每自愈一次就多一个 continue 气泡 / 多一遍用户原话(最多 10 遍)。
//
// 判据只能是**前缀**:resend 的后半截是任意用户文本,整串相等匹配不了。前缀判据的代价是
// 「以哨兵开头的用户输入会被吞掉」,故取两个连续 U+2063 —— 粘来的文本里出现一个不可见
// 分隔符尚可想象,连着两个不可想象。
//
// 选 U+2063 而非 PUA 字符:万一哪天滤漏了,零宽字符的失败态是「看起来就是原文」,
// PUA 的失败态是两个豆腐块。它也不是空白符(JS trim / Python strip 都吃不掉它),
// 前后端任何一层做常规 trim 都不会把哨兵磨掉。
export const AUTO_RETRY_MARKER = '\u2063\u2063';
export const AUTO_RETRY_CONTINUE = `${AUTO_RETRY_MARKER}continue`;

// 打标记。带附件的发送 payload 是 ContentBlock[] 而非字符串,此时哨兵作为独立 text block 前插 ——
// 过滤侧只把 text block 拼起来看前缀(见 apply-koubou 的 contentText),两种形态同一判据。
export function autoRetryPrompt(content: UserContent): UserContent {
  return typeof content === 'string'
    ? `${AUTO_RETRY_MARKER}${content}`
    : [{ type: 'text', text: AUTO_RETRY_MARKER }, ...content];
}

// trimStart 与打断哨兵同口径:后端哪天在回填时前置了空白,哨兵不该因此漏滤
export function isAutoRetryText(text: string): boolean {
  return text.trimStart().startsWith(AUTO_RETRY_MARKER);
}

// 自动重试白名单:**只有确证该重试的才自动重试**,其余一律落报错 + 手动重试。
//
// 为什么是白名单而不是黑名单:后端 error 的取值空间前端管不住 —— 它新增一种业务错误
// (quota exceeded / model unavailable…),黑名单会在前端加码之前把它白烧 10 次退避;
// 白名单只是不自动重试,用户仍有手动入口。失效方向安全得多。
//
// 表里只有孤儿 run 一项:属主 Pod 没了,重试必然正确,而后端这条路径不带 retryable。
// 真正的主力判定是后端的 retryable(见下)—— 上游过载 / 限流 / 5xx 全靠它。
// 刻意**不**收 AGENT_RUN_ERROR(Claude 执行异常):异常类名千奇百怪,可能是 agent 代码硬 bug,
// 重试 10 次每次都真跑一轮。也不收 SEND_TIMEOUT(重试发出后 run 没开跑的兜底)——
// 让它落手动,顺带消除「后端排队慢 → 兜底再发一条 → 双执行」的风险(koubou 当前无 event_id 去重)。
const RETRYABLE_CODES: ReadonlySet<string> = new Set(['RUN_ABANDONED']);

// 后端给了 retryable 就以它为准(上游/模型侧失败带,是后端按 HTTP 状态码 / 错误标记算好的权威
// 判定,正反两向都压过前端白名单);没表态时才查白名单。
export function isRetryableAgentError(code: string | undefined, retryable?: boolean): boolean {
  if (typeof retryable === 'boolean') return retryable;
  return !!code && RETRYABLE_CODES.has(code);
}

// 与传输层 scheduleReconnect 同一套退避 min(1000·2ⁿ, 8000);attempt 从 0 起
export function retryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

// agent/run 级失败的归一形状(两个入口 error 事件 / run.finished{failed} 共用)。
// runId 用于判定「本轮是否已有助手输出」→ 决定重试发什么;应用层 error 事件可能没有对应 run。
export interface AgentFailure {
  code?: string;
  fallback: string;
  detail?: string;
  runId?: string | null;
  retryable?: boolean;   // 后端权威判定(上游/模型侧失败带);缺失时回落前端白名单
}
