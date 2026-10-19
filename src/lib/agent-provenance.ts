// agent 生成资产的溯源:按 pgc 任务 id 回溯 koubou 工具入参,原样包成 AssetProvenance 落库
// (spec 2026-08-06-agent-asset-provenance)。
//
// 原先还有读侧的模型别名归一(provenanceReq),只服务画布的属性面板与「修改后重试」预填表单,
// 随画布界面退役删除;写侧不翻译(约束 4),AssetProvenance.agent 仍作口径判别器随 reference 落库。
import type { AssetProvenance, Message } from '@/store/types';
import type { AssetKind } from '@/lib/asset-kind';
import { submitInputForTask } from './gen-lineage';

/**
 * 按 pgc 任务 id 回溯该次生成的工具入参,**原样**包成溯源(约束 4:写侧不翻译)。
 *
 * 与血缘归因共用 submitInputForTask 定位同一个 tool part —— 两者必须指向同一次调用,
 * 否则会出现「血缘连到 A 次生成、参数显示 B 次生成」。
 *
 * `kind` 由调用方按 GenTask 口径给定,不从工具名反猜(koubou 的工具名 model3d 与前端的 '3d' 不同名);
 * `at` 同理由调用方给:它记的是**导入 / 登记时刻**。后端 canvas item 现在有 created_at 了
 * (建卡时间),但两者口径不同、不可互相顶替 —— 最能说明的是**异步登记**那条路径
 * (registerAgentGenTask):`at` 是任务**提交登记**时刻,此时后端还没有 item;
 * 卡要等 adoptAgentItem 认领时后端才建,`created_at` 已是**一整个生成周期之后**
 * (video / 3D 动辄数分钟)。同步导入那条差得少(只差一个 RTT),但同样不是同一个事件。
 * 定位不到 / 入参形状不合契约 → undefined,调用方据此不写溯源(而不是写个空 req 骗人)
 */
export function agentProvenance(
  messages: readonly Message[],
  taskId: string,
  kind: AssetProvenance['kind'],
  at: string,
): AssetProvenance | undefined {
  const req = submitInputForTask(messages, taskId);
  return req ? { kind, req, at, agent: true } : undefined;
}

// AssetKind → 溯源类别。text / doc 没有生成参数可言(agent 自建文本节点、上传的文档),返回 undefined。
// 与 map.ts 的 isProvenanceKind 分工不同:那个校验落库脏数据(unknown → kind),这个收窄前端已知的 AssetKind
export const provenanceKindOf = (kind: AssetKind): AssetProvenance['kind'] | undefined =>
  kind === 'image' || kind === 'video' || kind === 'audio' || kind === '3d' ? kind : undefined;
