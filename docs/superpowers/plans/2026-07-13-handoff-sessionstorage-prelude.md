# handoff:超长 prelude 经 sessionStorage 传递

## 背景

Landing 目前经 URL query(`?model=&prompt=&assets=`)向工作台传预填参数。提示词过长会超出 URL 长度上限导致出错。改为:超过规定长度时 landing 把载荷写入 sessionStorage,只在 URL 上带一个 id:

- URL:`/game?handoff=<uuid>`
- sessionStorage key:`tln.game.handoff.<uuid>`
- 载荷:

```json
{
  "v": 1,
  "model": "claude-opus-4-8",
  "prompt": "……完整长文……",
  "assets": [{ "url": "https://.../file.pdf", "kind": "document", "name": "file.pdf" }],
  "createdAt": 1720870000000
}
```

短参数继续走原 URL query 线,两线并存;handoff 存在且载荷有效时优先。

## 方案

沿用「纯解析下沉 lib、副作用留 client hook」分层:

1. `src/lib/studio-prelude.ts`(纯函数):
   - `parseHandoffId(search)`:读 `?handoff=`,空/缺省返回 null;
   - `handoffStorageKey(id)`:拼 `tln.game.handoff.<id>`;
   - `parseHandoffPayload(raw)`:JSON 解析 sessionStorage 原文 → `StudioPrelude | null`。仅认 `v === 1`(为后续版本留兼容位);`model`/`prompt` 取 string 且非空;`assets` 复用现有逐条校验(含 landing 线 `document`→内部 `text` 归一);全空返回 null。`createdAt` 仅是 landing 侧写入时间戳,消费端不校验过期(sessionStorage 本身随标签页销毁)。
   - 现 `parseAssets(raw: string)` 拆出数组归一部分 `normalizeAssetSeeds(arr: unknown)` 供两线共用。
2. `src/client/useProjectBootstrap.ts`(副作用):在原 query prelude 之前插 handoff 分支——读 key、**立即 removeItem 一次性消费**(防刷新/StrictMode 重复新建项目),载荷有效则走既有 `applyStudioPrelude`;key 缺失或载荷非法则回落 `loadProjects`(刷新后 key 已被消费属正常路径)。
3. URL 收敛复用现状:`applyStudioPrelude` 成功后本就把 URL 全量重写为 `?project=<public_id>`,`handoff` 参数随之剥离,无需新增逻辑。

## 测试

- `studio-prelude.test.ts`:handoff id 解析、载荷合法/非法 JSON/版本不符/document 归一/全空;
- `useProjectBootstrap.test.tsx`:带 handoff 且 sessionStorage 有载荷 → 新建+预填+key 被消费;key 缺失 → 回落 loadProjects。
