import { describe, expect, test, it } from 'vitest';
import {
  getActiveMention,
  canMention,
  applyMentionTokens,
  applyMentionTokensForSend,
  resolveMentionRefs,
  insertMentionRef,
  removeMentionKey,
  splitMentionTokens,
  extractRefs,
  extractRefTokens,
  resolveRefSignature,
  type MentionAsset,
} from './refs';

describe('getActiveMention', () => {
  test('光标紧跟 @query 时返回 query 与起点', () => {
    const text = '把 @主角 调亮';
    const caret = 5; // 紧跟在 "@主角" 之后
    expect(getActiveMention(text, caret)).toEqual({ query: '主角', start: 2 });
  });
  test('@ 后到光标含空格则不激活', () => {
    expect(getActiveMention('@主 角', 4)).toBeNull();
  });
  test('无 @ 返回 null', () => {
    expect(getActiveMention('普通文本', 3)).toBeNull();
  });
  test('空 query(刚敲 @)也激活', () => {
    expect(getActiveMention('hi @', 4)).toEqual({ query: '', start: 3 });
  });
});

// 测试用最小资产集:char-1 就绪且有 url(可提及);clip-1 就绪且有 url(video);
// pending-1 生成中(不可提及);nosrc-1 就绪但无 preview(不可提及)
const ASSETS: MentionAsset[] = [
  { key: 'char-1', kind: 'image', status: 'ready', preview: { src: 'https://cdn/p/char-1.png' } },
  { key: 'clip-1', kind: 'video', status: 'ready', preview: { src: 'https://cdn/p/clip-1.mp4' } },
  { key: 'pending-1', kind: 'image', status: 'generating', preview: { src: 'https://cdn/p/pending.png' } },
  { key: 'nosrc-1', kind: 'image', status: 'ready' },
];

describe('canMention', () => {
  test('就绪且有 preview.src → 可提及', () => {
    expect(canMention(ASSETS[0])).toBe(true);
  });
  test('未就绪(生成中)→ 不可提及', () => {
    expect(canMention(ASSETS[2])).toBe(false);
  });
  test('就绪但无 preview → 不可提及', () => {
    expect(canMention(ASSETS[3])).toBe(false);
  });
});

describe('applyMentionTokens', () => {
  test('image 资产 → @[image]<url>', () => {
    expect(applyMentionTokens('改 @char-1 更红', ASSETS)).toBe('改 @[image]<https://cdn/p/char-1.png> 更红');
  });
  test('video 资产 → @[video]<url>', () => {
    expect(applyMentionTokens('配这段 @clip-1', ASSETS)).toBe('配这段 @[video]<https://cdn/p/clip-1.mp4>');
  });
  test('3d kind 映射为 model3d,text kind 映射为 document', () => {
    const assets: MentionAsset[] = [
      { key: 'tree-1', kind: '3d', status: 'ready', preview: { src: 'https://cdn/p/tree.glb' } },
      { key: 'spec-1', kind: 'text', status: 'ready', preview: { src: 'https://cdn/p/spec.pdf' } },
    ];
    expect(applyMentionTokens('@tree-1 @spec-1', assets)).toBe(
      '@[model3d]<https://cdn/p/tree.glb> @[document]<https://cdn/p/spec.pdf>',
    );
  });
  test('未就绪资产的 @key 原样保留(不替换)', () => {
    expect(applyMentionTokens('用 @pending-1 做参考', ASSETS)).toBe('用 @pending-1 做参考');
  });
  test('无 preview 资产的 @key 原样保留(不替换)', () => {
    expect(applyMentionTokens('用 @nosrc-1 做参考', ASSETS)).toBe('用 @nosrc-1 做参考');
  });
  test('未知 @token 原样保留(不误伤邮箱)', () => {
    expect(applyMentionTokens('联系 nick@rezona.ai', ASSETS)).toBe('联系 nick@rezona.ai');
  });
  test('同一文本多个引用按位置原位替换,顺序与其余文本保持不变', () => {
    expect(applyMentionTokens('用 @char-1 配 @clip-1 的节奏', ASSETS)).toBe(
      '用 @[image]<https://cdn/p/char-1.png> 配 @[video]<https://cdn/p/clip-1.mp4> 的节奏',
    );
  });
});

describe('resolveMentionRefs', () => {
  test('单个 @key 命中 → 返回该 key', () => {
    expect(resolveMentionRefs('改 @char-1 更红', ASSETS)).toEqual(['char-1']);
  });
  test('多个不同 @key → 按出现顺序返回', () => {
    expect(resolveMentionRefs('@clip-1 配 @char-1', ASSETS)).toEqual(['clip-1', 'char-1']);
  });
  test('同一 @key 重复出现 → 去重只算一次', () => {
    expect(resolveMentionRefs('@char-1 和 @char-1', ASSETS)).toEqual(['char-1']);
  });
  test('未就绪 / 无 preview 的资产不计入', () => {
    expect(resolveMentionRefs('@pending-1 @nosrc-1 @char-1', ASSETS)).toEqual(['char-1']);
  });
  test('未知 @token 不计入', () => {
    expect(resolveMentionRefs('联系 nick@rezona.ai', ASSETS)).toEqual([]);
  });
  test('无引用 → 空数组', () => {
    expect(resolveMentionRefs('纯文本', ASSETS)).toEqual([]);
  });
});

describe('insertMentionRef', () => {
  test('空草稿 → @key 加尾随空格', () => {
    expect(insertMentionRef('', 'char-1')).toBe('@char-1 ');
  });
  test('非空且不以空格结尾 → 补一个空格再追加', () => {
    expect(insertMentionRef('看这张图', 'char-1')).toBe('看这张图 @char-1 ');
  });
  test('已以空格结尾 → 不重复补空格', () => {
    expect(insertMentionRef('看这张图 ', 'char-1')).toBe('看这张图 @char-1 ');
  });
});

describe('removeMentionKey', () => {
  test('唯一引用移除后草稿清空', () => {
    expect(removeMentionKey('@char-1', 'char-1')).toBe('');
  });
  test('仅移除匹配 key 的 token,保留其余正文与其它引用', () => {
    expect(removeMentionKey('看 @char-1 这个 @clip-1 好看', 'char-1')).toBe('看 这个 @clip-1 好看');
  });
  test('前缀相同的其它 key 不受影响(如移除 img-1 不误伤 img-10)', () => {
    expect(removeMentionKey('@img-1 和 @img-10', 'img-1')).toBe('和 @img-10');
  });
  test('key 含正则特殊字符(如文件名)也能正确移除', () => {
    expect(removeMentionKey('看 @sky.v1.png 这张', 'sky.v1.png')).toBe('看 这张');
  });
});

describe('splitMentionTokens', () => {
  test('命中已知 key → 切出 mention 片段', () => {
    expect(splitMentionTokens('改 @char-1 更红', ['char-1'])).toEqual([
      { kind: 'plain', text: '改 ' },
      { kind: 'mention', text: '@char-1' },
      { kind: 'plain', text: ' 更红' },
    ]);
  });
  test('未知 token 不切分,整体作 plain', () => {
    expect(splitMentionTokens('联系 nick@rezona.ai', ['char-1'])).toEqual([
      { kind: 'plain', text: '联系 nick@rezona.ai' },
    ]);
  });
  test('无已知 key → 整体作 plain', () => {
    expect(splitMentionTokens('随便文本', [])).toEqual([{ kind: 'plain', text: '随便文本' }]);
  });
  test('空文本 → 空数组', () => {
    expect(splitMentionTokens('', ['char-1'])).toEqual([]);
  });
});

describe('extractRefs', () => {
  const refAssets = ASSETS.map((a) => ({ key: a.key, preview: a.preview }));

  test('新格式 @[type]<url> 命中资产 → 剥离并回填 key', () => {
    const r = extractRefs('让 @[image]<https://cdn/p/char-1.png> 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('新格式 url 反查不到(对话附件/已删资产)→ 剥离并产出游离 chip(kind+文件名)', () => {
    const r = extractRefs('参考 @[image]<https://cdn/p/gone.png> 这个', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('参考 这个');
    expect(r.chips).toEqual([{ kind: 'image', url: 'https://cdn/p/gone.png', name: 'gone.png' }]);
  });
  test('游离 chip:document→text kind、model3d→3d;未知 type 原样保留不剥', () => {
    const r = extractRefs('@[document]<https://cdn/f/spec.pdf> @[model3d]<https://cdn/f/a.glb> @[foo]<https://x/y>', refAssets);
    expect(r.text).toBe('@[foo]<https://x/y>');
    expect(r.chips).toEqual([
      { kind: 'text', url: 'https://cdn/f/spec.pdf', name: 'spec.pdf' },
      { kind: '3d', url: 'https://cdn/f/a.glb', name: 'a.glb' },
    ]);
  });
  test('兼容历史 @url', () => {
    const r = extractRefs('让 @https://cdn/p/char-1.png 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('兼容历史 @key', () => {
    const r = extractRefs('让 @char-1 更红', refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('让 更红');
  });
  test('未知 @token 原样保留(不误伤邮箱)', () => {
    const r = extractRefs('联系 nick@rezona.ai', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('联系 nick@rezona.ai');
  });
  test('多个引用去重保序', () => {
    const r = extractRefs('@[image]<https://cdn/p/char-1.png> @clip-1 @[image]<https://cdn/p/char-1.png> 文本', refAssets);
    expect(r.keys).toEqual(['char-1', 'clip-1']);
    expect(r.text).toBe('文本');
  });
  test('无引用时原样返回', () => {
    const r = extractRefs('纯文本', refAssets);
    expect(r.keys).toEqual([]);
    expect(r.text).toBe('纯文本');
  });
  test('round-trip:applyMentionTokens 产出的新格式 token 能被 extractRefs 解析回 key', () => {
    const token = applyMentionTokens('@char-1', ASSETS);
    const r = extractRefs(`改 ${token}`, refAssets);
    expect(r.keys).toEqual(['char-1']);
    expect(r.text).toBe('改');
  });
});

describe('text 节点内联发送', () => {
  const textAsset = { key: 'note1', kind: 'text' as const, status: 'ready' as const, label: '关卡设计', preview: { text: '# 内容' } };
  const srcOnly = { key: 'doc2', kind: 'text' as const, status: 'ready' as const, preview: { src: 'https://x/d.pdf' } };
  const img = { key: 'img1', kind: 'image' as const, status: 'ready' as const, preview: { src: 'https://x/i.png' } };

  it('canMention: text 有 preview.text 即可提及;无 src 无 text 不可', () => {
    expect(canMention(textAsset)).toBe(true);
    expect(canMention({ ...textAsset, preview: {} })).toBe(false);
  });

  it('applyMentionTokensForSend: text+content → attachment 标签,name 用 label', () => {
    expect(applyMentionTokensForSend('看 @note1 的设定', [textAsset]))
      .toBe('看 <attachment name="关卡设计"># 内容</attachment> 的设定');
  });

  it('applyMentionTokensForSend: 仅 src 的 text → @[document]<url>;image → @[image]<url>', () => {
    expect(applyMentionTokensForSend('@doc2 @img1', [srcOnly, img]))
      .toBe('@[document]<https://x/d.pdf> @[image]<https://x/i.png>');
  });

  it('applyMentionTokens(气泡): 无 src 的 text 原样保留 @key,不崩', () => {
    expect(applyMentionTokens('看 @note1', [textAsset])).toBe('看 @note1');
  });

  it('extractRefs: 剥离 attachment 块;name 命中 label 回填 key', () => {
    const { keys, text } = extractRefs('前文 <attachment name="关卡设计"># 内容</attachment> 后文',
      [{ key: 'note1', label: '关卡设计' }]);
    expect(keys).toEqual(['note1']);
    expect(text).toBe('前文 后文');
  });

  it('extractRefs: name 未命中也剥离标签,产出 text kind 游离 chip(对话附件不在画布)', () => {
    const { keys, text, chips } = extractRefs('a <attachment name="x">y</attachment> b', []);
    expect(keys).toEqual([]);
    expect(text).toBe('a b');
    expect(chips).toEqual([{ kind: 'text', name: 'x' }]);
  });
});

// —— A1:token 化与解析签名(供 MessageItem 窄订阅,避免整表订阅 assets) ——
describe('extractRefTokens(纯文本 token 化,不做资产反查)', () => {
  test('无 token 文本 → 空数组;@词按 plain 提取', () => {
    expect(extractRefTokens('没有任何标记')).toEqual([]);
    expect(extractRefTokens('邮箱 a@b 情形')).toEqual([{ form: 'plain', value: 'b' }]);
  });

  test('三种形态依次提取:attachment 名 / mention url / plain token', () => {
    const text = '看 <attachment name="notes.md">内容</attachment> 和 @[image]<https://cdn/a.png> 以及 @char-1';
    expect(extractRefTokens(text)).toEqual([
      { form: 'attachment', value: 'notes.md' },
      { form: 'mention', value: 'https://cdn/a.png' },
      { form: 'plain', value: 'char-1' },
    ]);
  });
});

describe('resolveRefSignature(解析结果签名,签名不变则消息卡不重渲)', () => {
  const assets = [
    { key: 'char-1', label: '主角', preview: { src: 'https://cdn/a.png' } },
    { key: 'doc-1', label: 'notes.md' },
  ];

  test('按形态解析:attachment 按 label,mention 按 src,plain 按 key/src', () => {
    const tokens = extractRefTokens('<attachment name="notes.md">x</attachment> @[image]<https://cdn/a.png> @char-1');
    const sig = resolveRefSignature(tokens, assets);
    expect(sig).toContain('doc-1');
    expect(sig).toContain('char-1');
    // 三个 token 全部解析到 → 换任意无关资产集合签名不变
    expect(resolveRefSignature(tokens, [...assets, { key: 'other' }])).toBe(sig);
  });

  test('反查不到 → 签名区别于命中;资产出现后签名变化', () => {
    const tokens = extractRefTokens('@ghost');
    const missing = resolveRefSignature(tokens, assets);
    const found = resolveRefSignature(tokens, [...assets, { key: 'ghost' }]);
    expect(missing).not.toBe(found);
  });

  test('与 extractRefs 同构:重复 label 后者覆盖(last-wins)', () => {
    const tokens = extractRefTokens('<attachment name="同名">x</attachment>');
    const dup = [{ key: 'a1', label: '同名' }, { key: 'a2', label: '同名' }];
    expect(resolveRefSignature(tokens, dup)).toBe(resolveRefSignature(tokens, [{ key: 'a2', label: '同名' }]));
    expect(resolveRefSignature(tokens, dup)).not.toBe(resolveRefSignature(tokens, [{ key: 'a1', label: '同名' }]));
  });

  test('无 token → 恒返回空串(选择器恒等,零重渲)', () => {
    expect(resolveRefSignature([], assets)).toBe('');
  });
});
