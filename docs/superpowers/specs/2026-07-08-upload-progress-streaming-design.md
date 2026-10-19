# 上传进度真实化设计（代理流式转发 + 处理中文案）

- 日期：2026-07-08
- 关联：Meegle Story 13370489 迭代；问题「上传 zip 一直显示 100%」

## 根因

导入上传的 XHR `upload.onprogress` 度量「浏览器 → Next 代理」一跳；catch-all 代理（`src/app/api/pgc/[...path]/route.ts`）`await req.arrayBuffer()` 整包缓冲后才转发 PGC。本地回环瞬间发完 → 立即 100%；随后「代理→PGC 二次上传 + PGC 解包」对浏览器不可见，进度挂死在 100%。

## 方案（1 + 2 组合，已与 Nick 确认）

### 1. 代理流式转发（治本）

- `src/app/api/pgc/[...path]/route.ts`：带体请求不再 `arrayBuffer()` 缓冲，直接把 `req.body`（ReadableStream）交给 `proxyFetch`；
- `src/server/pgc/proxy.ts`：`fetch` 传流式 body 时必须带 `duplex: 'half'`（undici 约束）——`ProxyInit.body` 类型扩为 `BodyInit | ReadableStream | null`，检测到流式 body 时附加 `duplex`；
- 效果：浏览器发送受「代理→PGC」背压牵引，`onprogress` 近似真实端到端进度；
- 影响面与风险：该代理承载全部 PGC POST/PATCH（JSON 体积小、行为等价）；流式后请求变 chunked（无 content-length）——需**真实后端验证** PGC/网关接受 chunked multipart 与 chunked JSON。若上游拒收（411/400），本方案回退整包缓冲并停留在方案 2（spec 失败预案，届时向 Nick 汇报）；
- Koubou 代理（`src/server/koubou/proxy.ts`）不动：其无大文件上传场景，本期不扩散。

### 2. 100% 后切「处理中」文案（观感兜底）

- 上传字节发完（`progress >= 1`）但请求未返回期间，弹窗步骤文案从「正在上传… 100%」切为 `stepProcessing`「正在处理压缩包…」（spinner 照旧）；
- 服务端解包耗时无论如何不可见，此文案覆盖该窗口；
- 取消语义不变：整个 `uploading` step（含处理中窗口）仍可取消（abort 请求；极端时序下后端可能已完成建项，属既有可接受边缘）；
- i18n：新增 `chat.importGame.stepProcessing` 六语。

## 测试

- 代理层：路由 handler 对带体请求把 `req.body` 流原样传递（不 buffer）、`proxyFetch` 对流式 body 附加 `duplex: 'half'`、无体 GET 不受影响（现有代理测试回归）；
- 弹窗：`progress >= 1` 时渲染 `stepProcessing`、`< 1` 时仍渲染百分比文案；
- 运行态（真实后端）：连真实 PGC 上传一个数 MB 压缩包，确认进度渐进爬升、100% 后出现「正在处理…」、导入成功（随后删除测试项目）；并回归一条 JSON POST（如新建项目）确认 chunked 不破坏普通请求。

## 不在本期范围

- 服务端解包进度（后端无接口）；
- Koubou 代理流式化；
- 浏览器直连 PGC 上传（CORS 需后端配合）。
