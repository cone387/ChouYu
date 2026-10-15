# 联系人真实模型场景回归实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 用真实供应商、真实IPC/工具/持久层和最终回答验证联系人对话，失败修复后完整回归。

**Architecture:** 保留确定性单元测试；新增隔离Electron真实模型场景矩阵，共用生产聊天入口、角色/记忆上下文、卡片和数据库。现有真实模型专项套件继续验证详细路由、成果与输出；分层记录，不能用模型夹具或单次路由替代最终用户结果。

**Tech Stack:** TypeScript、Electron、Vitest、SQLite、当前配置供应商。

**Spec:** `docs/contact-task-spec.md` 第4、7、10、11节及 `docs/contact-conversation-acceptance-20261014.md`。

## Global Constraints

- 使用现有隔离工作树；不改用户真实联系人、任务、消息或凭据。
- 用户已明确授权实际调用模型并执行测试；本计划直接执行，不再请求计划审批。
- 交互卡片沿实际权限与版本保存；无快速新建或批量任务功能。
- 合成测试数据；密钥只在进程内传递，不写测试日志。
- 失败保留输入、输出、操作及状态证据，不用放宽断言掩盖失败。

## Review Focus

- 路由正确但最终回复追问或擅自修改后台任务：任务1实际IPC与正文断言。
- 多轮补充、纠正和含糊指代：任务1连续历史与卡片保存验证。
- 同名/多任务串改、原暂停状态被恢复：任务1数据库前后对比。
- 对话同意/拒绝只是口头回复：任务1持久事项及真实设置检查。
- 编辑重发/关闭导致丢回复：任务1真实UI与消息落盘，任务3重跑原生命周期回归。

### Task 1: 可重复的真实模型应用场景矩阵

**Files:** 新增 `src/main/smoke/contact-live-smoke.ts`；修改 `src/main/index.ts`、`scripts/smoke-electron.js`、`scripts/test-contact-model.cjs`；测试产物 `artifacts/contact-live-matrix/`。

- [x] 新增显式 `--matrix` 入口，沿现有安全解密方式传配置到隔离Electron，限定超时并逐案例记录。
- [x] 实际IPC覆盖问候、单次写作多种措辞、idea、评审、讨论/引用不修改、聊天稿修订、多任务追问与补充、暂停/继续对象校验、任务预算、联系人设置/资料、组合卡片、自然语言同意与拒绝、单次与长期输出偏好、安全凭据入口。
- [x] 使用真实UI覆盖编辑重发和首字前关闭后完整保存；每项检查实际回复、待处理卡片以及相关状态，没有写权限的场景必须无持久修改。
- [x] `npm run build` 后运行 `node scripts/test-contact-model.cjs --matrix`；记录原始失败，不自动重试为通过。

### Task 2: 修复被真实对话暴露的缺陷

**Files:** 按失败定位，主要 `src/main/agents/chat-changes.ts`、`src/shared/contact-work-instructions.ts` 及对应单元测试；现有 `chat-change-model.acceptance.test.ts`、`conversation-model.acceptance.test.ts`。

- [x] 分清测试夹具错误和生产行为错误，先加入能复现缺陷的确定性或真实模型测试，再最小修复。
- [x] 修正旧真实模型夹具与现有实际返回协议的不兼容，不缩小需求或把合法错误当成功。
- [x] 运行真实模型专项 `--chat-changes`、`--conversation`、默认正式成果/样式、`--experience`、`--briefing`，加上矩阵完整复跑；自然语言输出人工阅读。

### Task 3: 回归、审查、交付

- [x] `npm test -- --maxWorkers=2`、`npm run typecheck`、构建；`--chat-close`、`--chat-edit`、`--contact-conversation`隔离UI回归。
- [x] 独立整分支审查，处理重要问题。
- [x] 同步规范实现缺口及实际覆盖矩阵，记录失败、修复、最终次数和未覆盖边界。
- [x] 合入本地主项目并构建实际运行产物；核对源码/构建与运行版本，不能宣称已重启旧进程。

## 执行记录

- 基点 `d642ccd`；复用干净隔离工作树 `C:/Users/Administrator/.codex/worktrees/a860/ChouYu`。
- 决策：本轮核心是补齐真实模型最终回答与真实应用持久操作，而非再写一套仅解析JSON的模拟验收。
- 完成：22项实际应用矩阵、43项真实模型专项；最终输出路由增量额外2项实际IPC定向复测。全量1773通过/50条件跳过，类型/构建/独立复审通过。失败轮次和质量边界见对话验收记录。
- 主实现`c574fbf`已快进合入`D:/codespace/ChouYu`并成功构建；旧9:21进程未重启，24小时浸泡进程未操作。保留工作树及失败证据供追溯，不推送或发布。
