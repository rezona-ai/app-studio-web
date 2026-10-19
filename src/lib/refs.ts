import type { AssetKind } from './asset-kind';
import type { Status } from '@/store/types';

export interface ActiveMention { query: string; start: number; }

// 返回光标处正在输入的 @mention(从最近的 '@' 到光标,中间不含空白)
export function getActiveMention(text: string, caret: number): ActiveMention | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

// 可被 @提及的资产最小形状:status/preview 决定是否 eligible,kind 决定发送时的 mention type
export interface MentionAsset {
  key: string;
  kind: AssetKind;
  status: Status;
  label?: string;                              // 节点名称:内联 attachment 标签的 name
  preview?: { src?: string; text?: string };   // text=PGC content 内联内容(仅 text 资产)
}

// kind → 后端 mention type(严格限定、大小写敏感,契约见 koubou-agent-py mention-resource-interface.md)
export const MENTION_TYPE: Record<AssetKind, 'image' | 'video' | 'audio' | 'model3d' | 'document'> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  '3d': 'model3d',
  text: 'document',
};

// 资产是否可被 @提及:就绪且有后端 url;text 资产有内联内容(preview.text)时亦可(发送走内联)
export function canMention(asset: MentionAsset): boolean {
  if (asset.status !== 'ready') return false;
  return !!asset.preview?.src || (asset.kind === 'text' && !!asset.preview?.text);
}

// 内联附件标签:纯文本内容包裹后拼进 Koubou 正文;name 含双引号替换为单引号防破坏属性
export function attachmentTag(name: string, text: string): string {
  return `<attachment name="${name.replace(/"/g, "'")}">${text}</attachment>`;
}

// 气泡侧:@key → @[type]<url>;无 src(纯内联 text 资产)原样保留 @key(extractRefs 按 key 反查渲染 chip)
export function applyMentionTokens(text: string, assets: MentionAsset[]): string {
  const eligible = new Map<string, MentionAsset>();
  for (const a of assets) if (canMention(a)) eligible.set(a.key, a);
  return text.replace(/@(\S+)/g, (m, token: string) => {
    const a = eligible.get(token);
    if (!a?.preview?.src) return m;
    return `@[${MENTION_TYPE[a.kind]}]<${a.preview.src}>`;
  });
}

// Koubou 发送侧:text 资产有内联内容 → attachment 标签(agent 直读,无需工具取 url);
// 其余有 src → @[type]<url>;均无 → 原样保留
export function applyMentionTokensForSend(text: string, assets: MentionAsset[]): string {
  const eligible = new Map<string, MentionAsset>();
  for (const a of assets) if (canMention(a)) eligible.set(a.key, a);
  return text.replace(/@(\S+)/g, (m, token: string) => {
    const a = eligible.get(token);
    if (!a) return m;
    if (a.kind === 'text' && a.preview?.text) return attachmentTag(a.label ?? a.key, a.preview.text);
    if (a.preview?.src) return `@[${MENTION_TYPE[a.kind]}]<${a.preview.src}>`;
    return m;
  });
}

// 从草稿派生当前引用的资产 key 列表(按出现顺序去重),仅计入可提及资产——供 chip 展示与 send() 校验复用同一份逻辑
export function resolveMentionRefs(draft: string, assets: MentionAsset[]): string[] {
  const eligible = new Set(assets.filter(canMention).map((a) => a.key));
  const keys: string[] = [];
  const re = /@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(draft))) {
    if (eligible.has(m[1]) && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

// 画布右键「引用到对话」等非光标场景:把 @key 追加到草稿末尾(自动补分隔空格,不重复)
export function insertMentionRef(draft: string, key: string): string {
  const trimmed = draft.replace(/\s+$/, '');
  return trimmed ? `${trimmed} @${key} ` : `@${key} `;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// chip 移除按钮:从草稿中删掉该 key 对应的全部 @key token(词尾边界匹配,不误伤同前缀的其它 key)
export function removeMentionKey(draft: string, key: string): string {
  return draft
    .replace(new RegExp(`@${escapeRegExp(key)}(?=\\s|$)`, 'g'), '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export interface MentionSegment { kind: 'plain' | 'mention'; text: string; }

// 把草稿切成 plain/mention 片段供镜像层着色;仅命中已知(可提及)key 的 @key 记为 mention,与 skills.ts 的 splitSkillTokens 同构
export function splitMentionTokens(text: string, keys: string[]): MentionSegment[] {
  if (!text) return [];
  if (keys.length === 0) return [{ kind: 'plain', text }];
  const known = new Set(keys);
  const segs: MentionSegment[] = [];
  let last = 0;
  const re = /@(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!known.has(m[1])) continue;
    if (m.index > last) segs.push({ kind: 'plain', text: text.slice(last, m.index) });
    segs.push({ kind: 'mention', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: 'plain', text: text.slice(last) });
  return segs;
}

// 消息气泡剥离引用所需的最小资产形状
export interface RefAsset { key: string; label?: string; preview?: { src?: string }; }

// mention type → 内部 kind(MENTION_TYPE 的逆映射):历史重建时按 token 自造游离 chip 用
const MENTION_KIND: Record<string, AssetKind> = { image: 'image', video: 'video', audio: 'audio', model3d: '3d', document: 'text' };

// 游离 chip:token 反查不到画布资产(对话附件标记 chat_attachment 不进画布 / 资产已删)时,
// 从 token 自身派生的展示信息,气泡按 kind 图标 + 文件名渲染
export interface StrayChip { kind: AssetKind; url?: string; name?: string }

// url 路径末段作文件名;无路径段/非法 url 回退 undefined(chip 标签走 kind 名兜底)
function fileNameFromUrl(url: string): string | undefined {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

// —— A1:MessageItem 窄订阅支撑 ——
export interface RefToken { form: 'attachment' | 'mention' | 'plain'; value: string }

// 与 extractRefs 同一套正则的纯 token 化(不做资产反查):attachment 取 name、mention 取 url、plain 取 @token。
// 供消息卡把「文本 token 化」(只依赖消息文本,可 memo)与「资产反查」(需订阅 store)分离。
export function extractRefTokens(text: string): RefToken[] {
  const tokens: RefToken[] = [];
  const noAttachment = text.replace(/<attachment name="([^"]*)">[\s\S]*?<\/attachment>/g, (_m, name: string) => {
    tokens.push({ form: 'attachment', value: name });
    return '';
  });
  const noMention = noAttachment.replace(/@\[([a-z0-9]+)\]<([^>]+)>/gi, (_m, _type: string, url: string) => {
    tokens.push({ form: 'mention', value: url });
    return '';
  });
  noMention.replace(/@(\S+)/g, (m, token: string) => {
    tokens.push({ form: 'plain', value: token });
    return m;
  });
  return tokens;
}

// token 列表 → 解析签名:每个 token 的命中 key(未命中为空槽)拼接。
// 解析语义与 extractRefs 的 Map 构建一致(后出现的资产覆盖先出现的,last-wins)。
// 消息卡以此做选择器:签名值不变 ⇒ 解析结果不变 ⇒ 不重渲——无关资产变化不再扇出到全部消息。
export function resolveRefSignature(tokens: RefToken[], assets: RefAsset[]): string {
  if (tokens.length === 0) return '';
  const resolved: string[] = new Array(tokens.length).fill('');
  for (const a of assets) {
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.form === 'attachment') {
        if (a.label === t.value) resolved[i] = a.key;
      } else if (t.form === 'mention') {
        if (a.preview?.src === t.value) resolved[i] = a.key;
      } else if (a.key === t.value || a.preview?.src === t.value) {
        resolved[i] = a.key;
      }
    }
  }
  // \u0000 写成转义而非裸字节：运行时等价，但源码里嵌一个 NUL 会让整个文件被 grep / file 当二进制静默跳过
  return resolved.join('\u0000');
}

// 从用户消息文本提取资产引用 token 并剥离,回填资产 key(去重保序):
// 依次识别内联 attachment 块 / 新格式 @[type]<url>(按 url 反查)与历史 @url / @key;
// attachment 块与已知 type 的新格式 token 反查不到时也剥离并产出游离 chip(不把内部标记泄漏进正文);
// 其余反查不到的原样保留(不误伤邮箱)
export function extractRefs(text: string, assets: RefAsset[]): { keys: string[]; text: string; chips: StrayChip[] } {
  const byToken = new Map<string, string>();
  const byUrl = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const a of assets) {
    byToken.set(a.key, a.key);
    if (a.label) byLabel.set(a.label, a.key);
    if (a.preview?.src) {
      byToken.set(a.preview.src, a.key);
      byUrl.set(a.preview.src, a.key);
    }
  }
  const keys: string[] = [];
  const chips: StrayChip[] = [];
  const pushKey = (k: string) => { if (!keys.includes(k)) keys.push(k); };

  // 内联 attachment 块:历史重建的消息文本含完整内联内容,一律剥离不渲染原文;
  // name 命中 label 回填 key chip,未命中(对话附件)产出 text kind 游离 chip
  let stripped = text.replace(/<attachment name="([^"]*)">[\s\S]*?<\/attachment>/g, (_m, name: string) => {
    const key = byLabel.get(name);
    if (key) pushKey(key);
    else chips.push({ kind: 'text', ...(name ? { name } : {}) });
    return '';
  });

  stripped = stripped.replace(/@\[([a-z0-9]+)\]<([^>]+)>/gi, (m, type: string, url: string) => {
    const key = byUrl.get(url);
    if (key) { pushKey(key); return ''; }
    // 反查不到但 type 已知(对话附件/已删资产):剥离 + 按 token 自造游离 chip;未知 type 原样保留
    const kind = MENTION_KIND[type.toLowerCase()];
    if (kind) {
      const name = fileNameFromUrl(url);
      chips.push({ kind, url, ...(name ? { name } : {}) });
      return '';
    }
    return m;
  });

  stripped = stripped.replace(/@(\S+)/g, (m, token: string) => {
    const key = byToken.get(token);
    if (key) { pushKey(key); return ''; }
    return m;
  });

  return { keys, text: stripped.replace(/ {2,}/g, ' ').trim(), chips };
}
