import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import DesktopExportModal from './DesktopExportModal';
import { useStore } from '@/store';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import type { Version } from '@/store/types';
import type { DesktopBuildStatusData } from '@/lib/pgc/types';
import { track } from '@/lib/analytics';

vi.mock('@/lib/analytics', () => ({ track: vi.fn(), projectPublicId: () => 'AbCd' }));

// spec: docs/superpowers/specs/2026-08-26-export-steam-package.md
// 关注点:请求体只有两字段、name 校验闸门、下载走代理直链(非 blob / 非 PGC 裸域)、
// external_ref_count 只提示不拦截、八个错误码的分流

const version: Version = {
  id: 'v3', index: 3, label: 'Version 3', summary: 's', createdAt: '2026-01-01T00:00:00Z',
  current: true, status: 'ready', assetKeys: [], game: { title: 'T', palette: 'neon' },
};

const flush = () => act(async () => {});

function open(props: Partial<React.ComponentProps<typeof DesktopExportModal>> = {}) {
  return render(
    <DesktopExportModal publicId="pub7" projectName="Pixel Dungeon" version={version}
      onClose={() => {}} {...props} />,
  );
}

const statusOk = (over: Partial<DesktopBuildStatusData> = {}): DesktopBuildStatusData => ({
  build_id: 42, status: 'succeeded' as const, failure_category: null,
  download_available: true, package_size: 144_703_488, external_ref_count: 0, ...over,
});

beforeEach(() => {
  useStore.setState({ userInfo: null, toast: null });
  vi.spyOn(pgcApi.desktop, 'create').mockResolvedValue({ build_id: 42, status: 'queued' });
  vi.spyOn(pgcApi.desktop, 'status').mockResolvedValue(statusOk());
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

const nameInput = () => screen.getByLabelText('Game title') as HTMLInputElement;
const exportBtn = () => screen.getByRole('button', { name: 'Export' });
const downloadLink = () => screen.getByRole('link', { name: 'Download' });

test('请求体只有 version_id 与 name 两个字段(契约就这两项),name 预填项目名', async () => {
  open();
  expect(nameInput().value).toBe('Pixel Dungeon');
  fireEvent.click(exportBtn());
  await flush();
  expect(pgcApi.desktop.create).toHaveBeenCalledWith('pub7', { version_id: 'v3', name: 'Pixel Dungeon' });
});

test('name 非法时 CTA 禁用并给行内文案:空 / 尾点 / 保留字符', () => {
  open();
  expect(exportBtn()).not.toBeDisabled();

  fireEvent.change(nameInput(), { target: { value: '  ' } });
  expect(exportBtn()).toBeDisabled();
  expect(screen.getByText(/no trailing dot/i)).toBeInTheDocument();

  fireEvent.change(nameInput(), { target: { value: 'Game.' } });
  expect(exportBtn()).toBeDisabled();

  fireEvent.change(nameInput(), { target: { value: 'Ga?me' } });
  expect(exportBtn()).toBeDisabled();

  fireEvent.change(nameInput(), { target: { value: '史莱姆点点乐 Demo' } });
  expect(exportBtn()).not.toBeDisabled();
});

test('中文标题原样提交:exe 名的 ASCII 派生只在后端,前端不预先截断', async () => {
  open();
  fireEvent.change(nameInput(), { target: { value: '史莱姆点点乐 Demo' } });
  fireEvent.click(exportBtn());
  await flush();
  expect(pgcApi.desktop.create).toHaveBeenCalledWith('pub7', { version_id: 'v3', name: '史莱姆点点乐 Demo' });
});

test('form → building → done:下载链是经 Next 代理的同源相对路径,不是 blob 也不是 PGC 裸域', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();

  expect(screen.getByText('Your Steam package is ready!')).toBeInTheDocument();
  const href = downloadLink().getAttribute('href');
  expect(href).toBe('/api/pgc/api/projects/pub7/desktop-builds/42/download');
  expect(href).not.toMatch(/^blob:/);
  expect(href).not.toMatch(/^https?:/);
  // download 属性:后端没给 Content-Disposition 时也走下载而非内联
  expect(downloadLink()).toHaveAttribute('download');
});

test('building 页写明幂等语义(可关弹窗、同标题重导接上同一作业)', async () => {
  // create 悬挂:停在 building 页
  vi.spyOn(pgcApi.desktop, 'create').mockReturnValue(new Promise(() => {}));
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.getByText(/the build keeps running/i)).toBeInTheDocument();
});

test('完成页回显产物体积,并说明大头是 Electron 运行时', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.getByText('Package size: 138.0 MB')).toBeInTheDocument();
  // 体积说明并进「上传到 Steam」第一步,不再是独立的一段灰字
  expect(screen.getByText(/Electron runtime/i)).toBeInTheDocument();
  expect(screen.getByText('Upload to Steam')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});

test('external_ref_count > 0:出离线提示但**不拦截**下载(准入行为后端未拍板)', async () => {
  vi.spyOn(pgcApi.desktop, 'status').mockResolvedValue(statusOk({ external_ref_count: 3 }));
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.getByText(/loads 3 external resource/i)).toBeInTheDocument();
  expect(downloadLink()).toHaveAttribute('href', '/api/pgc/api/projects/pub7/desktop-builds/42/download');
});

test('external_ref_count = 0:不出离线提示', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.queryByText(/external resource/i)).not.toBeInTheDocument();
});

test('failed:展示后端 failure_category 原文,重试回表单', async () => {
  vi.spyOn(pgcApi.desktop, 'status').mockResolvedValue(statusOk({
    status: 'failed', failure_category: '构建超时', download_available: false, package_size: null,
  }));
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.getByText('构建超时')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(nameInput()).toBeInTheDocument();
});

test('succeeded 但 download_available=false 按失败处理(后端不一致态,下载必 409)', async () => {
  vi.spyOn(pgcApi.desktop, 'status').mockResolvedValue(statusOk({ download_available: false }));
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(screen.getByText('Build failed')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
});

test('发起遇 429 配额:回表单 + Toast 配额专属文案(不是通用失败)', async () => {
  vi.spyOn(pgcApi.desktop, 'create').mockRejectedValue(
    new PgcError('DESKTOP_BUILD_QUOTA_EXCEEDED', 'quota', 429),
  );
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(nameInput()).toBeInTheDocument();
  expect(useStore.getState().toast?.message).toBe('You already have too many exports running. Wait for one to finish and try again.');
});

test('发起遇 404 flag 未开:回表单 + Toast 未开放文案(不预探测,后端是唯一真相源)', async () => {
  vi.spyOn(pgcApi.desktop, 'create').mockRejectedValue(
    new PgcError('DESKTOP_EXPORT_DISABLED', 'off', 404),
  );
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(useStore.getState().toast?.message).toBe('Steam package export is not available yet.');
});

test('轮询遇瞬时 503 继续轮,下一轮成功即进完成页', async () => {
  vi.useFakeTimers();
  const status = vi.spyOn(pgcApi.desktop, 'status')
    .mockRejectedValueOnce(new PgcError('UPSTREAM', 'boom', 503))
    .mockResolvedValue(statusOk());
  open();
  fireEvent.click(exportBtn());
  await act(async () => {});                       // create + 首个 tick(503)
  expect(screen.getByText('Building your desktop app…')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
  expect(status).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Your Steam package is ready!')).toBeInTheDocument();
});

test('轮询遇确定性 404:停轮转失败(不无限重试一个不存在的作业)', async () => {
  vi.useFakeTimers();
  const status = vi.spyOn(pgcApi.desktop, 'status').mockRejectedValue(
    new PgcError('DESKTOP_BUILD_NOT_FOUND', 'gone', 404),
  );
  open();
  fireEvent.click(exportBtn());
  await act(async () => {});
  expect(screen.getByText('Build failed')).toBeInTheDocument();
  expect(useStore.getState().toast?.message).toBe('This build no longer exists. Start a new export.');
  // 真正钉住「停轮」:再推两轮间隔,status 不该被第二次调用。
  // 少了这两行,删掉实现里那个 return 也照样绿(定时器照排、轮询继续)
  await act(async () => { await vi.advanceTimersByTimeAsync(3500 * 2); });
  expect(status).toHaveBeenCalledTimes(1);
});

test('无选中版本:CTA 禁用(该版本须已构建完成,否则后端 409)', () => {
  open({ version: null });
  expect(exportBtn()).toBeDisabled();
});

test('下载链带显式文件名兜底:后端漏发 Content-Disposition 时也不会存成无扩展名的 download', async () => {
  open();
  fireEvent.change(nameInput(), { target: { value: 'Slime Clicker' } });
  fireEvent.click(exportBtn());
  await flush();
  expect(downloadLink()).toHaveAttribute('download', 'Slime Clicker-steam-win64.zip');
});

test('点下载发 game_desktop_download 埋点(不复用 apk 那条:它的 target 语义是下载方式)', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();
  fireEvent.click(downloadLink());
  expect(track).toHaveBeenCalledWith('game_desktop_download', expect.objectContaining({ project_id: 'AbCd' }));
});
