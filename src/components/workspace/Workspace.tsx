'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { useKoubouConnection } from '@/client/useKoubouConnection';
import { useAgentRetry } from '@/client/useAgentRetry';
import { useProjectBootstrap } from '@/client/useProjectBootstrap';
import { useReplayPlayer } from '@/client/useReplayPlayer';
import { useAuthGuard } from '@/client/useAuthGuard';
import { useHostConfig } from '@/client/useHostConfig';
import { useModelList } from '@/client/useModelList';
import { useSkillList } from '@/client/useSkillList';
import { useUserInfo } from '@/client/useUserInfo';
import { useNewUserGate } from '@/client/useNewUserGate';
import { useBalanceRefresh } from '@/client/useBalanceRefresh';
import { useAssetPolling } from '@/client/useAssetPolling';
import { useSubscribeWatch } from '@/client/useSubscribeWatch';
import { useAnalytics } from '@/client/useAnalytics';
import { useAgentBackend } from '@/client/useAgentBackend';
import { useExitTransition } from '@/client/useExitTransition';
import dynamic from 'next/dynamic';
import ChatPanel from '@/components/chat/ChatPanel';

// 交互弹窗代码分割(审计 E1):都是「点开才渲染」的宿主级条件渲染,静态 import 会把它们
// 全部打进首屏主 chunk;dynamic(ssr:false) 拆成独立 chunk,首次打开时才加载。
// 两栏主体(ChatPanel/PreviewPanel)首屏必现,保持 eager。
const TopupModal = dynamic(() => import('@/components/ui/TopupModal'), { ssr: false });
const CreditModalGate = dynamic(() => import('@/components/ui/CreditModalGate'), { ssr: false });
import PreviewPanel from '@/components/preview/PreviewPanel';
import LoadingScreen from '@/components/ui/LoadingScreen';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';
import Toast from '@/components/ui/Toast';
import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MIN,
  PREVIEW_WIDTH_MIN,
  SEPARATOR_W,
  clampChatWidth,
  fitChatWidth,
  minPageWidth,
} from '@/lib/sidebar-fit';
import { HANDLE_CLIP, HANDLE_H, HANDLE_W, LIQUID_W, hitCircle, liquidPath } from '@/lib/edge-handle';
import { useLiquidFollow } from '@/client/useLiquidFollow';

const CHAT_W_KEY = 'workspace.chatWidth';
const CHAT_COLLAPSED_KEY = 'workspace.chatCollapsed';

// 骑缝竖长条把手:几何在 src/lib/edge-handle.ts,此处只管渲染。
// offset = 所贴边栏的边缘在父容器里的 x —— 把手整块落在该边缘的预览侧,**不越界回边栏**
// (曾越界 24px:展开态压住 ChatPanel 消息区的滚动轨)。
// 定位容器 pointer-events-none,只有 clipPath 裁出的把手本体吃指针事件;浮现由本体自身 hover 触发。
// pinned 恒常显——Chat 收起态没有边栏可 hover,不常显就没处点回来
function EdgeHandle({
  side,
  offset,
  label,
  expanded,
  flipArrow,
  pinned = false,
  animate = false,
  onClick,
}: {
  side: 'left' | 'right';
  offset: number;
  label: string;
  expanded: boolean;
  flipArrow: boolean;
  pinned?: boolean;
  /** 位置随所贴边栏一起过渡(收放对话栏);拖拽分隔条时必须关掉,否则把手滞后于指针 */
  animate?: boolean;
  onClick: () => void;
}) {
  const { shape, onPointerEnter, stop } = useLiquidFollow();
  // 点完把手要么消失要么整体位移,形变留着就成了悬空的一块 —— 两个命中元素共用这一份
  const fire = () => {
    stop();
    onClick();
  };
  // 液体层与按钮同高同中心;左把手向右伸、右把手向左伸,贴边那侧恒压在边栏边缘上
  const layer = {
    width: LIQUID_W,
    height: HANDLE_H,
    ...(side === 'left' ? { left: 0 } : { right: 0 }),
  } as const;
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 z-30 ${
        animate ? 'transition-[left] duration-300 ease-in-out' : ''
      }`}
      // 抬升挂在容器上而不是按钮上:filter 作用于整棵子树裁剪后的合成结果,
      // 静态态(按钮的 clipPath)与牵引态(液体层的形变轮廓)都能贴着轮廓投影,不必各挂一份。
      // 命中层是全透明的,不参与投影
      style={{
        width: HANDLE_W,
        left: side === 'left' ? offset : offset - HANDLE_W,
        filter: 'var(--elev-edge-handle)',
      }}
    >
      {/* ① 液体视觉层:整滴液体形变后的轮廓,垫在按钮之下,不吃指针 */}
      {shape && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 bg-[var(--color-pop)]"
          style={{ ...layer, clipPath: `path('${liquidPath(shape.tx, shape.ty, shape.strength, side)}')` }}
        />
      )}
      <Tooltip transparent label={label}>
        {/* ② 按钮:尺寸 / 位置 / 图标全程不动 —— 变尺寸会让 Tooltip 跑偏(它只在展开那刻测一次 rect),
            给图标加 transform 则违反「图标内容不受动效影响」。活性态只做两件事:
            底色让给①、opacity 强制 100(它被③盖住,收不到 :hover) */}
        <IconButton
          variant="ghost"
          aria-label={label}
          aria-expanded={expanded}
          onPointerEnter={(e) => onPointerEnter(e, side)}
          onClick={onClick}
          style={{ clipPath: HANDLE_CLIP[side], width: HANDLE_W, height: HANDLE_H }}
          // 显现即时(hover 无延迟)、隐藏延迟 500ms 再淡出:基态带 delay-500,悬停态归零——移出后留出操作缓冲。
          // 液体脱手时指针已在预览列上,把手随即转入淡出;延迟给足才来得及再抓一次。
          //
          // 底色**只由 shape 决定,完全不看 :hover**:hover 是即时的,而液体层要等 onPointerEnter →
          // setState → 重渲染才出现,中间差一帧。让 :hover 参与底色,这一帧就会露馅 —— 挂 ghost 自带的
          // hover:bg-fill 时是「一闪而过的高亮」,无条件转透明时是「只剩图标的空窗」(两个都已踩)。
          // 交给 shape 后,切换两侧同为 pop 色 + 同一条静态轮廓(shape 刚建立时是 REST),错位帧不可见。
          // motion-safe 才覆盖 ghost 的 hover 底色 —— reduce-motion 下液体不启动,它是唯一的悬停反馈
          className={`pointer-events-auto absolute left-0 top-1/2 -translate-y-1/2 rounded-none! transition-opacity duration-200 ${
            shape ? 'bg-transparent!' : 'bg-[var(--color-pop)] motion-safe:hover:bg-[var(--color-pop)]!'
          } ${
            pinned || shape
              ? 'opacity-100'
              : 'opacity-0 delay-500 hover:opacity-100 hover:delay-0 focus-visible:opacity-100'
          }`}
        >
          <FigIcon src={figAsset.chevronRight} size={14} className="shrink-0" flipX={flipArrow} />
        </IconButton>
      </Tooltip>
      {/* ③ 液体命中层:形状与①一致,所见即可点;clipPath 之外不吃事件,预览该点的地方照样点得到 */}
      {shape && (
        <div
          aria-hidden
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2 cursor-pointer"
          style={{ ...layer, clipPath: `path('${liquidPath(shape.tx, shape.ty, shape.strength, side)}')` }}
          onClick={fire}
        />
      )}
      {/* ④ 指针处的隐形命中圆:轮廓头部在牵引点滑出凸边范围时够不到指针,靠它保证指针底下恒有命中区。
          必须是**独立元素**而不是并进③的 clipPath —— 拉到最远时牵引点正落在液体层边缘,
          并进去的话圆有一半在 box 外被裁掉,恰好拉满时反而点不动(已踩) */}
      {shape && (
        <div
          aria-hidden
          className="pointer-events-auto absolute cursor-pointer rounded-full"
          style={(({ size, ...pos }) => ({ ...pos, width: size, height: size }))(
            hitCircle(shape.tx, shape.ty, side),
          )}
          onClick={fire}
        />
      )}
    </div>
  );
}

// 「期望宽」= 用户拖拽选择的宽度,与持久化成对写入;窗口缩放导致的碰撞消解只改实际宽、
// 不碰期望宽,故窗口放大后 Chat 能回到用户的选择(见 fitChatWidth)
const persistWidth = (key: string, desired: { current: number }, w: number) => {
  desired.current = w;
  localStorage.setItem(key, String(w));
};

export default function Workspace() {
  const { t } = useTranslation();
  const client = useKoubouConnection();
  // agent 回合失败的应用层自愈(设计稿 2026-08-25):判定在 reducer,这里挂执行侧。
  // 与传输层重连是两套 —— 那套管连接断了,这套管连接开着但 run 失败了
  useAgentRetry(client);
  const booting = useStore((s) => s.booting);
  const authRequired = useStore((s) => s.authRequired);
  const compareOn = useStore((s) => s.compare.on);
  const filesTab = useStore((s) => s.previewTab === 'files');
  const creditModalOpen = useStore((s) => s.creditModalOpen);
  const topupModalOpen = useStore((s) => s.topupModalOpen);
  const [chatW, setChatW] = useState(CHAT_WIDTH_DEFAULT);
  const [resizing, setResizing] = useState(false);
  // 对话栏收起态:Chat 列与其分隔条宽度收到 0,预览列吃满整行。ref 与 state 成对——resize 监听器
  // 在挂载期闭包里读 ref 取最新值,渲染读 state
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const collapsedRef = useRef(false);
  // 布局过渡门控:水合那一次不播 —— 初始 state 是展开态,持久化若为收起,挂载瞬间会当场演一遍收起动画
  const [layoutReady, setLayoutReady] = useState(false);
  // 视口宽:SSR 无 window,挂载后测量(null = 未测量)。Chat 拖拽上限与最小页宽一律读它而非渲染期读 window
  const [viewportW, setViewportW] = useState<number | null>(null);
  const desiredChatW = useRef(CHAT_WIDTH_DEFAULT);
  // 启动加载层:就绪后淡出再卸载
  const loader = useExitTransition(booting || authRequired, 240);
  useProjectBootstrap();
  useReplayPlayer();
  useAuthGuard();
  useHostConfig();
  useModelList();
  useSkillList();
  useUserInfo();
  useNewUserGate(client);
  useAssetPolling();
  useBalanceRefresh();
  useSubscribeWatch();
  useAnalytics();
  useAgentBackend();

  // 按当前视口 + 收起态做一次碰撞消解。窗口变化与对话栏收放都走这里
  const applyLayout = useCallback((collapsed: boolean) => {
    collapsedRef.current = collapsed;
    const w = window.innerWidth;
    setChatCollapsed(collapsed);
    setViewportW(w);
    setChatW(fitChatWidth(desiredChatW.current, w, collapsed));
  }, []);

  // 挂载:读回上次拖拽的宽度作为期望宽 + 上次的收起态,并按当前视口做一次碰撞消解;此后每次窗口变化都重算一次。
  // (必须挂载后读 localStorage 并 setState,惰性初始化会造成 SSR 水合不一致)
  useEffect(() => {
    const savedChat = Number(localStorage.getItem(CHAT_W_KEY));
    if (savedChat) desiredChatW.current = clampChatWidth(savedChat);
    const onResize = () => applyLayout(collapsedRef.current);
    // 水合:持久化的收起态 + Chat 宽一次落进 state(同一批,不会多一帧)
    const hydrate = () => applyLayout(localStorage.getItem(CHAT_COLLAPSED_KEY) === '1');
    hydrate();
    // 下一帧才开过渡:与水合同帧置位的话该帧仍会被算进过渡起点
    const ready = requestAnimationFrame(() => setLayoutReady(true));
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(ready);
      window.removeEventListener('resize', onResize);
    };
  }, [applyLayout]);

  // 收起态对话栏不占横向空间:凡涉及横向几何(浮层 inset)一律读 chatSpanW(含其右侧那条 1px 分隔条)
  const chatSpanW = chatCollapsed ? 0 : chatW + SEPARATOR_W;

  // 收起 / 展开对话栏:期望宽只读不改,展开后原样回到用户拖出来的宽度
  const toggleChatCollapsed = () => {
    const next = !chatCollapsed;
    localStorage.setItem(CHAT_COLLAPSED_KEY, next ? '1' : '0');
    applyLayout(next);
  };

  // 拖拽分隔条调整 Chat 宽:全程跟随指针,松手时落为期望宽并落盘。
  // **横向没动就什么都不做**(不 apply、不 commit):分隔条热区仅 3px 且紧贴把手边缘,瞄偏点到它不该有副作用 ——
  // 会把碰撞消解值写成期望宽(破坏「期望宽只读不改」不变式,视口放大后再回不到用户选的宽度)。按下时竖向微抖很常见,故只认横向位移。
  // 上限再夹「视口 − 分隔条 − 预览硬底」,防止 Chat 把预览挤没;极端窄视口下 CHAT_WIDTH_MIN 优先
  const startResize = (e: React.PointerEvent) => {
    if (viewportW == null) return;
    e.preventDefault();
    const max = Math.max(CHAT_WIDTH_MIN, viewportW - SEPARATOR_W - PREVIEW_WIDTH_MIN);
    const startX = e.clientX;
    const startW = chatW;
    let nextW = startW;
    let moved = false;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      if (ev.clientX === startX) return;
      moved = true;
      nextW = Math.min(clampChatWidth(startW + ev.clientX - startX), max);
      setChatW(nextW);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      setResizing(false);
      if (moved) persistWidth(CHAT_W_KEY, desiredChatW, nextW);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  // 页面最小宽:视口更窄时两栏停在下限,由外层横向滚动兜住(不再互相挤压)。未测量视口前不设
  const minPageW = viewportW == null ? undefined : minPageWidth(chatCollapsed);

  return (
    <div className="h-full">
      {/* 横向滚动兜底:视口窄于最小页宽时内容行不再收缩,改由此容器滚动;弹窗 / Toast / 加载层留在其外,
          不受 overflow 裁剪影响 */}
      <div className="scrollbar-auto h-full overflow-x-auto overflow-y-hidden">
        <div className="relative flex h-full" style={{ minWidth: minPageW }}>
          {/* 对话栏:收放走宽度过渡(300ms ease-in-out)。**始终渲染**、只把外层宽收到 0
              —— 内层恒以 chatW 布局,ChatPanel 从不经历 0 宽,内部滚动位置与排版都不受收放影响;
              收起后 inert 把整块移出 tab 序与无障碍树,免得聚焦到看不见的控件 */}
          <div
            className={`h-full shrink-0 overflow-hidden ${
              resizing || !layoutReady ? '' : 'transition-[width] duration-300 ease-in-out'
            }`}
            style={{ width: chatCollapsed ? 0 : chatW }}
            inert={chatCollapsed}
          >
            <div className="h-full" style={{ width: chatW }}>
              {/* 顶栏那个常驻收起入口的真相在这儿:两栏几何与持久化都归 Workspace,ChatPanel 只做展示与回调 */}
              <ChatPanel client={client} collapsed={chatCollapsed} onToggleCollapsed={toggleChatCollapsed} />
            </div>
          </div>
          {/* 收起 / 展开对话栏:钉在 Chat 栏右缘(收起后即视口最左),箭头方向指示动作。
              刻意排在分隔条之前 —— 两者同为 z-30 时后者胜出,拖拽热区不被把手吃掉 */}
          <EdgeHandle
            side="left"
            offset={chatSpanW}
            label={t(chatCollapsed ? 'workspace.chatExpand' : 'workspace.chatCollapse')}
            expanded={!chatCollapsed}
            flipArrow={!chatCollapsed}
            // compare / files 时把手命中带压在预览面板左缘(文件树折叠箭头就在那 24px 里),
            // 隐形会变成看不见的误触,故也常显
            pinned={chatCollapsed || compareOn || filesTab}
            // 把手钉在 Chat 右缘,收放时要与它同速平移,否则会瞬间跳到最左、与还在收缩的对话栏脱节
            animate={layoutReady && !resizing}
            onClick={toggleChatCollapsed}
          />
          {/* 可拖拽分隔条:1px 分割线 + 两侧扩展热区。与 Chat 列一起过渡到 0 宽而不是直接不渲染,
              否则收放时它那 1px 会瞬跳;收起态整条不吃指针 —— 两侧各 4px 的热区会留在视口最左缘
              变成一条隐形的拖拽带 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('workspace.resizeChat')}
            aria-hidden={chatCollapsed}
            className={`relative z-30 h-full shrink-0 bg-[var(--color-line)] ${
              chatCollapsed ? 'pointer-events-none' : 'cursor-col-resize'
            } ${resizing || !layoutReady ? '' : 'transition-[width] duration-300 ease-in-out'}`}
            style={{ width: chatCollapsed ? 0 : SEPARATOR_W }}
            onPointerDown={startResize}
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
          </div>
          {/* 预览列:吃满剩余宽度(画布已退役,spec 2026-10-19-remove-asset-canvas)。游戏的 16:9 上限
              由舞台内信箱化承担(见 GameFrame),不再靠限制列宽 */}
          <div className="h-full min-w-0 flex-1" data-testid="preview-column">
            <PreviewPanel />
          </div>
          {/* 拖拽期间全屏遮罩:防止 iframe 吞掉指针事件并统一光标 */}
          {resizing && <div className="fixed inset-0 z-50 cursor-col-resize select-none" />}
        </div>
      </div>
      {/* 升购弹窗按当前档位分流(网关内部先拉 plans 再决定渲染哪一个,见 CreditModalGate) */}
      {creditModalOpen && <CreditModalGate />}
      {/* 完整充值弹窗:唯一入口是顶档升购弹窗的 view-all,故独立开关 */}
      {topupModalOpen && <TopupModal />}
      {/* 启动加载或检测到未登录(跳转 sign-in 前):全局加载层盖住整个工作区,避免空工作台闪现;就绪后淡出 */}
      {loader.mounted && <LoadingScreen variant="brand" className="fixed inset-0 z-50" label={t('workspace.loading')} hints={t('workspace.bootHints', { returnObjects: true }) as string[]} closing={loader.closing} />}
      {/* toast 横向居中于预览列(chat 宽 + 1px 分隔条起) */}
      <Toast leftInset={chatSpanW} />
    </div>
  );
}
