'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { sessionSlotKey } from '@/store/session-slot';
import { sessionSnapshot } from '@/store/session-snapshot';
import { koubouApi } from '@/lib/koubou/client';
import type { ServerEvent } from '@/koubou/protocol';

// 节奏:两帧 created_at 差值(ms),夹到 [floor, cap];负/零取 floor;cap 防源里的分钟级生成等待卡住回放
const PACE_FLOOR_MS = 200;
const PACE_CAP_MS = 8000;
const PAGE_LIMIT = 100;
const PAGE_GUARD = 1000;   // 翻页上限兜底,防病态 has_more 死循环

function paceDelay(events: ServerEvent[], i: number): number {
  if (i <= 0) return PACE_FLOOR_MS;
  const prev = Date.parse(events[i - 1].created_at ?? '');
  const cur = Date.parse(events[i].created_at ?? '');
  const d = cur - prev;
  if (!Number.isFinite(d) || d <= 0) return PACE_FLOOR_MS;
  return Math.min(PACE_CAP_MS, Math.max(PACE_FLOOR_MS, d));
}

// 全量正向翻页(after_sequence),skip 补拉用;playing 路径改为逐页流式(见下),不再等全量。
// startAfter:断点续播起点(已播部分不重拉)。终止:!has_more 或空页或无进展(防死循环)
async function fetchAllEvents(pid: number, sid: string, startAfter: number): Promise<ServerEvent[]> {
  const all: ServerEvent[] = [];
  let after = startAfter;
  for (let guard = 0; guard < PAGE_GUARD; guard++) {
    const page = await koubouApi.listEvents(pid, sid, { limit: PAGE_LIMIT, afterSequence: after });
    all.push(...page.events);
    if (!page.events.length || !page.has_more) break;
    const maxSeq = page.newest_sequence ?? Math.max(...page.events.map((e) => e.sequence ?? 0));
    if (maxSeq <= after) break;   // 无进展兜底
    after = maxSeq;
  }
  return all;
}

// 按 sequence 升序排(后端已升序,仍显式排序:同毫秒 tool_use→tool_result 靠 sequence 才配对)
function sortBySequence(events: ServerEvent[]): ServerEvent[] {
  return [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

// 回放播放器:phase=playing 逐页拉取、首页到达即开播(不等全量),后续页边拉边追加进队列;
// phase=skipping 立即 flush 剩余。队列存 ref(可能上千条,不进 store);store 只持 total/cursor 摘要。
// 改速在下一跳生效(scheduleNext 每次 fire 时才读最新 speed 算 delay,不影响本跳已排定的 setTimeout)。
export function useReplayPlayer(): void {
  const phase = useStore((s) => s.replay?.phase ?? null);
  const projectId = useStore((s) => s.replay?.projectId ?? null);
  const sessionId = useStore((s) => s.replay?.sessionId ?? null);
  const queueRef = useRef<ServerEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 队列是否已被本 session 的拉取**完整**填充过(流式播放中途为 false)。playing 的拉取若在 skip
  // 打断后才 resolve 会被 cancelled 挡掉、永远不会置真——skip 分支据此判断是否需要自己补拉全量,
  // 防止 flush 空/半截/陈旧队列(spec §5:skip 终态==看完全程终态)
  const queueLoadedRef = useRef(false);

  // 一帧派发:reducer + 素材副作用 + 推进游标 + 检查点。
  // user.message 走回放专用入口成用户气泡——live reducer 无此分支(live 由 Composer 乐观渲染),
  // 直接灌 ingestKoubou 会被 default 吞掉,回放里用户消息就消失了
  const dispatchAt = (i: number) => {
    const e = queueRef.current[i];
    if (!e) return;
    // AskUserQuestion 的回答只记录在 answered 帧(payload.answers),事件流里没有对应 user.message;
    // 回放不弹问题卡,故在此把当时的选择合成用户气泡(镜像 live 里 QuestionCard 的乐观插入)。
    // 须在 ingestKoubou 之前取 pending(reducer 会顺手清掉它),问题定义用于还原「标题:选项」排版;
    // 断点恢复恰好落在 requested 与 answered 之间时 pending 不在(不持久化),退化为按 answers 键值拼装
    if (e.type === 'ask_user_question.answered') useStore.getState().ingestReplayQuestionAnswer(e);
    else if (e.type === 'user.message') useStore.getState().ingestReplayUserMessage(e);
    else useStore.getState().ingestKoubou(e);
    useStore.getState().importMediaFromEvent(e);
    useStore.getState().setReplayCursor(i + 1, e.created_at ?? null);
    // 断点续播检查点(与 live onEvent 同构,spec 2026-07-14):非空 sequence 才落盘,保证 lastSequence ↔ messages
    // 一致;persist 层对象级节流,逐帧写安全。刷新/切项目后由 selectProject/enterReplay 据此快照续播
    const st = useStore.getState();
    const r = st.replay;
    if (typeof e.sequence === 'number' && r?.projectId != null && r.sessionId) {
      useStore.setState({
        koubouByProject: { ...st.koubouByProject, [sessionSlotKey(r.projectId, st.backend)]: sessionSnapshot(st, r.sessionId) },
      });
    }
  };

  // playing:逐页拉取,首页到达即开始逐跳调度;播放追上拉取(队列暂时耗尽)时停表等新页唤醒,
  // 全部页拉完且游标走完才 completeReplay。cancelled 守卫防 await/定时器跨 phase 残留
  useEffect(() => {
    if (phase !== 'playing' || projectId == null || !sessionId) return;
    let cancelled = false;
    let fetching = true;   // 在途拉取标记:区分「队列暂时耗尽(等新页)」与「真播完」
    const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; } };

    const scheduleNext = () => {
      const i = useStore.getState().replay?.cursor ?? 0;
      const q = queueRef.current;
      if (i >= q.length) {
        // 队列暂时吃空:拉取还在途则不排跳,由下一页到达时唤醒续播;拉完了才是真播完
        if (!fetching) useStore.getState().completeReplay();
        return;
      }
      const speed = useStore.getState().replay?.speed ?? 1;
      const delay = paceDelay(q, i) / speed;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;   // 先置空:唤醒判据是「无在途定时器」,派发耗尽后新页才可能接管调度
        if (cancelled) return;
        dispatchAt(i);
        scheduleNext();
      }, delay);
    };

    // 同步先清:防止上一场回放(同一挂载生命周期内切了会话)留在 ref 里的队列被误当成本场数据
    queueRef.current = [];
    queueLoadedRef.current = false;

    void (async () => {
      try {
        // 断点续播:从恢复坐标之后增量拉取(与 live 重连 afterSequence 同语义),已播部分不重拉不重播
        let after = useStore.getState().replay?.resumeAfterSequence ?? 0;
        const startAfter = after;
        for (let guard = 0; guard < PAGE_GUARD; guard++) {
          const page = await koubouApi.listEvents(projectId, sessionId, { limit: PAGE_LIMIT, afterSequence: after });
          if (cancelled) return;
          // 页内排序后整页追加:after_sequence 翻页保证新页 sequence 全大于已入队部分,不会乱序到游标之前
          queueRef.current = [...queueRef.current, ...sortBySequence(page.events)];
          // 初次进入总量直接取会话 latest_sequence 估算(事件 sequence 稠密自增,Meegle 13559715):
          // 首页即得全量分母,不随翻页增长导致进度条回跳;以已入队条数兜底防估算偏小
          useStore.getState().setReplayTotal(Math.max((page.latest_sequence ?? 0) - startAfter, queueRef.current.length));
          // 首页到达即开播;播放追上拉取停表等待时,也由新页在此唤醒(无在途定时器 == 没人在调度)
          if (timerRef.current == null) scheduleNext();
          if (!page.events.length || !page.has_more) break;
          const maxSeq = page.newest_sequence ?? Math.max(...page.events.map((e) => e.sequence ?? 0));
          if (maxSeq <= after) break;   // 无进展兜底
          after = maxSeq;
        }
        fetching = false;
        queueLoadedRef.current = true;
        // 拉取完成后以实际条数校准:sequence 存在空洞时上面的估算偏大,不校准进度永远到不了满格
        useStore.getState().setReplayTotal(queueRef.current.length);
        // 拉完时游标可能已吃空队列在等待(无在途定时器):补触发一次,让上面的分支走 completeReplay
        if (timerRef.current == null) scheduleNext();
      } catch {
        // 拉取失败(网络/后端错误):置 error 态 + toast,不再往下走(不 flush、不 completeReplay)。
        // cancelled 才是"这场回放已不相关"——已 cancelled 说明用户已 skip/切走,不该再报错打扰
        if (cancelled) return;
        useStore.getState().failReplay('REPLAY_LOAD_FAILED');
      }
    })();

    return () => { cancelled = true; clearTimer(); };
  }, [phase, projectId, sessionId]);

  // skipping:清定时器。若队列还没被(本 session 的)拉取**完整**填充过——流式播放中途 skip,或
  // 用户在首页 resolve 前就 skip,上面 effect 的 cleanup 会把它后续页挡在 cancelled 里——
  // 这里自己补拉一次全量(GET 幂等,补拉不违反契约)再 flush;已加载则直接同步 flush,不重拉。
  // 两条路径终态都等于看完全程终态(spec §5)
  useEffect(() => {
    if (phase !== 'skipping') return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    if (queueLoadedRef.current) {
      const q = queueRef.current;
      for (let i = useStore.getState().replay?.cursor ?? 0; i < q.length; i++) dispatchAt(i);
      useStore.getState().completeReplay();
      return;
    }

    let cancelled = false;
    void (async () => {
      if (projectId != null && sessionId) {
        let events: ServerEvent[];
        try {
          events = await fetchAllEvents(projectId, sessionId, useStore.getState().replay?.resumeAfterSequence ?? 0);
        } catch {
          // 同上:补拉失败 → error 态 + toast,不 flush 空/半截队列、不 completeReplay
          if (cancelled) return;
          useStore.getState().failReplay('REPLAY_LOAD_FAILED');
          return;
        }
        if (cancelled) return;
        queueRef.current = sortBySequence(events);
        queueLoadedRef.current = true;
        useStore.getState().setReplayTotal(queueRef.current.length);
      }
      if (cancelled) return;
      const q = queueRef.current;
      for (let i = useStore.getState().replay?.cursor ?? 0; i < q.length; i++) dispatchAt(i);
      useStore.getState().completeReplay();
    })();

    return () => { cancelled = true; };
  }, [phase, projectId, sessionId]);
}
