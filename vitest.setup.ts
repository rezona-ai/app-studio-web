import { afterEach, vi } from 'vitest';
import { configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom 未实现 scrollIntoView / scrollTo(ChatPanel 等组件在 effect 中调用)
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// jsdom 环境未提供 localStorage 时补一个内存实现,供 zustand persist 使用
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  } as Storage;
}

// jsdom 未实现 ResizeObserver(GameFrame 用它测舞台高反推面板宽);测试补 no-op,避免构造报错。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom 未实现 Pointer Capture API(Composer 拖拽把手用它锁定拖拽焦点),补 no-op
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {};
}
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = () => {};
}

// jsdom 未定义 navigator.maxTouchPoints getter,vi.spyOn(...,'get') 要求属性预先存在
// (WorkspaceEntry 测试要 mock 它做 iPadOS 补判判定)
if (!('maxTouchPoints' in navigator)) {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
}

// 假时钟兜底:用例体内 vi.useFakeTimers() 之后**一旦抛错**,同文件后面的 useRealTimers() 就走不到,
// 假时钟泄漏给后续每一条 —— 而 RTL 的 jestFakeTimersAreEnabled() 依赖 `jest` 全局(vitest 即使
// globals:true 也不提供),检测不到 vitest 的假时钟,于是 waitFor 的轮询定时器被冻住、**必挂到用例超时**。
// 表现就是「一次红一整簇」:本仓已记录过两例未澄清的偶发红(CreativeLibraryModal 6 条 / I18nProvider 1 条,
// 见 plans/2026-08-06-orphan-gen-task-no-delete.md 末尾)。一行兜底比逐个文件加 afterEach 可靠 ——
// 后者靠人记得,而这类泄漏恰恰在「忘了写」的文件里发生。
afterEach(() => {
  if (vi.isFakeTimers()) vi.useRealTimers();
});

// waitFor 默认只等 1s,而用例超时是 5s(vitest 默认,本仓未覆盖)。并行负载重时 1s 太紧:
// 断言其实会过,只是没等到 —— 与真实缺陷难以区分。抬到与用例超时同阶,让「超时」只有一种含义。
configure({ asyncUtilTimeout: 5000 });

// i18n:测试统一在 en 下渲染(en 词条 = 英文源串逐字复制,现有组件测试原样通过)。
import i18n from './src/i18n';
void i18n.changeLanguage('en');
