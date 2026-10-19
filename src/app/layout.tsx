import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script';
import { resolveGa4 } from '@/lib/analytics/config';
import { plexMono, sekuya } from './fonts';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = { title: 'Rezona Lab · Game Agent', description: 'AI 游戏生成平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const ga4 = resolveGa4();
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable} ${sekuya.variable}`} suppressHydrationWarning>
      <head>
        {/* 水合前读取主站写入 localStorage 的配置并设置 <html>,避免白闪。
            本应用为分站,不自管配置:主站把配置存于 'rezonalab-config'(JSON,含 theme:'dark'|'light' 与 lang,
            完全由主站管理);仅 theme==='light' 走浅色,其余 / 缺省 / 解析失败均回退深色;lang 为非空字符串时设到 <html lang>。
            运行期由主站经 postMessage 下发变更,见 src/client/useHostConfig.ts;
            用户在分站主动切换语言时会合并回写该 key 的 lang(见 LanguageMenu),theme 等其余字段保留。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=JSON.parse(localStorage.getItem('rezonalab-config')||'{}');document.documentElement.dataset.theme=c.theme==='light'?'light':'dark';if(typeof c.lang==='string'&&c.lang)document.documentElement.lang=c.lang;}catch(e){document.documentElement.dataset.theme='dark';}})();`,
          }}
        />
        {/* GA4:内联定义 gtag(入队 dataLayer)并 config——关闭自动 page_view(改由 useAnalytics 带公共参数手动发);
            非 prod 开 debug_mode 供 DebugView。异步库见 <body> 末尾 <Script>。property 四端共用,PROD/TEST 按环境。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4.measurementId}',{send_page_view:false${ga4.debug ? ",debug_mode:true" : ""}});`,
          }}
        />
      </head>
      <body>
        <div id="__app">{children}</div>
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4.measurementId}`} strategy="afterInteractive" />
      </body>
    </html>
  );
}
