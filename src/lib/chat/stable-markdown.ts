// 流式 markdown 的「稳定前缀」边界:返回 text 中已完成块的结束下标。
// head=text.slice(0, boundary) 交给 memo 的 Markdown 实例只解析一次;tail 每 tick 重解析但恒为当前块大小。
//
// 边界规则(保证 head/tail 分开解析与整体解析视觉一致):
// - 只在「围栏代码块外的空行」后切(CommonMark 块边界);
// - 列表连续性不切:空行前后都是列表语境(列表项 / ≥2 空格缩进续行)时,是同一个松散列表的项间距,
//   切开会拆散列表(松紧样式、编号连续性都会变),整个列表留在 tail 直到列表结束;
// - 其余块(段落/标题/引用/表格/围栏)以空行终结后即稳定,可切。

// 列表项行:- * + 或 1. / 1) 起头(≤3 前导空格,CommonMark 规格)
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
// 列表语境续行:≥2 空格缩进的非空行(列表项内容续行/嵌套/缩进代码)
const LIST_CONTINUATION = /^ {2,}\S/;
// 围栏开/闭行(``` 或 ~~~,≤3 前导空格)
const FENCE = /^ {0,3}(?:```|~~~)/;

const listish = (line: string) => LIST_MARKER.test(line) || LIST_CONTINUATION.test(line);

// from:上次返回的边界(增量续扫)。返回的边界恒在围栏外,故从旧边界续扫时围栏状态可安全归零。
export function findStableBoundary(text: string, from = 0): number {
  const n = text.length;
  let boundary = from;
  let inFence = false;
  let prevNonBlank = '';      // 空行 run 之前最近的非空行(判定列表连续性)
  let pending = -1;           // 空行 run 之后的候选边界(看到下一非空行才能判定安全性)
  let i = from;
  while (i <= n) {
    const nl = text.indexOf('\n', i);
    const end = nl === -1 ? n : nl;
    const line = text.slice(i, end);
    const isBlank = line.trim() === '';
    if (inFence) {
      if (FENCE.test(line)) {
        inFence = false;
        prevNonBlank = line;
      }
    } else if (isBlank) {
      // 候选边界 = 空行的下一行行首(空行归 head,head 的末块由此闭合);多空行 run 取最后一个
      if (nl !== -1) pending = end + 1;
    } else {
      if (pending !== -1) {
        // 列表连续性:前后都是列表语境 → 是同一松散列表的项间距,不切
        if (!(listish(prevNonBlank) && listish(line))) boundary = pending;
        pending = -1;
      }
      if (FENCE.test(line)) inFence = true;
      prevNonBlank = line;
    }
    if (nl === -1) break;
    i = nl + 1;
  }
  // 文本以空行收尾:tail 为空,候选直接生效
  if (pending !== -1 && !inFence) boundary = Math.max(boundary, Math.min(pending, n));
  return boundary;
}
