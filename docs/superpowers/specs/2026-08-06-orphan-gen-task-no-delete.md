# 在飞生成不该被前端删掉：孤儿兜底停止 DELETE + 对称发现

> 状态：设计稿 · 2026-08-06
> 关联：`2026-08-06-gen-task-deadline-and-placeholder.md`（本轮问题是那一轮**终审时挖出来的**，
> 且那份文档里我对暴露面的描述**两次都不准确**，本文一并订正）

## 目的

`restoreGenTasks`（`actions.ts:124-158`）在打开项目时做两件事：把持久化的 `genTasks` 接回来，
再把「`generating` 但没有任务可恢复」的资产当**孤儿**处理 —— 从画布移除 **并 `deleteCanvasItem`**。

问题出在「能恢复」的判据太窄：`discovered` 只按 `rig-` / `tex-` 前缀反推 task_id，
**不认用户自发起的 `vid-` / `m3d-`**。于是：

```
用户点生成视频 → pgc 建 vid-<task_id> 的 generating 卡 → 前端登记 GenTask(持久化在 localStorage)
     ↓
换个浏览器 / 无痕窗口 / 清了 localStorage / 换台设备 打开同一项目
     ↓
loadCanvas 带回那张 generating 的 vid- 卡;restoreGenTasks 在 localStorage 里找不到任务,
discovered 又不认 vid- 前缀
     ↓
判成孤儿 → 从画布移除 + DELETE 服务端 item —— 用户付了钱的生成被前端删在半路
```

「不留永远转圈的加载卡」这个目的本身是对的，但用**删服务端数据**去达到它，代价与手段不成比例：
判据错一次就是不可恢复的数据丢失（后端无 restore 端点）。

## 前置事实（已核实，两条都影响暴露面的判断）

1. **`item_id` 后缀就是 `task_id`**（pgc-server `docs/api/canvas.md`）：
   视频轮询响应里 `task_id: "8f2a1c9b3d4e"` ↔ `item_id: "vid-8f2a1c9b3d4e"`；
   3D 同构 `m3d-<task_id>`。所以 `vid-` / `m3d-` 完全可以像 `rig-` / `tex-` 一样对称反推。
2. **agent 委托的任务（`gtask-*`）在 `generating` 时没有服务端 item** —— canvas.md 的 video 与 model3d
   两处轮询说明都写明「`generating` 回无 item（**前端保留占位卡**）」，item 只在 ready 时才落成画布卡。
   故 agent 那条路在生成中**不存在**能被误删的服务端卡。

> ⚠️ 订正前一份文档：`2026-08-06-gen-task-deadline-and-placeholder.md` 里我先写「产物最终由 pgc 建 item
> 带回，不丢资产」（说反了），终审指出后改成「刷新后若 pgc 已建出那张仍 generating 的真实 item…」——
> 后者对 agent 路径仍不成立（见事实 2）。真正的暴露面是**用户自发起**的 video / 3D + 持久化任务拿不到。

## 约束

1. **不删服务端数据**。孤儿兜底改为**就地标失败**（`markAssetsFailed` + Toast），卡留在画布上带重试入口。
   用户想清掉自己删 —— 删除权归用户，不归启发式判断。
   > ⚠️ **本条留下的口子已由 `2026-08-07-retry-path-guards` 收口**：那个「重试入口」本身会
   > `discardFailedCard` → **DELETE 服务端 item**，而孤儿的服务端那份仍是 `generating` ——
   > 于是本轮「不删」的正当性被它自己的出口破掉了。现改为：孤儿挂 `GEN_STATE_LOST`，
   > 卡面按钮换成不花钱的「重新检查」，且 `discardFailedCard` 对这类卡一律不删不移除。
2. **对称发现覆盖全部四类异步生成**：`vid-`(video) / `m3d-`(model3d) / `rig-`(rig3d) / `tex-`(retexture)。
   判据沿用既有做法：**前缀 + `threeDType`/`kind` 双重确认**再 `slice` 出 task_id。
   订正（评审 M1）：`match` 的作用**不是**区分前缀（四个前缀互斥，不可能互相认错），
   而是「前缀只是命名约定、type 才是权威」—— 类型不符的脏卡一律拒认，不据前缀臆造任务。
3. **不臆造前缀**：只认契约里写明的四个。精灵图 `spr-` 契约里确有该前缀、且**在飞就有服务端卡**，
   但前端未接该生成类型（Nick 明确不做），故刻意不收 —— 代码注释里写明「接入 sprite 时必须同时补进本表，
   否则每次开项目都会把在飞的精灵图判成失败」。
4. **发现出来的任务 `startedAt` 取当下**（沿用 `rig-`/`tex-` 的既有做法）：跨设备拿不到真实提交时刻，
   而后端保证 30 分钟内必达终态，重新起表只会多等不会漏。
5. **孤儿这条路本身要变得几乎走不到**：四类都能恢复后，剩下的 `generating` 孤儿只可能是
   同步类（`img-`/`aud-`）的异常残留或未接入的新类型 —— 那时标失败也比删掉稳妥。

## 成功标准

1. 在飞的 `vid-<task_id>` / `m3d-<task_id>` 卡在**没有持久化任务**时被发现并接着轮询
   （`genTasks` 里出现对应任务，`taskId` 等于去掉前缀的那段）。
2. `rig-` / `tex-` 的既有发现行为不回退（kind 仍分别是 `rig3d` / `retexture`）。
3. 前缀与类型不匹配时不误认：`tex-` 前缀不得被当成 `model3d`；`vid-` 前缀但 `kind !== 'video'` 不认。
4. 真接不回来的孤儿（如 `img-` 卡卡在 generating）→ **就地标失败**（`status: 'error'`）、留在画布上、
   **不发 `deleteCanvasItem`**。
   ⚠️ **改判（评审 M2）**：原先这条写「Toast 照弹（不回退）」，实现后改为**不弹**。理由：卡不再被删，
   那条 Toast 会在**每次打开项目**时重弹一次（改动前卡被删掉了，故只弹一次），
   而卡面已就地显示失败态与重试入口 —— 信息由卡片自己承担，比每次开项目挨一条错误提示更好。
5. `restoreGenTasks` 全路径不再调用 `deleteCanvasItem`（这是本轮的核心断言，用「一次都没被调用」钉住）。
6. **标失败要耐久**（评审 I1 补）：孤儿是**服务端真实卡**，服务端那份仍 `generating`（本轮刻意不删）——
   后台刷画布（`run.finished` / `checkpoint.created` 等，**不经** `restoreGenTasks`）不得把它翻回
   `generating`，否则卡就地永远转圈，标失败等于白标。上一轮那条「留住失败态」只覆盖占位卡，
   这里要扩到「服务端仍 generating 而本地已判失败且无 live 任务」的真实卡。
7. 已有持久化任务时行为不变（`restored` 优先，`discovered` 不重复登记同一 itemId）。
8. `pending_*` 占位卡仍不在孤儿之列（既有语义，同会话在途请求本就无任务）。
9. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm build` 全绿。

## 方案

### 1. 对称发现（一张表取代四段 if）

放在模块作用域（纯查表、不闭包状态，与 `DEADLINE_MS` 那批常量同处）：

```ts
// item_id 后缀即 task_id(pgc docs/api/canvas.md:视频 vid-<task_id>、3D m3d-<task_id>,
// 绑骨/重纹理同构) —— 故换台设备、没有 localStorage 也能从画布恢复轮询。
// match 不是为了区分前缀(四者互斥),而是「type 才是权威」:类型不符的脏卡拒认,不臆造任务
const DISCOVERABLE: { prefix: string; kind: GenTaskKind; match: (a: Asset) => boolean }[] = [
  { prefix: 'vid-', kind: 'video',     match: (a) => a.kind === 'video' },
  { prefix: 'm3d-', kind: 'model3d',   match: (a) => a.threeDType === 'model3d' },
  { prefix: 'rig-', kind: 'rig3d',     match: (a) => a.threeDType === 'rig3d' },
  { prefix: 'tex-', kind: 'retexture', match: (a) => a.threeDType === 'model3d' },
];
```

### 2. 孤儿兜底改为标失败，不删

```ts
// 孤儿 generating 资产(服务端仍 generating 但任务确实接不回来):不能留永远转圈的加载卡,
// 但**不删服务端 item** —— 判据错一次就是不可恢复的数据丢失(后端无 restore 端点),
// 而标失败同样达到目的、还留着重试入口,用户想清掉可以自己删。
// 不弹 Toast:卡不再被删,那条 Toast 会在每次打开项目时重弹(见成功标准 4 的改判说明)
if (orphanIds.length) markAssetsFailed(orphanIds, null);
```

### 3. 标失败要耐久（评审 I1）

`loadCanvas` 的保留规则扩一档 —— 服务端仍 `generating` 而本地已判失败、且没有 live 任务指向它，
就保住本地的失败态与 `failure`：

```ts
const stuckFailed = new Map(get().assets
  .filter((a) => a.status === 'error' && !isPlaceholderId(a.id) && !polling.has(a.id))
  .map((a) => [a.id, a] as const));
```

它同样只是 `get().assets` 的**子集**（结构上不会复活用户删掉的卡）；要求「无 live 任务」是为了
一旦任务被发现/恢复，就以服务端的 `generating` 为准继续轮询。

三处「会不会有副作用」的自查（终审前自己核过）：

| 疑点 | 结论 |
|---|---|
| 服务端那张卡后来真落 `ready`（如另一台设备把任务跑完）会不会被永久钉死在 error | **不会**：判据是 `a.status === 'generating'`，而 `a` 是服务端映射结果 —— ready 时条件为假，原样放行 |
| 与上一轮的 `alivePlaceholders` 是否重叠 / 互相覆盖 | **不相交**：一个要求 `isPlaceholderId`、一个排除它 |
| 用户点重试后旧卡会不会阴魂不散 | **不会**：`discardFailedCard` 先把卡从 `assets` 移除，而 `stuckFailed` 是从 `get().assets` 现算的 |

顺带：服务端本来就 `failed` 的卡也会进这张 Map（本地 error、无任务），但映射结果同为 `error`、
条件为假，故是无害的宽集合，不额外加条件去排除它。

## 明确不做

- **精灵图（sprite）的发现规则**：前端未接该生成类型（Nick 明确不做），不猜它的 id 形态。
- **`gtask-*` 委托任务的跨设备恢复**：`generating` 时没有服务端 item（前置事实 2），画布上无迹可寻；
  要做得靠 koubou 侧或 pgc 的「按项目列在飞 agent 任务」端点，跨仓，另开。
- **给孤儿卡填真实失败原因**：接不回来时前端不知道上游为何失败，`failure` 传 `null` 走通用文案
  （沿用既有 `failGenTask` 在无 failure 时的口径）。
- **孤儿判据加时间窗**（如「只处理超过 N 分钟的」）：**不做，但原理由已失效，此处换新理由**
  （2026-08-08 重估，见 `specs/2026-08-08-canvas-time-dimension.md` 方案 5）。
  原写的是「canvas item 没有 `created_at`，前端算不出年龄」—— 该字段现已进前端契约，年龄算得出来了。
  新理由是**本轮决策的另一半已经把风险消掉了**：既然「删服务端 item」已改成「就地标失败 +
  保留重试入口」，误判的代价就从「不可恢复的数据丢失」降成「显示一个可重试的失败态」，量级完全不同；
  而加时间窗会让**真正卡死**的卡在窗口期内继续转圈，那正是本轮要防的「不留永远转圈的加载卡」。
  前提变了、结论不变。

  两条更强的论据（评审 tv-rel 补，均在本仓代码里现成）：
  1. **误判集合已近空**。`DISCOVERABLE` 覆盖的 `vid-`/`m3d-`/`rig-`/`tex-` **恰好就是
     「在飞时才有服务端 item」的那四类**，id 后缀即 task_id、不依赖 localStorage；
     `gtask-*` 委托任务在 generating 时根本没有服务端 item；`pending_` 占位卡被显式排除。
     剩下能被判孤儿的只有 `spr-`（明确不接）与前缀/类型不符的脏卡。
  2. **时间窗在单次会话里根本不会被复评**。`restoreGenTasks` 只在切项目与首载引导两处调用，
     **没有任何定时器**。所以时间窗不是「多转 N 分钟」，而是**这张卡转到本次会话结束**。
  另：误判的伤害比上文说的还轻一档 —— 卡面按钮是**不花钱的「重新检查」**，
  且 `loadCanvas` 的 `stuckFailed` 只在服务端那份仍 generating 时才钉住本地 error，
  服务端一落 ready 卡就**自动恢复**，不需要用户操作。

## 真机验收（2026-08-06，dev :3011 打 pgc dev，项目 1055）

**手法说明（如实交代）**：被测的是 `restoreGenTasks` 的判定分支，卡从哪来不影响它。
真造一张在飞的 video/3D 卡要花数千 credit 且要在窗口内操作，故**在本地把卡置成 `generating`**
（服务端那份不动）+ 调**真实** `restoreGenTasks`，并用 Playwright 拦截网络请求验「不发 DELETE」。
验完把造出来的假卡与假任务清掉，画布已恢复成服务端那 7 张（`genTasks` 与 `genTasksByProject` 均空）。

| 场景 | 结果 | 证据 |
|---|---|---|
| `img-stuck`（id 里无可反推 task_id）→ 孤儿 | ✅ 标失败、留在画布、不弹 Toast | `{仍在: true, status: 'error', toast: null}` |
| 同上，核心断言 | ✅ **一次 DELETE 都没发** | 请求拦截结果 `DELETE请求: []` |
| `vid-realcheck123`（`kind: 'video'`）→ 被发现 | ✅ 接着轮询且落盘 | `genTasks: [{itemId:'vid-realcheck123', kind:'video', taskId:'realcheck123'}]`、`落盘: ['realcheck123']`、卡仍 `generating` |

### 未验到（如实记录）

- **端到端的跨设备场景**（真提交一次 video/3D → 无痕窗口打开同项目 → 卡被接回来继续轮询到 ready）：
  需要一张真在飞的付费任务 + 在窗口内切浏览器，本次未做。发现规则与不删断言已由单测
  （6 条）+ 上面的真机分支验证覆盖，端到端那一层记为未验。
- **`spr-`（精灵图）**：前端未接该生成类型，无从构造。刻意不收进发现表，已在代码注释与本文交代。
