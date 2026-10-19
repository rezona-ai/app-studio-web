import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Segmented from './Segmented';

const opts = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
];

describe('Segmented', () => {
  it('渲染全部选项;withDefault 时含 Default 段', () => {
    render(<Segmented value={undefined} options={opts} onChange={() => {}} withDefault ariaLabel="Format" />);
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'JPEG' })).toBeInTheDocument();
  });

  it('点选项段回传该 value', () => {
    const onChange = vi.fn();
    render(<Segmented value={undefined} options={opts} onChange={onChange} withDefault />);
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    expect(onChange).toHaveBeenCalledWith('jpeg');
  });

  it('点 Default 段回传 undefined', () => {
    const onChange = vi.fn();
    render(<Segmented value="png" options={opts} onChange={onChange} withDefault />);
    fireEvent.click(screen.getByRole('radio', { name: 'Default' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('value 命中段 → 该段 aria-checked;value=undefined → Default 段选中', () => {
    const { rerender } = render(<Segmented value="png" options={opts} onChange={() => {}} withDefault />);
    expect(screen.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'false');
    rerender(<Segmented value={undefined} options={opts} onChange={() => {}} withDefault />);
    expect(screen.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true');
  });
});
