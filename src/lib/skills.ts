// Skill 调用串的纯逻辑:光标处 token 解析、draft 内已知 skill token 切分、弹窗过滤。
// 调用串形态由后端下发(GET /skills 的 `invocation`):Claude 为 `/name`,Codex 为 `$name`
// —— 前端不假定前缀,一律由 invocation 派生(见设计稿 2026-07-30-codex-backend-integration)。
// token 语义与发送契约一致:词首 invocation + 词尾边界(空白/串尾),序列化即字面文本。

export interface SkillDef {
  name: string;         // 稳定名(i18n 显示名/描述的 key)
  invocation: string;   // 原样插入输入框的 backend 原生调用串(已含前缀)
}

// 激活前缀 = 所有 invocation 的首字符去重。列表未加载(空)时无前缀 → 不激活弹窗
export function skillPrefixes(skills: readonly SkillDef[]): string[] {
  const set = new Set<string>();
  for (const s of skills) if (s.invocation) set.add(s.invocation[0]);
  return [...set];
}

export interface ActiveSkillToken {
  query: string;
  start: number;
  prefix: string;
}

// 返回光标处正在输入的 skill token(最近的词首前缀到光标,中间不含空白);与 getActiveMention 同型
export function getActiveSkillToken(text: string, caret: number, prefixes: readonly string[]): ActiveSkillToken | null {
  const upto = text.slice(0, caret);
  // 多前缀共存时取最靠右的那个(与「最近的词首前缀」语义一致)
  let at = -1;
  let prefix = '';
  for (const p of prefixes) {
    const i = upto.lastIndexOf(p);
    if (i > at) { at = i; prefix = p; }
  }
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // 仅词首激活,排除 URL 的 '//'、金额的 'US$' 等词中前缀
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at, prefix };
}

export interface SkillSegment {
  kind: 'plain' | 'skill';
  text: string;
}

// 前缀字符进字符类前的转义(当前只有 '/' 与 '$',但不对后端未来的前缀做假设)
function escapeForClass(ch: string): string {
  return ch.replace(/[\\\]^-]/g, '\\$&');
}

// 把文本切成 plain/skill 片段供底衬高亮;仅「词首 invocation + 词尾边界」记为 skill
export function splitSkillTokens(text: string, skills: readonly SkillDef[]): SkillSegment[] {
  if (!text) return [];
  const prefixes = skillPrefixes(skills);
  if (!prefixes.length) return [{ kind: 'plain', text }];
  const known = new Set(skills.map((s) => s.invocation));
  const segs: SkillSegment[] = [];
  let last = 0;
  // \S+ 贪到空白为止:紧跟标点(如 `/plan,`)整体不在白名单内 → 自然不切分(词尾边界规则)
  const re = new RegExp(`[${prefixes.map(escapeForClass).join('')}]\\S+`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue; // 词中前缀
    if (!known.has(m[0])) continue;
    if (m.index > last) segs.push({ kind: 'plain', text: text.slice(last, m.index) });
    segs.push({ kind: 'skill', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: 'plain', text: text.slice(last) });
  return segs;
}

// 弹窗过滤:query 同时匹配稳定名与本地化显示名,不区分大小写
export function filterSkills(
  skills: readonly SkillDef[],
  query: string,
  resolveName: (name: string) => string,
): SkillDef[] {
  const q = query.toLowerCase();
  return skills.filter((s) => s.name.toLowerCase().includes(q) || resolveName(s.name).toLowerCase().includes(q));
}
