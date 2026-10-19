# 3D 绑骨与重纹理前端接入设计

## 目标

按 PGC `rig-retexture-frontend.md` 契约，让用户从画布上的原始、已就绪 `model3d` 资产派生：

- `rig3d`：先预检，再生成带预设动作的 GLB；
- `retexture`：通过文字、参考图、风格图和材质参数生成只改变贴图的 `model3d` GLB。

两类任务均通过 taluna-game 的 `/api/pgc` BFF 调用，不在浏览器硬编码环境域名。

## 交互

原始 3D 卡片选中后，右侧“+”打开派生菜单。只有 `type=model3d`、`status=ready`、且
`item_id` 非 `tex-*` 的资产显示“生成可动角色”和“重新纹理”。后端继续作为来源合法性的最终判定者，
因此上传模型等无法仅靠前端识别的来源会收到结构化错误提示。

绑骨表单打开即调用 precheck。预检通过后展示当前 PGC v2.5 biped 契约支持的全部动作：walk、idle、
jump、run、dive、climb、slash、shoot、hurt、fall、turn。默认选择 walk、idle、jump，至少选一个、
最多选五个；达到上限后禁用其他未选动作，但允许取消已选动作。重纹理表单支持文字提示与图片提示
互斥、可选风格图、texture/PBR 开关、质量、对齐方式和名称。

一次绑骨任务无论选择几个动作都只生成一个 `rig3d` 画布节点：节点对应一个 GLB 资产，所选动作作为
多个 Animation Clip 烘焙在该 GLB 内，不为每个动作复制模型节点。

提交后立即关闭表单，POST 返回的服务端占位 item 原位接管前端占位卡，并登记可刷新恢复的任务。

## 状态机

`GenTask.kind` 扩展为 `rig3d | retexture`。两类派生任务每 3 秒轮询；页面隐藏时暂停，恢复可见后立即补一轮。
终态只读取 `task.item.status`：

- `generating`：继续；
- `ready`：保留前端坐标，用完整 item 更新卡片并移除任务；
- `failed`：保留失败卡、展示结构化 failure，并移除任务。

不能用上游阶段字段 `task.status` 提前终止绑骨，因为它会经历 rig → retarget。

项目切换后，所有 await 返回值都必须丢弃；任务仍按项目持久化，切回后继续。

## 数据映射与血缘

PGC `rig3d` 与 `model3d` 都映射到前端 `kind=3d`，同时在 Asset 保留 `threeDType` 区分渲染。
`reference.links` 中的 `rigged_from` / `retextured_from` 映射为画布父子连线，并在坐标回写时原样保留，
避免 PATCH reference 丢失服务端血缘。

## 渲染

普通 `model3d` 继续使用现有按需加载的 `<model-viewer>`。`rig3d` 使用懒加载的 Three.js 查看器：

- `GLTFLoader` 加载同源代理 URL；
- `AnimationMixer` 驱动动画，每帧 `mixer.update(delta)`；
- 从 `gltf.animations` 枚举动作，不假定固定动作名；
- 优先播放 idle，否则播放第一条；无动作时按静态 GLB 展示；
- 切换动作使用短交叉淡化；卸载时停止 mixer、释放 renderer、geometry、material 和 texture。

画布卡只自动播放默认动作；全屏预览展示实际动作按钮。

## 错误与约束

同步错误通过现有全局 Toast 展示。`RIGGING_DISABLED`、来源不合法、参数校验和内容审核均直接采用
PGC 信封中的 code/message；未知错误继续抛出。派生任务失败保留失败卡，便于用户看到失败结果并从
原始模型重新发起。第一期不展示 credit 预估，因为后端为 unpriced bypass。
