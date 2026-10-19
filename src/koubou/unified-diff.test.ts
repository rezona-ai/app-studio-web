import { describe, expect, test } from 'vitest';
import { parseUnifiedDiff } from './unified-diff';

describe('parseUnifiedDiff', () => {
  test('解析单 hunk 的增删与上下文,统计 +N -M', () => {
    const diff = [
      '--- a/src/game.ts',
      '+++ b/src/game.ts',
      '@@ -1,3 +1,3 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      ' const c = 4;',
    ].join('\n');
    const d = parseUnifiedDiff(diff, 'src/game.ts');
    expect(d).toEqual({
      type: 'update',
      filePath: 'src/game.ts',
      additions: 1,
      deletions: 1,
      hunks: [{ lines: [
        { kind: 'context', text: 'const a = 1;' },
        { kind: 'del', text: 'const b = 2;' },
        { kind: 'add', text: 'const b = 3;' },
        { kind: 'context', text: 'const c = 4;' },
      ] }],
    });
  });

  test('多 hunk 分开保留', () => {
    const diff = '@@ -1,1 +1,1 @@\n-a\n+A\n@@ -9,1 +9,1 @@\n-b\n+B';
    const d = parseUnifiedDiff(diff, 'f.txt');
    expect(d?.hunks).toHaveLength(2);
    expect(d?.additions).toBe(2);
    expect(d?.deletions).toBe(2);
  });

  test('新建文件(全增行)归一为 create', () => {
    const d = parseUnifiedDiff('@@ -0,0 +1,2 @@\n+line1\n+line2', 'new.ts');
    expect(d?.type).toBe('create');
    expect(d?.additions).toBe(2);
    expect(d?.deletions).toBe(0);
  });

  test('kind 显式声明优先于启发式', () => {
    expect(parseUnifiedDiff('@@ -0,0 +1,1 @@\n+x', 'a.ts', 'update')?.type).toBe('update');
    expect(parseUnifiedDiff('@@ -1,1 +1,1 @@\n-x\n+y', 'a.ts', 'add')?.type).toBe('create');
  });

  test('跳过 no-newline 标记行与 git header,不当内容', () => {
    const diff = 'diff --git a/f b/f\nindex 111..222 100644\n@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file';
    const d = parseUnifiedDiff(diff, 'f');
    expect(d?.hunks[0].lines).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  test('无 hunk / 空串 / 非字符串 → null(卡片只显文件名,不崩)', () => {
    expect(parseUnifiedDiff('', 'f')).toBeNull();
    expect(parseUnifiedDiff('just some text', 'f')).toBeNull();
    expect(parseUnifiedDiff(undefined, 'f')).toBeNull();
    expect(parseUnifiedDiff('@@ -1,1 +1,1 @@', 'f')).toBeNull();   // hunk 头但无内容行
  });

  test('缺文件名 → null(diff 必须能落到某个文件)', () => {
    expect(parseUnifiedDiff('@@ -1,1 +1,1 @@\n-a\n+b', '')).toBeNull();
  });
});
