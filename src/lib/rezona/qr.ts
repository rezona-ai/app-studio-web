import qrcode from 'qrcode-generator';

// 把文本编码成 QR 矩阵的 SVG path(纯函数,渲染方套 <svg viewBox="0 0 size size"><path/></svg>)。
// typeNumber=0 自动选型,纠错级 M;quiet zone 由渲染方用 padding 留白。
export function qrSvg(text: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
  }
  return { size, path };
}
