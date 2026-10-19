import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ProjectMenu from './ProjectMenu';
import type { ProjectData } from '@/lib/pgc/types';

const proj = (id: number, name: string): ProjectData => ({
  id, public_id: `p${id}`, name, cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '',
});

function setup(over: Partial<Parameters<typeof ProjectMenu>[0]> = {}) {
  const props = {
    projects: [proj(1, 'Alpha'), proj(2, 'Beta')],
    currentId: 1,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onBackToStudio: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onImport: vi.fn(),
    ...over,
  };
  render(<ProjectMenu {...props} />);
  return props;
}

describe('ProjectMenu', () => {
  test('点击项目行调用 onSelect 并关闭', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Beta'));
    expect(p.onSelect).toHaveBeenCalledWith(2);
    expect(p.onClose).toHaveBeenCalled();
  });

  test('点击 Create new game 调用 onCreate', () => {
    const p = setup();
    fireEvent.click(screen.getByText(/Create new game/i));
    expect(p.onCreate).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  test('点改名进入输入态, 改值后 Enter 调用 onRename, 且不触发 onSelect', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    expect(p.onSelect).not.toHaveBeenCalled();
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).toHaveBeenCalledWith(1, 'Alpha 2');
    expect(p.onRename).toHaveBeenCalledTimes(1);
  });

  test('失焦(blur)保存改名且仅调用一次', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.blur(input);
    expect(p.onRename).toHaveBeenCalledTimes(1);
    expect(p.onRename).toHaveBeenCalledWith(1, 'Alpha 2');
  });

  test('改名态按 Esc 取消,不保存', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(p.onRename).not.toHaveBeenCalled();
  });

  test('改名为空或未变化时不调用 onRename', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRename).not.toHaveBeenCalled();
  });

  test('点删除显示行内确认, 仅确认后调用 onDelete', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Delete Beta'));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(p.onDelete).toHaveBeenCalledWith(2);
  });

  test('删除确认中点取消则不调用 onDelete', () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText('Delete Beta'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(p.onDelete).not.toHaveBeenCalled();
  });

  test('操作组(Create/Back to Studio)在项目列表之前', () => {
    setup();
    const create = screen.getByText(/Create new game/i);
    const alpha = screen.getByText('Alpha');
    // create 在 alpha 之前 → alpha 相对 create 为 FOLLOWING(4)
    expect(create.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('点击 Back to Studio 调用 onBackToStudio 并关闭', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Back to Studio'));
    expect(p.onBackToStudio).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  test('不含 Duplicate 项', () => {
    setup();
    expect(screen.queryByText(/Duplicate/i)).toBeNull();
  });

  test('导入游戏菜单项:点击回调并关闭菜单', () => {
    const onImport = vi.fn();
    const p = setup({ onImport });
    fireEvent.click(screen.getByText('Import game'));
    expect(onImport).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  test('改名请求处理中显示加载态,完成后消失', async () => {
    let done!: () => void;
    const onRename = vi.fn(() => new Promise<void>((r) => { done = r; }));
    setup({ onRename });
    fireEvent.click(screen.getByLabelText('Rename Alpha'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(1, 'Alpha 2');
    // 加载态:出现 status,输入框消失
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alpha 2')).toBeNull();
    // 请求完成 → 加载态消失
    await act(async () => { done(); });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  test('删除请求处理中显示加载态,完成后消失', async () => {
    let done!: () => void;
    const onDelete = vi.fn(() => new Promise<void>((r) => { done = r; }));
    setup({ onDelete });
    fireEvent.click(screen.getByLabelText('Delete Beta'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(2);
    // 加载态:出现 status,确认按钮消失
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    // 请求完成 → 加载态消失
    await act(async () => { done(); });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
