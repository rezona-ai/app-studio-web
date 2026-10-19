'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Square } from 'lucide-react';
import { useStore } from '@/store';
import { useIsDark } from '@/client/useIsDark';
import { getActiveMention, canMention, applyMentionTokens, applyMentionTokensForSend, attachmentTag, MENTION_TYPE, splitMentionTokens, type MentionSegment } from '@/lib/refs';
import { getActiveSkillToken, filterSkills, splitSkillTokens, skillPrefixes, type ActiveSkillToken, type SkillDef, type SkillSegment } from '@/lib/skills';
import { newId } from '@/lib/ids';
import { isImeComposing } from '@/lib/keyboard';
import MentionPopover from './MentionPopover';
import SkillPopover from './SkillPopover';
import ModelSelector from './ModelSelector';
import AttachmentBar from './AttachmentBar';
import IconButton, { submitVariant } from '@/components/ui/IconButton';
import Tooltip from '@/components/ui/Tooltip';
import { figAsset, FigIcon } from '@/components/ui/figma';
import type { KoubouClient } from '@/koubou/client';
import type { ContentBlock } from '@/koubou/protocol';
import { validateUpload, rejectMessage, acceptAttr, UPLOAD_POLICY } from '@/lib/upload-policy';
import { filesFromClipboard } from '@/lib/clipboard-assets';
import { track, projectPublicId } from '@/lib/analytics';
import { clampBaseLines, contentLines, displayLines, boxHeight, LINE_HEIGHT } from '@/lib/composer-height';

export default function Composer({ client }: { client: React.RefObject<KoubouClient | null> }) {
  const { draft, attachments } = useStore((s) => s.composer);
  const composerFocusRequest = useStore((s) => s.composerFocusRequest);
  const baseLines = clampBaseLines(useStore((s) => s.composer.baseLines ?? 2)); // 旧持久化数据无此字段时兜底
  const composerSet = useStore((s) => s.composerSet);
  const resetComposer = useStore((s) => s.resetComposer);
  const setError = useStore((s) => s.setError);
  const pushUserMessage = useStore((s) => s.pushUserMessage);
  const runStatus = useStore((s) => s.runStatus);
  const autoSendArmed = useStore((s) => s.autoSendArmed);
  const setAutoSendArmed = useStore((s) => s.setAutoSendArmed);
  const connStatus = useStore((s) => s.connStatus);
  const replayActive = useStore((s) => s.replay != null);
  const assets = useStore((s) => s.assets);
  const mentionKeys = assets.filter(canMention).map((a) => a.key);
  const canOpenMention = mentionKeys.length > 0; // 无可提及资产时 @ 按钮禁用
  const { t } = useTranslation();
  const dark = useIsDark();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const skills = useStore((s) => s.skills);
  const [slash, setSlash] = useState<ActiveSkillToken | null>(null);
  // 激活前缀随 backend 变(cc 为 '/',codex 为 '$'),由已加载的 skills 的 invocation 派生
  const prefixes = skillPrefixes(skills);
  const canOpenSkill = prefixes.length > 0; // 列表未加载/后端无 skill 时按钮禁用(同 @ 的无资产处置)
  const [slashIndex, setSlashIndex] = useState(0);
  const [contentLn, setContentLn] = useState(1);
  const lines = displayLines(baseLines, contentLn);

  // MessageItem 只发 store 请求，textarea 的聚焦与选区仍由拥有 DOM ref 的 Composer 完成。
  useEffect(() => {
    if (composerFocusRequest === 0) return;
    const textarea = taRef.current;
    if (!textarea) return;
    const end = useStore.getState().composer.draft.length;
    textarea.focus();
    textarea.setSelectionRange(end, end);
  }, [composerFocusRequest]);

  // 内容行数测量:draft 变化后读 scrollHeight。textarea 是 h-full 撑满父容器,scrollHeight = max(内容高, 可视高),
  // 收缩场景(删字)下若不先归零会恒等于可视高卡住不缩,故测量时临时将高度置 0 再读、随后恢复(同步布局,无闪烁)。
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = '0px';
    setContentLn(contentLines(ta.scrollHeight));
    ta.style.height = prev;
  }, [draft]);

  // 拖拽把手:向上拖增高,基准行数(baseLines)持久化为 auto-grow 下限
  const dragRef = useRef<{ startY: number; startLines: number } | null>(null);
  const onHandleDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, startLines: baseLines };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = clampBaseLines(d.startLines + (d.startY - e.clientY) / LINE_HEIGHT);
    if (next !== baseLines) composerSet({ baseLines: next });
  };
  const onHandleUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const syncMirrorScroll = () => {
    if (mirrorRef.current && taRef.current) mirrorRef.current.scrollTop = taRef.current.scrollTop;
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    composerSet({ draft: e.target.value });
    const caret = e.target.selectionStart ?? e.target.value.length;
    const m = getActiveMention(e.target.value, caret);
    const s = getActiveSkillToken(e.target.value, caret, prefixes);
    // 两者都命中时取 start 更大者(更靠近光标),避免 "@a /b" 双弹窗
    const useSlash = s && (!m || s.start > m.start);
    setMention(useSlash ? null : m);
    setSlash(useSlash ? s : null);
    setSlashIndex(0);
  };

  const segments = splitSkillTokens(draft, skills).flatMap((seg): (SkillSegment | MentionSegment)[] =>
    seg.kind === 'skill' ? [seg] : splitMentionTokens(seg.text, mentionKeys),
  );

  const resolveSkillName = (name: string) => t(`skills.${name}.name`, { defaultValue: name });
  const skillList = slash ? filterSkills(skills, slash.query, resolveSkillName) : [];
  const activeSkillIndex = Math.min(slashIndex, Math.max(skillList.length - 1, 0));

  // 插入后端给的原生调用串(cc 的 /name / codex 的 $name),不由前端拼前缀
  const pickSkill = (skill: SkillDef) => {
    if (!slash) return;
    const cur = useStore.getState().composer.draft;
    const next = cur.slice(0, slash.start) + skill.invocation + ' ' + cur.slice(slash.start + 1 + slash.query.length);
    composerSet({ draft: next });
    setSlash(null);
    taRef.current?.focus();
  };

  const pickMention = (key: string) => {
    if (!mention) return;
    const cur = useStore.getState().composer.draft;
    const next = cur.slice(0, mention.start) + '@' + key + ' ' + cur.slice(mention.start + 1 + mention.query.length);
    composerSet({ draft: next });
    setMention(null);
    taRef.current?.focus();
  };

  const startMention = () => {
    if (!canOpenMention) return; // 无可提及资产:按钮已 disabled,此处再防御一次
    // 已有激活的 @ 引用时重复点击不再追加符号,仅保持菜单打开;校验 mention 位置防止 draft 已被外部清空的陈旧状态
    if (!(mention && draft[mention.start] === '@')) {
      composerSet({ draft: draft + '@' });
      setMention({ query: '', start: draft.length });
    }
    setSlash(null); // 两个弹窗互斥必须双向:渲染条件各自独立,单向收口时点完 skill 再点 @ 会同时挂两层菜单
    setSlashIndex(0);
    taRef.current?.focus();
  };

  // skill 手动入口:插入 backend 原生前缀把弹窗开成空 query 态(与输入前缀等价,不另走一条选中路径)
  const startSkill = () => {
    if (!canOpenSkill) return; // 无可选 skill:按钮已 disabled,此处再防御一次
    // 取 [0]:同一 backend 的 invocation 前缀恒同一种(cc 全 '/'、codex 全 '$'),故列表首个即唯一。
    // getActiveSkillToken 在多前缀共存时取最靠右者——那是为跨 backend 混装留的余量,不是本入口的情形
    const prefix = prefixes[0];
    // 已有激活的 skill token 时重复点击不再追加符号,仅保持菜单打开;校验位置防 draft 已被外部清空的陈旧状态
    if (slash && draft[slash.start] === slash.prefix) {
      taRef.current?.focus();
      return;
    }
    // 前缀只在词首激活(见 getActiveSkillToken),草稿末尾非空白时先补一个空格,否则点了不弹窗
    const base = draft && !/\s$/.test(draft) ? draft + ' ' : draft;
    composerSet({ draft: base + prefix });
    setMention(null); // 两个弹窗互斥:手动开 skill 时收掉可能残留的 @ 菜单
    setSlash({ query: '', start: base.length, prefix });
    setSlashIndex(0);
    taRef.current?.focus();
  };

  const uploadChatAttachment = useStore((s) => s.uploadChatAttachment);

  // 文件入口(文件选择器与粘贴共用):按 chat 策略校验 → 拒绝聚合成 Toast → 放行的逐个上传
  const addFiles = (files: File[]) => {
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat, attachments.length);
    // UPLOAD 是唯一在 store 存已翻译文案的错误:消息含动态文件名/限额、在拒绝时刻即时生成且仅存活 4s,故直接本地化拼好;其余错误码走 Toast 渲染期 resolveErrorMessage 兜底。
    if (rejected.length) setError({ code: 'UPLOAD', message: rejectMessage(rejected, UPLOAD_POLICY.chat, t) });
    accepted.forEach((f) => void uploadChatAttachment(f));
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许被拒后重选同名文件
    addFiles(files);
  };

  // 粘贴含文件的剪贴板(截图 / 网页复制的图片 / Finder 复制的文件)→ 当附件上传。
  // 图文混合只收文件、不插文本(避免粘进一堆 HTML 转义文本);剪贴板无文件时不拦截,原生文本粘贴照旧。
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const send = () => {
    if (attachments.some((a) => a.status === 'uploading')) return; // 上传未完成:禁止发送(覆盖回车直发路径)
    const bubbleText = applyMentionTokens(draft.trim(), assets);
    // 就绪判定:有 url(媒体/PDF)或有内联内容 text(纯文本走专用 text 接口,url 恒空)
    const ready = attachments.filter((a) => a.status === 'ready' && (a.url || a.text));
    if (!bubbleText && ready.length === 0) return; // 空内容拦截

    // 发送门控:连接未就绪(启动建连中/断线/被顶替)或 client 未创建时,命令要么被 optional
    // chaining 静默吞掉、要么进积压队列等不到冲刷——乐观气泡与计时都会成为假象。
    // 阻发并保留草稿/附件,toast 提示稍后重试;这也顺带消灭了「种子化在途冲掉乐观气泡」
    // 的竞态(种子化恒先于 connStatus 变 open,门控期不可能产生乐观气泡)。
    if (connStatus !== 'open' || !client.current) {
      useStore.getState().setWarning({ code: 'CONN_NOT_READY', message: 'Still connecting, please retry shortly' });
      return;
    }

    // 发消息驱动 agent 造游戏(steer/首发/landing 自动发送三路径合一处上报)
    track('chat_message_submit', { model: useStore.getState().selectedModel ?? undefined, project_id: projectPublicId() });
    // 回放续作首发上报(PR#129 §6,续作发起率):completeReplay 置的待报标记,匹配当前项目才消费
    const pending = useStore.getState().replayContinuePending;
    if (pending && pending.projectId === useStore.getState().currentProjectId) {
      track('replay_continue_first_message', { template_id: pending.templateId, project_id: projectPublicId() });
      useStore.setState({ replayContinuePending: null });
    }

    const mediaParts = ready.map((a) => ({ type: 'media' as const, kind: a.kind, url: a.url, name: a.name }));
    pushUserMessage({ id: newId('msg'), role: 'user', status: 'ready', parts: [...mediaParts, { type: 'text', text: bubbleText }] });

    // 发送三分路:image 走原生 image 内容块;纯文本(带 text)内联 attachment 标签(agent 直读);
    // 其余(video/audio/3d/pdf/拉取失败的纯文本)折叠 @[type]<url> token(agent 经 understand_media/工具理解)
    const koubouDraft = applyMentionTokensForSend(draft.trim(), assets);
    // 插话只能发文本 —— image 于是也折 token(`@[image]<url>` 是既有契约,画布 @提及图片同款);
    // 此前它既不在 koubouText 里(被 filter 掉)也没有 imageBlocks,气泡显示了图而 agent 什么都收不到
    const isSteer = runStatus === 'running';
    const tokenFolded = ready.filter((a) => !a.text && (isSteer || a.kind !== 'image'));
    const inlined = ready.filter((a) => a.kind !== 'image' && !!a.text);
    const koubouText = [
      [koubouDraft, ...tokenFolded.map((a) => `@[${MENTION_TYPE[a.kind]}]<${a.url}>`)].filter(Boolean).join(' '),
      ...inlined.map((a) => attachmentTag(a.name, a.text!)),
    ].filter(Boolean).join('\n\n');
    if (isSteer) {
      if (koubouText) {
        client.current?.steer(koubouText); // 仅文本可 steer;空文本(纯媒体块此轮)不空发打断
        useStore.getState().markSteerSent(koubouText);
      }
    } else {
      const imageBlocks = ready
        .filter((a) => a.kind === 'image')
        .map((a) => ({ type: 'image', source: { type: 'url', url: a.url } }));
      const content: string | ContentBlock[] = imageBlocks.length
        ? ([...(koubouText ? [{ type: 'text', text: koubouText }] : []), ...imageBlocks] as ContentBlock[])
        : koubouText;
      client.current?.sendUserMessage({ role: 'user', content });
      // 乐观计时:发出即开表,run.started 到达后由真实 turn 接管(steer 不开新轮,不置位)。
      // 同一处记下 content 供自动重试原样重发 —— 气泡文本与这份 payload 不是一回事
      useStore.getState().markPendingSend({ content });
    }
    // 首条 prompt 自动命名:项目名仍为默认占位名时才真正生效(store action 内判定),fire-and-forget
    void useStore.getState().autoNameProject(bubbleText);
    resetComposer();
  };

  // landing 经 URL prelude 进入:输入框已预填并 armed,待新项目建好且 WS 连上后自动发送一次(复用 send 路径,不另写发送)。
  // 两道前置已分别保证:① 新项目成功建立——applyStudioPrelude 仅在 createProject 成功后才 arm;
  // ② WS 已连上——此处显式等 connStatus==='open'(prelude 必新建项目 → useKoubouConnection 重连 → connecting→open),
  // 不依赖「open 前排队冲刷」乐观发送(连接最终失败时不会留下一条发不出去的消息;输入框仍保留草稿供手动重发)。
  // connStatus 变化驱动本组件重渲、effect 重判;先清 armed 再发,防 StrictMode 双挂载重发;armed 不持久化、URL 已剥参,故刷新不重放。
  useEffect(() => {
    if (!autoSendArmed) return;
    if (connStatus !== 'open' || !client.current) return;          // WS 未连上 / client 未就绪:等下次 connStatus 变化再判
    if (attachments.some((a) => a.status === 'uploading')) return; // 预填附件恒 ready,此处仅防御
    setAutoSendArmed(false);
    send();
    // send/client/attachments 在触发时点读取即可,无需进 deps;仅在 armed 置位或连接状态变化时尝试
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 自动发送只应由 armed/connStatus 驱动,纳入 send 会每渲染重跑
  }, [autoSendArmed, connStatus]);

  const uploading = attachments.some((a) => a.status === 'uploading');
  const hasReady = attachments.some((a) => a.status === 'ready');
  const canSend = !uploading && !replayActive && (draft.trim().length > 0 || hasReady);

  // relative z-10 抬高整个输入区:Skill/Mention 弹窗(bottom-full)与悬浮 PlanCard(z-0)同区重叠,弹窗须压在其上
  return (
    <div className="relative z-10 px-3 pb-3 pt-1">
      {/* Prompt Input 卡片 */}
      <div className="composer-card relative flex flex-col gap-3 rounded-[24px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-prompt)] backdrop-blur-[6px]">
        {mention && <MentionPopover query={mention.query} onPick={pickMention} />}
        {slash && <SkillPopover list={skillList} activeIndex={activeSkillIndex} onPick={pickSkill} />}
        <AttachmentBar />
        {/* 拖拽把手:向上拖增高,基准行数作 auto-grow 下限;命中区 8px,hover 显示细条(分隔条范式) */}
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('chat.composer.resize')}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          className="group -my-1 flex h-2 cursor-row-resize items-center justify-center touch-none"
        >
          <div className="h-[3px] w-8 rounded-full bg-transparent transition-colors group-hover:bg-[var(--color-line)] group-active:bg-[var(--color-primary)]" />
        </div>
        {/* 镜像层承载全部文字渲染,textarea 文字透明只留光标——两者字体/内边距/换行度量必须完全一致,任何改变文本流的样式都会导致光标错位。
            重要:textarea 加了 scrollbar-none 隐藏滚动条,镜像层不可改为有可见滚动条,否则可用宽度会不匹配导致换行错位 */}
        <div className="relative" data-testid="composer-textbox" style={{ height: boxHeight(lines) }}>
          <div
            ref={mirrorRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap [overflow-wrap:break-word] px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]"
          >
            {segments.map((seg, i) =>
              seg.kind === 'skill' ? (
                // 胶囊只做背景着色,不加水平 padding(保持逐字符对齐,设计稿 4px padding 舍弃)
                <span key={i} data-testid="skill-pill" className="rounded-[4px] bg-[var(--color-primary-soft)]">{seg.text}</span>
              ) : seg.kind === 'mention' ? (
                <span key={i} data-testid="mention-pill" className="rounded-[4px] bg-[var(--color-primary-soft)]">{seg.text}</span>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
            {'\n'}
          </div>
          <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => { onChange(e); syncMirrorScroll(); }}
          onScroll={syncMirrorScroll}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // slash 弹窗激活时,键盘先服务于弹窗导航/选中,不落到发送逻辑(IME 组合期间不拦截)
            if (slash && !isImeComposing(e)) {
              if (e.key === 'ArrowDown' && skillList.length) {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % skillList.length);
                return;
              }
              if (e.key === 'ArrowUp' && skillList.length) {
                e.preventDefault();
                setSlashIndex((i) => (i - 1 + skillList.length) % skillList.length);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && skillList.length) {
                e.preventDefault();
                pickSkill(skillList[activeSkillIndex]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setSlash(null);
                return;
              }
            }
            // 输入法(IME)组合期间的回车用于上屏候选词,不应触发发送
            if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e)) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={replayActive ? t('chat.replay.inputDisabled') : t('chat.composer.placeholder')}
          disabled={replayActive}
          className="scrollbar-none relative h-full w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] text-transparent caret-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tooltip>
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label={t('chat.composer.attach')}
                onClick={() => fileRef.current?.click()}
              >
                <FigIcon src={figAsset.plus} size={20} />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('chat.composer.referenceAsset')}>
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label={t('chat.composer.mention')}
                disabled={!canOpenMention}
                onMouseDown={(e) => {
                  e.preventDefault();
                  startMention();
                }}
              >
                {/* tone 显式随按钮文字色:与相邻的 + 同为工具列入口,恒灰会让可用的按钮看着像禁用
                    (禁用态由 IconButton 的 disabled:opacity-30 表达,不靠图标变灰) */}
                <FigIcon src={figAsset.at} size={20} tone="primary" />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('chat.composer.invokeSkill')}>
              <IconButton
                variant="bordered"
                className="h-10 rounded-[12px] px-[10px]"
                aria-label={t('chat.composer.skill')}
                disabled={!canOpenSkill}
                onMouseDown={(e) => {
                  e.preventDefault(); // 防 textarea 失焦(与 @ 同款:mouseDown 而非 click)
                  startSkill();
                }}
              >
                <FigIcon src={figAsset.code} size={20} tone="primary" />
              </IconButton>
            </Tooltip>
            <input ref={fileRef} type="file" multiple accept={acceptAttr(UPLOAD_POLICY.chat)} className="hidden" onChange={onFiles} />
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector client={client} />
            {runStatus === 'running' && !replayActive ? (
              <>
                <Tooltip>
                  <IconButton
                    variant={submitVariant(true, dark)}
                    className="size-10 rounded-[10px]"
                    aria-label={t('chat.composer.stop')}
                    onClick={() => client.current?.interrupt()}
                  >
                    {/* 方块随按钮文字色:浅色按钮→深、深色按钮→白 */}
                    <Square size={14} />
                  </IconButton>
                </Tooltip>
                {/* 回合进行中的插话入口:此前这一格被停止键独占,插话只能靠回车、界面上看不出有这功能。
                    有草稿才出现 —— 空输入时这一格只该是停止,两者始终各有各的位置,不互相顶掉 */}
                {canSend && (
                  <Tooltip>
                    <IconButton
                      variant={submitVariant(true, dark)}
                      className="size-10 rounded-[10px]"
                      /* 与「发送」分开:这一下是打断当前回合并接续,不是新开一轮 */
                      aria-label={t('chat.composer.steer')}
                      onClick={send}
                    >
                      <FigIcon src={figAsset.arrowUp} size={20} />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            ) : (
              <Tooltip>
                <IconButton
                  variant={submitVariant(canSend, dark)}
                  className={`size-10 ${canSend ? 'rounded-[10px]' : 'rounded-[12px]'}`}
                  aria-label={t('chat.composer.send')}
                  disabled={!canSend}
                  onClick={send}
                >
                  {/* 箭头随按钮文字色:可发送(深色按钮)→白,未输入(浅色按钮)→深 */}
                  <FigIcon src={figAsset.arrowUp} size={20} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
