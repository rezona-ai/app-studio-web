// GA4 环境解析:measurement id 是公开常量(本就随客户端 bundle 下发),硬编码。
// 全环境共用同一个 property,故事件参数 env 是区分 dev/stage/prod 的唯一手段——
// CI 透传 GitHub environment 原名(develop/stage/production),映射收在这一处;未设(本地)→ local。
// debug_mode 除 prod 外全开,GA4 DebugView 里可实时看到自测事件。
const GA4_ID = 'G-HXYXWKDJLQ';

export type Ga4Env = 'prod' | 'stage' | 'dev' | 'local';

// 短名别名同时收:历史构建参数用过 prod,手工构建也可能填短名,漏判会把生产数据标成 local。
const ENV_ALIAS: Record<string, Ga4Env> = {
  production: 'prod', prod: 'prod',
  stage: 'stage', staging: 'stage',
  develop: 'dev', dev: 'dev',
};

export interface Ga4Config { measurementId: string; env: Ga4Env; debug: boolean }

export function resolveGa4(appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): Ga4Config {
  const env = ENV_ALIAS[appEnv ?? ''] ?? 'local';
  return { measurementId: GA4_ID, env, debug: env !== 'prod' };
}
