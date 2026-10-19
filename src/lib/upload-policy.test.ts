import { describe, test, expect } from 'vitest';
import i18n from '@/i18n';
import { validateUpload, acceptAttr, rejectMessage, UPLOAD_POLICY, type UploadPolicy } from './upload-policy';

// 测试中统一使用 en 语言的 t 函数,保证断言文案与原英文源串一致
const t = i18n.t.bind(i18n);

const MB = 1_000_000;

// 构造指定大小/类型的 File
function fakeFile(name: string, type: string, bytes = 10): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('validateUpload', () => {
  test('放行 4 种图片格式', () => {
    const files = [
      fakeFile('a.jpg', 'image/jpeg'),
      fakeFile('b.png', 'image/png'),
      fakeFile('c.gif', 'image/gif'),
      fakeFile('d.webp', 'image/webp'),
    ];
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    expect(accepted).toHaveLength(4);
    expect(rejected).toHaveLength(0);
  });

  test('拒绝非媒体类型,reason=type', () => {
    const files = [fakeFile('x.svg', 'image/svg+xml'), fakeFile('y.pdf', 'application/pdf'), fakeFile('z.zip', 'application/zip')];
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.canvas);
    expect(accepted).toHaveLength(0);
    expect(rejected.map((r) => r.reason)).toEqual(['type', 'type', 'type']);
  });

  test('拒绝超过 maxBytes(无 per-kind 时用兜底),reason=size;等于上限通过', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 100 };
    const over = fakeFile('big.png', 'image/png', 101);
    const exact = fakeFile('ok.png', 'image/png', 100);
    const res = validateUpload([over, exact], policy);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toBe('size');
    expect(res.accepted).toEqual([exact]);
  });

  test('canvas 放行图片/视频/音频/3D(glb 标准 MIME)', () => {
    const png = fakeFile('a.png', 'image/png');
    const mp4 = fakeFile('b.mp4', 'video/mp4');
    const mp3 = fakeFile('c.mp3', 'audio/mpeg');
    const glb = fakeFile('d.glb', 'model/gltf-binary');
    const { accepted, rejected } = validateUpload([png, mp4, mp3, glb], UPLOAD_POLICY.canvas);
    expect(accepted).toEqual([png, mp4, mp3, glb]);
    expect(rejected).toHaveLength(0);
  });

  test('canvas 按扩展名兜底放行 glb/gltf(浏览器给空/octet-stream MIME)', () => {
    const glbEmpty = fakeFile('scene.glb', '');
    const glbOctet = fakeFile('hero.glb', 'application/octet-stream');
    const gltf = fakeFile('mesh.gltf', 'application/octet-stream');
    const { accepted, rejected } = validateUpload([glbEmpty, glbOctet, gltf], UPLOAD_POLICY.canvas);
    expect(accepted).toEqual([glbEmpty, glbOctet, gltf]);
    expect(rejected).toHaveLength(0);
  });

  test('canvas 3D 上限 100MB:超限 reason=size', () => {
    const within = fakeFile('ok.glb', 'application/octet-stream', 100 * MB);
    const over = fakeFile('big.glb', 'application/octet-stream', 100 * MB + 1);
    const { accepted, rejected } = validateUpload([within, over], UPLOAD_POLICY.canvas);
    expect(accepted).toEqual([within]);
    expect(rejected).toEqual([{ file: over, reason: 'size' }]);
  });

  test('chat 放行标准 MIME、空 MIME 与 octet-stream 的 glb/gltf', () => {
    const glb = fakeFile('d.glb', 'model/gltf-binary');
    const glbEmpty = fakeFile('e.glb', '');
    const glbOctet = fakeFile('f.glb', 'application/octet-stream');
    const gltfOctet = fakeFile('g.gltf', 'application/octet-stream');
    const files = [glb, glbEmpty, glbOctet, gltfOctet];
    const { accepted, rejected } = validateUpload(files, UPLOAD_POLICY.chat);
    expect(accepted).toEqual(files);
    expect(rejected).toHaveLength(0);
  });

  test('gltf 带 text/plain MIME:chat/canvas 均按扩展名判为 3D 后放行', () => {
    const gltfAsText = () => fakeFile('mesh.gltf', 'text/plain');
    expect(validateUpload([gltfAsText()], UPLOAD_POLICY.canvas).accepted).toHaveLength(1);
    expect(validateUpload([gltfAsText()], UPLOAD_POLICY.chat).accepted).toHaveLength(1);
  });

  test('chat 3D 上限 100MB:等于上限通过,超限 reason=size', () => {
    const within = fakeFile('ok.glb', 'application/octet-stream', 100 * MB);
    const over = fakeFile('big.glb', 'application/octet-stream', 100 * MB + 1);
    const { accepted, rejected } = validateUpload([within, over], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([within]);
    expect(rejected).toEqual([{ file: over, reason: 'size' }]);
  });

  test('按 kind 取不同上限(maxBytesByKind 覆盖 maxBytes)', () => {
    const policy: UploadPolicy = { accept: ['image/png', 'video/mp4'], maxBytes: 999, maxBytesByKind: { image: 5, video: 20 } };
    const img = fakeFile('a.png', 'image/png', 6);  // > 图片 5 → size
    const vid = fakeFile('b.mp4', 'video/mp4', 6);   // <= 视频 20 → 通过
    const { accepted, rejected } = validateUpload([img, vid], policy);
    expect(accepted).toEqual([vid]);
    expect(rejected).toEqual([{ file: img, reason: 'size' }]);
  });

  test('混合时正确分组', () => {
    const good = fakeFile('a.png', 'image/png');
    const bad = fakeFile('b.zip', 'application/zip');
    const { accepted, rejected } = validateUpload([good, bad], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([good]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].file).toBe(bad);
  });

  test('maxCount:超出的尾部文件 reason=count', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 1 };
    const f1 = fakeFile('1.png', 'image/png');
    const f2 = fakeFile('2.png', 'image/png');
    const { accepted, rejected } = validateUpload([f1, f2], policy);
    expect(accepted).toEqual([f1]);
    expect(rejected).toEqual([{ file: f2, reason: 'count' }]);
  });

  test('maxCount 优先于 type:超出尾部即使类型非法也记 count', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 1 };
    const ok = fakeFile('ok.png', 'image/png');
    const badType = fakeFile('x.svg', 'image/svg+xml');
    const { accepted, rejected } = validateUpload([ok, badType], policy);
    expect(accepted).toEqual([ok]);
    expect(rejected).toEqual([{ file: badType, reason: 'count' }]);
  });

  test('maxCount 按实际放行数算名额:被 type 拒的不占额,后续合法文件仍可进', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 1 };
    const badType = fakeFile('x.svg', 'image/svg+xml');
    const ok = fakeFile('ok.png', 'image/png');
    const { accepted, rejected } = validateUpload([badType, ok], policy);
    expect(accepted).toEqual([ok]); // 首个被 type 拒不消耗名额,ok 仍占到唯一名额
    expect(rejected).toEqual([{ file: badType, reason: 'type' }]);
  });

  test('existingCount:已暂存数计入总额,仅放行剩余名额,余下记 count', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 5 };
    const files = [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png'), fakeFile('c.png', 'image/png')];
    const { accepted, rejected } = validateUpload(files, policy, 4); // 已暂存 4,仅剩 1 名额
    expect(accepted.map((f) => f.name)).toEqual(['a.png']);
    expect(rejected.map((r) => r.reason)).toEqual(['count', 'count']);
  });

  test('existingCount 已达上限:整批全部 count', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 5 };
    const f = fakeFile('a.png', 'image/png');
    const { accepted, rejected } = validateUpload([f], policy, 5);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ file: f, reason: 'count' }]);
  });
});

describe('canvas 放行文本(md/txt)', () => {
  test('text/markdown、text/plain 被 accept', () => {
    const md = fakeFile('a.md', 'text/markdown');
    const txt = fakeFile('b.txt', 'text/plain');
    const { accepted, rejected } = validateUpload([md, txt], UPLOAD_POLICY.canvas);
    expect(accepted).toEqual([md, txt]);
    expect(rejected).toHaveLength(0);
  });

  test('文本超过 1MB 被拒,reason=size', () => {
    const big = fakeFile('big.md', 'text/markdown', 1 * MB + 1);
    const { accepted, rejected } = validateUpload([big], UPLOAD_POLICY.canvas);
    expect(accepted).toHaveLength(0);
    expect(rejected).toEqual([{ file: big, reason: 'size' }]);
  });

  test('chat 策略同时放行 md 与 txt(读内容内联进正文)', () => {
    const md = fakeFile('a.md', 'text/markdown');
    const txt = fakeFile('b.txt', 'text/plain');
    const { accepted, rejected } = validateUpload([md, txt], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([md, txt]);
    expect(rejected).toHaveLength(0);
  });

  test('chat 的 txt 限额吃 text kind 的 1MB', () => {
    const big = fakeFile('big.txt', 'text/plain', 1 * MB + 1);
    const ok = fakeFile('ok.txt', 'text/plain', 1 * MB);
    const { accepted, rejected } = validateUpload([big, ok], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([ok]);
    expect(rejected).toEqual([{ file: big, reason: 'size' }]);
  });
});

describe('chat 放行 PDF(agent 经 understand_media 理解)', () => {
  test('application/pdf 被 chat accept,canvas 仍拒', () => {
    const pdf = fakeFile('spec.pdf', 'application/pdf');
    expect(validateUpload([pdf], UPLOAD_POLICY.chat).accepted).toEqual([pdf]);
    expect(validateUpload([pdf], UPLOAD_POLICY.canvas).rejected).toEqual([{ file: pdf, reason: 'type' }]);
  });

  test('PDF 限额走 MIME 级覆盖 20MB(不吃 text kind 的 1MB)', () => {
    const okPdf = fakeFile('ok.pdf', 'application/pdf', 20 * MB);
    const bigPdf = fakeFile('big.pdf', 'application/pdf', 20 * MB + 1);
    const { accepted, rejected } = validateUpload([okPdf, bigPdf], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([okPdf]);
    expect(rejected).toEqual([{ file: bigPdf, reason: 'size' }]);
  });
});

describe('UPLOAD_POLICY 限额对齐后端', () => {
  test('canvas 与 chat 五种类型白名单和限额一致', () => {
    for (const p of [UPLOAD_POLICY.canvas, UPLOAD_POLICY.chat]) {
      expect(p.maxBytesByKind?.image).toBe(20 * MB);
      expect(p.maxBytesByKind?.video).toBe(20 * MB);
      expect(p.maxBytesByKind?.audio).toBe(20 * MB);
      expect(p.maxBytesByKind?.text).toBe(1 * MB);
      expect(p.maxBytesByKind?.['3d']).toBe(100 * MB);
      expect(p.accept).toContain('image/png');
      expect(p.accept).toContain('video/mp4');
      expect(p.accept).toContain('audio/mpeg');
      expect(p.accept).toContain('text/markdown');
      expect(p.accept).toContain('text/plain');
      expect(p.accept).toContain('model/gltf-binary');
      expect(p.accept).toContain('model/gltf+json');
      expect(p.acceptExtensions).toEqual(expect.arrayContaining(['glb', 'gltf']));
    }
  });

  test('chat 限附件总数为 5,canvas 不限', () => {
    expect(UPLOAD_POLICY.chat.maxCount).toBe(5);
    expect(UPLOAD_POLICY.canvas.maxCount).toBeUndefined();
  });
});

describe('acceptAttr', () => {
  test('逗号拼接 MIME', () => {
    expect(acceptAttr({ accept: ['image/png', 'video/mp4'], maxBytes: 1 })).toBe('image/png,video/mp4');
  });

  test('acceptExtensions 以带点扩展名附在 MIME 后(文件选择器放行 glb)', () => {
    const attr = acceptAttr({ accept: ['image/png'], acceptExtensions: ['glb', 'gltf'], maxBytes: 1 });
    expect(attr).toBe('image/png,.glb,.gltf');
  });

  test('canvas 与 chat 的 accept 均含 3D MIME 与 glb/gltf 扩展名', () => {
    for (const policy of [UPLOAD_POLICY.canvas, UPLOAD_POLICY.chat]) {
      const attr = acceptAttr(policy);
      expect(attr).toContain('model/gltf-binary');
      expect(attr).toContain('.glb');
      expect(attr).toContain('.gltf');
    }
  });
});

describe('rejectMessage', () => {
  test('空数组返回空串', () => {
    expect(rejectMessage([], UPLOAD_POLICY.chat, t)).toBe('');
  });

  test('type:列出友好格式名与文件名', () => {
    const policy: UploadPolicy = { accept: ['image/png', 'image/webp'], maxBytes: 100 };
    const msg = rejectMessage([{ file: fakeFile('x.svg', 'image/svg+xml'), reason: 'type' }], policy, t);
    expect(msg).toBe('Unsupported file type (x.svg). Allowed: PNG, WebP.');
  });

  test('size:逐文件列出该 kind 适用上限', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 5 * MB };
    const msg = rejectMessage([{ file: fakeFile('big.png', 'image/png'), reason: 'size' }], policy, t);
    expect(msg).toBe('File too large: big.png (max 5 MB).');
  });

  test('size:per-kind 时不同文件给各自上限', () => {
    const policy: UploadPolicy = { accept: ['image/png', 'video/mp4'], maxBytes: 20 * MB, maxBytesByKind: { image: 5 * MB, video: 20 * MB } };
    const msg = rejectMessage(
      [
        { file: fakeFile('a.png', 'image/png'), reason: 'size' },
        { file: fakeFile('b.mp4', 'video/mp4'), reason: 'size' },
      ],
      policy,
      t,
    );
    expect(msg).toBe('File too large: a.png (max 5 MB), b.mp4 (max 20 MB).');
  });

  test('count:含上限数(总额语义)', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 1000, maxCount: 5 };
    const msg = rejectMessage([{ file: fakeFile('6.png', 'image/png'), reason: 'count' }], policy, t);
    expect(msg).toBe('Too many files (6.png). Max 5 attachments.');
  });

  test('混合:type 与 size 合并为一条', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 5 * MB };
    const msg = rejectMessage(
      [
        { file: fakeFile('x.svg', 'image/svg+xml'), reason: 'type' },
        { file: fakeFile('big.png', 'image/png'), reason: 'size' },
      ],
      policy,
      t,
    );
    expect(msg).toBe('Unsupported file type (x.svg). Allowed: PNG. File too large: big.png (max 5 MB).');
  });

  test('同一原因多文件名用逗号拼接', () => {
    const policy: UploadPolicy = { accept: ['image/png'], maxBytes: 100 };
    const msg = rejectMessage(
      [
        { file: fakeFile('x.svg', 'image/svg+xml'), reason: 'type' },
        { file: fakeFile('y.bmp', 'image/bmp'), reason: 'type' },
      ],
      policy,
      t,
    );
    expect(msg).toBe('Unsupported file type (x.svg, y.bmp). Allowed: PNG.');
  });

  test('未知 MIME 回退为子类型大写', () => {
    const policy: UploadPolicy = { accept: ['image/png', 'application/zip'], maxBytes: 1000 };
    const msg = rejectMessage([{ file: fakeFile('a.txt', 'text/plain'), reason: 'type' }], policy, t);
    expect(msg).toBe('Unsupported file type (a.txt). Allowed: PNG, ZIP.');
  });

  test('chat 策略放行视频/音频/PDF/TXT,拒绝其它类型', () => {
    const mp4 = fakeFile('a.mp4', 'video/mp4');
    const mp3 = fakeFile('a.mp3', 'audio/mpeg');
    const pdf = fakeFile('a.pdf', 'application/pdf');
    const txt = fakeFile('a.txt', 'text/plain');
    const zip = fakeFile('a.zip', 'application/zip');
    const { accepted, rejected } = validateUpload([mp4, mp3, pdf, txt, zip], UPLOAD_POLICY.chat);
    expect(accepted).toEqual([mp4, mp3, pdf, txt]);
    expect(rejected).toEqual([{ file: zip, reason: 'type' }]);
  });

  test('chat 类型拒绝文案的 allowed 列表含 PDF 与 TXT', () => {
    const zip = fakeFile('a.zip', 'application/zip');
    const msg = rejectMessage([{ file: zip, reason: 'type' }], UPLOAD_POLICY.chat, t);
    expect(msg).toContain('PDF');
    expect(msg).toContain('TXT');
  });

  test('类型拒绝文案泛化(不写死 images are allowed)', () => {
    const zip = fakeFile('a.zip', 'application/zip');
    const msg = rejectMessage([{ file: zip, reason: 'type' }], UPLOAD_POLICY.chat, t);
    expect(msg).toContain('Unsupported file type');
    expect(msg).not.toContain('images are allowed');
  });
});
