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

设计矩阵 A1–A3、B1 已完成专项验证；C1–H1 仍待实现与验证：任务命令类型、ContactTaskStore 拆分、聊天存储测量与优化、成果正文去重、反馈修订关联、成果依赖事件、失败恢复衔接及文档校准。整体尚未完成。

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
