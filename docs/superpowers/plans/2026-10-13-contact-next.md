# 联系人完整优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox tracking.

**Goal:** 落实用户确认的全部五项优化与联系人卡片直达，取得分别对应的实现与运行验收证据。

**Architecture:** 保持公共任务 UI 与独立联系人引擎；复用工具权限/确认/版本保护。新增分批核对检查点、公共日历规则和可见性控制的数据读取，不重写现有引擎。

**Tech Stack:** TypeScript、Electron、React、SQLite、Vitest、现有真实 Electron 冒烟入口。

**Spec:** `docs/superpowers/specs/2026-10-13-contact-next-design.md`；权威约束 `docs/contact-task-spec.md`。

## Global Constraints

- 新建/设置/编辑仍只有任务描述；公共任务组件复用；无彩色表单聚焦装饰。
- 独立身份，成果使用已保存正文，不增加投递润色模型。
- 保留主动未读闪烁，不恢复快速新建、批量或已否定功能。
- 真实数据不被验收修改；未完成的真实长期验收不能用夹具替代。

## Review Focus

- 多任务歧义、无任务联系人的设置修改和在确认期间变化的目标：不串对象、不误报成功（任务2）。
- 正文仅末尾变更、单节超过容量、预算在中途耗尽、重启与旧回执：不漏读、不误结束、不重复消耗已核对批次（任务1）。
- 月末、闰年、跨时区/DST和错过多期：日历锚点稳定、最多补一次且不重入（任务3）。
- 隐藏页面仍挂载及迟到请求：停止轮询且保留草稿/阅读位置，返回立即补读取（任务4）。
- 摘要出现后来源被删除或有新版：准确版本、失效反馈、键盘与返回位置（任务5）。

### Task 1: 分批全文核对

Files: `src/main/agents/task-completion.ts`、新增 `completion-batches.ts` 与测试；`task-completion.test.ts`。
Interfaces: `reviewTaskCompletion` 保持签名；新增模块承接分片、缓存与严格回执校验，持久数据由 AgentStore 的 SQLite 持有。
- [x] 写真实 AgentStore 测试：七节合计超 60000 字仍全部核对；末节变化复用前节；单节分片；格式无效/预算不足/取消不结束；重开数据库续查。
- [x] 运行 `npm test -- src/main/agents/task-completion.test.ts`，确认新行为失败。
- [x] 实现分批快照及缓存，最终综合判定不再静默遗漏，调用仍计费。
- [x] 运行该模块及 runtime 相关测试、类型检查；记录证据并提交。

### Task 2: 聊天调整能力

Files: `src/main/agents/chat-changes.ts`、`tools.ts`、`service.ts`、`store.ts`、`topics.ts`、`src/shared/contact-task-edit.ts` 及对应测试。
Interfaces: 新工作设置补丁工具使用 `savePreferences` 的校验和 revision；结束/放弃/删除复用实际任务方法；Token 解除明确表示，不用缺字段隐式解除。
- [x] 测试无任务设置、字段白名单、跨联系人/过期拒绝、失败回滚、解除 Token 保留其他额度、结束保留成果、删除确认和取消。
- [x] 运行 chat-changes/tools/work-settings 专项确认失败。
- [x] 打通路由→工具准备/确认→事务→实际回执，同步协议及能力说明。
- [x] 测试及真实 Electron 聊天操作，记录保存前后状态并提交。

### Task 3: 共享日历与联系人定时

Files: `src/shared/assistant-routines.ts`、`src/main/assistant-routines/{gateway,service,index}.ts`、联系人 store/service、任务投影和对应测试。
Interfaces: 日历纯函数为两引擎共用；普通任务持有独立规则/版本/期次回执，到期经原队列开启一轮，公共任务投影展示下次时间。
- [ ] 测试每月31日/最后一天/闰年/间隔锚点/多时段/恢复补一次/重启去重；联系人到期排队、预算、暂停、问题等待和修改迟到保护。
- [ ] 运行相关测试确认缺失行为失败。
- [ ] 完成规则、存储迁移、自然语言新建/编辑与聊天定时、共同 UI 状态和历史。
- [ ] 运行定时、agents、toolbar Electron 场景及界面截图，更新使用说明并提交。

### Task 4: 可见性与查询性能

Files: `ContactAgentPanel.tsx`、`ContactPortfolio.tsx`、`ContactHome.tsx`、`useContactsDashboard.ts` 及共享查询模块；性能测量脚本。
Interfaces: 联系人+请求类型作为缓存键，共享订阅/刷新；active 显式传播到保留挂载的子页。
- [ ] 先记录固定数据与路径下 IPC、延迟、内存基线；增加隐藏页、请求合并、旧响应、返回补刷新测试。
- [ ] 确认测试失败后实现；不将取消订阅当作停止后台任务。
- [ ] 同样本复测，确认减少查询且不损害状态更新、草稿或续读；提交。

### Task 5: 卡片直达

Files: `src/shared/contact-home.ts`、`ContactsView.tsx`、CSS、导航及 Electron 场景。
Interfaces: 摘要保留字符串兼容，同时携带真实 interaction/topic/ref；复用现有 navigateContact。
- [ ] 测试点击准确问题、固定版本、无冒泡开聊天、删除提示及返回；先见失败。
- [ ] 实现独立可访问按钮，保留主卡聊天入口。
- [ ] 375/1024 深浅色与键盘鼠标实际交互截图，回归导航并提交。

### Task 6: 持续验证、文档与整合

Files: 新增隔离持续运行脚本与验收记录，`docs/contact-task-spec.md`、`docs/contact-topics.md`。
Interfaces: 复用真实执行/通知持久化；夹具、在线模型、实时时长分别标记，记录进行中进程句柄以便恢复观察。
- [ ] 实现并执行故障矩阵与完整三联系人链路；用当前实际结果驱动修复。
- [ ] 真实模型自然语言/长篇抽测；实际24小时跨夜；原生托盘与休眠恢复验收（无环境则明确保留未完成）。
- [ ] `npm test`、`npm run typecheck`、`npm run build`，运行 agents/assistant-routines/companion/contact-experience/toolbar/settings 相关场景。
- [ ] 一次独立完整代码审查；修复 Important/Critical，并做对应失败→通过及总回归。
- [ ] 逐项完成审计、同步规范、保留证据、将验证后的完整结果交付当前项目；不推送远端。
