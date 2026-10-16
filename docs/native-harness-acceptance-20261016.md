# 内置 Harness 模块化验收

日期：2026-10-16。分支：`feat/native-harness`；基线：`2956e82`。状态：NH-01～NH-10 本轮验收完成；实现及审查修复提交至 `6622e0c`，已按用户指令在本地快进合入 `master`（`35fbb0b`），未推送。

## 范围

按[已确认设计](superpowers/specs/2026-10-16-native-harness-design.md)直接迁移原生入口，统一内置 `native` / `dsh` 模块，不增加旧 API 别名、旧引擎兼容层或插件商店。入口继续是“联系人 → 详情 → 编辑 → 聊天执行引擎”。后台任务、日记和主动消息使用新原生基础，保留自身调度，不随普通聊天选择切换到 DSH。

## 验收映射

| 要求 | 证据与结果 |
| --- | --- |
| NH-01 唯一原生执行基础 | [native/runner.ts](../src/main/harness/native/runner.ts) 只有一份循环；`native/providers` 分别处理协议。`ai.ts` 仅模型列表与诊断。源码与脚本搜索旧函数、包装导入和旧引擎分支无残留；历史设计文档保留原事实。 |
| NH-02 协议与预算 | [native/runner.test.ts](../src/main/harness/native/runner.test.ts) / [provider.test.ts](../src/main/harness/native/provider.test.ts) 覆盖两协议图片、文本、多轮工具、用量、输出上限、60 秒无数据超时、协议结束、6 轮上限及第二轮预算拒绝不请求/不重复释放。 |
| NH-03 公共模块接口 | [registry.test.ts](../src/main/harness/registry.test.ts)、[service.test.ts](../src/main/harness/service.test.ts)、[dsh/module.test.ts](../src/main/harness/dsh/module.test.ts) 验证静态模块组合与生命周期分发；IPC 不导入 DSH 实现、不包含引擎名执行分支。 |
| NH-04 能力与权限 | 注册器同时过滤定义并拦截实际越权调用；取消/上下文失效前置检查。平台、图片、system 历史拒绝发生在获取 DSH runtime 前；原生注册与执行不初始化 DSH。 |
| NH-05 事件与取消 | [contract.test.ts](../src/main/harness/contract.test.ts) / [coordinator.test.ts](../src/main/harness/coordinator.test.ts) 覆盖双模块递增序号、唯一终态、取消后的迟到输出、无自动回退、清理异常保留原错误且释放请求；绑定工具使用协调器合成的取消信号。 |
| NH-06 确认语义 | [tools.test.ts](../src/main/harness/tools.test.ts)、[dsh/module.test.ts](../src/main/harness/dsh/module.test.ts)、既有 receipt acceptance 验证原卡片、日志前置与实际回执；`pendingInteraction` 区分卡片已返回和业务已处理。最终 DSH UI 全部通过，等待 66.9 秒期间无再推理；拒绝、重复点击、停止后旧卡片不可写入。 |
| NH-07 联系人设置与实际聊天 | [database.test.ts](../src/main/database.test.ts) 验证独立设置、重启、过期版本与磁盘失败不覆盖；[characters.test.ts](../src/shared/characters.test.ts) 验证默认值/非法显式编辑。实际 Electron 已验证两个联系人独立选择、在途冻结、无重启切回原生、原生保存不带 DSH 来源且不创建 DSH 记录、两种流 ID/序号及正文无重复。 |
| NH-08 后台调用迁移 | [agents/service-tool-boundary.test.ts](../src/main/agents/service-tool-boundary.test.ts)、日记及主动消息现有单元/集成测试已随全套通过；原逐轮预算、总时限、成果与来源链路继续生效。实际 agents、assistant-routines 和 companion 均退出 0，验证真实工具/成果、定时投递及持久去重。 |
| NH-09 持久化生命周期 | 既有 store/recovery/action-results/runtime 测试及新 [dsh/service.test.ts](../src/main/harness/dsh/service.test.ts) 验证恢复、清理、实际完成消息来源匹配和成功 flush 后确认；失败保留恢复记录/待清理状态，公共关闭尝试所有模块。 |
| NH-10 整体验证与审查 | 最终类型检查、全量 1892 项通过/53 项跳过及构建通过；独立审查三项 Important 已按红绿测试修复。四项最终 Electron smoke 均退出 0；架构、产品第 10 节及本文同步完成。 |

测试目录均相对 `src/main/harness/`，另有 `src/main/database.test.ts`、`src/shared/characters.test.ts` 及各业务模块测试。测试依赖本地确定性协议夹具，实际 Electron 使用隔离用户数据和固定 DSH SDK，不代表真实供应商效果。

## 实际验证记录

- `npm run typecheck`：通过。
- `npm test`：最终 222 文件、1892 项通过，15 文件/53 项跳过，退出 0，54.86 秒。任务 1/2/3 分别为 1848/1862/1881 通过，均 53 跳过。
- `npm run build`：通过；保留现有 bundle 大小提示。
- `node scripts/smoke-electron.js --dsh-harness`：最终退出 0，70.6 秒；共同事件、原生不初始化 DSH、路由不进入 Harness、独立设置、在途引擎固定、原卡/拒绝/重复/停止、真实资料、隐藏未读及切回原生全部通过。
- `node scripts/smoke-electron.js --agents`：最终退出 0；工具进程/重启、反馈修订、研究资料、实际成果、独立记忆、任务入口、原确认卡与设置冲突/输入保留通过。
- `node scripts/smoke-electron.js --assistant-routines`：最终退出 0，65.9 秒；共用任务 UI、单描述、澄清上下文、保存/暂停/设置/删除、实际定时投递、持久历史及跨联系人来源导航通过。
- `node scripts/smoke-electron.js --companion`：最终退出 0，4.8 秒；真实 IPC/SQLite、联系人状态检查、模型总结、任务链接、不切换会话、持久去重及工具禁用通过。
- 截图与机器报告保存于工作树 `artifacts/native-harness/`；最终运行日志归档至该目录的 `logs/`，本记录提供结果摘要。

## 实施裁定与风险

1. 改造前全量测试出现 DSH 打包 matcher、SDK 启动和延迟确认通道的瞬时失败；原样顺序重跑三文件得到 8 通过、1 跳过。未改超时或删断言，继续实施并执行后续全套。根因未证实，SDK 启动时序问题仍需关注。
2. 公共工具事件增加可选 `pendingInteraction`，表示发卡工具已返回但业务仍待处理。消费者呈现操作结果时必须保留此区别。
3. 工具绑定延后到协调器组合取消信号之后，增加一个宿主工厂回调；否则仅通过协调器取消时无法终止确认/技能等待。已观察 2 项回归先失败后通过。
4. 两模块交付前均验证有效模型/工具配置。原生运行中修改人设、模型或工具配置会拒绝旧设置结果；引擎选择本身不影响已开始请求。
5. 审查未执行真实供应商、强杀、断网及安装向导：维持既有发布门槛，不能据此声明这些环境可靠。
6. 审查不预判仍在运行的测试：由实现者检查最终退出码、报告及截图；不以“修复后可合入”的评语代替实测。最终验证已完成。

已查看最终 `dsh-harness/contact-engine-settings.png`：原编辑弹窗含执行引擎选择及 DSH 范围说明，聚焦无彩色描边。`dsh-harness/dsh-chat.png` 展示切回原生后的最终聊天；该本地模型夹具的固定回复仍名为“DSH 普通对话验收通过”，引擎归属由保存来源和运行记录断言验证。

新加 UI 事件监听第一次返回 unsubscribe 函数，Electron 序列化失败；修正测试驱动返回 undefined，没有更改产品行为或放宽断言。一次实际 DSH 启动出现 ready 控制超时，原样重跑 82 秒通过全部断言；未将其归因为已证实的系统负载。设置截图曾捕获前一合成帧，增加 300ms 绘制等待后重新验收。

## 独立审查

审查范围 `2956e82..30d1bf8`。一位独立审查者只读检查整条分支，发现 3 项 Important、0 Critical、0 Minor；保留“修复后可合入”的审查结论。实现者逐项复现并修复，不以再次评审替代测试：

- 最终异步上下文校验后重新检查组合取消信号及实时工具权限，防止协调器单独取消/关闭或权限撤销后仍执行。双引擎协调器与撤权 3 项先失败，修复后通过。
- DSH 执行结束分别尝试取消卡片、释放租约和日志清理；原始执行错误保留，附加清理错误，恢复抑制及待清理状态持久保存。真实适配器配合 SQLite 的 2 项先因 dispose timeout 失败，修复后通过。
- 两协议识别流内 error，缺少 `[DONE]` / `message_stop` 时报告中断，不完成或执行部分工具结果。4 项先失败，修复后通过；完整结束标记无末尾换行仍通过。

修复后相关 7 文件共 66 项通过，最终全套 1892 项通过。审查未判定的真实供应商、强杀/断网/安装环境继续作为发布门槛；四项最终 UI 与全套由实现者独立运行并验收，不用审查意见代替运行证据。

## 未覆盖的既有发布门槛

[DSH 原验收](dsh-harness-acceptance-20261015.md)中的真实供应商资源不足、完整跨数据库强杀矩阵、严格断网/防火墙和 NSIS 安装向导仍未完成。未使用付费模型替换、未声称 `--dsh-harness-live` 通过，也未重复构建未改动的 runtime/安装包。DSH 保持 Windows、文本与现有三项工具范围。

## 主分支合入复核

2026-10-16 用户明确要求合入。主工作区 `D:/codespace/ChouYu` 在干净的 `master` 上从 `2956e82` 快进至 `35fbb0b`，无冲突、无远程推送。

合入后在主目录重新运行 `npm test`：222 文件、1892 项通过，15 文件/53 项跳过，退出 0，56.44 秒。主目录 `npm run typecheck` 和 `npm run build` 也均退出 0；构建仅保留现有包体积提示。日志保留于 `artifacts/native-harness-merge/`；原工作树中的截图及历史日志继续保留。
