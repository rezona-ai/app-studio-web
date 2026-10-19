# 3D GLB 走同源代理(修画布 blank 真因)

## 背景

上一轮「画布资产故障隔离」按假设加了两层兜底(map 单项容错 + per-node 错误边界),
但用户反馈本地 `localhost:3000` 打开某项目**画布仍不渲染已有资产**。

## 用 Playwright 复现拿到真实报错

驱动真实页面(project=gGbJmvIg)抓控制台 + 网络,定位到真因(非渲染崩溃、非 map 抛错):

```
[ERROR] Access to fetch at 'https://tlndev.taluna.ai/.../魔女琪琪模型.glb'
        from origin 'http://localhost:3000' blocked by CORS: No 'Access-Control-Allow-Origin'
[ERROR] TypeError: Failed to fetch
        at FileLoader.load (three_core) → GLTFLoader.load → CachingGLTFLoader.preload
        → ModelScene.setSource → [updateSource] → IntersectionObserver.root
```

- 画布 `/canvas/items` 返回 200,资产其实都进了 store、DOM 里 25 个节点都在。
- 3D 卡的 `<model-viewer>` **懒加载**:进视口才拉 GLB。
- GLB 用的是 `resolveAssetUrl` 拼出的 `tlndev.taluna.ai` **跨域直链**。本地 app 在 `localhost`,
  与 PGC 域跨源;model-viewer 内部走 `fetch` + three.js `GLTFLoader`,被 **CORS 拦**。
- 失败在 `IntersectionObserver` 回调里抛出**未捕获 `TypeError`**(异步 rejection,不是 React 渲染抛错,
  故 per-node 错误边界抓不到)→ **dev 下触发 Next.js 错误遮罩**,3D 卡若在初始视口内,遮罩一挂载即盖住整块画布,
  表现为「画布不渲染已有资产」。

> 为什么是本地特有:生产环境 app 与 PGC 同域(都在 `tlndev.taluna.ai/game`),GLB 同源不 CORS。
> 但开发者恒在 localhost 开发,故真实命中。

## 根因

仓库早有一个**同源媒体代理** `GET /api/pgc/asset?url=`(`src/app/api/pgc/asset/route.ts`,
注释明写「仅供 fetch 类媒体如 GLB 规避跨域」,服务端 `resolveAssetProxyTarget` 限定 PGC 同源防 SSRF),
但**全仓无人使用**——`<model-viewer src>` 直接用了跨域直链。**代理存在却没接上**,即为真因。

## 设计

- 新增纯函数 `assetProxyUrl(url)`(`src/lib/pgc/url.ts`):
  - `data:` URL(内联字节)原样返回,无需代理;
  - 其余包成 `${apiPath('/api/pgc/asset')}?url=${encodeURIComponent(url)}`,浏览器即同源取字节。
- `ThreeDNode` 与 `MediaLightbox` 的 `<model-viewer src>` 改用 `assetProxyUrl(...)`。
  - **仅 model-viewer(基于 fetch)需要**;`<img>/<video>` 跨域直显不受 CORS 影响,保持直链不动。

## 验证(Playwright 端到端,worktree :3001)

- 页面上下文 `fetch('/api/pgc/asset?url=<GLB>')` → **200,application/octet-stream,10.6MB**,同源无 CORS。
- 两处 `<model-viewer>` 的 `src` 属性均为 `/api/pgc/asset?url=…`;lightbox model-viewer
  `loaded=true, modelIsVisible=true`——**GLB 成功加载并渲染**(修复前 CORS 永远加载不出)。
- 控制台 **CORS / `TypeError: Failed to fetch` 全部消失**,不再触发 Next 错误遮罩。
- `tsc --noEmit` / `lint` / `vitest`(940)/ `next build` 全绿。

## 遗留(可选后续硬化,不在本修复内)

model-viewer 对**真正加载不出的 GLB**(如经代理仍 404)仍会抛未捕获 `TypeError`,dev 下仍会弹遮罩。
若要彻底免疫,可给 model-viewer 挂 `error` 事件监听 → 降级到 `ErrorBody`。因代理已让常态加载可靠、
且该问题仅 dev 遮罩(生产无遮罩、model-viewer 自行消化),本轮不做,留作独立硬化。
