import { describe, expect, test } from 'vitest';
import { agentProvenance } from './agent-provenance';
import type { Message } from '@/store/types';

// ---- 写侧:按 task_id 回溯该次生成的工具入参 ----
// 与 lineageForTask 同一套定位(同一个 tool part:result 是回执、input 是入参),
// 那边只取源 url 连血缘,这里原样取整份入参落库
const AT = '2026-08-06T10:00:00.000Z';

const toolPart = (taskId: string | null, input: unknown, kind = 'image') => ({
  type: 'tool' as const,
  id: `toolu-${taskId ?? 'x'}`,
  name: `mcp__media__submit_${kind}_generation`,
  input,
  status: 'ready' as const,
  ...(taskId ? { result: JSON.stringify({ type: 'media.task_submitted', kind, task_id: taskId }) } : {}),
});
const msg = (parts: Message['parts']): Message => ({ id: 'm1', role: 'assistant', status: 'ready', parts });

describe('agentProvenance', () => {
  test('命中 → req 与工具入参深相等且原样(不挑键不改写),agent 标记为 true', () => {
    const input = {
      prompt: '像素地牢主角立绘', model: 'gemini-flash-image', size: '1024x1024',
      name: '主角立绘', transparent: true, source_urls: ['https://a/ref.png'],
    };
    const out = agentProvenance([msg([toolPart('gtask-1', input)])], 'gtask-1', 'image', AT);
    expect(out).toEqual({ kind: 'image', req: input, at: AT, agent: true });
    // toBe:原样落库(约束 4)—— 将来若在写侧加工/浅拷贝这条会红
    expect(out!.req).toBe(input);
  });

  test('task_id 对不上 → undefined(不误取别的生成)', () => {
    expect(agentProvenance([msg([toolPart('gtask-1', { prompt: 'x' })])], 'gtask-别的', 'image', AT))
      .toBeUndefined();
  });

  test('多条 tool part:只取 task_id 匹配那条,不取第一条', () => {
    const first = { prompt: '第一次' };
    const target = { prompt: '要的那次' };
    const messages = [msg([toolPart('gtask-1', first), toolPart('gtask-2', target)])];
    expect(agentProvenance(messages, 'gtask-2', 'image', AT)?.req).toEqual(target);
  });

  test('跨消息也能回溯(提交与产物往往隔着几轮对话)', () => {
    const input = { prompt: '几轮前提交的' };
    const messages = [msg([toolPart('gtask-9', input)]), msg([{ type: 'text' as const, text: '中间的回复' }])];
    expect(agentProvenance(messages, 'gtask-9', 'image', AT)?.req).toEqual(input);
  });

  test('input 不是对象(null / 字符串 / 数组)→ undefined,不造空壳溯源', () => {
    expect(agentProvenance([msg([toolPart('gtask-1', null)])], 'gtask-1', 'image', AT)).toBeUndefined();
    expect(agentProvenance([msg([toolPart('gtask-1', '文本')])], 'gtask-1', 'image', AT)).toBeUndefined();
    // 数组也是 object:放行会让面板渲染一份提示词为空的溯源、还给出再生成按钮
    expect(agentProvenance([msg([toolPart('gtask-1', [])])], 'gtask-1', 'image', AT)).toBeUndefined();
  });

  test('消息里根本没有该 part(历史分页没加载到)→ undefined', () => {
    expect(agentProvenance([msg([{ type: 'text' as const, text: '只有文本' }])], 'gtask-1', 'image', AT))
      .toBeUndefined();
  });

  test('tool part 无 result(还没拿到回执)→ 不参与匹配', () => {
    expect(agentProvenance([msg([toolPart(null, { prompt: 'x' })])], 'gtask-1', 'image', AT)).toBeUndefined();
  });

  test('kind 由调用方给定(与 GenTask 口径一致),不从工具名猜', () => {
    const input = { prompt: '一段视频' };
    expect(agentProvenance([msg([toolPart('gt-v', input, 'video')])], 'gt-v', 'video', AT)?.kind).toBe('video');
  });
});
