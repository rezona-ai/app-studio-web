// 输入框高度换算:实际行数 = clamp(基准行数, 内容行数, 6)。度量常量须与 Composer 的 leading-6 / pt-1 保持一致。
export const MIN_LINES = 2;
export const MAX_LINES = 6;
export const LINE_HEIGHT = 24; // leading-6
export const PAD_TOP = 4; // pt-1

export function clampBaseLines(n: number): number {
  if (!Number.isFinite(n)) return MIN_LINES;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.round(n)));
}

export function contentLines(scrollHeight: number): number {
  return Math.max(1, Math.ceil((scrollHeight - PAD_TOP) / LINE_HEIGHT));
}

export function displayLines(baseLines: number, content: number): number {
  return Math.min(MAX_LINES, Math.max(clampBaseLines(baseLines), content));
}

export function boxHeight(lines: number): number {
  return lines * LINE_HEIGHT + PAD_TOP;
}
