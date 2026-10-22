# ChouYu 完整系统迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成已确认的全部系统迭代建议，每项具有真实接入与当前验证证据。

**Architecture:** 保留模块化单体及现有 AgentSpace；以业务域收敛 IPC、交付和任务契约。迁移聊天增量存储与成果正文块，保留原事务、来源、权限和恢复保证；进一步接通反馈修订及依赖唤醒。

**Tech Stack:** Electron、React 18、TypeScript、better-sqlite3、现有原生/DSH Harness、Vitest；不增加产品依赖。

**Spec:** [已确认完整设计](../specs/2026-10-22-system-evolution-design.md)。用户确认设计的消息为“ok”；用户以“嗯嗯”确认计划并选择当前会话原生执行，现已进入实施。

## Global Constraints

- 全部子计划继承设计“不变量”和 AGENTS.md；联系人产品规范以 `docs/contact-task-spec.md` 为唯一入口，用户待办重复规则以 `docs/task-scheduling.md` 为准。
- 联系人和 ChouYu 安排共用任务 UI；自然语言单描述任务弹窗、Esc、保存失败留稿及默认焦点装饰不回退。
- 所有主动消息均保留未读闪烁；正文来自已保存成果，不额外调用模型改写；人设与公共交流规则分离。
- 各任务域保留原执行引擎；成果、进度、待投递记录同事务；取消须等待实际执行退出。
- 不新增快速新建、多选、批量处理、今天页过期提示和筛选条件标签，不扩大为系统服务或云执行器。
- 不启动 24 小时长测或跨日等待；隔离夹具不得冒充真实模型，单测不得冒充真实 UI 验收。
- 遵守 Node >=24.0.0 <25 的仓库要求，复用现有依赖；不修改用户真实数据进行迁移实验。

## Review Focus

1. 写入失败后保留的内存消息/回执：重试必须持久提交一次，不能在落盘前确认源域。归属计划二 Task 1、计划三 Task 2。
2. 切换页面或联系人的迟到响应：不能覆盖当前页面、清除草稿、停止原请求或扩大已读范围。归属计划一 Task 2/3。
3. 迁移中断、目标库已提交但旧入口标记未更新：下次启动须继续核对，不能重复导入或回退读取旧历史。归属计划三 Task 2。
4. 等待/暂停期间权限、预算和来源连续变化：新事件不能解除用户暂停或触发过期版本执行。归属计划四 Task 2/3。
5. 删除共享正文块、清空聊天或删除联系人后恢复：旧回执和跨版本引用仍正确，已删除消息不能复活。归属计划二 Task 1、计划三 Task 3。

## 子计划与顺序

| 顺序 | 子计划 | 对应设计 | 可审查交付 |
| --- | --- | --- | --- |
| 1 | [应用与界面边界](2026-10-22-system-evolution-application.md) | A1/A2/A3 | IPC 分域、聊天服务、preload、Workspace、TasksView、依赖检查 |
| 2 | [交付与任务契约](2026-10-22-system-evolution-domains.md) | B1/C1/D1 | 所有主动来源共用交付、三域类型契约、Store 分责及事务验证 |
| 3 | [存储与迁移](2026-10-22-system-evolution-storage.md) | E1/E2 | 完整保存测量、增量聊天库、原子迁移、成果正文块 |
| 4 | [协作与恢复](2026-10-22-system-evolution-workflows.md) | F1/G1/G2/H1 | 反馈与结果版关联、依赖唤醒、同任务恢复、文档与整体验收 |

推荐当前会话原生执行：由当前代理逐批实现和验证，完成后做一次独立整分支审查。各批共享存储及任务契约，顺序执行减少接口漂移。另一方式是逐任务派发实现与独立审查子代理；需由用户选择。

## 开始与记录

- [x] 核对 clean 基线 `ef40294`；设计/测量文档提交为 `44cf1f9`、`a5b917f`、`117c0ae`。
- [x] 基线类型检查与构建通过；全量 1973 通过、2 失败、53 跳过，两个 DSH 失败无改动专项复测通过。首次失败保留，不称根因已解决。
- [x] 文件保存预检确认 50,000 条合成历史的微小更新仍引起约 258–320 ms 同步保存，范围见验收记录。
- [x] 用户以“嗯嗯”确认完整计划和原生执行方式。
- [x] 执行前确认工作区；优先使用已有隔离机制。若当前仍为普通 master checkout，采用当前目录功能分支 `feat/system-evolution` 保留所有现有工作；需要额外 worktree 时遵守 worktree 技能，不复用有其他任务的工作树。
- [ ] 每个子任务完成后更新本计划勾选状态和 `docs/system-evolution-acceptance-20261022.md`，记录实际命令、退出码、测试数量及遗留问题。

## 最终完成核对

- [ ] 逐项核对设计 A1–H1，检查真实业务调用方，不以接口定义或目录存在认定接入。
- [ ] `npm test`、`npm run typecheck`、`npm run build` 全部通过；每次失败保留原始日志，任何间歇复测说明范围。
- [ ] 构建后运行 `node scripts/smoke-electron.js` 完整回归；按涉及场景补 `--chat-close`、`--chat-edit`、`--chat-scroll`、`--agents`、`--assistant-routines`、`--companion`、`--reminders`、`--dsh-harness`、`--navigation`、`--task-scheduling`、`--task-views`、`--task-edit`、`--contact-experience`。同一改动已由完整回归充分覆盖时不重复运行。
- [ ] 实际交互并查看相关截图：宽窄、明暗、Esc、穿透、草稿失败与返回来源；阅读回执不扩大范围。
- [ ] 固定旧聊天/成果迁移夹具核对正文、顺序、归属、来源、已读、回执和导出；故障注入及恢复均通过。
- [ ] 1k/10k/50k 聊天与 10/100/300 成果版本测量有优化前后报告，分别标明纯存储、完整产品路径及 UI 测量范围。
- [ ] 独立整分支审查，修复 Important/Critical 问题并完成相关回归。
- [ ] 更新 roadmap/current-status、存储恢复说明、联系人规范/架构及图册源码入口；保留历史记录但不再混作当前待办。
- [ ] 检查无不相关修改与敏感信息；提交所有工作并给出分支、验证和剩余实际限制。最终集成按届时用户已有授权和仓库状态执行，不擅自发布安装包。

暂时完成一个子计划不代表整个目标完成。只在完整矩阵证据充分后将目标设为 complete。
