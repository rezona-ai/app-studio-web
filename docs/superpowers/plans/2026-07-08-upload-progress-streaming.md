# 上传进度真实化实现计划（代理流式转发 + 处理中文案）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PGC catch-all 代理对带体请求改流式透传（浏览器上传进度受上游背压牵引而真实化）；弹窗在字节发完后把「100%」切成「正在处理压缩包…」。

**Architecture:** route 层不再 `arrayBuffer()` 缓冲、直接把 `req.body` 流交给 `proxyFetch`；`proxyFetch` 检测流式 body 附加 `duplex: 'half'`（undici 约束）。弹窗仅改 `stepText` 派生逻辑 + 一个 i18n key。

**Tech Stack:** Next.js 16 route handler、undici fetch（duplex half）、vitest。

**Spec:** `docs/superpowers/specs/2026-07-08-upload-progress-streaming-design.md`（含失败预案：上游拒收 chunked 则回退缓冲，实现前先读）。

## Global Constraints

- 执行前基于 dev 建 worktree `feat/upload-progress-streaming`（`.claude/worktrees/feat+upload-progress-streaming`）；完成后 `--no-ff` 回合 dev（message 含分支名）并清理。
- 注释 / commit message 中文；注释解释「为什么」（背压/undici duplex 约束）。
- Koubou 代理不动；仅 PGC catch-all 路由与 `proxyFetch`。
- 流式后无 content-length（chunked）——**必须真实后端验证**（Task 3）：chunked multipart 导入成功 + chunked JSON（新建项目）不回归；若上游 411/400 拒收，停止并回退缓冲、向控制层报 BLOCKED（按 spec 失败预案走）。
- i18n 六语同构（en 真相源）。
- 验证只信命令退出码（worktree IDE 诊断有已知误报）。

---

### Task 1: 代理流式转发

**Files:**
- Modify: `src/app/api/pgc/[...path]/route.ts:27`（body 取流）
- Modify: `src/server/pgc/proxy.ts`（`ProxyInit.body` 类型扩流 + duplex）
- Test: `src/app/api/pgc/[...path]/route.test.ts`、`src/server/pgc/proxy.test.ts`

**Interfaces:**
- Produces: `proxyFetch` 行为——body 为 `ReadableStream` 时 fetch init 含 `duplex: 'half'`；route 对 POST/PATCH/PUT 直接传 `req.body`。

- [ ] **Step 1: 写失败测试**

`src/server/pgc/proxy.test.ts` 追加（沿用该文件既有 fetch stub 样板；若样板不同按现状适配，断言不变）：

```ts
describe('proxyFetch 流式 body', () => {
  test('body 为 ReadableStream → fetch 附 duplex: half', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
    vi.stubGlobal('fetch', f);
    vi.stubEnv('PGC_BASE_URL', 'https://pgc.example');
    const stream = new ReadableStream<Uint8Array>();
    await proxyFetch('POST', '/api/projects/import', { body: stream });
    expect(f.mock.calls[0][1]).toMatchObject({ duplex: 'half', body: stream });
  });

  test('body 为 Buffer/undefined → 不附 duplex', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: null });
    vi.stubGlobal('fetch', f);
    vi.stubEnv('PGC_BASE_URL', 'https://pgc.example');
    await proxyFetch('POST', '/api/projects', { body: Buffer.from('{}') });
    expect(f.mock.calls[0][1]).not.toHaveProperty('duplex');
    await proxyFetch('GET', '/api/projects', {});
    expect(f.mock.calls[1][1]).not.toHaveProperty('duplex');
  });
});
```

`src/app/api/pgc/[...path]/route.test.ts` 追加（`mockReq` 替身补 `body` 成员，`arrayBuffer` 改为抛错哨兵——确保实现绝不再回退到缓冲）：

```ts
// mockReq 增强:补 body 流成员;arrayBuffer 置哨兵(流式化后绝不该再被调用)
function mockStreamReq(headers: Record<string, string>, method = 'POST'): NextRequest {
  const body = new ReadableStream<Uint8Array>();
  return {
    method,
    headers: { get: (k: string): string | null => headers[k.toLowerCase()] ?? null },
    body,
    arrayBuffer: async (): Promise<ArrayBuffer> => { throw new Error('不应整包缓冲'); },
    nextUrl: { search: '' },
  } as unknown as NextRequest;
}

describe('pgc proxy route — 带体请求流式透传', () => {
  test('POST 把 req.body 流原样交给 proxyFetch(不缓冲)', async () => {
    const req = mockStreamReq({ 'content-type': 'multipart/form-data; boundary=x' });
    await POST(req, ctx(['api', 'projects', 'import']));
    expect(proxyMock).toHaveBeenCalledWith(
      'POST',
      '/api/projects/import',
      expect.objectContaining({ body: (req as unknown as { body: ReadableStream }).body }),
    );
  });
});
```

既有 POST 用例若依赖 `arrayBuffer` 返回 Buffer 的断言，按新行为改为断言 body 传流（语义不变：转发到位）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/server/pgc/proxy.test.ts "src/app/api/pgc/[...path]/route.test.ts"`
Expected: FAIL —— 现实现缓冲 + 无 duplex。

- [ ] **Step 3: 实现**

`route.ts:27` 一行替换：

```ts
  // 带体请求流式透传(不整包缓冲):浏览器上传进度受「代理→PGC」背压牵引,近似真实端到端;
  // 代价是转发变 chunked(无 content-length),上游接受度已经真实链路验证(见 spec)
  const body = hasBody ? req.body : undefined;
```

`proxy.ts`：

```ts
export interface ProxyInit {
  body?: BodyInit | ReadableStream<Uint8Array> | null;
  headers?: Record<string, string>;
  search?: string; // 含前导 ?
  requestId?: string; // 链路关联 id，仅用于本层错误日志（x-request-id 已在 headers 里随 fetch 转发）
}
```

fetch 调用处：

```ts
    const res = await fetch(url, {
      method,
      headers: { ...init.headers },
      body: init.body ?? undefined,
      // undici 约束:流式 request body 必须显式声明半双工,否则直接抛错
      ...(init.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
    } as RequestInit);
```

（TS lib 的 RequestInit 无 duplex 字段，用 `as RequestInit` 收口；不要 `any`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/server src/app && pnpm exec tsc --noEmit`
Expected: PASS（koubou proxy 等既有测试不回归）。

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/pgc/[...path]/route.ts" "src/app/api/pgc/[...path]/route.test.ts" src/server/pgc/proxy.ts src/server/pgc/proxy.test.ts
git commit -m "feat: PGC 代理带体请求流式透传(上传进度背压真实化)"
```

---

### Task 2: 处理中文案（i18n + 弹窗）

**Files:**
- Modify: `src/i18n/locales/{en,zh,fr,ru,ja,vi}.ts`（`importGame` 块加 `stepProcessing`）
- Modify: `src/components/chat/ImportProjectModal.tsx:64`（stepText 分支）
- Test: `src/components/chat/ImportProjectModal.test.tsx`

**Interfaces:**
- Consumes: 既有 `importArchiveStatus`。
- Produces: `chat.importGame.stepProcessing` 六语。

- [ ] **Step 1: 写失败测试**（`ImportProjectModal.test.tsx` 的「上传阶段」describe 追加）

```tsx
  test('progress 满格后文案切为处理中(不再显示 100%)', () => {
    useStore.setState({ importArchiveStatus: { step: 'uploading', progress: 1, done: 0, total: 0 } } as never);
    render(<ImportProjectModal onClose={() => {}} />);
    expect(screen.getByText('Processing archive…')).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

六语 `importGame` 块（`stepUploading` 行后）追加：

| key | en | zh | fr | ru | ja | vi |
|---|---|---|---|---|---|---|
| stepProcessing | Processing archive… | 正在处理压缩包… | Traitement de l'archive… | Обработка архива… | アーカイブを処理中… | Đang xử lý tệp nén… |

`ImportProjectModal.tsx` stepText 的 uploading 分支替换：

```ts
    // 字节发完但请求未返回(代理转发尾巴+服务端解包):切「处理中」,避免挂死在 100% 的观感
    status.step === 'uploading' ? (
      status.progress >= 1 ? t('chat.importGame.stepProcessing')
      : t('chat.importGame.stepUploading', { percent: Math.round(status.progress * 100) }))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/ImportProjectModal.test.tsx src/i18n && pnpm exec tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/i18n/locales src/components/chat/ImportProjectModal.tsx src/components/chat/ImportProjectModal.test.tsx
git commit -m "feat: 上传满格后展示处理中文案(六语)"
```

---

### Task 3: 门禁 + 真实后端运行态验证 + 收尾

**Files:** 无新增（验证 + 可能的修正）。

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全部 exit 0。

- [ ] **Step 2: 真实后端验证（关键——chunked 上游接受度）**

worktree 已拷 `.env`（含 `PGC_BASE_URL`/`DEV_COOKIE`），起 prod 服务连**真实 PGC**（不 mock）：

1. `dd if=/dev/urandom of=/tmp/big.bin bs=1m count=8 && cd /tmp && zip sp-test-import.zip big.bin`（约 8MB 压缩包，不可压缩内容保证传输量）；
2. Playwright 打开工作台 → 导入弹窗 → 选该 zip：断言进度**渐进爬升**（采样 ≥2 个 0<p<100 的中间值）、满格后出现「Processing archive…」、最终导入成功切到新项目；
3. 回归 chunked JSON：UI 新建一个项目成功（POST /api/projects 经流式代理）；
4. 清理：把测试导入的项目与新建项目从 UI 删除；
5. **失败预案**：若上传得到 411/400（上游拒收 chunked），停止执行，回退 route/proxy 改动（保留 Task 2），报 BLOCKED 交控制层向 Nick 汇报。

- [ ] **Step 3: 若有修正则提交**

```bash
git add -A && git commit -m "fix: 上传进度流式化联调修正"
```

- [ ] **Step 4: 收尾**

按 superpowers:finishing-a-development-branch 回合 dev（`--no-ff`，message 含 `feat/upload-progress-streaming`），删分支清 worktree；合并前 `git log` 校验提交落点。
