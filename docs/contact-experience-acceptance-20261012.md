# 联系人完整体验迭代：验收记录

日期：2026-10-12。用户已确认 [完整设计](superpowers/specs/2026-10-12-contact-experience-design.md)与[实施计划](superpowers/plans/2026-10-12-contact-experience.md)，选择当前会话顺序实施。A–G 已实现；最终整合验证和独立审计记录在文末。前面保留各阶段的实际测试边界，不将较早的局部通过当作最终结论。

## 本轮落实的既有规范

开始实施前先修正身份与新增表单约定，随后按 B→C→D→E→F→G→A 实现完整设计。

- 联系人卡片、资料页、人设编辑占位文案不再声称空人设会使用默认丑鱼人格；改为未设置说明及该联系人的身份/交流风格提示。未改模型人设处理。
- 独立记忆页通过「新增记忆」打开模态表单，保留原单条 2000 字、容量和存储接口。保存成功后更新列表并关闭，失败保留文字及弹窗内错误。同步提交锁防止重入，卸载后忽略迟到回调。
- 复用已有任务弹窗控件样式与有边界的鼠标交互约定，未添加彩色聚焦边框、outline 或阴影。
- 鼠标取消恢复入口焦点；Esc 只关闭该弹窗并按公共 Escape 规则清除按钮焦点，底层联系人详情保留。保存中不允许关闭，避免把已经提交的写入误称为取消。

## 已验证

- `npm test`：1394 项通过、19 项默认跳过，160 个文件通过、4 个文件跳过。日志 `temp/contact-memory-tests.log`。
- `npm run typecheck`：通过。日志 `temp/contact-memory-typecheck.log`。
- `npm run build`：通过，保留既有大 chunk 提示。日志 `temp/contact-memory-build.log`。
- `node scripts/smoke-electron.js --contacts`：通过，包含新增记忆流程、原联系人增删/模型对话、技能与全局搜索。日志 `temp/contact-memory-contacts.log`。
- 专项：设置 `CHOUYU_SMOKE_CONTACT_MEMORY_ONLY=1`、`CHOUYU_SMOKE_ARTIFACTS=artifacts/contact-memory-dialog` 后执行上述 contacts 命令。通过真实鼠标、键盘、Electron IPC 与 SQLite 验证：页面无可见内嵌新增表单；弹窗自动聚焦；Esc 保留父层；取消不保存；鼠标取消恢复入口；实际 SQLite 写入失败保留原文；解除故障后重试只落盘一条；重新打开数据库核对持久内容。初次在旧实现上因内嵌表单失败，见 `temp/contact-memory-red.log`；通过记录为 `temp/contact-memory-green.log`。
- 375/1024 宽、深浅色截图位于 `artifacts/contact-memory-dialog/`；检查弹窗可见边界和聚焦前后边框一致、无 outline/阴影，人工查看窄屏浅色和宽屏深色图。
- 独立代码复核未发现需修复的具体生产问题；代码中的联系人 key、卸载保护和同步锁已经审查。

## 验证边界与剩余范围

全部界面测试使用隔离数据，不写用户真实任务或记忆。本轮未跑真实模型、后台全天工作或所有 agent 引擎专项；没有改变这些执行逻辑。专项的恰好一条断言覆盖失败后重试，不声称已做保存中切换联系人或快速重复提交的独立 UI 验收。

列表/概览重排、资料空间、协作交接、技能文件成果仍在实施；不以单个模块替代完整目标。

## B：成果集与续读

已实现正式版本索引、每页 30 项的稳定快照查询、最新正文搜索、任务范围/排序/收藏、精确版本阅读与分节阅读哈希。数据库升级至 9，旧版本回填真实成果，不补造阅读记录。任务和成果集共用 ContactDeliveryReader；后台新交付显示切换入口，不替换当前阅读。关闭阅读器提交末次位置；自定义展示事件核对窗口、透明来源、请求 nonce、正式版本及正文锚点。

- B1 专项及原成果回归：31 项通过；B2 阅读/投影/存储专项：14 项通过；类型检查与构建通过。
- Electron：`CHOUYU_SMOKE_CONTACT_PORTFOLIO_ONLY=1 node scripts/smoke-electron.js --contacts` 通过；真实鼠标滚动、收藏、关闭立即落盘、worker 重启续读、两分节只标已读一节、后台新版本不抢阅读、伪造 iframe 消息无效、搜索后打开精确版本均核对真实数据库。
- 窄屏/宽屏与深浅色截图在 `artifacts/contact-portfolio/portfolio-reader-*.png`；实际检查浅色 375 与深色 1024。测试临时调整容器尺寸，不修改产品窗口布局。
- 日志保存在执行工作区 `.superpowers/sdd/2026-10-12-contact-experience/B1-*.log`、`B2-*.log`。Electron 检出了 ESM 解析依赖被 CommonJS 外置的启动问题，现将这些依赖打包；也修正了测试中未等待异步续读按钮的竞态。
- 当前证据覆盖 EXP-03/04 的本模块行为；应用进程被强制杀死前尚未发出的 500ms 节流事件无法持久化，不承诺强杀保留最后一个尚未提交事件。其他模块与最终整体验收继续推进。

## C：正文引用与版本修订

已实现正文选择/键盘入口、引用草稿、消息独立引用字段与原文导航；引用最多 4 条、每条 2000 字，服务端验证作者/版本/分节/UTF-16 区间和 SHA-256。用户消息正文不拼入内部 ID。修订使用单意见弹窗，持久保留原版本与“保留本段”等意见，在创建轮次和成果提交前检查版本；过期时保留草稿并展示新旧依据，用户可明确选择基于新版分节重提。

- 引用/持久消息专项 66 项通过；修订/原聊天修改/阅读定位专项 56 项通过。全量回归 1412 项通过、19 项默认跳过；类型检查及构建通过。
- Electron：启用 `CHOUYU_SMOKE_CONTACT_PORTFOLIO_ONLY=1` 与 `CHOUYU_SMOKE_CONTACT_CITATION_ONLY=1` 后执行 contacts 烟测，验证选择不启动任务、取消、过期不新建轮次且保留意见、发送时保存原版本/原引文、讨论不创建任务，以及从消息打开当时版本并选中原文字。
- 单意见弹窗在 375/1024、深浅色下验证边界与无彩色聚焦装饰；截图 `artifacts/contact-citations/citation-dialog-*.png`，检查浅色 375 和深色 1024。原始 IPC 错误前缀已从弹窗提示中移除。
- 旧任务和成果集会同时保留组件，烟测选择器已限定可见成果集，避免误点击隐藏任务阅读器；续读恢复也改为按实际加载对象执行布局恢复，避免同版本快速加载漏掉恢复。
- 以上是隔离数据与本地模型夹具，真实模型意见质量及最终跨模块流程仍待验收。

## D: Versioned, scoped contact memories

Schema 10 migrates existing sources without inferred scopes. Corrections preserve identity and history; research creates candidates requiring user confirmation. Scope selection precedes ranking, limited to 12 records / 16000 characters. Updates invalidate affected run snapshots without resetting unrelated schedules. Chat tools use existing permission policy. Main-process receipts identify actual supplied revisions, persisted on the reply and displayed without asserting model use. Forgotten history is redacted.

Validation: D1 SQLite/service/runtime/portfolio 52 passed; D2 full suite 1419 passed, 19 skipped; typecheck and build passed. Electron memory smoke passed failure/retry, edit/history, restart, forgetting, actual provider request capture and persisted reply references. Real-model quality remains in FINAL acceptance.

## E: Persistent materials

Schema 11 stores immutable UTF-8 versions with contact/task scope. Limits: 2 MB per version, 100 active documents, 200 MB retained versions, 12000 UTF-16 units per tool read. Identical content with identical metadata is idempotent; metadata changes preserve a new version. File imports copy only supported text files, strip original paths, and reject invalid UTF-8/NUL; web imports reuse the existing reader and source restrictions. Cancellation prevents late imports from committing.

Chat and background work receive a directory, not invented reading receipts. Read tools return real slices; background directory versions remain fixed per run. Actual reads appear in chat references and saved outcome sources. Withdrawal invalidates affected runs while saved outcomes remain intact.

Validation: 1426 full-suite tests passed, 19 skipped; typecheck/build passed; Electron import failure/retry, update/history, file copy, worker restart, real tool-to-provider content and withdrawal all passed. Modal screenshots at artifacts/contact-materials cover 375/1024 and both themes; inspected light375/dark1024, corrected native select/input styling to match established controls without focus decoration.

### F: Versioned review handoffs

EXP-10/11: persisted source/version and an actual receiver task; both sharing permissions are checked before preparation, commit, reading and delivery. Continuous reviews compare prose hashes and preserve paused/completed states. Returning a selected opinion uses the original author revision flow with both source versions validated.

Evidence: handoffs.test.ts and handoff-review.test.ts (5 passing), F2-final-suite (1432 passed/19 skipped), typecheck and build passed. Electron F2-smoke-final exited 0 with CHOUYU_CONTACT_HANDOFF_SMOKE_PASSED: real modal mouse actions, parser and reviewer requests, private-memory isolation, worker restart, returned opinion, author version 2 and stale draft retention. Inspected light375/dark1024 screenshots in artifacts/contact-handoffs. Real-model semantic quality remains a FINAL acceptance requirement.

### G1: Attributable file archive

EXP-13 storage: validated runner byte snapshots are content-addressed SQLite BLOB copies. Metadata and bytes commit atomically; no arbitrary host path enters the API. File/tool tests cover immutable overwrites, rollback, restart, cancelled runs, run/session ownership, hardlinks, traversal and existing limits. Formal fileIds attach only with the actual matching delivery transaction. G1-final-tests: 15 passed; G1-final-types passed; CHOUYU_TEST_DOCKER=1 docker.integration.test.ts: 2 passed, including archive of real script output. File previews and navigation remain G2.

### G2: Usable skills and file previews

EXP-12/13: instruction readiness is independent from Docker. Script readiness requires authorization, actual environment status and dependency image inspection; external requirements remain explicitly unverified. Only examples extracted from explicit skill usage sections can fill the ordinary task dialog. File lists distinguish archived work, formally attached files and legacy files with unknown provenance. Text/image previews and static HTML sandbox never expose the host; native export revalidates ownership and archived bytes.

Evidence: capability projection tests, G2-suite 1438 passed/19 skipped; G2-final-types/build passed; G2-smoke-final exited 0 with CHOUYU_CONTACT_CAPABILITY_SMOKE_PASSED. Actual mouse/IPC checks include example cancellation without a task, immutable export/cancel, PNG preview, removal of HTML navigation/executable content, corruption errors and foreign-owner denial. Final screenshots in artifacts/contact-files inspected. Shared settings-return and pending-state integration will be verified by A2/FINAL.

### A1: Content-first overview

EXP-01: home aggregation includes unresolved interactions, pinned latest formal results and actual task states; it excludes private memory text. UI reuses original interaction/task cards and assistant arrangement adapters, with statistics/timeline behind an expansion. Contact highlights precede model/usage details, and background activity preserves the displayed sort snapshot. A1 home tests and state regressions passed (6), typecheck/build passed, A1-smoke exited 0 with failure/retry and read-versus-resolved assertions. Visual inspection found narrow detail header/metadata crowding; A2 will correct and recapture before final acceptance.

### A2: Navigation and return context

EXP-02: grouped daily/personal/tool navigation; bounded window-local return tokens retain owner, task, exact delivery version, pending interaction, focus and scroll. Source components remain mounted while settings are open. Deleted sources fail explicitly; delayed navigation cannot replace newer work. Pending replies remain unresolved with drafts preserved.

Evidence: A2 token/validation tests (4); full suite 1444 passed/20 opt-in skipped; typecheck/build passed. A2-smoke-final exit0 covers handoff permission failure -> recipient settings -> original v1 and draft despite published v2, nested Escape, analytics return, deleted source, actual chat pending draft, late lookup rejection. Home grid overflow fixed and A1-visual exit0; inspected light375/dark1024 home and navigation screenshots. Resizable detail captures use the full available viewport to represent user resizing.

## FINAL：整合证据与验收矩阵

| 验收 | 实现与证据 |
| --- | --- |
| EXP-01/02 | `home.test.ts`、`summary.test.ts`、`contactReturnLocation.test.ts`；home/navigation Electron 烟测与 `artifacts/contact-home`、`artifacts/contact-navigation` 深浅色 375/1024 截图。统计只计算有效记忆，研究候选不冒充已生效记忆。 |
| EXP-03/04 | `portfolio.test.ts`、`deliveryReading.test.ts`；portfolio 重启/收藏/搜索/新版隔离和 iframe 伪造事件烟测。 |
| EXP-05 | `citations.test.ts`、`citation-revision.test.ts`、citation Electron；实际模型历史版本评审与最终整合消息引用持久化。 |
| EXP-06/07 | `memories.test.ts`、`memory-tools.test.ts`、`context.test.ts`；memory Electron 失败保稿、历史/忘记和实际请求回执；真实模型使用纠正后的任务记忆。 |
| EXP-08/09 | `materials.test.ts`、`material-tools.test.ts`、material 导入烟测；最终整合后台实际工具读取资料；真实模型实际 `read_contact_material`，输出对应姓名/地点/日期/颜色和资料版本。 |
| EXP-10/11 | `handoffs.test.ts`、`handoff-review.test.ts`；handoff/navigation/experience 烟测覆盖来源权限、独立评审、重启、交回意见、新版冲突与保稿。 |
| EXP-12/13 | capability/file/runner 单测；capability Electron 真实文件预览与原字节导出；真实 Docker opt-in 测试 2/2 通过，含 Node/Python/Bash 及文件归档。 |
| EXP-14/15 | 各模块事务/失效测试与 Electron 故障注入；公共任务、联系人权限、交互、聊天修改、定时安排及展示回归。既有未读闪烁、单描述与运行限制保留。 |

最终整合 `--contact-experience` 在同一作者任务上通过：文字资料导入、任务范围记忆、真实 worker 的模型工具请求、正文与文件事务保存、worker 重启、固定版本引用讨论、独立接收者评审、用户交回意见、作者版本 2、旧意见冲突保稿及新版定位。原归档文件字节不受修订影响。证据：`artifacts/contact-experience/result.json`、`receipt.png`；通过标记 `CHOUYU_CONTACT_EXPERIENCE_SMOKE_PASSED`。

最终命令：`npm run typecheck`、`npm test`（1453 通过 / 20 默认 opt-in 跳过）、`npm run build`；Electron `--agents`、`--assistant-routines`、`--presentation`、`--contacts`、`--contact-experience` 均退出 0 并出现通过标记。日志归档在 `artifacts/contact-experience/verification/`。构建仍有既有 chunk 大小提示。

实际环境抽测：`CHOUYU_TEST_DOCKER=1 npx vitest run src/main/skills/docker.integration.test.ts` 通过 2 项；`node scripts/test-contact-model.cjs --experience` 通过 1 项。后者仅从本机已配置联系人读取模型配置和凭据，全部资料、人物与任务为合成数据，未修改用户聊天或真实任务。实际模型为 `as-glm-5.2`，供应方回报 `glm-5.2`；最后两次响应记录共 2220 Token，不将该值冒充含工具请求及前次抽测在内的账单总量。原始输出和用量回执位于 `artifacts/contact-experience-model.json`，无凭据。人工检查确认纠正姓名、资料事实与第 1 版评审对象；模型仍可能加短说明，未声称覆盖任意模型的长期措辞质量。

最终独立审计：完整分支一次审查，无 Critical，发现 9 项 Important，已在一次修复中处理；没有延后 Minor，也没有 Declined to judge。另在真实 IPC 回归中发现无对应请求的工具事件会落入当前会话，已移除这种回退归属，迁移夹具继续严格验证原会话两条消息不被改写。逐项修复、失败测试与取舍见[最终审查记录](contact-experience-review-20261012.md)。

最终补充行为：清除或无法映射的 iframe 选择不会沿用旧引文；阅读位置串行合并保存；资料引用打开当时片段；后台成果按分节所属轮次显示实际提供的记忆版本；交付回执和评审来源均打开固定版本正文；交接卡复用真实任务状态；成果集更新入口保留原快照；已撤回资料可经单份确认清理正文以释放容量，来源记录及旧引用移除提示保留。

早期各阶段的“待最终验收”是阶段时点记录，当前结果以 FINAL 和最终审查记录为准。

收尾验证：`REVIEW-suite.log` 为 1453 通过、20 默认跳过；类型检查、构建、五组 Electron、单独资料清理故障注入、真实 Docker 2/2 和模型 1/1 均通过。新增清理弹窗在浅色 375 与深色 1024 已人工检查，边界断言覆盖两种主题与两种宽度。旧桌面脚本同步改为选择可见窗口中的控件，并等待暂停状态刷新后编辑，以避免操作隐藏的保留界面或持有过期任务版本。构建只保留既有大 chunk 提示。

交付分支为 `feat/contact-experience`，位于隔离工作树 `C:/Users/Administrator/.codex/worktrees/1376/ChouYu`。实现、审查修复与文档均已完成；合并回 master、推送 PR 或保留分支的最终方式等待用户选择，不擅自发布。
