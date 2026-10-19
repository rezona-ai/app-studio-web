// 两栏壳(Chat | 预览)在视口尺寸变化时的碰撞消解几何。
// 设计稿:docs/superpowers/specs/2026-07-25-sidebar-collision-on-resize-design.md(原三栏口径),
// 两栏化见 docs/superpowers/specs/2026-10-19-remove-asset-canvas-design.md §3。
// Chat 列定宽 shrink-0,预览列 flex-1 吸收余量;视口收窄到余量不足时压 Chat,而预览列只保一个硬底。

// Chat 列宽:默认取自 Figma 62:1297(518/1440),可拖拽调整并持久化
export const CHAT_WIDTH_DEFAULT = 518;
export const CHAT_WIDTH_MIN = 360;
export const CHAT_WIDTH_MAX = 800;
// 预览列下限 = 顶部账户条(分享按钮 + credit + 语言下拉 + 头像)的最小可用展示宽——
// credit 已在 formatCredit 紧凑化,330 > 账户条硬底(~305),六语不截断
export const PREVIEW_WIDTH_MIN = 330;
// 分隔条:只剩 Chat 右侧一条
export const SEPARATOR_W = 1;

export const clampChatWidth = (w: number) => Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, w));

// 页面最小宽 = Chat 最小宽 + 分隔条 + 预览硬底。视口窄于此时两栏都停在下限,由外层容器横向滚动兜底,
// 而不是继续互相挤压。chatCollapsed:对话栏收起态——它与其右侧那条 1px 分隔条都收到 0 宽
// (仍渲染,为的是有收放过渡),两项都从预算里去掉(与 fitChatWidth 第三参同一口径)。
export function minPageWidth(chatCollapsed = false): number {
  if (chatCollapsed) return PREVIEW_WIDTH_MIN;
  return CHAT_WIDTH_MIN + SEPARATOR_W + PREVIEW_WIDTH_MIN;
}

// 碰撞消解:入参是用户期望宽(拖拽的选择,存 ref + localStorage),返回当前视口下的实际 Chat 宽。
// 先给预览列留足硬底,余下才归 Chat;极窄视口下 CHAT_WIDTH_MIN 优先(交给页面横向滚动)。
// 期望宽只读不改,故窗口重新变大时 Chat 自然回到用户选择的宽度。
// chatCollapsed:收起态 Chat 不占位,原样返回期望宽不做消解——此刻压它没有意义,压了展开后就丢掉用户拖出来的宽度。
export function fitChatWidth(desiredChatW: number, viewportW: number, chatCollapsed = false): number {
  const chatWanted = clampChatWidth(desiredChatW);
  if (chatCollapsed) return chatWanted;
  return Math.max(CHAT_WIDTH_MIN, Math.min(chatWanted, viewportW - SEPARATOR_W - PREVIEW_WIDTH_MIN));
}
