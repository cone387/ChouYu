# AgentSpace 存储与进程恢复验收（2026-10-19）

完整模块化计划 Task 4。测试数据全部独立于用户数据，模型响应来自本机协议夹具。

## 已复现并修复

四条启动失败路径泄漏 SQLite 连接：任务库 schema 初始化失败、检查点 WAL 初始化失败、任务库打开后检查点打开失败、两库打开后模块装配失败。使用真实 SQLite 和 Windows 文件重命名验证，修复前四项均因 `EBUSY` 失败，修复后均通过；没有使用数据库 mock 或依赖进程退出释放句柄。

任务库和检查点库在 WAL 初始化失败时关闭新连接；schema 初始化失败也关闭本连接。WorkLoopHost 中途失败按依赖顺序关闭已经创建的运行时和任务库，不关闭调用方持有的其他库。

存储失败记录 `tasks/checkpoints`、`open/wal/schema` 与 SQLite 错误码。worker 通过 RPC 传递分类，主进程诊断只持久化分类和阶段，不写原错误正文、模型请求或凭据；失败响应不再错误标为 completed。

## 运行证据

- `storage-startup-red.log`：四项真实文件锁失败；`storage-startup-green.log`：9 项启动和宿主测试通过。
- `storage-diagnostic-red.log` / `storage-diagnostic-green.log`：失败阶段分类从失败到通过。
- `storage-rpc-red.log` / `storage-rpc-green.log`：结构化诊断与正文隔离从失败到通过，最终 10 项相关测试通过。
- `node scripts/agentspace-recovery.cjs --rounds 24`：真实 Electron utilityProcess。先制造检查点损坏，核对 `checkpoints/wal/SQLITE_NOTADB`，在失败 worker 仍存活时重命名任务库证明连接已释放。随后两个联系人并行，在请求中途和事务完成后交替硬终止，共完成 24 次重启、48 次 `integrity_check`，已提交成果未丢失，执行恢复后均退出在途状态。始终保留另一个真实只读连接跨越重启；不删库、不重试掩盖失败。
- 最终报告 `artifacts/agentspace-complete/storage-recovery.json` 记录开始/结束时间、各代 PID、终止和重开事件、成果计数、72 次夹具请求；`complete=true`。日志 `storage-recovery-final.log`。
- 全量 `npm test`：1942 通过，53 按既有条件跳过；Node/Web 类型检查、构建通过；真实 Electron `--agents` 回归通过。日志 `task4-suite.log`、`task4-typecheck.log`、`task4-build.log`、`task4-agents-smoke.log`。

## 结论边界

2026-10-16 曾出现的 `SQLITE_IOERR_TRUNCATE` 未在本次 24 轮压力测试复现，其具体 Windows 触发条件仍未证实。本次修复的是已复现的启动资源泄漏，并补齐原错误所缺的库/阶段诊断；不声称永久消除了所有磁盘 I/O 错误。后续真实 24 小时验收继续检查该类错误。

这不是 24 小时耐久验收；完整计划的 Task 5 和最终审查/交付仍未完成。
