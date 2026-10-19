// GA4 事件目录:事件名 + 每事件"专有参数"类型(公共 6 参由 track 自动补齐,不在此列)。
// 集中真相源,调用点在编译期即锁定参数名/取值,满足设计稿 §5.1 自测口径。
export type Modality = 'image' | 'video' | 'audio' | '3d';
export type FailReason = 'build_error' | 'timeout' | 'insufficient_credit' | 'server_error' | 'content_blocked';
export type UploadKind = 'image' | 'video' | 'audio' | 'text' | '3d';

export interface GA4EventParams {
  page_view: Record<string, never>;
  chat_message_submit: { model?: string; project_id?: string };
  model_switch: { model_from: string; model_to: string };
  game_generate_success: { version_id: string; version: number; game_id?: string; generate_duration: number; project_id?: string };
  game_generate_fail: { fail_reason: FailReason; game_id?: string; project_id?: string };
  asset_generate_submit: { modality: Modality; model?: string; project_id?: string };
  asset_generate_success: { modality: Modality; model?: string; asset_id: string; generate_duration: number; project_id?: string };
  asset_generate_fail: { modality: Modality; model?: string; fail_reason: FailReason; project_id?: string };
  asset_upload: { kind: UploadKind; project_id?: string };
  game_share_click: { target: 'link' | 'rezona' | 'apk' | 'workbench'; project_id?: string };
  game_link_copy: { game_id?: string; project_id?: string };
  // target 的 apk/aab 是同一条导出链路的两种产物格式(后端同一套 apk-builds 端点);
  // steam 是另一族端点(desktop-builds),产 Windows 桌面 SteamPipe 内容包
  // rezona_mode 仅 target=rezona 时带:create=创建新游戏,update=给已导入游戏发新版本
  game_export_submit: {
    target: 'rezona' | 'apk' | 'aab' | 'steam'; project_id?: string; version_id: string; rezona_mode?: 'create' | 'update';
  };
  // APK 下载:local=当前设备下载,qr=扫码(前端只埋点本地按钮点击;扫码下载发生在手机端不可见)
  game_apk_download: { target: 'local'; project_id?: string };
  // 桌面内容包下载:不复用 game_apk_download —— 那条的 target 语义是「下载方式」(local/qr),
  // 而桌面链路只有一种(浏览器原生下载 138MB 流),硬塞进去会让 target 这一维失去含义
  game_desktop_download: { project_id?: string };
  // tier/variant 是订阅升购弹窗引入的:同一 trigger 下弹的可能是单卡升档、三档并排或积分充值,
  // 不带这两维就分不清曝光的是哪一种(spec §埋点)。旧充值链路不下发,故为 optional。
  out_of_credits_show: { trigger: string; tier?: string; variant?: 'plan' | 'topup' | 'all_plans' };
  out_of_credits_recharge_click: { trigger: string };
  // 订阅升档点击:tier=点击时所在档,target_tier=目标档;from 区分单卡升购与完整订阅弹窗
  subscribe_click: {
    trigger: string; tier: string; target_tier: string;
    billing_period: string; from: 'upsell' | 'all_plans';
  };
  // 回放 onboarding 三事件(koubou-agent-py PR#129 §6):完成率 = complete/start,续作发起率 = continue/complete
  replay_start: { template_id: string; project_id?: string };
  replay_complete: { template_id: string; skipped: boolean; project_id?: string };
  replay_continue_first_message: { template_id: string; project_id?: string };
}
export type GA4EventName = keyof GA4EventParams;
