import { expect, test } from 'vitest';
import { formatQuestionAnswer } from './formatAnswer';
import type { QuestionDef } from '@/koubou/protocol';

test('单问题单选:直接是所选 label', () => {
  const qs: QuestionDef[] = [{ question: '美术风格?', options: [{ label: '像素风' }, { label: '手绘' }] }];
  expect(formatQuestionAnswer(qs, { '美术风格?': '像素风' })).toBe('像素风');
});

test('单问题多选:label 用、连接', () => {
  const qs: QuestionDef[] = [{ question: '平台?', options: [{ label: 'Web' }, { label: 'iOS' }], multiSelect: true }];
  expect(formatQuestionAnswer(qs, { '平台?': ['Web', 'iOS'] })).toBe('Web、iOS');
});

test('多问题:每行「header：label」换行连接', () => {
  const qs: QuestionDef[] = [
    { question: '美术风格?', header: '美术', options: [{ label: '像素风' }] },
    { question: '支持平台?', header: '平台', options: [{ label: 'Web' }, { label: 'iOS' }], multiSelect: true },
  ];
  expect(formatQuestionAnswer(qs, { '美术风格?': '像素风', '支持平台?': ['Web', 'iOS'] })).toBe('美术：像素风\n平台：Web、iOS');
});

test('多问题无 header 时用 question 文本作前缀', () => {
  const qs: QuestionDef[] = [
    { question: '风格?', options: [{ label: 'A' }] },
    { question: '难度?', options: [{ label: '简单' }] },
  ];
  expect(formatQuestionAnswer(qs, { '风格?': 'A', '难度?': '简单' })).toBe('风格?：A\n难度?：简单');
});

test('空选项被过滤,不产出空行', () => {
  const qs: QuestionDef[] = [
    { question: '风格?', options: [{ label: 'A' }] },
    { question: '难度?', options: [{ label: '简单' }] },
  ];
  expect(formatQuestionAnswer(qs, { '风格?': 'A', '难度?': [] })).toBe('风格?：A');
  expect(formatQuestionAnswer(qs, {})).toBe('');
});
