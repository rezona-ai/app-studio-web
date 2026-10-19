// eslint-config-next 16.2.7 已原生导出 flat config 数组,无需 FlatCompat
import nextConfig from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  // 排除 worktree:其内有独立 node_modules / .next 构建产物,跑过 build 后会刷出上万条噪声(与 vitest 排除对齐)
  { ignores: ['.next/**', 'node_modules/**', '.claude/worktrees/**'] },
  // 有意以 <img> 引用从 Figma 导出的设计 SVG/PNG 资源
  { rules: { '@next/next/no-img-element': 'off' } },
];

export default config;
