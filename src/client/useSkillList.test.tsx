import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useSkillList } from './useSkillList';
import { koubouApi } from '@/lib/koubou/client';
import { useStore } from '@/store';

function Probe() { useSkillList(); return null; }

afterEach(() => { vi.restoreAllMocks(); useStore.setState({ skills: [] }); });

describe('useSkillList', () => {
  it('挂载拉取一次并写入 store', async () => {
    const skills = [{ name: 'plan', invocation: '/plan' }, { name: 'cutout', invocation: '/cutout' }];
    vi.spyOn(koubouApi, 'listSkills').mockResolvedValue(skills);
    render(<Probe />);
    await waitFor(() => expect(useStore.getState().skills).toEqual(skills));
    expect(koubouApi.listSkills).toHaveBeenCalledWith('cc');
  });
  it('codex 开关下拉 codex 的 skill 列表($ 调用串)', async () => {
    useStore.setState({ agentBackend: 'codex' });
    const skills = [{ name: 'brainstorm', invocation: '$brainstorm' }];
    vi.spyOn(koubouApi, 'listSkills').mockResolvedValue(skills);
    render(<Probe />);
    await waitFor(() => expect(useStore.getState().skills).toEqual(skills));
    expect(koubouApi.listSkills).toHaveBeenCalledWith('codex');
    useStore.setState({ agentBackend: 'cc' });
  });
  it('失败静默,列表保持空', async () => {
    vi.spyOn(koubouApi, 'listSkills').mockRejectedValue(new Error('down'));
    render(<Probe />);
    await waitFor(() => expect(koubouApi.listSkills).toHaveBeenCalled());
    expect(useStore.getState().skills).toEqual([]);
  });
});
