import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import ModelSelector from './ModelSelector';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';
import '@/i18n';

const clientRef = createRef<KoubouClient | null>() as React.RefObject<KoubouClient | null>;

beforeEach(() => useStore.setState({
  availableModels: ['gpt-5.6', 'gpt-5.5'],
  selectedModel: 'gpt-5.5',
  backend: 'codex',
  runStatus: 'idle',
}));

describe('ModelSelector 在 codex 下的活跃 run 锁定', () => {
  it('空闲时可展开(渲染 chevron 触发钮)', () => {
    render(<ModelSelector client={clientRef} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('codex 活跃 run 期禁用:仍显示当前模型,但不可交互', () => {
    useStore.setState({ runStatus: 'running' });
    render(<ModelSelector client={clientRef} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('GPT 5.5')).toBeInTheDocument();
  });

  it('cc 活跃 run 期不禁用(支持热切换)', () => {
    useStore.setState({ backend: 'cc', runStatus: 'running' });
    render(<ModelSelector client={clientRef} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

describe('model.changed 校正选择器', () => {
  it('服务端确认值覆盖乐观值,并落项目记忆', () => {
    useStore.setState({ currentProjectId: 4, agentBackend: 'codex', selectedModel: 'gpt-5.6', modelByProject: {} });
    useStore.getState().ingestKoubou({
      type: 'model.changed', project_id: '4', session_id: 's1', payload: { model: 'gpt-5.5' }, sequence: null,
    });
    expect(useStore.getState().selectedModel).toBe('gpt-5.5');
    expect(useStore.getState().model).toBe('gpt-5.5');
    expect(useStore.getState().modelByProject['4:codex']).toBe('gpt-5.5');
  });
});
