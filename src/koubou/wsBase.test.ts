import { describe, expect, test } from 'vitest';
import { toWsBase } from './wsBase';

describe('toWsBase', () => {
  test('http 基址转 ws', () => {
    expect(toWsBase('http://8.233.87.67')).toBe('ws://8.233.87.67');
  });

  test('https 基址转 wss', () => {
    expect(toWsBase('https://example.com')).toBe('wss://example.com');
  });

  test('去掉末尾斜杠', () => {
    expect(toWsBase('http://host/')).toBe('ws://host');
  });
});

// 本地 Koubou 调试:NEXT_PUBLIC_KOUBOU_BASE_URL 覆盖时直连该地址(本地服务挂根路径,不拼网关前缀)
describe('resolveKoubouWsBase', () => {
  test('无覆盖:PGC 基址派生 + /game/koubou 前缀', async () => {
    const { resolveKoubouWsBase } = await import('./wsBase');
    expect(resolveKoubouWsBase(undefined, 'https://devlab.rezona.ai')).toBe('wss://devlab.rezona.ai/game/koubou');
  });

  test('覆盖为本地地址:http→ws 且不拼前缀', async () => {
    const { resolveKoubouWsBase } = await import('./wsBase');
    expect(resolveKoubouWsBase('http://127.0.0.1:8000', 'https://devlab.rezona.ai')).toBe('ws://127.0.0.1:8000');
  });

  test('覆盖为空串视同未设', async () => {
    const { resolveKoubouWsBase } = await import('./wsBase');
    expect(resolveKoubouWsBase('', 'https://devlab.rezona.ai')).toBe('wss://devlab.rezona.ai/game/koubou');
  });

  // 本地开发经本服务 WS 代理(会话亲和 cookie 由同源 upgrade 请求自动携带,见 server/koubou/ws-proxy)
  test('dev 代理源:拼 /dev-ws/koubou 前缀且 http→ws', async () => {
    const { resolveKoubouWsBase } = await import('./wsBase');
    expect(resolveKoubouWsBase(undefined, 'https://devlab.rezona.ai', 'http://localhost:3000'))
      .toBe('ws://localhost:3000/dev-ws/koubou');
  });

  test('本地 Koubou 直连覆盖优先于 dev 代理', async () => {
    const { resolveKoubouWsBase } = await import('./wsBase');
    expect(resolveKoubouWsBase('http://127.0.0.1:8000', 'https://devlab.rezona.ai', 'http://localhost:3000'))
      .toBe('ws://127.0.0.1:8000');
  });
});
