import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseFromPage, initFromPage, projectPublicId, getCommonParams } from './context';
import { useStore } from '@/store';

describe('GA4 context', () => {
  // 每个测试前重置状态（包括模块级 fromPage 初始化为 direct）
  beforeEach(() => {
    initFromPage('');
    useStore.setState((state) => ({
      ...state,
      projects: [],
      currentProjectId: null,
      userInfo: null,
    }));
  });

  // 每个测试后清理 store
  afterEach(() => {
    useStore.setState((state) => ({
      ...state,
      projects: [],
      currentProjectId: null,
      userInfo: null,
    }));
  });

  describe('parseFromPage', () => {
    it('读 from_page 参数', () => {
      expect(parseFromPage('?from_page=landing')).toBe('landing');
      expect(parseFromPage('?from_page=promo&other=val')).toBe('promo');
    });

    it('空字符串 → direct', () => {
      expect(parseFromPage('?from_page=')).toBe('direct');
    });

    it('缺失参数 → direct', () => {
      expect(parseFromPage('?project=p1')).toBe('direct');
      expect(parseFromPage('')).toBe('direct');
    });

    it('trim 空白', () => {
      expect(parseFromPage('?from_page= landing ')).toBe('landing');
    });

    it('纯函数：不受 initFromPage 影响', () => {
      initFromPage('?from_page=social');
      // parseFromPage 返回解析结果，不受初始化状态影响
      expect(parseFromPage('?from_page=other')).toBe('other');
    });
  });

  describe('initFromPage', () => {
    it('设置模块级 fromPage，后续 getCommonParams 使用该值', () => {
      initFromPage('?from_page=social');
      useStore.setState((state) => ({
        ...state,
        userInfo: { id: 789, username: 'testuser', display_name: 'Test User', email: 'test@example.com', group: 'default', role: 1, status: 1 },
      }));
      const params = getCommonParams();
      expect(params.from_page).toBe('social');
    });

    it('缺失时初始化为 direct', () => {
      initFromPage('?project=p1');
      useStore.setState((state) => ({
        ...state,
        userInfo: { id: 789, username: 'testuser', display_name: 'Test User', email: 'test@example.com', group: 'default', role: 1, status: 1 },
      }));
      const params = getCommonParams();
      expect(params.from_page).toBe('direct');
    });

    it('可重复调用，后者覆盖（会话期间通常仅调一次）', () => {
      initFromPage('?from_page=first');
      useStore.setState((state) => ({
        ...state,
        userInfo: { id: 789, username: 'testuser', display_name: 'Test User', email: 'test@example.com', group: 'default', role: 1, status: 1 },
      }));
      expect(getCommonParams().from_page).toBe('first');

      initFromPage('?from_page=second');
      expect(getCommonParams().from_page).toBe('second');
    });
  });

  describe('projectPublicId', () => {
    it('根据 currentProjectId 查 projects 返回 public_id', () => {
      useStore.setState((state) => ({
        ...state,
        currentProjectId: 123,
        projects: [
          { id: 123, public_id: 'proj_abc', name: 'Project A', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' },
          { id: 456, public_id: 'proj_def', name: 'Project B', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' },
        ],
      }));
      expect(projectPublicId()).toBe('proj_abc');
    });

    it('项目不存在返回 undefined', () => {
      useStore.setState((state) => ({
        ...state,
        currentProjectId: 999,
        projects: [{ id: 123, public_id: 'proj_abc', name: 'Project A', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' }],
      }));
      expect(projectPublicId()).toBeUndefined();
    });

    it('currentProjectId 为 null 返回 undefined', () => {
      useStore.setState((state) => ({
        ...state,
        currentProjectId: null,
        projects: [{ id: 123, public_id: 'proj_abc', name: 'Project A', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' }],
      }));
      expect(projectPublicId()).toBeUndefined();
    });
  });

  describe('getCommonParams', () => {
    it('返回 6 个公共参数（登录时带 user_id）', () => {
      useStore.setState((state) => ({
        ...state,
        currentProjectId: 123,
        projects: [
          { id: 123, public_id: 'proj_abc', name: 'Project A', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' },
        ],
        userInfo: { id: 789, username: 'testuser', display_name: 'Test User', email: 'test@example.com', group: 'default', role: 1, status: 1 },
      }));

      const params = getCommonParams();
      expect(params).toEqual({
        product: 'gamestudio',
        env: 'local', // 测试环境未设 NEXT_PUBLIC_APP_ENV,resolveGa4 回退 local
        page_name: 'editor',
        from_page: 'direct',
        is_login: 1,
        user_id: 789,
      });
    });

    it('未登录时不含 user_id，is_login=0', () => {
      useStore.setState((state) => ({
        ...state,
        currentProjectId: 123,
        projects: [
          { id: 123, public_id: 'proj_abc', name: 'Project A', cover_url: null, cover_source: null, current_version_id: null, status: 'active', created_at: '', updated_at: '' },
        ],
        userInfo: null,
      }));

      const params = getCommonParams();
      expect(params).toEqual({
        product: 'gamestudio',
        env: 'local',
        page_name: 'editor',
        from_page: 'direct',
        is_login: 0,
      });
      expect(params).not.toHaveProperty('user_id');
    });

    it('from_page 由 initFromPage 锁定', () => {
      initFromPage('?from_page=promo');
      useStore.setState((state) => ({
        ...state,
        userInfo: { id: 789, username: 'testuser', display_name: 'Test User', email: 'test@example.com', group: 'default', role: 1, status: 1 },
      }));

      const params = getCommonParams();
      expect(params.from_page).toBe('promo');
    });
  });
});
