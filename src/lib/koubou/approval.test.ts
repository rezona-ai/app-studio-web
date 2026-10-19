import { describe, expect, test } from 'vitest';
import { approvalKind, isFormApproval } from './approval';

describe('approvalKind', () => {
  test('codex 的四类 approve-deny 审批各自分类', () => {
    expect(approvalKind('item/commandExecution/requestApproval', { command: 'ls' })).toBe('command');
    expect(approvalKind('item/fileChange/requestApproval', {})).toBe('fileChange');
    expect(approvalKind('item/permissions/requestApproval', { permissions: {} })).toBe('permissions');
    expect(approvalKind('mcpServer/elicitation/request', { mode: 'url', url: 'https://x' })).toBe('url');
  });

  test('MCP elicitation 非 url mode → form(需结构化 content,本期只允许拒绝)', () => {
    expect(approvalKind('mcpServer/elicitation/request', { mode: 'form', requestedSchema: {} })).toBe('form');
    expect(approvalKind('mcpServer/elicitation/request', {})).toBe('form');
  });

  test('无 method(Claude backend)/ 未知 method → generic,沿用通用审批卡', () => {
    expect(approvalKind(undefined, { command: 'ls' })).toBe('generic');
    expect(approvalKind('brand/new/approval', {})).toBe('generic');
  });
});

describe('isFormApproval', () => {
  test('只有 form 类需要屏蔽「批准」(缺 content 批准会让交互永久 pending)', () => {
    expect(isFormApproval('mcpServer/elicitation/request', {})).toBe(true);
    expect(isFormApproval('mcpServer/elicitation/request', { mode: 'url' })).toBe(false);
    expect(isFormApproval('item/commandExecution/requestApproval', {})).toBe(false);
    expect(isFormApproval(undefined, {})).toBe(false);
  });
});
