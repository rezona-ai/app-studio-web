import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateGameModal from './CreateGameModal';
import { useStore } from '@/store';
import { createInitialKoubouState, createInitialServerState } from '@/store/types';

beforeEach(() => useStore.setState({ ...createInitialKoubouState(), ...createInitialServerState() }));
afterEach(() => vi.restoreAllMocks());

describe('CreateGameModal', () => {
  test('空名称时 Create 按钮禁用', () => {
    render(<CreateGameModal onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
  });

  test('输入名称回车调用 createProject(去空) 并关闭', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    useStore.setState({ createProject } as never);
    render(<CreateGameModal onClose={onClose} />);
    const input = screen.getByPlaceholderText(/game name/i);
    fireEvent.change(input, { target: { value: '  My Game  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(createProject).toHaveBeenCalledWith('My Game');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test('名称为空时点击遮罩关闭', () => {
    const onClose = vi.fn();
    render(<CreateGameModal onClose={onClose} />);
    const backdrop = document.querySelector('.modal-backdrop')!;
    fireEvent.click(backdrop);
    // requestClose 同步置 data-closing=true 进入退场
    expect(backdrop).toHaveAttribute('data-closing', 'true');
  });

  test('已输入名称时点击遮罩不关闭(防误触丢输入)', () => {
    const onClose = vi.fn();
    render(<CreateGameModal onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/game name/i), { target: { value: 'My Game' } });
    const backdrop = document.querySelector('.modal-backdrop')!;
    fireEvent.click(backdrop);
    // requestClose 会同步置 data-closing=true;未触发则保持 false 且 onClose 不被调
    expect(backdrop).toHaveAttribute('data-closing', 'false');
    expect(onClose).not.toHaveBeenCalled();
  });

  test('点击 Create 按钮提交', async () => {
    const createProject = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ createProject } as never);
    render(<CreateGameModal onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/game name/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(createProject).toHaveBeenCalledWith('X');
  });
});
