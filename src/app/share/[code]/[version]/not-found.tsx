import ShareNotFound from '@/components/share/ShareNotFound';

// 这条路由段的 404 页(notFound() 的落点):版本被删 / 未 build / 链接被改坏。
// 分享链接最常见的失败就是这一路,给它与 5xx 同形的品牌页而不是 Next 的默认 404。
export default function NotFound() {
  return <ShareNotFound />;
}
