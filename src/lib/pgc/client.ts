import type {
  ApiResponse, ProjectData, ProjectListData, CanvasItemData, CanvasItemListData,
  CanvasGenTask, CanvasGenFailure, VersionData, VersionListData, VersionFilesData, VersionCreditsData,
  UpdateProjectRequest, AutoNameData, CanvasGenImageRequest, CanvasGenAudioRequest, CanvasGenVideoRequest, CanvasGenModel3DRequest,
  Rig3DPrecheckRequest, Rig3DPrecheckData, CanvasGenRig3DRequest, CanvasGenRetextureRequest,
  CanvasUpdateRequest, CanvasWriteFromUrlRequest, CanvasTextCreateRequest, VoiceListData,
  CanvasBatchUpdateItem, CanvasBatchUpdateRequest, CanvasBatchUpdateData,
  CanvasGroupData, CanvasGroupListData, CanvasGroupCreateRequest, CanvasGroupUpdateRequest,
  CanvasEstimateRequest, CanvasEstimateData,
  CreateRemixRequest, RemixProjectData, RemixPolicyData, UpdateRemixPolicyRequest,
  ApkBuildRequest, ApkBuildData, ApkBuildStatusData, ApkDownloadLinkData,
  DesktopBuildRequest, DesktopBuildData, DesktopBuildStatusData,
  CurrentUser, NewUserStatusData, BalanceData,
  RezonaPublishRequest, RezonaPublishResultData, RezonaGameListData,
  LibraryAssetListData, LibraryAssetQuery, ImportProjectData,
  ReplayStartData, ReplayProjectStateData,
  WorkbenchShareData, WorkbenchShareOpenData, WorkbenchShareFinalizeData,
} from './types';
import { apiPath } from '@/lib/basePath';
import { desktopBuildPath } from '@/lib/desktop-export';

// 经 apiPath 补 basePath（见 src/lib/basePath.ts）：/game 部署下 → /game/api/pgc，
// 否则命中 LB /api/* 规则被路由到 new-api。
const PREFIX = apiPath('/api/pgc');

export class PgcError extends Error {
  // failure：生成类前置拒绝(如内容审核 422)时,信封顶层的结构化失败详情;其余错误为 null
  // requestId：信封的 request_id,反复失败时展示给用户以便联系支持定位(Rezona 契约 §6);缺失/本地错误为 null
  constructor(
    public code: string,
    message: string,
    public status: number,
    public failure: CanvasGenFailure | null = null,
    public requestId: string | null = null,
  ) {
    super(message);
    this.name = 'PgcError';
  }
}

// 已解析信封(或 null)+ HTTP 状态 → data 或抛 PgcError。fetch/XHR 共用,不重复造判定
function resolveEnvelope<T>(env: ApiResponse<T> | null, ok: boolean, status: number): T {
  if (!ok || !env || env.success === false) {
    throw new PgcError(env?.code ?? 'HTTP_ERROR', env?.message ?? `HTTP ${status}`, status, env?.failure ?? null, env?.request_id ?? null);
  }
  // 成功信封即返回 data;空 data 交由调用方处理(当前各端点成功时 data 均非空)
  return env.data as T;
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: ApiResponse<T> | null = null;
  try { env = (await res.json()) as ApiResponse<T>; } catch { /* 非 JSON */ }
  return resolveEnvelope(env, res.ok, res.status);
}

// 默认请求超时:防一个挂起的连接把轮询守卫/调用方永久卡死(审计 C1)。
// 同步生成类端点(图像/音频 generate、remix/发布/回放开通)后端本就要跑几十秒到分钟级,单独放宽,不能被默认值误杀。
const DEFAULT_TIMEOUT_MS = 30_000;
const SLOW_TIMEOUT_MS = 300_000;
// Rezona 发布:首发含上游建号+双向绑定故比普通请求慢,但上界是 pgc 自己的出站超时(当前 30s,
// 超时即返 REZONA_UNAVAILABLE)。留一倍余量即可,不必跟着 SLOW 转 5 分钟(契约 §5)。
const PUBLISH_TIMEOUT_MS = 60_000;

// keepalive:让请求在页面卸载后仍能送达(延迟删除的关页兜底,见 spec 2026-08-03-canvas-undo)。
// 不用 sendBeacon —— 它只能发 POST,而删除是 DELETE。
async function pgc<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS, signal?: AbortSignal, keepalive?: boolean): Promise<T> {
  // 外部 signal(删除生成中占位卡时中止请求)与超时组合:任一触发即中止
  const timeout = AbortSignal.timeout(timeoutMs);
  // credentials:'include' 让浏览器附上 .rezona.ai session cookie(cookie 制鉴权)
  const init: RequestInit = { method, credentials: 'include', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, ...(keepalive ? { keepalive: true } : {}) };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${PREFIX}${path}`, init);
  } catch (e) {
    // 超时中止归一为 PgcError:让 guard()/轮询按已知错误兜底(Toast/计 fails),而非裸抛 DOMException 走未知错误路径
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new PgcError('TIMEOUT', `Request timeout: ${method} ${path}`, 0);
    }
    // 外部主动中止(删除生成中卡片)归一为 ABORTED,与上传 XHR 中止同码,调用方据此静默处理
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new PgcError('ABORTED', `Request aborted: ${method} ${path}`, 0);
    }
    // 断网/DNS/连接重置是可预期运行错误，归一后才能进入表单错误态和统一 Toast，不留在 checking。
    throw new PgcError('NETWORK', `Network error: ${method} ${path}`, 0);
  }
  return unwrap<T>(res);
}

const PROJECT_PAGE_SIZE = 100;
// 续拉页数硬上限(5000 个项目,远超真实用量):后端 total 异常偏大时不无界请求
const MAX_PROJECT_PAGES = 50;

const listProjectPage = (page: number, pageSize: number) =>
  pgc<ProjectListData>('GET', `/api/projects?page=${page}&page_size=${pageSize}`);

export const pgcApi = {
  // 项目
  // 全量项目列表:上游 /api/projects 是分页端点,项目数超单页时顺序续拉合并——调用方(侧栏列表 /
  // URL 解析 / 默认选中)都需要用户全量项目,只取首页会漏掉第 101 个之后的项目。
  // 顺序而非并发:空页即收敛,后端 total 与实际不一致时也不会一次打出几十个请求。
  listProjects: async (pageSize = PROJECT_PAGE_SIZE): Promise<ProjectListData> => {
    const first = await listProjectPage(1, pageSize);
    const items = [...first.items];
    const seen = new Set(items.map((p) => p.id));
    // 已取回的原始条数(含跨页重复):用它而非去重后长度判停,否则去重会让循环多拉一页
    let fetched = items.length;
    const total = first.total ?? items.length;   // 缺 total 视作单页,不额外请求
    for (let page = 2; fetched < total && page <= MAX_PROJECT_PAGES; page++) {
      const next = await listProjectPage(page, pageSize);
      if (!next.items?.length) break;   // total 虚高 / 尾页越界:空页即收敛
      fetched += next.items.length;
      // 拉取期间新建项目会把已见项挤到后一页,按 id 去重防侧栏出现重复项
      for (const p of next.items) if (!seen.has(p.id)) { seen.add(p.id); items.push(p); }
    }
    return { ...first, items, total: items.length };
  },
  createProject: (name: string) => pgc<ProjectData>('POST', '/api/projects', { name }),
  getProject: (id: number) => pgc<ProjectData>('GET', `/api/projects/${id}`),
  updateProject: (id: number, body: UpdateProjectRequest) => pgc<ProjectData>('PATCH', `/api/projects/${id}`, body),
  // 首条 prompt 自动起名:仅项目名仍为默认占位名时服务端才真正改名(LLM 起名,失败保持原名)
  autoNameProject: (id: number, prompt: string) => pgc<AutoNameData>('POST', `/api/projects/${id}/auto-name`, { prompt }),
  deleteProject: (id: number) => pgc<{ id: number }>('DELETE', `/api/projects/${id}`),

  // Remix:fork 公开源游戏成当前用户新项目(路径相对 PREFIX → 上游 /api/remixes)
  createRemix: (body: CreateRemixRequest) => pgc<RemixProjectData>('POST', '/api/remixes', body, SLOW_TIMEOUT_MS),

  // Remix 策略(owner 自助开关):读 / 写当前项目是否开放 Remix。纯策略读写,走默认超时。
  // 关闭时**不传** version_id —— 契约里该字段仅开启时必填,传 null / 空串会被 422 挡回。
  remixPolicy: {
    get: (projectId: number) => pgc<RemixPolicyData>('GET', `/api/projects/${projectId}/remix-policy`),
    set: (projectId: number, body: UpdateRemixPolicyRequest) =>
      pgc<RemixPolicyData>('PATCH', `/api/projects/${projectId}/remix-policy`, body),
  },

  // 画布
  // 一次拉全:响应同时带 items 与 groups(见 CanvasItemListData 的三态注释),整体加载无需再往返
  listCanvasItems: (pid: number) => pgc<CanvasItemListData>('GET', `/api/projects/${pid}/canvas/items`),

  // 分组框。flag 关时这四个都是 503 CANVAS_GROUPS_DISABLED(由 pgc() 统一归一成 PgcError)
  listCanvasGroups: (pid: number) => pgc<CanvasGroupListData>('GET', `/api/projects/${pid}/canvas/groups`),
  createCanvasGroup: (pid: number, body: CanvasGroupCreateRequest) =>
    pgc<CanvasGroupData>('POST', `/api/projects/${pid}/canvas/groups`, body),
  updateCanvasGroup: (pid: number, gid: string, body: CanvasGroupUpdateRequest) =>
    pgc<CanvasGroupData>('PATCH', `/api/projects/${pid}/canvas/groups/${gid}`, body),
  // 只删框不删卡:服务端软删框并把全体成员 group_id 解绑成 null(真机确认),响应回被删的框
  // opts.keepalive:与 deleteCanvasItem 同款 —— 删框的延迟窗口内关页/刷新时把未送出的 DELETE 兜底送达
  deleteCanvasGroup: (pid: number, gid: string, opts?: { keepalive?: boolean }) =>
    pgc<CanvasGroupData>('DELETE', `/api/projects/${pid}/canvas/groups/${gid}`, undefined, DEFAULT_TIMEOUT_MS, undefined, opts?.keepalive),
  updateCanvasReference: (pid: number, itemId: string, reference: unknown) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { reference } satisfies CanvasUpdateRequest),
  // 批量更新(坐标回写走这条):一次请求取代 N 个逐条 PATCH,单次 ≤500 条由调用方分片。
  // 部分失败不整批 4xx —— 成功的已落库,失败的在 data.failed[] 里逐条回报
  batchUpdateCanvasItems: (pid: number, items: CanvasBatchUpdateItem[]) =>
    pgc<CanvasBatchUpdateData>('PATCH', `/api/projects/${pid}/canvas/items`, { items } satisfies CanvasBatchUpdateRequest),
  // 重命名:PATCH 仅带 name(后端 CanvasUpdateRequest 仅改显式提供字段);name 上限 255
  renameCanvasItem: (pid: number, itemId: string, name: string) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { name } satisfies CanvasUpdateRequest),
  // opts.keepalive:关页/刷新时把延迟删除窗口内未送出的 DELETE 兜底送达(见 pgc() 的 keepalive 注释)
  deleteCanvasItem: (pid: number, itemId: string, opts?: { keepalive?: boolean }) =>
    pgc<CanvasItemData>('DELETE', `/api/projects/${pid}/canvas/items/${itemId}`, undefined, DEFAULT_TIMEOUT_MS, undefined, opts?.keepalive),
  // 生成前报价。零副作用(不调 provider、不预留额度、不落任务行),故用普通超时而非 SLOW。
  // signal:表单快速调参时取消旧请求 —— 不取消的话旧响应可能后到、把新报价盖掉
  estimateGenerate: (pid: number, body: CanvasEstimateRequest, signal?: AbortSignal) =>
    pgc<CanvasEstimateData>('POST', `/api/projects/${pid}/canvas/items/generate/estimate`, body, DEFAULT_TIMEOUT_MS, signal),

  // 生成端点接收可选 signal:删除生成中占位卡时中止在飞请求(归一为 PgcError ABORTED)
  genImage: (pid: number, body: CanvasGenImageRequest, signal?: AbortSignal) =>
    pgc<CanvasItemListData>('POST', `/api/projects/${pid}/canvas/items/generate/image`, body, SLOW_TIMEOUT_MS, signal),
  genAudio: (pid: number, body: CanvasGenAudioRequest, signal?: AbortSignal) =>
    pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/generate/audio`, body, SLOW_TIMEOUT_MS, signal),
  // 音乐模型专用的异步端点:同步端点显式拒收音乐模型(422),因为它的契约是当场返回成品。
  // 形状与 video / model3d / rig3d / retexture 五条现役异步端点逐字一致(APIResponse[CanvasGenTask])
  genAudioTask: (pid: number, body: CanvasGenAudioRequest, signal?: AbortSignal) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/audio/task`, body, DEFAULT_TIMEOUT_MS, signal),
  pollAudioTask: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/audio/task/${taskId}`),
  genVideo: (pid: number, body: CanvasGenVideoRequest, signal?: AbortSignal) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/video`, body, DEFAULT_TIMEOUT_MS, signal),
  pollVideo: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/video/${taskId}`),
  genModel3d: (pid: number, body: CanvasGenModel3DRequest, signal?: AbortSignal) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/model3d`, body, DEFAULT_TIMEOUT_MS, signal),
  pollModel3d: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/model3d/${taskId}`),
  precheckRig3d: (pid: number, body: Rig3DPrecheckRequest) =>
    pgc<Rig3DPrecheckData>('POST', `/api/projects/${pid}/canvas/items/rig3d/precheck`, body),
  genRig3d: (pid: number, body: CanvasGenRig3DRequest, signal?: AbortSignal) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/rig3d`, body, DEFAULT_TIMEOUT_MS, signal),
  pollRig3d: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/rig3d/${taskId}`),
  genRetexture: (pid: number, body: CanvasGenRetextureRequest, signal?: AbortSignal) =>
    pgc<CanvasGenTask>('POST', `/api/projects/${pid}/canvas/items/generate/retexture`, body, DEFAULT_TIMEOUT_MS, signal),
  pollRetexture: (pid: number, taskId: string) =>
    pgc<CanvasGenTask>('GET', `/api/projects/${pid}/canvas/items/generate/retexture/${taskId}`),
  writeCanvasItemFromUrl: (pid: number, body: CanvasWriteFromUrlRequest) =>
    pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/import`, body),
  createTextItem: (pid: number, body: CanvasTextCreateRequest) =>
    pgc<CanvasItemData>('POST', `/api/projects/${pid}/canvas/items/text`, body),
  updateTextContent: (pid: number, itemId: string, content: string) =>
    pgc<CanvasItemData>('PATCH', `/api/projects/${pid}/canvas/items/${itemId}`, { content } satisfies CanvasUpdateRequest),

  // 全局素材库分页列表;sort 固定 curated(spec 决定,不做排序切换 UI)
  listLibraryAssets: (params: LibraryAssetQuery = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    qs.set('sort', params.sort ?? 'curated');
    qs.set('limit', String(params.limit ?? 40));
    qs.set('offset', String(params.offset ?? 0));
    return pgc<LibraryAssetListData>('GET', `/api/library/assets?${qs.toString()}`);
  },

  // 当前用户 / 余额(预览区账户条)
  getCurrentUser: () => pgc<CurrentUser>('GET', '/api/auth/me'),
  getBalance: () => pgc<BalanceData>('GET', '/api/credits/balance'),
  // 新用户判定(模型门禁用)。不传 modes,用后端默认口径(prompt + mcp)
  getNewUserStatus: () => pgc<NewUserStatusData>('GET', '/api/auth/me/new-user-status'),

  // 生成辅助
  listAudioVoices: () => pgc<VoiceListData>('GET', '/api/gen/audio/voices'),

  // 版本
  listVersions: (pid: number) => pgc<VersionListData>('GET', `/api/projects/${pid}/versions`),
  getVersion: (pid: number, vid: string) => pgc<VersionData>('GET', `/api/projects/${pid}/versions/${vid}`),
  previewVersion: (pid: number, vid: string) =>
    pgc<{ preview_url: string }>('GET', `/api/projects/${pid}/versions/${vid}/preview`),
  // 版本源码文件清单(只读浏览);vid 用 'current' 看当前工作版本或 'v{n}' 看稳定版本
  listVersionFiles: (pid: number, vid: string) =>
    pgc<VersionFilesData>('GET', `/api/projects/${pid}/versions/${vid}/files`),
  // 按版本区段拆分的实际 credits 消费(时间线上每行的消耗数字)。上游自带 5s 墙钟预算,用默认超时档
  getVersionCredits: (pid: number) => pgc<VersionCreditsData>('GET', `/api/projects/${pid}/versions/credits`),

  // Rezona 发布(路径带 /api 前缀,对齐 Apifox /game/pgcserver/api/rezona/*)。
  // 账号匹配/建号在服务端发布时完成,绑定态查询与扫码端点已随契约下线;listGames 供「发到已导入游戏」选目标。
  rezona: {
    listGames: (pid: number) => pgc<RezonaGameListData>('GET', `/api/projects/${pid}/rezona/games`),
    publish: (pid: number, body: RezonaPublishRequest) =>
      pgc<RezonaPublishResultData>('POST', `/api/projects/${pid}/rezona/publish`, body, PUBLISH_TIMEOUT_MS),
  },

  // APK 导出(flag pgc-export-apk 门控,未开放 404 APK_EXPORT_DISABLED)。create 幂等:同版本同配置返回同一作业。
  // 路径段用项目 public_id(后端文档写 project_id 系笔误,已与后端确认)
  apk: {
    create: (publicId: string, body: ApkBuildRequest) =>
      pgc<ApkBuildData>('POST', `/api/projects/${publicId}/apk-builds`, body),
    status: (publicId: string, buildId: number) =>
      pgc<ApkBuildStatusData>('GET', `/api/projects/${publicId}/apk-builds/${buildId}`),
    // 签发本地下载 + 扫码共用的免登录能力链(每次轮换 token,失效旧链)
    createDownloadLink: (publicId: string, buildId: number) =>
      pgc<ApkDownloadLinkData>('POST', `/api/projects/${publicId}/apk-builds/${buildId}/download-link`),
  },

  // 桌面(Windows / Steam)导出(flag pgc-export-desktop 门控,未开放三端点一律 404 DESKTOP_EXPORT_DISABLED)。
  // create 幂等:同一(项目, 版本, name)复用同一作业;在途作业上限 2,超出 429。路径段同样用 public_id。
  // **刻意不给 download 方法**:产物 138MB 量级,契约明写「不要整读进内存」。下载走浏览器原生导航到
  // desktopDownloadPath()(src/lib/desktop-export.ts),经 Next 代理流式透传 —— 这里一旦摆一个返回
  // blob 的 download(),早晚有人调它把 138MB 读进内存
  desktop: {
    // 显式放宽超时:这个 POST **不是**登记完就返回 —— 后端在返回前同步把 dist/ + 项目级 assets/
    // 打成 zip 流式传桶(先传输入再置 queued,否则 runner 可能捡到输入还没到位的作业),
    // 资产重的项目会超默认 30s 档,把「服务端其实会成功」的操作误杀成前端失败
    create: (publicId: string, body: DesktopBuildRequest) =>
      pgc<DesktopBuildData>('POST', `/api/projects/${publicId}/desktop-builds`, body, SLOW_TIMEOUT_MS),
    // 路径与下载直链共源(desktopBuildPath):两处各写一份漂过一次,下载链漏 /api 段 → 404 且静默
    status: (publicId: string, buildId: number) =>
      pgc<DesktopBuildStatusData>('GET', desktopBuildPath(publicId, buildId)),
  },

  // 回放 onboarding:三步跨 pgc(start/finalize/state)。路径带 /api 前缀对齐 Apifox /game/pgcserver/api/replay/*
  // start 幂等(重复开通同模板返回既有项目 + 当前 status);finalize 版本指针固定回写 v1(见计划 Global Constraints)
  startReplay: (templateId: string) =>
    pgc<ReplayStartData>('POST', `/api/replay/templates/${templateId}/start`, undefined, SLOW_TIMEOUT_MS),
  finalizeReplay: (projectId: number, currentVersionId: string) =>
    pgc<ReplayProjectStateData>('POST', `/api/replay/projects/${projectId}/finalize`, { current_version_id: currentVersionId }),
  updateReplayState: (projectId: number, status: 'ready' | 'completed') =>
    pgc<ReplayProjectStateData>('POST', `/api/replay/projects/${projectId}/state`, { status }),

  // 分享工作台(Share workbench):owner 开关(get/enable/disable)+ recipient 开通/收口(open/finalize)。
  // 路径均相对 PREFIX(上游 /api/projects/{id}/workbench-share 与 /api/workbench-shares/*)。
  // 端点路径/字段形态来自 pgc U2/U3 姊妹单元;若最终落地形态有别,只需改本处薄封装(见计划 U4 假设)。
  workbenchShare: {
    // owner:读当前项目分享策略(含 share_url + capability_hint)
    get: (projectId: number) => pgc<WorkbenchShareData>('GET', `/api/projects/${projectId}/workbench-share`),
    // owner:以当前活跃 session 开启分享;session 为空后端 400
    enable: (projectId: number, sessionId: string) =>
      pgc<WorkbenchShareData>('PUT', `/api/projects/${projectId}/workbench-share`, { session_id: sessionId }),
    // owner:关闭/撤销分享(已 fork 出的副本不受影响)
    disable: (projectId: number) => pgc<WorkbenchShareData>('DELETE', `/api/projects/${projectId}/workbench-share`),
    // recipient:开通目标项目并取克隆参数(须登录;未登录 401 由调用方转登录门闸)
    open: (code: string) => pgc<WorkbenchShareOpenData>('POST', `/api/workbench-shares/${code}/open`, undefined, SLOW_TIMEOUT_MS),
    // recipient:koubou 克隆成功后收口画布 + 版本指针(幂等)
    finalize: (projectId: number) =>
      pgc<WorkbenchShareFinalizeData>('POST', `/api/workbench-shares/projects/${projectId}/finalize`),
  },
};

// 上传替换项目封面(PR #272):multipart 字段 file,仅 PNG(其余后端 422);成功返回更新后的 ProjectData。
// 无需上传进度,直接 fetch + FormData(浏览器自动生成 multipart 边界,不能手写 Content-Type)。
export async function uploadProjectCover(pid: number, file: File): Promise<ProjectData> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${PREFIX}/api/projects/${pid}/cover`, {
    method: 'POST', credentials: 'include', body: fd,
  });
  return unwrap<ProjectData>(res);
}

// 导入外部压缩包为新项目(multipart 字段 file+name)。格式/大小校验全在后端(422 ARCHIVE_*/413)。
// 走 XHR 而非 fetch:压缩包动辄几十 MB,需要 upload.onprogress 真实进度;
// signal 中止时 xhr.abort() → 抛 ABORTED(导入弹窗「取消导入」用),与 uploadCanvasItem 同构。
export function importProjectArchive(
  file: File, name: string,
  onProgress?: (ratio: number) => void, signal?: AbortSignal,
): Promise<ImportProjectData> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PREFIX}/api/projects/import`);
    xhr.withCredentials = true;   // 等价 fetch credentials:'include'(cookie 制鉴权)
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let env: ApiResponse<ImportProjectData> | null = null;
      try { env = JSON.parse(xhr.responseText); } catch { /* 非 JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      try { resolve(resolveEnvelope(env, ok, xhr.status)); }
      catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new PgcError('NETWORK', 'Network error', 0));
    xhr.onabort = () => reject(new PgcError('ABORTED', 'Upload aborted', 0));
    xhr.send(fd);
  });
}

// 上传(multipart);onProgress 回报「浏览器→同源服务器」字节比例(0..1),仅字节上传阶段可观测;
// signal 中止时 xhr.abort() → 抛 ABORTED(删除占位卡时用)。fetch 无 upload 进度事件,故必须用 XHR。
export function uploadCanvasItem(
  pid: number, file: File,
  onProgress?: (ratio: number) => void, signal?: AbortSignal,
): Promise<CanvasItemData> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PREFIX}/api/projects/${pid}/canvas/items/upload`);
    xhr.withCredentials = true;   // 等价 fetch credentials:'include'(cookie 制鉴权)
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.onload = () => {
      let env: ApiResponse<CanvasItemData> | null = null;
      try { env = JSON.parse(xhr.responseText); } catch { /* 非 JSON */ }
      const ok = xhr.status >= 200 && xhr.status < 300;
      try { resolve(resolveEnvelope(env, ok, xhr.status)); }
      catch (err) { reject(err); }
    };
    xhr.onerror = () => reject(new PgcError('NETWORK', 'Network error', 0));
    xhr.onabort = () => reject(new PgcError('ABORTED', 'Upload aborted', 0));
    xhr.send(fd);
  });
}

// 下载 ZIP(二进制,经代理)
export async function downloadVersion(pid: number, vid: string): Promise<Blob> {
  const res = await fetch(`${PREFIX}/api/projects/${pid}/versions/${vid}/download`, { credentials: 'include' });
  if (!res.ok) {
    let env: ApiResponse<unknown> | null = null;
    try { env = await res.json(); } catch { /* 非 JSON */ }
    resolveEnvelope(env, false, res.status);   // 必抛;走统一解析才有 failure / request_id,不重复造判定
  }
  return res.blob();
}
