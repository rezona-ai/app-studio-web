'use client';
import { memo } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// react-markdown 会向自定义组件传入额外的 node prop;展开到 DOM 元素前统一剔除,
// 避免 React「未知 prop」警告。收敛到单个工具函数,免去逐组件解构 node 产生的 unused 噪音。
function omitNode<T extends ExtraProps>({ node, ...rest }: T): Omit<T, 'node'> {
  void node;
  return rest;
}

// 主题 token 映射:贴合现有字号与 --color-* 变量。
// 不解析裸 HTML(未引入 rehype-raw) → XSS 安全。
const MD_COMPONENTS: Components = {
  h1: (p) => <h1 className="mt-2 mb-1 text-[19px] font-semibold leading-tight" {...omitNode(p)} />,
  h2: (p) => <h2 className="mt-2 mb-1 text-[17px] font-semibold leading-tight" {...omitNode(p)} />,
  h3: (p) => <h3 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...omitNode(p)} />,
  h4: (p) => <h4 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...omitNode(p)} />,
  h5: (p) => <h5 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...omitNode(p)} />,
  h6: (p) => <h6 className="mt-2 mb-1 text-[15px] font-semibold leading-tight" {...omitNode(p)} />,
  p: (p) => <p className="my-2" {...omitNode(p)} />,
  ul: (p) => <ul className="my-2 list-disc pl-5" {...omitNode(p)} />,
  ol: (p) => <ol className="my-2 list-decimal pl-5" {...omitNode(p)} />,
  li: (p) => <li className="my-0.5" {...omitNode(p)} />,
  a: (p) => (
    // break-words:裸 URL 经 remark-gfm 自动链接后可见文本即整条 URL(无空格单一长 token),
    // 不换行会撑破气泡令窄聊天栏出现横向滚动条——与行内 code 同款处理
    <a
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-[var(--color-primary)] underline underline-offset-2"
      {...omitNode(p)}
    />
  ),
  strong: (p) => <strong className="font-semibold" {...omitNode(p)} />,
  em: (p) => <em className="italic" {...omitNode(p)} />,
  del: (p) => <del className="opacity-70" {...omitNode(p)} />,
  hr: (p) => <hr className="my-3 border-[var(--color-line)]" {...omitNode(p)} />,
  blockquote: (p) => (
    <blockquote className="my-2 border-l-2 border-[var(--color-line-2)] pl-3 text-[var(--color-muted)]" {...omitNode(p)} />
  ),
  code: (p) => (
    // break-words:长路径 / 无空格 JSON 等行内码在窄聊天栏内换行,不溢出被右缘裁切
    // (围栏代码块内 code 由 pre 的 white-space:pre 接管,break-words 在其内无效,故安全)
    <code className="break-words rounded bg-[var(--color-fill)] px-1 py-0.5 font-mono text-[13px]" {...omitNode(p)} />
  ),
  pre: (p) => (
    <pre className="my-2 overflow-x-auto rounded-[8px] bg-[var(--color-surface-2)] p-3 font-mono text-[13px] leading-5" {...omitNode(p)} />
  ),
  table: (p) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]" {...omitNode(p)} />
    </div>
  ),
  thead: (p) => <thead className="bg-[var(--color-surface-2)]" {...omitNode(p)} />,
  th: (p) => <th className="border border-[var(--color-line)] px-2 py-1 text-left font-semibold" {...omitNode(p)} />,
  td: (p) => <td className="border border-[var(--color-line)] px-2 py-1" {...omitNode(p)} />,
};

// memo:markdown 解析在渲染期进行,父级无关重渲(流式 tick / store 扇出)时 text 未变必须跳过重解析(审计 A2)
export default memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
