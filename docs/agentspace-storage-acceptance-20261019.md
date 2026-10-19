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
- 初次报告已保留为 `artifacts/agentspace-complete/storage-recovery-initial.json`，记录各代 PID、终止和重开事件、成果计数、72 次夹具请求；`complete=true`。日志 `storage-recovery-final.log`。
- 全量 `npm test`：1942 通过，53 按既有条件跳过；Node/Web 类型检查、构建通过；真实 Electron `--agents` 回归通过。日志 `task4-suite.log`、`task4-typecheck.log`、`task4-build.log`、`task4-agents-smoke.log`。

## 最终回归发现与补正

整分支 Electron `--agents` 回归再次出现 `tasks/wal/SQLITE_IOERR_TRUNCATE`，日志 `task6-agents.log`。因此初次压力测试通过不能作为该错误已经解决的证明。

新增真实 Windows 文件映射夹具：保存一致的 SQLite 主库/WAL 文件，在另一进程保留 SHM 映射；打开数据库实际触发同一个 `SQLITE_IOERR_TRUNCATE`。释放映射后，同一主库/WAL 可重开，已保存数据和 `integrity_check` 均通过。这与 [SQLite 关于 Windows 映射文件不可截断的说明](https://www.sqlite.org/mmap.html)一致，但没有证明原冒烟失败的句柄持有者就是此条件。

worker 初始化仅对 Windows、WAL 阶段、精确错误码 `SQLITE_IOERR_TRUNCATE` 进行 100/250/500 毫秒的三次有界重开；每次失败先释放部分启动资源，记录库、阶段和次数，不删除数据库。映射持续不释放时仍失败；损坏数据库 `SQLITE_NOTADB` 不重试。真实文件映射的释放/持续占用与损坏库测试通过。RPC 中间重试事件不得被误认为初始化成功，已有对应回归。

压力程序补齐“保留/不保留另一个只读连接”与“请求中途/提交后终止”的四种组合。最新 24 轮全部通过，48 次完整性检查、72 次本地请求，报告 `storage-recovery.json`，日志 `storage-recovery-four-modes-final.log`；没有触发存储重试。另一次 100 轮尝试在第 67 轮后因原定每日 Token 预算耗尽停止，报告 `storage-recovery-67-budget-stop.json`，不能计作 100 轮通过，也未为压力测试扩大预算。

有界恢复后的 Electron `--agents`、`--chat`、`--assistant-routines`、`--companion`、`--dsh-harness` 已通过；日志 `task6-recovery-*.log`。此轮未重现原 WAL 错误，不能把无故障回归当作已经证明原错误根因。后续接单解析修复也完成全量回归：1966 项通过、53 项跳过，类型检查和构建通过，联系人 Electron 再次通过（`final-fixes-*`）。

## 结论边界

已复现启动资源泄漏和一种实际 Windows SHM 映射引起的截断错误，并补齐有界恢复及分类诊断。原间歇故障的具体句柄来源仍未证实，不声称永久消除了所有磁盘 I/O 错误。后续真实 24 小时验收继续检查该类错误。

后续规划工具边界和待删除联系人恢复隔离修复后，全量回归为 1969 项通过、53 项跳过；Node/Web 类型检查、构建及 Electron 联系人回归通过，证据为 `removal-restart-{tests,types,build,agents}.log`。这些检查不代替真实耐久验收。

首个真实 24 小时样本于 2026-10-19 13:12:40 +08:00 启动，冻结提交 `541927d51b95c635117cce744d8dd30869cfb509`，输出 `artifacts/agentspace-complete/full24h-2026-10-19T05-06-18-214Z`。运行约 66.7 分钟后因来源字数范围误判主动停止，未完成验收；停止前存储错误为 0，不据此声称 24 小时稳定。范围修复、重新启动完整样本及 Task 5/最终审计/合入推送仍按完整计划推进。

## 第二完整样本停止与报告文件冲突（2026-10-19 20:58）

来源字数修复后的第二样本 `full24h-2026-10-19T06-24-12-025Z` 使用冻结提交 `6cf4d8e`，从 14:33:14 运行至约 20:58，实际有效观测 23113488ms、4588 次采样。原生和 DSH 各完成两次交付，分别记录 11 次调用 / 27390 reported tokens、7 次调用 / 44534 reported tokens；worker 硬重启、应用重启、暂停恢复和预定 HTTP 503 后恢复已有证据。重复消息和产品存储错误为零。

20:56:44，验收程序原子替换 `module-evidence.json` 时出现一次 Windows `EPERM`。后续采样恢复，但本样本不满足观察错误为零的门槛，已主动停止，监控会话 90171 退出 2；不计作 24 小时通过，不与新样本拼接时长。隔离复现确认并发读取能触发同类替换失败，无读取者的 8735 次替换成功。报告写入已补仅限 Windows 文件占用错误的有限重试，真实读句柄临时释放/持续持有回归已完成失败到通过；完整回归与新长测以实施计划后续记录为准。

报告写入修复复验（2026-10-19 21:07）：专项 8 项通过；全量首次出现两项 DSH 等待/超时失败，未调整超时或代码的单独复测与全量复测均通过（全量 1975 通过、53 跳过）。具体首次延迟来源仍未确定，保留日志。类型检查、构建、Electron 联系人冒烟通过，会话 26471 退出 0；详见完整实施计划与 `report-lock-*` 日志。完整 24 小时验收仍未完成。
