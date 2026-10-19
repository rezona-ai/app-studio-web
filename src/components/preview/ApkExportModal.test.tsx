import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import ApkExportModal from './ApkExportModal';
import { useStore } from '@/store';
import { pgcApi } from '@/lib/pgc/client';
import type { Version } from '@/store/types';

// spec: docs/superpowers/specs/2026-08-24-export-play-bundle.md
// 关注点:两种产物格式的请求体装配、aab 三字段校验闸门、done 页按格式分叉、签发竞态

const version: Version = {
  id: 'v3', index: 3, label: 'Version 3', summary: 's', createdAt: '2026-01-01T00:00:00Z',
  current: true, status: 'ready', assetKeys: [], game: { title: 'T', palette: 'neon' },
};

const flush = () => act(async () => {});

// 格式由菜单入口定(两个独立菜单项),模态内不再能切
function open(props: Partial<React.ComponentProps<typeof ApkExportModal>> = {}) {
  return render(
    <ApkExportModal projectId={7} publicId="pub7" projectName="Pixel Dungeon" version={version}
      format="apk" onClose={() => {}} {...props} />,
  );
}
const openAab = (props: Partial<React.ComponentProps<typeof ApkExportModal>> = {}) =>
  open({ format: 'aab', ...props });

// 成功态状态回执:aab 分支回显以服务端为准(versionCode 计数器只升不降)
const statusOk = (over: Record<string, unknown> = {}) => ({
  build_id: 42, status: 'succeeded' as const, failure_category: null,
  download_available: true, networked: false, version_code: 12, ...over,
});

beforeEach(() => {
  useStore.setState({ userInfo: null, toast: null, packageNameByProject: {} });
  vi.spyOn(pgcApi.apk, 'create').mockResolvedValue({ build_id: 42, status: 'queued' });
  vi.spyOn(pgcApi.apk, 'status').mockResolvedValue(statusOk());
  vi.spyOn(pgcApi.apk, 'createDownloadLink').mockResolvedValue({ download_url: 'https://pgc.local/d/42' });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const pkgInput = () => screen.getByLabelText('Package name');
const exportBtn = () => screen.getByRole('button', { name: 'Export' });

test('默认 APK:请求体不含 output_format / package_name / version_* 四键(它们参与幂等身份)', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(pgcApi.apk.create).toHaveBeenCalledWith('pub7', { version_id: 'v3', name: 'Pixel Dungeon' });
});

test('Play Bundle 入口:包名空或非法时 CTA 禁用,合法后放行', async () => {
  openAab();
  // 包名不预填 —— 派生值是 Rezona 命名空间,烧进用户自有 Play 应用后永久不可改
  expect((pkgInput() as HTMLInputElement).value).toBe('');
  expect(exportBtn()).toBeDisabled();

  fireEvent.change(pkgInput(), { target: { value: 'game' } }); // 只有一段
  expect(exportBtn()).toBeDisabled();
  expect(screen.getByText(/at least two dot-separated parts/i)).toBeInTheDocument();

  fireEvent.change(pkgInput(), { target: { value: 'com.acme.game' } });
  expect(exportBtn()).not.toBeDisabled();
});

test('Play Bundle 提交:请求体带 output_format 与三个必填字段', async () => {
  openAab();
  fireEvent.change(pkgInput(), { target: { value: 'com.acme.game' } });
  fireEvent.change(screen.getByLabelText('Version name'), { target: { value: '2.1.0' } });
  fireEvent.change(screen.getByLabelText('Version code'), { target: { value: '9' } });
  fireEvent.click(exportBtn());
  await flush();
  expect(pgcApi.apk.create).toHaveBeenCalledWith('pub7', {
    version_id: 'v3', name: 'Pixel Dungeon',
    output_format: 'aab', package_name: 'com.acme.game', version_name: '2.1.0', version_code: 9,
  });
});

test('版本号非法(0 / 超 Play 上限)时不放行', async () => {
  openAab();
  fireEvent.change(pkgInput(), { target: { value: 'com.acme.game' } });
  fireEvent.change(screen.getByLabelText('Version code'), { target: { value: '0' } });
  expect(exportBtn()).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Version code'), { target: { value: '2100000001' } });
  expect(exportBtn()).toBeDisabled();
});

test('aab 完成页:无二维码,包名可复制,版本行取服务端回值', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.spyOn(pgcApi.apk, 'status').mockResolvedValue(statusOk({
    output_format: 'aab', package_name: 'com.acme.game', version_name: '2.1.0', version_code: 13,
  }));
  openAab();
  fireEvent.change(pkgInput(), { target: { value: 'com.acme.game' } });
  fireEvent.click(exportBtn());
  await waitFor(() => expect(screen.getByText('Your file is ready!')).toBeInTheDocument());

  // 手机装不了 bundle,扫码区必须消失
  expect(screen.queryByRole('button', { name: 'Download QR code' })).not.toBeInTheDocument();
  // 下载钮文案两种格式共用「Download」:扩展名由服务端 Content-Disposition 决定,写死 .aab 是噪音
  expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  expect(screen.getByText('Upload to Google Play')).toBeInTheDocument();
  // 服务端可能把 versionCode 顶高(计数器只升不降),回显以状态端点为准
  expect(screen.getByText('Version: 2.1.0 (13)')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await flush();
  expect(writeText).toHaveBeenCalledWith('com.acme.game');
  vi.unstubAllGlobals();
});

test('apk 完成页仍保留扫码区', async () => {
  open();
  fireEvent.click(exportBtn());
  await waitFor(() => expect(screen.getByText('Your file is ready!')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Download QR code' })).toBeInTheDocument();
  expect(screen.queryByText('Upload to Google Play')).not.toBeInTheDocument();
});

test('done 页按服务端回的 output_format 渲染,不认入口选定的格式', async () => {
  // 老后端不回 output_format 时回落入口格式;回了就以它为准(契约:客户端据它判断产物与扩展名)
  vi.spyOn(pgcApi.apk, 'status').mockResolvedValue(statusOk({ output_format: 'aab', package_name: 'app.madewith.game7' }));
  open();
  fireEvent.click(exportBtn()); // 从 APK 入口进,但作业实际回的是 aab
  await waitFor(() => expect(screen.getByText('Your file is ready!')).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Download' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download QR code' })).not.toBeInTheDocument();
  expect(screen.getByText('app.madewith.game7')).toBeInTheDocument();
});

test('橙底 CTA 文字用恒定白字令牌(--color-on-primary-strong),不写死 text-black', () => {
  open();
  expect(exportBtn().className).toContain('--color-on-primary-strong');
  expect(exportBtn().className).not.toContain('text-black');
});

test('包名记忆:提交后按项目落库,下次打开该项目预填', async () => {
  openAab();
  fireEvent.change(pkgInput(), { target: { value: 'com.acme.game' } });
  fireEvent.click(exportBtn());
  await flush();
  expect(useStore.getState().packageNameByProject).toEqual({ 7: 'com.acme.game' });

  cleanup();
  openAab();
  expect((pkgInput() as HTMLInputElement).value).toBe('com.acme.game');
  expect(exportBtn()).not.toBeDisabled();
});

test('包名记忆按项目隔离:换项目仍是空白', async () => {
  useStore.setState({ packageNameByProject: { 7: 'com.acme.game' } });
  openAab({ projectId: 8, publicId: 'pub8' });
  expect((pkgInput() as HTMLInputElement).value).toBe('');
});

test('APK 入口不写包名记忆(该格式压根不填包名)', async () => {
  open();
  fireEvent.click(exportBtn());
  await flush();
  expect(useStore.getState().packageNameByProject).toEqual({});
});
