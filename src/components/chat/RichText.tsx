'use client';
import Markdown from './Markdown';

// 用户消息正文(非流式):委托共享 Markdown 组件做 GFM 渲染。
// 资产 @ 引用的剥离与 chip 渲染仍在 MessageItem 中完成,这里只渲染剩余正文。
export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  return <Markdown text={text} className={className} />;
}
