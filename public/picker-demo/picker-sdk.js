/**
 * RezonaLabPicker —— 游戏内元素选取 SDK(demo 验证版)
 *
 * 约定:agent 生成的纯 canvas 游戏引入本脚本,并对每个「可被用户选中编辑」的
 * 实体调用 RezonaLabPicker.register()。宿主页(预览面板)通过 postMessage 开关
 * 编辑模式;选中结果通过 postMessage 回传宿主页。
 *
 * 消息协议(window.postMessage,demo 用 '*',正式版应校验 origin):
 *   宿主 → 游戏: { type: 'picker:enable' } | { type: 'picker:disable' }
 *   游戏 → 宿主: { type: 'picker:ready' }                       // SDK 就绪
 *               { type: 'picker:selected', payload: EntityInfo } // 点击选中
 *
 * 实体注册:
 *   RezonaLabPicker.register({
 *     id: 'hero',                // 唯一标识(重复注册视为更新)
 *     name: '主角',              // 引用块显示名
 *     assetKey: 'hero.png',      // 关联资产 key(可选)
 *     codeRef: 'game.js#Hero',   // 关联代码位置提示(可选)
 *     getBounds: () => ({ x, y, w, h }),  // canvas 内部坐标系下的实时包围盒
 *   });
 */
(function () {
  'use strict';

  const entities = new Map(); // id → 注册项
  let enabled = false;
  let overlay = null;         // 覆盖在游戏 canvas 上的透明 canvas
  let gameCanvas = null;
  let rafId = 0;
  let hovered = null;         // 当前 hover 命中的实体
  let pointer = null;         // overlay 内部坐标系下的指针位置

  // ---- 注册 API ----
  window.RezonaLabPicker = {
    register(entity) {
      if (!entity || !entity.id || typeof entity.getBounds !== 'function') {
        throw new Error('RezonaLabPicker.register: 需要 id 与 getBounds()');
      }
      entities.set(entity.id, entity);
    },
    unregister(id) { entities.delete(id); },
  };

  // ---- 宿主消息 ----
  window.addEventListener('message', (e) => {
    const t = e.data && e.data.type;
    if (t === 'picker:enable') enable();
    else if (t === 'picker:disable') disable();
  });

  function post(msg) { window.parent.postMessage(msg, '*'); }

  // ---- 编辑模式开关 ----
  function enable() {
    if (enabled) return;
    gameCanvas = document.querySelector('canvas');
    if (!gameCanvas) return;
    enabled = true;

    overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;cursor:crosshair;touch-action:none;';
    // overlay 与游戏 canvas 同位同尺寸(CSS 与内部分辨率都对齐)
    syncOverlay();
    document.body.appendChild(overlay);

    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerleave', () => { pointer = null; hovered = null; });
    overlay.addEventListener('click', onClick);
    rafId = requestAnimationFrame(tick);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    cancelAnimationFrame(rafId);
    overlay.remove();
    overlay = null; hovered = null; pointer = null;
  }

  function syncOverlay() {
    const r = gameCanvas.getBoundingClientRect();
    overlay.style.left = r.left + window.scrollX + 'px';
    overlay.style.top = r.top + window.scrollY + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    // overlay 内部坐标系与游戏 canvas 内部坐标系一致,getBounds 的值可直接画
    if (overlay.width !== gameCanvas.width) overlay.width = gameCanvas.width;
    if (overlay.height !== gameCanvas.height) overlay.height = gameCanvas.height;
  }

  // CSS 像素 → canvas 内部坐标(处理内部分辨率与显示尺寸不一致)
  function toCanvasXY(e) {
    const r = overlay.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (overlay.width / r.width),
      y: (e.clientY - r.top) * (overlay.height / r.height),
    };
  }

  function onMove(e) { pointer = toCanvasXY(e); }

  function onClick() {
    if (!hovered) return;
    const { getBounds, ...info } = hovered;
    post({ type: 'picker:selected', payload: { ...info, rect: getBounds() } });
  }

  // 命中检测:重叠时取面积最小者(更可能是用户想选的前景小元素)
  function hitTest(p) {
    let best = null, bestArea = Infinity;
    for (const ent of entities.values()) {
      const b = ent.getBounds();
      if (!b) continue;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        const area = b.w * b.h;
        if (area < bestArea) { best = ent; bestArea = area; }
      }
    }
    return best;
  }

  // 每帧:同步 overlay 位置、重算命中(实体可能在动)、绘制高亮
  function tick() {
    syncOverlay();
    hovered = pointer ? hitTest(pointer) : null;

    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (hovered) {
      const b = hovered.getBounds();
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
      // 名称标签
      ctx.font = '12px sans-serif';
      const label = hovered.name || hovered.id;
      const tw = ctx.measureText(label).width;
      const ly = b.y - 22 < 0 ? b.y + b.h + 4 : b.y - 22;
      ctx.fillStyle = '#4f8cff';
      ctx.fillRect(b.x - 2, ly, tw + 12, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, b.x + 4, ly + 13);
    }
    rafId = requestAnimationFrame(tick);
  }

  post({ type: 'picker:ready' });
})();
