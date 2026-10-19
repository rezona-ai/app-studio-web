import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from './index';
import { createInitialKoubouState, createInitialServerState } from './types';

const draft = () => useStore.getState().composer.draft;

beforeEach(() => {
  useStore.setState({
    ...createInitialKoubouState(),
    ...createInitialServerState(),
    composer: { draft: '', attachments: [], baseLines: 2 },
  } as never);
});

describe('addRefs 批量 @ 引用', () => {
  test('空草稿插三个 → 依次出现,格式与单个 addRef 一致', () => {
    useStore.getState().addRefs(['char-1', 'char-2', 'bgm-1']);
    expect(draft()).toBe('@char-1 @char-2 @bgm-1 ');
  });

  test('与逐个 addRef 的结果逐字节相同(只是少了 N-1 次 set)', () => {
    useStore.getState().addRefs(['a', 'b', 'c']);
    const batched = draft();

    useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 } } as never);
    for (const k of ['a', 'b', 'c']) useStore.getState().addRef(k);
    expect(draft()).toBe(batched);
  });

  test('已有草稿文字后追加,不吞原文', () => {
    useStore.setState({ composer: { draft: '看这几张', attachments: [], baseLines: 2 } } as never);
    useStore.getState().addRefs(['a', 'b']);
    expect(draft()).toBe('看这几张 @a @b ');
  });

  // 本任务的核心价值:N 张卡不该触发 N 轮 set + 重渲
  test('只触发一次 store 变更', () => {
    let updates = 0;
    const unsub = useStore.subscribe(() => { updates += 1; });
    useStore.getState().addRefs(['a', 'b', 'c', 'd', 'e']);
    unsub();
    expect(updates).toBe(1);
  });

  test('对照:逐个 addRef 五次会触发五轮', () => {
    let updates = 0;
    const unsub = useStore.subscribe(() => { updates += 1; });
    for (const k of ['a', 'b', 'c', 'd', 'e']) useStore.getState().addRef(k);
    unsub();
    expect(updates).toBe(5);
  });

  test('空数组 no-op:草稿一字不动,也不多出空格', () => {
    useStore.setState({ composer: { draft: '原文', attachments: [], baseLines: 2 } } as never);
    useStore.getState().addRefs([]);
    expect(draft()).toBe('原文');
  });

  test('单个 key 与 addRef 等价', () => {
    useStore.getState().addRefs(['solo']);
    expect(draft()).toBe('@solo ');
  });
});
