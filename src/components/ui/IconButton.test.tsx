import { afterEach, expect, test } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import IconButton from './IconButton';

afterEach(cleanup);

test("variant='raised-active' 应用深色态 class", () => {
  render(
    <IconButton variant="raised-active" aria-label="发送">
      <span>x</span>
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('btn-raised-active');
});

test('默认 raised 不带 active class', () => {
  render(
    <IconButton variant="raised" aria-label="发送">
      <span>x</span>
    </IconButton>,
  );
  expect(screen.getByRole('button', { name: '发送' }).className).not.toContain('btn-raised-active');
});
