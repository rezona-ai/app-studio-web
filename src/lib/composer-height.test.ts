import { describe, it, expect } from 'vitest';
import { clampBaseLines, contentLines, displayLines, boxHeight, MIN_LINES, MAX_LINES } from './composer-height';

describe('composer-height', () => {
  it('clampBaseLines 夹取到 [2,6] 并取整', () => {
    expect(clampBaseLines(0)).toBe(2);
    expect(clampBaseLines(4.6)).toBe(5);
    expect(clampBaseLines(99)).toBe(6);
    expect(clampBaseLines(NaN)).toBe(2);
  });
  it('contentLines 由 scrollHeight 反推行数', () => {
    expect(contentLines(28)).toBe(1);   // 1*24+4
    expect(contentLines(52)).toBe(2);   // 2*24+4
    expect(contentLines(148)).toBe(6);
    expect(contentLines(0)).toBe(1);    // 异常值兜底最小 1
  });
  it('displayLines = clamp(base, content, 6) 且 ≥2', () => {
    expect(displayLines(2, 1)).toBe(2);   // 内容少保持基准
    expect(displayLines(4, 1)).toBe(4);   // 拖高后作下限
    expect(displayLines(2, 5)).toBe(5);   // auto-grow
    expect(displayLines(2, 9)).toBe(6);   // 封顶
    expect(displayLines(6, 9)).toBe(6);
  });
  it('boxHeight 行数换像素', () => {
    expect(boxHeight(MIN_LINES)).toBe(52);
    expect(boxHeight(MAX_LINES)).toBe(148);
  });
});
