import '@/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubagentList from './SubagentList';
import type { SubagentCard } from '@/lib/subagent-tasks';

const card = (over: Partial<SubagentCard> = {}): SubagentCard => ({
  taskId: 't1', toolUseId: 'tu-1', runId: 'r1', kind: 'agent',
  description: '查找卡片落位逻辑', status: 'running', ...over,
});

describe('SubagentList', () => {
  it('渲染每张卡的标签', () => {
    render(<SubagentList cards={[card(), card({ taskId: 't2', description: '审查 diff' })]} />);
    expect(screen.getByText('查找卡片落位逻辑')).toBeInTheDocument();
    expect(screen.getByText('审查 diff')).toBeInTheDocument();
  });

  it('后台命令带类型标,子代理不带', () => {
    render(<SubagentList cards={[
      card({ taskId: 't1', description: 'pnpm test', kind: 'bash' }),
      card({ taskId: 't2', description: '审查 diff', kind: 'agent' }),
    ]} />);
    expect(screen.getAllByText('background command')).toHaveLength(1);
  });

  it('未知类型按后台命令同形态渲染(不预期子消息)', () => {
    render(<SubagentList cards={[card({ kind: 'unknown' })]} />);
    expect(screen.getByText('background command')).toBeInTheDocument();
  });

  it('进行中显示活体行「正在 {tool}」,无 lastToolName 时不显示', () => {
    const { rerender } = render(<SubagentList cards={[card({ lastToolName: 'Grep' })]} />);
    expect(screen.getByText('Running Grep')).toBeInTheDocument();
    rerender(<SubagentList cards={[card()]} />);
    expect(screen.queryByText(/^Running /)).toBeNull();
  });

  it('终态不再显示活体行(结束了不该还写着在做什么)', () => {
    render(<SubagentList cards={[card({ status: 'completed', lastToolName: 'Grep' })]} />);
    expect(screen.queryByText('Running Grep')).toBeNull();
  });

  it('每种状态在图标上打 data-status,便于视觉档位与测试对齐', () => {
    const { container } = render(<SubagentList cards={[
      card({ taskId: 'a', status: 'pending' }),
      card({ taskId: 'b', status: 'running' }),
      card({ taskId: 'c', status: 'paused' }),
      card({ taskId: 'd', status: 'completed' }),
      card({ taskId: 'e', status: 'failed' }),
      card({ taskId: 'f', status: 'stopped' }),
      card({ taskId: 'g', status: 'ended_without_terminal', sealReason: 'unknown' }),
    ]} />);
    const got = [...container.querySelectorAll('[data-status]')].map((n) => n.getAttribute('data-status'));
    expect(got).toEqual(['pending', 'running', 'paused', 'completed', 'failed', 'stopped', 'ended_without_terminal']);
    // 只有进行中的那一档转圈
    expect(container.querySelector('[data-status="running"]')?.className).toContain('animate-spin');
    expect(container.querySelector('[data-status="paused"]')?.className).not.toContain('animate-spin');
  });

  // 旋转 16px 方盒的外接盒最大 16·√2≈22.6px,会被算进 overflow-y:auto 列表的 scrollable overflow:
  // 每转过 90° 滚动条就出现/收起一次,列表内容宽随之抖动、右侧的类型标横跳(肉眼即"闪烁")。
  // 弧是盒内内切圆、旋转不出自身盒子,故必须待在等大的裁切槽里,把旋转溢出挡在列表之外。
  it('转圈弧包在等大裁切槽内(旋转溢出不算进滚动容器)', () => {
    const { container } = render(<SubagentList cards={[card({ status: 'running' })]} />);
    const arc = container.querySelector('[data-status="running"]');
    expect(arc?.className).toContain('animate-spin');
    expect(arc?.parentElement?.className).toContain('overflow-clip');
  });

  it('终态词:停止 / 失败 / 三种合成态措辞', () => {
    render(<SubagentList cards={[
      card({ taskId: 'a', status: 'stopped' }),
      card({ taskId: 'b', status: 'failed' }),
      card({ taskId: 'c', status: 'ended_without_terminal', sealReason: 'unknown' }),
      card({ taskId: 'd', status: 'ended_without_terminal', sealReason: 'interrupted' }),
      card({ taskId: 'e', status: 'ended_without_terminal', sealReason: 'failed' }),
    ]} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument();
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Ended with run failure')).toBeInTheDocument();
  });

  it('completed 不额外挂状态词(勾即说明一切)', () => {
    render(<SubagentList cards={[card({ status: 'completed' })]} />);
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Stopped')).toBeNull();
  });

  it('展开读汇报(Markdown 渲染)', () => {
    render(<SubagentList cards={[card({ status: 'completed', summary: '发现 **2 处**问题' })]} />);
    const row = screen.getByRole('button');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('2 处')).toBeInTheDocument();   // ** ** 成了 <strong>
  });

  it('终态卡没有汇报时展开显示「无汇报」而非空白', () => {
    render(<SubagentList cards={[card({ status: 'stopped' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('No report')).toBeInTheDocument();
  });

  it('失败原因展开可见', () => {
    render(<SubagentList cards={[card({ status: 'failed', error: 'boom' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('output_file 有值才渲染路径', () => {
    const { rerender } = render(<SubagentList cards={[card({ status: 'completed', outputFile: '/tmp/t1.out' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('/tmp/t1.out')).toBeInTheDocument();
    rerender(<SubagentList cards={[card({ status: 'completed' })]} />);
    expect(screen.queryByText('/tmp/t1.out')).toBeNull();
  });

  // 行级展开与整卡折叠在同一列上下相邻,必须一眼可分:整卡沿用 arrowDown 上下 caret,
  // 行级改用 chevron 横→竖旋转 90°(收起 › / 展开 ⌄),区分靠不同的旋转轴而非尺寸色阶
  it('行级用 chevron 旋转 90°,不复用整卡折叠的上下 caret', () => {
    const { container } = render(<SubagentList cards={[card({ status: 'completed', summary: '汇报' })]} />);
    expect(container.querySelector('[data-collapse-arrow]')).toBeNull();
    const arrow = container.querySelector('[data-row-arrow]');
    expect(arrow).toBeInTheDocument();
    expect(arrow?.className).not.toContain('rotate-90');
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('[data-row-arrow]')?.className).toContain('rotate-90');
  });

  it('进行中且无产出的卡不可展开(还没有汇报可读)', () => {
    render(<SubagentList cards={[card({ status: 'running' })]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
