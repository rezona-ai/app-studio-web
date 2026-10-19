// src/app/fonts.ts
import { IBM_Plex_Mono, Sekuya } from 'next/font/google';

// 等宽:余额数字「2,847」与账户「EN」
export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

// Sekuya(字标/大标题/Popular games):展示字体,Google Fonts 仅提供 weight 400。
// 变量名用 -loaded 后缀:由 globals.css 的 :root 把它组合成带 Inter fallback 的 --font-sekuya。
export const sekuya = Sekuya({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-sekuya-loaded',
  display: 'swap',
});
