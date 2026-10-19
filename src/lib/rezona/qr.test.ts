import { expect, test } from 'vitest';
import { qrSvg } from './qr';

test('qrSvg:返回正方形模块数与非空 path,同输入幂等', () => {
  const a = qrSvg('https://www.rezona.ai/download');
  expect(a.size).toBeGreaterThanOrEqual(21);           // QR 最小 version 1 = 21 模块
  expect(a.path.startsWith('M')).toBe(true);
  expect(a).toEqual(qrSvg('https://www.rezona.ai/download'));
});

test('qrSvg:不同内容产出不同矩阵', () => {
  expect(qrSvg('a').path).not.toBe(qrSvg('b').path);
});
