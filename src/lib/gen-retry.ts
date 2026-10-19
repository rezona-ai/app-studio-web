// 孤儿失败的专属 code(spec 2026-08-07-retry-path-guards 决策 2)。**前端自造**,不是后端下发 ——
// 孤儿的真实情况不是「生成失败」而是「我们接不回这个任务的状态」,两者的正确应对完全不同。
// code 域与后端不冲突(后端是 PROVIDER_CONTENT_POLICY_VIOLATION 这类);message 留空,
// 由 UI 按 code 查 i18n(本地化不下沉到 store)。
// 失败卡重试的路由(retryRouteFor / retryLineage / singleShotReq)随画布界面退役(spec 2026-10-19 第二阶段),
// 只剩 store 的孤儿兜底(restoreGenTasks / pollGenTasks)还在给资产挂这个 code
export const GEN_STATE_LOST = 'GEN_STATE_LOST';
