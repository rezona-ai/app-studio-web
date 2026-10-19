import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import Composer from './Composer';
import { useStore } from '@/store';
import type { KoubouClient } from '@/koubou/client';
import type { Asset } from '@/store/types';

const clientRef = { current: null } as React.RefObject<KoubouClient | null>;

function makeSpyClient() {
  const sendUserMessage = vi.fn();
  const steer = vi.fn();
  const ref = { current: { sendUserMessage, steer } } as unknown as React.RefObject<KoubouClient | null>;
  return { ref, sendUserMessage, steer };
}

beforeEach(() => {
  // replay:null 显式复位,防止回放态用例(下方)残留状态污染后续用例(setState 是浅合并,不重置未提及字段)
  // connStatus 缺省 open:发送路径用例走正常门控;门控专项用例单独覆写 connecting/stalled
  useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 }, composerFocusRequest: 0, runStatus: 'idle', assets: [], availableModels: [], selectedModel: null, autoSendArmed: false, connStatus: 'open', skills: [], replay: null, messages: [], toast: null });
  // 发送按钮 submitVariant 依赖主题(useIsDark 读 <html data-theme>);本组用例验证浅色态下的明暗变体映射,固定浅色
  document.documentElement.dataset.theme = 'light';
});
afterEach(cleanup);

test('空草稿 → 发送按钮浅色态(rounded-12,无 active class)', () => {
  render(<Composer client={clientRef} />);
  const send = screen.getByRole('button', { name: 'Send' });
  expect(send.className).toContain('rounded-[12px]');
  expect(send.className).not.toContain('btn-raised-active');
});

test('有草稿 → 发送按钮深色 active 态(rounded-10)', () => {
  useStore.setState({ composer: { draft: '做个游戏', attachments: [], baseLines: 2 } });
  render(<Composer client={clientRef} />);
  const send = screen.getByRole('button', { name: 'Send' });
  expect(send.className).toContain('btn-raised-active');
  expect(send.className).toContain('rounded-[10px]');
});

test('历史输入编辑请求 → 聚焦 Composer 并把光标移到新草稿末尾', () => {
  render(<Composer client={clientRef} />);

  act(() => {
    useStore.getState().editComposerDraft('重做角色跳跃');
  });

  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  expect(textarea).toHaveFocus();
  expect(textarea.value).toBe('重做角色跳跃');
  expect(textarea.selectionStart).toBe('重做角色跳跃'.length);
  expect(textarea.selectionEnd).toBe('重做角色跳跃'.length);
});

test('草稿仅含 @引用(无其它文字)→ 也是可发送 active 态', () => {
  useStore.setState({ composer: { draft: '@k1 ', attachments: [], baseLines: 2 } });
  render(<Composer client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Send' }).className).toContain('btn-raised-active');
});

test('输入法组合期间回车不触发发送', () => {
  useStore.setState({ composer: { draft: '你好', attachments: [], baseLines: 2 } });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
  });
  expect(sendUserMessage).not.toHaveBeenCalled();
});

test('普通回车触发发送', () => {
  useStore.setState({ composer: { draft: '你好', attachments: [], baseLines: 2 } });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
  });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
});

// ---- 发送门控:连接未就绪时阻发,草稿保留 + warning 提示(spec 2026-07-22 chat-conn-resilience)----
test('connecting 态点发送 → 不发、不插乐观气泡、草稿保留、出 warning', () => {
  useStore.setState({ composer: { draft: '做个游戏', attachments: [], baseLines: 2 }, connStatus: 'connecting' });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
  expect(sendUserMessage).not.toHaveBeenCalled();
  expect(useStore.getState().messages).toHaveLength(0);
  expect(useStore.getState().composer.draft).toBe('做个游戏');
  expect(useStore.getState().toast).toMatchObject({ code: 'CONN_NOT_READY', kind: 'warning' });
});

test('client 未就绪(ref 为 null)点发送 → 同样阻发并保留草稿', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [], baseLines: 2 }, connStatus: 'open' });
  render(<Composer client={clientRef} />);   // clientRef.current === null
  act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
  expect(useStore.getState().messages).toHaveLength(0);
  expect(useStore.getState().composer.draft).toBe('hi');
  expect(useStore.getState().toast).toMatchObject({ code: 'CONN_NOT_READY' });
});

test('stalled 态运行中 steer 也被门控阻断', () => {
  useStore.setState({ composer: { draft: '换个方向', attachments: [], baseLines: 2 }, connStatus: 'stalled', runStatus: 'running' });
  const { ref, steer } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
  expect(steer).not.toHaveBeenCalled();
  expect(useStore.getState().composer.draft).toBe('换个方向');
});

test('重复点击 @ 按钮只插入一个 @ 符号', () => {
  // 有可提及资产时 @ 才可点;注入一个最小资产(须带 preview.src 才满足 canMention)
  useStore.setState({ assets: [{ id: 'a1', key: 'k1', label: 'asset', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://x/k1.png' } } as Asset] });
  render(<Composer client={clientRef} />);
  const at = screen.getByRole('button', { name: 'Mention' });
  act(() => {
    fireEvent.mouseDown(at);
    fireEvent.mouseDown(at);
    fireEvent.mouseDown(at);
  });
  expect(useStore.getState().composer.draft).toBe('@');
});

test('Shift+回车不触发发送(换行)', () => {
  useStore.setState({ composer: { draft: '你好', attachments: [], baseLines: 2 } });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => {
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
  });
  expect(sendUserMessage).not.toHaveBeenCalled();
});

test('有可选模型时在 send 左侧渲染模型选择器', () => {
  // 多模型(常见情形)→ 可展开的下拉触发钮;单模型则渲染为静态标签(无可选项,见 Select)
  useStore.setState({ availableModels: ['claude-opus-4-8', 'claude-sonnet-4-6'], selectedModel: 'claude-opus-4-8' });
  render(<Composer client={clientRef} />);
  expect(screen.getByRole('button', { name: 'Model: Opus 4.8' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
});

const att = (over: Partial<import('@/store/types').ChatAttachment> = {}) =>
  ({ id: 'a1', name: 'a.png', mime: 'image/png', kind: 'image' as const, status: 'ready' as const, url: 'http://x/a.png', ...over });

test('图片附件就绪发送 → 气泡含 media part + koubou content 为 [text, image url 块]', () => {
  useStore.setState({ composer: { draft: '看这张', attachments: [att()], baseLines: 2 }, runStatus: 'idle', assets: [] });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  const lastMsg = useStore.getState().messages.at(-1)!;
  expect(lastMsg.parts).toContainEqual({ type: 'media', kind: 'image', url: 'http://x/a.png', name: 'a.png' });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: [{ type: 'text', text: '看这张' }, { type: 'image', source: { type: 'url', url: 'http://x/a.png' } }],
  });
});

test('video/audio/3d 附件折叠为 @[type]<url> 新格式', () => {
  useStore.setState({
    composer: {
      draft: '配乐',
      attachments: [
        att({ id: 'v', name: 'c.mp4', mime: 'video/mp4', kind: 'video', url: 'http://x/c.mp4' }),
        att({ id: 'm', name: 'd.glb', mime: 'model/gltf-binary', kind: '3d', url: 'http://x/d.glb' }),
      ],
      baseLines: 2,
    },
    runStatus: 'idle', assets: [],
  });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: '配乐 @[video]<http://x/c.mp4> @[model3d]<http://x/d.glb>',
  });
});

test('PDF 附件走 @[document]<url> token,不再发原生 document 块', () => {
  useStore.setState({
    composer: { draft: '照这个做', attachments: [att({ id: 'd', name: 'spec.pdf', mime: 'application/pdf', kind: 'text', url: 'http://x/spec.pdf' })], baseLines: 2 },
    runStatus: 'idle', assets: [],
  });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: '照这个做 @[document]<http://x/spec.pdf>',
  });
});

test('专用 text 接口落库的文本附件(无 url)仍可发送并内联', () => {
  useStore.setState({
    composer: { draft: '', attachments: [att({ id: 't2', name: 'b.txt', mime: 'text/plain', kind: 'text', url: undefined, text: '正文内容' })], baseLines: 2 },
    runStatus: 'idle', assets: [],
  });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  const btn = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  act(() => { btn.click(); });
  expect(sendUserMessage.mock.calls[0][0].content).toContain('<attachment name="b.txt">正文内容</attachment>');
});

test('纯文本附件内联 attachment 标签发送,不发 URL token', () => {
  useStore.setState({
    composer: { draft: '看看这个', attachments: [att({ id: 't', name: 'a.md', mime: 'text/markdown', kind: 'text', url: 'https://x/a.md', text: '# 内容' })], baseLines: 2 },
    runStatus: 'idle', assets: [],
  });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  const call = sendUserMessage.mock.calls[0][0];
  expect(call.content).toContain('<attachment name="a.md"># 内容</attachment>');
  expect(call.content).not.toContain('@[document]<https://x/a.md>');
});

test('附件上传中 → 发送按钮禁用', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [att({ status: 'uploading', url: undefined })], baseLines: 2 }, runStatus: 'idle', assets: [] });
  render(<Composer client={clientRef} />);
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
});

test('上传中按回车不发送(send 早返回守护)', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [att({ status: 'uploading', url: undefined })], baseLines: 2 }, runStatus: 'idle', assets: [] });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
  expect(sendUserMessage).not.toHaveBeenCalled();
});

// —— 粘贴附件 ——
// 剪贴板替身:jsdom 的 ClipboardEvent 不带 clipboardData,按 filesFromClipboard 用到的字段构造
function pasteData(files: File[], text = ''): unknown {
  return {
    files: files as unknown as FileList,
    items: text ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] : [],
    getData: () => text,
  };
}

test('输入框粘贴图片 → 走上传,草稿不变且拦截默认粘贴', () => {
  const uploadChatAttachment = vi.fn();
  useStore.setState({ composer: { draft: '原有草稿', attachments: [], baseLines: 2 }, uploadChatAttachment });
  render(<Composer client={clientRef} />);
  const file = new File(['x'], 'shot.png', { type: 'image/png' });
  const prevented = !fireEvent.paste(screen.getByRole('textbox'), { clipboardData: pasteData([file]) });
  expect(uploadChatAttachment).toHaveBeenCalledTimes(1);
  expect(uploadChatAttachment.mock.calls[0][0]).toBe(file);
  expect(prevented).toBe(true);
  expect(useStore.getState().composer.draft).toBe('原有草稿'); // 文件粘贴不动文本
});

test('图文混合粘贴 → 只收文件,不把文本插进草稿', () => {
  const uploadChatAttachment = vi.fn();
  useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 }, uploadChatAttachment });
  render(<Composer client={clientRef} />);
  const file = new File(['x'], 'shot.png', { type: 'image/png' });
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: pasteData([file], '<p>网页文本</p>') });
  expect(uploadChatAttachment).toHaveBeenCalledTimes(1);
  expect(useStore.getState().composer.draft).toBe('');
});

test('纯文本粘贴 → 不上传且放行浏览器默认行为', () => {
  const uploadChatAttachment = vi.fn();
  useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 }, uploadChatAttachment });
  render(<Composer client={clientRef} />);
  const prevented = !fireEvent.paste(screen.getByRole('textbox'), { clipboardData: pasteData([], '一段文字') });
  expect(uploadChatAttachment).not.toHaveBeenCalled();
  expect(prevented).toBe(false);
});

test('粘贴超类型白名单的文件 → 出 UPLOAD Toast 且不上传', () => {
  const uploadChatAttachment = vi.fn();
  useStore.setState({ composer: { draft: '', attachments: [], baseLines: 2 }, uploadChatAttachment, toast: null });
  render(<Composer client={clientRef} />);
  const bad = new File(['x'], 'a.rar', { type: 'application/x-rar-compressed' });
  fireEvent.paste(screen.getByRole('textbox'), { clipboardData: pasteData([bad]) });
  expect(uploadChatAttachment).not.toHaveBeenCalled();
  const toast = useStore.getState().toast;
  expect(toast?.code).toBe('UPLOAD');
  expect(toast?.message).toContain('a.rar');
});

// —— landing prelude 自动发送(autoSendArmed)——
test('armed + WS 已连上(open)→ 挂载即自动发送一次并清 armed', () => {
  useStore.setState({ composer: { draft: '做个游戏', attachments: [], baseLines: 2 }, autoSendArmed: true, connStatus: 'open' });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
  expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: '做个游戏' });
  expect(useStore.getState().autoSendArmed).toBe(false); // 一次性:发送后清标志
  expect(useStore.getState().composer.draft).toBe('');   // send 末尾 resetComposer
});

test('未 armed → 挂载不自动发送', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [], baseLines: 2 }, autoSendArmed: false, connStatus: 'open' });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  expect(sendUserMessage).not.toHaveBeenCalled();
});

test('armed 但 client 未就绪 → 暂不发;就绪且 connStatus 变化后补发一次', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [], baseLines: 2 }, autoSendArmed: true, connStatus: 'connecting' });
  const sendUserMessage = vi.fn();
  const ref = { current: null } as React.RefObject<KoubouClient | null>;
  render(<Composer client={ref} />);
  expect(sendUserMessage).not.toHaveBeenCalled(); // client.current 为 null:等连接就绪
  act(() => {
    ref.current = { sendUserMessage, steer: vi.fn() } as unknown as KoubouClient;
    useStore.setState({ connStatus: 'open' }); // connecting→open 驱动 effect 重判
  });
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
  expect(useStore.getState().autoSendArmed).toBe(false);
});

test('armed 自动发送后 connStatus 再变化不重发(防重)', () => {
  useStore.setState({ composer: { draft: 'hi', attachments: [], baseLines: 2 }, autoSendArmed: true, connStatus: 'open' });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  expect(sendUserMessage).toHaveBeenCalledTimes(1);
  act(() => { useStore.setState({ connStatus: 'closed' }); });
  act(() => { useStore.setState({ connStatus: 'open' }); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1); // 标志已清,后续连接抖动不重发
});

test('armed + client 已就绪但 WS 未连上(connecting)→ 不发;转 open 后才发', () => {
  // client 对象一创建即存在,但 WS 尚未握手;须等 connStatus==='open' 确认连上再发,不依赖排队冲刷
  useStore.setState({ composer: { draft: 'hi', attachments: [], baseLines: 2 }, autoSendArmed: true, connStatus: 'connecting' });
  const { ref, sendUserMessage } = makeSpyClient(); // client.current 已就绪
  render(<Composer client={ref} />);
  expect(sendUserMessage).not.toHaveBeenCalled(); // WS 未 open:即便 client 已存在也不发
  act(() => { useStore.setState({ connStatus: 'open' }); });
  expect(sendUserMessage).toHaveBeenCalledTimes(1); // 连上后才发
  expect(useStore.getState().autoSendArmed).toBe(false);
});

test('纯图片无草稿发送 → content 仅含 image url 块(无空文本块)', () => {
  useStore.setState({ composer: { draft: '', attachments: [att()], baseLines: 2 }, runStatus: 'idle', assets: [] });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: [{ type: 'image', source: { type: 'url', url: 'http://x/a.png' } }],
  });
});

// skill 契约:后端下发 name + backend 原生调用串 invocation(cc 为 /name,codex 为 $name)
const sk = (name: string, prefix = '/') => ({ name, invocation: `${prefix}${name}` });
// —— skill 斜杠命令 ——
test('输入 / 弹出 Skill 弹窗', () => {
  useStore.setState({ skills: [sk('plan'), sk('cutout')] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
  expect(screen.getByText('Skill')).toBeInTheDocument();
  expect(screen.getByText('Game Design')).toBeInTheDocument();
});

test('query 过滤(slug 与显示名),无匹配显示空态', () => {
  useStore.setState({ skills: [sk('plan'), sk('cutout')] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: '/zzz', selectionStart: 4 } });
  expect(screen.getByText('No matching skill')).toBeInTheDocument();
});

test('点击选中:替换 /query 为 /slug 加尾随空格', () => {
  useStore.setState({ skills: [sk('plan')] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: 'do /pl', selectionStart: 6 } });
  fireEvent.mouseDown(screen.getByText('Game Design'));
  expect(useStore.getState().composer.draft).toBe('do /plan ');
});

test('Enter 选中高亮项而非发送', () => {
  useStore.setState({ skills: [sk('plan'), sk('cutout')] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
  fireEvent.keyDown(ta, { key: 'ArrowDown' });
  fireEvent.keyDown(ta, { key: 'Enter' });
  expect(useStore.getState().composer.draft).toBe('/cutout ');
});

test('Escape 关闭弹窗', () => {
  useStore.setState({ skills: [sk('plan')] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
  fireEvent.keyDown(ta, { key: 'Escape' });
  expect(screen.queryByText('Game Design')).not.toBeInTheDocument();
});

test('@ 与 / 同时命中时,取更靠近光标者生效(不双弹窗)', () => {
  useStore.setState({ skills: [sk('plan')], assets: [{ id: 'a1', key: 'k1', label: 'asset', kind: 'image', status: 'ready', position: { x: 0, y: 0 } } as Asset] });
  render(<Composer client={clientRef} />);
  const ta = screen.getByRole('textbox');
  fireEvent.change(ta, { target: { value: '@a /pl', selectionStart: 6 } });
  expect(screen.getByText('Game Design')).toBeInTheDocument();
});

// —— skill 手动入口(工具列 </> 按钮) ——
describe('skill 按钮', () => {
  it('点击插入前缀并弹出 Skill 弹窗', () => {
    useStore.setState({ skills: [sk('plan'), sk('cutout')] });
    render(<Composer client={clientRef} />);
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(useStore.getState().composer.draft).toBe('/');
    expect(screen.getByText('Game Design')).toBeInTheDocument();
  });

  it('重复点击只插入一个前缀,且菜单保持打开', () => {
    useStore.setState({ skills: [sk('plan')] });
    render(<Composer client={clientRef} />);
    const btn = screen.getByRole('button', { name: 'Skill' });
    act(() => {
      fireEvent.mouseDown(btn);
      fireEvent.mouseDown(btn);
      fireEvent.mouseDown(btn);
    });
    expect(useStore.getState().composer.draft).toBe('/');
    expect(screen.getByText('Game Design')).toBeInTheDocument(); // 守卫的另一半:不追加符号但菜单不关
  });

  it('前缀随 backend 由 invocation 派生(codex 为 $)', () => {
    useStore.setState({ skills: [sk('plan', '$')] });
    render(<Composer client={clientRef} />);
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(useStore.getState().composer.draft).toBe('$');
    expect(screen.getByText('Game Design')).toBeInTheDocument();
  });

  it('已有草稿时补空格再插前缀(前缀须在词首才激活)', () => {
    useStore.setState({ skills: [sk('plan')], composer: { draft: '做个游戏', attachments: [], baseLines: 2 } });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(useStore.getState().composer.draft).toBe('做个游戏 /');
    expect(screen.getByText('Game Design')).toBeInTheDocument();
    // 补空格的真正不变式:继续打字后 onChange 重算(走 getActiveSkillToken)时前缀仍在词首,弹窗不掉
    fireEvent.change(ta, { target: { value: '做个游戏 /pl', selectionStart: 8 } });
    expect(screen.getByText('Game Design')).toBeInTheDocument();
  });

  it('草稿末尾已是空白时不重复补空格', () => {
    useStore.setState({ skills: [sk('plan')], composer: { draft: '做个游戏 ', attachments: [], baseLines: 2 } });
    render(<Composer client={clientRef} />);
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(useStore.getState().composer.draft).toBe('做个游戏 /');
  });

  // 两个弹窗互斥必须双向:渲染条件各自独立(mention && … / slash && …),
  // 单向收口时「点 Skill 再点 @」会同时挂两层菜单
  it('点 Skill 后再点 @:skill 菜单让位给 mention 菜单', () => {
    useStore.setState({
      skills: [sk('plan')],
      assets: [{ id: 'a1', key: 'k1', label: 'asset', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://x/k1.png' } } as Asset],
    });
    render(<Composer client={clientRef} />);
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(screen.getByText('Game Design')).toBeInTheDocument();
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Mention' })); });
    expect(screen.getByText('asset')).toBeInTheDocument();
    expect(screen.queryByText('Game Design')).not.toBeInTheDocument();
  });

  it('点 @ 后再点 Skill:mention 菜单让位给 skill 菜单', () => {
    useStore.setState({
      skills: [sk('plan')],
      assets: [{ id: 'a1', key: 'k1', label: 'asset', kind: 'image', status: 'ready', position: { x: 0, y: 0 }, preview: { src: 'https://x/k1.png' } } as Asset],
    });
    render(<Composer client={clientRef} />);
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Mention' })); });
    expect(screen.getByText('asset')).toBeInTheDocument();
    act(() => { fireEvent.mouseDown(screen.getByRole('button', { name: 'Skill' })); });
    expect(screen.getByText('Game Design')).toBeInTheDocument();
    expect(screen.queryByText('asset')).not.toBeInTheDocument();
  });

  it('skill 列表未加载时按钮禁用', () => {
    useStore.setState({ skills: [] });
    render(<Composer client={clientRef} />);
    expect(screen.getByRole('button', { name: 'Skill' })).toBeDisabled();
  });
});

describe('skill 内联胶囊(底衬高亮)', () => {
  it('draft 含已知 skill token 时镜像层渲染胶囊片段', () => {
    useStore.setState({ skills: [sk('plan')] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/plan go', selectionStart: 8 } });
    const pill = screen.getByTestId('skill-pill');
    expect(pill).toHaveTextContent('/plan');
  });
  it('未知 slug 不渲染胶囊', () => {
    useStore.setState({ skills: [sk('plan')] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/nope go', selectionStart: 8 } });
    expect(screen.queryByTestId('skill-pill')).not.toBeInTheDocument();
  });
});

describe('mention 内联胶囊(草稿内 @key 着色)', () => {
  const asset = { id: 'a1', key: 'char-1', label: '主角', kind: 'image' as const, source: 'generated' as const, status: 'ready' as const, position: { x: 0, y: 0 }, preview: { src: 'https://cdn/p/char-1.png' } };

  it('draft 含已知且可提及的 @key 时镜像层渲染 mention 胶囊', () => {
    useStore.setState({ assets: [asset] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    // 光标落在串尾(12):@ 后到光标含空格,getActiveMention 返回 null,不触发候选弹窗,只验证镜像层着色
    fireEvent.change(ta, { target: { value: '改 @char-1 更红', selectionStart: 12 } });
    const pill = screen.getByTestId('mention-pill');
    expect(pill).toHaveTextContent('@char-1');
  });

  it('资产未就绪(不可提及)时不渲染 mention 胶囊', () => {
    useStore.setState({ assets: [{ ...asset, status: 'generating' as const }] });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox');
    // 光标落在串尾(12):@ 后到光标含空格,getActiveMention 返回 null,不触发候选弹窗,只验证镜像层着色
    fireEvent.change(ta, { target: { value: '改 @char-1 更红', selectionStart: 12 } });
    expect(screen.queryByTestId('mention-pill')).not.toBeInTheDocument();
  });

  it('从候选弹窗选中 → 在光标处插入 @key(替换正在输入的 @query),而非追加到末尾', () => {
    useStore.setState({ assets: [asset], composer: { draft: '', attachments: [], baseLines: 2 } });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    // 初始 draft 留空(而非直接预置成目标串):textarea 受控值若与 fireEvent.change 目标值相同,
    // React 的 value-tracker 会判定"无变化"而不触发 onChange,导致 mention 永不激活
    // 光标紧跟在 "@c" 之后(索引 7,c 后、空格前),getActiveMention 才会激活 query='c'
    fireEvent.change(ta, { target: { value: '前面文字 @c 后面文字', selectionStart: 7 } });
    fireEvent.mouseDown(screen.getByText('主角'));
    expect(useStore.getState().composer.draft).toBe('前面文字 @char-1  后面文字');
  });

  it('发送时把草稿中的 @key 原位替换为 @[type]<url>', () => {
    useStore.setState({ assets: [asset], composer: { draft: '改 @char-1 更红', attachments: [], baseLines: 2 } });
    const { ref, sendUserMessage } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
    expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: '改 @[image]<https://cdn/p/char-1.png> 更红' });
  });

  it('运行中 steer 发送同样替换 @key', () => {
    useStore.setState({ assets: [asset], composer: { draft: '改 @char-1 更红', attachments: [], baseLines: 2 }, runStatus: 'running' });
    const { ref, steer } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' }); });
    expect(steer).toHaveBeenCalledWith('改 @[image]<https://cdn/p/char-1.png> 更红');
  });

  it('@引用 text 节点:气泡保留 @key,koubou 侧为 attachment 标签', () => {
    const textAsset = { id: 'a2', key: 'note1', label: '设定', kind: 'text' as const, source: 'generated' as const, status: 'ready' as const, position: { x: 0, y: 0 }, preview: { text: '内容' } };
    useStore.setState({ assets: [textAsset], composer: { draft: '看 @note1', attachments: [], baseLines: 2 } });
    const { ref, sendUserMessage } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
    const lastMsg = useStore.getState().messages.at(-1)!;
    const textPart = lastMsg.parts.find((p) => p.type === 'text') as { text: string };
    expect(textPart.text).toContain('@note1');
    expect(sendUserMessage).toHaveBeenCalledWith({ role: 'user', content: '看 <attachment name="设定">内容</attachment>' });
  });
});

// —— 回放态(replay!=null)禁用输入 ——
describe('回放中禁用输入', () => {
  test('回放中(replay!=null)→ 输入框禁用且占位替换为回放提示、发送按钮禁用、停止按钮不渲染(即便 runStatus=running)', () => {
    useStore.setState({
      replay: { phase: 'playing', templateId: 't', projectId: 7, sessionId: 's', total: 3, cursor: 1, speed: 1 },
      runStatus: 'running',
      composer: { draft: '做个游戏', attachments: [], baseLines: 2 },
    });
    render(<Composer client={clientRef} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
    expect(ta.placeholder).toBe('Watching the replay…');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  test('非回放(replay=null)+ runStatus=running → 渲染停止按钮(基线对照,证明上例是回放态特有的降级)', () => {
    useStore.setState({ replay: null, runStatus: 'running' });
    render(<Composer client={clientRef} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });
});

// —— auto-grow 与拖拽把手(Task 3) ——
describe('输入框高度:auto-grow 与拖拽把手', () => {
  test('渲染拖拽把手,拖动更新 baseLines', () => {
    render(<Composer client={clientRef} />);
    const handle = screen.getByRole('separator', { name: /调整|resize/i });
    // 向上拖 48px = +2 行
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 252, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(useStore.getState().composer.baseLines).toBe(4);
  });

  test('容器高度随 baseLines 变化', () => {
    useStore.setState({ composer: { draft: '', attachments: [], baseLines: 5 } });
    render(<Composer client={clientRef} />);
    expect(screen.getByTestId('composer-textbox').style.height).toBe('124px'); // 5*24+4
  });
});

// 工具列三个按钮(+ / @ / </>)是同一层级的入口,图标必须同色:@ 与 skill 若恒 --color-muted 灰,
// 在可用状态下也像被禁用(禁用态本就由 IconButton 的 disabled:opacity-30 表达,不靠灰色)
describe('工具列图标同色', () => {
  const iconColorOf = (label: string) => {
    const btn = screen.getByRole('button', { name: label });
    return (btn.querySelector('span[style]') as HTMLElement).style.backgroundColor;
  };

  test('+ / @ / skill 三个图标都随按钮文字色(currentColor),不恒灰', () => {
    // 给一张可提及资产 + 一个 skill,让 @ 与 skill 处在可用态
    useStore.setState({
      assets: [{ id: 'a1', key: 'hero', kind: 'image', status: 'ready', name: 'hero.png',
        preview: { src: 'https://x/1.png' }, position: { x: 0, y: 0 } } as unknown as Asset],
      skills: [{ name: 'game-plan', invocation: '/game-plan' }],
    });
    render(<Composer client={clientRef} />);
    expect(screen.getByRole('button', { name: 'Mention' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skill' })).not.toBeDisabled();
    expect(iconColorOf('Attach')).toBe('currentcolor');
    expect(iconColorOf('Mention')).toBe('currentcolor');
    expect(iconColorOf('Skill')).toBe('currentcolor');
  });
});

// 补齐插话入口(设计稿 2026-08-25 决策 8):此前 running 态按钮位被停止键独占,插话只能靠回车,
// 界面上看不出有这功能
describe('回合进行中的插话入口', () => {
  test('有草稿 → 停止与发送并排,两个动作都可达', () => {
    useStore.setState({ runStatus: 'running', composer: { draft: '再红一点', attachments: [], baseLines: 2 } });
    const { ref, steer } = makeSpyClient();
    render(<Composer client={ref} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    act(() => { screen.getByRole('button', { name: 'Send and steer' }).click(); });
    expect(steer).toHaveBeenCalledWith('再红一点');
  });

  test('空草稿 → 只有停止(没内容可插话)', () => {
    useStore.setState({ runStatus: 'running', composer: { draft: '', attachments: [], baseLines: 2 } });
    render(<Composer client={makeSpyClient().ref} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send and steer' })).not.toBeInTheDocument();
  });

  test('插话发出后记下内容供重发,且不置乐观计时', () => {
    // pendingSendAt 显式复位:该文件的 beforeEach 不含此字段(setState 浅合并),不复位会读到上一用例的残留
    useStore.setState({ runStatus: 'running', composer: { draft: '再红一点', attachments: [], baseLines: 2 }, pendingSendAt: null });
    const { ref } = makeSpyClient();
    render(<Composer client={ref} />);
    act(() => { screen.getByRole('button', { name: 'Send and steer' }).click(); });
    expect(useStore.getState().lastSend).toEqual({ content: '再红一点' });
    expect(useStore.getState().pendingSendAt).toBeNull();
  });
});

// 既有 bug(设计稿 2026-08-25 ⑨):steer 只能发文本,而 image 附件既不在 koubouText 里
// (tokenFolded/inlined 都 filter 掉 image),也没有 imageBlocks —— 于是气泡显示了图,agent 什么都没收到
test('插话带图 → 图折成 @[image]<url> 进 steer 文本,不再静默丢弃', () => {
  useStore.setState({
    runStatus: 'running',
    composer: { draft: '照这张改', attachments: [att()], baseLines: 2 },
    assets: [], pendingSendAt: null,
  });
  const { ref, steer } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send and steer' }).click(); });
  expect(steer).toHaveBeenCalledWith('照这张改 @[image]<http://x/a.png>');
});

test('插话只有图无文字 → 仍发得出去(不再被空文本门控吞掉)', () => {
  useStore.setState({
    runStatus: 'running',
    composer: { draft: '', attachments: [att()], baseLines: 2 },
    assets: [], pendingSendAt: null,
  });
  const { ref, steer } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send and steer' }).click(); });
  expect(steer).toHaveBeenCalledWith('@[image]<http://x/a.png>');
});

test('非插话路径不受影响:image 仍走原生内容块,不折 token', () => {
  useStore.setState({ runStatus: 'idle', composer: { draft: '看这张', attachments: [att()], baseLines: 2 }, assets: [] });
  const { ref, sendUserMessage } = makeSpyClient();
  render(<Composer client={ref} />);
  act(() => { screen.getByRole('button', { name: 'Send' }).click(); });
  expect(sendUserMessage).toHaveBeenCalledWith({
    role: 'user',
    content: [{ type: 'text', text: '看这张' }, { type: 'image', source: { type: 'url', url: 'http://x/a.png' } }],
  });
});
