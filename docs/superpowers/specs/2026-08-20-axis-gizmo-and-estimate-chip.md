# 3D 空间指示器 + 估价 chip 的局部加载态 — 设计稿

日期：2026-08-20
关联：`2026-08-06-canvas-generate-estimate.md`（估价 chip 三态）、`2026-08-09-lightbox-action-bar.md`（lightbox 底部动作条，指示器要与它错开）

## 目的

两件互相独立的小需求：

1. **估价 chip 的加载态不再整块替换**。现在 `loading` 态渲染的是**一个裸 spinner**、`ready` 态是「闪电图标 + 数字」——两者宽度不同，首价落地那一刻整个提交行会横向抖一下（弹窗宽度随之突变）。改成「图标恒在，只有数字那一格转圈」。
2. **3D 预览加一个空间指示器**（三轴 gizmo）。当前 3D 预览没有任何「这个东西可以拖」的提示，也读不出模型当前朝向。指示器同时解这两件事：出现即暗示可交互，方位跟着相机实时转即告知朝向。

## 盘问结论

| 分叉 | 结论 | 否掉的选项与理由 |
|---|---|---|
| 指示器覆盖哪些 3D 视图 | **凡 `camera-controls` 可拖的三处都给**：lightbox 的 `model3d`（model-viewer）与 `rig3d`（自建 three.js OrbitControls）、Files 面板的 glb/gltf 预览（model-viewer） | 「只给 lightbox 两种」会让 Files 里同样可拖却没提示，口径不一致；「只给 model-viewer 那套」会让同一个全屏窗里绑骨模型没指示器，用户看不出为什么。画布卡（`ThreeDNode`，静态快照）与聊天 `ToolCard`（不挂 model-viewer）**不给** —— 那两处压根不能拖 |
| 形态与交互 | **正轴连线 + 端点球（带字母）；负轴只留一个点；六个端点都可点，点击切到对应视图**（2026-08-20 实机迭代后推翻初版的「纯只读」，参照 Tripo Studio 的 3D 视图 gizmo） | 初版定的是「纯只读、`pointer-events-none`」，实机上信息量与可操作性都不够。当时否掉「点轴对齐视角」的两条理由现在都有解：**命中区**——定位容器仍 `pointer-events-none`，只有六个端点自己 `pointer-events-auto`，故除那六个小点之外整片仍能拖动模型；**两套引擎各写一份相机动画**——确实要写两份，但把「轴 → 目标球坐标」抽成纯函数后，各引擎那份只剩「怎么把相机搬过去」 |
| 负轴的画法 | **只画一个点**，不连杆、不带字母 | 连杆版（初版）六条杆从中心放射，转起来互相穿插很乱；空心环版（中间那版）三球三环共六团圆更乱。只留点之后，负轴仍指得出方位、仍可点，视觉噪声最小 |
| 三轴颜色 | **行业约定 X=红 / Y=绿 / Z=蓝**，落成新令牌 `--color-axis-{x,y,z}`（深浅两稿各自调到可读）；负轴同色系、只留细杆（初版让负轴用 `--color-line`，实机发现灰掉后读不出那是哪根轴；中途试过空心环，六团圆更乱，最终只留杆） | 「全走现有令牌（三轴同色 + 靠标签区分）」余光一扫读不出方位；「红绿蓝但向品牌橙调和」偏离 RGB↔XYZ 约定，熟 3D 的用户反而要多想一拍。**颜色一律走 CSS 变量**这条不破 —— 三个都是 `globals.css` 里的语义令牌，组件不写字面色值 |
| 几何算在哪 | **纯函数 `src/lib/axis-gizmo.ts`**，输入是「相机方向单位向量」，输出六条轴在 2D 单位空间里的端点 + 深度 | 两套引擎给相机的方式不同（model-viewer 给球坐标、three.js 直接给 position−target），若把投影写进组件就得写两遍。以**向量**为接口，球坐标→向量只是另一个小纯函数（只 model-viewer 用） |
| 指示器状态放哪 | **放在只渲染 gizmo 的叶子组件里**，自己订阅 `camera-change` | 放宿主组件会让每帧相机变化都重渲 model-viewer / 整个 lightbox。两处宿主都开着 `auto-rotate`，相机**每帧都在变** —— 状态必须待在最便宜的那一层 |

## 一、估价 chip 的局部加载态

结构从「三态各渲染一套」改成「图标恒在 + 数值格三态」：

```
loading :  ⚡  ◌          ← 数值格是 spinner
ready   :  ⚡  1,240
none    :  ⚡  —
```

- **图标不再随状态出现/消失**，故三态之间只有数值格在变。
- 数值格给一个 `min-w`（约 `3ch`）：spinner 与 1–3 位数字宽度相近，但 `—` 和四位数仍会差几像素；钉一个下限让常见档位之间不跳。**不追求像素级恒定** —— 数字位数本来就会变（1,240 → 12,400），那是内容变化不是形态抖动。
- **可访问性口径不变**：整块仍是 `role="img"` + `aria-label`，loading 时读「Estimating…」。此前 loading 态整块 `aria-hidden`，改后要给它一个诚实的名字，故新增 `canvas.gen.estimating` 覆盖 11 语。
- spinner 仍复用全站行内 spinner 惯例（`animate-spin` + 既有描边令牌），不引入新 keyframes。

## 二、三轴指示器

### 几何（`src/lib/axis-gizmo.ts`，纯函数）

```
orbitToDirection(theta, phi) → {x,y,z}      // 仅 model-viewer 用；球坐标(弧度) → 相机方向单位向量
projectAxes({x,y,z})        → AxisTick[]     // 引擎无关
```

- `AxisTick = { axis: 'x'|'y'|'z'; sign: 1|-1; x: number; y: number; depth: number }`，`x/y` 落在 **[-1, 1] 的 2D 单位空间**（组件再乘以半径映射到 SVG），`y` 已按屏幕坐标翻转（向下为正）。
- 投影带**一档透视除法** `scale = (1 - k) / (1 - k·depth)`（k=0.3）：正交投影下同一条轴的正负半轴投影等长，前后读不出来。分子取 `1 - k` 把最大值钉在 depth=1 处的 1，故结果恒不出单位圆、组件按半径映射时不会画到 viewBox 外。
- 视基由「看向原点」的标准 look-at 推出：`zc = dir`（指向观察者）、`xc = normalize(cross(worldUp, zc))`、`yc = cross(zc, xc)`；某条世界轴 `v` 的屏幕投影就是 `(v·xc, -(v·yc))`，`depth = v·zc`。
- **`zc` 与 worldUp 共线时（正俯视 / 正仰视）`cross` 退化成零向量**：此时改用 `+Z` 作参考轴重算 `xc`。不兜这一下，正俯视时整个 gizmo 会塌成 NaN。
- **极点还有第二个、更隐蔽的问题**：方向向量在 `phi = 0` 上把**方位角彻底丢了**（数学上不可恢复），而本模块的接口就是向量 —— 于是转盘自转时指示器会冻住（模型在转、三轴不动）。model-viewer 的 `minimumPolarAngle` 默认就是 `0`，phi 真能取到正 0。故 `orbitToDirection` 把 phi 夹进 `[1e-3, π−1e-3]`：y 仍 ≈ 1（看上去还是正俯视），水平分量约 1e-3、远高于退化阈值，归一化后方位角原样恢复。
- **采样阈值比的是角度、不是方向向量**：接近极点时 `sinφ` 很小，同样的自转带来的向量变化被压到极小、会被点积阈值整个吞掉 —— 表现同样是「模型在转、指示器冻住」。角度差与 phi 无关，任何视角下都灵。
- 返回值**按 `depth` 升序**（远的在前），调用方顺序绘制即天然获得遮挡关系，组件里不再排序。

### 渲染（`src/components/ui/AxisGizmo.tsx`）

落在 `ui/` 而非 `canvas/`：`canvas/` 与 `files/` 是同级功能目录，让后者横向 import 前者全仓没有先例（只有 `workspace/` 自上而下引 `canvas/`）。这两个组件零 store 耦合、纯展示，正合 `ui/` 这个共享桶。

- 一块固定尺寸的 SVG（`GIZMO_SIZE`，实机定在 208）。**SVG 本体 `pointer-events-none`，只有六个端点 `pointer-events-auto`** —— 除那六个小点之外整片仍能拖动模型；这是「可点」与「别挡住拖拽」唯一能同时成立的做法。
- 端点是**真的控件**，故不再整块 `aria-hidden`：每个端点 `role="button"` + `aria-label`（`canvas.gizmo.viewFrom`，11 语），并接 Enter / Space。**轴长 / 球径 / 线宽 / 字号全部由 `GIZMO_SIZE` 按比例派生** —— 只改尺寸而线宽字号留在原值会让整块看着虚（已踩）。
- **正轴 = 轴杆 + 端点球 + 球内字母；负轴 = 一个点**（不连杆、不带字母）。**六个端点共用同一档半径** —— 正负在同一深度上一样大，只差「有没有渐变 / 字母」；曾给负轴单开一档更小的范围，它自己那点差值（2.3px）肉眼读不出在缩。
- **画法是「球端 + 遮挡」而不是「线 + 箭头」**（实机迭代后改的：箭头版转起来只有角度在变，空间感太弱——线是一维图元，没有体积）。正轴 = 轴杆 + 实心球 + 球内 X/Y/Z 字母；负轴**只有一根同色系细杆**。曾给负轴加空心环，实机上六团圆互相穿插反而更乱，已撤。**六条半轴同色系**——负轴改灰会丢掉「这是哪根轴」的信息；正负靠「有没有球」区分。
- 球径、轴杆线宽、不透明度**三者都按 depth 连续插值**（近大、近粗、近实）。加上几何层的透视缩放，一共四重深度线索叠加；单靠任何一件都偏弱。
- **遮挡是转动时最强的那一重**：近球会盖住它后面的轴杆，而遮挡关系由 `projectAxes` 的 depth 升序自然给出，组件顺序绘制即可。
- 球内字母用 `--color-on-primary`（「实色底上的文字」那档令牌）。
- **六个端点一律实心同色**：曾给正轴球加径向渐变做球体感，但外圈是半透明的 ⟹ 同样半径下它看着比实心的负轴点小、居中那个近端负轴点显得格外大（实机看出来的）。改实心之后「半径相等 = 看着一样大」才成立；体积感由半径 / 不透明度 / 遮挡 / 透视这四档承担，本就不缺渐变这一档。
- 位置：**右下角**，`bottom-6 right-6`。lightbox 的动作条 pill 是 `inset-x-0` 居中于 `bottom-6`，两者同高不同列、不重叠（pill 宽约 130px，视口中央）。
- 降低动态：指示器**没有 CSS 动画**（它跟着相机走，不是自己动），故无需进 `prefers-reduced-motion` 的禁用列表。

### 接线

| 宿主 | 拿相机的方式 |
|---|---|
| lightbox `model3d`（`ModelViewerBody`） | 叶子组件 `ModelViewerGizmo`（在 `ui/`）用 rAF 轮询读 `getCameraOrbit()` + `turntableRotation` → `orbitToDirection`。**不能只订阅 `camera-change`**：`auto-rotate` 改的是 `scene.yaw`（转模型不转相机），那个事件一次都不发 |
| Files 面板 glb/gltf | 同上，复用同一个叶子组件 |
| lightbox `rig3d`（`RiggedModelViewer`） | 组件内 three.js 循环每帧算 `camera.position − controls.target` 归一化；**只在方向变化超过阈值时**才 `setState`（自转是匀速的，阈值只是挡住浮点抖动，不是节流） |

- `model-viewer` 的 `camera-change` 事件在 `auto-rotate` 下每帧都发。状态待在只渲染 gizmo 的叶子里，故每帧重渲的只有 10 来个 SVG 节点。
- `<model-viewer>` 是自定义元素，事件必须 `addEventListener`（React 不识别其 `onCameraChange`）—— 与本仓库既有的 `load`/`error` 绑法一致。

## 约束

1. 三个新令牌只加在 `globals.css` 的 `@theme` + `[data-theme="dark"]` 覆盖里；组件一律 `var(--color-axis-x)`，不写字面色值。
2. 几何纯函数 TDD：`orbitToDirection` / `projectAxes` 表驱动单测（含正俯视退化、depth 排序、屏幕 y 翻转）。
3. 指示器**除六个端点外不吃指针**（容器 `pointer-events-none`），不发任何请求。端点进 Tab 序并接键盘。
4. 「轴 → 目标球坐标」是纯函数（`axisToOrbit`）；两套引擎各自只负责「把相机搬到那个球坐标」。
   - model-viewer：写 `cameraOrbit`（它自带插值动画）。**目标角要加上当前 `turntableRotation`** —— 用户点的是模型的某根轴，而 `cameraOrbit` 说的是世界角。
   - rig3d：往渲染循环里塞一个目标位置，逐帧 lerp 过去（OrbitControls 支持「写 position 后 update()」）。
5. `RiggedModelViewer` 的改动限于「多算一个方向向量 + 渲染一个子组件 + 一个 lerp 目标」，不动它既有的取景 / 动画 / dispose 逻辑。
6. 估价 chip 只改渲染形态，**不动 `gen-estimate.ts` 的任何判据**（三态语义与去抖照旧）。

## 成功标准

1. 打开生成弹窗：闪电图标一直在，只有数值格从转圈变成数字；首价落地时提交行不横向抖动。
2. 读屏在 loading 态能读到「Estimating…」而不是沉默。
3. lightbox 打开 `model3d` / `rig3d`、Files 预览打开 glb：右下角出现三轴指示器，拖动模型时三轴实时跟转；指向背面的轴变淡。
4. 指示器压着的那一角照旧能拖动模型 —— 只有六个端点吃指针。
5. 点六个端点各自切到对应视图（±X / ±Y / ±Z），model-viewer 那两处走它自带的插值动画、rig3d 那处逐帧 lerp。
5. 正俯视（phi→0）不出现 NaN / 塌陷。
6. `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm test` / `pnpm test:tz` 全绿。
