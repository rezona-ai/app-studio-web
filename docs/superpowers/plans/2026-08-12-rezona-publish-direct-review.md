# 直发改造：评审处置记录

设计稿：`../specs/2026-08-12-rezona-publish-direct-design.md`
分支：`feat/rezona-publish-direct`（三轮独立子代理评审：T1+T2 / T3 / 全分支终审）

## 一、已修（评审提出 → 本分支处置）

| 来源 | 问题 | 处置 |
|---|---|---|
| T1/T2 Important | `downloadVersion` 手工重造信封判定，丢 `failure` 与 `request_id` | 改走 `resolveEnvelope`，补断言 |
| T1/T2 Important | 本地 `TIMEOUT`/`NETWORK` 无信封，升级联系支持时渲染出空 ID | `mapRezonaError` 增 `hasRequestId`，无 ID 走 `err.supportNoId`（11 语言） |
| T1/T2 Minor | `client.test.ts` 用 `catch` 断言，回调不执行时会静默通过 | 改 `rejects.toMatchObject` |
| T1/T2 Minor | `VersionTimeline` 的 building fixture 被批量补成 `ready` | `makeVersion` 加 `status` 参数，building 用例传 `'building'` |
| T3 Minor | 空版本分支不可达且脚注文案错配（显示「仍在构建中」） | `version` prop 收成必传，`PreviewPanel` 加 `active &&` 门控，删死分支与 `noVersion` 文案 |
| T3 Minor | `useRef(newIdempotencyKey())` 每次渲染白算 UUID | 改 `useState(newIdempotencyKey)` 惰性初始化（同时避开 `Cannot access refs during render` 规则） |
| T3 Minor | 网关级 502/503 落不进不可用家族 | 边界归一（终审后阈值放宽到 ≥500，见下） |
| T3 Minor | `versionReady` 默认值只服务测试 | 改必传 |
| T3 Minor | 禁用 CTA 与解释脚注无程序化关联 | 脚注加 id + CTA 挂 `aria-describedby` |
| T3 Minor | 发布超时无断言 | `rezona-client.test.ts` 用 `AbortSignal.timeout` spy 断言 60s |
| T3 Minor | i18n 同构测试只覆盖 6 语言 | 扩到全部 11 种 |
| T3 Minor | `cover_ref` 仍是宽 `string` | 收成字面量类型 `'version_cover'` |
| 终审 Important | 本服务 pgc 代理不可达对外是**裸 500**（非 502），归一阈值定在 ≥502 会漏掉最常见路径，落通用文案且不计数 | 阈值放宽到 ≥500，注释同步；测试改 `test.each([500, 502])`；设计稿 §4.4 补一行 |
| 终审 Minor | `setError` 上报原始 code 与选文案的归一 code 不同源，依赖「`HTTP_ERROR` 恰好不在 `ERROR_KEYS` 里」 | 改为上报归一后的 code，加注释点明耦合 |
| 终审 Minor | plan 未回写（`mapRezonaError` 参数、`supportNoId`） | 已回写 |

## 二、记录但不改（已知取舍）

1. **版本预检在生产链路上不可达**：`versions` 只装 ready 版本，building 占位走独立的 `buildingVersion`，故 CTA 不会被置灰。保留代码（fail-closed，后端放开即生效），设计稿 §4.5 已降级表述为防御性冗余。
   **待办：向后端确认 `GET /versions` 是否会返回 `building` 版本**；若会，补一条从 `listVersions` 灌入到 CTA 置灰的真实链路测试。
2. **不可用计数不因其他错误码清零**：`UNAVAILABLE → UNAVAILABLE → VALIDATION_ERROR → UNAVAILABLE` 第 4 次仍会升级。设计稿 §4.4 已拍板「只在 unavailable 家族累加」，接受。
3. **计数随弹窗卸载丢失**：关掉重开即重新计数，属可接受的宽松边界，代码已注释。
4. **`err.notBuilt` 只有纯函数级覆盖**，无端到端用例——与第 1 条同因。
5. **`summary` 恒发空串而非省略**：契约标 optional，后端按 ≤2000 校验，无差别。
6. **i18n 同构测试扩到 11 语言属计划外顺带改动**：净收益，出处记在此。
7. **`store/index.ts` 的 `saveVersion` 是既有 dead code**（只有声明与实现、无调用方）：与本需求无关，未在本分支处置，留作独立 chore 的候选。

## 三、终审验证（HEAD = 本分支最后一个提交）

`pnpm lint` 0 errors（8 条 warning 均在 `loadtest/*.js`、`Workspace.tsx`、`actions.ts`，基线 dev 同样存在）；
`pnpm exec tsc --noEmit` exit=0；`pnpm test` 216 files / 2250 tests 全绿；`pnpm build` 成功。
残留核查：`/api/rezona/{bind,binding,eligibility}` 全仓零命中；`LinkStep` / `useRezonaBindPoll` / `rezona/links` 无引用；
废弃 i18n key 无残留；`qr.ts` 按设计稿保留且仍被 `ApkExportModal` 使用。
