'use client';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVersionFiles, type FileNode } from '@/client/useVersionFiles';
import { useModelViewer } from '@/client/useModelViewer';
import { figAsset, FigIcon } from '@/components/ui/figma';
import ModelViewerGizmo from '@/components/ui/ModelViewerGizmo';
import { highlight, langFromPath, langLabel, syntaxColor, type FilePreviewKind } from './highlight';

// 树里收集所有目录路径(默认全展开,与 Figma 一致)
function collectDirs(nodes: FileNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) if (n.type === 'dir') { acc.add(n.path); collectDirs(n.children ?? [], acc); }
  return acc;
}
// 树里收集所有文件(搜索时扁平过滤用)
function collectFiles(nodes: FileNode[], acc: FileNode[] = []): FileNode[] {
  for (const n of nodes) {
    if (n.type === 'file') acc.push(n);
    else collectFiles(n.children ?? [], acc);
  }
  return acc;
}

function fileIcon(path: string): string {
  return path.toLowerCase().endsWith('.json') ? figAsset.fileJson : figAsset.fileCode;
}

// 文件树行(递归):目录可折叠,文件可选中(选中态品牌橙 wash 底)。
function TreeRows({
  nodes, depth, expanded, toggle, selectedPath, onSelect,
}: {
  nodes: FileNode[]; depth: number; expanded: Set<string>;
  toggle: (p: string) => void; selectedPath: string | null; onSelect: (p: string) => void;
}) {
  return (
    <>
      {nodes.map((n) => {
        const isDir = n.type === 'dir';
        const open = expanded.has(n.path);
        const selected = !isDir && n.path === selectedPath;
        return (
          <div key={n.path}>
            <button
              type="button"
              onClick={() => (isDir ? toggle(n.path) : onSelect(n.path))}
              aria-expanded={isDir ? open : undefined}
              className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-[13px] transition-colors ${
                selected ? 'bg-[var(--color-code-sel)] text-white' : 'text-[var(--color-code-text)] hover:bg-[var(--color-code-hover)]'
              }`}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              <FigIcon
                src={isDir ? (open ? figAsset.chevronDown : figAsset.chevronRight) : figAsset.chevronRight}
                size={14}
                tone="secondary"
                className={isDir ? '' : 'opacity-0'}
              />
              <FigIcon src={isDir ? figAsset.folder : fileIcon(n.path)} size={14} tone="secondary" />
              <span className="truncate">{n.name}</span>
            </button>
            {isDir && open && n.children && (
              <TreeRows nodes={n.children} depth={depth + 1} expanded={expanded} toggle={toggle} selectedPath={selectedPath} onSelect={onSelect} />
            )}
          </div>
        );
      })}
    </>
  );
}

// Files tab 视图:渲染在预览舞台区(Workspace 在 Files tab 时展开预览面板覆盖画布),
// 左 260px 文件树 + 右只读代码视图(行号 + 轻量高亮)。数据来自 versions/current/files 接口。
export default function FilesView() {
  const { t } = useTranslation();
  const { tree, loading, error, selectedPath, selectFile, selectedKind, selectedPreviewUrl, content, contentLoading, contentError } = useVersionFiles();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState(false);

  // 默认全展开(首次拿到树时);用户手动折叠后不再强制
  const allDirs = useMemo(() => collectDirs(tree), [tree]);
  const effExpanded = touched ? expanded : allDirs;
  const toggle = (p: string) => {
    const next = new Set(effExpanded);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setExpanded(next);
    setTouched(true);
  };

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return collectFiles(tree).filter((f) => f.path.toLowerCase().includes(q));
  }, [query, tree]);

  const lang = selectedPath ? langFromPath(selectedPath) : 'text';
  // 仅文本才高亮;媒体/二进制由 selectedPreviewUrl 直接渲染,无 content
  const lines = useMemo(() => (selectedKind === 'text' && content != null ? highlight(content, lang) : []), [selectedKind, content, lang]);
  // 类型徽标:文本走语言名,媒体/二进制走预览类型(IMAGE/VIDEO/AUDIO/3D/BINARY)
  const typeLabel = selectedKind === 'text' ? langLabel(lang) : selectedKind === '3d' ? '3D' : selectedKind.toUpperCase();
  const crumbs = selectedPath ? selectedPath.split('/').filter(Boolean) : [];

  return (
    // Files 视图配色对齐 Figma 647-24650,走 --color-code-* 语义 token(暗色专用,见 globals.css)。
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-canvas)]">
      {/* 面包屑栏 */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-line-2)] px-4 text-[13px] text-[var(--color-code-text)]">
        <FigIcon src={figAsset.globe} size={14} tone="secondary" />
        <span className="truncate font-mono">{crumbs.length ? crumbs.join(' / ') : 'src'}</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左:文件树(深底 #0A0A0A) */}
        <div className="flex w-[260px] shrink-0 flex-col border-r border-[var(--color-code-line)] bg-[var(--color-code-tree)]">
          <div className="shrink-0 p-4">
            <div className="flex items-center gap-2 rounded-[6px] border border-[var(--color-code-line)] bg-[var(--color-code-input)] px-3 py-2">
              <FigIcon src={figAsset.search} size={14} tone="secondary" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('preview.searchFiles')}
                className="w-full bg-transparent text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-code-text-dim)] focus:outline-none"
              />
            </div>
          </div>
          <div className="scrollbar-auto min-h-0 flex-1 overflow-y-auto pb-2">
            {loading ? (
              <p className="px-4 py-3 text-[12px] text-[var(--color-muted)]">{t('preview.loadingFiles')}</p>
            ) : error ? (
              <p className="px-4 py-3 text-[12px] text-[var(--color-muted)]">{error}</p>
            ) : matches ? (
              matches.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-[var(--color-muted)]">{t('preview.noMatchingFiles')}</p>
              ) : (
                matches.map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => selectFile(f.path)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors ${
                      f.path === selectedPath ? 'bg-[var(--color-code-sel)] text-white' : 'text-[var(--color-code-text)] hover:bg-[var(--color-code-hover)]'
                    }`}
                  >
                    <FigIcon src={fileIcon(f.path)} size={14} tone="secondary" />
                    <span className="truncate">{f.path.replace(/^src\//, '')}</span>
                  </button>
                ))
              )
            ) : (
              <TreeRows nodes={tree} depth={0} expanded={effExpanded} toggle={toggle} selectedPath={selectedPath} onSelect={selectFile} />
            )}
          </div>
        </div>

        {/* 右:代码视图 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-code-line)] px-6">
            <span className="truncate font-mono text-[13px] text-[var(--color-code-text)]">
              {selectedPath ? crumbs.join(' / ') : t('preview.noFileSelected')}
            </span>
            {selectedPath && (
              <span className="rounded-[4px] border border-[var(--color-code-line)] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[var(--color-code-text-dim)] uppercase">
                {typeLabel}
              </span>
            )}
          </div>
          <div className="scrollbar-auto min-h-0 flex-1 overflow-auto">
            {contentLoading ? (
              <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{t('preview.loading')}</p>
            ) : contentError ? (
              <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{contentError}</p>
            ) : selectedPath == null ? (
              <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{t('preview.selectFileHint')}</p>
            ) : selectedKind !== 'text' ? (
              // key=path:切换文件即重挂载,避免复用旧 <img>/<video> 节点在新资源加载完成前残留上一个文件
              <MediaPreview key={selectedPath} kind={selectedKind} url={selectedPreviewUrl} path={selectedPath} />
            ) : content == null ? (
              <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{t('preview.selectFileHint')}</p>
            ) : (
              <pre className="min-w-max py-2 font-mono text-[13px] leading-5">
                {lines.map((toks, i) => (
                  <div key={i} className="flex">
                    <span className="sticky left-0 w-12 shrink-0 select-none bg-[var(--color-canvas)] pr-4 text-right text-[var(--color-code-text-dim)]">
                      {i + 1}
                    </span>
                    <code className="whitespace-pre px-4 text-[var(--color-ink)]">
                      {toks.length === 0 ? ' ' : toks.map((t, j) => (
                        <span key={j} style={{ color: syntaxColor(t.type) }}>{t.text}</span>
                      ))}
                    </code>
                  </div>
                ))}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 媒体 / 二进制文件预览:用同源代理 URL 直接渲染对应媒体,避免把字节当文本显示出乱码。
function MediaPreview({ kind, url, path }: { kind: FilePreviewKind; url: string | null; path: string }) {
  const { t } = useTranslation();
  const name = path.split('/').pop() || path;
  if (!url) return <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{t('preview.selectFileHint')}</p>;
  if (kind === 'image') {
    return (
      <div className="anim-media-in flex h-full items-center justify-center p-6">
        <img src={url} alt={name} decoding="async" className="max-h-full max-w-full rounded-[8px] object-contain" />
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div className="anim-media-in flex h-full items-center justify-center p-6">
        <audio src={url} controls className="w-full max-w-[480px]" />
      </div>
    );
  }
  if (kind === 'video') {
    return (
      <div className="anim-media-in flex h-full items-center justify-center p-6">
        <video src={url} controls preload="metadata" className="max-h-full max-w-full rounded-[8px]" />
      </div>
    );
  }
  if (kind === '3d') return <ThreeDPreview src={url} alt={name} />;
  // binary:无法内联预览,给文件名 + 提示 + 新标签打开(走代理下载/查看)
  return (
    <div className="anim-media-in flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <FigIcon src={figAsset.fileCode} size={32} tone="secondary" />
      <p className="font-mono text-[13px] text-[var(--color-code-text)]">{name}</p>
      <p className="text-[12px] text-[var(--color-muted)]">{t('preview.binaryFileHint')}</p>
      <a href={url} target="_blank" rel="noreferrer" className="text-[13px] text-[var(--color-primary)] hover:underline">
        {t('preview.openInNewTab')}
      </a>
    </div>
  );
}

// 3D(glb/gltf):懒加载 model-viewer 后渲染可旋转预览(复用 ThreeDNode 的属性写法)
function ThreeDPreview({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  const ready = useModelViewer();
  // 元素进 state:空间指示器是子组件,要靠它变化触发自己的订阅(ref 赋值不引起重渲)
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  if (!ready) return <p className="px-4 py-3 text-[13px] text-[var(--color-muted)]">{t('common.loading3d')}</p>;
  return (
    <div className="anim-media-in relative h-full w-full p-6">
      <model-viewer
        ref={setViewer}
        src={src}
        alt={alt}
        camera-controls
        auto-rotate
        interaction-prompt="none"
        loading="lazy"
        style={{ width: '100%', height: '100%', minHeight: '320px', background: 'var(--color-canvas)' }}
      />
      {/* 空间指示器:与 lightbox 同一个组件(此处同样是 camera-controls 可拖) */}
      <ModelViewerGizmo viewer={viewer} className="absolute bottom-7 right-7" />
    </div>
  );
}
