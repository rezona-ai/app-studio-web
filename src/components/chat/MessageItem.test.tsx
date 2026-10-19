import { beforeEach, expect, test, vi } from 'vitest';
import { Profiler } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import MessageItem from './MessageItem';
import { useStore } from '@/store';
import type { ChatAttachment, Message } from '@/store/types';

beforeEach(() => {
  useStore.setState({
    assets: [],
    composer: { draft: '', attachments: [], baseLines: 2 },
    toast: null,
  });
});

test('渲染 assistant 文本 + 工具卡', () => {
  const m: Message = { id: 'a1', role: 'assistant', status: 'ready', parts: [
    { type: 'text', text: '开始啦' },
    { type: 'tool', id: 't1', name: 'Bash', input: { command: 'ls' }, status: 'ready', result: 'a.png' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('开始啦')).toBeInTheDocument();
  expect(screen.getByText('Bash')).toBeInTheDocument();
});

test('助手文本消息:纯文本渲染、无角色标签', () => {
  const m: Message = {
    id: '1',
    role: 'assistant',
    status: 'ready',
    parts: [{ type: 'text', text: '已生成 3 张图' }],
  };
  render(<MessageItem message={m} />);
  expect(screen.getByText('已生成 3 张图')).toBeInTheDocument();
  expect(screen.queryByText('REZONA LAB AGENT')).not.toBeInTheDocument();
});

test('助手消息:**加粗**片段渲染为 strong', () => {
  const m: Message = {
    id: '1',
    role: 'assistant',
    status: 'ready',
    parts: [{ type: 'text', text: '已经 **生成 3 张图** 了' }],
  };
  render(<MessageItem message={m} />);
  const strong = screen.getByText('生成 3 张图');
  expect(strong.tagName).toBe('STRONG');
});

test('tool part 渲染工具卡(新 Part 模型)', () => {
  const m: Message = {
    id: '1',
    role: 'assistant',
    status: 'ready',
    parts: [{ type: 'tool', id: 't2', name: 'generate_image', input: {}, status: 'generating' }],
  };
  render(<MessageItem message={m} />);
  expect(screen.getByText('generate_image')).toBeInTheDocument();
});

// 报错已挪到输入框正上方的固定槽(设计稿 2026-08-27),对话流里不再渲染 —— 这里只剩
// 老会话快照存量 part 的兜底:必须是**空**,不能留一个带间距的空壳节点
test('error part 不再渲染(报错已挪到固定槽)', () => {
  const m: Message = { id: 'e1', role: 'assistant', status: 'error', parts: [
    { type: 'error', code: 'RUN_ALREADY_ACTIVE', text: 'run already active', detail: 'x' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('run already active')).not.toBeInTheDocument();
  expect(screen.queryByText('Details')).not.toBeInTheDocument();
});

test('思考块是最后一个 part 且消息生成中 → 展开(思考文本可见)', () => {
  const m: Message = { id: 'a2', role: 'assistant', status: 'generating', parts: [
    { type: 'thinking', text: '思考内容XYZ' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('思考内容XYZ')).toBeInTheDocument();
});

test('思考块后已有正文 → 思考块已结束自动收起,正文逐字流式输出', async () => {
  vi.useFakeTimers();
  const m: Message = { id: 'a3', role: 'assistant', status: 'generating', parts: [
    { type: 'thinking', text: '思考内容XYZ' },
    { type: 'text', text: '正文输出中' },
  ] };
  const { container, unmount } = render(<MessageItem message={m} />);
  // 思考块不再是最后一个 part(正文已开始)→ streaming=false → pill 自动收起,思考文本隐藏
  expect(screen.queryByText('思考内容XYZ')).not.toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(200); }); // 推进定时器,逐字打完
  // tail 中每个字符各在独立 <span> 节点,getByText 无法跨节点匹配;改用 container 的 textContent 包含断言
  expect(container.textContent).toContain('正文输出中');
  unmount();
  vi.useRealTimers();
});

test('消息已完成 → 思考块自动收起(pill 折叠,文本隐藏)', () => {
  const m: Message = { id: 'a4', role: 'assistant', status: 'ready', parts: [
    { type: 'thinking', text: '思考内容XYZ' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.queryByText('思考内容XYZ')).not.toBeInTheDocument();
});

test('空 thinking part 且消息已完成 → 不渲染 Thinking 头(后端剥空思考文本)', () => {
  const m: Message = { id: 'a5', role: 'assistant', status: 'ready', parts: [
    { type: 'thinking', text: '' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
});

test('空 thinking part 但消息生成中(流式空壳)→ 仍渲染 Thinking 转圈头', () => {
  const m: Message = { id: 'a6', role: 'assistant', status: 'generating', parts: [
    { type: 'thinking', text: '' },
  ] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('Thinking')).toBeInTheDocument();
});

test('用户消息:文本气泡渲染', () => {
  const m: Message = {
    id: 'u1',
    role: 'user',
    status: 'ready',
    parts: [{ type: 'text', text: '做一个跳跃游戏' }],
  };
  render(<MessageItem message={m} />);
  expect(screen.getByText('做一个跳跃游戏')).toBeInTheDocument();
});

test('用户消息:已知 @key 渲染为 chip 且正文剥离引用', () => {
  useStore.setState({ assets: [{ id: 'i', key: 'char-1', label: '主角', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 } }] });
  const m: Message = { id: 'u2', role: 'user', status: 'ready', parts: [{ type: 'text', text: '让 @char-1 更红' }] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('主角')).toBeInTheDocument(); // chip 标签
  expect(screen.getByText('让 更红')).toBeInTheDocument(); // 正文已剥离 @char-1
  expect(screen.queryByText(/@char-1/)).not.toBeInTheDocument();
});

test('用户消息:新格式 @[type]<url> 渲染为 chip 且正文剥离引用', () => {
  useStore.setState({ assets: [{ id: 'i', key: 'char-1', label: '主角', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://cdn/p/char-1.png' } }] });
  const m: Message = { id: 'u2b', role: 'user', status: 'ready', parts: [{ type: 'text', text: '让 @[image]<https://cdn/p/char-1.png> 更红' }] };
  render(<MessageItem message={m} />);
  expect(screen.getByText('主角')).toBeInTheDocument(); // chip 标签
  expect(screen.getByText('让 更红')).toBeInTheDocument(); // 正文已剥离新格式 token
});

test('用户消息:未知 @token 留在正文,不渲染 chip', () => {
  useStore.setState({ assets: [] });
  const m: Message = { id: 'u3', role: 'user', status: 'ready', parts: [{ type: 'text', text: '问 nick@example.com' }] };
  const { container } = render(<MessageItem message={m} />);
  // 未命中资产 → 不剥离成 chip,邮箱仍留在正文(GFM autolink 将其包成 mailto 链接,文本跨节点,故用 textContent 断言)
  expect(container.textContent).toContain('问 nick@example.com');
  expect(container.querySelector('a')?.getAttribute('href')).toBe('mailto:nick@example.com');
});

test('历史重建:反查不到画布资产的 @[type]<url> token → 游离 chip,不裸串进正文', () => {
  useStore.setState({ assets: [] });
  const msg: Message = {
    id: 'u4', role: 'user', status: 'ready',
    parts: [{ type: 'text', text: '看看 @[document]<https://cdn/f/spec.pdf> 和 <attachment name="notes.md">内联内容</attachment> 这个' }],
  };
  const { container } = render(<MessageItem message={msg} />);
  expect(screen.getByText('spec.pdf')).toBeInTheDocument();   // token 派生游离 chip
  expect(screen.getByText('notes.md')).toBeInTheDocument();   // attachment 块派生游离 chip
  expect(container.textContent).not.toContain('@[document]'); // 正文无裸 token
  expect(container.textContent).not.toContain('内联内容');     // 正文无内联原文
  expect(container.textContent).toContain('看看 和 这个');
});

test('用户消息含 media(图片)part → 与 @引用同款 Chip(缩略图 + 文件名)', () => {
  useStore.setState({ assets: [] });
  const msg: Message = {
    id: 'm1', role: 'user', status: 'ready',
    parts: [{ type: 'media', kind: 'image', url: 'http://x/a.png', name: 'a.png' }, { type: 'text', text: 'hi' }],
  };
  const { container } = render(<MessageItem message={msg} />);
  expect(container.querySelector('img[src="http://x/a.png"]')).not.toBeNull(); // 缩略图
  expect(screen.getByText('a.png')).toBeInTheDocument(); // Chip 文件名标签
  expect(screen.getByText('hi')).toBeInTheDocument();
});

test('用户消息 media 无 name(冷启动重建)→ Chip 用 kind 名兜底', () => {
  useStore.setState({ assets: [] });
  const msg: Message = {
    id: 'm2', role: 'user', status: 'ready',
    parts: [{ type: 'media', kind: 'image', url: 'http://x/b.png' }],
  };
  render(<MessageItem message={msg} />);
  expect(screen.getByText('Image')).toBeInTheDocument(); // KIND_META.image.badge
});

// —— A1:消息卡不整表订阅 assets,无关资产变化不得重渲 ——

const seedCanvasAsset = (id: string) => ({
  id, key: id, label: id, kind: 'image' as const, source: 'generated' as const,
  status: 'ready' as const, position: { x: 0, y: 0 },
});

test('无引用的用户消息:无关资产变化不触发重渲(A1)', () => {
  useStore.setState({ assets: [] });
  const commits: string[] = [];
  const m: Message = { id: 'p1', role: 'user', status: 'ready', parts: [{ type: 'text', text: '纯文本消息,没有引用' }] };
  render(
    <Profiler id="mi" onRender={(_, phase) => commits.push(phase)}>
      <MessageItem message={m} />
    </Profiler>,
  );
  const before = commits.length;
  act(() => {
    useStore.setState({ assets: [seedCanvasAsset('unrelated-1')] });
  });
  expect(commits.length).toBe(before);
});

test('助手消息:资产变化不触发重渲(A1,助手分支不消费 assets)', () => {
  useStore.setState({ assets: [] });
  const commits: string[] = [];
  const m: Message = { id: 'p2', role: 'assistant', status: 'ready', parts: [{ type: 'text', text: '助手输出的 **markdown**' }] };
  render(
    <Profiler id="mi2" onRender={(_, phase) => commits.push(phase)}>
      <MessageItem message={m} />
    </Profiler>,
  );
  const before = commits.length;
  act(() => {
    useStore.setState({ assets: [seedCanvasAsset('unrelated-2')] });
  });
  expect(commits.length).toBe(before);
});

test('有引用的用户消息:追加无关资产不重渲;被引资产删除(解析变化)才重渲(A1)', () => {
  const referenced = { ...seedCanvasAsset('char-1'), label: '主角' };
  useStore.setState({ assets: [referenced] });
  const commits: string[] = [];
  const m: Message = { id: 'p3', role: 'user', status: 'ready', parts: [{ type: 'text', text: '让 @char-1 更红' }] };
  render(
    <Profiler id="mi3" onRender={(_, phase) => commits.push(phase)}>
      <MessageItem message={m} />
    </Profiler>,
  );
  expect(screen.getByText('主角')).toBeInTheDocument();
  const before = commits.length;
  // 追加无关资产(被引资产对象引用不变):解析签名不变 → 消息卡与内部 chip 都不重渲
  act(() => {
    useStore.setState({ assets: [referenced, seedCanvasAsset('unrelated-3')] });
  });
  expect(commits.length).toBe(before);
  // 资产删除:解析结果变化 → 必须重渲(chip 退化回正文 token)
  act(() => {
    useStore.setState({ assets: [seedCanvasAsset('unrelated-3')] });
  });
  expect(commits.length).toBeGreaterThan(before);
});

// —— 消息复制与输入回填编辑 ——

test('用户消息复制:写入引用剥离前的原始输入', async () => {
  // 真实剪贴板写入是异步的:mock 延后一拍 resolve,让「续体里的 setCopied」在快机上也必须被等待,不靠机器快慢碰运气
  const writeText = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5)));
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useStore.setState({ assets: [{ id: 'i', key: 'char-1', label: '主角', kind: 'image', source: 'generated', status: 'ready', position: { x: 0, y: 0 } }] });
  const message: Message = {
    id: 'copy-user',
    role: 'user',
    status: 'ready',
    parts: [{ type: 'text', text: '让 @char-1 **更红**' }],
  };

  render(<MessageItem message={message} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith('让 @char-1 **更红**'));
  // writeText 被调用 ≠ copied 态已落定:setCopied 在 await 之后的续体里跑,同步断言会抢在状态更新前(CI 慢机必现)
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

test('用户消息编辑:原始输入替换草稿,保留现有附件', () => {
  const existing: ChatAttachment = {
    id: 'att-existing',
    name: 'keep.png',
    mime: 'image/png',
    kind: 'image',
    status: 'ready',
    url: 'https://cdn/keep.png',
  };
  useStore.setState({
    composer: { draft: '未发送草稿', attachments: [existing], baseLines: 4 },
  });
  const message: Message = {
    id: 'edit-user',
    role: 'user',
    status: 'ready',
    parts: [{ type: 'text', text: '重做 @hero 的跳跃动画' }],
  };

  render(<MessageItem message={message} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));

  expect(useStore.getState().composer).toEqual({
    draft: '重做 @hero 的跳跃动画',
    attachments: [existing],
    baseLines: 4,
  });
});

test('助手正文不渲染消息级复制操作,由 ChatPanel 在回合末尾统一提供', () => {
  const message: Message = {
    id: 'copy-assistant',
    role: 'assistant',
    status: 'ready',
    parts: [
      { type: 'text', text: '## 完成' },
      { type: 'tool', id: 'tool-1', name: 'Bash', input: {}, status: 'ready' },
      { type: 'text', text: '- 第一项\n- 第二项' },
    ],
  };

  render(<MessageItem message={message} />);

  expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
});

test('纯工具助手消息:不渲染无意义的复制按钮', () => {
  const message: Message = {
    id: 'tool-only',
    role: 'assistant',
    status: 'ready',
    parts: [{ type: 'tool', id: 'tool-1', name: 'Bash', input: {}, status: 'ready' }],
  };

  render(<MessageItem message={message} />);

  expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
});

test('用户消息操作栏使用固定间距,hover/聚焦不触发布局位移', () => {
  const message: Message = {
    id: 'actions-spacing',
    role: 'user',
    status: 'ready',
    parts: [{ type: 'text', text: '调整消息操作栏间距' }],
  };

  const { container } = render(<MessageItem message={message} />);
  const root = container.firstElementChild;

  expect(root).toHaveClass('mb-11');
  expect(root).not.toHaveClass('hover:mb-12');
  expect(root).not.toHaveClass('focus-within:mb-12');
});

test('复制被剪贴板拒绝:写入全局 Warning Toast', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    configurable: true,
  });
  const message: Message = {
    id: 'copy-failed',
    role: 'user',
    status: 'ready',
    parts: [{ type: 'text', text: '复制我' }],
  };

  render(<MessageItem message={message} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));

  await waitFor(() => {
    expect(useStore.getState().toast).toMatchObject({ code: 'CLIPBOARD', kind: 'warning' });
  });
});

