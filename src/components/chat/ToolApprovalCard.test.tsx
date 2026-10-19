import { describe, expect, it, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolApprovalCard from './ToolApprovalCard';
import '@/i18n';

test('展示工具名 + input,点批准/拒绝回调', () => {
  const onResolve = vi.fn();
  render(<ToolApprovalCard interactionId="i1" toolName="Bash" input={{ command: 'rm -rf' }} onResolve={onResolve} />);
  expect(screen.getByText('Bash')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(onResolve).toHaveBeenCalledWith('i1', false);
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(onResolve).toHaveBeenCalledWith('i1', true);
});

// —— codex:统一审批事件按 method 出标题;form 类降级为仅可拒绝 ——
describe('codex 审批分类', () => {
  it('命令类出命令审批标题,批准/拒绝均可用', () => {
    const onResolve = vi.fn();
    render(<ToolApprovalCard interactionId="i1" toolName="Bash" input={{ command: 'pnpm install' }} method="item/commandExecution/requestApproval" onResolve={onResolve} />);
    expect(screen.getByText(/Command approval required/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    expect(onResolve).toHaveBeenCalledWith('i1', true);
  });

  it('URL elicitation 出授权标题,仍可批准(允许省略 content)', () => {
    render(<ToolApprovalCard interactionId="i2" toolName="mcp" input={{ mode: 'url', url: 'https://x' }} method="mcpServer/elicitation/request" onResolve={() => {}} />);
    expect(screen.getByText(/URL access approval required/)).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
  });

  it('MCP form 类:隐藏批准 + 给出不支持提示,只能拒绝', () => {
    const onResolve = vi.fn();
    render(<ToolApprovalCard interactionId="i3" toolName="mcp" input={{ mode: 'form', requestedSchema: { type: 'object' } }} method="mcpServer/elicitation/request" onResolve={onResolve} />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.getByText(/structured form/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Reject'));
    expect(onResolve).toHaveBeenCalledWith('i3', false);
  });

  it('无 method(Claude backend)沿用通用标题', () => {
    render(<ToolApprovalCard interactionId="i4" toolName="Bash" input={{}} onResolve={() => {}} />);
    expect(screen.getByText(/Tool approval required/)).toBeInTheDocument();
  });
});
