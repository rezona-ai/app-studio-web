import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // 在默认排除项基础上追加 worktree 目录 .claude/worktrees:其内有独立 node_modules,
  // 被主仓库 vitest 拾取会因 React 实例重复而误报失败
  test: {
    environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], globals: true,
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
