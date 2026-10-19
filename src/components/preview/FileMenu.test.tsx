import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import FileMenu from './FileMenu';

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), projectPublicId: () => 'AbCd' }));

afterEach(cleanup);
const noop = () => {};
// 默认渲染 props(workbench 可用):各用例按需覆写
function renderMenu(over: Partial<Parameters<typeof FileMenu>[0]> = {}) {
  const props = {
    onClose: vi.fn(), onShareGame: vi.fn(), onShareToRezona: vi.fn(), onShareWorkbench: vi.fn(),
    onExportApk: vi.fn(), onExportAab: vi.fn(), onExportSteam: vi.fn(), onExportZip: vi.fn(),
    exporting: false, workbenchDisabled: false, ...over,
  };
  render(<FileMenu {...props} />);
  return props;
}

test('恒渲染三项(分享游戏 / 分享工作台 / Rezona);点击各触发回调 + onClose', () => {
  const p = renderMenu();
  fireEvent.click(screen.getByRole('button', { name: 'Share game' }));
  expect(p.onShareGame).toHaveBeenCalled();
  expect(p.onClose).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Share to Rezona' }));
  expect(p.onShareToRezona).toHaveBeenCalled();
});

test('分享工作台与分享游戏并列;可点触发 onShareWorkbench', () => {
  const p = renderMenu();
  const item = screen.getByRole('button', { name: 'Share an editable copy' });
  expect(item).toBeInTheDocument();
  fireEvent.click(item);
  expect(p.onShareWorkbench).toHaveBeenCalled();
});

test('无当前 session(workbenchDisabled)→ 分享工作台禁用,点击不触发', () => {
  const p = renderMenu({ workbenchDisabled: true });
  const item = screen.getByRole('button', { name: 'Share an editable copy' });
  expect(item).toBeDisabled();
  fireEvent.click(item);
  expect(p.onShareWorkbench).not.toHaveBeenCalled();
});

test('导出为 APK 可点触发 onExportApk + onClose', () => {
  const p = renderMenu();
  const item = screen.getByRole('button', { name: 'Export as APK' });
  // 末位:排在 Rezona 之后(DOM 顺序在后)
  const rezona = screen.getByRole('button', { name: 'Share to Rezona' });
  expect(rezona.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(item);
  expect(p.onExportApk).toHaveBeenCalled();
  expect(p.onClose).toHaveBeenCalled();
});

test('Esc 触发 onClose', () => {
  const onClose = vi.fn();
  render(<FileMenu onClose={onClose} onShareGame={noop} onShareToRezona={noop} onShareWorkbench={noop} onExportApk={noop} onExportAab={noop} onExportSteam={noop} onExportZip={noop} exporting={false} workbenchDisabled={false} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});

test('点击遮罩触发 onClose', () => {
  const onClose = vi.fn();
  const { container } = render(<FileMenu onClose={onClose} onShareGame={noop} onShareToRezona={noop} onShareWorkbench={noop} onExportApk={noop} onExportAab={noop} onExportSteam={noop} onExportZip={noop} exporting={false} workbenchDisabled={false} />);
  const backdrop = container.querySelector('[aria-hidden="true"]');
  expect(backdrop).not.toBeNull();
  fireEvent.click(backdrop!);
  expect(onClose).toHaveBeenCalled();
});

test('Export as ZIP 在分隔线之下、两个 Android 导出项之上;点击触发 onExportZip 但**不**关菜单', () => {
  const p = renderMenu();
  const zip = screen.getByRole('button', { name: 'Export as ZIP' });
  const apk = screen.getByRole('button', { name: 'Export as APK' });
  // 同为导出、ZIP 居前:APK 在 DOM 顺序上跟在 ZIP 之后
  expect(zip.compareDocumentPosition(apk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(zip);
  expect(p.onExportZip).toHaveBeenCalled();
  // 在飞期要留着菜单显示进度,故这一项刻意不关
  expect(p.onClose).not.toHaveBeenCalled();
});

test('exporting 期 Export as ZIP 就地转圈并禁用,点击不再触发', () => {
  const p = renderMenu({ exporting: true });
  const zip = screen.getByRole('button', { name: 'Export as ZIP' });
  expect(zip).toBeDisabled();
  expect(zip).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status', { name: 'Exporting' })).toBeInTheDocument();
  fireEvent.click(zip);
  expect(p.onExportZip).not.toHaveBeenCalled();
});

test('导出为 Google Play Bundle 是独立菜单项,在 APK 之后;可点触发 onExportAab + onClose', () => {
  const p = renderMenu();
  const apk = screen.getByRole('button', { name: 'Export as APK' });
  const aab = screen.getByRole('button', { name: 'Export as Google Play Bundle' });
  // 两种 Android 产物各占一项 —— 格式在菜单层分流,模态内不再切
  expect(apk.compareDocumentPosition(aab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(aab);
  expect(p.onExportAab).toHaveBeenCalled();
  expect(p.onExportApk).not.toHaveBeenCalled();
  expect(p.onClose).toHaveBeenCalled();
});

test('Export as Steam package 是导出分组末位;可点触发 onExportSteam + onClose', () => {
  const p = renderMenu();
  const aab = screen.getByRole('button', { name: 'Export as Google Play Bundle' });
  const steam = screen.getByRole('button', { name: 'Export as Steam package' });
  // 桌面产物排在两个 Android 产物之后(导出分组内按 ZIP → APK → AAB → Steam)
  expect(aab.compareDocumentPosition(steam) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(steam);
  expect(p.onExportSteam).toHaveBeenCalled();
  // 三个导出入口互不串:点 Steam 不该触发另两个(它们各对应不同端点族与计费)
  expect(p.onExportApk).not.toHaveBeenCalled();
  expect(p.onExportAab).not.toHaveBeenCalled();
  expect(p.onClose).toHaveBeenCalled();
});

test('七项各带一枚前置图标,且不污染可及名', () => {
  renderMenu();
  const names = ['Share game', 'Share an editable copy', 'Share to Rezona', 'Export as ZIP', 'Export as APK', 'Export as Google Play Bundle', 'Export as Steam package'];
  for (const name of names) {
    const item = screen.getByRole('button', { name });
    // 图标是 mask span(aria-hidden)或 alt="" 的 img,两者都不进可及名;必须排在文案之前
    const icon = item.querySelector('img[alt=""], span[aria-hidden="true"]');
    expect(icon, name).not.toBeNull();
    expect(item.firstElementChild).toBe(icon);
  }
});

test('宽度按内容自适应,并夹在 220–296 之间(长语言不截断、不顶出预览栏)', () => {
  renderMenu();
  const menu = document.querySelector('.anim-pop-in')!;
  // 定宽会把俄/德/葡等长文案截成省略号;上限 296 是预览栏最窄(330)时账户条内可用宽的余量
  expect(menu.className).toContain('w-max');
  expect(menu.className).toContain('min-w-[220px]');
  expect(menu.className).toContain('max-w-[296px]');
  // 不再是定宽:'w-[220px]' 这种硬宽度不复存在(min-w- 前缀不算)
  expect(menu.className).not.toMatch(/(^|\s)w-\[\d+px\]/);
});

test('ZIP 用压缩包图标、APK 用安卓图标(不再借用 folder / download 通用字形)', () => {
  renderMenu();
  // mask 重着色的图标把资源路径写在内联 style 的 mask 里(见 FigIcon)
  const iconOf = (name: string) =>
    screen.getByRole('button', { name }).querySelector('span[aria-hidden="true"]')!.getAttribute('style') ?? '';
  expect(iconOf('Export as ZIP')).toContain('file-zip.svg');
  expect(iconOf('Export as APK')).toContain('android.svg');
});

test('Steam 项用品牌标且走 original 渲染(与 Play Bundle 同位,不被 mask 压成单色)', () => {
  renderMenu();
  const steamItem = screen.getByRole('button', { name: 'Export as Steam package' });
  // original tone 渲染成真 <img>(保原配色);单色字形才是 mask span —— 这条区分两类图标
  const img = steamItem.querySelector('img[alt=""]');
  expect(img).not.toBeNull();
  expect(img!.getAttribute('src')).toContain('steam.svg');
  expect(steamItem.querySelector('span[aria-hidden="true"]')).toBeNull();
  // 相邻的 Play Bundle 同为品牌 original:两项口径一致(都是「交到某个外部店」)
  const aabImg = screen.getByRole('button', { name: 'Export as Google Play Bundle' }).querySelector('img[alt=""]');
  expect(aabImg!.getAttribute('src')).toContain('google-play.svg');
});
