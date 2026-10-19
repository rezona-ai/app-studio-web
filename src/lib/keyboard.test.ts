import { describe, it, expect } from 'vitest';
import type { KeyboardEvent } from 'react';
import { isImeComposing } from './keyboard';

// 构造最小化的 React KeyboardEvent,只保留 isImeComposing 关心的字段
function evt(opts: { isComposing?: boolean; keyCode?: number }): KeyboardEvent {
  return {
    keyCode: opts.keyCode ?? 13,
    nativeEvent: { isComposing: opts.isComposing ?? false },
  } as unknown as KeyboardEvent;
}

describe('isImeComposing', () => {
  it('普通回车(非组合)不算 IME 组合', () => {
    expect(isImeComposing(evt({ isComposing: false, keyCode: 13 }))).toBe(false);
  });

  it('nativeEvent.isComposing 为 true 时算 IME 组合', () => {
    expect(isImeComposing(evt({ isComposing: true }))).toBe(true);
  });

  it('keyCode 为 229 时算 IME 组合(旧版浏览器/输入法兜底)', () => {
    expect(isImeComposing(evt({ isComposing: false, keyCode: 229 }))).toBe(true);
  });
});
