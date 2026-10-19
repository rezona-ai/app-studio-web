// 移动端 UA 判定:工作台为固定桌面三栏布局,移动端(含平板)硬拦截。
// 只看 UA 不看视口宽度——桌面缩窄窗口不应触发拦截。
// 注意:android 平台的平板 Chrome UA 不带 Mobile 标记,靠 android 关键字覆盖;
// iPadOS Safari 默认伪装桌面 Mac UA,服务端识别不到,由 WorkspaceEntry 客户端补判。
const MOBILE_UA_RE = /android|iphone|ipad|ipod|windows phone|opera mini|mobile/i;

export function isMobileUA(ua: string): boolean {
  return MOBILE_UA_RE.test(ua);
}
