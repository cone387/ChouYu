# 联系人完整优化执行记录

计划：`docs/superpowers/plans/2026-10-13-contact-next.md`。
基线：`d2cff72`；工作区 `C:/Users/Administrator/.codex/worktrees/6c8d/ChouYu`，分支 `codex/contact-next-complete`。

用户授权：评估后的「全部做好」，涵盖五项优化和卡片直达。持续执行并保留完整范围。

## 状态

- Task 1 分批全文核对：实现与模块验证完成；真实模型验收归 Task 6，仍待执行。
- Task 2 聊天调整：实现、模块与 Electron 验证完成；真实模型抽测归 Task 6。
- Task 3 日历与联系人定时：待实施。
- Task 4 性能：待测量及实施。
- Task 5 卡片直达：待实施。
- Task 6 长期验证与整合：待执行。

## 实施决定

- 复用已锁定 node_modules 的独立副本；不改共享依赖或真实应用数据。成本是额外磁盘空间。
- 使用当前用户授权直接落实上述范围；设计和计划随实现保留以便检查，不反复要求批准已明确的优化项。
- 分批核对先实施，定时与聊天能力随后衔接；真实长期验收独立记账，未完成不关闭总目标。

## 接口核对

- Task 2/3：聊天中的定时路由需在日历能力上线后接入公共保存入口，不能保持 unsupported 后声称全部聊天调整完成。
- Task 3/4：新的调度状态通过现有 changed 事件更新，共享查询不得丢失变化。
- Task 4/5：卡片来源快照必须与显示摘要同批返回，不能从后台最新值猜版本。

## Task 1 验证

- 新长文测试先失败（`artifacts/contact-next/completion-red.log`），原实现无法覆盖七个万字分节。
- 实现按分节缓存、超长单节不切断 Unicode 代理对、八份一组层级综合；Schema 14 的 `completion_reviews` 随任务删除级联清理。
- 新测试又发现替换中间章节被移动到结尾、过多问题使最终证据膨胀；均在 `completion-boundary-red.log` 复现后修复，`completion-boundary-green.log` 36 项通过。
- 已测：取消不缓存、失败重启续查、跨轮次复用、要求变化失效、正文局部变更、预算耗尽后接续、已知缺口不能被最后一轮误判覆盖。
- 全量 `npm test`：1484 通过、20 跳过；类型检查通过。日志 `task1-suite.log`、`task1-types.log`。真实在线模型与24小时验收尚未执行。
- 实施决定：缓存键包含本轮上下文以避免用户回复/事实变化后复用旧判断；不同上下文可能额外重查，优先保证结论不陈旧。问题摘要最多展示12条并保留总数/遗漏数，原始问题在各批回执中保存；任何已有问题仍阻止有限目标结束。

## Task 2 验证

- 工作设置补丁支持无任务联系人，白名单、版本和归属校验，事务保存原始要求；结束/放弃保留成果，解除 Token 不改变调用额度和终止状态。
- 删除使用单次准备和明确范围确认；即使联系人工具策略为自动允许也要求确认，拒绝不删除。
- `chat-controls.test.ts` 14 项真实 SQLite/AgentService 集成通过；包括审计写入失败回滚、过期版本、跨联系人、结束后不复活。新增已结束/放弃回执测试先 2 项失败，修复后通过（`ended-receipt-{red,green}.log`）。
- `CHOUYU_SMOKE_CHAT_CHANGE_ONLY=1 node scripts/smoke-electron.js --agents`：真实 Electron 聊天路由、权限、保存、删除拒绝/确认通过（`task2-chat-smoke.log`）；模型为本地夹具。
- 最后全量 `npm test` 1494 通过、23 跳过，类型检查及构建通过（`task2-final-suite.log`、`task2-final-types.log`、`task2-build.log`）。跳过包含需在线模型的测试，不能算真实语义验收。
- Task 3 接口待办：聊天定时当前仍如实说明缺口；公共自然语言编辑的清除 Token/结束应随网关对齐，不恢复多字段表单。
