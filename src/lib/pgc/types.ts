// pgc-server OpenAPI 的 TS 镜像子集(前端用)

export interface ApiResponse<T> {
  success: boolean;
  code: string;
  message: string;
  data: T | null;
  // 生成类被前置拒绝(如内容审核 422)时,错误信封顶层带结构化失败详情;非生成类错误为 null
  failure?: CanvasGenFailure | null;
  request_id?: string;
}

export interface ProjectData {
  id: number;
  public_id: string;       // 对外不可枚举标识(Sqids 纯字母);正式 URL / 寻址一律用它
  name: string;
  cover_url: string | null;
  cover_source: string | null;
  current_version_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}
export interface ProjectListData { items: ProjectData[]; total: number; page: number; page_size: number; }

export interface CanvasItemData {
  id: number;
  item_id: string;
  type: string;            // image | video | audio | model3d | text
  name?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  status: string;          // ready | generating | failed
  reference?: unknown | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
  content?: string | null;       // 文本节点:正文内联落 DB,url 恒空
  text_format?: string | null;   // markdown | plain
  failure?: CanvasGenFailure | null;
  metadata?: unknown | null;      // PGC 结构化资产元数据；按资产类型在映射层做窄化
  // 所属分组框(grp-*),未入框为 null。**顶层字段**,不是 reference.group_id ——
  // reference 由前端整体覆盖写,归属放里面用户拖一下卡就没了;顶层列还让服务端删框时一条 SQL 清干净成员
  group_id?: string | null;
  // 建卡时间(UTC,tz-aware),后端**必填**(pgc canvas.py 的 CanvasItemData)。
  // 它是「什么时候」的唯一服务端口径 —— reference.provenance.at 记的是前端导入/登记时刻,
  // 只覆盖前端新生成的那批,两者不可互相顶替
  created_at: string;
}
// groups 是**三态**,不可混:
//   null / 字段缺失 = 分组功能未开(pgc-canvas-groups flag 关,服务端不查 canvas_groups)
//   []             = 开了但一个框都没建
//   非空            = 有框
// 前端据「是否为 null」决定要不要渲染整套分组 UI
export interface CanvasItemListData { items: CanvasItemData[]; total: number; groups?: CanvasGroupData[] | null; }

// ---- 分组框(容器实体;pgc-canvas-groups flag 门控,关时四个端点 503 CANVAS_GROUPS_DISABLED) ----
// 归属落在 canvas item 的**顶层 group_id**,不是 reference.group_id ——
// reference 由前端整体覆盖写,归属放里面用户拖一下卡就没了
export interface CanvasGroupData {
  group_id: string;        // 项目内稳定 id grp-*,服务端生成
  name: string;            // 1..255
  canvas_x: number; canvas_y: number;
  width: number; height: number;
  // 后端字段(原样存取、不校验色值),但前端不读不写:框色已统一为品牌青、不由数据驱动
  // (spec 2026-08-12-canvas-group-theming-and-menu 决策 1)。协议层忠实保留,便于将来复用
  color?: string | null;
  collapsed: boolean;
  created_at: string; updated_at: string;
}
// 除 name 外均可省,坐标/尺寸缺省为 0(真机确认)
export interface CanvasGroupCreateRequest {
  name: string;
  canvas_x?: number; canvas_y?: number;
  width?: number; height?: number;
  color?: string | null; collapsed?: boolean;
}
export type CanvasGroupUpdateRequest = Partial<CanvasGroupCreateRequest>;
export interface CanvasGroupListData { groups: CanvasGroupData[]; total: number; }
// 生成失败的结构化原因:异步上游失败(task.failure/item.failure)与同步前置内容审核拒绝
// (错误信封顶层 failure,code=INPUT_MODERATION_REJECTED)共用同一形态;message 已本地化,直接展示
export interface CanvasGenFailure {
  code: string;             // 语义错误码,如 PROVIDER_CONTENT_POLICY_VIOLATION / INPUT_MODERATION_REJECTED
  // 分类。内容审核类恒 content_policy —— pgc 前置拦截与上游事后拦截**刻意共用**它以便统一 UI,
  // 故重试路由按 category 判而非枚举 code(见 lib/gen-retry.ts 的 retryRouteFor)
  category: string;
  message: string;          // 本地化、面向用户的可读说明
  // 「**调整后**是否可重试」,不是「能否原样重发」:内容审核类改了 prompt 就能再试,故后端给 true
  // (pgc generation_failure.py 的 failure_from_moderation / _content_policy_failure)。
  // 重试路由**不看它** —— 曾按 `retryable === false` 判「需先改参数」,与后端语义正好相反
  // (spec 2026-08-13-retry-route-content-policy)
  retryable: boolean;
  provider_code?: string | null;   // 上游原始错误码,仅作溯源
}
export interface CanvasGenTask { task_id: string; status: string; progress?: number | null; item?: CanvasItemData | null; failure?: CanvasGenFailure | null; }

// ---- 生成前估价(POST /canvas/items/generate/estimate)----
// 零副作用:不调 provider、不预留额度、不落任务行、不写画布 → ARTGEN/TRIPO 未配也能报价(不 503)。
// 报价与实扣同源:走 reserve 计价那条完全相同的路径(同一份定价目录、同一套参数映射),
// 并跟随真实路径做同样的模型回落与参数裁剪。
// 判别器叫 **type 不叫 kind**:音频入参自己就有 kind(auto/speech/music/sound),会撞名。
export type CanvasEstimateType = 'image' | 'video' | 'audio' | 'model3d' | 'sprite' | 'rig3d' | 'retexture';
// 其余字段与对应生成端点的入参**完全同构**(扁平形态,真机已确认;不是 { type, image: {...} } 嵌套),
// 故用索引签名承接 —— 前端直接把 buildGenBody 的产物拍过来,不维护第二套映射
export interface CanvasEstimateRequest { type: CanvasEstimateType; [k: string]: unknown }
export interface CanvasEstimateData {
  type: string;                    // 回显
  credits?: number | null;         // 确定值
  credits_min?: number | null;     // 区间(参数还定不下唯一价格时;当前唯一来源是音频 kind=auto)
  credits_max?: number | null;
  currency: string;                // 恒 'credit'
  model_id?: string | null;        // 计价所用的定价目录模型 id(排障/对账用)
  billable: boolean;               // 该用户当前是否**真的会被扣费**(计费双闸门);灰度期 flag 关时报价照给但为 false
}

export interface VersionData {
  version_id: string;
  seq: number;
  title: string;
  // 至少含 ready(已 build)与 building(构建中);值域未经后端收敛,前端一律按 `!== 'ready'` 视为未就绪(fail-closed)。
  // 该端点**会**返回构建中的版本、且此时 created_at 为空 —— 依据是缺陷 14391311 的线上现象(时间戳缺失 +
  // 发布 CTA 置灰同时出现),尚未经后端文档确认。
  status: string;
  cover_url?: string | null;   // 版本封面图;相对 /preview/... 由 resolveAssetUrl 拼齐,缺失回退色块
  preview_url?: string | null;
  source_version_id?: string | null;
  created_at?: string | null;
  is_current?: boolean;
}
export interface VersionListData { items: VersionData[]; total: number; }

// 按版本区段拆分的实际 credits 消费(端点 GET /api/projects/{pid}/versions/credits)。
// 区段按**定稿时刻切段**归因(闭开区间 (from, to],to = 该版本 dist/index.html 对象时间);
// 末段是「在途」(version_id / to 为 null,尚未构建成下一版)。
export interface VersionCreditsSegment {
  version_id: string | null;
  from?: string | null;
  to?: string | null;
  asset_credits?: number;          // 资产生成消费,恒有值(缺省 0)
  // ⚠️ 下面两个在多种情况下为 null——后端明确**不编数**:计费未启用 / PAT 凭据调用、上游取数
  // 失败或流水缺归因维度、流水拉不完(超 100×30 条或超 5s 预算)、该账号动用过首创免费额度
  // (促销消费不进真实钱包流水)。notes 说明是哪一种。前端不得回落 asset_credits 冒充全量。
  llm_credits?: number | null;     // koubou 对话 LLM 消费
  total_credits?: number | null;   // asset + llm,前端唯一采信的展示口径
  by_type?: Record<string, number>;   // 资产消费按类型细分(当前未用)
}
export interface VersionCreditsData { items: VersionCreditsSegment[]; notes: string[]; }

// 版本源码文件清单(file/code 只读浏览,仅 src/、不含 dist/)。内容不内联:
// 用 preview_url(opaque /pv 字节链)经 resolveAssetUrl 按需取。
export interface VersionFileData { path: string; size: number; preview_url: string; }
export interface VersionFilesData { version_id: string; items: VersionFileData[]; total: number; }

export interface UserData { id: number; email: string; name: string; }
export interface TokenData { access_token: string; token_type?: string; }
// 当前登录用户(biz-api /tln/biz/me 自省):id 即 new-api user id;status 非 1 视为封禁/异常。无头像 URL → 首字母回退
export interface CurrentUser {
  id: number;
  username: string;
  display_name?: string | null;
  email?: string | null;
  group?: string | null;
  role?: number | null;
  status?: number | null;
}
// 新用户判定(pgc docs/api/auth.md「/api/auth/me/new-user-status」)。
// 口径:新用户 = 自建项目(默认只含 prompt / mcp 两种创建方式)中没有任何一个 build 出过版本。
// 判不出来时后端返 503(存储不可用 / 扫描触界 / 迁移项目归因不明)而**不降级**——
// 调用方应把失败当「暂时不知道」,不得当新用户。
export interface NewUserStatusData {
  user_id: number;
  is_new_user: boolean;
  modes: string[];                          // 本次采用的「自建」口径(回显)
  self_authored_project_count: number;      // 含之后被软删的项目,与 /api/projects 数量会合理不一致
  scanned_project_count: number;            // 真正探过存储的项目数(命中已 build 会提前短路)
  built_project_public_id?: string | null;  // 命中的那个已 build 项目;is_new_user=true 时为 null
  notes?: string[];
}

// 账户余额。**展示一律用 `spendable`**,后端文档明写「展示用 spendable,勿本地推导」
// (pgc docs/api/credits.md「余额」章 + docs/deploy/credit-frontend-agent-integration.md)。
// balance 是账面总额,其中 held 已被在飞的异步生成预留、花不出去;计费是 hold 模型
// (reserve 增 held → 成功 settle 减 balance / 失败 release 减 held),所以只有 spendable
// 是「当前钱包视图」。显示 balance 会让用户被 402 拦下时看到一个自相矛盾的数字。
// 也不要本地算 balance - held —— 文档明禁,以服务端返回值为准。
export interface BalanceData { balance: number; held: number; spendable: number; }

export interface VoiceData { voice_id: string; display_name: string; labels?: string | null; sample_url?: string | null; }
export interface VoiceListData { voices: VoiceData[]; total: number; }

// 请求体
export interface CreateProjectRequest { name: string; }
// auto-name 结果:项目当前数据 + 是否真的自动改了名(false=名字已非默认/LLM 失败等 no-op)
export interface AutoNameData extends ProjectData { renamed: boolean }

export interface UpdateProjectRequest { name?: string | null; cover_url?: string | null; current_version_id?: string | null; }

// Remix:基于公开源游戏 fork 一份当前用户的新可编辑项目(POST /api/remixes)
export interface CreateRemixRequest { source_code: string; version_id?: string | null; name?: string | null; }
export interface RemixProjectData {
  project: ProjectData;        // 新 fork 项目,寻址用 public_id
  source_code: string;
  source_version_id: string;
  target_version_id: string;
  play_url: string;
  working_preview_url: string;
}
// Remix 策略(owner 自助开关,GET / PATCH /api/projects/{id}/remix-policy)。
// enabled=false 时 source_version_id / remix_url / display_* 恒为 null(后端契约 docs/api/remix.md)。
// remix_url 指向工作台 fork 入口 {host}/game?remix={code},本仓刻意不进 UI(见设计稿 2026-08-28-share-remix-toggle)。
export interface RemixPolicyData {
  enabled: boolean;
  source_code: string;
  source_version_id: string | null;
  remix_url: string | null;
  display_title: string | null;
  display_description: string | null;
}
// enabled=true 时 version_id 必填且只能是已 build 的稳定版本 v{n};关闭时**省略**该字段
// (传 null/空串会撞 422)。display_* 本轮不传。
export interface UpdateRemixPolicyRequest { enabled: boolean; version_id?: string; }

export interface CanvasGenImageRequest {
  prompt: string;
  model?: string | null;
  size?: string;
  // 以下 quality/background/output_format/output_compression/moderation/input_fidelity 均为 gpt-image-2 专属;Gemini 系列传入会 422
  quality?: 'low' | 'medium' | 'high' | 'auto';
  background?: 'opaque' | 'auto' | null;    // transparent 后端 422,不下发
  output_format?: 'png' | 'jpeg' | null;
  output_compression?: number | null;   // 0-100,仅 jpeg
  moderation?: 'auto' | 'low' | null;
  input_fidelity?: 'low' | 'high' | null;  // 仅图生图路径生效
  watermark?: boolean | null;           // 仅 Seedream:AIGC 水印
  prompt_mode?: 'standard' | 'fast' | null;  // 仅 Seedream:提示词优化档(standard 质量高但单图 >120s)
  n?: number;                           // 1-4;Seedream 仅支持 1
  source_item_id?: string | null;
  source_item_ids?: string[] | null;    // 多图合成 ≤8,与 source_item_id 服务端合并去重
  name?: string | null;
}
export interface CanvasGenAudioRequest {
  prompt: string;
  model?: string | null;                // 不传=Noiz;'seed-audio-1.0' 走 BytePlus Seed-Audio
  kind?: 'auto' | 'speech' | 'music' | 'sound';
  expand?: boolean;
  voice_id?: string | null;             // 仅 speech;music/sound 下传入 422。Seed-Audio 的音色属另一命名空间(不在 /voices 列表),故该模型下不下发
  output_format?: 'mp3' | 'wav';
  speed?: number | null;                // 0.25-4,仅 speech
  duration?: number | null;             // speech 0-72 目标时长;music/sound 成品长度上限随 provider(Noiz 30 / Seed-Audio 120)
  quality_preset?: number | null;       // 1-10,仅 speech
  emo?: Record<string, number> | null;  // 仅 speech;本期 UI 不露出
  target_lang?: string | null;          // 仅 speech
  trim_silence?: boolean | null;        // 仅 speech
  similarity_enh?: boolean | null;      // 仅 speech
  // 以下四项仅 seed-audio-1.0(Noiz 上忽略);reference_item_ids / reference_image_item_id
  // (音色克隆 / 按图配音)属引用交互,另轮接入,此处先不落类型
  sample_rate?: number | null;          // 8000/16000/24000/32000/44100/48000
  pitch_rate?: number | null;           // -12..12,仅 speech(显式 music/sound 传入 422)
  loudness_rate?: number | null;        // -50..100
  watermark?: boolean | null;           // AIGC 显式水印
  // 以下六项仅音乐模型(suno-music)。本仓无 openapi codegen,手写对齐服务端 CanvasGenAudioRequest。
  // 音乐模型不接受 duration —— 整曲长度由上游定,显式传入会被拒,故 gen-params 不给它 duration 字段
  genre?: string | null;                // 曲风。四个预设是**建议值非闭集**(canonical 类型为 string 不校验成员),可自填
  mode?: 'instrumental' | 'lyrics';     // 纯器乐 / 加歌词;默认 instrumental,与网关目录缺省一致
  lyrics_mode?: 'ai' | 'custom';        // 仅 mode=lyrics
  lyrics?: string | null;               // 仅 mode=lyrics 且 lyrics_mode=custom
  vocal_gender?: 'auto' | 'male' | 'female';  // 仅 mode=lyrics
  title?: string | null;                // 仅 mode=lyrics
  name?: string | null;
}
export interface CanvasGenVideoRequest {
  prompt: string;
  model?: string | null;
  seconds?: number | null;              // 1-30
  resolution?: '480p' | '720p' | '1080p' | null;
  ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive' | null;
  seed?: number | null;
  watermark?: boolean | null;
  camera_fixed?: boolean | null;
  source_item_id?: string | null;       // 首尾帧模式:首帧
  last_frame_item_id?: string | null;   // 首尾帧模式:尾帧
  ref_image_item_ids?: string[] | null; // omni 模式 ≤9;与首尾帧互斥(并存 422)
  ref_video_item_ids?: string[] | null; // omni 模式 ≤3
  name?: string | null;
}
export interface CanvasGenModel3DRequest {
  prompt: string;
  source_item_id?: string | null;       // 给定走图生 3D
  model_version?: string | null;
  negative_prompt?: string | null;
  texture?: boolean | null;
  pbr?: boolean | null;
  texture_quality?: 'standard' | 'detailed' | null;
  face_limit?: number | null;           // ≥1
  quad?: boolean | null;
  style?: string | null;
  auto_size?: boolean | null;
  smart_low_poly?: boolean | null;
  model_seed?: number | null;
  texture_seed?: number | null;
  image_seed?: number | null;
  texture_alignment?: 'original_image' | 'geometry' | null;  // 仅图生 3D,纯文生传入 422
  orientation?: 'default' | 'align_image' | null;            // 仅图生 3D
  name?: string | null;
}
export interface Rig3DPrecheckRequest { source_item_id: string; }
export interface Rig3DPrecheckData {
  riggable: boolean;
  cached: boolean;
  // 骨架拓扑(biped/quadruped/...);null 表示上游未判定
  rig_type: string | null;
  // 该拓扑的可选烘焙动作全集(后端唯一真相,前端据此渲染动作选择器);不可绑时为空
  animation_presets: string[];
  // 默认预选子集(打开表单时勾选这些);不可绑时为空
  default_animations: string[];
}
export interface CanvasGenRig3DRequest {
  source_item_id: string;
  animations?: string[] | null;  // preset:*，最多 5 个
  name?: string | null;
}
export interface CanvasGenRetextureRequest {
  source_item_id: string;
  text_prompt?: string | null;
  image_prompt_item_id?: string | null;
  style_image_item_id?: string | null;
  texture?: boolean | null;
  pbr?: boolean | null;
  texture_quality?: 'standard' | 'detailed' | null;
  texture_alignment?: 'original_image' | 'geometry' | null;
  name?: string | null;
}
export interface CanvasUpdateRequest { reference?: unknown | null; canvas_x?: number | null; canvas_y?: number | null; name?: string | null; content?: string | null; text_format?: string | null; group_id?: string | null; }
// 批量更新(PATCH /canvas/items):字段集与单条 PATCH 完全同构,多一个 item_id 定位。
// 单次 1..500 条,超出**整批 422**(用法错误,不做半吞);重复 item_id 按出现顺序后者胜。
export interface CanvasBatchUpdateItem extends CanvasUpdateRequest { item_id: string; }
export interface CanvasBatchUpdateRequest { items: CanvasBatchUpdateItem[]; }
// 逐项失败:成功的已落库(每条独立 SAVEPOINT),失败的在 failed[] 里逐条回报而非整批 4xx。
// code 取值:CANVAS_ITEM_NOT_FOUND / CANVAS_GROUP_NOT_FOUND / CANVAS_TEXT_FIELD_INVALID /
// CANVAS_ITEM_UPDATE_FAILED(兜底)。均为服务端已裁决的结果,重试打不通 → 一律不重试。
export interface CanvasBatchUpdateFailure { item_id: string; code: string; message: string; }
export interface CanvasBatchUpdateData { updated: number; failed: CanvasBatchUpdateFailure[]; }
// 文本画布节点创建:content 原样落 DB(verbatim),同步返回 ready 项;超业务上限 422 CANVAS_TEXT_TOO_LONG
export interface CanvasTextCreateRequest { content: string; text_format?: 'markdown' | 'plain'; name?: string | null; reference?: unknown | null; canvas_x?: number | null; canvas_y?: number | null; }
export interface CanvasWriteFromUrlRequest {
  source_url: string;       // http/https 资源地址(如 agent 资产的 preview_url),pgc server-side 拉取写入画布桶
  type?: 'image' | 'video' | 'audio' | 'model3d' | 'text' | null;
  name?: string | null;
  reference?: unknown | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
}

// ---- Rezona 发布(见 docs/.../2026-08-12-rezona-publish-direct-design.md;账号绑定由服务端在发布时自行完成) ----
export interface RezonaPublishRequest {
  version_id: string;          // v{n};须已 build 的稳定版本,current 会被拒
  name: string;                // 1..255
  summary?: string;            // ≤2000
  cover_ref?: 'version_cover'; // 契约本期只收这一个值,远程 URL / asset id 会被拒,故收成字面量类型
  public: boolean;
  sync_to_community: boolean;  // remixable 不再传:后端恒发 false 并忽略该字段(契约 §7)
  // 缺省=创建新游戏;传入=给本项目已导入的该游戏发新版本。参与幂等指纹,换目标须换 idempotency_key
  game_id?: number;
  idempotency_key?: string;    // 可空,缺则服务端生成
}
export interface RezonaPublishResultData { share_url: string; rezona_work_id: string }
// 本项目已导入到 App 的游戏(GET /projects/{pid}/rezona/games):后端按 last_published_at 倒序,
// 已从 App 删除的不返回
export interface RezonaGameData {
  game_id: number;
  // App 侧当前游戏名,由发布服务实时带回(App 内改名能跟上,pgc 不落库)。best-effort:
  // 上游旧版本 / 坏条目 / 空名一律 null(后端 PR #129),展示须回落编号
  game_name: string | null;
  share_url: string;
  version_ids: string[];       // 已发布到该游戏的 v{n},后端已去重并按自然版本号升序
  first_published_at: string;
  last_published_at: string;
}
export interface RezonaGameListData { items: RezonaGameData[] }

// ---- 全局素材库(运营预置,所有登录用户同一份;契约见 apifox List Library Assets) ----
export interface LibraryAssetData {
  id: number;
  key: string;
  type: string;         // bgm/sfx/image/video/meme/audio(运营分类,tab 筛选口径)
  media_kind: string;   // 媒体形态,对应画布 import 的 type 取值域
  name?: string | null;
  url: string;          // pgc 自托管,直接交给 /canvas/items/import 的 source_url
  thumbnail_url?: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
  duration_seconds?: number | null;
  tags?: string[];
  usage?: string | null;
  use_count?: number;
}
export interface LibraryAssetListData { items: LibraryAssetData[]; total: number }
export interface LibraryAssetQuery {
  type?: string; q?: string; sort?: 'curated' | 'popular' | 'recent'; limit?: number; offset?: number;
}

// ---- 项目压缩包导入(POST /api/projects/import;契约见 apifox Import Project) ----
// 包内 src/assets/ 下识别出的可上画布资产;source_url 交 /canvas/items/import 落库
export interface ImportAssetData {
  type: string;                     // 与画布 import 的 type 同枚举(image/video/audio/model3d)
  rel_path: string;
  name: string;
  source_url: string;
  thumbnail_url?: string | null;    // 3D 缩略图 sidecar
  meta_url?: string | null;         // 3D 元数据 sidecar
}
// ProjectData 超集 + 导入版本状态/链接;导入不写 canvas_items,assets 由前端逐条登记
export interface ImportProjectData extends ProjectData {
  version_id: string;
  version_status: string;           // ready(含 dist/index.html) | needs_build
  play_url: string;
  preview_url: string;
  file_count: number;
  assets: ImportAssetData[];
}

// ---- APK 导出(Apifox 8405123 apk/*;契约见 docs/api/apk.md)----
export type ApkBuildStatus = 'queued' | 'building' | 'succeeded' | 'failed';
// 产物格式:apk=侧载安装,aab=Google Play App Bundle(用户自传自己的 Play 应用)
export type ApkOutputFormat = 'apk' | 'aab';
// 发起构建请求体;package_name 缺省服务端派生,icon_item_id 缺省用默认图标。
// output_format / version_name / version_code 三者 apk 可省、**aab 必填**(缺任一 422);
// 三者均参与幂等身份 —— 故 apk 分支一律不带(凭空加键会让老作业幂等不命中、重复构建重复计费),
// 装配这一层收在纯函数 buildApkRequest 里,类型上保持全可选
export interface ApkBuildRequest {
  version_id: string;               // 稳定版本 v{n}
  name: string;                     // APK 桌面显示名(1..64)
  package_name?: string;
  icon_item_id?: string;
  output_format?: ApkOutputFormat;
  version_name?: string;            // Play 商店页显示版本串(1..50)
  version_code?: number;            // 1..2_100_000_000;服务端计数器只升不降
}
export interface ApkBuildData { build_id: number; status: ApkBuildStatus }
export interface ApkBuildStatusData {
  build_id: number;
  status: ApkBuildStatus;
  failure_category: string | null;  // 仅 failed 非空(中文:资源过大/构建超时/系统错误)
  download_available: boolean;
  networked: boolean;               // true=游戏含活后端调用,结果页提示需联网
  version_code: number | null;
  // 以下三项由 aab 扩展引入;老作业/老后端可能不回,故可选。回显一律以此为准而非本地输入
  // (服务端 versionCode 计数器只升不降,可能顶高用户填的值)
  output_format?: ApkOutputFormat;
  package_name?: string | null;
  version_name?: string | null;
}
// 免登录能力式下载链接(本地下载 + 扫码共用);每次签发轮换 token
export interface ApkDownloadLinkData { download_url: string }

// ---- 桌面(Windows / Steam)导出(契约见后端 docs/api/desktop.md)----
// 与 apk-builds 同形但**不是同一族端点**:产物是 138MB 量级的 SteamPipe 内容包 zip,
// 无签发端点(下载即带鉴权的二进制流,故此处没有 DownloadLinkData 对应物)
export type DesktopBuildStatus = 'queued' | 'building' | 'succeeded' | 'failed';
// 只有两个字段:name 是**显示名**(1..64),exe 名由后端取其 ASCII 部分派生 —— 前端不复刻该规则
export interface DesktopBuildRequest { version_id: string; name: string }
export interface DesktopBuildData { build_id: number; status: DesktopBuildStatus }
export interface DesktopBuildStatusData {
  build_id: number;
  status: DesktopBuildStatus;
  failure_category: string | null;  // 仅 failed 非空(后端直出中文短语)
  download_available: boolean;      // 为真才可调下载端点
  package_size: number | null;      // 成功后有值;138MB 量级是 Electron 运行时地板价
  // 打包前静态扫出的**会导致离线白屏**的远程引用条数(远程 script/importmap/wasm/glb/pck…);
  // 装饰性引用与活后端调用不计入。>0 只作提示,**不得拿它硬拦截构建**(准入行为后端未拍板);
  // 该口径 2026-08-24 才改,历史作业的值不可用 —— 只读当次作业回值,不做统计
  external_ref_count: number;
}

// ---- 回放 onboarding(Apifox 8405123 replay/*;契约见 Start/Finalize/Update Replay) ----
// start:为当前用户建回放专属 project;status ∈ provisioning|ready|completed;不回源三元组
export interface ReplayStartData { target_project_id: number; template_id: string; status: string }
// finalize / state 回执
export interface ReplayProjectStateData { project_id: number; status: string }

// ---- 分享工作台(Share workbench;三仓协同,契约见 docs/plans/2026-07-21-002-feat-share-workbench-plan.md U2/U3)----
// owner 侧策略回执(GET / PUT):enabled=是否开启;share_url=可复制链接({workspace_base}?share={public_id});
// source_session_id=开启时钉扎的活跃会话;capability_hint=能力风险提示(链接持有者可复制含对话的完整工作台);
// source_code=分享短码
export interface WorkbenchShareData {
  enabled: boolean;
  share_url: string | null;
  source_session_id?: string | null;
  capability_hint?: string | null;
  source_code?: string | null;
}
// recipient 侧 open 回执:target_project 为新建目标项目的完整 ProjectData(含 .id 数字主键与 .public_id 对外标识);
// source_* 为服务端钉死的源三元组;share_token=签发给 koubou clone-from-share 的短时凭证;
// idempotent_hit=同一 recipient 重复 open 命中既有副本;source_code=分享短码
export interface WorkbenchShareOpenData {
  target_project: ProjectData;
  source_owner_user_id: number;
  source_project_id: number;
  source_session_id: string;
  share_token: string;
  idempotent_hit: boolean;
  source_code?: string;
  // recipient 就是 owner 本人:target_project 即源项目、share_token 为空串;
  // 前端应跳过 koubou clone/finalize,直接进入原工作台(不产生副本)
  owner_self?: boolean;
}
// finalize 回执:画布复制 + 版本指针收口后置 ready
export interface WorkbenchShareFinalizeData {
  status: string;
  current_version_id: string | null;
}
