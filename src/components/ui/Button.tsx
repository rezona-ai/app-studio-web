'use client';
import type { ButtonHTMLAttributes } from 'react';

// 设计稿唯一的按钮样式:浅灰渐变 + 描边阴影 + 内高光(.btn-raised)
//
// 尺寸是**组件契约**,不是调用方拼 className 去覆盖:Tailwind 无 !important、仓库也没接
// tailwind-merge,同特异性下胜出方由**生成样式表里的规则顺序**决定(与 class 属性顺序无关),
// 而 v4 按刻度升序排 —— 凡「比默认更小」的收紧一律输。build 后的 CSS 逐条验过:
// .px-2.5(41357) 在 .px-3(41408) 前、.py-1(41965) 在 .py-2(42060) 前、
// .text-[13px](44329) 在 .text-[14px](44359) 前 ⟹ 调用方写 px-2.5/py-1/text-[13px] 全是噪声。
// 故把尺寸收进下表内部**互斥**选取,类冲突从源头消失,且 jsdom 里能用 class 断言钉住。
const SIZE = {
  md: 'px-3 py-2 text-[14px]',
  /** 收紧一档:给行高受限的宿主用(如 Toast 那条 py-3 + 22px 行高的卡,md 会把卡撑高约 10px) */
  sm: 'px-2.5 py-1 text-[13px]',
} as const;

// 两档填充,与 IconButton 的同名 variant 是同一套语汇(共用 globals.css 的那两个类):
// raised = 浅灰渐变 + 深字(设计稿默认 CTA,深色稿也不翻);
// raised-active = 深色渐变 + 白字。宿主按自己的底色挑 —— 落在**浅底**上的按钮想随主题走,
// 就得在深色主题选 raised-active(见 Toast)
// brand-key = 设计稿的「品牌橙键帽 CTA」(.btn-brand-key,恒浅橙 + 白字,深色主题也不翻;
// 底沿是 drop-shadow 画在按钮外沿下方 4px,不占布局但要给它留出空间)。类本身早在 globals.css 里,
// 这里只是把它接进 variant 表 —— 否则调用方只能自己拼类名,正是仓规要避免的第二套按钮样式。
const VARIANT = {
  raised: 'btn-raised',
  'raised-active': 'btn-raised-active',
  'brand-key': 'btn-brand-key',
} as const;

/** 按钮类串的单一真相源。导出是给**导航型按钮**用的:分享页顶栏那两项跳的是地址,
    语义上必须是 <a>(可中键新开 / 可复制链接 / 读屏报「链接」),而 <a> 套 <button> 不合法。
    与其在那边照抄一串类(Button 改了不跟,即仓规所禁的「自写按钮样式」),不如共用这一份。 */
export const buttonClass = (
  size: keyof typeof SIZE = 'md',
  variant: keyof typeof VARIANT = 'raised',
  className = '',
): string =>
  `${VARIANT[variant]} inline-flex items-center justify-center gap-1.5 rounded-[10px] ${SIZE[size]} font-semibold transition-[transform,filter,opacity] duration-150 ease-out motion-safe:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-30 ${className}`;

export default function Button({
  className = '',
  size = 'md',
  variant = 'raised',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: keyof typeof SIZE; variant?: keyof typeof VARIANT }) {
  return <button {...props} className={buttonClass(size, variant, className)} />;
}
