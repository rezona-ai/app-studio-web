import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportProjectModal from './ImportProjectModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

const importAction = vi.fn();
const cancelAction = vi.fn();
const setError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({
    ...createInitialKoubouState(), ...createInitialServerState(),
    importProjectArchive: importAction, cancelImportArchive: cancelAction, setError,
  } as never);
});

const pickFile = (name = 'my-game.zip') => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['z'], name)] } });
};

describe('表单态', () => {
  test('展示拖放区+Choose File 按钮,无名称输入框', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Game name')).toBeNull();
  });

  test('选中文件立即以默认名开始上传', () => {
    importAction.mockResolvedValue(undefined);
    render(<ImportProjectModal onClose={() => {}} />);
    pickFile('cool-game.tar.gz');
    expect(importAction).toHaveBeenCalledWith(expect.any(File), 'cool-game');
  });

  test('拖放非法扩展名:setError 且不开始上传', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    const zone = screen.getByRole('button', { name: /choose archive/i });
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['z'], 'bad.rar')] } });
    expect(setError).toHaveBeenCalledWith(expect.objectContaining({ code: 'IMPORT_BAD_TYPE' }));
    expect(importAction).not.toHaveBeenCalled();
  });

  test('表单态点 x 直接关闭', async () => {
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });
});

describe('上传阶段', () => {
  beforeEach(() => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 0.3, done: 0, total: 0 } } as never);
  });

  test('无底部取消按钮;点 x 进入行内确认,确认取消调 cancelImportArchive', () => {
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Cancel this import?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    expect(cancelAction).toHaveBeenCalled();
  });

  test('Esc 同走确认;继续导入返回', () => {
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep importing' }));
    expect(screen.queryByText('Cancel this import?')).toBeNull();
  });

  test('progress 满格后文案切为处理中(不再显示 100%)', () => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 1, done: 0, total: 0 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText('Processing archive…')).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).toBeNull();
  });
});

describe('落素材与完成态', () => {
  test('importing_assets:x disabled,Esc 无效', () => {
    const onClose = vi.fn();
    useStore.setState({ importArchiveStatus: { step: 'importing_assets', progress: 1, done: 1, total: 3 } } as never);
    render(<ImportProjectModal onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancel this import?')).toBeNull();
  });

  test('done:渲染导入已完成,x 仍 disabled', () => {
    useStore.setState({ importArchiveStatus: { step: 'done', progress: 1, done: 3, total: 3 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText('Import complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  test('action resolve 后自动关闭', async () => {
    let release: () => void = () => {};
    importAction.mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const onClose = vi.fn();
    render(<ImportProjectModal onClose={onClose} />);
    pickFile();
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 1000 });
  });
});
