# 系统迭代验收记录（2026-10-22）

设计：[完整系统迭代](superpowers/specs/2026-10-22-system-evolution-design.md)。

当前阶段：用户以“ok”确认书面设计；[完整实施计划](superpowers/plans/2026-10-22-system-evolution.md)及四个子计划已写入，用户以“嗯嗯”批准原生执行；已在 `feat/system-evolution` 开始 A1 实施。以下是改动前基线，不是本轮功能完成证据。

## 基线

代码基线 `ef40294`，Windows / Node `v24.15.0`，已有依赖。测试使用仓库既有夹具，未修改产品代码或测试超时。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | Node/Web 均通过，退出 0 | `artifacts/system-evolution/baseline-typecheck.log` |
| `npm run build` | 通过，退出 0；renderer 主入口约 1171 kB，保留大 chunk 提示 | `artifacts/system-evolution/baseline-build.log` |
| `npm test` | 240 文件通过、2 文件失败、15 文件跳过；1973 项通过、2 项失败、53 项跳过，退出 1 | `artifacts/system-evolution/baseline-tests.log` |
| `npm test -- src/main/harness/dsh/packaging.test.ts src/main/harness/dsh/background.test.ts` | 不修改代码的专项复测：6 项通过、1 项按原条件跳过，退出 0 | `artifacts/system-evolution/baseline-dsh-recheck.log` |

首次失败分别为实际 electron-builder 资源复制测试超过 5 秒，以及后台工具取消清理测试未在 10 秒内等到工具开始（其 afterEach 也超时）。专项复测通过不能证明根因已消除；不通过调大超时、关闭断言或删除数据掩盖失败。

## 文件保存预检

使用 Node 24 原生类型剥离直接导入产品的 `src/main/store-file.ts`，调用实际 `writeStoreFile`。隔离夹具位于 `artifacts/system-evolution/storage-baseline/`；每条消息含 520 字符合成正文，预先写入一次，然后三次各仅修改最后一条正文，测量 JSON.stringify、完整备份与耐久替换写入。`setImmediate` 延迟记录同进程事件循环被此同步路径阻塞的时间。

机器：Windows、Intel Core 5 210H。原始结果：`artifacts/system-evolution/storage-baseline/report.json`，2026-10-22 10:48 +08:00。

| 消息数 | 当前文件字节 | 三次保存耗时范围 | 下一事件循环延迟范围 |
| --- | ---: | ---: | ---: |
| 1,000 | 652,465 | 8.77–9.87 ms | 8.92–9.94 ms |
| 10,000 | 6,542,965 | 49.73–74.32 ms | 49.80–74.47 ms |
| 50,000 | 32,802,965 | 258.41–319.57 ms | 258.47–319.90 ms |

范围：测试真实文件保存函数及序列化，不包含 `serializeStore` 的消息归一化/附件处理，不是 Electron UI 或完整 database 保存、启动/查询基准。只用于确认微小更新仍承担全量写入成本，不能据此宣称已定位所有界面卡顿。后续 E1 必须补完整链路测量及优化后的对比。

代码边界复核：`database.ts` 的 `appendContactMessage` 在写入失败时保留内存消息及 receipt，重试先尝试持久化而不再次插入。现有 `database.test.ts` 已分别覆盖普通联系人与助手消息的这种行为。迁移必须区分“内存待保存”和“已持久提交”，既不能丢失待保存正文，也不能在落盘成功前确认源域。

## 待完成范围

设计矩阵 A1–A3、B1、C1、D1、E1–E2 已完成专项验证；F1–H1 仍待实现与验证：反馈修订关联、成果依赖事件、失败恢复衔接及文档校准。整体尚未完成。

后续每批记录实际提交、专项/完整测试、真实 Electron 交互与截图、迁移数据核对和剩余缺口。未执行的检查不标为通过，不用本文件或设计文件的存在代替功能证据。

## A1 当前验证
IPC/preload 已按域拆分，ChatService 持有请求取消和退出等待；技能注册精确注销。24 项定向测试、Node/Web 类型检查、构建通过。此前聊天/harness 回归 165 通过、3 跳过。Electron --chat-edit 通过；--chat-close 首次未在 10 秒内到达模型，增加临时诊断后复测通过（worker init 3265ms），已移除诊断；首次原因尚未确证，保留原始失败日志。构建仍有既有 chunk size 提示。日志位于 artifacts/system-evolution/application-task1-*。

## A2 工作区阶段
Workspace 已承接页面保活、全局搜索、联系人来源导航、工具确认和唯一会话 hook；ChatPanel 只呈现聊天，聊天命令另有 hook。导航版本守卫覆盖会话选择、联系人来源和助手聚焦，返回复核原会话归属与阅读位置。89 项相关回归、类型检查、构建通过；--navigation（含新增延迟 IPC/草稿/顶层 Esc 场景）及 --chat-close 通过。四张宽窄/明暗截图已查看，位于 artifacts/system-evolution/workspace。首次新增 smoke 选择了上一场景删除但尚留在 UI 的夹具卡片，已修正夹具选取并保留日志。TasksView 分责仍在 A3 实施范围，整体目标尚未完成。

## A3 任务页与依赖检查
已接入 useTaskData/useTaskCommands/useTaskDrafts/TaskList，原任务视图保留组合、筛选和单任务操作。43 项定向测试通过，覆盖迟到响应、后台失效、跨日、保存失败重试及依赖违例；类型检查、构建、check:boundaries 通过。--task-views、--task-edit、--task-scheduling 真实 Electron 验收通过，相关列表/看板、编辑字段、重复与提醒宽窄/明暗截图已检查。日志位于 artifacts/system-evolution/application-task3-*，截图位于 artifacts/system-evolution/tasks。构建提示保持原有大 chunk；一次无截图 task-edit 记录 UnknownVizError，断言与退出码通过，带截图重跑通过。

## B1 共同消息交付

`messaging` 统一编排持久化和可重试通知；数据库仍负责正文校验、归属、既有 receipt key 与失败写入重试。真实调用链：联系人 notice/action outbox → deliverMessage → 数据库提交 → 源域 ack；晨报 runner、问候/回来 CompanionBriefing、待办 scheduler claim、稍后提醒 SnoozeService、proactive IPC → 同一入口。通知失败不撤销持久结果，不重写正文，独立定时重试并继续通知其他窗口。所有类型沿用统一未读与托盘闪烁。

181 项定向回归通过、5 项按原条件跳过；类型检查、构建、依赖边界通过。三种交付类型均实测磁盘失败后一次插入、重启去重、清空后不复活；另测原会话删除的持久失效回执、错误归属/来源、可见消息已读边界、部分窗口广播失败。四项 Electron 专项 `--agents`、`--assistant-routines`、`--companion`、`--reminders` 通过；日志位于 `artifacts/system-evolution/domains-task1-*`。模型使用既有隔离夹具，并非真实供应商长期运行。

首次 reminders smoke 的直接 scrollTop 赋值后未读被清除；加位置诊断复测未重现，根因未确证。测试现模拟实际向上滚轮以退出自动跟随，并新增 800ms 后原阅读位置断言；复测通过。修改夹具过程中一次重复顶层变量声明报错，已用局部作用域修正。保留全部失败日志；未改已读判定或减弱原未读断言。

## C1 任务命令契约

TaskCenter 的注册、绑定、execute/list/read 保留 todo/assistant/contact 的具体类型；联系人命令的参数与结果来自 shared/contact-commands，公共签名复用 AgentAPI，worker 特有参数显式定义。AgentSpace、WorkLoopHost、ContactWorkLoop、worker RPC、后台模型与实际聊天/工具入口均已接入。外部未知参数走显式 dispatchUnknown 和工具边界适配，再沿用域内归属、权限、版本校验；普通调用不接受任意字符串方法或自选返回类型。worker 的返回分支也经同一结果类型检查。

编译断言证明错域 assignTopic、字符串 revision、未知命令和把 delivery 当待办均失败；运行时覆盖未知命令、非数组参数、错误联系人、过期版本和卸载后旧绑定。扩展回归 676 通过、43 跳过；Node/Web 类型、边界检查、构建与 Electron --agents 通过，日志 `artifacts/system-evolution/domains-task2-*`。故意测试非法/旧参数的夹具改走动态边界；正常夹具移除原来被忽略的多余位置参数，原状态断言保留。

类型检查另发现隔离 soak 初始化把 Token 上限混入只接收调用额度的命令，原字段实际被忽略。现拆成两个已有命令并重新读取版本；本轮没有启动该真实供应商或 24 小时验收。

## D1 联系人存储职责

ContactTaskStore 保留兼容入口，将查询、额度、调度、变更和结果提交分别委托窄端口模块，共享原 SQLite 连接。77 个方法体经结构比对保持原逻辑；dashboard 原先隐含的交互状态整理留在外层，查询模块只接收只读连接及已整理的高亮。迁移初始化在模块构造前直接读取 profile，避免调用尚未创建的查询模块。

真实 SQLite 触发器分别注入 reports、delivery_versions、topics 进度和 notices 写入失败，四种情况均完整回滚；重试和重复重试只生成一版成果和一条待发通知。预算占位、恢复轮次和只读查询另有专项断言。扩展回归 679 通过、43 跳过；Node/Web 类型、边界、构建和 Electron --agents 通过。退出阶段日志记录正在退出的 IPC 拒绝，smoke 最终成功。证据位于 `artifacts/system-evolution/domains-task3-*`。

## E 存储完整基准（改造前）

`node scripts/benchmark-system-storage.cjs` 通过真实 Electron 44.2.0 / Node 24.20.0 主进程运行产品 database 和 ContactTaskStore，基线 `07d0139`，Core 5 210H / Windows。每会话 500 条消息，合计 2/20/100 个会话；含已读、来源、独立附件和状态回执，重启核对。只用脚本生成的临时目录，不连接模型。报告 `artifacts/system-evolution/storage-before.json` 冻结，脚本拒绝覆盖。

| 消息总数 | 启动 ms | 搜索 ms | 单条更新并保存 ms（3 次） | 同期主循环延迟 ms |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 67.86 | 1.19 | 23.45–26.31 | 23.87–26.53 |
| 10,000 | 273.64 | 6.18 | 119.51–144.61 | 119.72–144.68 |
| 50,000 | 1,315.51 | 25.97 | 691.87–834.06 | 692.01–834.19 |

成果走真实 finish 事务，每版新增 2,000 字符一章：10/100/300 版累计快照分别 118,009 / 10,679,108 / 95,408,208 字节，唯一正文 20,000 / 200,000 / 600,000 字节。300 版写入总计 58.76 秒、固定版读取 1.45ms、Markdown/HTML 导出 325.52ms；数据库全目录 293,923,192 字节还包含索引、运行输入和 WAL，不把它当纯正文存储。首版/末版、逐章正文及两种导出已核对。

首两次夹具分别触发未结束轮次复用和继续研究缺少下一步的真实校验，已改走 finish 并提供有效下一步，未放宽产品约束。构建、Node 类型及完整基准通过。该结果不代表 UI 质量或全天性能。

## E1 增量会话存储

会话、消息、元数据与送达回执接入同一 SQLite 事务，已有 database API 保留内存待保存状态。迁移先保留 `.legacy` 原件、事务导入并逐项比较，再写入带迁移身份的 v5 阻写标记；标记失败前不放行新写入。坏库隔离整组 WAL 文件，只恢复验证过的快照；较新格式和无有效备份时阻止写入。每 60 秒有变更时及正常退出创建一致性快照，不逐消息复制全库；恢复可能落后最近提交，提示明确说明此边界。退出等待后台工作后再次保存，失败仍拦截退出。

同机真实 Electron 基准（`18910d5` 加本任务未提交变更，2026-10-22 13:19），报告保留为 `artifacts/system-evolution/storage-conversations-after.json`：

| 消息数 | 首次迁移 ms | 后续启动 ms | 搜索 ms | 单条保存 ms | 三次修改实际 UPDATE 行数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 55.19 | 26.78 | 0.85 | 5.11–8.29 | 3 |
| 10,000 | 283.42 | 161.68 | 3.71 | 6.06–8.98 | 3 |
| 50,000 | 1,626.33 | 463.90 | 14.25 | 6.21–10.98 | 3 |

5 万条时事件循环延迟 6.26–11.04ms。仍按每会话 500 条测量，活跃会话保存需扫描本会话消息，启动和搜索仍全量加载；首次迁移和定时快照仍是同步工作。本轮并未优化这些成本。

93 项存储/数据库/消息交付测试通过，覆盖真实 SQL 故障、事务回滚、标记失败后重启、备份损坏/较新格式、附件恢复与缺失、仅变更行写入、退出第二阶段失败。Node/Web 类型、依赖边界、构建、完整 Electron 回归和性能基准通过；四张保存失败 UI 明暗/宽窄截图已查看。证据 `artifacts/system-evolution/storage-task2-*`、`storage-ui/`。

完整回归修正旧夹具对关闭即卸载、内嵌子项表单、隐藏页面同名选择器、弹窗内错误位置和聊天请求归属的假设，保留原功能断言。任务助手改用实际输入框发送并识别配置路由的模型请求。联系人提问第一次失败经诊断确认正文与未读已保存到上一场景会话：新会话直接由主进程创建后未通知保活界面，旧会话延迟保存改变最近会话排序；补发会话事件并等待界面选中后完整回归通过。另有一次菜单展开超时及 UnknownVizError 未稳定重现，保留原始日志，不宣称消除所有间歇故障。退出后的 IPC 注销拒绝不影响已完成的持久化与 smoke 退出码。

## E2 不可变成果正文

成果版本内部改为 SHA-256 正文块与清单，对外仍重建原 AgentDelivery；读取验证正文哈希，权限仍由联系人/任务/固定版本校验。正式成果、正文块、版本引用、检索索引、任务进度和通知同事务提交。旧快照重建比较后替换，整个任务库初始化与版本 18 标记同事务，防止旧应用继续写入不兼容格式。删除任务/联系人时仅清理无引用正文。检索规范化正文也改为共享块，保留 Unicode、小写匹配、跨标题/章节边界查询、分页顺序及已读哈希。

2026-10-22 13:37 同机真实 Electron 基准，`90ac09e` 加本任务未提交变更，报告 `artifacts/system-evolution/storage-after.json`：

| 版本数 | 唯一正文块字节 | 成果清单字节 | 检索正文及小写副本字节 | 检索清单字节 |
| --- | ---: | ---: | ---: | ---: |
| 10 | 20,000 | 11,969 | 40,000 | 7,918 |
| 100 | 200,000 | 924,708 | 400,000 | 735,211 |
| 300 | 600,000 | 8,185,008 | 1,200,000 | 6,646,311 |

300 版旧全文快照为 95,408,208 字节，且另有逐版全文检索副本；现在正文按唯一内容增长，章节元数据清单仍累计增长。全目录从基线 293,923,192 字节降为 42,620,920 字节，包含运行输入和 WAL，不能当作纯正文量。写入全部 300 版总计 74.00 秒（基线 58.76 秒），末版读取 9.08ms（基线 1.45ms），导出 328.48ms（基线 325.52ms）；哈希验证、引用写入增加成本，本项主要解决存储增长，不宣称所有性能指标提高。

117 项专项测试通过，包括 300 版逐项深度相等、Markdown/HTML 逐字一致、迁移中途回滚、缺块/错误正文、跨联系人权限、样式更新复用与删除共享引用。HTML 内嵌 JSON 的字段顺序也保留。两种新增 SQL 触发器失败验证正文/引用和外层完成事务一起回滚。300 版逐一导出测试使用含 Unicode/HTML 字符的 80 字符章节，约 37–53 秒；完整性能基准仍用 2,000 字符章节。最初长章节全版本导出消耗超过 120 CPU 秒后终止该测试 worker，短章节首次 30 秒测试超时后按实测设置单项 60 秒，未放宽其他测试时限。

扩展联系人/WorkLoop/AgentSpace/TaskCenter 回归 688 通过、43 跳过；Node/Web 类型、构建、依赖边界、Electron `--agents`、`--presentation` 和完整性能基准通过。首次 agents 强制 worker 重启在 checkpoints/WAL 初始化遇到 SQLITE_IOERR_TRUNCATE，原有三次有界重试均失败；空闲单独重跑通过，未修改重试策略或删除数据，根因未进一步确证。保留 `storage-task3-agents.log` 与成功复测日志，不能据此宣称该 Windows 间歇问题已修复。
