import { expect, test } from 'vitest';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { zhTW } from './locales/zh-TW';
import { vi } from './locales/vi';
import { fr } from './locales/fr';
import { ru } from './locales/ru';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { de } from './locales/de';
import { es } from './locales/es';
import { pt } from './locales/pt';

// 递归收集所有叶子 key 路径,断言各语言与 en 完全一致(与 TS 类型互为双保险)。
function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test('全部 10 种非 en 词典的 key 集合与 en 完全一致', () => {
  const base = keys(en).sort();
  for (const dict of [zh, zhTW, vi, fr, ru, ja, ko, de, es, pt]) expect(keys(dict).sort()).toEqual(base);
});

// 余额展示口径是 spendable(见 lib/pgc/types.ts 的 BalanceData),标签必须与之同义 ——
// 印着「当前余额 600」而账面有 1000,就是本轮要消灭的那种「数字与旁边的字打架」。
// TS 类型只保证 key 齐全、保证不了措辞,故在这里钉住
test('余额相关文案不得再说「余额」——标签与所显示的 spendable 同义', () => {
  const BALANCE_WORDS = [/余额/, /餘額/, /残高/, /잔액/, /\bBalance\b/i, /Saldo/i, /Solde/i, /баланс/i, /Guthaben/, /Số dư/i];
  const hit = (s: string) => BALANCE_WORDS.some((re) => re.test(s));
  for (const [name, d] of Object.entries({ en, zh, vi, fr, ru, ja })) {
    expect(hit((d as typeof en).topup.balanceLabel), `${name}.topup.balanceLabel`).toBe(false);
    // 原本还断言 insufficient.descPrefix,但本仓已用 CreditModalGate 取代旧的
    // InsufficientCreditsModal 并清掉那三个死键(提交 46c4796a),没有对应文案可断言了
  }
});
