import { afterEach, describe, expect, test } from 'vitest';
import { readProjectIdFromSearch, withProjectParam, parseReplayTemplate, stripReplayTemplateFromUrl } from './project-url';

describe('readProjectIdFromSearch', () => {
  test('解析 public_id(纯字母)', () => {
    expect(readProjectIdFromSearch('?project=DakkYXUy')).toBe('DakkYXUy');
  });
  test('兼容旧数值链(opaque token)', () => {
    expect(readProjectIdFromSearch('?project=73')).toBe('73');
  });
  test('缺失参数返回 null', () => {
    expect(readProjectIdFromSearch('')).toBeNull();
    expect(readProjectIdFromSearch('?foo=1')).toBeNull();
  });
  test('非法值(含非字母数字字符)返回 null', () => {
    expect(readProjectIdFromSearch('?project=ab-cd')).toBeNull();
    expect(readProjectIdFromSearch('?project=1.5')).toBeNull();
    expect(readProjectIdFromSearch('?project=')).toBeNull();
  });
});

describe('withProjectParam', () => {
  test('空 search 写入参数', () => {
    expect(withProjectParam('', 'DakkYXUy')).toBe('?project=DakkYXUy');
  });
  test('更新已有参数并保留其他参数', () => {
    expect(withProjectParam('?foo=1&project=aaa', 'bbb')).toBe('?foo=1&project=bbb');
  });
  test('id 为 null 时移除参数;移除后无参数返回空串', () => {
    expect(withProjectParam('?project=aaa', null)).toBe('');
    expect(withProjectParam('?foo=1&project=aaa', null)).toBe('?foo=1');
  });
});

afterEach(() => window.history.replaceState(null, '', '/'));

test('parseReplayTemplate 读 replay_template', () => {
  expect(parseReplayTemplate('?replay_template=tpl_9')).toBe('tpl_9');
  expect(parseReplayTemplate('?project=p1')).toBeNull();
  expect(parseReplayTemplate('?replay_template=')).toBeNull();
});

test('stripReplayTemplateFromUrl 剥参保留 project', () => {
  window.history.replaceState(null, '', '/?project=p1&replay_template=tpl_9');
  stripReplayTemplateFromUrl();
  expect(window.location.search).toBe('?project=p1');
});
