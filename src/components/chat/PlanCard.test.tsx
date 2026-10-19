import '@/i18n';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanCard from './PlanCard';
import { useStore } from '@/store';
import type { PlanTask } from '@/koubou/protocol';
import type { SubagentCard } from '@/lib/subagent-tasks';
import { createSubagentState } from '@/lib/subagent-tasks';

const setTasks = (tasks: PlanTask[]) => useStore.setState({ tasks, planCollapsed: false });
const setCards = (cards: SubagentCard[]) =>
  useStore.setState({ subagents: { ...createSubagentState(), cards } });
const card = (over: Partial<SubagentCard> = {}): SubagentCard => ({
  taskId: 't1', toolUseId: 'tu-1', runId: 'r1', kind: 'agent',
  description: '查找卡片落位逻辑', status: 'running', ...over,
});

describe('PlanCard', () => {
  // 默认置 running:卡片仅在运行中展示,run 结束(非 running)一律隐藏,隐藏时机由专门用例覆盖
  beforeEach(() => useStore.setState({
    tasks: [], subagents: createSubagentState(), planCollapsed: false, planView: 'tasks', runStatus: 'running',
  }));

  it('空清单不渲染', () => {
    const { container } = render(<PlanCard />);
    expect(container.firstChild).toBeNull();
  });

  it('渲染标题与全部任务;in_progress 显示 activeForm,缺省回退 subject', () => {
    setTasks([
      { id: '1', subject: '搜 skill', status: 'completed' },
      { id: '2', subject: '写 json', activeForm: '正在写 json', status: 'in_progress' },
      { id: '3', subject: '无 activeForm', status: 'in_progress' },
      { id: '4', subject: '排队中', status: 'pending' },
    ]);
    render(<PlanCard />);
    expect(screen.getByText('Task list')).toBeInTheDocument();
    expect(screen.getByText('搜 skill')).toBeInTheDocument();
    expect(screen.getByText('正在写 json')).toBeInTheDocument();  // activeForm 优先
    expect(screen.queryByText('写 json')).toBeNull();
    expect(screen.getByText('无 activeForm')).toBeInTheDocument(); // 回退 subject
    expect(screen.getByText('排队中')).toBeInTheDocument();
  });

  it('折叠:列表隐藏,头部显示进度计数;再点展开', () => {
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
    render(<PlanCard />);
    const toggle = screen.getByRole('button', { name: 'Toggle task list' });
    fireEvent.click(toggle);
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('1/2')).toBeNull(); // 展开态严格按设计稿,无计数
  });

  it('折叠态显示当前 in_progress 任务(activeForm 优先);列表仍隐藏', () => {
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: '写 json', activeForm: '正在写 json', status: 'in_progress' },
      { id: '3', subject: 'c', status: 'pending' },
    ]);
    useStore.setState({ planCollapsed: true });
    render(<PlanCard />);
    expect(screen.queryByText('c')).toBeNull();          // 列表隐藏
    expect(screen.getByText('正在写 json')).toBeInTheDocument(); // 当前任务可见
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('折叠态无 in_progress 任务时不显示当前任务行', () => {
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
    useStore.setState({ planCollapsed: true });
    render(<PlanCard />);
    expect(screen.queryByText('a')).toBeNull();
    expect(screen.queryByText('b')).toBeNull();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('已完成任务沉底:未完成在前保持原序,completed 移到最后', () => {
    setTasks([
      { id: '1', subject: 'done1', status: 'completed' },
      { id: '2', subject: 'doing', status: 'in_progress' },
      { id: '3', subject: 'done2', status: 'completed' },
      { id: '4', subject: 'todo', status: 'pending' },
    ]);
    render(<PlanCard />);
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual(['doing', 'todo', 'done1', 'done2']);
  });

  it('completed 行有删除线样式类', () => {
    setTasks([{ id: '1', subject: 'done', status: 'completed' }]);
    render(<PlanCard />);
    expect(screen.getByText('done').className).toContain('line-through');
  });

  it('全部完成且本轮已结束(非 running)→ 卡片自动隐藏', () => {
    useStore.setState({ runStatus: 'idle' });
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'completed' },
    ]);
    const { container } = render(<PlanCard />);
    expect(container.firstChild).toBeNull();
  });

  it('全部完成但仍在运行(running)→ 保留卡片作进度反馈', () => {
    useStore.setState({ runStatus: 'running' });
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'completed' },
    ]);
    render(<PlanCard />);
    expect(screen.getByText('Task list')).toBeInTheDocument();
  });

  it('本轮已结束即使仍有未完成项(非 running)→ 卡片同样隐藏', () => {
    useStore.setState({ runStatus: 'idle' });
    setTasks([
      { id: '1', subject: 'a', status: 'completed' },
      { id: '2', subject: 'b', status: 'pending' },
    ]);
    const { container } = render(<PlanCard />);
    expect(container.firstChild).toBeNull();
  });

  // ---- 双段:任务清单 / 子代理 ----
  describe('子代理段', () => {
    const segmented = () => screen.queryByRole('radiogroup', { name: 'Switch between task list and subagents' });

    it('只有任务清单时不出现开关,观感与从前一致', () => {
      setTasks([{ id: '1', subject: 'a', status: 'pending' }]);
      render(<PlanCard />);
      expect(segmented()).toBeNull();
      expect(screen.getByText('Task list')).toBeInTheDocument();
    });

    it('只有子代理卡时不出现开关,标题直接是「子代理」', () => {
      setCards([card()]);
      render(<PlanCard />);
      expect(segmented()).toBeNull();
      expect(screen.getByText('Subagents')).toBeInTheDocument();
      expect(screen.getByText('查找卡片落位逻辑')).toBeInTheDocument();
    });

    it('两段都有内容 → 出现 Segmented,子代理段带总数', () => {
      setTasks([{ id: '1', subject: 'a', status: 'pending' }]);
      setCards([card(), card({ taskId: 't2', description: '跑测试', kind: 'bash', status: 'completed' })]);
      render(<PlanCard />);
      expect(segmented()).not.toBeNull();
      expect(screen.getByRole('radio', { name: 'Subagents 2' })).toBeInTheDocument();
    });

    it('子代理开卡不自动抢切:默认仍停在任务清单', () => {
      setTasks([{ id: '1', subject: '任务行', status: 'pending' }]);
      setCards([card()]);
      render(<PlanCard />);
      expect(screen.getByText('任务行')).toBeInTheDocument();
      expect(screen.queryByText('查找卡片落位逻辑')).toBeNull();
    });

    it('点 Segmented 切到子代理段', () => {
      setTasks([{ id: '1', subject: '任务行', status: 'pending' }]);
      setCards([card()]);
      render(<PlanCard />);
      fireEvent.click(screen.getByRole('radio', { name: 'Subagents 1' }));
      expect(screen.getByText('查找卡片落位逻辑')).toBeInTheDocument();
      expect(screen.queryByText('任务行')).toBeNull();
    });

    it('停在子代理段时清单为空 → 仍显示子代理段(不空转)', () => {
      useStore.setState({ planView: 'subagents' });
      setCards([card()]);
      render(<PlanCard />);
      expect(screen.getByText('查找卡片落位逻辑')).toBeInTheDocument();
    });

    it('停在子代理段但卡片被清空(新一轮开始)→ 回落任务清单', () => {
      useStore.setState({ planView: 'subagents' });
      setTasks([{ id: '1', subject: '新一轮任务', status: 'pending' }]);
      render(<PlanCard />);
      expect(screen.getByText('新一轮任务')).toBeInTheDocument();
      expect(segmented()).toBeNull();
    });

    it('折叠态:子代理段计数为「终态数/总数」,并显示首个未完成的卡', () => {
      useStore.setState({ planView: 'subagents', planCollapsed: true });
      setCards([
        card({ taskId: 't1', description: '已完成的', status: 'completed' }),
        card({ taskId: 't2', description: '还在跑的' }),
      ]);
      render(<PlanCard />);
      expect(screen.getByText('1/2')).toBeInTheDocument();
      expect(screen.getByText('还在跑的')).toBeInTheDocument();
      expect(screen.queryByText('已完成的')).toBeNull();
    });

    // 折叠态与展开态必须对同一状态给同一说法:paused 在展开态不转圈,折叠态也不该转
    it('折叠态的子代理行按卡片真实状态出图标(paused 不转圈)', () => {
      useStore.setState({ planView: 'subagents', planCollapsed: true });
      setCards([card({ status: 'paused', description: '暂停中的' })]);
      const { container } = render(<PlanCard />);
      const icon = container.querySelector('[data-status]');
      expect(icon?.getAttribute('data-status')).toBe('paused');
      expect(icon?.className).not.toContain('animate-spin');
      expect(screen.getByText('暂停中的')).toBeInTheDocument();
    });

    it('折叠态进行中的卡仍转圈', () => {
      useStore.setState({ planView: 'subagents', planCollapsed: true });
      setCards([card({ status: 'running' })]);
      const { container } = render(<PlanCard />);
      expect(container.querySelector('[data-status="running"]')?.className).toContain('animate-spin');
    });

    // 与子代理行同因:任务清单也是限高 overflow-y-auto,转圈弧的旋转溢出会让滚动条反复出现
    it('任务清单的转圈弧同样包在等大裁切槽内', () => {
      setTasks([{ id: '1', subject: '写 json', status: 'in_progress' }]);
      const { container } = render(<PlanCard />);
      const arc = [...container.querySelectorAll('span')].find((n) => n.className.includes('animate-spin'));
      expect(arc?.parentElement?.className).toContain('overflow-clip');
    });

    it('两段都空 → 不渲染', () => {
      const { container } = render(<PlanCard />);
      expect(container.firstChild).toBeNull();
    });

    it('本轮结束(非 running)→ 子代理段一并淡出', () => {
      useStore.setState({ runStatus: 'idle' });
      setCards([card({ status: 'ended_without_terminal', sealReason: 'unknown' })]);
      const { container } = render(<PlanCard />);
      expect(container.firstChild).toBeNull();
    });
  });
});
