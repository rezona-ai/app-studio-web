import type { ServerEvent } from '@/koubou/protocol';
import type { Version } from '@/store/types';
import type { FailReason } from './events';
import { mapFailReason } from './failReason';

// run 终态 → fail_reason:build.failed / 用户中断统一归 build_error;run.finished 失败帧按内嵌 error 文本映射。
// "中断"归类等最终枚举与数据侧对齐(设计稿 §10)。
export function gameFailReason(e: ServerEvent): FailReason {
  if (e.type === 'build.failed' || e.type === 'run.interrupted') return 'build_error';
  const err = e.payload.error as { type?: string; message?: string } | undefined;
  return err ? mapFailReason(err.type || err.message) : 'server_error';
}

// 刷新版本后,挑出相较刷新前新增的那个版本(game_generate_success 仅在产出新版本时上报)。
export function pickNewVersion(beforeIds: string[], after: Version[]): Version | undefined {
  const before = new Set(beforeIds);
  return after.find((v) => !before.has(v.id));
}

// generate_duration:run.started.created_at → run.finished.created_at 相减(ms);任一缺失回退 0。
export function runDurationMs(startedAt: string | null, finishedAt: string | null): number {
  if (!startedAt || !finishedAt) return 0;
  const d = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(d) && d > 0 ? d : 0;
}
