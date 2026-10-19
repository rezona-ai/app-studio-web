import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// 降低动态(prefers-reduced-motion)下的禁用方式契约:
// 挂在**内容本体**上的动画类只能去掉动画(animation: none),绝不能整层 display: none ——
// 否则开了「减少动态」的用户会直接看不见图片 / 模态 / Toast / 启动页字标。
// 纯装饰覆盖层(其下另有静态内容)才允许 display: none。
// 历史事故:.anim-media-in / .modal-pop / .toast-pop 曾与装饰层共用一条 display:none 声明。

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

// 最内层规则:selector { 声明 }(@media 的外层花括号会被并进 selector 文本,不影响按类名判定)
const rules = [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(([, selector, decls]) => ({ selector, decls }));
const selectorsHiddenByDisplayNone = rules
  .filter((r) => /display\s*:\s*none/.test(r.decls))
  .map((r) => r.selector);
const selectorsWithAnimationNone = rules
  .filter((r) => /animation\s*:\s*none/.test(r.decls))
  .map((r) => r.selector);

// 内容承载类:元素本身就是用户要看的东西(或其容器)
const CONTENT_CLASSES = [
  '.anim-pop-in',       // 菜单 / Tooltip / minimap
  '.anim-media-in',     // 图片、媒体区、上传进度层
  '.anim-fade-out',     // 上述内容的退场(退场靠定时器卸载,不依赖 animationend)
  '.anim-collapse-in',  // 折叠区内容
  '.modal-backdrop',    // 模态遮罩
  '.modal-pop',         // 模态面板
  '.toast-pop',         // 全局通知
  '.brand-logo-in',     // 启动页 logo
  '.brand-float',       // 启动页 logo 容器
  '.brand-letter',      // 启动页字标本体
  '.brand-exit',        // 启动页揭幕退场
  // 音柱是素材库音频「真正出声了」的**唯一**指示(徽章三态:静态图标 → spinner → 音柱),
  // display:none 会让播放中的卡退回一个空圆圈 —— 开了减弱动态的用户看不出自己点响了没有。
  // 关掉动画即定格三根满高柱子,状态仍在
  '.lib-eq-bar',
];

describe('globals.css 的 reduced-motion 禁用方式', () => {
  test.each(CONTENT_CLASSES)('%s 不得被 display:none 整层隐藏', (cls) => {
    const offenders = selectorsHiddenByDisplayNone.filter((s) => s.includes(cls));
    expect(offenders).toEqual([]);
  });

  test.each(CONTENT_CLASSES)('%s 在降低动态下以 animation:none 退化', (cls) => {
    expect(selectorsWithAnimationNone.some((s) => s.includes(cls))).toBe(true);
  });

  // 纯装饰覆盖层保持 display:none(其下另有静态内容:字标本体 / 类型占位图)
  test('纯装饰层仍走 display:none', () => {
    for (const cls of ['.wordmark-sheen', '.asset-generating-sheen']) {
      expect(selectorsHiddenByDisplayNone.some((s) => s.includes(cls))).toBe(true);
    }
  });
});
