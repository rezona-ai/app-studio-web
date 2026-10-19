// 手动 dispatch 入参契约（specs/2026-08-27-merge-strategy-alignment-design.md §5.4）：
// prod 的 branch 必须无默认值 + required，stage 默认 main。
// 这两条是「随手 dispatch 就发错东西」的第一道拦，改宽了不该悄无声息。
import { describe, expect, it } from 'vitest';
import { readRepoFile } from './manifest';

/** 取某 workflow 的 workflow_dispatch.inputs.branch 块（到下一个同级键为止） */
function branchInputBlock(relPath: string): string {
  const wf = readRepoFile(relPath);
  const start = wf.indexOf('      branch:');
  expect(start, `${relPath} 未找到 branch input`).toBeGreaterThan(-1);
  const rest = wf.slice(start + 1);
  const end = rest.search(/\n(?! {8})\S|\n {0,6}\S/);
  return rest.slice(0, end === -1 ? undefined : end);
}

describe('Deploy (production) 的 ref 入参', () => {
  const block = branchInputBlock('.github/workflows/deploy.yml');

  it('无默认值——默认成 main 等于把未验证内容随手发上线', () => {
    expect(block).not.toContain('default:');
  });

  it('required: true', () => {
    expect(block).toContain('required: true');
  });

  it('描述点名 release 分支形态', () => {
    expect(block).toContain('release/');
  });
});

describe('Deploy (stage) 的 ref 入参', () => {
  const block = branchInputBlock('.github/workflows/deploy_stage.yml');

  it('默认 main（对齐 koubou lab-stage）', () => {
    expect(block).toMatch(/default:\s*main/);
  });
});
