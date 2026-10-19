# Engine Bridge 网页端接入(game-web 部分)

> 上游计划:pgc 仓 `docs/plans/2026-09-03-001-feat-engine-bridge-direct-push-plan.md`(U4);
> 协议、内核与网页客户端在新仓 `rezonalab-engine-bridge`。本稿只记 game-web 这一侧做了什么、为什么,以及与计划的偏差。

## 做什么

用户在预览栏账户条上的「⇄ Engine Bridge」面板里拨开一个引擎(Cocos Creator / Unity)的开关,网页直接连上本机该引擎里的
Rezona Bridge 插件(`ws://127.0.0.1:<端口段>`)并保持连接;之后在画布卡片右键菜单「发送至 → 该引擎」,网页取资产字节直推给插件,
插件落盘、导入、放进场景。卡片上一枚胶囊显示「传输 37% → 导入中 → 已导入」,失败给原因与重试。零后端参与,
交互模型完全对标 Tripo DCC Bridge(计划 KTD-15/16):开关互斥、拨开即连、再拨即断、掉线不自动重连、传输中禁切换、不跨刷新持久化。

## 为什么这样接

- **单一 store 切片 + 闭包持句柄**:`bridge` 状态(引擎 / 状态 / 实例 / 传输 / 面板开合)进 zustand store,组件只订阅;
  `BridgeConnection`(socket + 心跳定时器)不可序列化,由 `src/store/bridge.ts` 的闭包持有,与 `pendingDeletes` 同一做法。
  `bridge` **不进 persist 白名单**:连接活不过刷新,落盘的「已连接」只会是假的。
- **取字节复用下载那条路**:`src/lib/download.ts` 抽出 `fetchAssetBlob(asset)`,下载与桥共用同源代理路径,不新增 pgc 调用面。
- **依赖面收口**:`@rezonalab/engine-bridge-web` 只在 `src/lib/engine-bridge/*`、`src/store/bridge.ts`、`src/store/types.ts`(类型)
  与 `src/components/bridge/*` 出现,换成 git URL / npm 版本时 `package.json` 一行即可。

## Feature flag(与计划的偏差 1)

计划写「沿用该仓 PostHog 前端 flag `web-export-engine-bridge`」,但 game-web **没有** PostHog 前端 flag 机制。改为构建期变量
`NEXT_PUBLIC_ENGINE_BRIDGE === '1'`,唯一读取点 `src/lib/engine-bridge/flag.ts`(`isEngineBridgeEnabled()`)。关 = 顶栏按钮、面板、
右键「发送至」、胶囊、权限说明层全部不渲染(dynamic 的 chunk 也不加载)。`deploy/dockerfile` 加 ARG/ENV,`_deploy.yml` 加可选 input
`engine_bridge` 透传为 build-arg;**三环境目前都没打开**。⚠️ 这不是运行时开关:回滚 = 不传该变量重新构建部署。

## 其余偏差(已定,不再讨论)

2. **资产类型**:game-web 的 `AssetKind` 是 `image | video | audio | 3d | text`,没有 sprite。映射 `3d → model3d`、`image`、`audio`;
   `video` / `text` 不出现「发送至」。不做 sprite/zip 路径,不引 JSZip。
3. **字节来源**:经 `fetchAssetBlob`(同源代理 `assetProxyUrl`),不调计划里的 `GET /api/canvas/items/{id}/download`。
4. **入口位置**:本仓无全局顶栏,按钮挂在 `PreviewPanel` 账户条(分享钮旁);提示条文案改为「请先在右侧预览栏顶部的 Engine Bridge 面板…」。
   面板用 fixed + 视口夹取定位:预览栏最窄 330px,从按钮向右生长必然顶出视口。
5. **i18n**:11 种语言全部补齐 `bridge.*` 键;错误码经 `src/lib/engine-bridge/errors.ts` 映射到 `bridge.errors.*`,未收录码落 `errors.unknown`。
   Toast 三条(未连接 / 传输中禁切换 / 忙)进 `ERROR_KEYS`;未连接那条带 `action: openBridgePanel`,`ToastMessage.action` 因此成了判别联合。
6. **文件名**:只保留 ASCII `[A-Za-z0-9._-]`,其余折叠成 `_`,整名非 ASCII 回退 `asset.id`;不做拼音转写(插件侧 `meta.displayName` 已带原名)。
7. **视觉令牌**:计划里的 teal 强调色在本仓已全量迁移删除,连接态用 `--color-live`(绿)/ `--color-warning`(连接中),
   胶囊与实例选中点用品牌橙 `--color-primary`。

## 编译基线

- `@rezonalab/engine-bridge-web` 取自 `rezonalab-engine-bridge` 提交 **`4604ded`（tag `v0.1.1`）**(`packages/web-client`,`dist/` 已构建),
  当前以 pnpm `link:` 绝对路径接入,待远端仓就位后换成 git URL / npm 版本。
- 测试:`src/lib/engine-bridge/*.test.ts`(flag / 类型映射 / 文件名 / 错误码)、`src/store/bridge.test.ts`(互斥切换 / 掉线不重连 /
  传输中禁切换 / 未连接只提示 / BUSY / 进度阶段 / 完成 3s 收起 / 失败保留重试)、`src/components/bridge/EngineBridge.test.tsx`
  与 `src/components/preview/PreviewPanel.bridge.test.tsx`(flag 门控 / 面板 / 菜单 / 胶囊 / 权限层 / Toast 动作)。
  端到端联调用新仓 `npm run dev:fake-engine` 起假引擎在 41700。

## 本地验证(2026-09-03 实跑)

`scripts/engine-bridge-e2e/`(用法见其 README):真实 dev server(flag 开)+ engine-bridge 仓的 fake-engine(41700,放行 `http://localhost:3000`)+ Playwright 无头 Chromium,PGC / Koubou 接口用 `page.route` 换成最小信封,到插件的 WebSocket 与字节传输是真的。
实跑结果:拨开 Cocos → 权限说明层 → 「Connected · MyGame」→ 卡片右键「发送至 → Cocos」→ 胶囊「Imported · placed in scene」→ `tmp-project/assets/RezonaAssets/Cube.glb` 204800 字节、sha256 与浏览器侧一致 → 点未连接的 Unity 只出现提示条。
这次实跑抓到并修掉一个真问题:web-client 的 UA 正则把 `HeadlessChrome/` 判成 Safari(engine-bridge #3,v0.1.1)。
