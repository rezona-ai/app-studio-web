'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import Button from '@/components/ui/Button';
import type { KoubouClient } from '@/koubou/client';

// WS 断线内联条:重连中(spinner) / 已断开(重连按钮)。状态机见 docs/superpowers/specs/2026-07-01-ws-reconnect-design.md
export default function ReconnectBanner({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const connStatus = useStore((s) => s.connStatus);
  const { t } = useTranslation();
  // 记录是否曾连上:初次 connecting(从未 open)不显示"重连中",避免首屏误报。
  // 渲染期 guarded setState(遵仓库禁 effect-setState / 禁渲染期改 ref 的约束)。
  const [everOpen, setEverOpen] = useState(false);
  if (connStatus === 'open' && !everOpen) setEverOpen(true);
  // 记录首连是否已失败过:从未 open 但已见 error/closed(首连失败进退避循环)也要显示重连中,
  // 否则用户只能在控制台看到报错,界面永远静默
  const [everFailed, setEverFailed] = useState(false);
  if (!everFailed && (connStatus === 'error' || connStatus === 'closed')) setEverFailed(true);

  if (connStatus === 'open') return null;

  // superseded:被别的标签页顶替(4000)。自动唤醒重连刻意排除它(避免两 tab 互抢),
  // 只有 toast 会成死胡同——给常驻提示 + 手动「在此标签页继续」入口(reconnect 即抢回属主)
  const superseded = connStatus === 'superseded';
  const stalled = connStatus === 'stalled' || connStatus === 'fatal';
  // 非停滞/顶替态(重连中)且从未连上过也从未失败过 → 首屏初次连接,不打扰
  if (!superseded && !stalled && !everOpen && !everFailed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`anim-collapse-in mx-3 mb-2 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] ${
        stalled
          ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
          : 'bg-[var(--color-fill)] text-[var(--color-muted)]'
      }`}
    >
      {superseded ? (
        <>
          <span className="flex-1">{t('chat.conn.supersededHint')}</span>
          <Button className="px-2 py-1 text-[13px]" onClick={() => client.current?.reconnect()}>
            {t('chat.conn.takeOver')}
          </Button>
        </>
      ) : stalled ? (
        <>
          <span className="flex-1">{t('chat.conn.disconnected')}</span>
          <Button className="px-2 py-1 text-[13px]" onClick={() => client.current?.reconnect()}>
            {t('chat.conn.reconnect')}
          </Button>
        </>
      ) : (
        <>
          <span
            aria-hidden
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-line-2)] border-t-[var(--color-muted)]"
          />
          <span className="flex-1">{t('chat.conn.reconnecting')}</span>
        </>
      )}
    </div>
  );
}
