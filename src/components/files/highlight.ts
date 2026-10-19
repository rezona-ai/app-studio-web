// 轻量只读语法高亮(file/code 浏览用):逐行扫描出 token,前端用 <span> 渲染(不走
// dangerouslySetInnerHTML,文件内容可含任意字符)。颜色对齐 Figma 892-14968 的代码配色——
// 这是「编辑器语法色板」,与 UI 设计令牌(--color-*)是两套体系,故就近以常量维护。
const SYNTAX = {
  tag: '#FFAE57',     // 标签 / 关键字
  attr: '#7CC3FF',    // 属性名 / JSON key
  str: '#98C379',     // 字符串 / 属性值
  num: '#D19A66',     // 数字 / 布尔 / null
  comment: '#6A737D', // 注释
} as const;

export type TokType = keyof typeof SYNTAX | 'plain';
export interface Tok { text: string; type: TokType }
export type Lang = 'html' | 'css' | 'json' | 'js' | 'text';

export function syntaxColor(type: TokType): string | undefined {
  return type === 'plain' ? undefined : SYNTAX[type];
}

export function langFromPath(path: string): Lang {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'html' || ext === 'htm' || ext === 'xml' || ext === 'svg') return 'html';
  if (ext === 'css' || ext === 'scss') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx' || ext === 'mjs') return 'js';
  return 'text';
}

export function langLabel(lang: Lang): string {
  return lang === 'text' ? 'TEXT' : lang.toUpperCase();
}

// 文件预览类型:决定 Files 视图右栏怎么渲染选中文件。
// media(image/video/audio/3d)与 binary 不能当文本取(否则字节→UTF-8 解码出乱码);
// 其余一律 text(含 svg/html/json 等文本格式,保持原高亮行为)。判定纯靠扩展名——
// 接口不返回 mime,但代理 /api/pgc/asset 会透传上游 content-type,故媒体可直接喂 <img>/<video> 等。
export type FilePreviewKind = 'text' | 'image' | 'video' | 'audio' | '3d' | 'binary';

// 扩展名 → 预览类型。**不含 svg**(svg 是文本 XML,仍按 html 高亮)。
const PREVIEW_EXT: Record<string, FilePreviewKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
  glb: '3d', gltf: '3d',
  // 已知不可文本预览的二进制:字体 / 压缩包 / wasm / pdf 等
  ttf: 'binary', otf: 'binary', woff: 'binary', woff2: 'binary',
  zip: 'binary', gz: 'binary', tar: 'binary', bin: 'binary', wasm: 'binary', pdf: 'binary',
};

// 未列入媒体 / 已知二进制集的一律 'text'(默认安全:未知扩展多为文本源码,渲染不会乱码)。
export function filePreviewKind(path: string): FilePreviewKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return PREVIEW_EXT[ext] ?? 'text';
}

const JS_KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'new', 'class',
  'import', 'export', 'from', 'default', 'await', 'async', 'try', 'catch', 'finally', 'throw',
  'typeof', 'instanceof', 'in', 'of', 'this', 'true', 'false', 'null', 'undefined', 'break', 'continue',
]);

// 有序规则:命中即吞掉对应片段;均不命中则按 1 字符 plain 推进。逐行无跨行态(块注释/模板串
// 跨行不完美,只读浏览可接受)。
function rulesFor(lang: Lang): { re: RegExp; type: TokType }[] {
  const STR = { re: /^(?:"[^"]*"?|'[^']*'?|`[^`]*`?)/, type: 'str' as TokType };
  const NUM = { re: /^\b\d+(?:\.\d+)?\b/, type: 'num' as TokType };
  if (lang === 'html') {
    return [
      { re: /^<!--.*?(?:-->|$)/, type: 'comment' },
      { re: /^<\/?[A-Za-z][\w-]*/, type: 'tag' },
      STR,
      { re: /^[A-Za-z_:][\w:.-]*(?=\s*=)/, type: 'attr' },
      { re: /^\/?>/, type: 'tag' },
    ];
  }
  if (lang === 'json') {
    return [
      { re: /^"[^"]*"(?=\s*:)/, type: 'attr' },
      STR,
      { re: /^\b(?:true|false|null)\b/, type: 'num' },
      NUM,
    ];
  }
  if (lang === 'css') {
    return [
      { re: /^\/\*.*?(?:\*\/|$)/, type: 'comment' },
      STR,
      { re: /^[.#]?[A-Za-z_-][\w-]*(?=\s*[:{])/, type: 'attr' },
      NUM,
    ];
  }
  if (lang === 'js') {
    return [
      { re: /^\/\/.*$/, type: 'comment' },
      { re: /^\/\*.*?(?:\*\/|$)/, type: 'comment' },
      STR,
      NUM,
    ];
  }
  return [];
}

function tokenizeLine(line: string, lang: Lang): Tok[] {
  const rules = rulesFor(lang);
  const out: Tok[] = [];
  let rest = line;
  let plain = '';
  const flush = () => { if (plain) { out.push({ text: plain, type: 'plain' }); plain = ''; } };
  while (rest) {
    // JS 关键字:在词边界处单独识别(放扫描里避免与标识符混淆)
    if (lang === 'js') {
      const m = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (m && JS_KEYWORDS.has(m[0])) { flush(); out.push({ text: m[0], type: 'tag' }); rest = rest.slice(m[0].length); continue; }
      if (m) { plain += m[0]; rest = rest.slice(m[0].length); continue; }
    }
    let matched = false;
    for (const { re, type } of rules) {
      const m = re.exec(rest);
      if (m && m[0]) { flush(); out.push({ text: m[0], type }); rest = rest.slice(m[0].length); matched = true; break; }
    }
    if (!matched) { plain += rest[0]; rest = rest.slice(1); }
  }
  flush();
  return out;
}

export function highlight(code: string, lang: Lang): Tok[][] {
  return code.replace(/\r\n?/g, '\n').split('\n').map((line) => tokenizeLine(line, lang));
}
