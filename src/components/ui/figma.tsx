// 从 Figma 8:1373 导出的设计资源:已按各图标的设计框尺寸(16/20px)重取景、
// 字形居中保宽高比,并按设计语义命名(public/figma/icons/)
import { assetPath } from '@/lib/basePath';

// /game 部署下静态资源需补 basePath（见 src/lib/basePath.ts）
const F = assetPath('/figma/icons');

export const figAsset = {
  logo: `${F}/logo.svg`,
  search: `${F}/search.svg`,
  chevronDown: `${F}/chevron-down.svg`,
  plus: `${F}/plus.svg`,
  at: `${F}/at.svg`,
  // composer 工具列的 skill 手动入口(`</>`):与 fileCode 区分 —— 后者带文件框、语义是预览区的代码文件
  code: `${F}/code.svg`,
  arrowUp: `${F}/arrow-up.svg`,
  share: `${F}/share.svg`,
  forward: `${F}/forward.svg`,
  // 回放控制条跳到末尾(Figma 3625:45904 skip-forward)
  skipForward: `${F}/skip-forward.svg`,
  download: `${F}/download.svg`,
  // 预览区全屏展示(新页签打开当前版本)
  fullscreen: `${F}/fullscreen.svg`,
  // 预览舞台设备切换(spec 2026-10-19-preview-mobile-device):手机 = 竖屏 282:519 框,显示器 = 16:9 封顶
  deviceMobile: `${F}/device-mobile.svg`,
  deviceDesktop: `${F}/device-desktop.svg`,
  // 两侧边栏的常驻开关入口(spec 2026-08-18-sidebar-toggle-entries):
  // panelLeft 收起对话栏;expand/collapseCorners 是预览「全宽 ↔ 恢复」的两态。
  // 四角 L 形而非 fullscreen 的对角双箭头 —— 后者已被上面那个「新页签全屏」占用,同屏两个必混淆
  panelLeft: `${F}/panel-left.svg`,
  expandCorners: `${F}/expand-corners.svg`,
  collapseCorners: `${F}/collapse-corners.svg`,
  refresh: `${F}/refresh.svg`,
  repeat: `${F}/repeat.svg`,
  sparkle: `${F}/sparkle.svg`,
  // 对话模型选择器:各家官方品牌字形。Claude 星芒取自 Simple Icons(品牌 terracotta,original 渲染);
  // OpenAI/Grok/Seed(豆包)取自 LobeHub 官方图标包(单色,primary 随主题翻转)
  modelClaude: `${F}/model-claude.svg`,
  modelOpenai: `${F}/model-openai.svg`,
  modelGrok: `${F}/model-grok.svg`,
  modelSeed: `${F}/model-seed.svg`,
  modelKimi: `${F}/model-kimi.svg`,
  modelGlm: `${F}/model-glm.svg`,
  // Rezona 绑定弹窗 store 徽章字标(apple 恒白 / google play 品牌四色,均 original 渲染)
  appleLogo: `${F}/apple-logo.svg`,
  googlePlay: `${F}/google-play.svg`,
  pencil: `${F}/pencil.svg`,
  trash: `${F}/trash.svg`,
  undo: `${F}/undo.svg`,
  cursor: `${F}/cursor.svg`,
  hand: `${F}/hand.svg`,
  text: `${F}/text.svg`,
  image: `${F}/image.svg`,
  video: `${F}/clapperboard.svg`,
  audio: `${F}/waveform.svg`,
  threeD: `${F}/planet.svg`,
  // 3D 扩展菜单(Figma 5149:69310):生成可动角色 / 重新纹理(mask 重着色随主题)
  threeDRotate: `${F}/3d-rotate.svg`,
  grid: `${F}/grid.svg`,
  upload: `${F}/upload.svg`,
  map: `${F}/map.svg`,
  minus: `${F}/minus.svg`,
  frame: `${F}/frame.svg`,
  tidy: `${F}/tidy.svg`,
  gamepad: `${F}/gamepad.svg`,
  // 画布资产库占位按钮(左上)/ 类型过滤按钮(右下)/ 预览区 credit 闪电
  assetLibrary: `${F}/asset-library.svg`,
  filter: `${F}/filter.svg`,
  credit: `${F}/credit.svg`,
  // 预览区 Preview/Files tab + 文件浏览(file/code)
  eyeShow: `${F}/eye-show.svg`,
  folder: `${F}/folder.svg`,
  globe: `${F}/globe.svg`,
  chevronRight: `${F}/chevron-right.svg`,
  fileJson: `${F}/file-json.svg`,
  fileCode: `${F}/file-code.svg`,
  checkCircle: `${F}/check-circle.svg`,
  warningSign: `${F}/warning-sign.svg`,
  arrowDown: `${F}/arrow-down.svg`,
  // 全局 Toast:三型状态图标(双色 baked,original 渲染)+ 通用关闭 X
  toastError: `${F}/toast-error.svg`,
  toastSuccess: `${F}/toast-success.svg`,
  toastWarning: `${F}/toast-warning.svg`,
  close: `${F}/close.svg`,
  // 问答卡片(AskUserQuestion)问题行前的问号
  question: `${F}/question.svg`,
  // 生成面板高级设置(Figma adjustments,1743:31330)
  adjustments: `${F}/adjustments.svg`,
  // 生成面板画布点选引用(Figma cursor box arrow,396:17853)
  cursorBox: `${F}/cursor-box.svg`,
  // 充值弹窗倒计时(Figma Timer,3625:38256;mask 重着色,置于粉色 chip 上时容器给 text-white)
  timer: `${F}/timer.svg`,
  // 积分不足弹窗 view-all 文字链箭头(Figma arrow-right,3082:41247;mask 重着色随容器色)
  arrowRight: `${F}/arrow-right.svg`,
  // 分享弹窗复制按钮两态(复制/已复制;mask 重着色随按钮文字色,btn-raised 上呈固定深色)
  copy: `${F}/copy.svg`,
  // 卡片右键菜单的「Details」项(spec 2026-08-20;库里原先没有 info 语义的图标 ——
  // question 是「帮助」、adjustments 已被生成面板高级设置占用)
  info: `${F}/info.svg`,
  // 分享菜单导出组的两枚产物图标(spec 2026-08-20 那批菜单项原先借用 folder / download 通用字形,
  // 看不出产物是什么):fileZip=归档箱(整包 ZIP)· android=机器人头(APK 直装包)。
  // 库里原先没有这两个语义 —— Figma 未出稿,按现有 16×16 / stroke-width 1.5 / 圆头圆角的字形规格补画
  fileZip: `${F}/file-zip.svg`,
  android: `${F}/android.svg`,
  // Steam 内容包导出项(spec 2026-08-26)。与 googlePlay 同位:同为「交到某个外部店」的目的地,
  // 故同样是**品牌 original 渲染**。路径取自 Simple Icons(CC0)的官方标,填 Steam 调色板蓝灰
  // #2A475E、阀门镂空透底 —— 取色理由见 steam.svg 内注释
  steam: `${F}/steam.svg`,
  check: `${F}/check.svg`,
} as const;

// 图标语义色:决定主题感知方式。
// - primary  : 随容器 currentColor(默认 --color-ink),浅色稿深、深色稿浅,自动翻转
// - secondary: 恒为 --color-muted 灰(浅/深主题同灰,对应设计里 #7B7B7B 的次要图标)
// - original : 保留 SVG/PNG 原配色(彩色 logo 等)
type IconTone = 'primary' | 'secondary' | 'original';

// SVG 内联 fill/stroke 注入不进外部 CSS 变量,作为 <img> 永远是浅色稿的深色,
// 故深色主题下需用 CSS mask 以 currentColor 重新着色。此表集中登记各图标语义。
const ICON_TONE: Record<string, IconTone> = {
  // @ 在画布右键菜单/资产动作里是次级图标 → 恒灰;composer 工具列那颗与 + 同层级,
  // 在使用处显式传 tone='primary' 随文字色(见 Composer.tsx)。
  // figAsset.code 只有 composer 用且同样显式传 primary,故不在此登记(默认即 primary)
  [figAsset.at]: 'secondary',
  [figAsset.search]: 'secondary',
  [figAsset.chevronDown]: 'secondary',
  [figAsset.undo]: 'secondary',
  [figAsset.gamepad]: 'secondary', // 版本封面 fallback 手柄,恒 --color-muted 灰
  // 文件树/面包屑里的次要图标恒灰;tab 内用时显式传 tone='primary' 随文字翻转
  [figAsset.folder]: 'secondary',
  [figAsset.globe]: 'secondary',
  [figAsset.chevronRight]: 'secondary',
  [figAsset.fileJson]: 'secondary',
  [figAsset.fileCode]: 'secondary',
  [figAsset.arrowDown]: 'secondary',
  [figAsset.sparkle]: 'secondary', // thinking 完成态图标,恒 --color-muted 中性灰(非成功/失败语义)
  // 项目菜单改名/删除:设计稿为白色字形(白 fill SVG)。走 mask 以 currentColor(=--color-ink)重着色:
  // 深色稿呈白(#fcfcfc,对齐设计 Text/Primary),浅色稿自动翻为深色,避免白图标贴白底不可见。
  [figAsset.pencil]: 'primary',
  [figAsset.trash]: 'primary',
  [figAsset.logo]: 'original',
  [figAsset.appleLogo]: 'original',   // 徽章恒灰底白标,不随主题重着色
  [figAsset.googlePlay]: 'original',  // 品牌四色
  // 蓝灰圆底 + 镂空阀门。走 mask 重着色会丢掉品牌色,与相邻 AAB 项的品牌标失去分层
  // (那两项都是「交到某个外部店」)
  [figAsset.steam]: 'original',
  [figAsset.modelClaude]: 'original', // 官方品牌色 #D97757,不随主题重着色
};

// 设计图标,size 单位 px;flipX 用于 redo(undo 镜像)。
// tone 默认按 ICON_TONE 表自动解析,可显式覆盖。
export function FigIcon({
  src,
  size = 20,
  className = '',
  flipX = false,
  tone,
}: {
  src: string;
  size?: number;
  className?: string;
  flipX?: boolean;
  tone?: IconTone;
}) {
  const resolved = tone ?? ICON_TONE[src] ?? 'primary';

  // original:保留原配色(彩色资源 / 语义色),仍走 <img>
  if (resolved === 'original') {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={className}
        style={{ width: size, height: size, ...(flipX ? { transform: 'scaleX(-1)' } : null) }}
      />
    );
  }

  // primary/secondary:用 mask 把单色字形裁出,再用主题色填充 → 随主题翻转
  const color = resolved === 'secondary' ? 'var(--color-muted)' : 'currentColor';
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMask: `url("${src}") center / contain no-repeat`,
        mask: `url("${src}") center / contain no-repeat`,
        ...(flipX ? { transform: 'scaleX(-1)' } : null),
      }}
    />
  );
}
