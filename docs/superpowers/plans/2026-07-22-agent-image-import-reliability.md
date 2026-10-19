# Agent 生成资产自动导入可靠性修复——实现计划

对应设计稿:`docs/superpowers/specs/2026-07-22-agent-image-import-reliability.md`

## 任务 1:eventAssets 携带完整 asset_path

- 文件:`src/lib/media-import.ts`(+ 同目录测试)
- `ReadyMedia` 增加 `path: string`;`eventAssets` 填入 `item.path`。
- TDD:先补失败测试(断言返回项含完整 path),再实现。
- 验证:`pnpm exec vitest run src/lib/media-import.test.ts`

## 任务 2:importGeneratedAsset 去重键换 path(兼容旧 basename)

- 文件:`src/store/actions.ts`(+ `actions.test.ts`)
- 签名改收 `ReadyMedia`(或增 path 参数);去重检查 `path` 或 `filename` 任一命中即跳过;成功后记录 `path`。
- TDD 用例:①同名不同路径两条均落卡;②旧 basename 条目命中时跳过;③成功后去重表记录的是 path。
- 验证:`pnpm exec vitest run src/store/actions.test.ts`

## 任务 3:importFromReplayEvent 更名 importMediaFromEvent + 种子路径补导

- 文件:`src/store/actions.ts`、`src/store/types.ts`、`src/client/useReplayPlayer.ts`、`src/client/useKoubouConnection.ts`(+ 各测试)
- 更名为 `importMediaFromEvent`;`useKoubouConnection` 在 `seedKoubouHistory(page)` 后对 `page.events` 逐帧调用。
- TDD 用例:建连种子化后,含 ready media 的历史帧触发导入且不注册 task;去重表命中时不重复导入。
- 验证:`pnpm exec vitest run src/client/useKoubouConnection.test.tsx src/client/useReplayPlayer.test.tsx`

## 收尾

- 全量:`pnpm lint && pnpm exec tsc --noEmit && pnpm test`
- 提交:`docs:` 与 `feat:` 成对;回合 dev 用 `--no-ff`。
