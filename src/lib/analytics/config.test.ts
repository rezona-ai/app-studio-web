import { describe, it, expect } from 'vitest';
import { resolveGa4 } from './config';

describe('resolveGa4', () => {
  it('三套部署环境按 GitHub environment 名各自映射,property 全环境共用', () => {
    expect(resolveGa4('production')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'prod', debug: false });
    expect(resolveGa4('stage')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'stage', debug: true });
    expect(resolveGa4('develop')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'dev', debug: true });
  });
  it('短名别名等价(防旧值/手填 prod 被误判成本地)', () => {
    expect(resolveGa4('prod')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'prod', debug: false });
    expect(resolveGa4('dev')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'dev', debug: true });
    expect(resolveGa4('staging')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'stage', debug: true });
  });
  it('未设 / 未知值 → local + debug', () => {
    expect(resolveGa4(undefined)).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'local', debug: true });
    expect(resolveGa4('')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'local', debug: true });
    expect(resolveGa4('test')).toEqual({ measurementId: 'G-HXYXWKDJLQ', env: 'local', debug: true });
  });
});
