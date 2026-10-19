// 部署契约测试的共享工具:把 deploy/*.yaml 模板按某环境「渲染」后供断言。
// 渲染逻辑与 _deploy.yml 的 envsubst 对齐(同一组 ${VAR} 替换),HPA 副本数等环境差异值
// 从对应 deploy_*.yml 工作流的 with: 块读取,保证测试与真实部署口径一致、防漂移。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest 从仓库根运行,故以 process.cwd() 为根解析仓库内相对路径。
/** 读取仓库内某相对路径文件文本 */
export function readRepoFile(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

/** 极简 envsubst:把 ${VAR} 替换为 vars[VAR];未提供的变量保持原样 */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\$\{(\w+)\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
}

/**
 * 从某工作流文件的 with: 块读取一个 input 值。
 * 只匹配形如 `  key: "value"` / `  key: value`(带可选注释)的行。
 */
export function workflowInput(workflowRelPath: string, key: string): string {
  const wf = readRepoFile(workflowRelPath);
  const re = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*(?:#.*)?$`, 'm');
  const match = wf.match(re);
  if (!match) throw new Error(`${workflowRelPath} 未找到 input: ${key}`);
  return match[1].trim();
}

/** 读取 _deploy.yml 某 workflow_call input 的 default 值(input 键 6 空格缩进,子字段 8 空格) */
export function deployInputDefault(key: string): string {
  const lines = readRepoFile('.github/workflows/_deploy.yml').split('\n');
  const idx = lines.findIndex((line) => new RegExp(`^\\s{6}${key}:\\s*$`).test(line));
  if (idx === -1) throw new Error(`_deploy.yml 未找到 input: ${key}`);
  for (let i = idx + 1; i < lines.length && /^\s{8}/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s*default:\s*["']?([^"'\n#]*?)["']?\s*$/);
    if (m) return m[1].trim();
  }
  throw new Error(`_deploy.yml input ${key} 无 default`);
}

/** 取某 deploy_*.yml 的 input;未在 with: 显式传则回落到 _deploy.yml 的 default(模拟真实渲染口径) */
export function resolveInput(workflowRelPath: string, key: string): string {
  try { return workflowInput(workflowRelPath, key); }
  catch { return deployInputDefault(key); }
}

// 公共渲染变量(与 _deploy.yml 的 export 列表对齐),按环境注入差异值
function envVars(environment: string, workflowRelPath: string): Record<string, string> {
  return {
    ENVIRONMENT: environment,
    NAMESPACE: environment,
    IMAGE_TAG: 'test-image:tag',
    APP_RUNTIME_ENV: 'production',
    GITHUB_SHA: 'testsha',
    DEPLOYED_AT: '2026-06-24T00:00:00Z',
    PGC_BASE_URL: resolveInput(workflowRelPath, 'pgc_base_url'),
    HPA_MIN_REPLICAS: resolveInput(workflowRelPath, 'hpa_min'),
    HPA_MAX_REPLICAS: resolveInput(workflowRelPath, 'hpa_max'),
    APP_CPU_REQUEST: resolveInput(workflowRelPath, 'app_cpu_request'),
    APP_MEM_REQUEST: resolveInput(workflowRelPath, 'app_mem_request'),
    APP_CPU_LIMIT: resolveInput(workflowRelPath, 'app_cpu_limit'),
    APP_MEM_LIMIT: resolveInput(workflowRelPath, 'app_mem_limit'),
  };
}

/** develop 环境渲染变量(HPA/资源等差异值取自 deploy_dev.yml,缺省回落 _deploy.yml) */
export function developVars(): Record<string, string> {
  return envVars('develop', '.github/workflows/deploy_dev.yml');
}

/** production 环境渲染变量(差异值取自 deploy.yml,资源未显式传 → _deploy.yml 基线默认) */
export function productionVars(): Record<string, string> {
  return envVars('production', '.github/workflows/deploy.yml');
}

/** 按 develop 环境渲染某 deploy 模板 */
export function renderDevelop(relPath: string): string {
  return renderTemplate(readRepoFile(relPath), developVars());
}

/** 按 production 环境渲染某 deploy 模板 */
export function renderProduction(relPath: string): string {
  return renderTemplate(readRepoFile(relPath), productionVars());
}
