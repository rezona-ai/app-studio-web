import { describe, test, expect } from 'vitest';
import { filesFromClipboard } from './clipboard-assets';

// 造一个够用的 DataTransfer 替身:jsdom 的 DataTransfer 不支持塞 files/items,故按用到的字段构造
function fakeData(opts: {
  files?: File[];
  items?: { kind: string; getAsFile: () => File | null }[];
}): DataTransfer {
  return {
    files: (opts.files ?? []) as unknown as FileList,
    items: (opts.items ?? []) as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' });

describe('filesFromClipboard', () => {
  test('无 dataTransfer 返回空数组', () => {
    expect(filesFromClipboard(null)).toEqual([]);
  });

  test('files 非空时取 files', () => {
    const a = png('a.png');
    const b = png('b.png');
    const out = filesFromClipboard(fakeData({ files: [a, b] }));
    expect(out).toEqual([a, b]);
  });

  test('files 有内容时不再合并 items(防同一文件上传两次)', () => {
    const a = png('a.png');
    const dup = png('a.png');
    const out = filesFromClipboard(fakeData({ files: [a], items: [{ kind: 'file', getAsFile: () => dup }] }));
    expect(out).toEqual([a]);
  });

  test('files 为空时回落 items,跳过 string 项与取不到文件的项', () => {
    const a = png('a.png');
    const out = filesFromClipboard(
      fakeData({
        items: [
          { kind: 'string', getAsFile: () => null },
          { kind: 'file', getAsFile: () => a },
          { kind: 'file', getAsFile: () => null },
        ],
      }),
    );
    expect(out).toEqual([a]);
  });

  test('纯文本粘贴(只有 string 项)返回空数组', () => {
    const out = filesFromClipboard(fakeData({ items: [{ kind: 'string', getAsFile: () => null }] }));
    expect(out).toEqual([]);
  });

  test('文件名为空时按 MIME 补 pasted.<ext>,扩展名与类型保留', () => {
    const nameless = new File(['x'], '', { type: 'image/png' });
    const [out] = filesFromClipboard(fakeData({ files: [nameless] }));
    expect(out.name).toBe('pasted.png');
    expect(out.type).toBe('image/png');
  });

  test('jpeg 补名用 jpg;无 type 时只叫 pasted', () => {
    const jpeg = new File(['x'], '', { type: 'image/jpeg' });
    const unknown = new File(['x'], '', { type: '' });
    const out = filesFromClipboard(fakeData({ files: [jpeg, unknown] }));
    expect(out.map((f) => f.name)).toEqual(['pasted.jpg', 'pasted']);
  });

  test('已有文件名不改写', () => {
    const [out] = filesFromClipboard(fakeData({ files: [png('screenshot.png')] }));
    expect(out.name).toBe('screenshot.png');
  });
});
