// 工具审批的分类纯逻辑。Codex 把命令 / 文件修改 / 权限 / MCP elicitation 全统一到
// `tool.approval.requested`,由 payload.method 区分(Claude backend 不带 method → generic)。
// 见 koubou docs/frontend/codex-backend-integration.md「工具审批与 elicitation」。

export type ApprovalKind = 'command' | 'fileChange' | 'permissions' | 'url' | 'form' | 'generic';

const ELICITATION = 'mcpServer/elicitation/request';

export function approvalKind(method: string | undefined, input: unknown): ApprovalKind {
  switch (method) {
    case 'item/commandExecution/requestApproval': return 'command';
    case 'item/fileChange/requestApproval': return 'fileChange';
    case 'item/permissions/requestApproval': return 'permissions';
    case ELICITATION: {
      // url mode 是纯授权确认(可省略 content);其余 mode 要按 requestedSchema 提交结构化回答
      const mode = input && typeof input === 'object' ? (input as { mode?: unknown }).mode : undefined;
      return mode === 'url' ? 'url' : 'form';
    }
    default: return 'generic';
  }
}

// form 类批准必须带符合 requestedSchema 的 content,否则服务端返回
// 「MCP elicitation approval requires explicit content」且交互保持 pending(死挂)。
// 本期不做动态表单 → 只放行「拒绝」(设计稿决策),真实出现频率观测到再补表单。
export function isFormApproval(method: string | undefined, input: unknown): boolean {
  return approvalKind(method, input) === 'form';
}
