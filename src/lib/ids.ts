import { nanoid } from 'nanoid';
export const newId = (prefix = '') => `${prefix}${prefix ? '_' : ''}${nanoid(8)}`;

// 占位卡:标记「还没有服务端 item」的卡。造 id 与判定**都从同一个前缀派生** ——
// 从前判定散在各处写 'pending_' 字面量,改前缀时必漏
const PENDING_PREFIX = 'pending';
export const newPlaceholderId = (): string => newId(PENDING_PREFIX);
export const isPlaceholderId = (id: string): boolean => id.startsWith(`${PENDING_PREFIX}_`);
