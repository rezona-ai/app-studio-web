'use client';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import MessageItem from './MessageItem';
import MessageActions from './MessageActions';
import ToolCard from './ToolCard';
import ToolGroupCard from './ToolGroupCard';
import { groupToolRuns } from '@/lib/chat/group-tool-runs';
import MessageSkeleton, { ReplaySkeleton } from './MessageSkeleton';
import TurnFooter from './TurnFooter';
import Composer from './Composer';
import PlanCard from './PlanCard';
import { selectAwaitingResponse, selectTurnAnchors } from '@/store/selectors';
import ProjectMenu from './ProjectMenu';
// 交互弹窗代码分割(审计 E1):宿主级条件渲染,首次打开才加载 chunk
import dynamic from 'next/dynamic';
const CreateGameModal = dynamic(() => import('./CreateGameModal'), { ssr: false });
const ImportProjectModal = dynamic(() => import('./ImportProjectModal'), { ssr: false });
import ToolApprovalCard from './ToolApprovalCard';
import QuestionCard from './QuestionCard';
import { figAsset, FigIcon } from '@/components/ui/figma';
import IconButton from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { formatQuestionAnswer } from '@/lib/koubou/formatAnswer';
import { newId } from '@/lib/ids';
import type { KoubouClient } from '@/koubou/client';
import type { TurnMeta } from '@/store/types';
import ReconnectBanner from './ReconnectBanner';
import AgentRetryBubble from './AgentRetryBubble';
import AgentErrorBubble from './AgentErrorBubble';
import ReplayControls, { ReplayControlsSkeleton } from './ReplayControls';

// 距底 < 80px 视为"贴底",阈值足够大以容忍 smooth 滚动途中的度量抖动
const BOTTOM_THRESHOLD = 80;

export default function ChatPanel({
  client,
  collapsed = false,
  onToggleCollapsed,
}: {
  client: React.RefObject<KoubouClient | null>;
  /** 对话栏收起态。真相在 Workspace(它拥有三栏几何与持久化),这里只做展示与回调 —— 一层直传比进 store 更轻 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const messages = useStore((s) => s.messages);
  const runStatus = useStore((s) => s.runStatus);
  const turns = useStore((s) => s.turns);
  // 乐观发送计时:run.started 前(后端尚无任何响应)也展示骨架 + 纯计时 footer,不留纯空窗
  const pendingSendAt = useStore((s) => s.pendingSendAt);
  // 乐观计时期的 model:发送时刻的快照(markPendingSend 落下,selectedModel 优先、会话回显兜底),
  // 与 run.started 建轮用的是同一份,保证 pending → 正式回合展示的模型名不闪变
  const pendingModel = useStore((s) => s.pendingModel);
  const awaiting = selectAwaitingResponse(messages, runStatus) || pendingSendAt != null;
  const pendingTurn = useMemo<TurnMeta | null>(
    () => (pendingSendAt ? { runId: null, model: pendingModel, startedAt: pendingSendAt, finishedAt: null, status: 'running', lastMessageId: null } : null),
    [pendingSendAt, pendingModel],
  );
  // 派生计算 useMemo:流式期每个 delta 都改 messages 引用,这些 O(N) 遍历本就要随之重算,
  // 但 memo 保证非流式重渲(pendingInteractions/showJump 等)不重复付费,且产物引用稳定供子组件 memo 生效
  const { byMessageId, copyTextByMessageId, trailing } = useMemo(
    () => selectTurnAnchors(messages, turns),
    [messages, turns],
  );
  // 带 footer 的消息是回合边界,不并进工具组;据此把 messages 预处理成渲染节点
  const renderNodes = useMemo(() => groupToolRuns(messages, new Set(byMessageId.keys())), [messages, byMessageId]);
  const pendingInteractions = useStore((s) => s.pendingInteractions);
  const pending = Object.values(pendingInteractions);
  const replayActive = useStore((s) => s.replay != null);
  // 回放加载态:进入回放到首帧消息派发前,消息区显示加载(error 态不遮,让位错误提示/Toast)
  const replayLoading = useStore((s) => s.replay != null && s.replay.phase !== 'error');
  // 就绪前(provisioning/cloning/finalizing)播放器条位置放骨架占位,playing/skipping 由真实 ReplayControls 接管
  const replayPending = useStore(
    (s) => s.replay != null && (s.replay.phase === 'provisioning' || s.replay.phase === 'cloning' || s.replay.phase === 'finalizing'),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyHasMore = useStore((s) => s.historyHasMore);
  const historyLoading = useStore((s) => s.historyLoading);
  const historyMsgCount = useStore((s) => s.historyMsgCount);
  const loadOlderMessages = useStore((s) => s.loadOlderMessages);
  // 前插补偿基准:持续跟踪滚动区内容高度,每个前插 commit 落地后按高度增量回推 scrollTop,
  // 保证浏览位置不动。不能用「触发时记录锚点、首次落地恢复」的一次性方案——loadOlderMessages
  // 一个手势内循环拉多页,每页一个 set/commit,一次性锚点只补偿第一页,后续页会把视口推下去。
  const prevScrollHeightRef = useRef(0);
  // 滚动方向基准:只有 scrollTop 相比上次减小(用户向上滚)才触发翻页。前插补偿/内容变化引发的
  // 程序性 scroll 事件 scrollTop 不减,不会连环触发(钉顶连续加载的根因)。初值 Infinity 使首个
  // 到顶滚动事件可触发。
  const prevScrollTopRef = useRef(Infinity);
  const prevHistoryCountRef = useRef(historyMsgCount);
  const skipBottomScrollRef = useRef(false);
  const stickToBottomRef = useRef(true); // 用户是否停在底部:仅贴底时才自动跟随滚动
  const prevLastUserIdRef = useRef<string | null>(null); // 检测"用户刚发了新消息"以强制回底
  const instantNextRef = useRef(false); // 下一次自动滚动用瞬时跳转(进入/切项目/重连),不平滑滚过历史
  const connStatus = useStore((s) => s.connStatus);
  // 悬浮计划卡实测高度:据此给消息滚动区补等高底部内边距,避免末条消息被卡片遮挡。
  // 卡片可折叠/展开(高度随任务数变化),故用 ResizeObserver 动态测量;卡片卸载时 callback ref 收到 null 归零。
  const [planHeight, setPlanHeight] = useState(0);
  const planRoRef = useRef<ResizeObserver | null>(null);
  const measurePlan = useCallback((node: HTMLDivElement | null) => {
    planRoRef.current?.disconnect();
    planRoRef.current = null;
    if (!node) { setPlanHeight(0); return; }
    if (typeof ResizeObserver === 'undefined') { setPlanHeight(node.offsetHeight); return; }
    const ro = new ResizeObserver(() => setPlanHeight(node.offsetHeight));
    ro.observe(node);
    planRoRef.current = ro;
    setPlanHeight(node.offsetHeight);
  }, []);
  useEffect(() => () => planRoRef.current?.disconnect(), []);
  const prevProjectRef = useRef<number | null | undefined>(undefined); // 检测项目变更(含首次挂载:undefined≠任意 id)
  const prevConnRef = useRef(connStatus); // 检测 connStatus 进入 'open'(重连成功)
  const [showJump, setShowJump] = useState(false); // 「回到最新」浮动按钮可见性
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // 导入进行中(含中断续跑)自动挂载导入弹窗还原进度;status 清空即卸载(续跑收尾路径)
  const importResuming = useStore((s) => s.importArchiveStatus != null);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const selectProject = useStore((s) => s.selectProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const currentName = projects.find((p) => p.id === currentProjectId)?.name ?? 'Project name';

  // 用户滚动意图门控(spec 2026-07-22):scroll 事件不都来自用户——刷新恢复期种子化整体替换
  // 消息使内容骤缩,浏览器把 scrollTop 钳到 0;smooth 滚底动画也会路过顶区。两者都派发 scroll,
  // 若据此翻页会把视口甩进历史并连环拉取(响应中刷新的卡死根因)。故只有用户与滚动区交互过
  // (wheel/pointerdown/keydown/touchmove,覆盖滚轮/拖滚动条/键盘)且其后未程序性滚底时才允许翻页。
  const userIntentRef = useRef(false);
  const markUserIntent = () => { userIntentRef.current = true; };

  // 滚动时:① 维护贴底状态与「回到最新」按钮可见性;② 用户向上滚动进顶区且有更早消息时翻页(一次手势只触发一次)
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    stickToBottomRef.current = atBottom;
    setShowJump(!atBottom);
    const movedUp = el.scrollTop < prevScrollTopRef.current;
    prevScrollTopRef.current = el.scrollTop;
    // 补偿基准随每次 scroll 刷新:覆盖 padding/resize 等不经消息变更的高度变化,防陈旧基准误补偿
    prevScrollHeightRef.current = el.scrollHeight;
    if (userIntentRef.current && movedUp && el.scrollTop <= 60 && !historyLoading && historyHasMore) {
      void loadOlderMessages();
    }
  };

  // 前插落地(historyMsgCount 增长,一手势内每页一个 commit)→ 按内容高度增量回推 scrollTop,
  // 视口保持不动并抑制本次自动滚底;贴底态(种子化/切项目/不满屏自动续拉)不补偿,交给自动滚底。
  // 非前插的消息变更(live 追加)只刷新高度基准。
  useLayoutEffect(() => {
    const grew = historyMsgCount > prevHistoryCountRef.current;
    prevHistoryCountRef.current = historyMsgCount;
    const el = scrollRef.current;
    if (!el) return;
    if (grew && !stickToBottomRef.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current;
      skipBottomScrollRef.current = true;
    }
    prevScrollHeightRef.current = el.scrollHeight;
  }, [historyMsgCount, messages]);

  // 统一滚动出口:滚到滚动容器真正底部(scrollHeight)。容器已按计划卡实测高补了 paddingBottom,
  // 滚到真底会吃掉这段预留、把末条消息停在卡片之上("加上计划卡偏移"即体现于此),且 scrollTop≈max 令
  // onScroll 判定贴底、隐藏「回到最新」。无计划卡时 paddingBottom=0,等价于滚到列表末尾。
  const scrollToBottom = (behavior: ScrollBehavior) => {
    userIntentRef.current = false; // 程序性滚底消费交互标记:其后路过顶区的 scroll 不视作用户上滑
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  // 进入 workspace / 切换项目(currentProjectId 变更,含首次挂载):强制贴底并让随后 messages
  // 落定时以瞬时跳转回到底部。会话快照可能异步重建 → 实际滚动交给下面的 messages 效果(见其瞬时标记消费)。
  // 声明在 messages 效果之前,保证同一 commit 内先置标记再被读取。
  useEffect(() => {
    if (prevProjectRef.current === currentProjectId) return;
    prevProjectRef.current = currentProjectId;
    stickToBottomRef.current = true; // 无视上一个项目残留的上滑态,强制回底
    instantNextRef.current = true;
  }, [currentProjectId]);

  // 重连成功(connStatus 由非 open → open,含首连):仅当用户此前贴底才瞬时回到底部;
  // 上滑阅读的用户(含静默重连期间)位置不动。续传的重放消息随后由 messages 效果继续跟随。
  useEffect(() => {
    const prev = prevConnRef.current;
    prevConnRef.current = connStatus;
    if (connStatus === 'open' && prev !== 'open' && stickToBottomRef.current) {
      instantNextRef.current = true;
      scrollToBottom('auto');
    }
  }, [connStatus]);

  // 消息更新或加载动画出现/消失时,仅当用户贴底才滚到列表底部;
  // 用户上滑后(stick=false)不再被拽回;用户刚发送新消息时强制回底。
  useEffect(() => {
    if (skipBottomScrollRef.current) { skipBottomScrollRef.current = false; return; }
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && last.id !== prevLastUserIdRef.current) {
      prevLastUserIdRef.current = last.id; // 用户刚发送 → 强制回底,无视当前 stick 状态
      stickToBottomRef.current = true;
    }
    if (!stickToBottomRef.current) return;
    scrollToBottom(instantNextRef.current ? 'auto' : 'smooth');
    // 有真实内容才消费瞬时标记:切项目后会话可能异步重建,空列表期间保留标记,首块落地即瞬时跳底
    if (instantNextRef.current && messages.length > 0) instantNextRef.current = false;
  }, [messages, awaiting]);

  // 计划卡出现/折叠展开使底部内边距变化:贴底用户随之补滚,保证末条消息不被卡片吞掉
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom('auto');
  }, [planHeight]);

  // 内容不满一屏时自动续拉更早历史:种子化窗口按「事件」计数截断(50 条事件常只出几条可见消息),
  // 不满一屏则滚动条不存在,滚顶翻页永远不可达 → 更早历史(如首条用户消息)成孤岛。
  // clientHeight>0 门槛:排除未布局/隐藏容器(也规避 jsdom 挂载期 0 高误触发);
  // loadOlderMessages 自带 historyLoading/hasMore/游标防重与到顶停止,这里只管触发。
  // sessionId 进 deps:种子化落地时 store.sessionId 可能尚未写入(冷启动要等 session.ready),
  // loadOlderMessages 会静默早退;sessionId 就绪后须重跑一次,否则错过唯一触发时机。
  const sessionId = useStore((s) => s.sessionId);
  useEffect(() => {
    if (replayActive || historyLoading || !historyHasMore) return;
    const el = scrollRef.current;
    if (!el || el.clientHeight <= 0 || el.scrollHeight > el.clientHeight) return;
    // batch:自动续拉是被动补页,逐页落库会让整个列表连闪数秒(大屏刷新后尤甚),累积后一次性 commit
    void loadOlderMessages({ batch: true });
  }, [messages, historyMsgCount, historyHasMore, historyLoading, replayActive, sessionId, loadOlderMessages]);

  return (
    <div className="flex h-full flex-col border-r border-[var(--color-line)] bg-[var(--color-shell)]">
      {/* Project Header:logo + 项目名(下边框),点击展开项目菜单 */}
      <div className="relative border-b border-[var(--color-line-strong)] px-[10px] py-2">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex min-w-0 items-center gap-1 rounded-[10px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-fill)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${menuOpen ? 'bg-[var(--color-fill)]' : ''}`}
          >
            <img
              src={figAsset.logo}
              alt=""
              width={32}
              height={32}
              draggable={false}
              className="size-8 shrink-0 object-contain"
            />
            <span className="ml-1 max-w-[140px] truncate text-[15px] font-semibold leading-6 tracking-[-0.3px] text-[var(--color-ink)]">
              {currentName}
            </span>
            <FigIcon
              src={figAsset.chevronDown}
              size={16}
              className={`shrink-0 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {/* 常驻收起入口(spec 2026-08-18-sidebar-toggle-entries):边缘把手是 hover 才浮现的快捷方式,
              不知道它存在的人找不到这个动作。文案与把手共用一个 key —— 同一动作同一文案,
              同名按钮同页出现两次对无障碍是正确的(两个入口做同一件事) */}
          {onToggleCollapsed && (
            <Tooltip label={t('workspace.chatCollapse')}>
              <IconButton
                variant="ghost"
                onClick={onToggleCollapsed}
                aria-label={t('workspace.chatCollapse')}
                aria-expanded={!collapsed}
                className="size-8 shrink-0"
              >
                <FigIcon src={figAsset.panelLeft} size={20} />
              </IconButton>
            </Tooltip>
          )}
        </div>
        {menuOpen && (
          <ProjectMenu
            projects={projects}
            currentId={currentProjectId}
            onClose={() => setMenuOpen(false)}
            // 回放期允许切走:selectProject 内挂起回放(进度已持久化),切回时断点恢复(spec 2026-07-14)
            onSelect={(id) => void selectProject(id)}
            onCreate={() => setCreateOpen(true)}
            onImport={() => setImportOpen(true)}
            onBackToStudio={() => {
              // 刻意不经 apiPath():跳出 /game basePath,回到 Rezona Lab Studio 的游戏页
              window.location.href = '/studio/game';
            }}
            onRename={(id, name) => renameProject(id, name)}
            onDelete={(id) => deleteProject(id)}
          />
        )}
      </div>

      {/* 消息区(空态居中欢迎语);外包 relative 容器以承载「回到最新」浮动按钮 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {replayPending ? <ReplayControlsSkeleton /> : replayActive && <ReplayControls />}
        {/* 「加载更早」提示悬浮不占文档流:曾在列表顶部按流内挂载/卸载,每次翻页把内容推下又弹回
            (±32px,不经 messages 变更故补偿 effect 吃不到),连续翻页表现为视口连环抖动 */}
        {historyLoading && (
          <div className="anim-pop-in absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-[var(--color-line)] bg-[var(--color-pop)] px-3 py-1 text-xs text-[var(--color-muted)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
            {t('chat.loadingEarlier')}
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={markUserIntent}
          onPointerDown={markUserIntent}
          onKeyDown={markUserIntent}
          onTouchMove={markUserIntent}
          // overflow-anchor:none:关闭浏览器原生滚动锚定——它在 scrollTop>0 时会对上方前插内容
          // 自动调 scrollTop,与下方手动补偿叠加成双倍位移(实测翻页第 2 页起视口被甩走);
          // 而 scrollTop=0 时它又不生效,故统一只用手动补偿
          className="scrollbar-auto flex-1 overflow-auto px-3 py-3 [overflow-anchor:none]"
          // 计划卡悬浮遮住列表底部:补等高内边距(+8 抵 mb-2 间距),末条消息可滚到卡片之上
          style={planHeight ? { paddingBottom: planHeight + 8 } : undefined}
        >
          {messages.length === 0 && replayLoading ? (
            // 回放加载态:provisioning 三步 + 首帧到达前(第一条消息派发后 messages 非空,自然让位);
            // 用对话形态骨架而非全屏加载层,与消息区/输入框视觉连续
            <ReplaySkeleton />
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-muted)]">
              Hi there, what game are we making today
            </div>
          ) : (
            renderNodes.map((node) => {
              if (node.kind === 'message') {
                const m = node.message;
                const copyText = copyTextByMessageId.get(m.id);
                return (
                  <Fragment key={m.id}>
                    <MessageItem message={m} turnActionsFollow={copyText != null} />
                    {copyText && <MessageActions copyText={copyText} variant="turn" />}
                    {byMessageId.has(m.id) && <TurnFooter turn={byMessageId.get(m.id)!} />}
                  </Fragment>
                );
              }
              // 单个/合并工具节点:补回原纯工具消息的 mb-2 间距
              if (node.kind === 'tool') {
                return <div key={node.part.id} className="mb-2"><ToolCard part={node.part} /></div>;
              }
              return <div key={node.id} className="mb-2"><ToolGroupCard name={node.name} parts={node.parts} /></div>;
            })
          )}
          {/* 骨架在上、计时器在下:与正常消息「内容 → TurnFooter」的排布一致 */}
          {awaiting && <MessageSkeleton />}
          {trailing ? <TurnFooter turn={trailing} /> : pendingTurn && <TurnFooter turn={pendingTurn} />}
        </div>
        {showJump && (
          <Tooltip>
            <button
              type="button"
              aria-label={t('chat.jumpToLatest')}
              onClick={() => {
                stickToBottomRef.current = true;
                setShowJump(false);
                scrollToBottom('smooth');
              }}
              // 计划卡悬浮时抬到卡片之上(planHeight+8 抵卡片高及其 mb-2,再留 12px 间距),否则保持距底 12px;避免被计划卡遮挡
              style={{ bottom: planHeight ? planHeight + 8 + 12 : 12 }}
              className="absolute right-3 z-10 grid size-9 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-pop)] text-[var(--color-ink)] shadow-[var(--shadow-popover)] transition hover:bg-[var(--color-fill)]"
            >
              <FigIcon src={figAsset.chevronDown} size={18} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* relative 包住「待处理交互 + 重连提示 + Composer」整个底部块:PlanCard 以 absolute
          bottom-full 锚到此容器顶端悬浮,故容器须覆盖全部底部 UI,否则 PlanCard 会盖住上方
          的 pending 交互卡 / ReconnectBanner(它们与 PlanCard 同属普通流,不在 relative 容器内时
          会被浮层盖住) */}
      {/* shrink-0:底部块不参与压缩 —— 固定槽里展开的上游原文(上限 2000 字符)在窄栏下能有
          几百 px 高,不钉住的话它会先把 flex-1 的消息区压没、再继续挤掉输入框(评审 I-3) */}
      <div className="relative shrink-0">
        <PlanCard ref={measurePlan} />
        {/* 待处理交互:工具审批 / AskUserQuestion */}
        {pending.length > 0 && (
          <div className="flex flex-col gap-2 px-3 pb-2">
            {pending.map((it) =>
              // 回放期 AskUserQuestion 不渲染任何界面:下一帧的 user.message 就是当时的用户回答,
              // 会经 ingestReplayUserMessage 自然成用户气泡;审批交互仍降级为纯文本提示
              replayActive ? (
                it.kind === 'approval' ? (
                  <div key={it.interactionId} className="rounded-[12px] border border-[var(--color-line)] bg-[var(--color-fill)] p-3 text-[13px] text-[var(--color-muted)]">
                    {t('chat.replay.approvalNote', { tool: it.toolName })}
                  </div>
                ) : null
              ) : it.kind === 'approval' ? (
                <ToolApprovalCard key={it.interactionId} interactionId={it.interactionId} toolName={it.toolName} input={it.input} method={it.method}
                  onResolve={(id, ok) => { client.current?.approveTool(id, ok); useStore.getState().resolvePending(id); }} />
              ) : (
                <QuestionCard key={it.interactionId} interactionId={it.interactionId} questions={it.questions}
                  onSubmit={(id, ans) => {
                    // 先乐观插入一条用户消息(把所选项渲染成文本),让聊天里留下用户回答的痕迹;
                    // 仍发 ask_user_question.answer 帧正常 resolve 交互,agent 照常继续。
                    const text = formatQuestionAnswer(it.questions, ans);
                    if (text) useStore.getState().pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [{ type: 'text', text }] });
                    client.current?.answerQuestion(id, ans);
                    useStore.getState().resolvePending(id);
                  }} />
              ),
            )}
          </div>
        )}

        {/* 报错与自愈进度都固定在输入框正上方(设计稿 2026-08-27):同一格、二选一,
            不再作为对话流的一部分 —— 否则同一件事两种形态两个位置,往上翻还堆着历次失败 */}
        <div className="px-3">
          <AgentRetryBubble />
          <AgentErrorBubble />
        </div>
        {/* 按项目 key:切项目重挂,重置 everOpen,避免新项目初次 connecting 误显"重连中"(该态才是真断线) */}
        <ReconnectBanner key={currentProjectId ?? 'none'} client={client} />
        <Composer client={client} />
      </div>
      {createOpen && <CreateGameModal onClose={() => setCreateOpen(false)} />}
      {(importOpen || importResuming) && <ImportProjectModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}
