import type { NextConfig } from 'next';

// 部署在 LB 的 /game/* 路径下时，构建期注入 NEXT_PUBLIC_BASE_PATH=/game。
// 本地开发不设此变量 → basePath 为空，仍跑在根路径。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  // React Compiler(审计 F1):自动记忆化组件渲染,广谱缓解重渲染/重解析成本
  // (对已手工 memo/窄订阅的热点是叠加保险;违反 React 规则的组件会被编译器自动跳过)。
  // 需 devDependency babel-plugin-react-compiler;Turbopack 经内置 Babel 仅对需编译的文件生效。
  reactCompiler: true,
};

export default nextConfig;
