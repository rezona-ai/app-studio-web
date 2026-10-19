import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import PreviewPanel from './PreviewPanel';
import { useStore } from '@/store';
import type { Version } from '@/store/types';
import { pgcApi } from '@/lib/pgc/client';

// Files 清单固定桩:含 index.html(text) 触发内容 fetch,故测试内 stub 掉 fetch
const filesFixture = {
  version_id: 'current',
  items: [
    { path: 'src/index.html', size: 10, preview_url: 'https://pgc.local/f/index.html' },
    { path: 'src/main.js', size: 20, preview_url: 'https://pgc.local/f/main.js' },
  ],
  total: 2,
};

function makeVersion(id: string, label: string, current = false): Version {
  return {
    id, index: 1, label, summary: 'summary', createdAt: '2026-01-01T00:00:00Z',
    current, status: 'ready', assetKeys: [], game: { title: 'T', palette: 'neon' },
  };
}

// 冲洗 useEffect 内 previewVersionById() 异步 setState,避免 act 警告
const flush = () => act(async () => {});

beforeEach(() => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true)],
    activeVersionId: 'v1',
    compare: { on: false, withId: null },
    projects: [],
    currentProjectId: null,
    previewVersionById: vi.fn().mockResolvedValue('https://pgc.local/preview/v1/index.html'),
    downloadActiveVersion: vi.fn().mockResolvedValue(undefined),
    previewTab: 'preview',
    previewDevice: 'desktop', // 持久化的全局状态,不复位会跨用例残留
  });
});

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('tab 行只剩 Preview/Files 分段与刷新;导出已迁进分享菜单', async () => {
  useStore.setState({ projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeInTheDocument();
  // 工具条上不再有下载入口(spec 2026-08-20:同类动作只留分享菜单一个落点)
  expect(screen.queryByRole('button', { name: 'Export as ZIP' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.getByRole('button', { name: 'Export as ZIP' })).toBeInTheDocument();
});

test('分享菜单里的 Export as ZIP:在飞转圈、禁重复点,完成后菜单自关', async () => {
  let resolveDownload!: () => void;
  const download = vi.fn(() => new Promise<void>((r) => { resolveDownload = r; }));
  useStore.setState({ downloadActiveVersion: download, projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();

  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const item = screen.getByRole('button', { name: 'Export as ZIP' });
  fireEvent.click(item);
  expect(await screen.findByRole('status', { name: 'Exporting' })).toBeInTheDocument();
  expect(item).toHaveAttribute('aria-busy', 'true');

  // 在飞期菜单**仍开着**(否则进度无处可显),且再点不重复触发
  fireEvent.click(item);
  expect(download).toHaveBeenCalledTimes(1);

  // 拉完:菜单自关(该项随之消失)
  await act(async () => { resolveDownload(); });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Export as ZIP' })).not.toBeInTheDocument());
});

test('分享菜单含「导出为 APK」,点击后弹出导出模态(表单预填项目名)', async () => {
  useStore.setState({ projects: [{ ...projectFixture }], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export as APK' }));
  // dynamic import 的模态异步挂载;标题输入预填项目名 G,模态标题对齐设计稿
  expect(await screen.findByDisplayValue('G')).toBeInTheDocument();
  expect(screen.getByText('Export your game as APK')).toBeInTheDocument();
});

test('Compare 模式保留刷新按钮', async () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: 'v2' },
  });
  render(<PreviewPanel />);
  await flush();
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeInTheDocument();
});

test('点击刷新使预览 iframe 重建(强制重载)', async () => {
  render(<PreviewPanel />);
  await flush();
  const before = document.querySelector('iframe[title="preview"]');
  expect(before).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await flush();
  const after = document.querySelector('iframe[title="preview"]');
  expect(after).not.toBeNull();
  expect(after).not.toBe(before); // key 变化 → 重建为新节点
});

const projectFixture = {
  id: 7, public_id: 'DakkYXUy', name: 'G', cover_url: null, cover_source: null,
  current_version_id: null, status: 'ready', created_at: '', updated_at: '',
};

test('分享按钮在头部、位于 tab 行刷新之前,配齐 projects/env 后可用', async () => {
  vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://devlab.rezona.ai');
  useStore.setState({ projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  const share = screen.getByRole('button', { name: 'Share' });
  const refresh = screen.getByRole('button', { name: 'Refresh preview' });
  expect(share).toBeEnabled();
  // 头部分享在 tab 行之前(DOM 顺序在前)
  expect(share.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('无 projects(无法拼链)时分享按钮禁用', async () => {
  render(<PreviewPanel />); // beforeEach 未设 projects
  await flush();
  expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
});

test('点击分享按钮出 File menu,再点 Share game 弹出含干净分享链接的弹窗', async () => {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
  useStore.setState({ projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
  // 分享链接为本站 origin + basePath + /share/{public_id}/v{seq}(打开后 /share 直出该版本、地址栏保持干净)
  expect(await screen.findByDisplayValue(`${window.location.origin}/game/share/DakkYXUy/v1`)).toBeInTheDocument();
});

// 口径**放宽**记成显式决定:旧工具条那枚下载钮带 `!compareOn`,迁进分享菜单后没有了 ——
// 分享钮在常驻账户条里、不随 compare 隐藏。语义说得通(downloadActiveVersion 拉的是 active version,
// compare 下 active 明确),且与同菜单里 Share game / Export as APK 的既有口径一致
test('Compare 模式下分享菜单里仍可导出 ZIP(不再随 compare 隐藏)', async () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: 'v2' },
    projects: [projectFixture],
    currentProjectId: 7,
  });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.getByRole('button', { name: 'Export as ZIP' })).toBeEnabled();
});

test('Compare 模式仍保留头部分享按钮(分享是常驻头部动作)', async () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: 'v2' },
  });
  render(<PreviewPanel />);
  await flush();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
});

test('账户条渲染 credit 数与首字母头像', async () => {
  useStore.setState({
    userInfo: { id: 7, username: 'nick', display_name: 'Nick' },
    credit: { balance: 42, held: 0, spendable: 42 },
  });
  render(<PreviewPanel />);
  await flush();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByLabelText('Nick')).toHaveTextContent('N');
});

test('不渲染版本控制行 Publish/Live(设计稿无此行,空态与有版本均不显示)', async () => {
  useStore.setState({ versions: [], activeVersionId: null });
  const { rerender } = render(<PreviewPanel />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  expect(screen.queryByText('Live')).not.toBeInTheDocument();

  // 有版本时同样不渲染(该行整体移除,不在设计稿内)
  useStore.setState({ versions: [makeVersion('v1', 'Version 1', true)], activeVersionId: 'v1' });
  rerender(<PreviewPanel />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  expect(screen.queryByText('Live')).not.toBeInTheDocument();
});

test('Preview/Files tab 为仅图标(无可见文字, 走 aria-label)', async () => {
  render(<PreviewPanel />);
  await flush();
  // 可及名来自 aria-label
  const preview = screen.getByRole('button', { name: 'Preview' });
  expect(screen.getByRole('button', { name: 'Files' })).toBeInTheDocument();
  // 按钮内无可见文字标签(仅图标)
  expect(preview).toHaveTextContent('');
  expect(screen.queryByText('Files')).not.toBeInTheDocument();
});

test('账户条渲染语言下拉(位于 credit 与头像之间)', async () => {
  useStore.setState({
    userInfo: { id: 7, username: 'nick', display_name: 'Nick' },
    credit: { balance: 42, held: 0, spendable: 42 },
  });
  render(<PreviewPanel />);
  await flush();
  const lang = screen.getByRole('button', { name: 'Language' });
  expect(lang).toBeInTheDocument();
  expect(lang).toHaveTextContent('EN'); // 默认 en → 短码 EN
});

test('从未点开 Files 时不拉取文件清单(lazy 挂载)', async () => {
  const spy = vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();
  expect(spy).not.toHaveBeenCalled();
});

test('切到 Files 再切回,游戏 iframe 为同一 DOM 节点(未重挂,keep-alive)', async () => {
  vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x') }));
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();
  const before = document.querySelector('iframe[title="preview"]');
  expect(before).not.toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await flush();

  const after = document.querySelector('iframe[title="preview"]');
  expect(after).toBe(before); // 未卸载 → 同一节点 → 游戏未重载
});

test('点触发钮出现 File menu;点 Share game 出 SharePopover', async () => {
  vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://devlab.rezona.ai');
  useStore.setState({ projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument());
});

test('File menu 恒含 Share to Rezona(白名单校验已下线)', async () => {
  vi.stubEnv('NEXT_PUBLIC_PGC_BASE_URL', 'https://devlab.rezona.ai');
  useStore.setState({ projects: [projectFixture], currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(screen.getByRole('button', { name: 'Share to Rezona' })).toBeInTheDocument();
});

test('Compare 模式隐藏 Preview/Files tab pill', async () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    compare: { on: true, withId: 'v2' },
  });
  render(<PreviewPanel />);
  await flush();
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Files' })).not.toBeInTheDocument();
});

test('toggleCompare 开启时强制切回 preview tab(对比视图渲染在 preview 舞台)', () => {
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1'), makeVersion('v2', 'Version 2', true)],
    activeVersionId: 'v2',
    previewTab: 'files',
  });
  act(() => useStore.getState().toggleCompare());
  expect(useStore.getState().compare.on).toBe(true);
  expect(useStore.getState().previewTab).toBe('preview');
});

test('Files tab 下切换版本,按新版本 id 重拉文件清单', async () => {
  const spy = vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x') }));
  useStore.setState({
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    activeVersionId: 'v1',
    currentProjectId: 7,
    previewTab: 'files',
  });
  render(<PreviewPanel />);
  await flush();
  expect(spy).toHaveBeenLastCalledWith(7, 'v1');

  act(() => { useStore.setState({ activeVersionId: 'v2' }); });
  await flush();
  expect(spy).toHaveBeenLastCalledWith(7, 'v2');
});

test('preview tab 下渲染全屏按钮,files tab 与对比模式下隐藏', async () => {
  // 全屏链接需项目 id(有版本必有项目);缺 pid 拼不出 /full 链接 → 按钮禁用
  useStore.setState({ currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  const btn = screen.getByRole('button', { name: 'Fullscreen' });
  expect(btn).toBeInTheDocument();
  expect(btn).toBeEnabled();

  act(() => { useStore.getState().setPreviewTab('files'); });
  await flush();
  expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();

  act(() => {
    useStore.setState({
      previewTab: 'preview',
      compare: { on: true, withId: null },
    });
  });
  await flush();
  expect(screen.queryByRole('button', { name: 'Fullscreen' })).not.toBeInTheDocument();
});

test('无游戏时全屏按钮禁用', async () => {
  useStore.setState({ versions: [], activeVersionId: null });
  render(<PreviewPanel />);
  await flush();
  expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeDisabled();
});

test('点击全屏按钮:同步打开本地全屏页(不等预览 URL 解析,页签不再空白)', async () => {
  vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/game');
  const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
  const preview = vi.fn(async () => 'https://cdn.example/v1/index.html');
  useStore.setState({ previewVersionById: preview, currentProjectId: 7 });
  render(<PreviewPanel />);
  await flush();
  preview.mockClear();   // 右栏 GameFrame 挂载时也会解析一次,只看点击后有无新增调用
  fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
  // 同步开页签 + 同步导航:一次 open 就落到 /full,点击栈内不 await 任何请求(否则会被弹窗拦截)
  expect(openSpy).toHaveBeenCalledWith('/game/full/7/v1?seq=1', '_blank');
  expect(preview).not.toHaveBeenCalled();
  openSpy.mockRestore();
});

test('Preview↔Files 反复切换,文件清单只拉一次(FilesView 保活)', async () => {
  const spy = vi.spyOn(pgcApi, 'listVersionFiles').mockResolvedValue(filesFixture);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('x') }));
  useStore.setState({ currentProjectId: 7, previewTab: 'preview' });
  render(<PreviewPanel />);
  await flush();

  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Files' }));
  await flush();

  expect(spy).toHaveBeenCalledTimes(1); // 首次挂载拉一次,之后仅切显隐不再拉
});

// 画布退役后预览列恒吃满剩余宽度(spec 2026-10-19-remove-asset-canvas §3),全宽 / 恢复按钮随之下线
test('tab 行不再有全宽 / 恢复按钮', () => {
  render(<PreviewPanel />);
  expect(screen.queryByRole('button', { name: 'Expand preview to max width' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore preview width' })).toBeNull();
});

// 设备档切换(spec 2026-10-19-preview-mobile-device):与全屏按钮同一显隐条件
test('preview tab 下渲染设备档切换,切到移动档后舞台换竖屏框', async () => {
  render(<PreviewPanel />);
  await flush();
  fireEvent.click(screen.getByRole('button', { name: 'Mobile' }));
  expect(useStore.getState().previewDevice).toBe('mobile');
  expect(document.querySelector('[data-device="mobile"]')).not.toBeNull();
});

test('对比 / Files 下不渲染设备档切换;无游戏时禁用', () => {
  useStore.setState({ previewTab: 'files' });
  const files = render(<PreviewPanel />);
  expect(screen.queryByRole('button', { name: 'Mobile' })).toBeNull();
  files.unmount();

  useStore.setState({
    previewTab: 'preview',
    versions: [makeVersion('v1', 'Version 1', true), makeVersion('v2', 'Version 2')],
    compare: { on: true, withId: 'v2' },
  });
  const compare = render(<PreviewPanel />);
  expect(screen.queryByRole('button', { name: 'Mobile' })).toBeNull();
  compare.unmount();

  useStore.setState({ compare: { on: false, withId: null }, versions: [], activeVersionId: null });
  render(<PreviewPanel />);
  expect(screen.getByRole('button', { name: 'Mobile' })).toBeDisabled();
});
