import { describe, it, expect } from 'vitest';
import { KIND_ORDER, KIND_META } from './asset-kind';

describe('text 取代 doc', () => {
  it('KIND_ORDER 含 text 不含 doc', () => {
    expect(KIND_ORDER).toContain('text');
    expect(KIND_ORDER).not.toContain('doc' as never);
  });
  it('text 类型色为 --color-text', () => { expect(KIND_META.text.colorVar).toBe('var(--color-text)'); });
});
