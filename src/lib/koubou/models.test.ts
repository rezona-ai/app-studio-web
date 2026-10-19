import { describe, expect, test } from 'vitest';
import { modelLabel, modelMeta, resolveReadyModel, resolveSelectedModel } from './models';

describe('modelLabel', () => {
  test('claude-* 派生族名 + 点号版本', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(modelLabel('claude-fable-5')).toBe('Fable 5');
    expect(modelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6');
  });
  test('丢弃末尾日期戳', () => {
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
  });
  test('已知非 claude 模型取官方展示名', () => {
    expect(modelLabel('Rez1')).toBe('Rez1');
    expect(modelLabel('seed-2-0-code')).toBe('Seed 2.0 Code');
    expect(modelLabel('gpt-5.5')).toBe('GPT 5.5');
    expect(modelLabel('gpt-5.4')).toBe('GPT 5.4');
    expect(modelLabel('grok-4.5')).toBe('Grok 4.5');
    expect(modelLabel('gpt-5.6')).toBe('GPT 5.6');
    expect(modelLabel('kimi-k3')).toBe('Kimi K3');
    expect(modelLabel('glm-5.2')).toBe('GLM 5.2');
    expect(modelLabel('gpt-6-astra')).toBe('GPT 6 Astra');
  });
  test('gpt-* 未收录 ID 按前缀兜底:GPT <版本> <代号>,无代号只到版本', () => {
    expect(modelLabel('gpt-6-nova')).toBe('GPT 6 Nova');
    expect(modelLabel('gpt-6-nova-mini')).toBe('GPT 6 Nova Mini');
    expect(modelLabel('gpt-6.1-nova')).toBe('GPT 6.1 Nova');
    expect(modelLabel('gpt-6.1.2')).toBe('GPT 6.1.2');
    expect(modelLabel('gpt-6')).toBe('GPT 6');
  });
  test('未知模型 / 空串原样回退(gpt- 后非版本段不兜底)', () => {
    expect(modelLabel('gpt-image-2')).toBe('gpt-image-2');
    expect(modelLabel('gpt-4o')).toBe('gpt-4o');
    expect(modelLabel('gpt-6o-mini')).toBe('gpt-6o-mini');
    expect(modelLabel('gpt-')).toBe('gpt-');
    expect(modelLabel('')).toBe('');
  });
});

describe('modelMeta', () => {
  test('claude-* 按族解析,brand=claude,desc=族名', () => {
    expect(modelMeta('claude-fable-5')).toEqual({ brand: 'claude', desc: 'fable' });
    expect(modelMeta('claude-opus-4-8')).toEqual({ brand: 'claude', desc: 'opus' });
    expect(modelMeta('claude-sonnet-4-6')).toEqual({ brand: 'claude', desc: 'sonnet' });
    expect(modelMeta('claude-haiku-4-5-20251001')).toEqual({ brand: 'claude', desc: 'haiku' });
  });
  test('已知非 claude 模型按 ID 精确匹配', () => {
    expect(modelMeta('Rez1')).toEqual({ brand: 'rezona', desc: 'rez1' });
    expect(modelMeta('seed-2-0-code')).toEqual({ brand: 'seed', desc: 'seedCode' });
    expect(modelMeta('gpt-5.5')).toEqual({ brand: 'openai', desc: 'gpt55' });
    expect(modelMeta('gpt-5.4')).toEqual({ brand: 'openai', desc: 'gpt54' });
    expect(modelMeta('grok-4.5')).toEqual({ brand: 'grok', desc: 'grok45' });
    expect(modelMeta('gpt-5.6')).toEqual({ brand: 'openai', desc: 'gpt56' });
    expect(modelMeta('kimi-k3')).toEqual({ brand: 'kimi', desc: 'kimiK3' });
    expect(modelMeta('glm-5.2')).toEqual({ brand: 'glm', desc: 'glm52' });
    expect(modelMeta('gpt-6-astra')).toEqual({ brand: 'openai', desc: 'gpt6' });
  });
  test('gpt-* 未收录 ID 按前缀兜底 brand=openai,无 desc', () => {
    expect(modelMeta('gpt-6-nova')).toEqual({ brand: 'openai' });
    expect(modelMeta('gpt-6')).toEqual({ brand: 'openai' });
  });
  test('未知族 / 未知模型 / 空串返回 null', () => {
    expect(modelMeta('claude-unknown-1')).toBeNull();
    expect(modelMeta('gpt-')).toBeNull();
    expect(modelMeta('gpt-4o')).toBeNull();
    expect(modelMeta('gpt-image-2')).toBeNull();
    expect(modelMeta('')).toBeNull();
  });
});

describe('resolveSelectedModel', () => {
  test('无选择取首项', () => {
    expect(resolveSelectedModel(['claude-opus-4-8', 'claude-fable-5'], null)).toBe('claude-opus-4-8');
  });
  test('已选且在列表则保留', () => {
    expect(resolveSelectedModel(['a', 'b'], 'b')).toBe('b');
  });
  test('已选不在列表回落首项', () => {
    expect(resolveSelectedModel(['a', 'b'], 'gone')).toBe('a');
  });
  test('空列表为 null', () => {
    expect(resolveSelectedModel([], 'a')).toBeNull();
  });
});

// 会话落库模型 → 选择器的判定(spec 2026-09-11-session-model-adopt-design)。
// 可用列表 readyAvailable 优先、storeAvailable 兜底 —— 建连只等 currentProjectId,
// 而 /models 是独立 effect,常常后到,判定不能依赖那个时序。
describe('resolveReadyModel', () => {
  test('会话模型在 ready 自带列表里 → adopt', () => {
    expect(resolveReadyModel('claude-fable-5', ['Rez1', 'claude-fable-5'], [])).toEqual({ kind: 'adopt', model: 'claude-fable-5' });
  });
  test('ready 未带列表 → 用 store 列表兜底判定', () => {
    expect(resolveReadyModel('claude-fable-5', undefined, ['Rez1', 'claude-fable-5'])).toEqual({ kind: 'adopt', model: 'claude-fable-5' });
  });
  test('两个列表都不含会话模型 → retired,fallback 是该列表首项', () => {
    expect(resolveReadyModel('claude-fable-5', ['Rez1'], ['Rez1'])).toEqual({ kind: 'retired', model: 'claude-fable-5', fallback: 'Rez1' });
  });
  // fallback 与判定同源:store 列表未就绪时也要给得出目标,否则补救动作静默丢失。
  // 用不含 Rez1 的 ready 列表,避开"档位未知优先 Rez1"那条保守规则,才测得出同源这件事
  test('ready 自带列表判出 retired 时,fallback 取 ready 那份的首项', () => {
    expect(resolveReadyModel('claude-opus-4-8', ['gpt-5.6', 'claude-opus-5'], ['Rez1']))
      .toEqual({ kind: 'retired', model: 'claude-opus-4-8', fallback: 'gpt-5.6' });
  });
  // 判不出就不猜:此时既不能 adopt(可能显示一个不在下拉里的值)也不能 retired(可能误切好会话)
  test('两个列表都空 → none', () => {
    expect(resolveReadyModel('claude-fable-5', undefined, [])).toEqual({ kind: 'none' });
    expect(resolveReadyModel('claude-fable-5', [], [])).toEqual({ kind: 'none' });
  });
  test('会话模型为空(后端让 CLI 自选)→ none,没有可回填的事实', () => {
    expect(resolveReadyModel(null, ['Rez1'], ['Rez1'])).toEqual({ kind: 'none' });
    expect(resolveReadyModel(undefined, ['Rez1'], ['Rez1'])).toEqual({ kind: 'none' });
    expect(resolveReadyModel('', ['Rez1'], ['Rez1'])).toEqual({ kind: 'none' });
  });
  // 与当前选中相同也返回 adopt:幂等由写入口(setSelectedModel)承担,纯函数不读 store
  test('会话模型即列表首项 → 仍是 adopt', () => {
    expect(resolveReadyModel('Rez1', ['Rez1', 'claude-fable-5'], [])).toEqual({ kind: 'adopt', model: 'Rez1' });
  });
});


