import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PublishForm, { type PublishFormValue, type TargetPicker } from './PublishForm';
import { en } from '@/i18n/locales/en';
import type { CurrentUser, RezonaGameData } from '@/lib/pgc/types';

afterEach(cleanup);
const base: PublishFormValue = { name: 'My Game', summary: '', toggles: { public: true, sync_to_community: true } };
// 无发布历史的项目:目标行不渲染,弹窗与改造前一致
const noGames: TargetPicker = { status: 'ready', games: [], value: 'new', onChange: () => {}, onRetry: () => {} };
const games: RezonaGameData[] = [
  { game_id: 456, game_name: 'Pixel Chess', share_url: '', version_ids: ['v1', 'v2'], first_published_at: '2026-09-20T09:00:00Z', last_published_at: '2026-09-21T09:00:00Z' },
  { game_id: 312, game_name: null, share_url: '', version_ids: ['v1'], first_published_at: '2026-09-10T09:00:00Z', last_published_at: '2026-09-10T09:00:00Z' },
];
const withGames = (patch: Partial<TargetPicker> = {}): TargetPicker =>
  ({ status: 'ready', games, value: 456, onChange: () => {}, onRetry: () => {}, ...patch });
const cta = () => screen.getByRole('button', { name: 'Post to Rezona' });
const user = { id: 7, username: 'nick', display_name: 'Nick' } as CurrentUser;

test('账号行显示当前 lab 用户,且不提供任何换绑入口(契约 §4)', () => {
  render(<PublishForm picker={noGames} user={user} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByText('@Nick')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /switch/i })).toBeNull();
});

test('userInfo 未就绪:账号行落回通用称谓而不是渲染半成品 @', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByText(en.preview.account)).toBeInTheDocument();
  expect(screen.queryByText(/^@/)).toBeNull();
});

test('三个开关都在(稿 8905:73023),Remixable 恒关且置灰', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getAllByRole('switch')).toHaveLength(3);
  const remix = screen.getByRole('switch', { name: en.preview.rezona.remixable });
  expect(remix).toBeDisabled();
  expect(remix).toHaveAttribute('aria-checked', 'false');
});

test('点 Remixable 不产生任何 onChange(该字段不进请求体,契约 §7)', () => {
  const onChange = vi.fn();
  render(<PublishForm picker={noGames} value={base} onChange={onChange} versionReady onSubmit={() => {}} />);
  fireEvent.click(screen.getByRole('switch', { name: en.preview.rezona.remixable }));
  expect(onChange).not.toHaveBeenCalled();
});

test('切换 Public 只改自身,不再联动其它开关', () => {
  const onChange = vi.fn();
  render(<PublishForm picker={noGames} value={base} onChange={onChange} versionReady onSubmit={() => {}} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    toggles: { public: false, sync_to_community: true },
  }));
});

test('稿上的描述文案与 ⓘ 告知都在 CTA 之前给出', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByText(en.preview.rezona.intro)).toBeInTheDocument();
  expect(screen.getByText(en.preview.rezona.settingsNote)).toBeInTheDocument();
});

test('title/introduction 输入上限为 30/200(Bug 13353840)', () => {
  const { container } = render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(container.querySelector('input[maxlength]')).toHaveAttribute('maxlength', '30');
  expect(container.querySelector('textarea')).toHaveAttribute('maxlength', '200');
});

test('Post to Rezona 触发 onSubmit,CTA 走品牌橙键帽样式', () => {
  const onSubmit = vi.fn();
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={onSubmit} />);
  const cta = screen.getByRole('button', { name: 'Post to Rezona' });
  expect(cta).toHaveClass('btn-brand-key');
  fireEvent.click(cta);
  expect(onSubmit).toHaveBeenCalled();
});

test('版本未 build:CTA 置灰并提示,避免白跑一轮 409', () => {
  const onSubmit = vi.fn();
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady={false} onSubmit={onSubmit} />);
  const cta = screen.getByRole('button', { name: 'Post to Rezona' });
  expect(cta).toBeDisabled();
  fireEvent.click(cta);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText(en.preview.rezona.notBuiltHint)).toBeInTheDocument();
});

test('点击缩略图触发同一文件选择器', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  const thumb = screen.getByRole('button', { name: en.preview.rezona.uploadCover });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const clickSpy = vi.spyOn(input, 'click');
  fireEvent.click(thumb);
  expect(clickSpy).toHaveBeenCalled();
  expect(input.accept).toBe('image/png');
});

test('无发布历史:不渲染目标行,CTA 可点', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.queryByText(en.preview.rezona.targetLabel)).toBeNull();
  expect(cta()).toBeEnabled();
});

test('有已导入游戏:目标行显示所选游戏(游戏名 · 已发布版本 · 最近发布日期)', () => {
  render(<PublishForm picker={withGames()} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByText(en.preview.rezona.targetLabel)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: en.preview.rezona.targetLabel })).toHaveTextContent('Pixel Chess · v1, v2 · Sep 21');
  expect(cta()).toBeEnabled();
});

// game_name 由上游实时带回、best-effort:上游旧版本 / 坏条目 / 空名一律 null(后端 PR #129),须回落编号
test('game_name 为 null:回落成「Game #编号」', () => {
  render(<PublishForm picker={withGames({ value: 312 })} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByRole('button', { name: en.preview.rezona.targetLabel })).toHaveTextContent('Game #312 · v1 · Sep 10');
});

test('game_name 纯空白:同样回落编号,不渲染成一段空名', () => {
  const blank = [{ ...games[1], game_name: '   ' }];
  render(<PublishForm picker={withGames({ games: blank, value: 312 })} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByRole('button', { name: en.preview.rezona.targetLabel })).toHaveTextContent('Game #312 · v1 · Sep 10');
});

test('展开目标菜单:「创建新游戏」回调 new,选游戏回调其 game_id(数字)', () => {
  const onChange = vi.fn();
  render(<PublishForm picker={withGames({ onChange })} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: en.preview.rezona.targetLabel }));
  fireEvent.click(screen.getByRole('button', { name: en.preview.rezona.targetNew }));
  expect(onChange).toHaveBeenLastCalledWith('new');
  fireEvent.click(screen.getByRole('button', { name: en.preview.rezona.targetLabel }));
  fireEvent.click(screen.getByRole('button', { name: /Game #312/ }));
  expect(onChange).toHaveBeenLastCalledWith(312);
});

test('目标被清空(失效须重选):显示占位,CTA 禁用', () => {
  render(<PublishForm picker={withGames({ value: null })} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByRole('button', { name: en.preview.rezona.targetLabel })).toHaveTextContent(en.preview.rezona.targetPlaceholder);
  expect(cta()).toBeDisabled();
});

test('目标失效后重拉到空列表:目标行仍在,可明确选「创建新游戏」解除禁用', () => {
  const onChange = vi.fn();
  render(<PublishForm picker={{ ...noGames, value: null, onChange }} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: en.preview.rezona.targetLabel }));
  fireEvent.click(screen.getByRole('button', { name: en.preview.rezona.targetNew }));
  expect(onChange).toHaveBeenCalledWith('new');
});

test('列表加载中:目标行骨架,CTA 禁用(否则默认的「更新」会静默退化成创建)', () => {
  render(<PublishForm picker={{ ...noGames, status: 'loading', value: null }} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByRole('status', { name: en.common.loading })).toBeInTheDocument();
  expect(cta()).toBeDisabled();
});

test('列表加载失败:就地提示 + 重试,CTA 禁用', () => {
  const onRetry = vi.fn();
  render(<PublishForm picker={{ ...noGames, status: 'error', value: null, onRetry }} value={base} onChange={() => {}} versionReady onSubmit={() => {}} />);
  expect(screen.getByText(en.preview.rezona.targetLoadFailed)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: en.common.retry }));
  expect(onRetry).toHaveBeenCalled();
  expect(cta()).toBeDisabled();
});

test('上传中缩略图按钮禁用', () => {
  render(<PublishForm picker={noGames} value={base} onChange={() => {}} versionReady onSubmit={() => {}} coverUploading />);
  const thumb = screen.getByRole('button', { name: en.preview.rezona.uploadCover });
  expect(thumb).toBeDisabled();
});
