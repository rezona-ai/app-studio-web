'use client';
import { useTranslation } from 'react-i18next';
import type { SkillDef } from '@/lib/skills';

// Skill 弹窗:列表由 Composer 过滤后传入(activeIndex 为键盘高亮项);
// 显示名/描述走 i18n 按稳定名映射,未登记的降级为名字本身、描述空。
// 胶囊直接展示后端下发的原生调用串(cc 为 /name,codex 为 $name),不由前端拼前缀。
export default function SkillPopover({
  list,
  activeIndex,
  onPick,
}: {
  list: SkillDef[];
  activeIndex: number;
  onPick: (skill: SkillDef) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="anim-pop-in origin-bottom-left absolute bottom-full left-0 right-0 mb-2 flex flex-col overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
      <div className="px-4 py-3 text-[14px] font-semibold leading-[22px] text-[var(--color-ink)]">{t('chat.skill.title')}</div>
      <div className="h-px w-full shrink-0 bg-[var(--color-line)]" />
      <div className="scrollbar-auto max-h-64 overflow-auto">
        {list.length === 0 ? (
          <div className="px-4 py-3 text-[12px] leading-[18px] text-[var(--color-muted)]">{t('chat.skill.empty')}</div>
        ) : (
          list.map((skill, i) => {
            const desc = t(`skills.${skill.name}.description`, { defaultValue: '' });
            return (
              <button
                key={skill.invocation}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // 防 textarea 失焦(与 MentionPopover 同款)
                  onPick(skill);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-fill)] ${i === activeIndex ? 'bg-[var(--color-fill)]' : ''}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-[14px] font-semibold leading-[22px] text-[var(--color-ink)]">{t(`skills.${skill.name}.name`, { defaultValue: skill.name })}</span>
                  <span className="shrink-0 whitespace-nowrap rounded-[4px] bg-[var(--color-primary-soft)] px-1 text-[12px] leading-[18px] text-[var(--color-ink)]">{skill.invocation}</span>
                </span>
                {desc && <span className="text-[12px] leading-[18px] text-[var(--color-muted)]">{desc}</span>}
              </button>
            );
          })
        )}
      </div>
      <div className="h-px w-full shrink-0 bg-[var(--color-line)]" />
      <div className="px-4 py-2.5 text-[12px] leading-[18px] text-[var(--color-muted)]">{t('chat.skill.hint')}</div>
    </div>
  );
}
