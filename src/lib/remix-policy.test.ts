import { expect, test } from 'vitest';
import { remixToggleState } from './remix-policy';
import type { RemixPolicyData } from './pgc/types';

const on = (sourceVersion: string | null): RemixPolicyData => ({
  enabled: true, source_code: 'c1', source_version_id: sourceVersion,
  remix_url: 'https://lab.rezona.ai/game?remix=c1', display_title: null, display_description: null,
});
const off: RemixPolicyData = {
  enabled: false, source_code: 'c1', source_version_id: null,
  remix_url: null, display_title: null, display_description: null,
};
// pending 非 null = 有请求在飞,值即乐观目标态;loading = 首次 GET 未回
const base = { activeVersionId: 'v3', activeStatus: 'ready', loading: false, pending: null };

test('加载中:开关不置位也不可动,原因是 loading(此时后端事实未知,不许下判断)', () => {
  expect(remixToggleState({ ...base, policy: null, loading: true }))
    .toEqual({ checked: false, disabled: true, reason: 'loading', boundElsewhere: null });
});

test('在飞中:显示乐观目标态但禁用,防连点重复 PATCH', () => {
  const s = remixToggleState({ ...base, policy: off, pending: true });
  expect(s.checked).toBe(true);
  expect(s.disabled).toBe(true);
  expect(s.reason).toBe(null);
});

test('拨关在飞:显示关,不因后端旧事实还是开而闪回', () => {
  expect(remixToggleState({ ...base, policy: on('v3'), pending: false }).checked).toBe(false);
});

test('拨开在飞:不出「绑在别处」提示 —— 这一发 PATCH 正是要绑到当前版本', () => {
  expect(remixToggleState({ ...base, policy: on('v2'), pending: true }).boundElsewhere).toBe(null);
});

test('未 build 的版本:禁用 + notBuilt —— 否则 PATCH 必吃 409 REMIX_SOURCE_NOT_READY', () => {
  const s = remixToggleState({ ...base, policy: off, activeStatus: 'building' });
  expect(s).toEqual({ checked: false, disabled: true, reason: 'notBuilt', boundElsewhere: null });
});

test('已开启但绑在别的版本:仍置位,给出该版本号供提示(不隐式改绑)', () => {
  expect(remixToggleState({ ...base, policy: on('v2') }))
    .toEqual({ checked: true, disabled: false, reason: null, boundElsewhere: 'v2' });
});

test('已开启且就绑在当前版本:无提示', () => {
  expect(remixToggleState({ ...base, policy: on('v3') }).boundElsewhere).toBe(null);
});

test('已开启但后端没给 source_version_id:不编版本号,也不谎报一致', () => {
  expect(remixToggleState({ ...base, policy: on(null) }).boundElsewhere).toBe(null);
});

test('未开启:后端 source_version_id 恒 null,不该出现「绑在别处」提示', () => {
  expect(remixToggleState({ ...base, policy: off }))
    .toEqual({ checked: false, disabled: false, reason: null, boundElsewhere: null });
});

test('未 build 时仍允许拨关:已开放的项目不能因当前停在 building 版本就锁死关不掉', () => {
  const s = remixToggleState({ ...base, policy: on('v2'), activeStatus: 'building' });
  expect(s.checked).toBe(true);
  expect(s.disabled).toBe(false);
  expect(s.reason).toBe(null);
  expect(s.boundElsewhere).toBe('v2');
});

test('策略读取失败(policy 为 null 且已加载完):禁用,不假装是「关」的状态可拨', () => {
  expect(remixToggleState({ ...base, policy: null }))
    .toEqual({ checked: false, disabled: true, reason: 'unavailable', boundElsewhere: null });
});

test('缺当前版本 id:无从绑定,禁用', () => {
  expect(remixToggleState({ ...base, policy: off, activeVersionId: null }).disabled).toBe(true);
});
