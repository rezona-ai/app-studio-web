import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import Switch from './Switch';

afterEach(cleanup);

test('role=switch + aria-checked 反映 checked', () => {
  render(<Switch checked onChange={() => {}} ariaLabel="Public" />);
  const el = screen.getByRole('switch', { name: 'Public' });
  expect(el).toHaveAttribute('aria-checked', 'true');
});

test('点击切换回调传相反值', () => {
  const onChange = vi.fn();
  render(<Switch checked={false} onChange={onChange} ariaLabel="Public" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  expect(onChange).toHaveBeenCalledWith(true);
});

test('disabled 时点击不回调', () => {
  const onChange = vi.fn();
  render(<Switch checked onChange={onChange} disabled ariaLabel="Public" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Public' }));
  expect(onChange).not.toHaveBeenCalled();
});
