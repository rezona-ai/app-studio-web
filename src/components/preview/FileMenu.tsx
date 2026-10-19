'use client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import { track, projectPublicId } from '@/lib/analytics';

// 预览面板 File menu(Figma 1527:41218 内):锚定顶栏分享钮的下拉。
// Share Game 复用现有 SharePopover;Share to Rezona 恒显示(白名单校验已下线);
// 「导出为 APK」「导出为 Google Play Bundle」「Export as Steam package」与「Export as ZIP」
// 都归入本菜单的导出分组(spec 2026-08-20:同为「把游戏交出去」的动作,工具条上不再留第二个落点)。
// 两种 Android 产物各占一项:格式是「要交付到哪里」的分叉,在菜单层分流比进模态后再切更直白
// (spec 2026-08-24 §约束 1);Steam 内容包同理独占一项(spec 2026-08-26 §约束 1),
// 它走的是另一族端点(desktop-builds)、另一种产物(Windows 桌面应用)。
// 每项配一枚 16px 前置图标(gap-8 那道空档本就是留给它的):
// globe=公开只读直链 · pencil=对方拿到的是可编辑副本(通用 share 字形只说「分享」,
// 与上一项的只读直链区分不开,这两项的差别恰恰只在能不能改) · logo=Rezona 平台(品牌 original)
// fileZip=整包工程 ZIP · android=可直装的 APK · googlePlay=上架用的 AAB(品牌 original)
// · steam=Steam 内容包(品牌 original)。
// 三枚品牌图标刻意保原配色 —— 这几项的目的地是外部平台,与上面几项的单色字形自然分层。
// 宽度按内容自适应(w-max)而非定宽:导出项文案随语言长短差一倍,定宽 220 会把长语言截成省略号。
// 下限仍 220(英文/中文实测 238,不让菜单窄到抖动),上限 296 —— 最长的俄文「Экспортировать как
// Google Play Bundle」整行实测 292,而预览栏最窄 330(PREVIEW_WIDTH_MIN)减去账户条 px-3 左右内边距
// 只剩约 306 可用;菜单向右生长,再宽就顶出视口右缘。11 种语言实测均不截断,truncate 只做兜底。
// 范式对齐 ProjectMenu:全屏点击遮罩关闭 + anim-pop-in + pop 面 + Esc 关闭。
export default function FileMenu({
  onClose, onShareGame, onShareToRezona, onShareWorkbench,
  onExportApk, onExportAab, onExportSteam, onExportZip,
  exporting, workbenchDisabled,
}: {
  onClose: () => void;
  onShareGame: () => void;
  onShareToRezona: () => void;
  onShareWorkbench: () => void;
  onExportApk: () => void;
  onExportAab: () => void;
  onExportSteam: () => void;
  onExportZip: () => void;
  /** ZIP 在飞:该项就地转圈并禁用(菜单刻意不关,见下) */
  exporting: boolean;
  // 无当前活跃 session 时禁用「分享工作台」(R2:分享必须钉扎当前会话)
  workbenchDisabled: boolean;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const itemCls = 'flex h-[36px] w-full items-center gap-[8px] overflow-hidden rounded-[12px] px-[8px] py-[6px] text-left transition-colors hover:bg-[var(--color-fill)]';
  const labelCls = 'min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[var(--color-ink)]';

  return (
    <>
      <div className="fixed inset-0 z-40" aria-hidden="true" onClick={onClose} />
      <div className="anim-pop-in origin-top-left absolute left-0 top-[calc(100%+4px)] z-50 flex w-max min-w-[220px] max-w-[296px] flex-col items-start overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-[8px] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
        <button type="button" className={itemCls} onClick={() => { track('game_share_click', { target: 'link', project_id: projectPublicId() }); onShareGame(); onClose(); }}>
          <FigIcon src={figAsset.globe} size={16} className="shrink-0" tone="primary" />
          <span className={labelCls}>{t('preview.shareGame')}</span>
        </button>
        {/* 分享工作台:对方得到含对话的完整可编辑副本(区别于「分享游戏」的只读单版本直链)。
            无活跃 session 时禁用并给提示(R2 分享须钉当前会话)。 */}
        <button
          type="button"
          disabled={workbenchDisabled}
          title={workbenchDisabled ? t('preview.fileMenu.shareWorkbenchNoSession') : undefined}
          className={`${itemCls} disabled:cursor-not-allowed disabled:opacity-40`}
          onClick={() => { track('game_share_click', { target: 'workbench', project_id: projectPublicId() }); onShareWorkbench(); onClose(); }}
        >
          <FigIcon src={figAsset.pencil} size={16} className="shrink-0" tone="primary" />
          <span className={labelCls}>{t('preview.fileMenu.shareWorkbench')}</span>
        </button>
        <button type="button" className={itemCls} onClick={() => { track('game_share_click', { target: 'rezona', project_id: projectPublicId() }); onShareToRezona(); onClose(); }}>
          <FigIcon src={figAsset.logo} size={16} className="shrink-0" />
          <span className={labelCls}>{t('preview.fileMenu.shareToRezona')}</span>
        </button>
        {/* 导出分组:与上方分享项以分隔线隔开。ZIP 居前(默认形态),APK 在后 */}
        <div className="my-1 h-px w-full bg-[var(--color-line-2)]" />
        {/* Export as ZIP:**点击刻意不 onClose** —— 拉包是几秒级的 blob 请求,菜单收了就没地方
            显示进度了(工具条上那枚带 spinner 的下载钮已随本次迁移撤掉)。收菜单的责任交给调用方:
            拉完在 finally 里关 */}
        <button
          type="button"
          disabled={exporting}
          aria-busy={exporting}
          // 显式 aria-label:在飞期项内多出一枚带 aria-label 的 spinner,名字若由内容拼接
          // 会变成「Export as ZIP Exporting」—— 同一个入口在两种状态下叫两个名字
          aria-label={t('preview.fileMenu.exportZip')}
          className={`${itemCls} disabled:cursor-not-allowed disabled:opacity-40`}
          onClick={onExportZip}
        >
          <FigIcon src={figAsset.fileZip} size={16} className="shrink-0" tone="primary" />
          <span className={labelCls}>{t('preview.fileMenu.exportZip')}</span>
          {exporting && (
            <span
              role="status"
              aria-label={t('preview.fileMenu.exportingZip')}
              className="block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current"
            />
          )}
        </button>
        <button type="button" className={itemCls} onClick={() => { onExportApk(); onClose(); }}>
          <FigIcon src={figAsset.android} size={16} className="shrink-0" tone="primary" />
          <span className={labelCls}>{t('preview.apk.exportApk')}</span>
        </button>
        <button type="button" className={itemCls} onClick={() => { onExportAab(); onClose(); }}>
          <FigIcon src={figAsset.googlePlay} size={16} className="shrink-0" />
          <span className={labelCls}>{t('preview.apk.exportAab')}</span>
        </button>
        <button type="button" className={itemCls} onClick={() => { onExportSteam(); onClose(); }}>
          <FigIcon src={figAsset.steam} size={16} className="shrink-0" />
          <span className={labelCls}>{t('preview.steam.exportSteam')}</span>
        </button>
      </div>
    </>
  );
}
