import { describe, it, expect } from 'vitest';
import { BASE_PATH, apiPath, assetPath } from './basePath';

// 两个助手都只是给本服务自己的绝对路径补 basePath 前缀(本地 BASE_PATH 为空)。
describe('basePath 助手', () => {
  it('apiPath / assetPath 补前缀', () => {
    expect(apiPath('/api/pgc')).toBe(`${BASE_PATH}/api/pgc`);
    expect(assetPath('/games/a.png')).toBe(`${BASE_PATH}/games/a.png`);
  });
});
