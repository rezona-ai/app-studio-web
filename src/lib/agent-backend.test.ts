import { describe, it, expect } from 'vitest';
import { normalizeBackend, resolveAgentBackend } from './agent-backend';

describe('normalizeBackend', () => {
  it('只放行词表内的值', () => {
    expect(normalizeBackend('cc')).toBe('cc');
    expect(normalizeBackend('codex')).toBe('codex');
  });

  it('词表外 / 非字符串一律视作无', () => {
    expect(normalizeBackend('single')).toBeNull();
    expect(normalizeBackend('CODEX')).toBeNull();
    expect(normalizeBackend('')).toBeNull();
    expect(normalizeBackend(null)).toBeNull();
    expect(normalizeBackend(42)).toBeNull();
  });
});

describe('resolveAgentBackend', () => {
  it('query 参数优先,并标记需要写回存储', () => {
    expect(resolveAgentBackend('?agent=codex', 'cc')).toEqual({ backend: 'codex', persist: true });
    expect(resolveAgentBackend('?foo=1&agent=cc', 'codex')).toEqual({ backend: 'cc', persist: true });
  });

  it('query 与存储同值时不必重复写回', () => {
    expect(resolveAgentBackend('?agent=codex', 'codex')).toEqual({ backend: 'codex', persist: false });
  });

  it('无 query 时读存储', () => {
    expect(resolveAgentBackend('', 'codex')).toEqual({ backend: 'codex', persist: false });
    expect(resolveAgentBackend('?other=1', 'codex')).toEqual({ backend: 'codex', persist: false });
  });

  it('query 非法值不生效,回落存储', () => {
    expect(resolveAgentBackend('?agent=single', 'codex')).toEqual({ backend: 'codex', persist: false });
  });

  it('query 与存储都缺失 / 非法时回落 cc', () => {
    expect(resolveAgentBackend('', null)).toEqual({ backend: 'cc', persist: false });
    expect(resolveAgentBackend('', 'bogus')).toEqual({ backend: 'cc', persist: false });
  });
});
