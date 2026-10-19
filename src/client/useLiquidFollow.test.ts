import { expect, test } from 'vitest';
import { DENT_MIN, recoilAt } from './useLiquidFollow';

// 脱手回弹的曲线:easeOutBack 是 0→1 的**进度**,这里要的是「还剩多少形变」。
// 曾直接把进度当剩余量,形变在脱手瞬间归零、根本没有回弹过程 —— 肉眼只觉得「怎么一下就没了」。
test('回弹从脱手时的满形变出发,不是一上来就归零', () => {
  expect(recoilAt(0)).toBeCloseTo(1, 6);
});

test('回弹末尾归零', () => {
  expect(recoilAt(1)).toBeCloseTo(0, 6);
});

test('前段单调收回', () => {
  const seq = [0, 0.1, 0.2, 0.3, 0.4].map(recoilAt);
  for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeLessThan(seq[i - 1]);
});

test('途中冲过零点形成反向内凹,且不深于下限', () => {
  const samples = Array.from({ length: 60 }, (_, i) => recoilAt(i / 59));
  const min = Math.min(...samples);
  expect(min).toBeLessThan(0); // 有内凹
  expect(min).toBeGreaterThanOrEqual(DENT_MIN); // 不深于下限,免得把轮廓吸穿边栏
});
