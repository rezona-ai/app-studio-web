import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';
import { createInitialKoubouState, createInitialServerState } from './types';
import type { ServerEvent } from '@/koubou/protocol';

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState(), currentProjectId: 42 }));

// visible_state.messages 的真实元素是 claude.message 事件信封({ sdk_type, payload })
const cmsg = (sdk_type: string, payload: Record<string, unknown>) =>
  ({ type: 'claude.message', project_id: '42', session_id: 's1', payload: { sdk_type, payload } });

function readyEvent(): ServerEvent {
  return {
    type: 'session.ready', project_id: '42', session_id: 's1',
    payload: {
      session_id: 's1',
      visible_state: { messages: [
        cmsg('AssistantMessage', { uuid: 'a1', content: [{ type: 'tool_use', id: 'tu1', name: 'gen', input: {} }] }),
        cmsg('UserMessage', { uuid: 'u1', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: JSON.stringify({ type: 'media.tasks.status', items: [{ task_id: 'g1', kind: 'image', status: 'ready', asset_path: 'assets/hero.png', preview_url: null }] }) }] }),
      ] },
    },
  } as ServerEvent;
}

describe('历史重建不预填 importedByProject(惰性化改由 onEvent 源头分流负责)', () => {
  test('从服务器重建历史:仍重建 messages,但不再预填 importedByProject', () => {
    useStore.getState().ingestKoubou(readyEvent());
    expect(useStore.getState().messages.length).toBeGreaterThan(0);            // 历史仍重建
    expect(useStore.getState().importedByProject['42'] ?? []).not.toContain('hero.png'); // 不再预填
  });

  test('已有本地消息(非空)时不重建历史', () => {
    useStore.setState({ messages: [{ id: 'm0', role: 'user', parts: [{ type: 'text', text: 'hi' }], status: 'ready' }] });
    useStore.getState().ingestKoubou(readyEvent());
    expect(useStore.getState().messages.map((mm) => mm.id)).toEqual(['m0']);
  });
});
