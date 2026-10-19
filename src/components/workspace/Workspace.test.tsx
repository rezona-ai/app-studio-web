import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useStore } from '@/store';
import type { Version } from '@/store/types';
import { CHAT_WIDTH_MIN, PREVIEW_WIDTH_MIN, SEPARATOR_W, fitChatWidth, minPageWidth } from '@/lib/sidebar-fit';
import { HANDLE_W } from '@/lib/edge-handle';
import Workspace from './Workspace';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/client/useKoubouConnection', () => ({ useKoubouConnection: () => ({}) }));
vi.mock('@/client/useProjectBootstrap', () => ({ useProjectBootstrap: () => {} }));
vi.mock('@/client/useReplayPlayer', () => ({ useReplayPlayer: () => {} }));
vi.mock('@/client/useAuthGuard', () => ({ useAuthGuard: () => {} }));
vi.mock('@/client/useHostConfig', () => ({ useHostConfig: () => {} }));
vi.mock('@/client/useModelList', () => ({ useModelList: () => {} }));
vi.mock('@/client/useSkillList', () => ({ useSkillList: () => {} }));
vi.mock('@/client/useUserInfo', () => ({ useUserInfo: () => {} }));
vi.mock('@/client/useAssetPolling', () => ({ useAssetPolling: () => {} }));
vi.mock('@/client/useAnalytics', () => ({ useAnalytics: () => {} }));
vi.mock('@/client/useExitTransition', () => ({
  useExitTransition: () => ({ mounted: false, closing: false }),
}));

vi.mock('@/components/chat/ChatPanel', () => ({ default: () => <div data-testid="chat-panel" /> }));
vi.mock('@/components/preview/PreviewPanel', () => ({ default: () => <div data-testid="preview-panel" /> }));
vi.mock('@/components/ui/Tooltip', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ui/Toast', () => ({ default: () => null }));

const makeVersion = (id: string, index: number): Version => ({
  id,
  index,
  label: `V${index}`,
  summary: '',
  createdAt: '',
  current: index === 1,
  status: 'ready',
  assetKeys: [],
  game: { title: '', palette: '' },
});

const CHAT_W_KEY = 'workspace.chatWidth';
const CHAT_COLLAPSED_KEY = 'workspace.chatCollapsed';
const VIEWPORT_W = 1440;
const VIEWPORT_H = 900;
const CHAT_W_DEFAULT = 518;

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_W });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT_H });
  useStore.setState({
    booting: false,
    authRequired: false,
    currentProjectId: 7,
    versions: [makeVersion('v1', 1)],
    activeVersionId: 'v1',
    compare: { on: false, withId: null },
    previewTab: 'preview',
    creditModalOpen: false,
  });
});

// 视口缩放:jsdom 不会自己派发 resize,手动改 innerWidth 后派发
const resizeTo = (w: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  act(() => {
    fireEvent(window, new Event('resize'));
  });
};
// Chat 列 = 承载宽度过渡的**外层**(收起后宽 0);内层恒以 chatW 布局,不是横向几何的真相
const chatColumn = () => screen.getByTestId('chat-panel').parentElement!.parentElement!;
const previewColumn = () => screen.getByTestId('preview-panel').parentElement!;
const contentRow = () => chatColumn().parentElement!;
const handleByLabel = (label: string) => screen.getByRole('button', { name: label });

test('工作台只有对话与预览两栏:预览列是吃满剩余宽度的 flex 项,而不是 absolute overlay', () => {
  render(<Workspace />);
  const col = previewColumn();
  expect(col.parentElement).toBe(contentRow());
  expect(col.className).toContain('flex-1');
  expect(col.className).toContain('min-w-0');
  expect(col.className).not.toContain('absolute');
  expect(col.style.width).toBe(''); // 宽度由 flex 派生,没有自己的宽度状态
  // 画布已退役:内容行里只剩 Chat 列、把手、Chat 分隔条、预览列
  expect(document.querySelector('.react-flow')).toBeNull();
  expect(screen.getAllByRole('separator')).toHaveLength(1);
});

test('视口收窄时压 Chat 列,给预览列留足硬底,两栏恒不重叠', () => {
  render(<Workspace />);
  expect(chatColumn().style.width).toBe('518px');

  // 800:Chat 让出到 800−1−330=469,预览恰为硬底
  resizeTo(800);
  expect(chatColumn().style.width).toBe(`${800 - SEPARATOR_W - PREVIEW_WIDTH_MIN}px`);
});

test('视口窄于两栏最小宽之和时 Chat 停在下限,内容行按最小页宽横向滚动', () => {
  render(<Workspace />);
  resizeTo(600);

  expect(chatColumn().style.width).toBe(`${CHAT_WIDTH_MIN}px`);
  expect(contentRow().style.minWidth).toBe(`${minPageWidth()}px`);
  expect(contentRow().parentElement!.className).toContain('overflow-x-auto');
});

test('自动消解不改写持久化的期望宽,视口放大后回到用户选择的宽度', () => {
  localStorage.setItem(CHAT_W_KEY, '600');
  render(<Workspace />);
  expect(chatColumn().style.width).toBe('600px');

  resizeTo(700);
  expect(Number(chatColumn().style.width.replace('px', ''))).toBeLessThan(600);
  expect(localStorage.getItem(CHAT_W_KEY)).toBe('600');

  resizeTo(VIEWPORT_W);
  expect(chatColumn().style.width).toBe('600px');
});

test('挂载时视口已窄于最小页宽:首帧即按下限落位', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
  render(<Workspace />);

  expect(fitChatWidth(518, 640)).toBe(CHAT_WIDTH_MIN);
  expect(chatColumn().style.width).toBe(`${CHAT_WIDTH_MIN}px`);
});

test('旧三栏遗留的预览宽 / 全宽 key 不影响布局', () => {
  localStorage.setItem('workspace.previewWidth', '900');
  localStorage.setItem('workspace.previewFull', '1');
  render(<Workspace />);
  expect(chatColumn().style.width).toBe('518px');
  expect(previewColumn().style.width).toBe('');
});

test('拖 Chat 分隔条:跟手改宽,松手落为期望宽;上限给预览留足硬底', () => {
  render(<Workspace />);
  const separator = screen.getAllByRole('separator')[0];

  fireEvent.pointerDown(separator, { clientX: 518 });
  fireEvent(window, new MouseEvent('pointermove', { clientX: 618 }));
  expect(chatColumn().style.width).toBe('618px');
  fireEvent(window, new MouseEvent('pointerup'));
  expect(localStorage.getItem(CHAT_W_KEY)).toBe('618');

  // 窄视口下往右猛拖:夹到「视口 − 分隔条 − 预览硬底」
  resizeTo(1000);
  fireEvent.pointerDown(separator, { clientX: 618 });
  fireEvent(window, new MouseEvent('pointermove', { clientX: 1000 }));
  fireEvent(window, new MouseEvent('pointerup'));
  expect(chatColumn().style.width).toBe(`${1000 - SEPARATOR_W - PREVIEW_WIDTH_MIN}px`);
});

test('按住分隔条只竖向抖动(横向没动)不算拖拽:不落库', () => {
  render(<Workspace />);
  const separator = screen.getAllByRole('separator')[0];
  fireEvent.pointerDown(separator, { clientX: 518, clientY: 300 });
  // 鼠标/触控板按下时竖向微抖很常见,横向 0 位移不该被当成一次拖拽
  fireEvent(window, new MouseEvent('pointermove', { clientX: 518, clientY: 306 }));
  fireEvent(window, new MouseEvent('pointerup'));

  expect(chatColumn().style.width).toBe('518px');
  expect(localStorage.getItem(CHAT_W_KEY)).toBeNull();
});

test('把手热区只落在预览侧:不吃 ChatPanel 消息区的滚动轨', () => {
  render(<Workspace />);
  // 定位容器只负责摆位,不吃指针事件;可命中的只有把手本体那块被 clipPath 裁出的梯形
  // (靠 parentElement 取容器依赖本文件把 Tooltip mock 成透传,改 mock 时这两条要跟着调)
  const chatWrap = handleByLabel('workspace.chatCollapse').parentElement!;
  expect(chatWrap.className).toContain('pointer-events-none');
  expect(handleByLabel('workspace.chatCollapse').className).toContain('pointer-events-auto');
  // 左缘落在 Chat 分隔条右侧(519),整块 24px 都在预览侧——不越界回 Chat 列
  expect(chatWrap.style.left).toBe(`${CHAT_W_DEFAULT + 1}px`);
  expect(chatWrap.style.width).toBe(`${HANDLE_W}px`);
});

test('compare 时仍能收起对话栏,且收起后把手不消失(唯一的回头路)', () => {
  useStore.setState({ compare: { on: true, withId: 'v1' } });
  render(<Workspace />);

  fireEvent.click(handleByLabel('workspace.chatCollapse'));
  expect(chatColumn().style.width).toBe('0px');
  expect(handleByLabel('workspace.chatExpand').className).not.toContain('opacity-0');
});

test('Chat 把手排在分隔条之前:同为 z-30 时后者胜出,拖拽热区不被把手吃掉', () => {
  render(<Workspace />);
  const handle = handleByLabel('workspace.chatCollapse');
  const chatSeparator = screen.getAllByRole('separator')[0];

  // compareDocumentPosition 返回位掩码:FOLLOWING 位为真即分隔条在把手之后
  expect(handle.compareDocumentPosition(chatSeparator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('收起态下缩放窗口仍保持收起(resize 监听器读的是最新收起态,不是挂载期的旧值)', () => {
  render(<Workspace />);
  fireEvent.click(handleByLabel('workspace.chatCollapse'));

  resizeTo(1100);
  expect(chatColumn().style.width).toBe('0px');
  expect(contentRow().style.minWidth).toBe(`${minPageWidth(true)}px`);
  resizeTo(600);
  expect(chatColumn().style.width).toBe('0px');
});

test('files / compare 时 Chat 把手常显:那条 24px 命中带压在预览面板左缘,不能隐形', () => {
  useStore.setState({ previewTab: 'files' });
  const filesView = render(<Workspace />);
  // 隐形把手压住文件树左缘(树行紧贴面板边、折叠箭头就在 x≈12..26)会变成看不见的误触
  expect(handleByLabel('workspace.chatCollapse').className).not.toContain('opacity-0');
  filesView.unmount();

  useStore.setState({ previewTab: 'preview', compare: { on: true, withId: 'v1' } });
  render(<Workspace />);
  expect(handleByLabel('workspace.chatCollapse').className).not.toContain('opacity-0');
});

test('点对话栏把手收起:Chat 列与其分隔条一并收到 0 宽,预览吃满整行;再点回到收起前的宽度', () => {
  render(<Workspace />);
  expect(chatColumn().style.width).toBe('518px');
  expect(screen.getAllByRole('separator')).toHaveLength(1);

  fireEvent.click(handleByLabel('workspace.chatCollapse'));
  expect(chatColumn().style.width).toBe('0px');
  expect(screen.queryAllByRole('separator')).toHaveLength(0); // Chat 那条已 aria-hidden
  expect(contentRow().style.minWidth).toBe(`${minPageWidth(true)}px`);
  expect(localStorage.getItem(CHAT_COLLAPSED_KEY)).toBe('1');

  fireEvent.click(handleByLabel('workspace.chatExpand'));
  expect(chatColumn().style.width).toBe('518px');
  expect(contentRow().style.minWidth).toBe(`${minPageWidth()}px`);
  expect(localStorage.getItem(CHAT_COLLAPSED_KEY)).toBe('0');
});

// 过渡在水合后的下一帧才开(见 layoutReady):同步断言会读到还没挂过渡类的那一帧
const nextFrame = async () => {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
};

test('收放对话栏走宽度过渡:ChatPanel 常驻渲染,收起后整块 inert 且不占横向空间', async () => {
  render(<Workspace />);
  await nextFrame();
  const col = chatColumn();
  expect(col.className).toContain('transition-[width]');
  expect(col.className).toContain('duration-300');
  expect(col.className).toContain('overflow-hidden');

  fireEvent.click(handleByLabel('workspace.chatCollapse'));
  // **不渲染就没有过渡**:必须保留 ChatPanel,只把外层收到 0
  expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  expect(col.style.width).toBe('0px');
  expect(col.hasAttribute('inert')).toBe(true); // 移出 tab 序,免得聚焦到看不见的控件
  // 内层恒以 chatW 布局,ChatPanel 从不经历 0 宽(否则内部排版与滚动位置会被收放打乱)
  expect(screen.getByTestId('chat-panel').parentElement!.style.width).toBe('518px');

  fireEvent.click(handleByLabel('workspace.chatExpand'));
  expect(col.style.width).toBe('518px');
  expect(col.hasAttribute('inert')).toBe(false);
});

test('对话栏把手的位置随边栏一起平移 —— 否则它会瞬跳到最左、与还在收缩的栏脱节', async () => {
  render(<Workspace />);
  await nextFrame();
  const container = handleByLabel('workspace.chatCollapse').closest('div[class*="absolute"]')!;
  expect(container.className).toContain('transition-[left]');
  expect(container.className).toContain('duration-300');
});

test('收起态跨刷新存活,且把手常显——没有 Chat 列可 hover,不常显就点不回来', () => {
  localStorage.setItem(CHAT_COLLAPSED_KEY, '1');
  render(<Workspace />);
  expect(chatColumn().style.width).toBe('0px');

  const collapsedHandle = handleByLabel('workspace.chatExpand');
  expect(collapsedHandle.className).not.toContain('opacity-0');
  // 展开后回到「hover 才浮现」
  fireEvent.click(collapsedHandle);
  expect(handleByLabel('workspace.chatCollapse').className).toContain('opacity-0');
});

test('预览侧没有把手 / 全宽入口:预览列恒吃满剩余宽度', () => {
  render(<Workspace />);
  // PreviewPanel 在本文件被 mock 掉,故这里查到的只可能是把手本身
  expect(screen.queryByRole('button', { name: 'workspace.previewFullWidth' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'workspace.previewRestore' })).toBeNull();
  expect(handleByLabel('workspace.chatCollapse')).toBeTruthy();
});
