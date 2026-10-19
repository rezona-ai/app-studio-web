import type { QuestionDef } from '@/koubou/protocol';

// 把问答卡片的选择渲染成一条用户消息文本(提交时乐观插入的用户气泡用)。
// 单问题:直接是所选 label(多选用、连接);多问题:每行「header(无则用 question)：所选 label」,换行连接。
// 选项为空的问题被过滤,不产出空行。
export function formatQuestionAnswer(
  questions: QuestionDef[],
  answers: Record<string, string | string[]>,
): string {
  const lines = questions.map((q) => {
    const raw = answers[q.question];
    const labels = (Array.isArray(raw) ? raw : raw ? [raw] : []).join('、');
    if (!labels) return '';
    if (questions.length === 1) return labels;
    return `${q.header || q.question}：${labels}`;
  });
  return lines.filter(Boolean).join('\n');
}
