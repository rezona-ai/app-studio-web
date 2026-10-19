import { describe, it, expect } from 'vitest';
import { getActiveSkillToken, splitSkillTokens, filterSkills, skillPrefixes, type SkillDef } from './skills';

const def = (name: string, prefix = '/'): SkillDef => ({ name, invocation: `${prefix}${name}` });
const CC = [def('plan'), def('char-ref')];
const CODEX = [def('plan', '$'), def('char-ref', '$')];

describe('skillPrefixes', () => {
  it('由 invocation 首字符派生激活前缀', () => {
    expect(skillPrefixes(CC)).toEqual(['/']);
    expect(skillPrefixes(CODEX)).toEqual(['$']);
  });
  it('空列表无前缀(未加载时不激活弹窗)', () => {
    expect(skillPrefixes([])).toEqual([]);
  });
});

describe('getActiveSkillToken', () => {
  it('串首前缀激活,query 为其后片段', () => {
    expect(getActiveSkillToken('/pl', 3, ['/'])).toEqual({ query: 'pl', start: 0, prefix: '/' });
  });
  it('codex 的 $ 前缀同构激活', () => {
    expect(getActiveSkillToken('$pl', 3, ['$'])).toEqual({ query: 'pl', start: 0, prefix: '$' });
    expect(getActiveSkillToken('/pl', 3, ['$'])).toBeNull();   // 前缀不匹配当前 backend
  });
  it('空白后的前缀激活(任意位置)', () => {
    expect(getActiveSkillToken('fix it /cu', 10, ['/'])).toEqual({ query: 'cu', start: 7, prefix: '/' });
    expect(getActiveSkillToken('fix it $cu', 10, ['$'])).toEqual({ query: 'cu', start: 7, prefix: '$' });
  });
  it('换行后的前缀激活', () => {
    expect(getActiveSkillToken('a\n/p', 4, ['/'])).toEqual({ query: 'p', start: 2, prefix: '/' });
  });
  it('词中前缀不激活(如 URL 的 // 与金额 US$9)', () => {
    expect(getActiveSkillToken('http://x', 8, ['/'])).toBeNull();
    expect(getActiveSkillToken('US$9', 4, ['$'])).toBeNull();
  });
  it('前缀与光标间含空白则关闭', () => {
    expect(getActiveSkillToken('/plan go', 8, ['/'])).toBeNull();
  });
  it('无前缀字符 / 无可用前缀返回 null', () => {
    expect(getActiveSkillToken('hello', 5, ['/'])).toBeNull();
    expect(getActiveSkillToken('/plan', 5, [])).toBeNull();
  });
  it('只看光标前文本', () => {
    expect(getActiveSkillToken('ab /cd', 2, ['/'])).toBeNull();
  });
});

describe('splitSkillTokens', () => {
  it('切出词首的已知 skill token', () => {
    expect(splitSkillTokens('/plan do it', CC)).toEqual([
      { kind: 'skill', text: '/plan' },
      { kind: 'plain', text: ' do it' },
    ]);
  });
  it('codex 的 $token 同构切分', () => {
    expect(splitSkillTokens('$plan do it', CODEX)).toEqual([
      { kind: 'skill', text: '$plan' },
      { kind: 'plain', text: ' do it' },
    ]);
  });
  it('多 token 与中段 token', () => {
    expect(splitSkillTokens('a /plan b /char-ref', CC)).toEqual([
      { kind: 'plain', text: 'a ' },
      { kind: 'skill', text: '/plan' },
      { kind: 'plain', text: ' b ' },
      { kind: 'skill', text: '/char-ref' },
    ]);
  });
  it('未知 slug 不切分', () => {
    expect(splitSkillTokens('/nope x', CC)).toEqual([{ kind: 'plain', text: '/nope x' }]);
  });
  it('前缀不属当前 backend 时不切分', () => {
    expect(splitSkillTokens('/plan x', CODEX)).toEqual([{ kind: 'plain', text: '/plan x' }]);
  });
  it('词中前缀不切分', () => {
    expect(splitSkillTokens('http://plan', CC)).toEqual([{ kind: 'plain', text: 'http://plan' }]);
  });
  it('紧跟标点不算词尾边界,不切分', () => {
    expect(splitSkillTokens('/plan, go', CC)).toEqual([{ kind: 'plain', text: '/plan, go' }]);
  });
  it('空文本与空 skills', () => {
    expect(splitSkillTokens('', CC)).toEqual([]);
    expect(splitSkillTokens('/plan', [])).toEqual([{ kind: 'plain', text: '/plan' }]);
  });
});

describe('filterSkills', () => {
  const names: Record<string, string> = { plan: 'Game Design', cutout: 'Smart Cutout' };
  const resolve = (s: string) => names[s] ?? s;
  const list = [def('plan'), def('cutout')];
  it('name 与显示名都参与过滤(不区分大小写)', () => {
    expect(filterSkills(list, 'game', resolve)).toEqual([def('plan')]);
    expect(filterSkills(list, 'cut', resolve)).toEqual([def('cutout')]);
  });
  it('空 query 返回全量', () => {
    expect(filterSkills(list, '', resolve)).toEqual(list);
  });
});
