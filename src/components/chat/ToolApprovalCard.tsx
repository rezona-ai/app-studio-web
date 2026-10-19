'use client';
import { useTranslation } from 'react-i18next';
import { approvalKind, isFormApproval } from '@/lib/koubou/approval';

// 工具审批卡。codex 把命令 / 文件修改 / 权限 / MCP elicitation 统一到同一事件,用 method 区分标题;
// 其中 MCP form(非 url mode)批准必须带符合 requestedSchema 的结构化 content,本期不做动态表单
// → 只给「拒绝」,避免「批准缺 content → 交互永久 pending」的死挂(见设计稿 2026-07-30)。
export default function ToolApprovalCard({ interactionId, toolName, input, method, onResolve }: {
  interactionId: string; toolName: string; input: unknown; method?: string;
  onResolve: (interactionId: string, approved: boolean) => void;
}) {
  const { t } = useTranslation();
  const kind = approvalKind(method, input);
  const formOnly = isFormApproval(method, input);
  return (
    <div className="rounded-[12px] border border-amber-400/70 bg-amber-400/10 p-3 text-[13px] text-[var(--color-ink)]">
      <div className="mb-1 font-medium">
        {t(`chat.approval.kind.${kind}`, { defaultValue: t('chat.approval.required') })}<span>{toolName}</span>
      </div>
      <pre className="mb-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--color-muted)]">{JSON.stringify(input, null, 2).slice(0, 600)}</pre>
      {formOnly && (
        <div className="mb-2 text-[12px] leading-[18px] text-[var(--color-muted)]">{t('chat.approval.formUnsupported')}</div>
      )}
      <div className="flex gap-2">
        {!formOnly && (
          <button type="button" className="rounded-[8px] bg-[var(--color-ink)] px-3 py-1 text-[var(--color-canvas)]" onClick={() => onResolve(interactionId, true)}>{t('chat.approval.approve')}</button>
        )}
        <button type="button" className="rounded-[8px] border border-[var(--color-line-2)] px-3 py-1 text-[var(--color-ink)]" onClick={() => onResolve(interactionId, false)}>{t('chat.approval.reject')}</button>
      </div>
    </div>
  );
}
