import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/pgc/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pgc/client')>();
  return {
    ...actual,
    pgcApi: { ...actual.pgcApi, rezona: { publish: vi.fn(), listGames: vi.fn() } },
    uploadProjectCover: vi.fn(),
  };
});
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return { ...actual, track: vi.fn() };
});
import RezonaPublishModal from './RezonaPublishModal';
import { useStore } from '@/store';
import { pgcApi, uploadProjectCover, PgcError } from '@/lib/pgc/client';
import { track } from '@/lib/analytics';
const rezona = pgcApi.rezona as unknown as Record<string, ReturnType<typeof vi.fn>>;
const uploadCoverMock = uploadProjectCover as unknown as ReturnType<typeof vi.fn>;

const projectStub = {
  id: 42, public_id: 'mVFGYtHQ', name: 'G',
  cover_url: null as string | null, cover_source: 'auto', current_version_id: 'v3', status: 'active',
  created_at: '', updated_at: '',
};

const version = { id: 'v3', index: 3, label: 'Version 3', summary: '', createdAt: '', current: true, cover: 'https://c/x.png', status: 'ready', assetKeys: [], game: { title: 'Nightcap', palette: '' } };

beforeEach(() => {
  Object.values(rezona).forEach((f) => f.mockReset()); uploadCoverMock.mockReset();
  (track as unknown as ReturnType<typeof vi.fn>).mockReset();
  rezona.listGames.mockResolvedValue({ items: [] }); // 默认无发布历史:弹窗与改造前一致
});
afterEach(cleanup);

// 打开即表单:没有绑定态可查,弹窗不再有 resolving/link 步骤
function openModal(props: Partial<{ projectName: string; version: typeof version }> = {}) {
  return render(
    <RezonaPublishModal projectId={42} projectName={props.projectName ?? ''}
      version={props.version ?? version} onClose={() => {}} />,
  );
}

const cta = () => screen.getByRole('button', { name: 'Post to Rezona' });
// 列表就绪前 CTA 禁用(spec 2026-09-23 §2 #3),提交类用例先等它放行
const ready = () => waitFor(() => expect(cta()).toBeEnabled());

function fileInput() {
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).not.toBeNull();
  return input;
}

test('打开弹窗只拉已导入游戏列表,直接呈现发布表单(绑定态查询已下线)', () => {
  openModal({ projectName: '猪王的复仇 Remix' });
  expect(rezona.listGames).toHaveBeenCalledWith(42);
  expect(screen.getByRole('button', { name: 'Post to Rezona' })).toBeInTheDocument();
  expect(screen.getByDisplayValue('猪王的复仇 Remix')).toBeInTheDocument(); // name 默认取项目名(Bug 13360684)
  expect(rezona.publish).not.toHaveBeenCalled();
});

test('账号行取 store 里的当前 lab 用户(稿 8905:73034)', () => {
  useStore.setState({ userInfo: { id: 7, username: 'nick', display_name: 'Nick' } });
  try {
    openModal();
    expect(screen.getByText('@Nick')).toBeInTheDocument();
  } finally {
    useStore.setState({ userInfo: null });
  }
});

test('弹窗 portal 到 body,脱离 Preview overlay 的 stacking context(Bug 13352126)', () => {
  // 模拟挂载点在低 z-index 容器内:portal 后弹窗不得留在容器里,否则分隔条(z-30)会透在弹窗上
  const { container } = openModal();
  expect(container.querySelector('.modal-backdrop')).toBeNull();
  expect(document.body.querySelector('.modal-backdrop')).not.toBeNull();
});

test('点击遮罩一律不关闭(发布中误触会打断流程)', () => {
  const onClose = vi.fn();
  render(<RezonaPublishModal projectId={42} projectName="" version={version} onClose={onClose} />);
  const backdrop = document.body.querySelector('.modal-backdrop')!;
  fireEvent.click(backdrop);
  expect(backdrop).toHaveAttribute('data-closing', 'false');
  expect(onClose).not.toHaveBeenCalled();
});

test('项目名缺失时回落 version.game.title', () => {
  openModal();
  expect(screen.getByDisplayValue('Nightcap')).toBeInTheDocument();
});

test('预填游戏名超 30 字时截断(Bug 13353840:maxLength 拦不住程序赋值)', () => {
  openModal({ version: { ...version, game: { ...version.game, title: 'A'.repeat(40) } } });
  expect(screen.getByDisplayValue('A'.repeat(30))).toBeInTheDocument();
});

test('提交时清空输入 → 兜底回项目名而非 version.game.title', async () => {
  rezona.publish.mockResolvedValue({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  openModal({ projectName: '猪王的复仇 Remix' });
  await ready();
  fireEvent.change(screen.getByDisplayValue('猪王的复仇 Remix'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  expect(rezona.publish.mock.calls[0][1].name).toBe('猪王的复仇 Remix');
});

test('发布成功 → published(share_url);请求体不带 remixable(契约 §7)', async () => {
  rezona.publish.mockResolvedValue({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  openModal();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(screen.getByText('Published to Rezona')).toBeInTheDocument());
  const body = rezona.publish.mock.calls[0][1];
  expect(rezona.publish).toHaveBeenCalledWith(42, expect.objectContaining({ version_id: 'v3', name: 'Nightcap', cover_ref: 'version_cover' }));
  expect(body).not.toHaveProperty('remixable');
  expect(body.public).toBe(true);
  expect(body.sync_to_community).toBe(true);
});

test('IDEMPOTENCY_CONFLICT → 换新幂等键原地重试', async () => {
  rezona.publish
    .mockRejectedValueOnce(new PgcError('IDEMPOTENCY_CONFLICT', 'conflict', 409))
    .mockResolvedValueOnce({ share_url: 'https://rezona.app/p/x', rezona_work_id: 'rw_1' });
  openModal();
  await ready();

  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  // 第一次失败:setError → 回落 form,按钮重新可点
  await waitFor(() => expect(screen.getByRole('button', { name: 'Post to Rezona' })).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText('Published to Rezona')).toBeInTheDocument());

  expect(rezona.publish.mock.calls[0][1].idempotency_key).not.toBe(rezona.publish.mock.calls[1][1].idempotency_key);
});

test('非幂等冲突的失败复用同一幂等键(同一次发布意图,重试不重复发布)', async () => {
  rezona.publish.mockRejectedValue(new PgcError('REZONA_UNAVAILABLE', 'down', 503));
  openModal();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(2));
  expect(rezona.publish.mock.calls[0][1].idempotency_key).toBe(rezona.publish.mock.calls[1][1].idempotency_key);
});

test('连续第 3 次 REZONA_UNAVAILABLE 改为带 request_id 的联系支持文案(契约 §6)', async () => {
  rezona.publish.mockRejectedValue(new PgcError('REZONA_UNAVAILABLE', 'down', 503, null, 'req-9'));
  openModal();
  await ready();
  for (let i = 1; i <= 2; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
    await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(i));
    await waitFor(() => expect(useStore.getState().toast?.message).toBe('Rezona is unavailable. Please try again later.'));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(useStore.getState().toast?.message).toContain('req-9'));
});

// 500:本服务 pgc 代理不可达的实际对外状态码(路由层不兜底);502:LB 侧的形态。两者都没有业务信封。
test.each([500, 502])('HTTP %i 且无业务信封 → 按上游不可达处理并计数', async (status) => {
  rezona.publish.mockRejectedValue(new PgcError('HTTP_ERROR', `HTTP ${status}`, status));
  openModal();
  await ready();
  for (let i = 1; i <= 2; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
    await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(i));
    await waitFor(() => expect(useStore.getState().toast?.message).toBe('Rezona is unavailable. Please try again later.'));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(useStore.getState().toast?.message).toBe('Publishing keeps failing. Please contact support.'));
});

test('本地超时连炸 3 次:文案不出现空的 request_id', async () => {
  rezona.publish.mockRejectedValue(new PgcError('TIMEOUT', 'timeout', 0)); // 本地超时无信封 → requestId 恒 null
  openModal();
  await ready();
  for (let i = 1; i <= 3; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Post to Rezona' }));
    await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(i));
  }
  await waitFor(() => expect(useStore.getState().toast?.message).toBe('Publishing keeps failing. Please contact support.'));
});

test('未 build 的版本:CTA 置灰,点了也不发请求', () => {
  openModal({ version: { ...version, status: 'building' } });
  const cta = screen.getByRole('button', { name: 'Post to Rezona' });
  expect(cta).toBeDisabled();
  fireEvent.click(cta);
  expect(rezona.publish).not.toHaveBeenCalled();
});

test('StrictMode(dev 双调用)下上传封面仍能落地——mountedRef 不被 cleanup 卡死', async () => {
  uploadCoverMock.mockResolvedValue({
    ...projectStub, cover_url: '/pv/abc/assets/pgc-cover/cover.png?v=deadbeef', cover_source: 'user',
  });
  // StrictMode 会对 effect 跑 setup→cleanup→setup:若 mountedRef 仅在 cleanup 置 false,
  // 挂载后即恒 false,await 后守卫会提前返回 → 上传结果永不落地。
  render(
    <StrictMode>
      <RezonaPublishModal projectId={42} projectName="" version={version} onClose={() => {}} />
    </StrictMode>,
  );
  fireEvent.change(fileInput(), { target: { files: [new File(['png-bytes'], 'cover.png', { type: 'image/png' })] } });
  await waitFor(() => expect(document.body.querySelector('img[src*="pgc-cover/cover.png?v=deadbeef"]')).not.toBeNull());
});

test('上传封面走项目封面端点并更新缩略图', async () => {
  uploadCoverMock.mockResolvedValue({
    ...projectStub, cover_url: '/pv/abc/assets/pgc-cover/cover.png?v=deadbeef', cover_source: 'user',
  });
  openModal();
  const file = new File(['png-bytes'], 'cover.png', { type: 'image/png' });
  fireEvent.change(fileInput(), { target: { files: [file] } });

  await waitFor(() => expect(document.body.querySelector('img[src*="pgc-cover/cover.png?v=deadbeef"]')).not.toBeNull());
  expect(uploadCoverMock).toHaveBeenCalledWith(42, file);
});

test('非 PNG 上传失败弹对应文案', async () => {
  uploadCoverMock.mockRejectedValue(new PgcError('UNSUPPORTED_COVER_TYPE', 'png only', 422));
  openModal();
  fireEvent.change(fileInput(), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(useStore.getState().toast?.message).toBe('Only PNG images are supported.'));
});

// ---- 发布到已导入游戏(spec 2026-09-23) ----
const GAMES = [
  { game_id: 456, game_name: 'Pixel Chess', share_url: 'https://web.rezona.ai/share/game/456', version_ids: ['v1', 'v2'], first_published_at: '2026-09-20T09:00:00Z', last_published_at: '2026-09-21T09:00:00Z' },
  { game_id: 312, game_name: null, share_url: 'https://web.rezona.ai/share/game/312', version_ids: ['v1'], first_published_at: '2026-09-10T09:00:00Z', last_published_at: '2026-09-10T09:00:00Z' },
];
const OK = { share_url: 'https://web.rezona.ai/share/game/456', rezona_work_id: '456' };
const targetBtn = () => screen.getByRole('button', { name: 'PUBLISH TO' });
const pickTarget = (name: string | RegExp) => {
  fireEvent.click(targetBtn());
  fireEvent.click(screen.getByRole('button', { name }));
};

test('无发布历史:创建请求体不带 game_id 键,埋点 rezona_mode=create', async () => {
  rezona.publish.mockResolvedValue(OK);
  openModal();
  await ready();
  expect(screen.queryByRole('button', { name: 'PUBLISH TO' })).toBeNull();
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  expect(rezona.publish.mock.calls[0][1]).not.toHaveProperty('game_id');
  expect(track).toHaveBeenCalledWith('game_export_submit', expect.objectContaining({ target: 'rezona', rezona_mode: 'create' }));
});

test('有已导入游戏:默认选最近发布的那个,请求体带其 game_id,埋点 rezona_mode=update', async () => {
  rezona.listGames.mockResolvedValue({ items: GAMES });
  rezona.publish.mockResolvedValue(OK);
  openModal();
  await ready();
  expect(targetBtn()).toHaveTextContent('Pixel Chess');
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  expect(rezona.publish.mock.calls[0][1].game_id).toBe(456);
  expect(track).toHaveBeenCalledWith('game_export_submit', expect.objectContaining({ rezona_mode: 'update' }));
});

test('切到「创建新游戏」:请求体不带 game_id,且换新幂等键(game_id 参与幂等指纹)', async () => {
  rezona.listGames.mockResolvedValue({ items: GAMES });
  rezona.publish.mockRejectedValueOnce(new PgcError('REZONA_UNAVAILABLE', 'down', 503)).mockResolvedValueOnce(OK);
  openModal();
  await ready();
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  await ready();
  pickTarget('Create new game');
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(2));
  const [first, second] = rezona.publish.mock.calls.map((c) => c[1]);
  expect(first.game_id).toBe(456);
  expect(second).not.toHaveProperty('game_id');
  expect(second.idempotency_key).not.toBe(first.idempotency_key);
});

test('列表未返回前 CTA 禁用,返回后放行', async () => {
  let resolve!: (v: unknown) => void;
  rezona.listGames.mockReturnValue(new Promise((r) => { resolve = r; }));
  openModal();
  expect(cta()).toBeDisabled();
  resolve({ items: GAMES });
  await ready();
});

test('列表加载失败:CTA 禁用,点重试成功后按默认规则选中并放行', async () => {
  rezona.listGames.mockRejectedValueOnce(new PgcError('REZONA_UNAVAILABLE', 'down', 503)).mockResolvedValueOnce({ items: GAMES });
  openModal();
  await waitFor(() => expect(screen.getByText("Couldn't load your published games.")).toBeInTheDocument());
  expect(cta()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await ready();
  expect(rezona.listGames).toHaveBeenCalledTimes(2);
  expect(targetBtn()).toHaveTextContent('Pixel Chess');
});

test('REZONA_GAME_NOT_FOUND:Toast + 重拉列表 + 目标清空,须明确重选才放行(不自动回选)', async () => {
  rezona.listGames.mockResolvedValueOnce({ items: GAMES }).mockResolvedValueOnce({ items: [GAMES[1]] });
  rezona.publish.mockRejectedValueOnce(new PgcError('REZONA_GAME_NOT_FOUND', 'gone', 404)).mockResolvedValueOnce(OK);
  openModal();
  await ready();
  fireEvent.click(cta());
  await waitFor(() => expect(useStore.getState().toast?.message).toBe('That game is no longer available. Please choose again.'));
  await waitFor(() => expect(rezona.listGames).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(targetBtn()).toHaveTextContent('Choose where to publish'));
  expect(cta()).toBeDisabled();
  pickTarget(/Game #312/);
  await ready();
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(2));
  expect(rezona.publish.mock.calls[1][1].game_id).toBe(312);
});

test('目标菜单展开时按 Esc 只收菜单,不关弹窗', async () => {
  rezona.listGames.mockResolvedValue({ items: GAMES });
  const onClose = vi.fn();
  render(<RezonaPublishModal projectId={42} projectName="" version={version} onClose={onClose} />);
  await ready();
  fireEvent.click(targetBtn());
  expect(screen.getByRole('button', { name: 'Create new game' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Create new game' })).toBeNull());
  expect(document.body.querySelector('.modal-backdrop')).toHaveAttribute('data-closing', 'false');
  // 菜单收起后再按 Esc 才关弹窗
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(document.body.querySelector('.modal-backdrop')).toHaveAttribute('data-closing', 'true'));
});

// 键盘用户可在菜单展开时 Tab 到 CTA 回车(遮罩只挡指针):表单随 posting 卸载,Select 来不及回报收起,
// 展开态若残留为 true,之后 Esc 永远被当成「让给菜单」而关不掉弹窗(评审 M1)
test('菜单展开时直接提交:失败回表单后 Esc 仍能关弹窗', async () => {
  rezona.listGames.mockResolvedValue({ items: GAMES });
  rezona.publish.mockRejectedValue(new PgcError('REZONA_UNAVAILABLE', 'down', 503));
  render(<RezonaPublishModal projectId={42} projectName="" version={version} onClose={() => {}} />);
  await ready();
  fireEvent.click(targetBtn());
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  await ready();
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(document.body.querySelector('.modal-backdrop')).toHaveAttribute('data-closing', 'true'));
});

test('重新选中当前已选的游戏不算换目标:重试复用同一幂等键', async () => {
  rezona.listGames.mockResolvedValue({ items: GAMES });
  rezona.publish.mockRejectedValue(new PgcError('REZONA_UNAVAILABLE', 'down', 503));
  openModal();
  await ready();
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(1));
  await ready();
  pickTarget(/Pixel Chess/);
  fireEvent.click(cta());
  await waitFor(() => expect(rezona.publish).toHaveBeenCalledTimes(2));
  expect(rezona.publish.mock.calls[1][1].idempotency_key).toBe(rezona.publish.mock.calls[0][1].idempotency_key);
});
