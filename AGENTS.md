# AGENTS.md — rezonalab-game-web

本文件给所有 AI agent 读(ChatGPT Codex 代码审查、以及任何编码 agent)。**完整工程规范见
`CLAUDE.md`**(项目概览、分层结构、单向数据流、UI/UX 范式、反模式、环境变量);本文件只摘出
**审查红线**与 **agent PR 闭环入口**。与 `CLAUDE.md` 不一致时,以 `CLAUDE.md` 为准并同步修正本文件。

## 项目一句话

Rezona Lab Game Agent —— Next.js 16 + React 19 的创作向 AI 游戏生成平台前端(BFF)。前端**不直接调 LLM**:
agent 对话经 WebSocket 直连后端 **Koubou**,资产/版本经 REST 走 **PGC**(两者同址、共用 cookie 制鉴权)。
所有外部输入汇入**唯一的 zustand store**,UI 各栏只订阅/调 action,单向数据流。

## 代码审查红线(Codex review 重点盯这些)

1. **尊重后端契约,不臆测字段**:只取文档约定字段(snake_case),**不加推测性 camelCase 兜底**;
   尊重契约类型(如 `canvas_x/y` 取整匹配后端 int),不自作主张加别名/浮点。
2. **不覆盖前端拥有的坐标**:位置归前端所有;轮询/重连/服务端旧坐标**不得**冲掉已落位的 `position`。
3. **错误分层兜底**:`guard()` 之外**不 catch 非预期错误**(留给它暴露 bug);代理层把上游/鉴权失败
   收敛为 502 + JSON 信封(非裸 500);非法 WS 帧 `try/catch` 跳过。
4. **持久化纪律**:连接状态、`sequence=null` 的 live 流式增量**不落盘**;只在可重放检查点持久化,
   保证 `lastSequence ↔ messages` 一致。
5. **唯一落库入口 + 纯函数**:状态变更走纯函数 reducer(`applyKoubou`)/ action,返回新对象、不可变更新;
   `store` 是唯一真相源,组件只 `subscribe`/调 action,跨组件协调走 store 字段,**不互相直连**。
   action 内每个 `await` 之后必校验 `if (get().currentProjectId !== pid) return;`,丢弃过期响应。
6. **basePath 纪律**:`fetch`/`WebSocket`/`<img src>` 指向本服务自身的 `/api/...` 或 `public/`,
   **必须**经 `src/lib/basePath.ts` 的 `apiPath()`/`assetPath()` 包一层,否则部署在 `/game/*` 下会被
   LB 路由到别的后端。
7. **UI/UX 范式(新增 UI 必守)**:颜色一律走 CSS 变量(`bg-[var(--color-surface)]`),**禁硬编码色值**
   (`bg-gray-100`/`#fff`);**复用既有令牌/基础组件(`FigIcon`/`Button`/`IconButton`/`Toast`)/ 动效类**,
   **禁**一次性 keyframes、新按钮种类、自造 toast;交互元素配 `aria-label` 或 `Tooltip`;
   新动画在 `prefers-reduced-motion` 内退化。详见 `CLAUDE.md` 的「UI/UX 范式」。
8. **类型与风格**:TS 类型显式,**禁止隐式 `any`**;`eslint-disable` 必带 `-- 理由`;注释解释
   **「为什么」**(竞态/不变式/后端契约)而非「做什么」,中文。
9. **不留 dead code**:新增能力优先替换旧机制,不堆叠废弃机制、不留测试导向的生产代码
   (历史已删 d3-force/`pinned`/mock 兜底等,勿重新引入)。

## 提交前必过的本地门(与 `.github/workflows/ci.yml` 一致)

```bash
pnpm lint                 # eslint
pnpm exec tsc --noEmit    # 类型检查
pnpm test                 # vitest run
pnpm build                # next build
```

## PR 提交与自改闭环(编码 agent 标准流程)

编码 agent「写代码并提交」时走完整闭环,**变绿且评论处理完才算完成**:

1. 功能分支 commit(Conventional Commit,英文,**不加 Co-Authored-By**;代码注释/计划/commit message
   一律中文)→ `gh pr create --base main`。
2. **进入等待+轮询**,反复执行直到收敛:
   - `gh pr checks <n>`:看 CI(`ci.yml` 的 lint/tsc/test/build)。
   - `gh pr view <n> --comments` 与 `gh api repos/rezona-ai/rezonalab-game-web/pulls/<n>/reviews`:
     取 **Codex bot** 与人工评论。
   - 运行期可用 `/loop` 或后台任务实现「自己等 comments」,无需人盯。
3. 任一 check 红 / 有未决 bot 或人工评论 → 读日志+评论 → **本地改** → push(自动重跑)。
4. **完成判据**:所有 required check 绿 **且** Codex review 无未决意见(评论已处理)。
5. 满足后再合入 `main`。

> **注(当前约束)**:
> ① 分支拓扑维持 feature→main,本次不改。
> ② 仓库**尚未配分支保护**(`required_conversation_resolution` / required status check),
>    故本规定当前**靠 agent 自觉执行,无 GitHub 层强制力**——人手动点 Merge 仍能绕过;
>    待 repo admin 配上分支保护后转为硬约束。
> ③ ChatGPT Codex Connector(org 级 GitHub App)**尚未覆盖本仓** —— 在 org owner 把 rezonalab-game-web
>    加进 chatgpt.com Codex 后台的 repository access 前,**不会有 bot 评论**;本文件先就位,
>    接入后即作为 Codex 的审查依据生效。
