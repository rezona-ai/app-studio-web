# 导出为 Steam 内容包（Windows 桌面）

## 目的

后端新增一族端点 `desktop-builds`（契约：rezona-ai/rezonalab-game-server `docs/api/desktop.md`@dev），把一个已构建的
游戏版本打成 Windows x64 桌面应用，产物是一个 zip —— 解压即 **SteamPipe 内容包**，作者只需填 App ID 与
Depot ID 两个值就能用**自己的 Steamworks 账号**上传。平台不代为发布、不接触任何 Steam 凭据。

本需求把这条能力接进前端：File menu 导出分组新增「Export as Steam package」入口，走
表单 → 轮询 → 下载 zip 的完整链路。

## 契约（源：`docs/api/desktop.md`@dev）

`{BASE}` = `/game/pgcserver`（前端经 `/api/pgc` 代理，路径段用项目 **public_id**，与 apk 同）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/projects/{pid}/desktop-builds` | 发起构建，回 `{build_id, status:'queued'}` |
| GET | `/api/projects/{pid}/desktop-builds/{build_id}` | 轮询状态（建议 2–5s） |
| GET | `/api/projects/{pid}/desktop-builds/{build_id}/download` | 下载 zip（**二进制流，非信封**） |

**请求体**（两个字段，都必填）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `version_id` | string | `v{n}`；该版本须已构建完成（存在 `dist/index.html`），否则 409 |
| `name` | string | 1..64 **显示名**；控制字符被剔除；剔后为空 / 含 `<>:"/\|?*` / 以 `.` 结尾 → 422 |

**状态回字段**：`build_id` / `status`(`queued|building|succeeded|failed`) / `failure_category`（仅失败，中文短语）/
`download_available` / `package_size`（成功后有值）/ `external_ref_count`。

**错误码**：`DESKTOP_EXPORT_DISABLED` 404（flag `pgc-export-desktop` **默认关**，三端点一律 404）/
`DESKTOP_BUILD_WORKER_UNAVAILABLE` 503 / `DESKTOP_VERSION_NOT_BUILDABLE` 409 / `IDEMPOTENCY_CONFLICT` 409 /
`DESKTOP_BUILD_QUOTA_EXCEEDED` 429 / `DESKTOP_PACKAGE_TOO_LARGE` 413 / `DESKTOP_BUILD_NOT_FOUND` 404 /
`DESKTOP_BUILD_NOT_READY` 409（作业未成功就调下载）。

**幂等**：同一 `(项目, 版本, name)` 复用同一作业，不重复打包。
**配额**：单用户在途作业数上限默认 **2**，超出 429（apk 侧没有这条限制；桌面产物 138MB 量级而 APK 只有 4MB）。

## 与既有 apk/aab 导出链路的关系

结构同形（POST → 轮询 → 下载），但**四处实质不同**，故**新建组件**而非扩 `ApkExportModal`
（盘问结论，2026-08-26）：

| | apk / aab | desktop（本需求） |
|---|---|---|
| 端点族 | `apk-builds`，下载先调 `download-link` 签发免登录能力链 | `desktop-builds`，**无签发端点**，下载即带鉴权的二进制流 |
| 产物 | 4MB，可 blob、可扫码装机 | **138MB 量级**，禁止整读进内存，扫码无意义 |
| 表单 | icon 上传 + name（aab 另加三字段） | 只有 name，但有 `<>:"/\|?*` / 尾点 / 控制字符的 422 口径 |
| 结果页 | 二维码 / Play 包名回显 | `package_size` + `external_ref_count` 离线提示 + Steam 前置条件 |

塞进 `ApkExportModal` 会变成「三格式 × 两端点族」的分支矩阵，且要冒回归 apk 既有链路的风险 ——
「apk 链路行为零变化」是 aab 那轮的成功标准，本轮沿用：**`ApkExportModal` / `apk-export.ts` /
`pgcApi.apk` 零改动**。共用的只有视觉语汇（外壳、令牌、step 机形状、CTA 样式），逐条照抄。

## 约束与取舍（盘问结论，2026-08-26）

1. **入口 = File menu 导出分组第四项**，文案「Export as Steam package」。与 APK / Play Bundle 并列，
   同为「把游戏交出去」的动作。**不做 flag 预探测**，入口恒显示，提交后若 404
   `DESKTOP_EXPORT_DISABLED` 则回 form + Toast —— 与 `APK_EXPORT_DISABLED` 同口径，后端是唯一真相源。

   ⚠️ **2026-08-27 复核：这条决策的两个原始前提都已不成立，但结论维持不变**（Nick 拍板）。
   - 前提①「无探测端点」→ 其实可探：`_ensure_flag` 跑在属主校验**之前**（后端
     `app/api/routers/desktop.py`），故 `GET .../desktop-builds/<不存在的 id>` 在 flag 关时回
     404 `DESKTOP_EXPORT_DISABLED`、开时回 404 `DESKTOP_BUILD_NOT_FOUND`，两者按 code 可分。
     **仍不采用**：这依赖「两个 404 靠 code 区分」这个契约文档从未声明为探测用途的行为，
     还要拿一个不存在的 `build_id` 去试 —— 后端一旦调整两道闸的先后，探测会**静默失效**
     （flag 明明开着却把入口藏了，且没有任何报错）。
   - 前提②「与 apk 同口径所以不会有死入口」→ 不成立：`pgc-export-apk` 三环境全开
     （2026-08-27 实测），永远不会死入口；`pgc-export-desktop` **只在 dev 点亮**，
     stage/prod 仍是 404。即前端在这两个环境上会展示一个「填完标题才报暂未开放」的入口。
   - 维持恒显示的理由：本分支合回 **dev**，而 dev 上 flag 是开的 —— 合完即可真实跑通；
     非 dev 环境的部署是**手动 dispatch**，把「先点亮 flag」写成上线前提即可（见下节），
     不必为此在前端复制一份 flag 状态或引入一条会静默失效的探测。

2. **下载恒走 Next 代理直链**：`<a href={apiPath(desktopDownloadPath(pid, id))} download>`，
   浏览器原生下载（**不进内存** —— 三项里只有这项成立，见下），cookie 同源自动带，
   本地开发靠代理层 `DEV_COOKIE` 同样跑通。
   ⚠️ **无进度总量、不可续传**：`proxy-response.ts` 刻意丢 `content-length`（防 undici 自动解压
   gzip 后按压缩长度截断 body —— 那个坑已实发过，把大 JSON 截成 listSessions 拿不到会话），
   `[...path]/route.ts` 的转发头白名单也不带 `Range`，上游因此收不到 range、浏览器也拿不到
   `accept-ranges`。于是 138MB 只显示已下字节数，130MB 处掉线要从 0 重下。
   本轮**不动共享代理**（那条路径每一条 pgc 请求都走，回归面是整个应用），记待办见文末。
   代理已是流式（`new Response(res.body)` 直传，不缓冲），`pickProxyHeaders` 已透 `content-type` /
   `content-disposition`。**不用 blob**（文档明文：「不要整读进内存」）；**不分 dev/prod 直连 PGC 域**——
   两环境同一条路，本地验到的就是生产行为。
   代价记录在案：138MB 流经本服务 Pod，占它的带宽与连接时长（backend-service `timeoutSec=3600` 能盖住）。

3. **exe 名不在前端预览**。契约里 exe 名 = `name` 的 ASCII 部分（`史莱姆点点乐 Demo` → `Demo.exe`，
   一个 ASCII 字符都不剩时退为 `RezonaLabGame.exe`）。这套提取含「剔控制字符 + ASCII 筛选 + 空值回落」
   三层，前端复刻一份就是两份平行的字符串规则，**漂了不会报错**——只会给用户一个自信但错的文件名，
   而用户拿它去手填 Steamworks 启动项。**包内 README 是单一真相源**（文档 §5 明写）。
   完成页只写「启动项要指向 content/ 里的 .exe，具体文件名与完整步骤见包内 README.md」。

4. **轮询不设总超时**，与 apk 同口径（无限轮，仅确定性错误停轮报失败）。契约没给构建耗时，凭空定阈值
   会把正在跑的作业误杀。代之以 building 页写明**幂等语义**：可以关掉弹窗，构建在后端继续；用同一个
   标题重新导出会接上这个作业，不重复打包。这句同时解释了配额 429（在途上限 2）。
   → 「轮询无总超时 / 无尝试上限」这条待办与 apk 那条合并，记在本 spec 末尾。

5. **`external_ref_count > 0` 只提示、不拦截**。文档明写「准入行为仍未定，拍板之前前端不要拿它做硬拦截，
   但可以用它出提示」。成功态一行灰字：该游戏依赖 N 个外部资源，离线运行可能白屏。形态与 apk 的
   `networkedHint` 一致（同一处灰字提示位）。
   ⚠️ 这个数的口径 2026-08-24 才改，**历史作业上报的值不可用**——前端只读当次作业的回值，不做任何统计。

6. **Steam 前置条件放表单**，一行提示：需自备已付费的 Steam App ID（每产品 100 美元，不可退）。
   理由：构建有真实成本且在途配额只有 2，让用户在**发起前**知道「没 App ID 拿到 zip 也没法上传」，
   比在完成页事后说更有用。**发布时间线（30 天等待 / Coming Soon 挂两周 / 审核 1–5 天）不进 UI**——
   属包内 README 的内容，文档 §5 只要求「产品要知道」，前端界面不重复 README。

7. **表单前端校验对齐 422 口径**，不合法即禁用 CTA、不发请求（不靠后端 422 兜底，`VALIDATION_ERROR`
   没有专属映射，用户只会看到通用失败文案）。

8. **`package_size` 在完成页回显**（`138 MB` 量级），并说明这是 Electron 运行时的地板价、与游戏自身
   体积无关 —— 否则用户会以为自己几百 KB 的游戏出了问题。这句说明并进「上传到 Steam」三步里的第一步
   （解压），不单独成段；完成页结构与 aab 的「上传到 Google Play」同构：下载 CTA（文案只写「Download」，
   产物形态由 `download` 文件名与步骤说明交代）→ 体积 / 耗时元信息 → `external_ref_count` 提示条
   （带 warning 图标，它是本页唯一要用户回头处理的事，不混进指路散文）→ 分隔标 + 三步。
   模态宽 440px（apk 为 400）：让英文「Building your desktop app…」24px 标题单行——实测 Arial Bold
   近似 330px，440 − 64 内边距 = 376 可容；法 / 西 / 葡 / 俄 本身 450–520px，任何合理宽度都得折行，只保英文。

9. 文案 **11 语全量补齐**，新起命名空间 `preview.steam.*`（不与 `preview.apk.*` 混：两套流程的
   步骤文案、错误码、结果页语义都不同，混在一处迟早互相污染）。

10. 埋点：`game_export_submit.target` 扩出 `'steam'`；新增 `game_desktop_download { project_id }`
    （不复用 `game_apk_download`：那条的 `target` 语义是 local/qr 的下载方式，桌面链路只有一种）。

## 纯逻辑（下沉 `src/lib/desktop-export.ts`，同目录单测）

- `DESKTOP_POLL_INTERVAL_MS = 3500`（契约建议 2–5s，取中值，与 apk 同）；
- `DESKTOP_NAME_MAX = 64`；
- `isValidDesktopName(s)`：剔控制字符后 1..64、不含 `<>:"/\|?*`、不以 `.` 结尾 —— 与后端 422 逐条对齐；
- `sanitizeDesktopName(s)`：剔控制字符 + trim（提交前收口；**不做 ASCII 提取**，见约束 3）；
- `defaultDesktopName(projectName)`：项目名截 64，空白回落 `'Game'`；
- `isDesktopTerminal(status)`；
- `formatPackageSize(bytes)`：`138 MB`（1 位小数，MB 档；`null` 回 `null`）；
- `mapDesktopError(code)`：8 个错误码 → i18n key，未知回落 `preview.steam.err.generic`；
- `desktopDownloadPath(publicId, buildId)`：拼 `/api/pgc/api/projects/{pid}/desktop-builds/{id}/download`
  的**相对**路径（basePath 由调用方经 `apiPath()` 补 —— 与 `assetProxyUrl` 同范式）。

## 上线前提（非 dev 环境部署前必须逐条确认）

`pgc-export-desktop` 的三条判定都带 `person_properties={"env": settings.app.env}`，故 PostHog 控制台
可只点亮一个环境；**当前条件是 `env = dev` 100%**（2026-08-27 实测，状态见后端
`docs/deploy/feature-flags.md`「线上实际状态」）。前端入口恒显示（约束 1），所以**在 flag 未点亮的
环境上 dispatch 部署 = 给用户一个死入口**。dispatch stage / prod 之前逐条确认：

1. **PostHog 把 `pgc-export-desktop` 的 release 条件扩到目标环境** —— 控制台改动最长 2 分钟生效
   （SDK 本地评估模式，120s 轮询）。不带 env 条件直接开会**三环境同时点亮**。
2. **`DESKTOP_BUILD_WORKER__API_KEY` 已进该环境的 secret** —— key 缺失时生产守卫**静默禁用 runner、
   只打 warning、不让 pod 失败**，此时开 flag 会收下一批**永远推不动**的作业（用户侧表现为无限转圈，
   而本前端刻意没有总超时，见约束 4）。
3. **启动日志里 `desktop_runner=on`** —— 上一条的正向验证。

另注：`pgc-desktop-build-runner`（推进循环的空转开关，默认开）**判定不带 env 属性**，关掉是三个环境
一起停。排障时别把它当单环境开关。

## 成功标准

- File menu 出现「Export as Steam package」，点开模态 → 填标题 → 发起 → 轮询 → 完成页可下载 zip；
- 下载走浏览器原生下载，138MB **不经 blob**（DevTools 里 Network 一条 stream，内存不涨）；
- name 非法（空 / 含 `<>:"/\|?*` / 尾点 / 超 64）时 CTA 禁用并给行内文案，不发请求；
- 8 个错误码各自映射到专属文案，未知码回落通用文案；
- `external_ref_count > 0` 时完成页出现离线提示，且**不拦截**下载；
- `ApkExportModal` / `src/lib/apk-export.ts` / `pgcApi.apk` **逐字节零改动**；
- 纯逻辑单测覆盖校验 / 清洗 / 体积格式化 / 错误码映射 / 下载路径拼接；组件测覆盖
  form→building→done / failed 分支、非法 name 闸门、下载 href 正确性、`external_ref_count` 提示；
- `pnpm lint / tsc --noEmit / test / test:tz / build` 全绿。

## 记录不改（待办）

- **轮询无总超时 / 无尝试上限**（约束 4）：瞬时错误（5xx / 超时 / 断网）会无限重试，模态一直转圈。
  apk 那轮已记同一条（spec `2026-08-24-export-play-bundle` §评审处置）。契约建议总超时 ≥ 10 分钟，
  但 desktop 的真实构建耗时未知，取值需要一次实测。**两条合并成一个待办**：等 desktop 在某环境跑通、
  量到真实耗时分布后，给两条链路一起加总超时。
- **`failure_category` 直出后端中文**：11 语 UI 里恒为中文。与 apk 同源问题，后端契约即如此设计
  （「面向用户的中文短语」），非本轮引入。

## 评审处置（2026-08-26，契约对照评审）

一路干净上下文的子代理按 commit 范围 `edec2977..HEAD` 做契约对照（spec + 后端 `docs/api/desktop.md`，
并交叉核了后端 `app/schemas/desktop.py` / `app/services/desktop_export_service.py`）。逐条在后端源码里
复核后处置如下。

已修（本轮）：

- **【Critical】下载路径漏了 `/api` 段** —— `desktopDownloadPath` 返回 `/api/pgc/projects/...`，
  但 `/api/pgc` 只是**本服务代理挂载点**，代理把其后的路径原样拼到 `PGC_BASE_URL + /game/pgcserver`，
  上游真实路径还要一层 `/api/projects/...`（范式见 `client.ts` 的 `downloadVersion`）。漏段即 404，
  而 `<a download>` 会把 404 的 JSON 信封**当文件存下来**——没有 Toast、没有 console，用户只拿到一个
  打不开的文件。更糟的是三处单测把错值锁死了，属**假绿**。已修路径 + 三处断言 + 本 spec 的两处
  （§约束 2 与 §纯逻辑 都照错值写着，不改下次会照 spec 再抄一遍），并加一条 `toContain` 回归守护。
- **【Important】Windows 保留设备名没进表单闸门** —— 后端 `_RESERVED_DEVICE_NAMES`
  （`con/prn/aux/nul` + `com1..9` + `lpt1..9`，按第一段不分大小写判，`CON.exe` 一样打不开）会拒，
  但**契约文档 §1 没列这条**，只有代码里有。项目名恰好叫 `CON` / `Aux` / `COM1` 时 `defaultDesktopName`
  直接预填，用户一个字不改点导出就撞 422 `VALIDATION_ERROR` → 无专属映射 → 通用「导出失败」→
  原样重试永远失败，且指不到是标题的问题。已进闸门（含「只按第一段判、`Console Wars` 不被牵连」
  的用例），并给 `VALIDATION_ERROR` 补专属文案 `err.nameRejected`（11 语）。
  → **建议后端把这条补进 `docs/api/desktop.md` §1**，它现在只在代码里。
- **【Important】`IDEMPOTENCY_CONFLICT` 文案把语义说反了** —— 后端该码的 message 是
  「same idempotency key with a different request」，而「同名作业已在进行中」恰恰是**成功复用**
  那条路径（返 200 + 同一 build_id + `reused=True`）。正确的用户动作是**换标题**而不是等。已改文案。
- **【M5→采纳】`desktop.create` 用默认 30s 档** —— 这个 POST 不是登记完就返回：后端在返回前同步
  `_pack_and_upload_input`（打 zip 流式传桶，先传输入再置 `queued`，否则 runner 会捡到输入未到位的
  作业），资产重的项目会超 30s，把「服务端其实会成功」的操作误杀成前端失败——正是 CLAUDE.md
  点名的「超时分档两侧都要配」。已显式放宽到 `SLOW_TIMEOUT_MS`。
- **【M4】配额上限「2」写死进 11 语** —— 契约写「上限**默认** 2」，后端是
  `DESKTOP_EXPORT__MAX_IN_FLIGHT_PER_USER` 配置项，运维调大后文案就在说谎。已去掉数字。
- **【M8】`buildingHint` 把幂等身份说成「同一个标题」** —— 真实身份是 `(项目, 版本, name)` 三元。
  用户在 building 态关掉弹窗、切了版本再用同标题重导，会新起作业并吃掉一个在途配额。
  已补「同一版本 + 同一标题」（11 语）。
- **【M6】`defaultDesktopName` 按 UTF-16 码元截断** —— 项目名含 emoji 且超 64 码元时会截出孤立
  代理项，后端拼幂等键时 encode 该串会抛 → 用户可控输入换来 500。已改按码位截断，配用例。

记录不改：

- **【M7】`version_id` 两条派生路径**：提交用 `v${version.index}`（= `seq`），埋点发 `version.id`
  （= `version_id`）。技术性异议：契约要求 `^v\d+$`，从 `index` 派生是**唯一能保证格式**的那条
  （`Version.id` 的形态由后端决定，前端类型不保证），而埋点口径要与 apk 侧保持一致才可对比。
  两处当前等值；真要收敛应连 apk 一起改，不在本轮范围。
- **【M9】下载失败态无反馈**：flag 中途关掉 / 产物被清时错误信封没有 `Content-Disposition`，
  `<a download>` 会让用户静默拿到一个叫 `download` 的 JSON。只在 `download_available` 为真后才渲染
  按钮，概率低；要做得干净需改成 fetch 探一次再导航，那会引入「探测成功但下载失败」的新竞态。
  与「轮询无总超时」合并进同一个待办。
- **下载无进度总量、断了不能续传**：代理丢 `content-length`（`proxy-response.ts` 刻意为之，防 gzip
  截断）且不转发 `Range`；上游本身也不支持 range，不算代理引入的退化。将来要做续传需两处同时开。
- 契约那三条「⚠」已确认没踩：历史 `external_ref_count` 不做统计（只读当次回值、不落 persist、
  不进埋点）；本机代理截断那条走服务端一跳反而绕开了（undici 默认不读 `HTTP_PROXY`）；
  准入行为未拍板 → `external_ref_count` 不参与任何 `disabled`/分支判断。

## 评审处置（2026-08-26，实现与代码质量评审）

第二路干净上下文的子代理独立评审（同一 commit 范围）。**两路各自独立命中同一个 Critical**
（下载路径漏 `/api` 段），已在上一节处置。本节记它另外抓到的。

已修（本轮）：

- **【C1 延伸】路径口径写了两份且已漂** —— 根因不是手误，是 `pgcApi.desktop.status` 与下载直链
  各写一份路径，正是 CLAUDE.md「判据各写一份」那条反模式。已抽 `desktopBuildPath(publicId, buildId)`
  作单一来源，两处共源；并补一条**跨口径守护**用例：spy `fetch` 调真实 `pgcApi.desktop.status`，
  断言 `desktopDownloadPath(...) === 那个 URL + '/download'` —— 谁再把一处写死，这条立刻红。
- **【M7】预填开箱即非法** —— `defaultDesktopName` 原先只剔控制字符 + trim + 截 64，项目名叫
  `Slime Clicker: Demo` / `Game v1.0.` / `CON` 时弹窗一开就是红框 + 灰 CTA，用户一个字都没输入
  却被判非法；`slice(0,64)` 本身还可能截出一个新的尾点。已在**预填侧**剔非法字符、削尾点、撞保留名
  退回 `Game`（**不放宽 `isValidDesktopName`** 的口径——那条与后端 422 逐条对齐，有用例守着）。
- **【M1】`download` 属性没有文件名** —— 后端真发 `Content-Disposition` 时以它为准（同源下 CD 优先），
  但万一没发，空 `download` 取 URL 末段 → 用户存下一个无扩展名、叫 `download` 的 138MB 文件，
  Windows 双击打不开。已给显式 `<name>-steam-win64.zip` 兜底 + 用例。
- **【M3 假绿】** 用例名「停轮转失败」只断言了失败文案 —— 把实现里那个 `return` 删掉，定时器照排、
  轮询继续，用例依然全绿。已改为 fake timers 推进两轮后断言 `status` 只被调用 1 次。
- **【M4 假绿】** `vi.useFakeTimers()` 写在用例体内、`useRealTimers()` 在末尾：该用例一失败，后面的
  用例继续跑在假时钟上、报错串味。已移进 `afterEach`。
- **【M5 假绿】** `statusOk(over: Record<string, unknown>)` 让 override 的键名脱离类型检查，写错键
  （`external_refs`）不编译失败、只静默用默认值。已收成 `Partial<DesktopBuildStatusData>`。
- 顺带补了 `game_desktop_download` 埋点的用例（原先无覆盖）。

记录不改：

- **【I1】138MB 无进度总量、不可续传** —— 已核实成立，但修点在**共享代理**上：
  `proxy-response.ts` 刻意丢 `content-length`（防 gzip 截断，那个坑实发过），
  `[...path]/route.ts` 的转发头白名单不带 `Range`。同仓 `src/app/api/pgc/asset/route.ts` 已有正解
  可照抄（透 `accept-ranges`/`content-range`、转发 `range`、**仅当上游无 `content-encoding` 时**
  才透 `content-length`）。但那条路径每一条 pgc 请求都走，回归面是整个应用 →
  **本轮只把 spec 约束 2 的措辞改成事实**（见上），代理改造另开需求。
- **【I2】失败后「Try again」同标题是否死循环 —— 技术性异议，不是问题。** 已在后端
  `app/infra/repositories/desktop_build_repository.py` 的 `_classify` 核实：`status == failed` 时
  **显式重置并重排**（清 `error_code`/`failure_category`/`package_*`/`lease_until`，连 `created_at`
  都重置，注释写明「否则因超时失败的作业一重试就会被下一轮清扫按同一个旧时间戳再判超时，
  超时失败等于不可重试」）。所以同标题重试确实会重新打包，`buildingHint` 的措辞也因此站得住。
- **【M2】下载端点的错误无处可见**：走裸 `<a>` 后 404 / 409 `DESKTOP_BUILD_NOT_READY` 会被当文件
  存下，页面无感；`mapDesktopError` 里 `notReady` 那条因此实际不可达。这是约束 2 的必然代价
  （要做干净得改成先 fetch 探一次再导航，那会引入「探测成功但下载失败」的新竞态）。
  与 M9 合并进「下载失败态无反馈」这一条待办。
- **【M6】瞬时错误判据写了两份**：`DesktopExportModal` 与 `ApkExportModal` 各有一份逐字相同的
  `status === 0 || 408 || 429 || >= 500`。本轮受「apk 零改动」约束不能合并，但形态正是被点名的
  反模式 → 待办：日后抽 `isTransientPgcStatus` 到 `lib/`，两处同时切。
- **【M8】`Build time: 0:00`**：`buildStartRef` 每次 submit 重置，幂等命中一个早已跑完的作业时
  完成页显示 0:00。与 apk 同源，随「下载失败态」那条一起记。
- **【M9】非 `PgcError` 被收敛成 `DESKTOP_POLL_ERROR`**：属「吞未知错误」形态，但与
  `ApkExportModal` 逐字相同，是沿用存量而非本轮引入。
- **【M10】`bg-black/40` 硬编码**：仓里已有 `--color-scrim`，但 `ApkExportModal` /
  `RezonaPublishModal` 两个模态都是这个旧写法，本轮跟随存量口径，不单点改一处造成三处不一。
- **【M7 埋点】`version_id` 两条派生路径**：见上一节，维持技术性异议。

评审确认成立、无需改动的部分（两路合并）：竞态与生命周期（`mountedRef` 在 setup 里重置故
StrictMode 双挂载正确、每个 `await` 后守护齐全、effect cleanup 清最新 timer、重试时靠
`setBuildId(null)` 在 await 之前保证不打旧作业、apk 那个 `mintSeq` 在此确实不需要）；状态机四态
封闭无卡死；**apk 零改动逐字节核实成立**（`git diff` 对两文件无输出，`pgcApi.apk` 块无删改无重排）；
不臆测后端字段；不绕过 basePath；不自造 toast / 按钮；无一次性 keyframes；令牌全部真实存在；
分层正确；11 语键集与插值占位一致（用 `{{n}}` 而非 `{{count}}` 是对的，后者会触发 i18next 复数后缀）。

## 契约复核（2026-08-27，后端文档更新后）

重新取 `docs/api/desktop.md`@dev 并按 commit 逐条 diff（`gh api .../commits?path=docs/api/desktop.md`）。
自本 spec 落笔以来该文件只有一次改动：`2b9bd056` *docs(flags): reconcile feature-flag docs with live
PostHog state (#80)*，**唯一变化是那一行 flag 说明**：

```diff
-- Feature flag: `pgc-export-desktop`,**默认关**,未放开时三个端点一律 404 `DESKTOP_EXPORT_DISABLED`
+- Feature flag: `pgc-export-desktop`,未放开时三个端点一律 404 `DESKTOP_EXPORT_DISABLED`。**当前只在
+  dev 点亮**(PostHog 条件 `env` = dev),stage/prod 仍是 404;2026-08-27 实测,状态见
+  `docs/deploy/feature-flags.md`
```

即**接口契约面零变化**：路径、请求体两字段、状态六个回字段、八个错误码、幂等身份、配额、
`external_ref_count` 口径、下载的流式与 138MB 量级——逐条与本 spec §契约 一致，无需改代码。
同一提交也动了 `docs/api/apk.md`，但只是补一句「`默认关` 指 `default=False` 回落值、不代表线上状态」，
与本轮无关（`pgc-export-apk` 三环境已全量开启）。

**处置**：
- 代码零改动（Nick 拍板：维持入口恒显示，理由与两个原始前提的失效分析记进约束 1）；
- 约束 1 补上 flag 的真实状态与「为何仍不做探测」；
- 新增 §上线前提，把「点亮 flag / worker key 进 secret / `desktop_runner=on`」写成非 dev 环境
  dispatch 前的硬前提 —— 前端恒显示入口，这三条任一不满足就是给用户一个死入口或无限转圈。

**仍未落地的后端文档欠账**（上轮评审提出，本次复核确认未补）：`docs/api/desktop.md` §1 的 `name` 行
逐字未变，**仍未列 Windows 保留设备名那条校验**（`con/prn/aux/nul` + `com1..9` + `lpt1..9`，
按第一段不分大小写判），它只在 `app/schemas/desktop.py` 里。前端那道闸（`isValidDesktopName`
+ `defaultDesktopName` 撞名退回 `Game`）因此继续按代码口径守着，不能等文档。

## 图标与完成页收口(2026-08-27):steam.svg 曾在浏览器里裂图

`steam.svg` 的注释里写了主题变量名 `- -color-pop`(实际是两个连字符相连)。**XML 注释禁止 `- -` 相连**,
而浏览器按严格 XML 解析 `.svg` —— 一处不合法整个文件报废,图标渲染成裂图。

**为什么没被拦住**:`tsc` / `eslint` / 全套测试都不看 SVG 内容,全绿;而我当时的看图验证用的是 macOS
`qlmanage`,它的解析器宽容、照常出图,**恰好掩盖了唯一的真问题**。这与 CLAUDE.md 记的 `color-teal`
漏网是同一形态:静默失色、无任何报错。

**已修**:注释改成不含连字符的写法,并在注释里留下这条禁令本身。图标本体随后也换了两轮:手画的
扁平近似形不对 → 改取 Simple Icons(CC0)官方路径;单色 `#2A475E` 在 16px 下偏暗 → 复刻官方 app 图标配色,
「上深藏青 `#0B1A33` → 下亮蓝 `#1E9FE0`」竖向渐变圆盘 + 恒白阀门(路径是镂空形,底下垫白圆透出),
浅深两稿都不依赖菜单底色。

**已补守护** `src/components/ui/figma-assets.test.ts`,两条:
1. `public/figma/icons/` 下**每个** `.svg` 都用 jsdom 的 `DOMParser` 按 `text/xml` 严格解析
   (与浏览器加载 `.svg` 同口径),失败即红。已验证它能抓到本次缺陷(把 `- -` 放回去 →
   `malformed comment`,红;移除 → 绿)。
2. `figAsset` 登记的每个路径都必须真有对应文件 —— 注册表是纯字符串拼接,拼错或忘拷资源同样不报错,
   `<img>` 静默 404 / mask 静默失色。

**残留缺口(如实记)**:本机浏览器够不到 `file:` 与 `localhost`(两次实测 `ERR_CONNECTION_TIMED_OUT`),
故这枚图标**未经真实浏览器渲染确认**。当前证据是:严格 XML 解析通过 + `qlmanage` 在 96/32/16px 与
浅深两稿底色下的出图。首次在 dev 上打开分享菜单时值得再看一眼。
