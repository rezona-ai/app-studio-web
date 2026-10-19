import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { figAsset } from './figma';

// 图标资源的两条静默失败守护 —— 这两类错误 tsc / lint / 组件测**全绿**,只在浏览器里裂:
//
// ① **SVG 必须是合法 XML**。浏览器按严格 XML 解析 .svg,一处不合法整个文件报废、渲染成裂图。
//    最容易踩的是**注释里出现连续两个连字符**:XML 禁止 `- -` 相连,而我们的图标注释常要写
//    CSS 变量名(形如 `- -color-pop`)。实际踩过:steam.svg 因注释里写了主题变量名而整枚不渲染,
//    且 macOS 的 qlmanage 预览渲染器宽容、看图验不出来(2026-08-27)。
// ② **figAsset 登记的路径必须真有文件**。注册表是纯字符串拼接,拼错或忘拷资源都不会报错,
//    <img> 静默 404 / mask 静默失色(与 CLAUDE.md 记的 color-teal 那类漏网同一形态)。
//
// 覆盖整个 public/figma/icons 目录而非只查在册的那几个:未登记的资源也会被别处直接引用。

const ICON_DIR = join(process.cwd(), 'public/figma/icons');
const svgFiles = readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg'));

describe('figma 图标资源', () => {
  test('目录非空(路径写错时不至于静默零断言通过)', () => {
    expect(svgFiles.length).toBeGreaterThan(20);
  });

  // 用 jsdom 自带的 DOMParser(vitest 环境即 jsdom)按 text/xml 严格解析,与浏览器加载 .svg 同口径;
  // 失败时它把根节点换成 <parsererror>,不抛异常 —— 故断言根节点必须是 svg
  test.each(svgFiles)('%s 是合法 XML(注释里不得有连续两个连字符)', (file) => {
    const xml = readFileSync(join(ICON_DIR, file), 'utf8');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const err = doc.querySelector('parsererror');
    expect(err?.textContent ?? null, `${file} 解析报错`).toBeNull();
    expect(doc.documentElement?.nodeName).toBe('svg');
  });

  test('figAsset 里登记的每个路径都真有对应文件', () => {
    const missing = Object.entries(figAsset)
      // 注册表值是经 assetPath() 拼过 basePath 的浏览器路径,回推到仓库里的实际文件位置
      .map(([key, url]) => [key, url.slice(url.indexOf('/figma/icons/'))] as const)
      .filter(([, rel]) => !existsSync(join(process.cwd(), 'public', rel)))
      .map(([key, rel]) => `${key} → ${rel}`);
    expect(missing).toEqual([]);
  });
});
