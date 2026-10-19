'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { figAsset, FigIcon } from '@/components/ui/figma';
import { POPOVER_MARGIN } from '@/lib/popover-position';

// icon/description 可选:带 description 的选项渲染双行(标题 + muted 描述),icon 渲染在行首(如模型选择器)
export type SelectOption = { value: string; label: string; icon?: string; description?: string };

// 公共单值下拉:胶囊触发钮 + 上拉菜单 + 选项(选中态绿点)。各处的「模型选择」等单值下拉共用本组件,
// 样式只在此一处维护(浮面 bg-pop / 选项间距 gap-1 / 触发钮去刺眼白高光)。
// variant:'plain' 透明描边(Composer 工具栏,与 +/@ 一致);'filled' 实心填充(生成弹窗,与参数 pill 一致)。
// align:菜单相对触发钮左/右对齐。0 项不渲染;1 项渲染静态标签(不可交互);>1 项可展开选择。
const TRIGGER: Record<'plain' | 'filled' | 'ghost', string> = {
  plain: 'border border-[var(--color-line-2)] transition-colors hover:bg-[var(--color-fill)]',
  // filled 对齐设计稿生成面板 pill(396:17849):无阴影,圆角走 radiusFor 的 --radius-control
  filled: 'border border-[var(--color-line-2)] bg-[var(--color-fill)] transition hover:brightness-[0.98]',
  // ghost:无边框无底,仅 hover 轻微铺底;用于账户条语言下拉等紧凑场景,常态不喧宾夺主
  ghost: 'transition-colors hover:bg-[var(--color-fill)]',
};
// 触发钮尺寸:md 默认(工具栏/生成弹窗 pill);sm 紧凑(账户条,高度对齐 32px 头像);圆角由 radiusFor 按 variant 派生
const PILL: Record<'md' | 'sm', string> = {
  md: 'flex h-10 min-w-0 max-w-full items-center gap-2 px-[10px]',
  sm: 'flex h-8 min-w-0 max-w-full items-center gap-1.5 px-2',
};
// 圆角:filled(生成面板参数 pill)按设计稿走控件圆角 8px;plain/ghost 沿用 12px(sm 恒 10px)
const radiusFor = (size: 'md' | 'sm', variant: 'plain' | 'filled' | 'ghost') =>
  size === 'sm' ? 'rounded-[10px]' : variant === 'filled' ? 'rounded-[var(--radius-control)]' : 'rounded-[12px]';
const LABEL = 'truncate text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]';

export default function Select({
  value,
  options,
  onChange,
  align = 'left',
  variant = 'plain',
  size = 'md',
  ariaLabel,
  onOpenChange,
  triggerLabel,
  direction = 'up',
  disabled = false,
  openRequest = 0,
  placeholder,
  fullWidth = false,
}: {
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (value: string) => void;
  align?: 'left' | 'right';
  variant?: 'plain' | 'filled' | 'ghost';
  size?: 'md' | 'sm';
  ariaLabel?: string;
  // 通知父级展开态:父级据此让 Esc 优先收下拉再关弹窗(见 GenerateForm)
  onOpenChange?: (open: boolean) => void;
  // 触发钮显示文本覆盖(默认显示选中项 label);用于紧凑触发(如语言下拉显示短码 EN/ZH)
  triggerLabel?: string;
  // 菜单弹出方向:'up' 上弹(默认,底部锚定的 Composer/生成弹窗);'down' 下弹(顶部锚定,如账户条语言下拉)
  direction?: 'up' | 'down';
  // 禁用:仍显示当前选中值(不是空态),只是不可展开。用于「codex 活跃 run 期不允许切模型」等场景
  disabled?: boolean;
  // 外部请求展开:计数每变一次就展开一次(报错气泡的 Switch model 开 Composer 的模型下拉,
  // 设计稿 2026-09-03)。递增计数而非布尔 —— 用户手动关掉菜单后再点按钮,布尔值不变 effect 不重跑。
  // 挂载时的初值不算请求,只响应变化
  openRequest?: number;
  // 占位:仅当传了且 value 无匹配时生效——触发钮显示占位、菜单不打选中点。不传时无匹配仍回落第一项
  // (既有调用方依赖这个回落)。用于「目标失效须重选」这类不能让人误以为已选中第一项的场景
  placeholder?: string;
  // 撑满父宽、chevron 贴右:表单里与上下输入框对齐(如 Rezona 发布目标)。默认按内容收缩
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback((next: boolean) => { setOpen(next); onOpenChange?.(next); }, [onOpenChange]);

  // 水平夹取:菜单(尤其带描述的模型列表,恒 300px)比触发钮宽得多,Chat 栏拖到最窄时会顶出视口。
  // 展开当帧量到位置再按溢出量整体推回,useLayoutEffect 在绘制前生效,无闪烁(同 Tooltip 的做法)。
  // 只动 left/right 不用 transform —— transform 归 .anim-pop-in 的进场缩放所有。
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    const wrap = wrapRef.current;
    if (!open || !el || !wrap) return; // 收起时菜单已卸载,无须还原
    // 位置由「触发钮(未动画)+ 菜单 offsetWidth」推,不量菜单自身的 rect ——
    // 首帧 .anim-pop-in 正处缩放中,getBoundingClientRect 含 transform 会量小,偏移量随之算错
    const anchor = wrap.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = align === 'right' ? anchor.right - w : anchor.left;
    const overLeft = POPOVER_MARGIN - left; // >0 即左侧溢出
    const roomRight = window.innerWidth - POPOVER_MARGIN - (left + w); // <0 即右侧溢出
    // 左溢出优先推回,但不越过右侧边距;两侧都装不下时保左边距(菜单本就宽于视口)
    const shift = overLeft > 0 ? Math.min(overLeft, Math.max(roomRight, 0)) : Math.min(roomRight, 0);
    if (align === 'right') el.style.right = `${-shift}px`;
    else el.style.left = `${shift}px`;
  }, [open, align]);

  // Esc 收起下拉(仅在展开时挂载)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, toggle]);

  // 外部展开请求:只响应**变化**,首帧初值不触发(否则挂载即弹菜单)。
  // 禁用 / 单选项时把请求**消费掉**而不置 open:这两个分支不渲染菜单,open 悄悄为 true 会在解锁那一刻
  // 让菜单凭空弹出(评审 I-1)
  const seenRequest = useRef(openRequest);
  const inert = disabled || options.length <= 1;
  useEffect(() => {
    if (openRequest === seenRequest.current) return;
    seenRequest.current = openRequest;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部事件(计数变化)驱动的开合,不是可在渲染期派生的状态;且 toggle 还要通知父级 onOpenChange
    if (!inert) toggle(true);
  }, [openRequest, toggle, inert]);

  if (options.length === 0) return null;
  const matched = options.find((o) => o.value === value);
  const current = matched ?? options[0];
  const selected = placeholder != null && !matched ? null : current.value;
  const shownLabel = triggerLabel ?? (selected === null ? placeholder! : current.label);

  // 仅一项 / 被禁用:静态标签,无 chevron / 不可交互(禁用态压低不透明度示意)。
  // 占位态例外:只剩一项也要可点,否则用户无从解除「未选」
  if ((options.length === 1 && selected !== null) || disabled) {
    return (
      <div
        aria-disabled={disabled || undefined}
        className={`${PILL[size]} ${radiusFor(size, variant)} ${TRIGGER[variant]}${fullWidth ? ' w-full' : ''}${disabled ? ' pointer-events-none opacity-50' : ''}`}
      >
        <span className={LABEL}>{shownLabel}</span>
      </div>
    );
  }

  const pick = (v: string) => { onChange(v); toggle(false); };

  // 方向派生(Tailwind 需字面量类名):up=菜单在触发钮上方、chevron 关闭朝上;down=菜单在下方、chevron 关闭朝下
  const menuPos = direction === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]';
  const menuOrigin =
    direction === 'up'
      ? (align === 'right' ? 'origin-bottom-right' : 'origin-bottom-left')
      : (align === 'right' ? 'origin-top-right' : 'origin-top-left');
  const chevronRot =
    direction === 'up'
      ? (open ? 'rotate-0' : 'rotate-180')
      : (open ? 'rotate-180' : 'rotate-0');

  return (
    <div ref={wrapRef} className={`relative min-w-0${fullWidth ? ' w-full' : ''}`}>
      <button
        type="button"
        aria-label={ariaLabel ?? shownLabel}
        onClick={() => toggle(!open)}
        className={`${PILL[size]} ${radiusFor(size, variant)} ${TRIGGER[variant]}${fullWidth ? ' w-full justify-between' : ''}`}
      >
        <span className={LABEL}>{shownLabel}</span>
        <FigIcon src={figAsset.chevronDown} size={16} className={`shrink-0 opacity-70 transition-transform duration-150 ${chevronRot}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => toggle(false)} />
          <div
            ref={menuRef}
            // 带描述的菜单宽度写死 300(原 min-w):上面的推移改 left/right,固定宽才不会牵动描述文案的换行宽度
            className={`anim-pop-in ${menuOrigin} absolute ${menuPos} ${align === 'right' ? 'right-0' : 'left-0'} z-[56] flex ${options.some((o) => o.description) ? 'w-[300px] h-[340px] overflow-y-auto scrollbar-auto' : 'min-w-[200px]'} flex-col gap-1 rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] p-2 shadow-[var(--shadow-popover)] backdrop-blur-[6px]`}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => pick(o.value)}
                className={`flex shrink-0 items-center gap-2 rounded-[12px] px-2 text-left transition-colors hover:bg-[var(--color-fill)] ${o.description ? 'py-2' : 'h-9'} ${o.value === selected ? 'bg-[var(--color-fill)]' : ''}`}
              >
                {o.icon && <FigIcon src={o.icon} size={20} className="shrink-0 text-[var(--color-ink)]" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium tracking-[-0.13px] text-[var(--color-ink)]">{o.label}</span>
                  {o.description && <span className="text-[12px] leading-[16px] text-[var(--color-muted)]">{o.description}</span>}
                </span>
                {o.value === selected && <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-live)]" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
