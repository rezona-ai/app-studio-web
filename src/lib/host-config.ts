// 解析主站经 postMessage 下发的配置帧(rezonalab-config),校验来源与形状并归一。
// 纯函数、无副作用:仅做解析 / 归一,DOM 与监听由 src/client/useHostConfig.ts 负责。
// 分站默认不回写 localStorage;唯一例外是用户主动切语言(LanguageMenu 合并写 lang,见 serializeHostConfigPatch)。

export interface HostConfig {
  theme: 'light' | 'dark';
  lang?: string;
}

// 主站消息格式:{ type:'rezonalab-config', key:'rezonalab-config', config:{ lang, theme } }
// origin 必须等于自身 origin —— 分站部署在主站同源 /game 路径下。
export function parseHostConfig(data: unknown, origin: string, selfOrigin: string): HostConfig | null {
  if (origin !== selfOrigin) return null; // 来源校验:仅接受同源
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as { type?: unknown; config?: unknown };
  if (msg.type !== 'rezonalab-config') return null;
  if (typeof msg.config !== 'object' || msg.config === null) return null;
  const config = msg.config as { theme?: unknown; lang?: unknown };
  // theme 归一沿用防白闪脚本逻辑:仅 'light' 走浅色,其余 / 缺省 / 异常一律深色
  const result: HostConfig = { theme: config.theme === 'light' ? 'light' : 'dark' };
  if (typeof config.lang === 'string' && config.lang) result.lang = config.lang;
  return result;
}

// 用户主动切换语言时,分站合并回写主站同源配置 localStorage['rezonalab-config'] 的纯逻辑:
// 容错解析现有(非法 / 空 → {}),浅合并 patch(仅覆盖给定字段,保留 theme 等),序列化。
// IO(读 / 写 localStorage)由调用方(LanguageMenu)负责,本函数无副作用。
export function serializeHostConfigPatch(rawExisting: string | null, patch: Partial<HostConfig>): string {
  let base: Record<string, unknown> = {};
  if (rawExisting) {
    try {
      const parsed = JSON.parse(rawExisting);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed as Record<string, unknown>;
    } catch {
      // 非法 JSON 视作空对象(沿用"非法帧 try/catch 跳过"哲学)
    }
  }
  return JSON.stringify({ ...base, ...patch });
}
