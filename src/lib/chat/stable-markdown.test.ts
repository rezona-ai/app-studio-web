import { describe, expect, test } from 'vitest';
import { findStableBoundary } from './stable-markdown';

// 便捷断言:head/tail 切分
function split(text: string, from = 0) {
  const b = findStableBoundary(text, from);
  return { head: text.slice(0, b), tail: text.slice(b) };
}

describe('findStableBoundary(流式 markdown 稳定前缀边界)', () => {
  test('两个完整段落 + 增长中的第三段:边界在最后一个段界', () => {
    const { head, tail } = split('段一。\n\n段二。\n\n第三段还在长');
    expect(head).toBe('段一。\n\n段二。\n\n');
    expect(tail).toBe('第三段还在长');
  });

  test('无段界:全部在 tail(边界为 0)', () => {
    expect(findStableBoundary('单段落还没写完')).toBe(0);
  });

  test('围栏代码块内的空行不算边界', () => {
    const text = '说明:\n\n```js\nconst a = 1;\n\nconst b = 2;\n';
    const { head, tail } = split(text);
    expect(head).toBe('说明:\n\n');
    expect(tail.startsWith('```js')).toBe(true);
  });

  test('围栏闭合后的空行是合法边界', () => {
    const text = '```js\ncode\n```\n\n后续段落';
    const { head, tail } = split(text);
    expect(head).toBe('```js\ncode\n```\n\n');
    expect(tail).toBe('后续段落');
  });

  test('松散列表项之间的空行不切(前后都是列表项)', () => {
    const text = '- 项一\n\n- 项二\n\n- 项三还在长';
    expect(findStableBoundary(text)).toBe(0);
  });

  test('段落后开始一个新列表:段界可切,列表整体进 tail', () => {
    const text = '介绍段。\n\n1. 第一步\n2. 第二步';
    const { head, tail } = split(text);
    expect(head).toBe('介绍段。\n\n');
    expect(tail).toBe('1. 第一步\n2. 第二步');
  });

  test('列表项后接缩进续行:不在其间切', () => {
    const text = '- 项一\n\n  项一的续行段';
    expect(findStableBoundary(text)).toBe(0);
  });

  test('列表结束后的普通段落:可在列表后切', () => {
    const text = '- 项一\n- 项二\n\n总结段。\n\n还在长';
    const { head } = split(text);
    expect(head).toBe('- 项一\n- 项二\n\n总结段。\n\n');
  });

  test('尾随空行:边界可到文本末尾(tail 为空)', () => {
    const text = '完整段。\n\n';
    expect(findStableBoundary(text)).toBe(text.length);
  });

  test('from 增量续扫与全量扫描结果一致', () => {
    const text = '段一。\n\n段二。\n\n段三。\n\n还在长';
    const first = findStableBoundary('段一。\n\n段二。');
    expect(findStableBoundary(text, first)).toBe(findStableBoundary(text));
  });
});
