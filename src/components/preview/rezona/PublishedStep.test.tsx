import { afterEach, expect, test, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import PublishedStep from './PublishedStep';

afterEach(cleanup);

test('展示 share_url;点复制写剪贴板', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(<PublishedStep shareUrl="https://rezona.app/p/ganbei" />);
  expect(screen.getByText('Published to Rezona')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(writeText).toHaveBeenCalledWith('https://rezona.app/p/ganbei');
  await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
});
