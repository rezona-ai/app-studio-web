// 模型 ID → 展示名 + 默认选中解析(纯函数,无副作用)

// 规则:claude-* —— 去前缀 → 丢末尾纯数字日期戳(≥6 位)→ 首段族名 Title case
//      → 其余数字段用 "." 连接接在族名后。
//      其余先查 KNOWN_MODELS 精确 ID(官方展示名);未收录的 gpt-* 按前缀兜底为 "GPT <版本> <代号>"
//      (版本段原样保留点号,代号各段首字母大写空格相连,如 gpt-6-astra → GPT 6 Astra、gpt-6 → GPT 6);
//      仍无法解析者原样回退。
export function modelLabel(id: string): string {
  if (!id || !id.startsWith('claude-')) {
    const known = KNOWN_MODELS[id];
    if (known) return known.label;
    return gptLabel(id) ?? id;
  }
  const parts = id.slice('claude-'.length).split('-').filter(Boolean);
  while (parts.length > 1 && /^\d{6,}$/.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return id;
  const [family, ...rest] = parts;
  const nums = rest.filter((p) => /^\d+$/.test(p));
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return nums.length ? `${name} ${nums.join('.')}` : name;
}

// 已知模型元数据:brand 决定选择器里的品牌图标,desc 是描述文案 key 后缀(chat.modelDesc.<desc>)
export type ModelBrand = 'rezona' | 'claude' | 'openai' | 'grok' | 'seed' | 'kimi' | 'glm';
// desc 缺省表示没有官方定位文案(前缀兜底出来的模型),选择器只渲染名称行
export type ModelMeta = { brand: ModelBrand; desc?: string };

// claude-* 按族识别;其余仅收录后端实际下发的已知 ID(展示名/描述均取自各家官方),未知模型返回 null
const CLAUDE_FAMILIES = ['fable', 'opus', 'sonnet', 'haiku'] as const;

// 已收录模型必有官方展示名与定位文案(Required 钉住 desc,漏写在 tsc 阶段报错而非静默少一行)
const KNOWN_MODELS: Record<string, Required<ModelMeta> & { label: string }> = {
  // 自研模型:后端下发的 ID 就是展示名(大小写敏感,照契约原样取)且为默认模型(列表首项)
  Rez1: { label: 'Rez1', brand: 'rezona', desc: 'rez1' },
  'seed-2-0-code': { label: 'Seed 2.0 Code', brand: 'seed', desc: 'seedCode' },
  // 展示名按 gpt-* 口径「GPT <版本> <代号>」(与前缀兜底一致,产品定的格式,非 OpenAI 官方写法);文案为产品侧自定(突出 3D 与视觉)
  'gpt-6-astra': { label: 'GPT 6 Astra', brand: 'openai', desc: 'gpt6' },
  'gpt-5.6': { label: 'GPT 5.6', brand: 'openai', desc: 'gpt56' },
  'gpt-5.5': { label: 'GPT 5.5', brand: 'openai', desc: 'gpt55' },
  'gpt-5.4': { label: 'GPT 5.4', brand: 'openai', desc: 'gpt54' },
  'grok-4.5': { label: 'Grok 4.5', brand: 'grok', desc: 'grok45' },
  'kimi-k3': { label: 'Kimi K3', brand: 'kimi', desc: 'kimiK3' },
  'glm-5.2': { label: 'GLM 5.2', brand: 'glm', desc: 'glm52' },
};

// gpt-* 前缀兜底:取 "gpt-" 后第一段,须是纯版本号(数字 + 点),否则不认(gpt-image-2 / gpt-4o 这类不兜底)。
function gptVersion(id: string): string | null {
  if (!id.startsWith('gpt-')) return null;
  const seg = id.slice('gpt-'.length).split('-')[0];
  return /^\d+(\.\d+)*$/.test(seg) ? seg : null;
}

// 展示名「GPT <版本> <代号>」:版本后的各段首字母大写、空格相连(gpt-6-astra → GPT 6 Astra);无代号即「GPT <版本>」。
// 产品定的统一格式,不照搬 OpenAI 官方的连字符写法。
function gptLabel(id: string): string | null {
  const ver = gptVersion(id);
  if (!ver) return null;
  const suffix = id
    .slice('gpt-'.length)
    .split('-')
    .slice(1)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return ['GPT', ver, ...suffix].join(' ');
}

export function modelMeta(id: string): ModelMeta | null {
  if (id.startsWith('claude-')) {
    const family = id.slice('claude-'.length).split('-')[0];
    return (CLAUDE_FAMILIES as readonly string[]).includes(family) ? { brand: 'claude', desc: family } : null;
  }
  const known = KNOWN_MODELS[id];
  if (known) return { brand: known.brand, desc: known.desc };
  return gptVersion(id) ? { brand: 'openai' } : null;
}

// 建连/展示用选中模型:用户已选且仍在列表则沿用,否则取列表首项;空列表为 null
export function resolveSelectedModel(models: string[], current: string | null): string | null {
  if (current && models.includes(current)) return current;
  return models[0] ?? null;
}

// 会话落库模型 → 选择器的判定(spec 2026-09-11-session-model-adopt-design)。
// 权威是会话:koubou 的 session.ready 下发 model(= 会话 override 或 provider 默认)与
// available_models(与 GET /models 同源,见 koubou app/core/config.py 的 selectable_models)。
// ⚠️ 这里读 available_models **只作判定依据,不作选择器的列表数据源** —— 后者仍是 GET /models
// (spec 2026-06-17:114 的决定未变,两者是不同用途,勿混)。
export type ReadyModelAction =
  | { kind: 'adopt'; model: string }      // 会话模型可用 → 回填选择器
  // 会话模型已下架 → 提示 + 切到 fallback。**fallback 取判定所用的那份列表的首项** ——
  // 判定与切换目标必须同源:ready 先于 /models 到达(或 listModels 静默失败)时 store 列表还是空的,
  // 目标另取 store 列表就会「判出下架却拿不到目标」,而这个会话是真坏的,补救不能静默丢失
  | { kind: 'retired'; model: string; fallback: string }
  | { kind: 'none' };                     // 无可回填的事实 / 判不出

export function resolveReadyModel(
  readyModel: string | null | undefined,
  readyAvailable: string[] | undefined,
  storeAvailable: string[],
): ReadyModelAction {
  // 后端让 CLI/router 自选(model 为 null):没有「会话在用哪个模型」这个事实可回填
  if (!readyModel) return { kind: 'none' };
  // ready 自带的列表优先:建连只等 currentProjectId,而 /models 是独立 effect,常常后到;
  // 靠它判定就不受那个时序影响(首个 ready 即可判)
  const available = readyAvailable?.length ? readyAvailable : storeAvailable;
  // 两边都空 = 判不出,此时**两件事都不做**:adopt 会把一个可能不在下拉里的值写成选中,
  // retired 会把一个其实健康的会话误切走
  if (!available.length) return { kind: 'none' };
  // 已下架 → 切到列表首项(= 产品指定的默认模型,运维把 allowed_models 首项与 default_model 对齐)。
  // **不按订阅档位挑目标**:模型选择对非新用户一律开放(门禁只锁从未 build 过版本的新用户,
  // 后端也不强制),消费闸门是积分而非档位 —— 详见 spec「场景 2 为何删除」
  if (!available.includes(readyModel)) {
    return { kind: 'retired', model: readyModel, fallback: available[0] };
  }
  return { kind: 'adopt', model: readyModel };
}
