'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { selectActiveVersion } from '@/store/selectors';
import GameFrame from './GameFrame';
import DeviceToggle from './DeviceToggle';
import VersionTimeline from './VersionTimeline';
import FilesView from '@/components/files/FilesView';
import SharePopover from './SharePopover';
import WorkbenchSharePopover from './WorkbenchSharePopover';
import FileMenu from './FileMenu';
// 交互面代码分割(审计 E1):对比视图与发布流仅在用户主动进入时渲染,拆出首屏主 chunk
import dynamic from 'next/dynamic';
const CompareView = dynamic(() => import('./CompareView'), { ssr: false });
const RezonaPublishModal = dynamic(() => import('./RezonaPublishModal'), { ssr: false });
const ApkExportModal = dynamic(() => import('./ApkExportModal'), { ssr: false });
const DesktopExportModal = dynamic(() => import('./DesktopExportModal'), { ssr: false });
import UserInfo from './UserInfo';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { buildSharePageUrl } from '@/lib/pgc/url';
import type { ApkOutputFormat } from '@/lib/pgc/types';
import { buildFullscreenUrl } from '@/lib/fullscreen-url';

// Preview / Files 分段 tab(Figma 955-43410 / 892-14968):选中态浅底 + 文字图标随主题翻转,
// 未选中恒灰。Files 由 Workspace 在中列覆盖渲染文件浏览,故此处只切 previewTab。
function PreviewTabs() {
  const { t } = useTranslation();
  const previewTab = useStore((s) => s.previewTab);
  const setPreviewTab = useStore((s) => s.setPreviewTab);
  // map 回调参数命名为 tab,避免与翻译函数 t 撞名
  const tabs = [
    { key: 'preview' as const, label: t('preview.tabPreview'), icon: figAsset.eyeShow },
    { key: 'files' as const, label: t('preview.tabFiles'), icon: figAsset.folder },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-[12px] bg-[var(--color-surface)] p-1">
      {tabs.map((tab) => {
        const active = previewTab === tab.key;
        return (
          <Tooltip key={tab.key} label={tab.label}>
            <button
              type="button"
              aria-label={tab.label}
              aria-pressed={active}
              onClick={() => setPreviewTab(tab.key)}
              className={`inline-flex items-center justify-center rounded-[8px] px-4 py-1 transition-[background-color,color] duration-150 ${
                active
                  ? 'bg-[var(--color-line-strong)] text-[var(--color-ink)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <FigIcon src={tab.icon} size={16} tone={active ? 'primary' : 'secondary'} />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default function PreviewPanel() {
  const { t } = useTranslation();
  const versions = useStore((s) => s.versions);
  const activeId = useStore((s) => s.activeVersionId);
  const compareOn = useStore((s) => s.compare.on);
  const filesTab = useStore((s) => s.previewTab === 'files');
  const previewDevice = useStore((s) => s.previewDevice);
  // Files 视图 lazy 保活闩:首次激活即挂载,此后常驻(仅切显隐),避免重复拉清单/丢本地态。
  // 渲染期一次性 guard setState(遵守仓库禁 effect-setState 约束)。
  const [filesMounted, setFilesMounted] = useState(filesTab);
  if (filesTab && !filesMounted) setFilesMounted(true);
  const downloadActiveVersion = useStore((s) => s.downloadActiveVersion);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [downloading, setDownloading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 分享工作台弹窗开合态(与「分享游戏」并列,含对话完整可编辑副本)
  const [workbenchShareOpen, setWorkbenchShareOpen] = useState(false);
  // 当前活跃 koubou session:分享工作台须钉扎它(R2);无则禁用入口
  const sessionId = useStore((s) => s.sessionId);
  // 顶栏分享钮改 File menu:菜单开合态 + Rezona 发布模态开合态
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [rezonaOpen, setRezonaOpen] = useState(false);
  // Android 导出模态:开合态直接存产物格式(null=未开)。菜单里 APK 与 Play Bundle 各一项,
  // 两者共用同一个模态组件,格式由入口定
  const [androidExport, setAndroidExport] = useState<ApkOutputFormat | null>(null);
  // Steam 内容包导出模态:另一族端点(desktop-builds),与 Android 那两种产物无共享状态
  const [steamExportOpen, setSteamExportOpen] = useState(false);
  // 刷新计数器:递增即作为预览组件 key,强制重建并重载 iframe(对比模式下两侧一并重建)
  const [refreshNonce, setRefreshNonce] = useState(0);
  const active = selectActiveVersion(versions, activeId);
  const hasGame = versions.length > 0;
  // 全屏页链接:渲染期就算好,点击时同步 open(见按钮处注释);缺项目 / 版本时为 null → 按钮禁用
  const fullscreenUrl = buildFullscreenUrl(currentProjectId, active);
  // 分享页链接:code=当前项目 public_id,version=选中版本 seq(Version.index,即某个 project_version);
  // 缺料返回 null → 按钮禁用(仅已 build 的版本可分享)。打开后由 /share 路由直出该版本、地址栏保持干净。
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const publicId = currentProject?.public_id ?? null;
  const shareUrl = buildSharePageUrl(publicId, active?.index);

  // 导出 ZIP:进行中禁止重复触发,结束(成功 / 受控失败)后复位并收起分享菜单。
  // 入口在分享菜单里(spec 2026-08-20),该项点击刻意不自关 —— 拉包那几秒要靠它显示进度,
  // 收菜单的责任因此落在这里
  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try { await downloadActiveVersion(); }
    finally {
      setDownloading(false);
      setFileMenuOpen(false);
    }
  };

  return (
    <div className="flex h-full flex-col border-l border-[var(--color-line-strong)] bg-[var(--color-shell)]">
      {/* 账户条(Figma 1527:33324,常驻):左 分享(forward 语义复用 share 图标)· 右 credit + 头像。
          gap-3 保底 12px 间距 + UserInfo 的 ml-auto 右对齐:窄面板下 credit 数字截断而非顶到分享按钮。 */}
      <div className="flex items-center gap-3 border-b border-[var(--color-line-strong)] px-3 py-2">
        <div className="relative shrink-0">
          <Tooltip>
            <IconButton
              variant="ghost"
              className="rounded-[8px]! bg-[var(--color-surface-2)] px-4 py-2"
              aria-label={t('preview.share')}
              disabled={!hasGame || !shareUrl}
              aria-expanded={fileMenuOpen}
              onClick={() => setFileMenuOpen((o) => !o)}
            >
              <FigIcon src={figAsset.forward} size={16} flipX />
            </IconButton>
          </Tooltip>
          {fileMenuOpen && (
            <FileMenu
              onClose={() => setFileMenuOpen(false)}
              onShareGame={() => setShareOpen(true)}
              onShareToRezona={() => setRezonaOpen(true)}
              onShareWorkbench={() => setWorkbenchShareOpen(true)}
              onExportApk={() => setAndroidExport('apk')}
              onExportAab={() => setAndroidExport('aab')}
              onExportSteam={() => setSteamExportOpen(true)}
              onExportZip={() => void handleDownload()}
              exporting={downloading}
              workbenchDisabled={currentProjectId == null || !sessionId}
            />
          )}
        </div>
        <UserInfo />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
      {/* tab 行:Preview / Files 分段切换(#13),右侧设备档 / 全屏 / 刷新(分享与导出都在顶部那个菜单里);
          对比模式隐藏 tab pill(对比期不可切 Files,空 span 占住 justify-between 左位,右侧按钮不漂移)。
          预览块与 Versions 区固定 7:3 分高,游戏在舞台内 contain 自适应(面板宽由用户拖拽决定)。 */}
      <div className="flex min-h-0 flex-[7] flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line-strong)] px-3 py-3">
          {compareOn ? <span /> : <PreviewTabs />}
          <div className="flex items-center gap-2">
            {/* 设备档切换(spec 2026-10-19-preview-mobile-device):与右邻全屏按钮同一显隐条件 ——
                对比视图双框自有布局、Files 不是游戏舞台,两处都无意义;无游戏时禁用 */}
            {!compareOn && !filesTab && <DeviceToggle disabled={!hasGame} />}
            {/* 全屏展示:新页签打开本站 /full 页。链接在渲染期就算好,点击时同步 open ——
                不 await 预览 URL(既不被弹窗拦截,也不再出现「空白页签等 REST」),
                加载态与游戏 iframe 都由全屏页负责 */}
            {!compareOn && !filesTab && (
              <Tooltip>
                <IconButton
                  variant="ghost"
                  className="rounded-[10px] bg-[var(--color-surface)] p-2"
                  aria-label={t('preview.fullscreen')}
                  disabled={!hasGame || !fullscreenUrl}
                  onClick={() => { if (fullscreenUrl) window.open(fullscreenUrl, '_blank'); }}
                >
                  <FigIcon src={figAsset.fullscreen} size={16} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip>
              <IconButton
                variant="ghost"
                className="rounded-[10px] bg-[var(--color-surface)] p-2"
                aria-label={t('preview.refresh')}
                disabled={!hasGame}
                onClick={() => setRefreshNonce((n) => n + 1)}
              >
                <FigIcon src={figAsset.refresh} size={16} />
              </IconButton>
            </Tooltip>
          </div>
        </div>

        {/* 舞台:游戏预览与 Files 并存,按 filesTab 切显隐(display 切换而非条件挂载),
            以保活游戏 iframe 运行态与 Files 视图的选中/展开/内容缓存。#13 */}
        {/* 游戏预览:常驻挂载,Files 激活时仅隐藏。外层只切显隐(不重挂、不动画);
            内层保留 key + anim-media-in,仅 version.id / refreshNonce / compare 变化才重建并淡入(=预期重载)。 */}
        <div className={filesTab ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
          <div
            key={hasGame ? (compareOn ? `compare-${refreshNonce}` : `game-${refreshNonce}-${active?.id ?? 'none'}`) : 'empty'}
            className="anim-media-in flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {hasGame ? (
              compareOn ? <CompareView /> : <GameFrame version={active} device={previewDevice} />
            ) : (
              <div className="flex h-full items-center justify-center bg-[var(--color-surface)] px-8 text-center">
                <span className="max-w-[206px] text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-muted)]">
                  {t('preview.emptyHint')}
                </span>
              </div>
            )}
          </div>
        </div>
        {/* Files:首次激活后才挂载(lazy),此后常驻仅切显隐,保住清单/选中/展开与内容缓存 */}
        {filesMounted && (
          <div className={filesTab ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
            <FilesView />
          </div>
        )}
      </div>

      <VersionTimeline />
      </div>

      {shareOpen && shareUrl && (
        <SharePopover
          url={shareUrl}
          projectId={currentProjectId}
          versionId={active?.id ?? null}
          versionStatus={active?.status ?? null}
          onClose={() => setShareOpen(false)}
        />
      )}
      {workbenchShareOpen && currentProjectId != null && sessionId && (
        <WorkbenchSharePopover projectId={currentProjectId} sessionId={sessionId} onClose={() => setWorkbenchShareOpen(false)} />
      )}
      {androidExport && currentProjectId != null && publicId && (
        <ApkExportModal
          projectId={currentProjectId} publicId={publicId} projectName={currentProject?.name ?? ''}
          version={active} format={androidExport} onClose={() => setAndroidExport(null)}
        />
      )}
      {/* 桌面导出只吃 publicId(三端点路径段都用它),不需要数值 projectId —— 那个在 apk 侧只为图标上传 */}
      {steamExportOpen && publicId && (
        <DesktopExportModal
          publicId={publicId} projectName={currentProject?.name ?? ''}
          version={active} onClose={() => setSteamExportOpen(false)}
        />
      )}
      {/* 无选中版本时不开发布弹窗:File menu 本就因缺 shareUrl 而禁用,弹窗内不必再兜一遍空版本 */}
      {rezonaOpen && currentProjectId != null && active && (
        <RezonaPublishModal projectId={currentProjectId} projectName={currentProject?.name ?? ''} version={active} onClose={() => setRezonaOpen(false)} />
      )}
    </div>
  );
}
