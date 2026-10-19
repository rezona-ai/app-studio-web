'use client';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Message, Part } from '@/store/types';
import { useStore } from '@/store';
import { extractRefs, extractRefTokens, resolveRefSignature } from '@/lib/refs';
import ThinkingBlock from './ThinkingBlock';
import ToolCard from './ToolCard';
import RichText from './RichText';
import StreamingText from './StreamingText';
import AssetChip, { Chip, MediaThumb } from './AssetChip';
import MessageActions from './MessageActions';

const TEXT = 'text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]';
const EMPTY_ASSETS: never[] = [];

function MessageItem({ message, turnActionsFollow = false }: { message: Message; turnActionsFollow?: boolean }) {
  const { t } = useTranslation();
  // 不整表订阅 assets(审计 A1):memo 拦不住组件内部订阅,任一资产变化会连带全部消息卡重渲 + Markdown 重解析。
  // 改为两段式:1) 纯文本 token 化(只依赖消息文本,memo 一次);2) 订阅「解析签名」——各 token 命中的资产 key。
  // 签名值不变(含无 token 的恒空串)则本卡不重渲;签名变化(被引资产增删/换 key)才用当时的 assets 重算解析。
  const isUser = message.role === 'user';
  const raw = isUser
    ? message.parts
        .filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
    : '';
  const tokens = useMemo(() => extractRefTokens(raw), [raw]);
  const refSig = useStore((s) => (tokens.length === 0 ? '' : resolveRefSignature(tokens, s.assets)));
  const refs = useMemo(
    () => extractRefs(raw, tokens.length === 0 ? EMPTY_ASSETS : useStore.getState().assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refSig 是解析结果的值签名:它变化才需要用最新 assets 重算;assets 引用本身不进依赖,否则退回整表扇出
    [raw, tokens, refSig],
  );

  // 用户消息:左缩进灰底气泡,顺序:资产 chip(上传媒体 + @引用,同款 Chip) → 正文
  if (isUser) {
    const media = message.parts.filter((p): p is Extract<Part, { type: 'media' }> => p.type === 'media');
    const { keys, text, chips } = refs;
    const hasChips = media.length > 0 || keys.length > 0 || chips.length > 0;
    const hasContent = hasChips || text.trim().length > 0;
    return (
      <div className={`group/message relative flex justify-end pl-6 ${raw.trim() ? 'mb-11' : 'mb-5'}`}>
        {hasContent && (
          <div className="flex w-fit max-w-full flex-col gap-1 rounded-[12px] bg-[var(--color-fill)] p-3">
            {hasChips && (
              <div className="flex flex-wrap gap-1">
                {/* 上传媒体与 @引用资产用同一 Chip(缩略图 + 名称),视觉统一;无 name(冷启动重建)回退 kind 名 */}
                {media.map((m, i) => (
                  <Chip key={`m${i}`} icon={<MediaThumb kind={m.kind} src={m.url} />} label={m.name ?? t(`canvas.assetKind.${m.kind}`)} />
                ))}
                {keys.map((k) => (
                  <AssetChip key={k} assetKey={k} />
                ))}
                {/* 游离 chip:token 反查不到画布资产(对话附件/已删资产),按 token 派生的 kind/文件名渲染 */}
                {chips.map((c, i) => (
                  <Chip key={`s${i}`} icon={<MediaThumb kind={c.kind} src={c.url} />} label={c.name ?? t(`canvas.assetKind.${c.kind}`)} />
                ))}
              </div>
            )}
            {text.trim() && <RichText text={text} className={TEXT} />}
          </div>
        )}
        {raw.trim() && (
          <MessageActions
            copyText={raw}
            variant="hover"
            onEdit={() => useStore.getState().editComposerDraft(raw)}
          />
        )}
      </div>
    );
  }

  // 助手消息:无角色标签,纯文本 + 加粗,内联 tool card / thinking 按 part 顺序穿插
  // 纯 tool 卡片消息块用更小的下边距,避免连续工具卡之间间隔过大
  const isToolOnly = message.parts.length > 0 && message.parts.every((p) => p.type === 'tool');
  // 仅最后一个 text part 在持续增长,只对它做流式逐字
  const lastTextIdx = message.parts.reduce((acc, p, idx) => (p.type === 'text' ? idx : acc), -1);
  return (
    <div className={`flex flex-col gap-2 ${isToolOnly ? 'mb-2' : turnActionsFollow ? 'mb-1' : 'mb-5'}`}>
      {message.parts.map((p, i) => {
        switch (p.type) {
          case 'text':
            return p.text.trim() ? (
              <StreamingText
                key={i}
                text={p.text}
                className={TEXT}
                streaming={message.status === 'generating' && i === lastTextIdx}
              />
            ) : null;
          case 'thinking': {
            // 流式中 = 消息生成中且该思考块是最后一个 part(后续块一旦开始,思考即结束)
            const streaming = message.status === 'generating' && i === message.parts.length - 1;
            // 空思考只在流式中渲染(转圈占位);落定后为空(后端剥空思考文本的历史回放)不渲染空壳头
            return p.text.trim() || streaming ? <ThinkingBlock key={i} text={p.text} streaming={streaming} /> : null;
          }
          case 'tool':
            return <ToolCard key={i} part={p} />;
          case 'error':
            // 报错不再长在对话流里:它是输入框正上方固定槽的 AgentErrorBubble(设计稿 2026-08-27)。
            // 这个分支只为老会话快照里的存量 error part 兜底(restoreSnapshot 会滤掉整条消息,
            // 这里是第二道)——渲染成 null,不留空壳
            return null;
          case 'notice':
            // 系统性提示(如用户终止后的助手回复):与普通助手正文同款排版,渲染期按 code 翻译
            return <div key={i} className={TEXT}>{t(p.code)}</div>;
          case 'media':
            return null; // 媒体 part 仅出现在用户消息;助手分支占位以满足类型穷尽
        }
      })}
    </div>
  );
}

// memo:流式期每个 delta 都改 messages 引用,ChatPanel 全列表重渲;消息对象是不可变更新,引用比较即可跳过未变消息(含 Markdown 重解析)
export default memo(MessageItem);
