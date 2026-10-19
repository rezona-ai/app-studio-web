'use client';
import { assetPath } from '@/lib/basePath';

// 积分/订阅弹窗顶部 hero(328px 高)。两类构图:
//   宝箱系(漩涡底纹 + 促销粉渐变 + 立绘 + WordArt 字标),单卡 / 积分弹窗按触发源二选一:
//     insufficient  硬失败    INSUFFICIENT CREDITS...   空箱   5952:84376
//     lowBalance    余额将尽  ALMOST OUT OF CREDITS!    满箱   8047:165129
//   实景系(见文件末 UpgradeForMoreHero):
//     upgradeForMore 完整订阅窗 UPGRADE FOR MORE        实验室 9433:70186
// WordArt 是装饰性艺术字,**不做 i18n**(与旧实现一致)。

export type HeroVariant = 'insufficient' | 'lowBalance' | 'upgradeForMore';

interface HeroArt {
  /** 主视觉位图:积分不足是 2 道闪电的空箱,低余额是 6 道闪电的满箱 */
  art: string;
  /** 底色渐变(稿上两个变体刻意不同色):积分不足偏粉、低余额偏黄 */
  tint: string;
  /** 字标两行 */
  lines: [string, string];
  /** 字标字号(px,照稿) */
  size: number;
  /** 两行各自的水平偏移(px,照稿的 left calc 折算) */
  offsets: [number, number];
  /** 行高:稿上两行是独立绝对定位、间距小于行高(视觉上紧挨),故折算成 <1 的行高 */
  lineHeight: number;
  /** 内发光边:低余额稿上叠了两层(第二层 20% alpha),积分不足只有一层 */
  doubleGlow?: boolean;
}

// 参数逐项取自 get_design_context(5952:84376 / 8047:165129)。
// 唯一例外是字标描边:Figma 的文字描边不进 context 输出,按两张稿的截图目视复刻。
// upgradeForMore 构图不同,不进这张表(见下方单独分支)。
const HERO_ART: Record<Exclude<HeroVariant, 'upgradeForMore'>, HeroArt> = {
  insufficient: {
    art: '/figma/insufficient-chest.webp',
    tint: 'bg-[linear-gradient(167.91deg,color-mix(in_srgb,var(--color-promo)_60%,transparent)_1.3%,transparent_62.7%)]',
    lines: ['Insufficient', 'Credits...'],
    size: 56,
    offsets: [-17, 117],
    lineHeight: 0.65,
  },
  lowBalance: {
    art: '/figma/lowbalance-chest.png',
    tint: 'bg-[linear-gradient(167.91deg,color-mix(in_srgb,var(--hero-tint-low)_50%,transparent)_1.3%,transparent_62.7%)]',
    lines: ['Almost out of', 'Credits!'],
    size: 48,
    offsets: [0, 66],
    lineHeight: 0.95,
    doubleGlow: true,
  },
};

export default function UpsellHero({ variant, children }: { variant: HeroVariant; children?: React.ReactNode }) {
  // 完整订阅弹窗的新 hero(9433:70186)与宝箱三兄弟的构图完全不同(照片实景铺满 + 橙色调色层),
  // 不塞进 HERO_ART 表里凑合,单独一支
  if (variant === 'upgradeForMore') return <UpgradeForMoreHero>{children}</UpgradeForMoreHero>;

  const { art, tint, lines, size, offsets, lineHeight, doubleGlow } = HERO_ART[variant];
  // 字距照稿是字号的 1.5%(56.359→0.845 / 48.049→0.721)
  const tracking = size * 0.015;

  return (
    <div
      className="relative h-[328px] w-full shrink-0 overflow-clip rounded-t-[inherit] bg-[#0b0b0c]"
      data-hero={variant}
      style={{ '--wordart-stroke': 'var(--hero-stroke-chest)', '--wordart-stroke-w': '6px' } as React.CSSProperties}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* 图层顺序照稿:底色渐变 → 漩涡底纹(10% 压在渐变上) → 宝箱立绘 → 字标 */}
        <div data-layer="tint" className={`absolute inset-0 ${tint}`} />
        <img alt="" src={assetPath('/figma/insufficient-swirl.jpg')} className="absolute inset-0 size-full object-cover opacity-10" />
        {/* 宝箱是出血放大的:稿上 717×529 摆进 640×352 的框(宽 112%、高 150%),中心比 hero 中心低 17.5%。
            图与框同为 1.356 的宽高比,故只给宽度、高度自然得出,不需要 object-cover。 */}
        <img alt="" src={assetPath(art)} className="absolute left-[-7.15%] top-[-7.65%] w-[112.1%] max-w-none" />
        {/* 稿上两行绝对定位块的行框上下居中,折算后第一行文字中心在 hero 的 ~112px 处;
            容器顶按此回推(112 - 半行高 ≈ 92),别贴着顶(实测 62 时明显偏上) */}
        <div className="absolute inset-x-0 top-[92px] flex flex-col items-center rotate-[-8.25deg] scale-y-[0.99] skew-x-[-8.72deg]">
          <StickerLine fontSize={size} lineHeight={lineHeight} letterSpacing={tracking} offset={offsets[0]} fill="hero-wordart-chest">{lines[0]}</StickerLine>
          <StickerLine fontSize={size} lineHeight={lineHeight} letterSpacing={tracking} offset={offsets[1]} fill="hero-wordart-chest">{lines[1]}</StickerLine>
        </div>
      </div>
      {/* 内发光边(稿上 inset 0 4px 24px 3px #fb923c;低余额再叠一层 20% alpha) */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 rounded-[inherit] ${doubleGlow
          ? 'shadow-[inset_0_4px_24px_3px_var(--upsell-hero-glow),inset_0_4px_24px_3px_color-mix(in_srgb,var(--upsell-hero-glow)_20%,transparent)]'
          : 'shadow-[inset_0_4px_24px_3px_var(--upsell-hero-glow)]'}`}
      />
      {children}
    </div>
  );
}

// 完整订阅弹窗 hero(设计稿 9433:70186):实验室实景铺满 → 橙色调色层 → 台面扫光(color-dodge)
// → UPGRADE FOR MORE 字标 → 内发光边。字标是装饰艺术字,与其余 hero 一样不做 i18n。
// 实景图左侧用 mask 渐隐,给字标让出干净底面(稿上这一层本身也是 mask 过的)。
function UpgradeForMoreHero({ children }: { children?: React.ReactNode }) {
  // 字标是贴纸式的:橙渐变填充 + 厚白描边 + 落影,两层同文本叠出来(见 StickerLine)。
  // 描边不设 --wordart-stroke,吃 StickerLine 的默认值(白 9px)——实景照片上要厚白边压住背景。

  return (
    <div
      className="relative h-[328px] w-full shrink-0 overflow-clip rounded-[12px] bg-[var(--upsell-surface)]"
      data-hero="upgradeForMore"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* 实景铺满(稿上照片是完整可见的,只是压了一层暖调),再叠橙色调色层。
            上一版把台面扫光(color-dodge)铺在整块上,左半烧出一团黄白光斑 —— 稿上没有这块,
            故去掉该层,暖调只由下面这两层渐变负责。 */}
        <img
          alt=""
          src={assetPath('/figma/upgrade-lab.jpg')}
          className="absolute left-0 top-[-14%] h-[192%] w-full max-w-none object-cover brightness-[0.78] saturate-[1.08] sepia-[0.12]"
        />
        {/* 暖调:上浓下淡,把实景收进 hero 的橙调里 */}
        <div className="absolute inset-0 bg-[linear-gradient(173deg,color-mix(in_srgb,var(--upsell-hero-glow)_34%,transparent)_1%,transparent_70%)]" />
        {/* 中部略压暗,给字标让出对比(稿上照片中段比原片暗) */}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.35)_0%,rgba(0,0,0,0.2)_46%,transparent_78%)]" />
        <div className="absolute left-[24%] top-[54px] flex -translate-x-1/2 flex-col items-center rotate-[-9deg] skew-x-[-12deg]">
          <StickerLine fontSize={56} lineHeight={0.95} letterSpacing={-1.12} offset={-22} fill="hero-wordart-warm">Upgrade</StickerLine>
          <StickerLine fontSize={56} lineHeight={0.95} letterSpacing={-1.12} offset={22} fill="hero-wordart-warm">for more</StickerLine>
        </div>
      </div>
      {/* 内发光边(稿上 inset 0 4px 24px 3px):压在实景之上、关闭按钮之下 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_4px_24px_3px_var(--upsell-hero-glow)]"
      />
      {children}
    </div>
  );
}

// 贴纸字标的一行:同一段文字画两遍 —— 下层只出描边与落影,上层是渐变裁字。
// 副本对无障碍不可见(aria-hidden),可见文本仍只有一份。
// 字号 / 字距 / 行偏移走 style 而不是 Tailwind 任意值:它们逐变体不同,拼出来的类名扫描器看不见。
// 描边色与粗细由外层容器的 --wordart-stroke(-w) 决定,所以同一个组件能出白边(实景照片上)
// 与深棕边(宝箱渐变上)两种贴纸。
function StickerLine({
  fontSize, lineHeight, letterSpacing, offset = 0, fill, children,
}: {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  offset?: number;
  fill: string;
  children: string;
}) {
  const text = 'font-display whitespace-nowrap';
  const type: React.CSSProperties = { fontSize, lineHeight, letterSpacing };
  return (
    <span className="relative inline-block" style={{ transform: offset ? `translateX(${offset}px)` : undefined }}>
      <span aria-hidden className={`hero-wordart-stroke absolute left-0 top-0 ${text}`} style={type}>{children}</span>
      <span className={`hero-wordart ${fill} relative ${text}`} style={type}>{children}</span>
    </span>
  );
}
