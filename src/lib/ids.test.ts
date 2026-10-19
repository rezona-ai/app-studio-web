import { describe, expect, test } from 'vitest';
import { isPlaceholderId, newPlaceholderId } from './ids';

describe('占位卡 id', () => {
  test('造出来的 id 能被判定为占位卡', () => {
    expect(isPlaceholderId(newPlaceholderId())).toBe(true);
  });

  test('真 id(后端 uuid 风格)不认', () => {
    expect(isPlaceholderId('img-8f2a1c9b3d4e')).toBe(false);
    expect(isPlaceholderId('pendingx_abc')).toBe(false);
  });
});
