# 联系人任务请求可靠性验收（2026-11-05）

范围：借鉴本地 `dsh-superagent-prototype` 的事件身份、来源与处理追踪，在 ChouYu 既有任务库、工具、调度和共同 UI 中实现。依据 [现行规范](contact-task-spec.md) REQ-01–04、NL-03/04、RUN-02/03、MSG-03/06；[设计](superpowers/specs/2026-11-05-contact-request-reliability-design.md)、[计划](superpowers/plans/2026-11-05-contact-request-reliability.md)。不替换原生/DSH 引擎。

## 实现与证据

| 要求 | 实际实现 | 验证位置 |
| --- | --- | --- |
| 保留本次原话，模型不能伪造来源 | 宿主建立来源；工具 Schema 不接受该字段；持久卡片覆盖模型提供的来源 | `chat/task-request-source.test.ts`、`agents/interaction-tools.test.ts` |
| 同一用户消息重试/继续回复不重复，编辑/新消息可独立交代 | UI 传递稳定消息 ID 和持久编辑版本，宿主按会话、消息 ID、编辑版本、正文与引用生成身份；与网络请求编号分离，编辑回原文也独立 | `src/integration/task-request-retry.test.ts` 通过真实 renderer 重试辅助函数、streamChat、IPC 参数解析、宿主来源、工具和命令串联 |
| 连续补充与归属，歧义不猜测 | 独立记录、原归属与版本校验，任务路由输出夹具进入真实工具 | `agents/model-contracts.test.ts`、`contact/requests.test.ts` |
| 保存失败不假报成功 | 同一 SQLite 事务保存任务、回执及必要执行关联，提交后取消旧执行 | `task-request-command.test.ts`、`contact/requests.test.ts` 注入写失败 |
| 确认与重启 | 持久卡片保存原始来源，按任务请求去重，变更操作拒绝；执行不确定的外部副作用不自动重放 | `agents/action-interactions.test.ts`、`action-executor.test.ts` |
| 保存/执行/成果三个重启窗口 | 请求、轮次、实际输入时间、正式版本持久化；旧轮次被当前版本隔离 | `contact/requests.test.ts` 真实文件数据库关闭重开 |
| 实际执行证据 | 模型取得响应后标记当次冻结的输入 ID 集合；失败无响应、晚到补充不误记 | `workloop/task-requests.test.ts` 原生和真实 DSH 适配器连接本地协议夹具 |
| 正式成果与无成果区分 | 同一成果事务关联实际版本，失败回滚；只结束轮次显示无关联成果 | `contact/requests.test.ts`、`ContactTaskRequests.test.tsx` |
| 共用 UI 与分页 | 现有任务互动标签只读组件，原文纯文本，使用既有来源/成果导航 | 组件测试、`smoke/task-requests-smoke.ts` 真实 worker、preload、分页和暂停状态 |
| 删除与历史 | 删除原文/轮次，最小回执防重复；旧记录无来源不补造 | `contact/requests.test.ts`；数据库版本 22，旧版本不接受新库 |

## 验证记录

详细日志保存在开发工作区 `.superpowers/sdd/contact-request-reliability/`，集成时复制至项目 `artifacts/contact-request-reliability-20261105/`。

最终全量 `npm test -- --maxWorkers=2 --reporter=dot`：**305 文件通过、17 文件跳过；2341 项通过、63 项跳过，退出码 0**（`full-release.log`，160.17 秒）。跳过项保留项目原有按需/外部环境条件，没有为本次通过删测试或增加跳过。此次通过不撤销此前运行时不稳定记录。

- `npm run typecheck`：主进程与 renderer 工程通过；串联集成测试由 Vitest 执行，位于 `src/integration`，不混入任一生产工程。
- `npm run check:boundaries`：TypeScript 模块导入边界通过。
- `npm run build`：生产构建通过，保留既有大 chunk 提示。
- `node scripts/smoke-electron.js --task-requests`：真实 Electron/worker/preload 验证 23 条记录、重复提交不新增、重启保留、暂停任务零执行、分页、后台更新保留旧页、编辑版本保存及原始消息跳转；迁移校验通过，退出码 0。深浅色截图已检查，路径 `artifacts/task-requests/electron/requests-{light,dark}.png`，不声称全尺寸或完整桌面回归完成。
- 两次 2-worker 全量分别在 DSH `task-context` 与 `background-selection` 场景失败；两者在当前分支与未改动原项目单独复跑通过，尚未确认并发失败根因。为保留诊断，断言增加实际运行错误信息，未降低原业务断言。随后尝试串行文件执行，并保留此前失败记录；不能据此声称并发稳定性问题已修复。
- 串行全量为 2340 通过 / 1 失败 / 63 跳过，失败为 `runtime-lifecycle` 的 peer 关闭场景（执行代码未被本功能修改）；原项目四个对应场景单独复跑通过。此结果表明降低文件并发并未消除运行时测试的不稳定，仍保留诊断事实，不删测试或放宽业务断言。
- Electron 日志有数据库重开诊断、部分运行中的 ResizeObserver 提示及退出时待处理查询拒绝；该专项最终恢复、功能断言与迁移校验通过，不代表这些环境诊断已全部消除。

独立审查发现回复重试身份不稳定，已用真实 renderer → host → tool/command 测试复现后修复。审查另发现旧页阅读会被后台变化清空，按阅读可靠性问题提升为必修项，已通过 Electron 场景复现并修复；翻页后收到更新时保留当前记录，提示用户主动刷新。没有延期处理的审查问题。

## 适用边界与工程裁决

- 新链路覆盖带宿主来源的聊天任务工具及聊天回答本联系人的持久任务追问。手动设置表单、卡片输入本身、跨联系人代答、助手内置职责继续使用原记录机制；不伪造它们来自某条聊天。旧调用若未提供源消息标识，只保证同一请求编号的重放去重。
- UI 消息标识用于幂等，与会话、正文及引用绑定；只有数据库中存在对应原消息且内容匹配才保存可跳转消息 ID。消息尚未保存时仍能保留精确要求，但不会伪造来源链接。
- 实际响应只能证明上下文发往模型，实际成果关联只能证明该轮保存了该版本，均不证明模型完全理解或逐条落实。正文质量和要求满足度需另行核对。
- 沿用现有 SQLite 事务、原生与 DSH 执行器，避免引入另一套引擎和迁移。模型工具参数沿用现有“丢弃未定义字段、拒绝无效已定义字段”规则，测试验证真实行为，不扩大修改通用验证器。
- 本地协议夹具不等于在线供应商或长时间真实运行验收。未调用付费模型，未制作安装包、发布或执行全天稳定性验收；此前项目记录的长期运行缺口不因此关闭。
- 完整功能在一个本地提交集成，保留整体回滚粒度；没有逐个子任务拆散接口或迁移提交。
- 本地验收日志与托管 worktree 保留以便追溯，占用少量磁盘空间；不自动清除其他分支、用户数据或已有验收产物。
