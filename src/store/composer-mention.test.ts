import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';

beforeEach(() => useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 } }));

describe('store.addRef', () => {
  test('空草稿追加 @key(带尾随空格)', () => {
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('@k1 ');
  });

  test('已有草稿 → 补一个空格后追加', () => {
    useStore.setState({ composer: { draft: '看这张图', attachments: [], baseLines: 2 } });
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('看这张图 @k1 ');
  });

  test('草稿已以空格结尾 → 不重复补空格', () => {
    useStore.setState({ composer: { draft: '看这张图 ', attachments: [], baseLines: 2 } });
    useStore.getState().addRef('k1');
    expect(useStore.getState().composer.draft).toBe('看这张图 @k1 ');
  });
});

describe('store.removeRef', () => {
  test('移除唯一引用后草稿清空', () => {
    useStore.setState({ composer: { draft: '@k1', attachments: [], baseLines: 2 } });
    useStore.getState().removeRef('k1');
    expect(useStore.getState().composer.draft).toBe('');
  });

  test('仅移除匹配 key 的 token,保留其余正文', () => {
    useStore.setState({ composer: { draft: '看 @k1 这个 @k2 好看', attachments: [], baseLines: 2 } });
    useStore.getState().removeRef('k1');
    expect(useStore.getState().composer.draft).toBe('看 这个 @k2 好看');
  });
});

test('resetComposer 清空 draft 与 attachments', () => {
  useStore.setState({ composer: { draft: '@k1 你好', attachments: [{ id: 'a', name: 'x.png', mime: 'image/png', kind: 'image', status: 'ready' }], baseLines: 2 } });
  useStore.getState().resetComposer();
  expect(useStore.getState().composer).toEqual({ draft: '', attachments: [], baseLines: 2 });
});
