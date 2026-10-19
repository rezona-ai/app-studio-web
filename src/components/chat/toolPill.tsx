'use client';
import { useTranslation } from 'react-i18next';
import { FigIcon, figAsset } from '@/components/ui/figma';
import type { Status } from '@/store/types';

// 工具/思考块统一 pill 容器:收起(无正文)→ 全圆胶囊;有下方内容 → 卡片角。描边、无填充。
export function pillClass(expanded: boolean): string {
  return `border border-[var(--color-line)] px-4 py-2.5 text-[13px] ${expanded ? 'rounded-[16px]' : 'rounded-[30px]'}`;
}

// 进行中转圈:amber 头 + 中性轨;role=status 供无障碍与测试识别。
export function Spinner() {
  const { t } = useTranslation();
  return (
    <span
      role="status"
      aria-label={t('chat.tool.running')}
      data-tool-status="running"
      className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-line-2)] border-t-[var(--color-warning)]"
    />
  );
}

// 左侧状态图标:进行中/等待=amber 转圈,失败=红 warning,完成=品牌橙勾。
// check/warning 走 FigIcon mask(primary=currentColor),由外层 text-* 决定色 → 随主题正确重着色。
export function ToolStatusIcon({ status }: { status: Status }) {
  if (status === 'generating' || status === 'pending') return <Spinner />;
  if (status === 'error')
    return (
      <span data-tool-status="error" className="flex shrink-0 text-[var(--color-danger)]">
        <FigIcon src={figAsset.warningSign} size={14} tone="primary" />
      </span>
    );
  return (
    <span data-tool-status="done" className="flex shrink-0 text-[var(--color-primary)]">
      <FigIcon src={figAsset.checkCircle} size={14} tone="primary" />
    </span>
  );
}

// 行级展开箭头(子代理行等「展开这一条」的入口):chevron 收起朝右、展开旋转 90° 朝下。
// 与下面整块折叠的 CollapseArrow 刻意分家 —— 两者在同一列上下相邻,同图形只差旋转方向时
// 分不出「折叠整张卡」与「展开这一行」;此处换旋转轴(横→竖),沿用 FilesView 目录树的行级语汇。
export function RowArrow({ open }: { open: boolean }) {
  return (
    <span
      data-row-arrow
      className={`ml-auto flex shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
    >
      <FigIcon src={figAsset.chevronRight} size={12} />
    </span>
  );
}

// 右侧折叠箭头(整块折叠:工具卡 / 思考块 / 计划卡卡头):收起朝下,展开 180° 朝上;降低动态时去过渡。
export function CollapseArrow({ open }: { open: boolean }) {
  return (
    <span
      data-collapse-arrow
      className={`ml-auto flex shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
    >
      <FigIcon src={figAsset.arrowDown} size={12} />
    </span>
  );
}
