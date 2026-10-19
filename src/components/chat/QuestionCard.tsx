'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuestionDef } from '@/koubou/protocol';
import IconButton from '@/components/ui/IconButton';
import { FigIcon, figAsset } from '@/components/ui/figma';

// 选项行与 custom answer 行共用的外观(设计稿 Layer item:40px 高 12px 圆角)
// 选中态 = 品牌橙描边(647-26220,设计稿 primary/main #F97316 非项目 accent);hover = 填充(647-26356)
const rowClass = (active: boolean) =>
  `flex min-h-[40px] w-full items-center gap-3 rounded-[12px] border py-1 pl-1 pr-3 text-left motion-safe:transition-[border-color,background-color] motion-safe:duration-150 ${
    active ? 'border-[var(--color-primary)]' : 'border-transparent hover:bg-[var(--color-fill)]'
  }`;

export default function QuestionCard({ interactionId, questions, onSubmit }: {
  interactionId: string; questions: QuestionDef[];
  onSubmit: (interactionId: string, answers: Record<string, string | string[]>) => void;
}) {
  const { t } = useTranslation();
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(0); // 多问题时:当前展示的问题下标
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');

  const multi = questions.length > 1;
  const last = page === questions.length - 1;
  const q = questions[page];
  const cur = sel[q.question] ?? [];
  const answeredCur = cur.length > 0;                 // 当前题已答:门控右箭头
  const answeredCount = questions.filter((x) => (sel[x.question] ?? []).length > 0).length;
  // 已提交的自定义答案 = 选中集里不属于任何选项 label 的值
  const customValue = cur.find((v) => !q.options.some((o) => o.label === v));
  // 导航行:多问题恒有;单问题仅多选需要(右箭头充当确认),纯单选点选即提交无需导航
  const showNav = multi || q.multiSelect;

  const closeCustom = () => { setCustomOpen(false); setCustomText(''); };

  // 单选点选即答即前进,setState 尚未落定,故提交/前进显式携带最新选择 map
  const submit = (map: Record<string, string[]>) => {
    const answers: Record<string, string | string[]> = {};
    for (const x of questions) {
      const v = map[x.question] ?? [];
      answers[x.question] = x.multiSelect ? v : (v[0] ?? '');
    }
    onSubmit(interactionId, answers);
  };
  const advance = (map: Record<string, string[]>) => {
    closeCustom();
    if (last) submit(map);
    else setPage((p) => p + 1);
  };
  const choose = (label: string) => {
    if (q.multiSelect) {
      // 多选:只切换选中态,确认交给右箭头
      setSel((prev) => {
        const v = prev[q.question] ?? [];
        return { ...prev, [q.question]: v.includes(label) ? v.filter((x) => x !== label) : [...v, label] };
      });
      return;
    }
    const map = { ...sel, [q.question]: [label] };
    setSel(map);
    advance(map);
  };
  const commitCustom = () => {
    const text = customText.trim();
    if (!text) return;
    const map = {
      ...sel,
      // 多选:替换旧自定义值后追加;单选:独占
      [q.question]: q.multiSelect ? [...cur.filter((v) => v !== customValue), text] : [text],
    };
    setSel(map);
    if (q.multiSelect) closeCustom();
    else advance(map);
  };

  return (
    <div className="anim-media-in flex flex-col gap-3 rounded-[20px] border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-3">
      {showNav && (
        <div className="flex items-center gap-3">
          <div className="h-[4px] min-w-0 flex-1 overflow-hidden rounded-[8px] bg-[var(--color-line)]" role="progressbar" aria-valuenow={answeredCount} aria-valuemax={questions.length} aria-label={t('chat.question.progress', { cur: page + 1, total: questions.length })}>
            <div data-testid="question-progress-fill" className="h-full rounded-[8px] bg-[var(--color-primary)] motion-safe:transition-[width] motion-safe:duration-150" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
          </div>
          {multi && (
            <IconButton variant="bordered" className="size-8 rounded-full" disabled={page === 0} aria-label={t('chat.question.back')} onClick={() => { closeCustom(); setPage((p) => p - 1); }}>
              <FigIcon src={figAsset.chevronRight} size={14} flipX />
            </IconButton>
          )}
          {multi && (
            <span className="text-[14px] font-semibold tabular-nums text-[var(--color-ink)]">
              {t('chat.question.count', { cur: page + 1, total: questions.length })}
            </span>
          )}
          <IconButton variant="raised" className="size-8 rounded-full" disabled={!answeredCur} aria-label={last ? t('chat.question.submit') : t('chat.question.next')} onClick={() => advance(sel)}>
            <FigIcon src={figAsset.chevronRight} size={14} />
          </IconButton>
        </div>
      )}

      {/* 一次只渲染当前问题;切页时 key 变化触发淡入 */}
      <div key={page} className="anim-media-in flex flex-col gap-4">
        <div>
          {q.header && <div className="mb-0.5 text-[12px] text-[var(--color-muted)]">{q.header}</div>}
          <div className="flex items-center gap-1">
            <FigIcon src={figAsset.question} size={16} />
            <p className="min-w-0 flex-1 text-[15px] font-bold leading-[1.5] text-[var(--color-ink)]">{q.question}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {q.options.map((o, i) => {
            const active = cur.includes(o.label);
            return (
              <button type="button" key={o.label} aria-pressed={active} onClick={() => choose(o.label)} className={rowClass(active)}>
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)] text-[12px] font-medium text-[var(--color-ink)]">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-[var(--color-ink)]">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-[12px] leading-[1.4] text-[var(--color-muted)]">{o.description}</span>}
                </span>
              </button>
            );
          })}

          {/* Custom answer:收起=可点行;展开=内联输入,回车确认(末题即提交)/Esc 收起 */}
          {customOpen ? (
            <div className={rowClass(true)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)]">
                <FigIcon src={figAsset.pencil} size={16} />
              </span>
              <input
                autoFocus
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitCustom(); }
                  else if (e.key === 'Escape') closeCustom();
                }}
                placeholder={t('chat.question.custom')}
                aria-label={t('chat.question.custom')}
                className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
              />
            </div>
          ) : (
            <button type="button" aria-pressed={!!customValue} aria-label={t('chat.question.custom')} onClick={() => { setCustomOpen(true); setCustomText(customValue ?? ''); }} className={rowClass(!!customValue)}>
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-fill)]">
                <FigIcon src={figAsset.pencil} size={16} />
              </span>
              <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${customValue ? 'text-[var(--color-ink)]' : 'text-[var(--color-muted)]'}`}>
                {customValue ?? t('chat.question.custom')}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
