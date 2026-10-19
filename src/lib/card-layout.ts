// 资产落位纯函数:位置只在创建那一刻计算一次,系统永不挪动已有卡片。
// 画布退役后坐标无人展示,仍随 reference 写回后端(与旧数据同一口径);一键整理 tidyLayout 随画布删除
export interface XY { x: number; y: number }
// 带可选宽高的落位框:落位时用各类型真实尺寸,缺省退回 CARD_W/CARD_H(XY 天然满足)
export interface Box extends XY { w?: number; h?: number }

// 通用兜底尺寸与间距:CARD_W/CARD_H 是未知类型的回退值(image 量级)。
// 注意 CARD_H(150)历史上等于 image 的「媒体区高」而非整卡高,直接拿它做兄弟卡纵向间距会低估、致重叠;
// 按类型真实尺寸见下方 CARD_SIZE。
export const CARD_W = 180;
export const CARD_H = 150;
export const GAP_X = 80;
export const GAP_Y = 40;
export const CASCADE_STEP = 40;

// 各类型卡估算尺寸:沿用画布时期 NodeCard 的 width 与媒体高 + 外壳(header 34.5 + padding 12 + 边框 2 ≈ 48.5)
// 的偏大整值。画布界面已退役(spec 2026-10-19-remove-asset-canvas),本表只剩自动导入 / 上传时给资产落坐标一个用途 ——
// 坐标仍随 reference 写回后端,保持与旧数据同一口径,故不改值。
// 键用 string 不引入 AssetKind 业务枚举,保持本文件无业务耦合。
export const CARD_SIZE: Record<string, { w: number; h: number }> = {
  image: { w: 180, h: 200 }, // 媒体 h-[150px] + 外壳(量得 180×198.5)
  video: { w: 200, h: 190 }, // 媒体 h-[132px] + 外壳(量得 200×180.5)
  '3d': { w: 180, h: 195 },  // 媒体 h-[140px] + 外壳(量得 180×188.5)
  audio: { w: 210, h: 130 }, // 播放器体 h-[72px] + 外壳(量得 210×120.5)
  text: { w: 210, h: 195 },  // 文本体限高 max-h-[120px] + 上下 py-3 + 外壳(量得满高 210×192.5;
                             // 内容短则更矮 —— 按满高取值,短文本多留白也不压邻卡)
};

// 取某类型卡尺寸;未知 / 缺省类型退回通用兜底(image 量级)
export function cardSize(kind?: string): { w: number; h: number } {
  return (kind != null && CARD_SIZE[kind]) || { w: CARD_W, h: CARD_H };
}
const MAX_AVOID_RINGS = 6;

// 树形落位:首个子节点在父右侧(按父真实宽偏移)、y 与父对齐;
// 后续堆叠在「最低兄弟的真实底边(y + 高)」之下 —— 用各兄弟真实高,兄弟不等高时也能正确接续。
// 宽高缺省退回 CARD_W/CARD_H:此时 max(s.y + CARD_H) + GAP_Y === max(s.y) + CARD_H + GAP_Y,与旧实现逐字节兼容。
export function childPosition(parent: Box, siblings: Box[]): XY {
  const x = parent.x + (parent.w ?? CARD_W) + GAP_X;
  if (siblings.length === 0) return { x, y: parent.y };
  const bottom = Math.max(...siblings.map((s) => s.y + (s.h ?? CARD_H)));
  return { x, y: bottom + GAP_Y };
}

// 兜底级联:从 origin 起第 i 个按固定步距对角错开
export function cascadePosition(origin: XY, index: number): XY {
  return { x: origin.x + index * CASCADE_STEP, y: origin.y + index * CASCADE_STEP };
}

// 重叠避让:目标被占时在其四周按"扩展环"就近搜索最近空位返回。
// 命中判定用「双方各自真实包围盒 + GAP 外扩」的 AABB 相交 —— 即只有两卡间留够 GAP_X/GAP_Y 才算空闲。
// 早期实现两边都按固定 CARD_W/CARD_H(150)判定,而 image/video/3d 实高是 190-200:
// 纵向步距 190 < 实高 200,连续生成的两张卡会贴死甚至压掉 10px(用户反馈的重叠 bug)。
// 步距取「目标卡真实宽高 + 间距」,保证同环候选互不重叠;邻卡尺寸不一时由逐格 hit 判定兜住。
// 同距离优先正下方、再靠左;超环数上限兜底原样返回 target(永不抛错/死循环)。
export function avoidOverlap(target: Box, occupied: Box[]): XY {
  const tw = target.w ?? CARD_W;
  const th = target.h ?? CARD_H;
  const hit = (p: XY) =>
    occupied.some((o) =>
      p.x < o.x + (o.w ?? CARD_W) + GAP_X && o.x < p.x + tw + GAP_X &&
      p.y < o.y + (o.h ?? CARD_H) + GAP_Y && o.y < p.y + th + GAP_Y);
  if (!hit(target)) return { x: target.x, y: target.y };
  const STEP_X = tw + GAP_X;
  const STEP_Y = th + GAP_Y;
  for (let r = 1; r <= MAX_AVOID_RINGS; r++) {
    const cells: XY[] = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 仅取该环边界格点
        cells.push({ x: dx, y: dy });
      }
    }
    cells.sort((a, b) => {
      const da = (a.x * STEP_X) ** 2 + (a.y * STEP_Y) ** 2;
      const db = (b.x * STEP_X) ** 2 + (b.y * STEP_Y) ** 2;
      if (da !== db) return da - db;    // 先按到 target 的实际距离从近到远
      if (a.y !== b.y) return b.y - a.y; // 同距离:优先正下方(dy 大者靠前)
      return a.x - b.x;                  // 再:优先靠左(dx 小者靠前)
    });
    for (const c of cells) {
      const pos = { x: target.x + c.x * STEP_X, y: target.y + c.y * STEP_Y };
      if (!hit(pos)) return pos;
    }
  }
  return { x: target.x, y: target.y };
}

// 各类型卡最大宽/高(含通用兜底):兜底网格用它做统一格距,任意类型混排都不重叠
const MAX_CARD_W = Math.max(CARD_W, ...Object.values(CARD_SIZE).map((s) => s.w));
const MAX_CARD_H = Math.max(CARD_H, ...Object.values(CARD_SIZE).map((s) => s.h));
export const FALLBACK_COLS = 5;   // 兜底网格每行卡数

// 无坐标资产兜底网格:第 index 张按「每行 FALLBACK_COLS 张」铺放。
// 用于服务端 item 完全没有坐标的历史 / 异常数据 —— 这类资产以前按 CASCADE_STEP(40)对角级联,
// 数量一多就叠成一摞;网格格距按最大卡尺寸 + 间距取,保证任何类型组合都不重叠。
export function fallbackGridPosition(origin: XY, index: number): XY {
  return {
    x: origin.x + (index % FALLBACK_COLS) * (MAX_CARD_W + GAP_X),
    y: origin.y + Math.floor(index / FALLBACK_COLS) * (MAX_CARD_H + GAP_Y),
  };
}
