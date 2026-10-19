'use client';
/* eslint-disable react-hooks/set-state-in-effect --
   本 hook 用 effect 把服务端文件清单/内容同步进 React 态(标准数据获取场景):
   触发时同步置 loading/重置态,结果在异步回调里落定。与 Workspace.tsx 同款豁免。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store';
import { pgcApi, PgcError } from '@/lib/pgc/client';
import { apiPath } from '@/lib/basePath';
import type { VersionFileData } from '@/lib/pgc/types';
import { filePreviewKind, type FilePreviewKind } from '@/components/files/highlight';

// 直连 preview_url 会跨域 CORS;走同源 BFF 代理 /api/pgc/asset(服务端取再同源返回,
// 内部按 PGC_PREFIX 解析相对 /pv/... 地址)。preview 字节无需鉴权。
const proxiedPreview = (previewUrl: string) =>
  `${apiPath('/api/pgc/asset')}?url=${encodeURIComponent(previewUrl)}`;

// 文件树节点:目录 children 非空,文件带 size/previewUrl。
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  previewUrl?: string;
  children?: FileNode[];
}

// 扁平清单 → 嵌套树。path 恒以 src/ 开头;同层目录在前、文件在后,各自按名排序。
function buildTree(items: VersionFileData[]): FileNode[] {
  const root: FileNode = { name: '', path: '', type: 'dir', children: [] };
  for (const it of items) {
    const segs = it.path.split('/').filter(Boolean);
    let cur = root;
    segs.forEach((seg, i) => {
      const isLeaf = i === segs.length - 1;
      const path = segs.slice(0, i + 1).join('/');
      let next = cur.children!.find((c) => c.name === seg);
      if (!next) {
        next = isLeaf
          ? { name: seg, path, type: 'file', size: it.size, previewUrl: it.preview_url }
          : { name: seg, path, type: 'dir', children: [] };
        cur.children!.push(next);
      }
      cur = next;
    });
  }
  const sort = (nodes: FileNode[]): FileNode[] =>
    nodes
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n));
  return sort(root.children ?? []);
}

// 默认选中:优先 index.html,否则首个文件(深度优先)。
function pickDefault(items: VersionFileData[]): string | null {
  if (items.length === 0) return null;
  return (items.find((f) => /(^|\/)index\.html$/.test(f.path)) ?? items[0]).path;
}

export interface VersionFilesResult {
  tree: FileNode[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  selectFile: (path: string) => void;
  // 选中文件的预览类型:text 才有 content;媒体/二进制改用 selectedPreviewUrl 渲染
  selectedKind: FilePreviewKind;
  // 选中文件的同源代理 URL(供 <img>/<video>/<audio>/<model-viewer> 及二进制「打开」用)
  selectedPreviewUrl: string | null;
  content: string | null;
  contentLoading: boolean;
  contentError: string | null;
}

// 拉取「选中版本」源码文件清单(file/code 只读浏览)。仅在挂载时(= Files tab 激活)触发;
// 跟随时间轴选中版本(activeVersionId 即后端 version_id),未选中回落 current;
// 文件内容不内联,选中后用 preview_url 经 resolveAssetUrl 按需取并缓存。
export function useVersionFiles(): VersionFilesResult {
  const projectId = useStore((s) => s.currentProjectId);
  const versionId = useStore((s) => s.activeVersionId);
  const [items, setItems] = useState<VersionFileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  // 已取内容缓存,按 path;避免重复 fetch
  const cache = useRef<Map<string, string>>(new Map());

  // 清单拉取:项目 / 选中版本变更重取;await 后校验未切换再写入
  useEffect(() => {
    if (projectId == null) { setItems([]); setLoading(false); setError(null); return; }
    let aborted = false;
    setLoading(true);
    setError(null);
    cache.current.clear();
    void pgcApi
      .listVersionFiles(projectId, versionId ?? 'current')
      .then((data) => {
        if (aborted) return;
        setItems(data.items);
        setSelectedPath(pickDefault(data.items));
      })
      .catch((e) => {
        if (aborted) return;
        setItems([]);
        setSelectedPath(null);
        setError(e instanceof PgcError ? e.message : 'Failed to load files');
      })
      .finally(() => { if (!aborted) setLoading(false); });
    return () => { aborted = true; };
  }, [projectId, versionId]);

  const tree = useMemo(() => buildTree(items), [items]);

  // 选中文件 → 取内容(命中缓存则同步返回)
  useEffect(() => {
    if (!selectedPath) { setContent(null); setContentError(null); setContentLoading(false); return; }
    const file = items.find((f) => f.path === selectedPath);
    if (!file) { setContent(null); setContentLoading(false); return; }
    // 媒体/二进制不取文本(原始字节按 UTF-8 解码会出乱码);组件用 selectedPreviewUrl 直接渲染
    if (filePreviewKind(selectedPath) !== 'text') { setContent(null); setContentError(null); setContentLoading(false); return; }
    const cached = cache.current.get(selectedPath);
    if (cached != null) { setContent(cached); setContentError(null); setContentLoading(false); return; }
    if (!file.preview_url) { setContent(null); setContentError('Preview unavailable'); setContentLoading(false); return; }
    const url = proxiedPreview(file.preview_url);
    let aborted = false;
    setContentLoading(true);
    setContentError(null);
    void fetch(url, { credentials: 'include' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); })
      .then((text) => { if (aborted) return; cache.current.set(file.path, text); setContent(text); })
      .catch(() => { if (!aborted) { setContent(null); setContentError('Failed to load file'); } })
      .finally(() => { if (!aborted) setContentLoading(false); });
    return () => { aborted = true; };
  }, [selectedPath, items]);

  const selectFile = useCallback((path: string) => setSelectedPath(path), []);

  const selectedKind: FilePreviewKind = selectedPath ? filePreviewKind(selectedPath) : 'text';
  const selectedPreviewUrl = useMemo(() => {
    if (!selectedPath) return null;
    const file = items.find((f) => f.path === selectedPath);
    return file?.preview_url ? proxiedPreview(file.preview_url) : null;
  }, [selectedPath, items]);

  return { tree, loading, error, selectedPath, selectFile, selectedKind, selectedPreviewUrl, content, contentLoading, contentError };
}
