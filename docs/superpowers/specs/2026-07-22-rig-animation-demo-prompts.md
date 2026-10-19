# 动作演示图生成提示

图片使用 Codex 内置 `image_gen` 逐张生成，再以 Pillow 缩放为 192×192 WebP（quality 84）。

## 共通提示

```text
Use case: stylized-concept
Asset type: square action-demonstration thumbnail for a game character animation picker
Create a polished low-poly 3D game-UI illustration. Use one crisp opaque main pose, restrained semi-transparent teal motion-echo poses, and concise coral-orange direction arcs or speed marks. The subject uses matte graphite geometric panels, bright teal joint markers and thin teal edge accents. Use a clean warm pale-gray studio background, orthographic-ish three-quarter view, full body visible with generous safe padding, and a silhouette legible at 48x48.
No text, letters, labels, captions, watermark, logo, border, panel grid, scenery, cropped limbs, photorealism, or clutter.
```

## 动作差异提示

| 文件 | 动作提示 |
|---|---|
| `biped-walk.webp` | 中等步幅、脚跟到脚尖、对侧摆臂、短水平轨迹 |
| `biped-idle.webp` | 双脚落地、呼吸起伏、轻微重心变化 |
| `biped-run.webp` | 身体前倾、腾空长步幅、手臂泵动、向后速度线 |
| `biped-jump.webp` | 下蹲起跳、空中顶点、准备落地、抛物线轨迹 |
| `biped-climb.webp` | 手脚交替上攀、竖直动作轨迹；不出现墙或梯子 |
| `biped-dive.webp` | 身体伸展、头先向前下方跃出、斜向下降轨迹 |
| `biped-slash.webp` | 抽象训练短刃、扭腰挥砍、橙色弧形刀轨 |
| `biped-shoot.webp` | 双手抽象训练发射器、后坐与恢复、枪口脉冲 |
| `biped-hurt.webp` | 上身受击后仰、回弹、非暴力冲击星芒 |
| `biped-fall.webp` | 失衡、脚离地、向下坠落轨迹 |
| `biped-turn.webp` | 原地枢轴转身、腰部环形箭头、脚下枢轴环 |
| `quadruped-walk.webp` | 四足犬科训练体、对角步态、四肢完整可见 |
| `hexapod-walk.webp` | 六足昆虫训练体、交替三足步态、恰好六条腿 |
| `octopod-walk.webp` | 八足章鱼训练体、触手接触波次、恰好八条肢体 |
| `serpentine-march.webp` | 无足分节蛇形训练体、S 形行波向前传播 |
| `aquatic-march.webp` | 鱼形训练体、尾鳍左右摆动、身体稳定前游 |

每个动作均单独调用内置 `image_gen`，没有使用批量 `n` 生成不同资产。
