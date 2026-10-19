import { beforeEach, describe, expect, test } from 'vitest';
import { useStore } from '@/store';
import { BASE_MODEL } from '@/lib/subscription/model-gate';
import type { SubscriptionPlansData } from '@/lib/biz/types';

// 会话落库模型回填选择器(spec 2026-09-11-session-model-adopt-design)。
// 返回值 = 「要发 session.set_model 的模型 id」,null = 不发帧(先例:applyDragSnap 回报 handled)。
// 回填只走写入口 setSelectedModel —— 门禁收口与「同步落项目记忆」都在那里,这里不重复一份。
const LIST = ['Rez1', 'claude-fable-5', 'gpt-5.6'];
const PID = 7;   // ready 所属项目;与 beforeEach 的 currentProjectId 一致

// 门禁判据要读 current_tier,其余字段给最小合法值 —— 收在一处而非每个用例 `as never`,
// 这样 SubscriptionPlansData 形状变化时这里会报错而不是静默通过
const freePlans = (): SubscriptionPlansData => ({
  currency: 'USD', current_tier: 'free', intro_eligible: false, plans: [],
  usage_units: {}, welcome_credits: 0, welcome_credits_valid_days: 0,
});

beforeEach(() => {
  useStore.setState({
    availableModels: LIST,
    selectedModel: 'Rez1',
    modelByProject: {},
    modelBackend: 'cc',
    agentBackend: 'cc',
    currentProjectId: 7,
    newUserStatus: false,
    plansCache: null,
    toast: null,
    creditModalOpen: false,
  });
});

describe('adopt:会话模型可用', () => {
  // 本 bug 的主场景:旧项目会话落库 fable 5、本地无记忆,选择器此前显示列表首项 Rez1
  test('回填选择器与项目记忆,且不发帧', () => {
    const next = useStore.getState().syncSessionModel(PID, 'claude-fable-5', LIST);
    expect(next).toBeNull();
    expect(useStore.getState().selectedModel).toBe('claude-fable-5');
    expect(useStore.getState().modelByProject['7']).toBe('claude-fable-5');
    expect(useStore.getState().toast).toBeNull();
  });

  test('门禁锁定 + 会话模型就是 Rez1 → 正常回填', () => {
    useStore.setState({ newUserStatus: true, plansCache: freePlans() });
    expect(useStore.getState().syncSessionModel(PID, BASE_MODEL, LIST)).toBeNull();
    expect(useStore.getState().selectedModel).toBe(BASE_MODEL);
    expect(useStore.getState().modelByProject['7']).toBe(BASE_MODEL);
  });

  // 成功标准 4:门禁锁定态下会话跑着付费模型时,回填走 adopt,再由写入口 setSelectedModel 的
  // gatedModel 把值改写成 Rez1 —— 选择器与项目记忆都落 Rez1,会话则由 useNewUserGate 切回来
  test('门禁锁定 + 付费会话模型 → 回填被改写成 Rez1', () => {
    useStore.setState({ newUserStatus: true, plansCache: freePlans() });
    expect(useStore.getState().syncSessionModel(PID, 'claude-fable-5', LIST)).toBeNull();
    expect(useStore.getState().selectedModel).toBe(BASE_MODEL);
    expect(useStore.getState().modelByProject['7']).toBe(BASE_MODEL);
  });

  // ready 自带的列表缺失时(老服务端)退到 store 列表判定,不因时序丢掉回填
  test('ready 未带 available_models → 用 store 列表判定', () => {
    expect(useStore.getState().syncSessionModel(PID, 'gpt-5.6', undefined)).toBeNull();
    expect(useStore.getState().selectedModel).toBe('gpt-5.6');
  });

  // 只断言「值不变」:adopt 无条件走 setSelectedModel,它每次都新建 modelByProject 对象,
  // 故这里验证的是幂等于**值**而非引用(重连每来一帧 ready 都会重写一次同值,无害)
  test('会话模型与当前选中相同 → 值保持不变', () => {
    useStore.setState({ selectedModel: 'Rez1', modelByProject: { '7': 'Rez1' } });
    expect(useStore.getState().syncSessionModel(PID, 'Rez1', LIST)).toBeNull();
    expect(useStore.getState().selectedModel).toBe('Rez1');
    expect(useStore.getState().modelByProject).toEqual({ '7': 'Rez1' });
  });
});

describe('retired:会话模型已下架', () => {
  test('返回列表首项供调用方发帧,并弹 MODEL_RETIRED(带两个展示名插值)', () => {
    const next = useStore.getState().syncSessionModel(PID, 'claude-opus-4-8', LIST);
    expect(next).toBe('Rez1');
    const toast = useStore.getState().toast;
    expect(toast?.code).toBe('MODEL_RETIRED');
    // 成功的自动补救走 warning 柔和档,不是 error(红色会把它说成事故)
    expect(toast?.kind).toBe('warning');
    // 展示名而非原始 id —— 用户看不懂 claude-opus-4-8
    expect(toast?.params).toEqual({ from: 'Opus 4.8', to: 'Rez1' });
  });

  // 切换的落定等后端 model.changed(唯一权威),不在这里乐观改写选择器 ——
  // set_model 可能被后端以 invalid model / run already active 拒掉
  test('不乐观改写选择器与项目记忆', () => {
    useStore.getState().syncSessionModel(PID, 'claude-opus-4-8', LIST);
    expect(useStore.getState().selectedModel).toBe('Rez1');   // 仍是调用前的值
    expect(useStore.getState().modelByProject).toEqual({});
  });

  // 门禁锁定态下 useNewUserGate 本来就会把会话切到 Rez1,两边同时发帧是两条命令打架。
  // 今天 availableModels[0] 恰好就是 Rez1,但不能依赖这个巧合
  test('新用户门禁锁定 → 不发帧、不弹 toast(交给 useNewUserGate)', () => {
    useStore.setState({
      newUserStatus: true,
      plansCache: freePlans(),
      selectedModel: BASE_MODEL,
    });
    expect(useStore.getState().syncSessionModel(PID, 'claude-opus-4-8', LIST)).toBeNull();
    expect(useStore.getState().toast).toBeNull();
  });

  // 切换目标必须取「判定所用的那份列表」:ready 先于 /models 到达(或 listModels 静默失败)时
  // store 列表还是空的,若目标写死取 store 列表就会判出下架却拿不到目标,补救动作静默丢失 ——
  // 而这个会话是真坏的(后端不拦,下一轮照样把下架模型打给上游)
  test('store 列表未就绪时按 ready 自带列表切换', () => {
    useStore.setState({ availableModels: [] });
    expect(useStore.getState().syncSessionModel(PID, 'claude-opus-4-8', LIST)).toBe('Rez1');
    expect(useStore.getState().toast?.code).toBe('MODEL_RETIRED');
  });
});


// 过期 ready 的上下文校验。两个源头(close() 漏解绑 onmessage、listEvents 失败后漏 aborted 守卫)
// 已分别在 koubou/client.ts 与 useKoubouConnection 堵掉,但守卫仍留在写入口:不变式归 store 所有,
// 才不依赖每个调用点自觉。本 action 写的两个字段都在 persist 白名单里 —— 写错会跨刷新留存,
// 且方向与本需求正相反(B 项目的选择器显示 A 项目会话的模型)
describe('过期 ready:项目已切走', () => {
  test('pid 与 currentProjectId 不符 → 丢弃,不回填不落记忆', () => {
    expect(useStore.getState().syncSessionModel(99, 'claude-fable-5', LIST)).toBeNull();
    expect(useStore.getState().selectedModel).toBe('Rez1');
    expect(useStore.getState().modelByProject).toEqual({});
  });

  test('pid 不符时 retired 分支也不弹 toast、不发帧', () => {
    expect(useStore.getState().syncSessionModel(99, 'claude-opus-4-8', LIST)).toBeNull();
    expect(useStore.getState().toast).toBeNull();
  });

  // 门禁锁定态下过期 ready 同样丢弃:否则会把旧项目的会话模型经 gatedModel 写成新项目的记忆
  test('pid 不符时门禁锁定态也不落记忆', () => {
    useStore.setState({ newUserStatus: true, plansCache: freePlans() });
    expect(useStore.getState().syncSessionModel(99, 'claude-fable-5', LIST)).toBeNull();
    expect(useStore.getState().modelByProject).toEqual({});
  });
});

describe('none:没有可回填的事实', () => {
  test('会话模型为空 → 状态不动', () => {
    expect(useStore.getState().syncSessionModel(PID, null, LIST)).toBeNull();
    expect(useStore.getState().selectedModel).toBe('Rez1');
    expect(useStore.getState().modelByProject).toEqual({});
    expect(useStore.getState().toast).toBeNull();
  });

  // 两个列表都空 = 判不出:既不能 adopt(可能选中一个不在下拉里的值)也不能 retired(可能误切好会话)
  test('两个列表都空 → 状态不动', () => {
    useStore.setState({ availableModels: [] });
    expect(useStore.getState().syncSessionModel(PID, 'claude-fable-5', undefined)).toBeNull();
    expect(useStore.getState().selectedModel).toBe('Rez1');
    expect(useStore.getState().toast).toBeNull();
  });
});
