# 3D 绑骨与重纹理前端接入计划

## 实现单元

1. **契约与 API client**
   - 修改 `src/lib/pgc/types.ts`、`src/lib/pgc/client.ts`。
   - 增加 rig precheck、rig generate/poll、retexture generate/poll 的精确 snake_case 类型与方法。
   - 测试 BFF 路径、方法和请求体。

2. **映射与轮询状态机**
   - 修改 `src/store/types.ts`、`src/lib/pgc/map.ts`、`src/store/actions.ts`。
   - 保存 `threeDType`/failure/reference.links，扩展持久化任务种类和 poll 分派。
   - 派生终态只读 `item.status`；保留坐标、血缘和失败卡。
   - 测试 ready、failed、上游阶段切换、切项目和刷新恢复。

3. **派生入口与表单**
   - 新增 3D 来源资格纯函数与派生表单；修改 AddAssetMenu、NodeCard、Workspace 和 UI store。
   - rig 表单预检；retexture 表单覆盖互斥文字/图片提示、风格图及材质参数。
   - 补组件与 store 测试，并同步六套 i18n key。

4. **带骨骼 GLB 渲染**
   - 新增懒加载 Three.js `AnimationMixer` 查看器，接入 ThreeDNode 和 MediaLightbox。
   - 测试 rig/model3d 分流、动作控件、空动画和资源释放边界。

5. **验证与发布**
   - 运行相关 Vitest 后执行 `pnpm lint`、`pnpm exec tsc --noEmit`、`pnpm test`、`pnpm build`。
   - 提交并推送 PR 到 `dev`，检查评论/CI，合并后等待 dev 部署并验证页面与业务日志。
