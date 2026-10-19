import type { KeyboardEvent } from 'react';

/**
 * 是否处于输入法(IME)组合中。中文/日文/韩文等输入法在候选词阶段按 Enter
 * 只是上屏候选词,不应触发提交/发送/确认等动作 —— 所有「回车即动作」的输入框
 * 都应先用本函数排除组合态。
 * - `nativeEvent.isComposing`:现代浏览器在组合期间为 true(主判据)
 * - `keyCode === 229`:部分旧版浏览器/输入法组合时只给这个标志,作兜底
 */
export function isImeComposing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}
