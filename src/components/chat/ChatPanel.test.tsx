import { beforeEach, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import ChatPanel from './ChatPanel';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';
import type { Message, TurnMeta } from '@/store/types';
import type { ProjectData } from '@/lib/pgc/types';

const clientRef = createRef<KoubouClient | null>();
const skeleton = () => screen.queryByRole('status', { name: 'Generating reply' });
const proj = (id: number, name: string): ProjectData => ({
  id, public_id: `p${id}`, name, cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '',
});

beforeEach(() => {
  // replay:null 显式复位,防止回放态用例(下方)残留状态污染后续用例(setState 是浅合并,不重置未提及字段)
  useStore.setState({ messages: [], turns: [], runStatus: 'idle', pendingInteractions: {}, connStatus: 'connecting', currentProjectId: null, replay: null });
  // jsdom 未实现 scrollTo,注入 spy 以观察滚动行为(scrollToBottom 滚容器到 scrollHeight)
  Element.prototype.scrollTo = vi.fn();
});

test('运行中且助手未开口 → 展示生成中骨架屏', () => {
  const messages: Message[] = [{ id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: '做个跳跃游戏' }] }];
  useStore.setState({ messages, runStatus: 'running' });
  render(<ChatPanel client={clientRef} />);
  expect(skeleton()).toBeInTheDocument();
});

test('空闲态 → 不展示骨架屏', () => {
  const messages: Message[] = [{ id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] }];
  useStore.setState({ messages, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  expect(skeleton()).not.toBeInTheDocument();
});

test('助手已开始流式输出文本 → 不展示骨架屏', () => {
  const messages: Message[] = [{ id: 'a', role: 'assistant', status: 'generating', parts: [{ type: 'text', text: '好的,我们来做' }] }];
  useStore.setState({ messages, runStatus: 'running' });
  render(<ChatPanel client={clientRef} />);
  expect(skeleton()).not.toBeInTheDocument();
});

test('工具调用中 → 展示生成中骨架屏', () => {
  const messages: Message[] = [{ id: 'a', role: 'assistant', status: 'generating', parts: [
    { type: 'text', text: '这就帮你生成' },
    { type: 'tool', id: 't', name: 'generate_image', input: {}, status: 'generating' },
  ] }];
  useStore.setState({ messages, runStatus: 'running' });
  render(<ChatPanel client={clientRef} />);
  expect(skeleton()).toBeInTheDocument();
});

test('重连到未完成会话(历史已落定 + run 仍 running)→ 展示骨架屏', () => {
  const messages: Message[] = [{ id: 'a', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '前文已生成' }] }];
  useStore.setState({ messages, runStatus: 'running' });
  render(<ChatPanel client={clientRef} />);
  expect(skeleton()).toBeInTheDocument();
});

test('每轮最后一条消息下方渲染 TurnFooter', () => {
  const messages: Message[] = [
    { id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: '做个跳跃游戏' }] },
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '好的' }] },
  ];
  const turns: TurnMeta[] = [{ runId: 'r1', model: 'claude-opus-4-8', startedAt: '2026-06-18T00:00:00.000Z', finishedAt: '2026-06-18T00:00:12.000Z', status: 'succeeded', lastMessageId: 'a1' }];
  useStore.setState({ messages, turns, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  expect(screen.getByText(/Ran for 12s/)).toBeInTheDocument();
});

test('已结束回复只在回合末尾显示一次复制操作,复制该轮全部 Markdown', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const messages: Message[] = [
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '## 完成' }] },
    { id: 'a2', role: 'assistant', status: 'ready', parts: [
      { type: 'tool', id: 'tool-1', name: 'Bash', input: {}, status: 'ready' },
    ] },
    { id: 'a3', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '- 第一项\n- 第二项' }] },
  ];
  const turns: TurnMeta[] = [{
    runId: 'r1',
    model: 'claude-opus-4-8',
    startedAt: '2026-06-18T00:00:00.000Z',
    finishedAt: '2026-06-18T00:00:12.000Z',
    status: 'succeeded',
    lastMessageId: 'a3',
  }];
  useStore.setState({ messages, turns, runStatus: 'idle' });

  render(<ChatPanel client={clientRef} />);

  const copyButtons = screen.getAllByRole('button', { name: 'Copy message' });
  expect(copyButtons).toHaveLength(1);
  fireEvent.click(copyButtons[0]);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('## 完成\n\n- 第一项\n- 第二项'));
});

test('已结束纯工具回合不显示无意义的复制操作', () => {
  const messages: Message[] = [
    { id: 'a1', role: 'assistant', status: 'ready', parts: [
      { type: 'tool', id: 'tool-1', name: 'Bash', input: {}, status: 'ready' },
    ] },
  ];
  const turns: TurnMeta[] = [{
    runId: 'r1',
    model: 'claude-opus-4-8',
    startedAt: '2026-06-18T00:00:00.000Z',
    finishedAt: '2026-06-18T00:00:12.000Z',
    status: 'succeeded',
    lastMessageId: 'a1',
  }];
  useStore.setState({ messages, turns, runStatus: 'idle' });

  render(<ChatPanel client={clientRef} />);

  expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
});

test('运行中回合已有消息锚点且仍在等待 → 计时器渲染在骨架图下方', () => {
  const messages: Message[] = [
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '先处理已有结果' }] },
  ];
  const turns: TurnMeta[] = [{
    runId: 'r1',
    model: 'claude-opus-4-8',
    startedAt: new Date(Date.now() - 2_000).toISOString(),
    finishedAt: null,
    status: 'running',
    lastMessageId: 'a1',
  }];
  useStore.setState({ messages, turns, runStatus: 'running', pendingSendAt: null });
  render(<ChatPanel client={clientRef} />);

  const loading = screen.getByRole('status', { name: 'Generating reply' });
  const timer = screen.getByText(/Running for/);
  expect(loading.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
});

test('加载动画出现时滚动到底部(awaiting 翻转即重新滚动)', () => {
  const messages: Message[] = [{ id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: '做个跳跃游戏' }] }];
  useStore.setState({ messages, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  (Element.prototype.scrollTo as ReturnType<typeof vi.fn>).mockClear();
  // 仅 runStatus 切到 running(messages 不变)→ 骨架屏出现,应重新滚动到最底部
  act(() => { useStore.setState({ runStatus: 'running' }); });
  expect(Element.prototype.scrollTo).toHaveBeenCalled();
});

test('切换项目 → 滚动到底部(无视上一个项目残留的上滑态)', () => {
  const a: Message[] = [{ id: 'u1', role: 'user', status: 'ready', parts: [{ type: 'text', text: '项目 A' }] }];
  useStore.setState({ currentProjectId: 1, messages: a, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  (Element.prototype.scrollTo as ReturnType<typeof vi.fn>).mockClear();
  // 切到项目 B(会话快照替换)→ 应重新滚到底部
  act(() => {
    useStore.setState({ currentProjectId: 2, messages: [{ id: 'u2', role: 'user', status: 'ready', parts: [{ type: 'text', text: '项目 B' }] }] });
  });
  expect(Element.prototype.scrollTo).toHaveBeenCalled();
});

test('重连成功(connStatus connecting→open)且用户贴底 → 滚动到底部', () => {
  const messages: Message[] = [{ id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] }];
  useStore.setState({ currentProjectId: 1, messages, connStatus: 'connecting', runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  (Element.prototype.scrollTo as ReturnType<typeof vi.fn>).mockClear();
  act(() => { useStore.setState({ connStatus: 'open' }); });
  expect(Element.prototype.scrollTo).toHaveBeenCalled();
});

test('连续同名纯工具消息 → 合并为一个 group(×N),而非 N 个独立卡', () => {
  const messages: Message[] = [
    { id: 'a1', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r1', name: 'Read', input: { file: 'a.ts' }, status: 'ready' }] },
    { id: 'a2', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r2', name: 'Read', input: { file: 'b.ts' }, status: 'ready' }] },
    { id: 'a3', role: 'assistant', status: 'ready', parts: [{ type: 'tool', id: 'r3', name: 'Read', input: { file: 'c.ts' }, status: 'ready' }] },
  ];
  useStore.setState({ messages, runStatus: 'idle' });
  render(<ChatPanel client={clientRef} />);
  expect(screen.getByText('×3')).toBeInTheDocument();
  // 合并后头部只有一个 "Read" 标签(而非 3 个独立 ToolCard)
  expect(screen.getAllByText('Read')).toHaveLength(1);
});

test('回放中(replay!=null)→ 待处理审批交互降级为纯文本提示,不渲染可操作的 ToolApprovalCard', () => {
  useStore.setState({
    replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 3, cursor: 1, speed: 1 },
    pendingInteractions: { i1: { kind: 'approval', interactionId: 'i1', toolName: 'Bash', input: {} } },
  });
  render(<ChatPanel client={clientRef} />);
  // 降级文案(chat.replay.approvalNote,插值 tool 名)出现
  expect(screen.getByText('Tool approval (replay): Bash')).toBeInTheDocument();
  // ToolApprovalCard 的可操作按钮不应渲染
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});

test('回放中(replay!=null)→ 渲染 ReplayControls(可见 skip 控件);replay=null → 不渲染', () => {
  useStore.setState({ replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 3, cursor: 1, speed: 1 } });
  const { rerender } = render(<ChatPanel client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Skip to end' })).toBeInTheDocument();
  act(() => { useStore.setState({ replay: null }); });
  rerender(<ChatPanel client={clientRef} />);
  expect(screen.queryByRole('button', { name: 'Skip to end' })).not.toBeInTheDocument();
});

test('回放中(replay!=null)→ 项目切换入口可用(断点续播解禁:切走挂起、切回恢复,见 spec 2026-07-14)', () => {
  useStore.setState({
    projects: [proj(1, 'Alpha'), proj(2, 'Beta')],
    currentProjectId: 1,
    replay: { phase: 'playing', templateId: 't', projectId: 1, sessionId: 's', total: 3, cursor: 1, speed: 1 },
  });
  render(<ChatPanel client={clientRef} />);
  const trigger = screen.getByRole('button', { name: 'Alpha' });
  expect(trigger).not.toBeDisabled();
  fireEvent.click(trigger);
  // 菜单打开:项目列表可见
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

test('回放首帧前(messages 空)→ 消息区显示回放加载态;error 态不显示', () => {
  useStore.setState({
    projects: [proj(1, 'Alpha')], currentProjectId: 1, messages: [],
    replay: { phase: 'cloning', templateId: 't', projectId: 1, sessionId: null, total: 0, cursor: 0, speed: 1 },
  });
  const { rerender } = render(<ChatPanel client={clientRef} />);
  expect(screen.getByText('Preparing your replay…')).toBeInTheDocument();
  act(() => { useStore.setState({ replay: { phase: 'error', templateId: 't', projectId: 1, sessionId: null, total: 0, cursor: 0, speed: 1, errorCode: 'X' } }); });
  rerender(<ChatPanel client={clientRef} />);
  expect(screen.queryByText('Preparing your replay…')).not.toBeInTheDocument();
});

test('非回放(replay=null)→ 项目切换入口可用,点击正常打开菜单', () => {
  useStore.setState({
    projects: [proj(1, 'Alpha'), proj(2, 'Beta')],
    currentProjectId: 1,
    replay: null,
  });
  render(<ChatPanel client={clientRef} />);
  const trigger = screen.getByRole('button', { name: 'Alpha' });
  expect(trigger).not.toBeDisabled();
  fireEvent.click(trigger);
  expect(screen.getByText('Beta')).toBeInTheDocument();
});

test('回放中 AskUserQuestion 不渲染任何界面(用户回答由下一帧 user.message 成气泡),审批仍显示灰条', () => {
  useStore.setState({
    replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 3, cursor: 1, speed: 1 },
    pendingInteractions: {
      q1: { kind: 'question', interactionId: 'q1', questions: [{ question: 'Pick one', options: [{ label: 'A' }] }] },
      i1: { kind: 'approval', interactionId: 'i1', toolName: 'Bash', input: {} },
    },
  });
  render(<ChatPanel client={clientRef} />);
  // 问题内容与旧降级灰条(Question (replay))都不出现
  expect(screen.queryByText('Pick one')).not.toBeInTheDocument();
  expect(screen.queryByText(/Question \(replay\)/)).not.toBeInTheDocument();
  // 审批灰条保留
  expect(screen.getByText('Tool approval (replay): Bash')).toBeInTheDocument();
});

// ---- 滚顶翻页的用户意图门控(spec 2026-07-22) ----
// 刷新恢复期种子化钳制 scrollTop / smooth 滚底路过顶区都会派发"被动"scroll 事件,
// 不得误触发向上翻页;只有用户与滚动区交互(wheel/pointerdown 等)之后才允许。
const scroller = (container: HTMLElement) => {
  const el = container.querySelector('.scrollbar-auto') as HTMLDivElement;
  // jsdom 无布局:模拟"在顶部"(scrollTop=0)
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  return el;
};

const setupHistory = () => {
  const spy = vi.fn().mockResolvedValue(undefined);
  useStore.setState({
    messages: [{ id: 'u', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'hi' }] }],
    runStatus: 'idle', historyHasMore: true, historyLoading: false,
    loadOlderMessages: spy,
  });
  return spy;
};

test('无用户交互(被动到顶,如种子化钳制/程序性滚动路过顶区)→ scroll 不触发向上翻页', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  fireEvent.scroll(scroller(container));
  expect(spy).not.toHaveBeenCalled();
});

test('用户 wheel 交互后 → 滚顶 scroll 正常触发向上翻页', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  const el = scroller(container);
  fireEvent.wheel(el, { deltaY: -100 });
  fireEvent.scroll(el);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('程序性滚底后(未再交互)→ 路过顶区的 scroll 不再触发翻页(意图标记被滚底消费)', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  const el = scroller(container);
  fireEvent.wheel(el, { deltaY: -100 });
  // 触发一次程序性滚底(骨架屏出现路径,同"加载动画出现时滚动到底部"用例)
  act(() => { useStore.setState({ runStatus: 'running' }); });
  fireEvent.scroll(el);
  expect(spy).not.toHaveBeenCalled();
});

test('翻页前插落地(一手势多页多 commit)→ 每个 commit 都按高度增量回推 scrollTop,视口不动', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  const el = scroller(container);
  // 用户上滑到顶触发翻页:此 scroll 同时把补偿基准刷成当前 scrollHeight(2000),stick=false
  fireEvent.wheel(el, { deltaY: -100 });
  fireEvent.scroll(el);
  expect(spy).toHaveBeenCalledTimes(1);
  // 第一页前插落地:内容高度 2000→2600,scrollTop 应回推 +600
  Object.defineProperty(el, 'scrollHeight', { value: 2600, configurable: true });
  act(() => {
    useStore.setState({
      historyMsgCount: 5,
      messages: [{ id: 'u2', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'older' }] }],
    });
  });
  expect(el.scrollTop).toBe(600);
  // 同一手势第二页前插(旧实现一次性锚点只补第一页,这里回归):2600→3200,再回推 +600
  Object.defineProperty(el, 'scrollHeight', { value: 3200, configurable: true });
  act(() => {
    useStore.setState({
      historyMsgCount: 9,
      messages: [{ id: 'u3', role: 'user', status: 'ready', parts: [{ type: 'text', text: 'oldest' }] }],
    });
  });
  expect(el.scrollTop).toBe(1200);
});

test('钉在顶部(scrollTop 未向上移动)的后续 scroll → 不连环触发翻页;再次向上滚动才触发下一次', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  const el = scroller(container);
  fireEvent.wheel(el, { deltaY: -100 });
  fireEvent.scroll(el); // 首次到顶:触发
  expect(spy).toHaveBeenCalledTimes(1);
  // 前插后浏览器钳制/程序性位移派发的 scroll,scrollTop 仍为 0(未向上移动)→ 不再触发
  fireEvent.scroll(el);
  fireEvent.scroll(el);
  expect(spy).toHaveBeenCalledTimes(1);
  // 用户先向下再重新向上滚回顶区 → 视为新手势,再触发一次
  el.scrollTop = 300;
  fireEvent.scroll(el);
  el.scrollTop = 10;
  fireEvent.scroll(el);
  expect(spy).toHaveBeenCalledTimes(2);
});

// ---- 内容不满一屏时自动续拉更早历史 ----
// 种子化窗口按事件计数截断(50 条事件常只出几条可见消息),内容不满一屏时滚动条不存在,
// 滚顶翻页永远不可达 → 更早历史(如首条用户消息)成孤岛。不满一屏 + 还有更早 → 自动续拉。
const shortScroller = (container: HTMLElement) => {
  const el = container.querySelector('.scrollbar-auto') as HTMLDivElement;
  Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  return el;
};

test('历史不满一屏(scrollHeight ≤ clientHeight)且有更早 → 无需交互自动续拉', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  shortScroller(container);
  // jsdom 挂载期高度为 0(clientHeight 门槛跳过);补高度后经消息变更重跑检查
  act(() => { useStore.setState({ historyMsgCount: 1 }); });
  expect(spy).toHaveBeenCalled();
});

test('已可滚动(内容超一屏)→ 不自动续拉,仍走滚顶手势', () => {
  const spy = setupHistory();
  const { container } = render(<ChatPanel client={clientRef} />);
  scroller(container); // 2000 > 600,可滚动
  act(() => { useStore.setState({ historyMsgCount: 1 }); });
  expect(spy).not.toHaveBeenCalled();
});

test('sessionId 迟到(冷启动等 session.ready)→ 就绪后重跑自动续拉', () => {
  const spy = setupHistory();
  useStore.setState({ sessionId: null });
  const { container } = render(<ChatPanel client={clientRef} />);
  shortScroller(container);
  // 种子化早于 sessionId 写入:loadOlderMessages 会早退;sessionId 落地须再触发一次
  act(() => { useStore.setState({ sessionId: 's1' }); });
  expect(spy).toHaveBeenCalled();
});

test('没有更早历史(historyHasMore=false)→ 不自动续拉', () => {
  const spy = setupHistory();
  useStore.setState({ historyHasMore: false });
  const { container } = render(<ChatPanel client={clientRef} />);
  shortScroller(container);
  act(() => { useStore.setState({ historyMsgCount: 1 }); });
  expect(spy).not.toHaveBeenCalled();
});

test('导入进行中(中断续跑)→ 自动挂载导入弹窗并显示进度;清态即卸载', async () => {
  useStore.setState({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 3, total: 5 } });
  const { rerender } = render(<ChatPanel client={clientRef} />);
  // ImportProjectModal 经 dynamic() 异步加载,用 findBy 等待挂载
  expect(await screen.findByText('Import game')).toBeInTheDocument();
  expect(screen.getByText('Importing assets (3/5)…')).toBeInTheDocument();
  // 续跑收尾清态:弹窗随之卸载(用户未手动打开,importOpen 恒 false)
  act(() => useStore.setState({ importArchiveStatus: null }));
  rerender(<ChatPanel client={clientRef} />);
  expect(screen.queryByText('Import game')).not.toBeInTheDocument();
});

// 常驻收起入口(spec 2026-08-18-sidebar-toggle-entries):把手是 hover 才浮现的快捷方式,
// 这个按钮是同一动作的常驻镜像。文案与把手共用一个 key —— 同一动作同一文案
test('顶栏右侧的收起按钮:点击回调父级,aria-expanded 反映当前展开态', () => {
  const onToggle = vi.fn();
  render(<ChatPanel client={clientRef} collapsed={false} onToggleCollapsed={onToggle} />);

  const btn = screen.getByRole('button', { name: 'Collapse chat panel' });
  expect(btn.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(btn);
  expect(onToggle).toHaveBeenCalledTimes(1);
});

test('收起态下该按钮的 aria-expanded 转 false(它随对话栏一起 inert,但语义要对)', () => {
  render(<ChatPanel client={clientRef} collapsed onToggleCollapsed={() => {}} />);
  expect(
    screen.getByRole('button', { name: 'Collapse chat panel' }).getAttribute('aria-expanded'),
  ).toBe('false');
});

// 报错与自愈进度固定在输入框正上方(设计稿 2026-08-27):它们不在滚动区里 —— 否则随对话
// 滚走,用户翻到上面就看不见「刚刚失败了」,也没法点重试
test('报错气泡在滚动区之外、输入框之前', () => {
  useStore.setState({ agentError: { text: 'boom' }, lastSend: { content: 'hi' } });
  const { container } = render(<ChatPanel client={clientRef} />);
  const alert = screen.getByRole('alert');
  const scroller = container.querySelector('.scrollbar-auto.flex-1')!;
  const composer = screen.getByRole('textbox');
  expect(scroller.contains(alert)).toBe(false);
  // DOM 顺序:报错在输入框前面(视觉上就在它正上方)
  expect(alert.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('自愈进度气泡同样固定在滚动区之外', () => {
  useStore.setState({ agentRetry: { attempt: 1, mode: 'resend', phase: 'waiting', nextAt: null, text: 'boom' } });
  const { container } = render(<ChatPanel client={clientRef} />);
  const status = screen.getByText(/Retrying 1\/10/).closest('[role="status"]')!;
  const scroller = container.querySelector('.scrollbar-auto.flex-1')!;
  expect(scroller.contains(status)).toBe(false);
});
