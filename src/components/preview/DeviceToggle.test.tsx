import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DeviceToggle from './DeviceToggle';
import { useStore } from '@/store';

beforeEach(() => {
  useStore.setState({ previewDevice: 'desktop' });
});
afterEach(cleanup);

test('两档按钮按 store 标 aria-pressed,点击写回 store', () => {
  render(<DeviceToggle />);
  const desktop = screen.getByRole('button', { name: 'Desktop' });
  const mobile = screen.getByRole('button', { name: 'Mobile' });
  expect(desktop.getAttribute('aria-pressed')).toBe('true');
  expect(mobile.getAttribute('aria-pressed')).toBe('false');

  fireEvent.click(mobile);
  expect(useStore.getState().previewDevice).toBe('mobile');
  expect(screen.getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Desktop' }).getAttribute('aria-pressed')).toBe('false');
});

test('disabled 时两档都不可点,也不改 store', () => {
  render(<DeviceToggle disabled />);
  const mobile = screen.getByRole('button', { name: 'Mobile' });
  expect(mobile).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Desktop' })).toBeDisabled();
  fireEvent.click(mobile);
  expect(useStore.getState().previewDevice).toBe('desktop');
});
