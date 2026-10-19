import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { PersistedSession } from './types';
import type { SubagentState } from '@/lib/subagent-tasks';

// 每项目持久化会话历史的条数上限。
// localStorage 里的会话历史只是「重连前的快速回显缓存」——真相在服务端:重连时经 REST
// /events 重新种子化最新一页(useKoubouConnection),向上翻页再补齐。因此每个项目只持久化
// 最近若干条,避免长会话把 koubouByProject 撑爆 localStorage 配额,也压小每次序列化的开销。
export const PERSIST_MAX_MESSAGES = 100;
export const PERSIST_MAX_TURNS = 60;
// 子代理卡片同理只留最近若干张:卡片按 run 存活,更早的 run 早已不在可见轮次里
export const PERSIST_MAX_SUBAGENT_CARDS = 40;

// 逐项目裁剪待持久化的会话:仅保留尾部最近 N 条 messages / turns(最新的)。
// 纯函数;未超限的会话按同一引用透传(零拷贝),超限的浅拷贝后切尾。
export function capPersistedSessions(
  byProject: Record<string, PersistedSession>,
): Record<string, PersistedSession> {
  const out: Record<string, PersistedSession> = {};
  for (const [pid, session] of Object.entries(byProject)) {
    // 老持久化结构可能缺 turns(甚至 messages),旧数据仍在真实用户 localStorage 里,
    // 不能在 partialize 里抛错(否则整次持久化写入失败)。缺失即视为空、按未超限透传原样。
    const messages = session.messages ?? [];
    const turns = session.turns ?? [];
    const subagents = capSubagents(session.subagents);
    const overflowed = messages.length > PERSIST_MAX_MESSAGES || turns.length > PERSIST_MAX_TURNS;
    out[pid] = overflowed || subagents !== session.subagents
      ? {
        ...session,
        ...(overflowed ? { messages: messages.slice(-PERSIST_MAX_MESSAGES), turns: turns.slice(-PERSIST_MAX_TURNS) } : {}),
        ...(subagents ? { subagents } : {}),
      }
      : session;
  }
  return out;
}

// 子代理卡片的落盘裁剪:只做切尾。
// live-only 字段(lastToolName)的剥离在**写快照时**做(见 session-snapshot.ts)——
// partialize 每次 set() 都跑,流式期每 token 一次,在这里剥会让「未超限即同引用」的
// 零拷贝承诺在整个活跃回合里静默失效。
// 无需改动时返回原引用,让上层的零拷贝透传继续成立。
function capSubagents(st: SubagentState | undefined): SubagentState | undefined {
  if (!st) return st;
  const cards = st.cards ?? [];
  if (cards.length <= PERSIST_MAX_SUBAGENT_CARDS) return st;
  return { ...st, cards: cards.slice(-PERSIST_MAX_SUBAGENT_CARDS) };
}

// 对象级节流持久化存储:zustand persist 的 storage 直连实现(不经 createJSONStorage)。
//
// 动机:koubou 流式期间 store 的 set() 每秒触发多次(ingestKoubou 对每个事件——含无 sequence
// 的流式增量——都 set 一次)。若走 createJSONStorage,persist 中间件会在「每一次」set() 时把
// 整棵持久化树(koubouByProject = 所有项目的完整对话历史)先 JSON.stringify 再交给底层 storage:
// 就算写盘被节流,序列化本身仍在每个流式 token 同步执行,产出字节相同的大字符串又被丢弃——
// 白白阻塞主线程 + 制造 GC 压力,恰在最需要流畅的流式期(审计 D1;更早还引发过
// SBOX_FATAL_MEMORY_EXCEEDED 页面崩溃)。
// 本实现的 setItem 直接收 StorageValue「对象」暂存(状态是不可变快照,延迟序列化安全),
// 每 delayMs 至多 stringify + 写盘一次;pagehide / 切后台(visibilitychange=hidden)立即 flush,
// 保证最新快照在关闭/刷新/被系统回收前落盘。
export function createThrottledPersistStorage<T>(
  getStore: () => Storage | undefined,
  delayMs = 1000,
): PersistStorage<T> {
  // 每个 key 只保留最新一次待写对象:合并窗口内的所有中间写(最终只有最新那份有意义)。
  const pending = new Map<string, StorageValue<T>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const store = getStore();
    if (store) {
      for (const [key, value] of pending) {
        try {
          store.setItem(key, JSON.stringify(value));
        } catch {
          // localStorage 写满(QuotaExceeded)或被禁用:跳过持久化即可,内存状态不受影响
        }
      }
    }
    pending.clear();
  };

  if (typeof window !== 'undefined') {
    // pagehide 覆盖关闭标签 / 前进后退缓存;visibilitychange=hidden 覆盖切后台(移动端随后可能被系统回收)
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    // 读直接透传底层并解析:zustand 仅在 hydration(建 store 时)读一次,早于任何写,故不受待写队列影响
    getItem: (name) => {
      const raw = getStore()?.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<T>;
      } catch {
        return null; // 损坏快照按无缓存处理(服务端才是历史真相)
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      if (timer === null) timer = setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      pending.delete(name); // 取消该 key 的待写,避免删除后又被尾随写入写回
      try {
        getStore()?.removeItem(name);
      } catch {
        // 忽略:同 setItem,存储不可用时无需报错
      }
    },
  };
}
