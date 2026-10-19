'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { retryDelayMs, AUTO_RETRY_CONTINUE, autoRetryPrompt } from '@/lib/agent-retry';
import type { KoubouClient } from '@/koubou/client';

// 重试发出后 run 仍不开跑的兜底窗口。与 markPendingSend 的乐观计时同口径,但**不能复用它** ——
// 那条路径会置 pendingSendAt 并在超时时清重试态,等于重试一发出就把自己的状态清了。
const RUN_START_TIMEOUT_MS = 45_000;

// 应用层自动重试的执行侧(设计稿 2026-08-25)。判定全在 reducer(failAgentTurn),这里只做三件事:
// 等满退避、连接可用才发、发出后盯着 run 有没有真开跑。
//
// 为什么必须是 hook:client 实例是 useKoubouConnection 的 ref,store 与 reducer 都够不着。
// 与**传输层**重连划清:这里不调 reconnect(),断连只挂起等它自己恢复;命令也不走 client 的积压
// 队列 —— 那条队列的重放语义是「原 event_id 冲刷」,而重试要的恰恰是新 event_id。
export function useAgentRetry(client: React.RefObject<KoubouClient | null>) {
  const retry = useStore((s) => s.agentRetry);
  const connStatus = useStore((s) => s.connStatus);
  const runStatus = useStore((s) => s.runStatus);
  const attempt = retry?.attempt ?? 0;
  const phase = retry?.phase ?? null;

  useEffect(() => {
    if (!phase) return;

    // 后端已受理这次自愈(run 起来了):执行侧就此撒手,剩下的 agentRetry 只是给「再失败」用的计数。
    // **必须在致命态收口之前返回** —— 此刻 agent 正在答,拿上一次的失败原因去落气泡是陈年错误;
    // 也别掉进下面的 fire 分支,那里会 scheduleAgentRetry 把 phase 又拨回 waiting。
    //
    // 撒手的只是「排期与发送」,不是不变式:回合一旦不在跑,这份计数就再无消费者(唯一消费者是
    // 「这轮跑着的时候再失败」,而那条路径由 failAgentTurn 先把 phase 拨回 waiting,不会走到这里),
    // 必须清掉 —— 否则弱网下「run 起来了 → 断线 → 重连时后端已无 active run」会让终态帧永不到达,
    // agentRetry 永久非 null,而手动重试按钮的判据含它:进度气泡不渲染、手动入口也一并消失
    if (phase === 'responded') {
      if (runStatus !== 'running') useStore.setState({ agentRetry: null });
      return;
    }

    // 这两态不会自动恢复,继续等只会让进度气泡永远挂着
    if (connStatus === 'fatal' || connStatus === 'superseded') {
      useStore.getState().cancelAgentRetry();
      return;
    }

    if (phase === 'running') {
      // 发出去了但 run 始终没开跑(命令在后端丢失 / 连接实际已死):按本次失败推进,
      // 不然进度会永远停在「重试中 n/10」
      const timer = setTimeout(() => {
        const s = useStore.getState();
        if (s.agentRetry?.phase !== 'running' || s.runStatus === 'running') return;
        s.failAgentRetry({ code: 'SEND_TIMEOUT', fallback: 'No response from the agent' });
      }, RUN_START_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }

    const fire = () => {
      const s = useStore.getState();
      const r = s.agentRetry;
      if (!r || r.phase !== 'waiting') return;
      // resend 需要原 payload;拿不到(理论上 reducer 已挡)就别硬发,落正式错误
      if (r.mode === 'resend' && !s.lastSend) { s.cancelAgentRetry(); return; }
      // continue 固定英文:它是发给 agent 的指令,不是给人看的文案。
      // 两种模式都不推本地气泡,却都会真实进入后端事件日志(agent 侧要看得见这句话)——
      // 故都带上不可见哨兵前缀,历史重建与回放据此滤掉:自愈不在对话里留下 continue 气泡,
      // 也不让用户原话因为重发而在历史里出现第二遍
      const content = r.mode === 'continue' ? AUTO_RETRY_CONTINUE : autoRetryPrompt(s.lastSend!.content);
      s.startAgentRetry();
      client.current?.sendUserMessage({ role: 'user', content });
    };

    // 到点时刻先记下再判连接:退避在断连期间照样流逝,恢复时若已过点就立即补发,
    // 不让用户为一次断线多等一轮退避
    const at = retry?.nextAt ?? Date.now() + retryDelayMs(attempt - 1);
    if (retry?.nextAt == null) useStore.getState().scheduleAgentRetry(at);

    // 断连期只挂起:不空转,也不把命令丢进 client 的积压队列。connStatus 变化会让本 effect 重跑
    if (connStatus !== 'open') return;

    // 旧 run 还没关也挂起。**这一条不能省**:`error` 事件不关轮(onError 不调 finishRun),
    // 真正关轮要等随后那条 run.finished,而两者间隔无上界 —— 后端发完 error 还会继续 drain
    // 流,finally 里另有 credit reconcile / runs.finish / release_active_run 等数段 await。
    // 首档退避只有 1s,贸然发出会撞后端 start_run 的「run already active」门,自愈第一次就死,
    // 且用户看到的报错还指错方向(那条文案不在白名单 → 直接 giveUp)。
    if (runStatus === 'running') return;

    const wait = at - Date.now();
    if (wait <= 0) { fire(); return; }
    const timer = setTimeout(fire, wait);
    return () => clearTimeout(timer);
    // 只由「第几次 / 什么阶段 / 连接状态 / 回合是否在跑」驱动:client 是稳定 ref;nextAt 由本 effect 自己写回(仅供 UI 倒计时),纳入依赖会自触发一次多余的重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 理由见上
  }, [attempt, phase, connStatus, runStatus]);
}
