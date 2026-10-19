// unified diff 文本 → 既有 FileDiff(DiffView 直接复用)。
// Claude backend 的 diff 来自 CLI 的结构化 structuredPatch(见 parseFileDiff);
// Codex 的 fileChange item 给的是 unified diff 文本,故需要这一层归一。
// 纯函数、防御式:解析不出 hunk 一律返回 null(卡片退化为只显文件名,不崩)。
import type { DiffHunk, DiffLine, FileDiff } from './protocol';

const HUNK_HEADER = /^@@\s/;

// kind: Codex 的变更类型(add / update / delete 等);缺省时按「是否全为增行」启发式判 create
export function parseUnifiedDiff(diff: unknown, filePath: string, kind?: string): FileDiff | null {
  if (typeof diff !== 'string' || !diff || !filePath) return null;
  const hunks: DiffHunk[] = [];
  let lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const raw of diff.split('\n')) {
    if (HUNK_HEADER.test(raw)) {
      if (lines.length) hunks.push({ lines });
      lines = [];
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;                        // hunk 头之前的 git header(diff --git / index / --- / +++)一律跳过
    if (raw.startsWith('\\')) continue;           // 「\ No newline at end of file」非内容行
    const c = raw[0];
    if (c === '+') { lines.push({ kind: 'add', text: raw.slice(1) }); additions++; }
    else if (c === '-') { lines.push({ kind: 'del', text: raw.slice(1) }); deletions++; }
    else if (c === ' ') lines.push({ kind: 'context', text: raw.slice(1) });
    else if (raw === '') lines.push({ kind: 'context', text: '' });   // 空行 = 空上下文行(部分实现省略前导空格)
    // 其余(如新的 'diff --git' 段起)当作 hunk 结束的噪声行,跳过
  }
  if (lines.length) hunks.push({ lines });
  if (!hunks.length) return null;
  const created = kind ? kind === 'add' || kind === 'create' : deletions === 0 && additions > 0;
  return { type: created ? 'create' : 'update', filePath, hunks, additions, deletions };
}
