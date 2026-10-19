'use client';
import { useEffect, useRef } from 'react';
import { createKoubouClient, shouldReconnectOnWake, type KoubouClient } from '@/koubou/client';
import { resolveKoubouWsBase } from '@/koubou/wsBase';
import { useStore } from '@/store';
import { selectModelGateLocked } from '@/store/selectors';
import { gatedModel } from '@/lib/subscription/model-gate';
import { sessionSlotKey } from '@/store/session-slot';
import { sessionSnapshot } from '@/store/session-snapshot';
import { apiPath } from '@/lib/basePath';
import { koubouApi } from '@/lib/koubou/client';
import { resolveSession } from '@/lib/koubou/recoverSession';
import { connErrorToast } from '@/i18n/errors';
import { track, projectPublicId } from '@/lib/analytics';
import { gameFailReason, pickNewVersion, runDurationMs } from '@/lib/analytics/gameGenerate';

// game_generate 幂等:同一 run 的 success/fail 只报一次(§0-3)。跨重连/重放去重。
const reportedRuns = new Set<string>();
function markRunReported(runId: string | null): boolean {
  if (!runId) return true;            // 无 run_id 时不做去重(build.failed 可能缺 run_id),仍允许上报
  if (reportedRuns.has(runId)) return false;
  reportedRuns.add(runId);
  return true;
}

async function mintTicket(): Promise<string | null> {
  // 本地 Koubou 调试(NEXT_PUBLIC_KOUBOU_BASE_URL):本地服务跑 mock 鉴权,ws-ticket 端点
  // 仅在 pgc_bearer 模式启用(否则 404),WS 也不校验 ticket → 跳过签票免票直连
  if (process.env.NEXT_PUBLIC_KOUBOU_BASE_URL) return null;
  // 超时 signal:休眠切断 TCP 后在途 fetch 可能永久悬挂(不 resolve 不 reject),卡死 connecting;
  // 唤醒后冻结的超时定时器立即触发 → reject → 落入 ticketFails 退避重连
  const res = await fetch(apiPath('/api/koubou/auth/ws-ticket'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'include', signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`ws-ticket 请求失败: HTTP ${res.status}`);
  const env = (await res.json()) as { data?: { ticket?: string } };
  const ticket = env.data?.ticket;
  if (!ticket) throw new Error('ws-ticket 签发失败');
  return ticket;
}

export function useKoubouConnection() {
  const clientRef = useRef<KoubouClient | null>(null);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const replayActive = useStore((s) => s.replay != null);   // 回放期不自动连(见下 effect 早退出)

  useEffect(() => {
    if (currentProjectId == null) { clientRef.current?.close(); clientRef.current = null; return; }
    // 回放期:播放器独占会话生命周期,不自动建连/种子(否则剧透结局 + 续接被种子冲掉)。
    // replay 置 null(completeReplay)时 deps 变化,effect 重跑,走下方正常/续接分支
    if (replayActive) { clientRef.current?.close(); clientRef.current = null; return; }
    const pid = currentProjectId;
    // 载入该项目会话快照(供恢复/续传)
    useStore.getState().switchProjectSession(pid);

    const pgcBaseUrl = process.env.NEXT_PUBLIC_PGC_BASE_URL;
    if (!pgcBaseUrl) { console.error('[Koubou] NEXT_PUBLIC_PGC_BASE_URL 未配置'); return; }
    // 网关下 Koubou WS 挂 /game/koubou 前缀;本地调试设 NEXT_PUBLIC_KOUBOU_BASE_URL 直连(免前缀)。
    // 本地开发(dev 构建)经本服务 WS 代理打通 LB 会话亲和(直连跨站丢 SameSite cookie,见 ws-proxy 设计稿)。
    // buildWsUrl 再在其后拼 /projects/{id}/ws
    const devProxyOrigin = process.env.NODE_ENV === 'development' ? window.location.origin : null;
    const wsBaseUrl = resolveKoubouWsBase(process.env.NEXT_PUBLIC_KOUBOU_BASE_URL, pgcBaseUrl, devProxyOrigin);

    // 唤醒/网络恢复时:若连接停滞则重连(治断网久了、ticket 耗尽后不自愈;半开由 client 内看门狗兜底)。
    // 读实时 connStatus 决策,fatal/superseded 不重连(见 shouldReconnectOnWake)。
    const onWake = () => { if (shouldReconnectOnWake(useStore.getState().connStatus)) clientRef.current?.reconnect(); };
    const onVisible = () => { if (document.visibilityState === 'visible') onWake(); };
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onVisible);

    // 异步恢复:本地无 sessionId(如清空 localStorage)时查后端取最近一条,避免新建丢历史。
    // aborted 守卫防 await 期间切项目/卸载用旧会话误建连。
    let aborted = false;
    void (async () => {
      // 续接握手:回放刚结束(completeReplay 置 handoff)。pin clone session + afterSequence 增量续传,
      // 跳过 resolveSession(不猜最新)与 50 种子(seedHistory 会整体重建冲掉完整回放消息)。
      // 仅当 handoff.projectId 与本 effect 的 pid 一致才消费——防用户切项目后,
      // 另一项目的连接误用别的项目的 handoff(pin 错会话);不匹配时保留 handoff,留给它自己项目的连接消费
      const handoff = useStore.getState().replayHandoff;
      let sessionId: string | null;
      let afterSequence: number | null;
      if (handoff && handoff.projectId === pid) {
        sessionId = handoff.sessionId;
        afterSequence = handoff.afterSequence;
        useStore.setState({ replayHandoff: null });   // 消费一次(与本文件既有 setState 快照落盘同范式)
      } else {
        const { sessionId: localSid, lastSequence } = useStore.getState();
        // backend 传入:只恢复同 backend 的会话(建会话时固定,attach 改不了),
        // 目标 backend 无会话则新建 —— 避免用错渲染器
        const resolved = await resolveSession(
          { sessionId: localSid, lastSequence },
          () => koubouApi.listSessions(pid),
          useStore.getState().agentBackend,
        );
        if (aborted) return;
        sessionId = resolved.sessionId;
        afterSequence = resolved.afterSequence;
        // 建连前经 REST events 端点拉最新 50 条种子化历史,WS 只续传增量;
        // 失败回退原逻辑(afterSequence 续传 / session.ready visible_state 重建),不劣于现状
        if (sessionId) {
          try {
            // limit=100 为实测后端上限(101 起 422);事件里 SystemMessage 噪声占大半,窗口开满减少冷启动补页
            const page = await koubouApi.listEvents(pid, sessionId, { limit: 100 });
            if (aborted) return;
            useStore.getState().seedKoubouHistory(page);
            // 种子化的历史帧不走 onEvent,断连窗口内就绪的 media 帧在此补导(幂等靠去重表);task 帧不补注册(死任务)
            for (const ev of page.events) useStore.getState().importMediaFromEvent(ev);
            afterSequence = page.events.length ? page.latest_sequence : null;
          } catch { /* 回退 */ }
        }
      }
      // 既有缺陷(非本需求引入):上面 catch 吞掉 listEvents 失败后,原先直接落到建连 ——
      // 若此间用户已切项目,会为旧 pid 建出一个 clientRef 管不到、永不关闭的 client,
      // 它的 ready 会一直往新项目身上写。成功路径在 catch 前已有 aborted 守卫,失败路径缺这一道
      if (aborted) return;
      // 本 client 实例已见 ready 计数:首个 ready 是初连(REST 种子刚对齐,无缺口);
      // 之后的 ready 都是重连——后端 WS 建连不重放历史事件,断线窗口内的事件要靠 REST 回填
      let readyCount = 0;
      // 本连接经 WS 收到 run.started 的 run 集合:这些 run 的事件由后端正常投递本连接,
      // REST 跟跑豁免之;连接重建即闭包新生清零(旧连接的 run 正是要跟跑的对象)
      const wsRunIds = new Set<string>();
      // 先声明再赋值:onEvent 是下面这次调用的初始化表达式的一部分,回调里直接引用 `client`
      // 会落在 TDZ 内。真实 WS 不可能在构造期同步派发(connect() 先 await mintTicket),
      // 但 factory 是测试注入的 DI 缝 —— 构造时同步 emit 的 fake 会抛 ReferenceError
      let koubouClient: KoubouClient | null = null;
      koubouClient = createKoubouClient({
        wsBaseUrl,
        projectId: String(pid),
        sessionId,
        afterSequence,
        // 建连时读取当前选中模型(不进 effect deps,避免默认解析时抖动重连)。
        // **仅当该模型确属当前 backend 才带**:列表尚未拉到 / 刚切 backend 时,持久化的
        // selectedModel 可能属另一 backend,带上会被服务端 `invalid model` + 4400 关闭
        // (fatal 不重连,dev 实测)。不带则由服务端用该 backend 默认模型,ready.model 回填 UI
        // 门禁兜底:新用户锁定态下恒用 Rez1 —— 归位 effect 可能还没跑完就建连(spec 2026-08-28)
        model: gatedModel(
          useStore.getState().modelBackend === useStore.getState().agentBackend
            ? useStore.getState().selectedModel
            : null,
          selectModelGateLocked(useStore.getState()),
        ),
        // 新建会话用开关值固定 backend;attach 路径 buildWsUrl 自动不带该参数
        backend: useStore.getState().agentBackend,
        mintTicket,
        onEvent: (e) => {
          // 在 ingest 前捕获 activeRunId:finishRun 会清空它,缺 run_id 时用它兜底幂等
          const activeRunIdBefore = useStore.getState().activeRunId;
          useStore.getState().ingestKoubou(e);
          // 任何带 run_id 的帧都算「WS 在投递该 run」:单进程部署下刷新后 attach 会接管
          // 进行中 run 的后续帧(run.started 已发给旧连接,新连接首见的是 claude.message),
          // REST 跟跑循环据此自动退位,避免与 live 流式双路重复拉取
          if (e.run_id) wsRunIds.add(e.run_id);
          if (e.type === 'run.started') {
            const rid = (e.payload as { run_id?: string }).run_id ?? e.run_id;
            if (rid) wsRunIds.add(rid);
          }
          if (e.type === 'session.ready') {
            // 投递权按 attach 归属:每次重连都重新抽 Pod,上一条 socket 收过帧不代表这条也收得到。
            // 先清豁免集再触发跟跑,「WS 在投该 run」须由本次 attach 之后真实到帧重新证明,
            // 否则旧 socket 的事实会豁免新 socket,重连抽歪后跟跑被误跳过、帧再次断流无人兜底
            wsRunIds.clear();
            // 会话落库模型 → 选择器(spec 2026-09-11):ready 是「这个会话在用哪个模型」的权威
            // (payload.model = 会话 override 或 provider 默认,见 koubou actor.py 的 _effective_model)。
            // 判定与落库都在 store;这里只负责它回报的补救动作 —— 会话模型已下架时切到列表首项。
            // **必须发帧**:attach 路径的 ?model= 后端根本不读(koubou api/websocket.py 只有 create
            // 读它),靠建连参数纠正在世会话是无效的,已骗过一轮修复
            {
              const p = e.payload as { model?: string | null; available_models?: string[] };
              // 传闭包 pid 而非读实时 currentProjectId:本回调与项目绑定,action 内据此丢弃过期 ready
              const nextModel = useStore.getState().syncSessionModel(pid, p.model, p.available_models);
              if (nextModel) koubouClient?.setModel(nextModel);
            }
            // 重连(非首个 ready)后回填断线窗口的事件缺口(action 内自带幂等/回放期跳过/上下文校验)
            if (readyCount++ > 0) void useStore.getState().backfillSessionGap();
            // 进行中 run 的 REST 跟跑(spec 2026-07-23):后端 run 事件只投递给发起命令的连接,
            // 且新连接的 ready.active_run 恒 null 不可信——每个 ready 后都按 REST 权威核对,
            // 存在非本连接发起的活跃 run 即轮询追回(action 内自带重入/上下文守卫)
            void useStore.getState().trackActiveRunViaRest((id) => wsRunIds.has(id));
          }
          // 实时资产副作用只在此触发:历史(localStorage 快照 / REST /events 分页)不走 onEvent,天然惰性
          useStore.getState().importFromLiveEvent(e);
          const st = useStore.getState();
          // 仅在可重放检查点(非空 sequence)持久化:保证 lastSequence ↔ messages 一致,流式增量(sequence=null)不落盘
          if (typeof e.sequence === 'number' && st.sessionId) {
            useStore.setState({
              koubouByProject: { ...st.koubouByProject, [sessionSlotKey(pid, st.backend)]: sessionSnapshot(st, st.sessionId) },
            });
          }
          // checkpoint.created = 新版本已就绪的权威信号(可回放):构建与 run 状态各自独立,
          // 且 build.failed 之后仍可能收到 run.finished(succeeded) —— 故版本/画布刷新不只挂在 run 终态。
          // 与下方 run.finished 的刷新并存(两者都幂等,先到者生效)
          if (e.type === 'checkpoint.created') {
            void useStore.getState().loadVersions().catch(() => {});
            void useStore.getState().loadCanvas().catch(() => {});
          }
          // run 终态:成功刷新画布/版本并按"是否产出新版本"上报 game_generate_success;失败/中断/构建失败上报 game_generate_fail
          if (e.type === 'run.finished' || e.type === 'run.interrupted' || e.type === 'build.failed') {
            const s0 = useStore.getState();
            const pid = s0.currentProjectId; // 触发时项目(ingestKoubou 不改 currentProjectId,可直接取)
            const runId = ((e.payload as { run_id?: string }).run_id) ?? e.run_id ?? activeRunIdBefore ?? null;
            const succeeded = e.type === 'run.finished' && (e.payload as { status?: string }).status === 'succeeded';
            // 对话侧消耗的唯一漏斗:run 落终态即结算完毕。失败/中断的 run 同样已扣费(跑过的 LLM 调用不退),故不分支。
            // terminal:这是「一次生成真的结束了」,低余额升购弹窗只在这类刷新上弹(见 actions.refreshBalance)
            void useStore.getState().refreshBalance({ terminal: true });
            if (succeeded) {
              void useStore.getState().loadCanvas().catch(() => {});
              const beforeIds = useStore.getState().versions.map((v) => v.id);
              void useStore.getState().loadVersions()
                .then(() => {
                  // await 后校验上下文:切项目则丢弃过期回调,防误报到新项目头上
                  if (useStore.getState().currentProjectId !== pid) return;
                  const fresh = pickNewVersion(beforeIds, useStore.getState().versions);
                  if (!fresh) return;   // 仅答疑/改画布未出新版本:不上报(设计稿 §4.1)
                  if (!markRunReported(runId)) return;
                  const turn = useStore.getState().turns.find((t) => t.runId === runId);
                  track('game_generate_success', {
                    version_id: fresh.id, version: fresh.index,
                    game_id: projectPublicId(), project_id: projectPublicId(),
                    generate_duration: runDurationMs(turn?.startedAt ?? null, turn?.finishedAt ?? e.created_at ?? null),
                  });
                })
                .catch(() => {});
            } else if (markRunReported(runId)) {
              track('game_generate_fail', { fail_reason: gameFailReason(e), game_id: projectPublicId(), project_id: projectPublicId() });
            }
          }
        },
        onStatus: (s) => {
          useStore.getState().setConn(s);
          // 传输层 fatal/superseded 给一条通用提示(不暴露真实关闭码/reason)
          const toast = connErrorToast(s);
          if (toast) {
            const { kind, ...msg } = toast;
            (kind === 'warning' ? useStore.getState().setWarning : useStore.getState().setError)(msg);
          }
        },
      });
      clientRef.current = koubouClient;
    })();

    return () => {
      aborted = true;
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onVisible);
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [currentProjectId, replayActive]);

  return clientRef;
}
