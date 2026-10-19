# Skill 选择功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composer 输入 `/` 唤起 Skill 弹窗，选中后以内联青色胶囊呈现（底衬高亮），消息以纯文本 `/slug` 前缀发送。

**Architecture:** 纯函数（斜杠解析/token 切分/过滤）下沉 `src/lib/skills.ts`；skill 列表经 `koubouApi.listSkills` 全局拉一次进 store（镜像 `availableModels` 模式）；显示名/描述由 i18n 词典按 slug 映射（六语，缺失降级 slug）；胶囊用 textarea 底衬镜像层实现，draft 数据模型与发送链路零改动。

**Tech Stack:** Next.js 16 + React 19、zustand、react-i18next、Vitest(jsdom)。

**Spec:** `docs/superpowers/specs/2026-07-06-skill-selector-design.md`

## Global Constraints

- 按用户约定：实现前基于 dev 建 worktree `feat/skill-selector`，完成后 `--no-ff` 回合 dev 并清理。
- 代码注释 / commit message 一律中文；commit 一句话总结。
- 颜色/圆角/阴影只用 `globals.css` 既有令牌：胶囊底 `--color-teal-soft`（设计稿 rgba(31,212,207,0.2) 与其精确相等）、圆角 4px、文字 `--color-ink`；浮层 `bg-[var(--color-pop)]` + `shadow-[var(--shadow-popover)]` + `backdrop-blur-[6px]` + `.anim-pop-in`。不新增 keyframes。
- 文案全走 i18n（en 真相源，zh/fr/ru/ja/vi 同步补齐；en 缺 key 编译期报错机制已由 `Messages` 类型保证）。
- 后端契约（apifox 已确认）：`GET /game/koubou/skills?backend=cc` → `{ code:0, message, data:{ backend, skills:[{ name }] } }`。只取 `name`，不臆测其他字段。
- 镜像层不变式：任何样式不得改变文本流布局（不给字符流加水平 padding/margin），否则光标错位。
- 测试与源码同目录 `*.test.ts(x)`；每个 task 结束跑对应测试并提交。

---

### Task 1: 斜杠解析与 token 切分纯函数

**Files:**
- Create: `src/lib/skills.ts`
- Test: `src/lib/skills.test.ts`

**Interfaces:**
- Produces:
  - `interface ActiveSlash { query: string; start: number }`
  - `getActiveSlash(text: string, caret: number): ActiveSlash | null`
  - `interface SkillSegment { kind: 'plain' | 'skill'; text: string }`
  - `splitSkillTokens(text: string, skills: string[]): SkillSegment[]`
  - `filterSkills(slugs: string[], query: string, resolveName: (slug: string) => string): string[]`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/skills.test.ts
import { describe, it, expect } from 'vitest';
import { getActiveSlash, splitSkillTokens, filterSkills } from './skills';

describe('getActiveSlash', () => {
  it('串首 / 激活，query 为其后片段', () => {
    expect(getActiveSlash('/pl', 3)).toEqual({ query: 'pl', start: 0 });
  });
  it('空白后的 / 激活（任意位置）', () => {
    expect(getActiveSlash('fix it /cu', 10)).toEqual({ query: 'cu', start: 7 });
  });
  it('换行后的 / 激活', () => {
    expect(getActiveSlash('a\n/p', 4)).toEqual({ query: 'p', start: 2 });
  });
  it('词中 / 不激活（如 URL 的 //）', () => {
    expect(getActiveSlash('http://x', 8)).toBeNull();
  });
  it('/ 与光标间含空白则关闭', () => {
    expect(getActiveSlash('/plan go', 8)).toBeNull();
  });
  it('无 / 返回 null', () => {
    expect(getActiveSlash('hello', 5)).toBeNull();
  });
  it('只看光标前文本', () => {
    expect(getActiveSlash('ab /cd', 2)).toBeNull();
  });
});

describe('splitSkillTokens', () => {
  const skills = ['plan', 'char-ref'];
  it('切出词首的已知 skill token', () => {
    expect(splitSkillTokens('/plan do it', skills)).toEqual([
      { kind: 'skill', text: '/plan' },
      { kind: 'plain', text: ' do it' },
    ]);
  });
  it('多 token 与中段 token', () => {
    expect(splitSkillTokens('a /plan b /char-ref', skills)).toEqual([
      { kind: 'plain', text: 'a ' },
      { kind: 'skill', text: '/plan' },
      { kind: 'plain', text: ' b ' },
      { kind: 'skill', text: '/char-ref' },
    ]);
  });
  it('未知 slug 不切分', () => {
    expect(splitSkillTokens('/nope x', skills)).toEqual([{ kind: 'plain', text: '/nope x' }]);
  });
  it('词中 / 不切分', () => {
    expect(splitSkillTokens('http://plan', skills)).toEqual([{ kind: 'plain', text: 'http://plan' }]);
  });
  it('紧跟标点不算词尾边界，不切分', () => {
    expect(splitSkillTokens('/plan, go', skills)).toEqual([{ kind: 'plain', text: '/plan, go' }]);
  });
  it('空文本与空 skills', () => {
    expect(splitSkillTokens('', skills)).toEqual([]);
    expect(splitSkillTokens('/plan', [])).toEqual([{ kind: 'plain', text: '/plan' }]);
  });
});

describe('filterSkills', () => {
  const names: Record<string, string> = { plan: 'Game Design', cutout: 'Smart Cutout' };
  const resolve = (s: string) => names[s] ?? s;
  it('slug 与显示名都参与过滤（不区分大小写）', () => {
    expect(filterSkills(['plan', 'cutout'], 'game', resolve)).toEqual(['plan']);
    expect(filterSkills(['plan', 'cutout'], 'cut', resolve)).toEqual(['cutout']);
  });
  it('空 query 返回全量', () => {
    expect(filterSkills(['plan', 'cutout'], '', resolve)).toEqual(['plan', 'cutout']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/lib/skills.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```ts
// src/lib/skills.ts
// Skill 斜杠命令的纯逻辑:光标处斜杠解析、draft 内已知 skill token 切分、弹窗过滤。
// token 语义与发送契约一致:词首 `/` + slug + 词尾边界(空白/串尾),序列化即字面文本。

export interface ActiveSlash { query: string; start: number }

// 返回光标处正在输入的斜杠命令(最近的词首 '/' 到光标,中间不含空白);与 getActiveMention 同型
export function getActiveSlash(text: string, caret: number): ActiveSlash | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('/');
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // 仅词首激活,排除 URL 等词中 '/'
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { query, start: at };
}

export interface SkillSegment { kind: 'plain' | 'skill'; text: string }

// 把文本切成 plain/skill 片段供底衬高亮;仅「词首 / + 已知 slug + 词尾边界」记为 skill
export function splitSkillTokens(text: string, skills: string[]): SkillSegment[] {
  if (!text) return [];
  if (skills.length === 0) return [{ kind: 'plain', text }];
  const known = new Set(skills);
  const segs: SkillSegment[] = [];
  let last = 0;
  const re = /\/(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > 0 && !/\s/.test(text[m.index - 1])) continue; // 词中 '/'
    if (!known.has(m[1])) continue;
    if (m.index > last) segs.push({ kind: 'plain', text: text.slice(last, m.index) });
    segs.push({ kind: 'skill', text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ kind: 'plain', text: text.slice(last) });
  return segs;
}

// 弹窗过滤:query 同时匹配 slug 与本地化显示名,不区分大小写
export function filterSkills(slugs: string[], query: string, resolveName: (slug: string) => string): string[] {
  const q = query.toLowerCase();
  return slugs.filter((s) => s.toLowerCase().includes(q) || resolveName(s).toLowerCase().includes(q));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/lib/skills.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/skills.ts src/lib/skills.test.ts
git commit -m "feat: skill 斜杠命令纯逻辑(解析/切分/过滤)"
```

---

### Task 2: listSkills API + store + 拉取 hook

**Files:**
- Modify: `src/lib/koubou/client.ts`（`koubouApi` 对象内追加）
- Modify: `src/store/index.ts`（镜像 `availableModels` 的三处：类型、初值、setter）
- Create: `src/client/useSkillList.ts`
- Modify: `src/components/workspace/Workspace.tsx`（`useModelList()` 旁挂 `useSkillList()`）
- Test: `src/client/useSkillList.test.tsx`

**Interfaces:**
- Consumes: 现有 `koubou<T>(method, path)` 私有 helper、`useStore`。
- Produces:
  - `koubouApi.listSkills(): Promise<string[]>`（slug 数组）
  - store 字段 `skills: string[]`、action `setSkills(skills: string[]): void`
  - `useSkillList(): void`（挂载拉一次，失败静默）

- [ ] **Step 1: 写失败测试**（镜像 `src/client/useModelList.test.tsx` 的写法，先读它对齐细节）

```tsx
// src/client/useSkillList.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useSkillList } from './useSkillList';
import { koubouApi } from '@/lib/koubou/client';
import { useStore } from '@/store';

function Probe() { useSkillList(); return null; }

afterEach(() => { vi.restoreAllMocks(); useStore.setState({ skills: [] }); });

describe('useSkillList', () => {
  it('挂载拉取一次并写入 store', async () => {
    vi.spyOn(koubouApi, 'listSkills').mockResolvedValue(['plan', 'cutout']);
    render(<Probe />);
    await waitFor(() => expect(useStore.getState().skills).toEqual(['plan', 'cutout']));
  });
  it('失败静默,列表保持空', async () => {
    vi.spyOn(koubouApi, 'listSkills').mockRejectedValue(new Error('down'));
    render(<Probe />);
    await waitFor(() => expect(koubouApi.listSkills).toHaveBeenCalled());
    expect(useStore.getState().skills).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/client/useSkillList.test.tsx`
Expected: FAIL（`listSkills` / `useSkillList` 不存在）

- [ ] **Step 3: 实现**

`src/lib/koubou/client.ts` 的 `koubouApi` 内追加（在 `listModels` 之后）：

```ts
  // 可选 skill 列表(GET /skills,公开接口):契约仅含 name(slug),显示名/描述由前端 i18n 映射;backend 本期固定 cc
  listSkills: () =>
    koubou<{ backend: string; skills: { name: string }[] }>('GET', '/skills?backend=cc')
      .then((d) => d.skills.map((s) => s.name)),
```

`src/store/index.ts` 三处（紧挨 `availableModels` 各处）：

```ts
  skills: string[];                        // UIState 类型区(65 行附近)
  setSkills: (skills: string[]) => void;   // Actions 类型区(83 行附近)
```

```ts
      skills: [],                          // 初值区(154 行附近)
```

```ts
      setSkills: (skills) => set({ skills }),   // action 区(207 行附近)
```

注意：`skills` **不加进 persist 的 partialize**（瞬态，随启动重取）。

```ts
// src/client/useSkillList.ts
'use client';
import { useEffect } from 'react';
import { useStore } from '@/store';
import { koubouApi } from '@/lib/koubou/client';

// 挂载时拉一次可选 skill 列表写入 store;全局一次性,失败静默(弹窗显示空态,不 Toast)
export function useSkillList() {
  useEffect(() => {
    let aborted = false;
    void koubouApi.listSkills()
      .then((skills) => { if (!aborted) useStore.getState().setSkills(skills); })
      .catch(() => { /* 静默:无 skill 时弹窗空态 */ });
    return () => { aborted = true; };
  }, []);
}
```

`src/components/workspace/Workspace.tsx`：import 后在 `useModelList();` 下一行加 `useSkillList();`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/client/useSkillList.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS + 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/lib/koubou/client.ts src/store/index.ts src/client/useSkillList.ts src/client/useSkillList.test.tsx src/components/workspace/Workspace.tsx
git commit -m "feat: 全局拉取 skill 列表进 store(listSkills + useSkillList)"
```

---

### Task 3: i18n 六语词条

**Files:**
- Modify: `src/i18n/locales/en.ts`、`zh.ts`、`fr.ts`、`ru.ts`、`ja.ts`、`vi.ts`

**Interfaces:**
- Produces（key 结构，六语同构）:
  - `chat.skill.title` / `chat.skill.empty` / `chat.skill.hint`
  - `skills.<slug>.name` / `skills.<slug>.description`，首批 slug：`plan`、`char-ref`、`cutout`、`sprite-animation`
- 用法约定：`t('skills.' + slug + '.name', { defaultValue: slug })` 实现未登记 slug 降级。

- [ ] **Step 1: en.ts 追加**（`chat` 对象内加 `skill`；顶层加 `skills`，与 `chat` 平级）

```ts
  // chat: { ... 现有内容, 追加:
    skill: {
      title: 'Skill',
      empty: 'No matching skill',
      hint: 'The agent will automatically invoke these skills.',
    },
  // },
  // 顶层追加(文案对齐设计稿):
  skills: {
    plan: { name: 'Game Design', description: 'Produce game design documents' },
    'char-ref': { name: 'Role Consistency', description: 'Make the same character consistent across scenes' },
    cutout: { name: 'Smart Cutout', description: 'Cut creatives into transparent PNG.' },
    'sprite-animation': { name: 'Elf Animation', description: 'Generate walking, attack and other frame animation sprite maps' },
  },
```

- [ ] **Step 2: 其余五语同构追加**（zh/fr/ru/ja/vi 已标注 `: Messages`，缺 key 编译期报错）

zh：
```ts
    skill: { title: 'Skill', empty: '没有匹配的 skill', hint: 'Agent 会自动调用这些 skill。' },
  skills: {
    plan: { name: '游戏设计', description: '产出游戏设计文档' },
    'char-ref': { name: '角色一致性', description: '让同一角色在不同场景中保持一致' },
    cutout: { name: '智能抠图', description: '把创意素材抠成透明 PNG' },
    'sprite-animation': { name: '精灵动画', description: '生成行走、攻击等帧动画精灵图' },
  },
```

fr：
```ts
    skill: { title: 'Skill', empty: 'Aucun skill correspondant', hint: "L'agent invoquera automatiquement ces skills." },
  skills: {
    plan: { name: 'Game design', description: 'Produire des documents de game design' },
    'char-ref': { name: 'Cohérence des personnages', description: 'Garder le même personnage cohérent entre les scènes' },
    cutout: { name: 'Détourage intelligent', description: 'Détourer les créations en PNG transparent' },
    'sprite-animation': { name: 'Animation de sprites', description: "Générer des planches de sprites d'animation (marche, attaque, etc.)" },
  },
```

ru：
```ts
    skill: { title: 'Skill', empty: 'Нет подходящих skill', hint: 'Агент автоматически вызовет эти skill.' },
  skills: {
    plan: { name: 'Геймдизайн', description: 'Создание документов по геймдизайну' },
    'char-ref': { name: 'Единообразие персонажа', description: 'Один и тот же персонаж остаётся узнаваемым в разных сценах' },
    cutout: { name: 'Умная вырезка', description: 'Вырезка креативов в прозрачный PNG' },
    'sprite-animation': { name: 'Спрайтовая анимация', description: 'Генерация спрайт-листов: ходьба, атака и другие кадры' },
  },
```

ja：
```ts
    skill: { title: 'Skill', empty: '一致する skill がありません', hint: 'エージェントがこれらの skill を自動的に呼び出します。' },
  skills: {
    plan: { name: 'ゲームデザイン', description: 'ゲームデザインドキュメントを作成' },
    'char-ref': { name: 'キャラクター一貫性', description: '同じキャラクターをシーン間で一貫させる' },
    cutout: { name: 'スマート切り抜き', description: '素材を透過 PNG に切り抜く' },
    'sprite-animation': { name: 'スプライトアニメ', description: '歩行・攻撃などのフレームアニメ用スプライトシートを生成' },
  },
```

vi：
```ts
    skill: { title: 'Skill', empty: 'Không có skill phù hợp', hint: 'Agent sẽ tự động gọi các skill này.' },
  skills: {
    plan: { name: 'Thiết kế game', description: 'Tạo tài liệu thiết kế game' },
    'char-ref': { name: 'Nhất quán nhân vật', description: 'Giữ cùng một nhân vật nhất quán giữa các cảnh' },
    cutout: { name: 'Tách nền thông minh', description: 'Tách creative thành PNG trong suốt' },
    'sprite-animation': { name: 'Hoạt hình sprite', description: 'Tạo sprite sheet cho đi bộ, tấn công và các khung hình khác' },
  },
```

- [ ] **Step 3: 类型检查验证六语同构**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误（缺 key 会在此暴露）

- [ ] **Step 4: 提交**

```bash
git add src/i18n/locales/
git commit -m "feat: skill 弹窗与首批 4 个 skill 的六语文案"
```

---

### Task 4: SkillPopover 组件

**Files:**
- Create: `src/components/chat/SkillPopover.tsx`
- Test: `src/components/chat/SkillPopover.test.tsx`

**Interfaces:**
- Consumes: `filterSkills` 不在此层（列表由 Composer 过滤后传入）；i18n `t`。
- Produces: `SkillPopover({ list, activeIndex, onPick }: { list: string[]; activeIndex: number; onPick: (slug: string) => void })` 默认导出。`list` 为过滤后的 slug 数组；`activeIndex` 为键盘高亮项；`onPick` 用 `onMouseDown`（preventDefault 防 textarea 失焦，与 MentionPopover 一致）。

**设计稿对齐**（node 2245:29154 / 2245:38457）：容器圆角 16px；标题区 px-16 py-12，"Skill" 14px semibold lh-22；分隔线；列表项 px-16 py-12，显示名 14px semibold + `/slug` 胶囊（`--color-teal-soft` 底、4px 圆角、水平 padding 4px、12px 字）+ 描述 12px `--color-muted`；空态 12px `--color-muted`；底部提示 px-16 py-10 12px `--color-muted`。

- [ ] **Step 1: 写失败测试**

```tsx
// src/components/chat/SkillPopover.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SkillPopover from './SkillPopover';
import '@/i18n';

describe('SkillPopover', () => {
  it('渲染已登记 skill 的显示名/胶囊/描述与底部提示', () => {
    render(<SkillPopover list={['plan']} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('Game Design')).toBeInTheDocument();
    expect(screen.getByText('/plan')).toBeInTheDocument();
    expect(screen.getByText('Produce game design documents')).toBeInTheDocument();
    expect(screen.getByText('The agent will automatically invoke these skills.')).toBeInTheDocument();
  });
  it('未登记 slug 降级:显示名=slug,无描述', () => {
    render(<SkillPopover list={['mystery']} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('mystery')).toBeInTheDocument();
    expect(screen.getByText('/mystery')).toBeInTheDocument();
  });
  it('空列表显示空态', () => {
    render(<SkillPopover list={[]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('No matching skill')).toBeInTheDocument();
  });
  it('mousedown 选择并回传 slug', () => {
    const onPick = vi.fn();
    render(<SkillPopover list={['plan', 'cutout']} activeIndex={0} onPick={onPick} />);
    fireEvent.mouseDown(screen.getByText('Smart Cutout'));
    expect(onPick).toHaveBeenCalledWith('cutout');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/SkillPopover.test.tsx`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

```tsx
// src/components/chat/SkillPopover.tsx
'use client';
import { useTranslation } from 'react-i18next';

// Skill 斜杠弹窗:列表由 Composer 过滤后传入(activeIndex 为键盘高亮项);
// 显示名/描述走 i18n 按 slug 映射,未登记 slug 降级为 slug 本身、描述空。
export default function SkillPopover({
  list,
  activeIndex,
  onPick,
}: {
  list: string[];
  activeIndex: number;
  onPick: (slug: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="anim-pop-in origin-bottom-left absolute bottom-full mb-1 flex w-80 flex-col overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-pop)] shadow-[var(--shadow-popover)] backdrop-blur-[6px]">
      <div className="px-4 py-3 text-[14px] font-semibold leading-[22px] text-[var(--color-ink)]">{t('chat.skill.title')}</div>
      <div className="h-px w-full shrink-0 bg-[var(--color-line)]" />
      <div className="scrollbar-auto max-h-64 overflow-auto">
        {list.length === 0 ? (
          <div className="px-4 py-3 text-[12px] leading-[18px] text-[var(--color-muted)]">{t('chat.skill.empty')}</div>
        ) : (
          list.map((slug, i) => {
            const desc = t(`skills.${slug}.description`, { defaultValue: '' });
            return (
              <button
                key={slug}
                onMouseDown={(e) => {
                  e.preventDefault(); // 防 textarea 失焦(与 MentionPopover 同款)
                  onPick(slug);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-fill)] ${i === activeIndex ? 'bg-[var(--color-fill)]' : ''}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold leading-[22px] text-[var(--color-ink)]">{t(`skills.${slug}.name`, { defaultValue: slug })}</span>
                  <span className="rounded-[4px] bg-[var(--color-teal-soft)] px-1 text-[12px] leading-[18px] text-[var(--color-ink)]">/{slug}</span>
                </span>
                {desc && <span className="text-[12px] leading-[18px] text-[var(--color-muted)]">{desc}</span>}
              </button>
            );
          })
        )}
      </div>
      <div className="h-px w-full shrink-0 bg-[var(--color-line)]" />
      <div className="px-4 py-2.5 text-[12px] leading-[18px] text-[var(--color-muted)]">{t('chat.skill.hint')}</div>
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/SkillPopover.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/SkillPopover.tsx src/components/chat/SkillPopover.test.tsx
git commit -m "feat: SkillPopover 弹窗(列表/空态/降级/底部提示)"
```

---

### Task 5: Composer 集成（触发 / 选择 / 键盘）

**Files:**
- Modify: `src/components/chat/Composer.tsx`
- Test: `src/components/chat/Composer.test.tsx`（追加用例；先读现有用例对齐 mock 方式）

**Interfaces:**
- Consumes: Task 1 `getActiveSlash`/`filterSkills`、Task 2 store `skills`、Task 4 `SkillPopover`。
- Produces: Composer 内部行为，无对外新接口。

**行为规格：**
- `onChange` 同时解析 `@` 与 `/`，都命中时取 `start` 更大者（更靠近光标）生效，另一个置 null。
- slash 激活时渲染 `SkillPopover`（与 MentionPopover 同位置，二者互斥）。
- 键盘（仅 slash 激活时拦截）：`ArrowDown`/`ArrowUp` 循环移动高亮、`Enter` 选中当前项（列表空则不拦截，回落发送）、`Escape` 关闭弹窗。IME 组合期间（`isImeComposing`）不拦截。
- 选中：`draft` 中 `/query` 段替换为 `/slug `（尾随空格），关闭弹窗并聚焦。

- [ ] **Step 1: 写失败测试**（追加进 `Composer.test.tsx`，沿用该文件现有 render/store 准备方式；下面用例体现意图，选择器按现有文件习惯调整）

```tsx
describe('skill 斜杠命令', () => {
  it('输入 / 弹出 Skill 弹窗', () => {
    useStore.setState({ skills: ['plan', 'cutout'] });
    renderComposer(); // 沿用文件内既有 helper
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
    expect(screen.getByText('Skill')).toBeInTheDocument();
    expect(screen.getByText('Game Design')).toBeInTheDocument();
  });
  it('query 过滤(slug 与显示名),无匹配显示空态', () => {
    useStore.setState({ skills: ['plan', 'cutout'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/zzz', selectionStart: 4 } });
    expect(screen.getByText('No matching skill')).toBeInTheDocument();
  });
  it('点击选中:替换 /query 为 /slug 加尾随空格', () => {
    useStore.setState({ skills: ['plan'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'do /pl', selectionStart: 6 } });
    fireEvent.mouseDown(screen.getByText('Game Design'));
    expect(useStore.getState().composer.draft).toBe('do /plan ');
  });
  it('Enter 选中高亮项而非发送', () => {
    useStore.setState({ skills: ['plan', 'cutout'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(useStore.getState().composer.draft).toBe('/cutout ');
  });
  it('Escape 关闭弹窗', () => {
    useStore.setState({ skills: ['plan'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/', selectionStart: 1 } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByText('Game Design')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: 新用例 FAIL，旧用例 PASS

- [ ] **Step 3: 实现**（Composer.tsx 增量）

```tsx
// import 区新增:
import { getActiveSlash, filterSkills, type ActiveSlash } from '@/lib/skills';
import SkillPopover from './SkillPopover';

// 状态区新增(mention state 旁):
const skills = useStore((s) => s.skills);
const [slash, setSlash] = useState<ActiveSlash | null>(null);
const [slashIndex, setSlashIndex] = useState(0);

// onChange 改为同时解析 @ 与 /,取更靠近光标者生效:
const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  composerSet({ draft: e.target.value });
  const caret = e.target.selectionStart ?? e.target.value.length;
  const m = getActiveMention(e.target.value, caret);
  const s = getActiveSlash(e.target.value, caret);
  // 两者都命中时取 start 更大者(更靠近光标),避免 "@a /b" 双弹窗
  const useSlash = s && (!m || s.start > m.start);
  setMention(useSlash ? null : m);
  setSlash(useSlash ? s : null);
  setSlashIndex(0);
};

// 过滤列表(渲染期派生,无需 memo:列表最多几十项):
const resolveSkillName = (slug: string) => t(`skills.${slug}.name`, { defaultValue: slug });
const skillList = slash ? filterSkills(skills, slash.query, resolveSkillName) : [];

// 选中:替换 /query 为 /slug + 尾随空格
const pickSkill = (slug: string) => {
  if (!slash) return;
  const cur = useStore.getState().composer.draft;
  const next = cur.slice(0, slash.start) + '/' + slug + ' ' + cur.slice(slash.start + 1 + slash.query.length);
  composerSet({ draft: next });
  setSlash(null);
  taRef.current?.focus();
};

// textarea onKeyDown 顶部插入(在回车发送判断之前):
if (slash && !isImeComposing(e)) {
  if (e.key === 'ArrowDown' && skillList.length) { e.preventDefault(); setSlashIndex((i) => (i + 1) % skillList.length); return; }
  if (e.key === 'ArrowUp' && skillList.length) { e.preventDefault(); setSlashIndex((i) => (i - 1 + skillList.length) % skillList.length); return; }
  if (e.key === 'Enter' && !e.shiftKey && skillList.length) { e.preventDefault(); pickSkill(skillList[Math.min(slashIndex, skillList.length - 1)]); return; }
  if (e.key === 'Escape') { e.preventDefault(); setSlash(null); return; }
}

// JSX:MentionPopover 行改为互斥渲染
{mention && <MentionPopover query={mention.query} onPick={pickMention} />}
{slash && <SkillPopover list={skillList} activeIndex={Math.min(slashIndex, Math.max(skillList.length - 1, 0))} onPick={pickSkill} />}
```

注意：现有 `onKeyDown` 是内联箭头函数，把上述拦截逻辑放进同一函数体顶部；`pickMention` 处的 `setMention(null)` 语义不变。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS + 无类型错误

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: Composer 集成 skill 斜杠触发/键盘选择/弹窗互斥"
```

---

### Task 6: 输入框内联胶囊（底衬高亮）

**Files:**
- Modify: `src/components/chat/Composer.tsx`（textarea 外包定位容器 + 镜像层）
- Test: `src/components/chat/Composer.test.tsx`（追加镜像层用例）

**Interfaces:**
- Consumes: Task 1 `splitSkillTokens`、store `skills`。
- Produces: 视觉层，无对外接口。

**实现要点（不变式：镜像层不得改变文本流布局）：**
- 镜像层与 textarea 同 padding（`px-2 pt-1`）、同字体度量（`text-[15px] leading-6 tracking-[-0.3px]`）、`whitespace-pre-wrap` + `[overflow-wrap:break-word]`（对齐 textarea UA 默认换行）。
- 文字渲染移交镜像层：textarea 加 `text-transparent caret-[var(--color-ink)]`（placeholder 已显式指定 muted 色不受影响）。
- skill 片段：`bg-[var(--color-teal-soft)] rounded-[4px]`，**不加水平 padding**（设计稿的 4px padding 舍弃以保证逐字符对齐——背景紧贴 token 文本）。
- 镜像层 `aria-hidden` + `pointer-events-none`；末尾追加 `'\n'` 保证尾部空行撑高一致。
- 滚动同步：textarea `onScroll` 把 `scrollTop` 写给镜像层 ref；`onChange` 里也同步一次（输入引发滚动时兜底）。
- 已知牺牲（注释说明）：IME 组合下划线与选区文字色因 text-transparent 不可见，属可接受妥协。

- [ ] **Step 1: 写失败测试**（追加进 `Composer.test.tsx`）

```tsx
describe('skill 内联胶囊(底衬高亮)', () => {
  it('draft 含已知 skill token 时镜像层渲染胶囊片段', () => {
    useStore.setState({ skills: ['plan'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/plan go', selectionStart: 8 } });
    const pill = screen.getByTestId('skill-pill');
    expect(pill).toHaveTextContent('/plan');
  });
  it('未知 slug 不渲染胶囊', () => {
    useStore.setState({ skills: ['plan'] });
    renderComposer();
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '/nope go', selectionStart: 8 } });
    expect(screen.queryByTestId('skill-pill')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx`
Expected: 新用例 FAIL

- [ ] **Step 3: 实现**（Composer.tsx 的 textarea 区块替换）

```tsx
// import 追加 splitSkillTokens;状态区追加:
const mirrorRef = useRef<HTMLDivElement>(null);
const syncMirrorScroll = () => {
  if (mirrorRef.current && taRef.current) mirrorRef.current.scrollTop = taRef.current.scrollTop;
};
const segments = splitSkillTokens(draft, skills);

// JSX:textarea 外包定位容器,底衬镜像层承载全部文字渲染(textarea 文字透明只留光标)。
// 镜像层与 textarea 字体/内边距/换行度量必须完全一致,任何改变文本流的样式都会导致光标错位。
<div className="relative">
  <div
    ref={mirrorRef}
    aria-hidden
    className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap [overflow-wrap:break-word] px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] text-[var(--color-ink)]"
  >
    {segments.map((seg, i) =>
      seg.kind === 'skill' ? (
        // 胶囊只做背景着色,不加水平 padding(保持逐字符对齐,设计稿 4px padding 舍弃)
        <span key={i} data-testid="skill-pill" className="rounded-[4px] bg-[var(--color-teal-soft)]">{seg.text}</span>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    )}
    {'\n'}
  </div>
  <textarea
    ref={taRef}
    value={draft}
    onChange={(e) => { onChange(e); syncMirrorScroll(); }}
    onScroll={syncMirrorScroll}
    rows={2}
    onKeyDown={/* 原有逻辑不动 */}
    placeholder={t('chat.composer.placeholder')}
    className="relative w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-6 tracking-[-0.3px] text-transparent caret-[var(--color-ink)] outline-none placeholder:text-[var(--color-muted)]"
  />
</div>
```

注意：原 `onChange` 单独抽出的函数保持,此处组合调用;镜像层放 textarea **之前**(DOM 顺序在下层)。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run src/components/chat/Composer.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/components/chat/Composer.tsx src/components/chat/Composer.test.tsx
git commit -m "feat: 输入框 skill 内联胶囊(textarea 底衬高亮)"
```

---

### Task 7: 全量校验 + 运行态视觉核对

**Files:**
- 无新文件（发现问题回上面任务修）

- [ ] **Step 1: 全量检查**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: 全绿（IDE 诊断误报不作数，只信命令退出码）

- [ ] **Step 2: 运行态视觉核对（对照设计稿逐项比对，不许肉眼估）**

用 Playwright 打开 dev（注意端口占用坑：确认端口跑的是本 worktree 代码；无后端时用 `page.route('**/api/koubou/skills**')` 注入 `{ code: 0, message: 'ok', data: { backend: 'cc', skills: [{ name: 'plan' }, { name: 'char-ref' }, { name: 'cutout' }, { name: 'sprite-animation' }] } }`），逐态截图核对：

1. 输入 `/`：弹窗结构 = 标题 Skill / 4 项（显示名+青胶囊+描述）/ 底部提示；深浅两主题各一张。
2. 输入 `/zzz`：空态 "No matching skill"。
3. 选中 plan 后输入文字：输入框内 `/plan` 青底胶囊、光标与文字逐字符对齐（放大截图核对无横向偏移）。
4. 多行文本 + 中段 `/cutout`：换行与胶囊均对齐；textarea 滚动时镜像同步。
5. 发送：气泡文本为字面 `/plan …`（无胶囊，符合范围外约定）。

- [ ] **Step 3: 提交遗留修复（如有）并回合**

按用户约定：worktree `feat/skill-selector` 完成后回合 dev（`--no-ff`，merge message 含分支名），删除分支与 worktree。合并前验证 SHA/`git log` 落点。
