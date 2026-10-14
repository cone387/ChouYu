# 联系人对话工作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整实现自然语言设置、聊天交互处理、按任务动态交付，并提供充分单元/集成测试证据。

**Architecture:** 扩展现有设置补丁、持久交互事项与固定版本成果展示。聊天、卡片、手动页面复用领域服务；执行引擎继续按原职责工作。

**Tech Stack:** TypeScript、Electron、React、SQLite、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-14-contact-conversation-design.md`；权威规范 `docs/contact-task-spec.md`。

## Global Constraints

- 任务新建/编辑仍为单描述公共弹窗，保留公共详情、独立身份、原执行引擎与所有主动未读闪烁。
- 修改必须有实际保存回执；未提及字段保留，过期版本拒绝，失败保留输入。设置写入不等于任务完成，也不默认恢复用户暂停任务。
- 不新增批量任务、多选或快速新建。组合修改仅针对当前明确对象的一次请求。
- 成果来自固定保存版本；展示不重写正文，不增加逐消息润色调用。

## Review Focus

- 未配置搜索密钥时同时修改搜索与其他设置，不能半保存（任务1）。
- 内置联系人模型/人设跟随全局配置，与普通联系人覆盖不同（任务2）。
- 旧消息卡片被另一入口解决或目标已删除，再点击不重复执行（任务3、4）。
- 用户说“这次”不能保存为长期偏好，多事项“选第二个”不能猜对象（任务4、5）。
- 无效展示描述/失效来源不能隐藏正文或执行业务动作（任务5）。

## Task 1: 全部工作设置的公共补丁

**Files:** `src/shared/contact-work-settings.ts`、`src/shared/contact-work-settings.test.ts`、`src/main/agents/chat-changes.ts`、`src/main/agents/tools.ts`、`src/main/agents/chat-controls.test.ts`、`src/main/agents/service.ts`。

**Interfaces:** 扩展 `ContactWorkSettingsPatch`；保留 `validateContactWorkSettingsPatch(raw)`、`applyContactWorkSettingsPatch(current, patch)`、`describeContactWorkSettingsPatch(patch)`，接入现有 `editWorkSettingsFromChat`。

- [ ] 写失败测试：通知、工具策略、网页范围、搜索、共享读写、工作规则可组合保存；非法/未知字段拒绝；未提及字段不变。
- [ ] 运行 `npx vitest run src/shared/contact-work-settings.test.ts src/main/agents/chat-controls.test.ts --maxWorkers=2`，确认新场景失败。
- [ ] 扩展公共schema与领域校验、模型路由、回执，遵守原权限撤销/中止语义。
- [ ] 用真实服务测试无任务、缺凭据回滚、版本变化、归属变化、磁盘失败、重开数据库；同命令全绿。
- [ ] 提交实现与证据，更新覆盖清单。

## Task 2: 联系人资料、模型与技能的对话入口

**Files:** 新建 `src/shared/contact-profile-settings.ts`、`src/main/agents/profile-tools.ts` 及相邻测试；修改 `src/main/agents/index.ts`、`src/main/ipc.ts`、`src/main/database.ts`（按实际模块拆分）、`src/main/skills/index.ts` 和公共资料修改服务。

**Interfaces:** `createContactProfileTools(access)` 提供读取实际配置、保存部分资料及技能配置工具；复用 `CharacterDraft`、联系人存储与技能库版本校验。模型路由新增 profile/skill 操作，不将资料修改送进任务编辑。

- [ ] 写并运行失败测试：名字/头像/分类/人设/模型部分更新保留其他字段，内置配置真实生效，陈旧版本及跨联系人拒绝。
- [ ] 接入带版本的公共修改服务、真实目录选择和技能启停/脚本权限；安全输入从卡片调用原控件，不将密钥传给模型。
- [ ] 测试技能库冲突、未知模型配置、安装不等于启用、权限收回、持久回执与保存失败。
- [ ] 运行相邻 `profile-tools`/`contact-profile-settings` 测试、既有 characters/skills 测试及类型检查，提交。

## Task 3: 公共交互事项与处理卡片

**Files:** `src/shared/contact-interactions.ts`、`src/main/agents/interactions.ts`、`src/main/agents/service.ts`、`src/main/agents/index.ts`、`src/renderer/src/components/ChatPanel/ContactInteractionCard.tsx`、`ContactPending.tsx`、`src/shared/agents.ts` 与各自测试。

**Interfaces:** `ContactInteraction` 增加判别式目标/动作与类型，兼容原 question/budget/retry；`ContactInteractionSubmission` 扩展明确动作参数，保持原API可用。新增事项无需伪造 topicId/runId。

- [ ] 先写真实SQLite失败测试：无任务设置事项、权限确认、方案选择、资料请求、成果反馈、删除确认。
- [ ] 实现动作注册、状态/版本/归属校验、幂等回执与持久事项；扩展原公共卡片按动作显示可用输入。
- [ ] 补齐权限/技能故障原卡片直接处理路径，工具确认复用事项并保留原确认策略及不超时行为。
- [ ] 测试拒绝、撤销、保存失败、重复点击、进程重开、其他入口完成、旧轮次迟到、失效版本、已读未处理；既有 interactions 测试必须全绿。
- [ ] 提交并更新具体接入场景清单。

## Task 4: 自然语言处理事项及完整操作链

**Files:** `src/main/agents/chat-changes.ts`、`src/main/agents/tools.ts`、新增 `src/main/agents/interaction-tools.ts` 与测试；`src/main/ipc.ts`、ChouYu事项引用适配。

**Interfaces:** 公共 `submitInteraction` 为按钮和聊天共用提交入口；解析返回实际 `interactionId/version/action`，只能从已读取且属于该联系人的事项选择。

- [ ] 写失败测试：原问题自由回复、选项+补充意见、单项明确引用、多项歧义、旧消息指令不授权、已处理回复不重复执行。
- [ ] 路由使用最新真实事项；已知按钮操作不额外调用模型审批；组合设置同事务，跨域步骤逐项持久回执。
- [ ] 在聊天贯通“修改权限→原卡片处理→原任务继续→实际交付”，ChouYu引用相同事项并保留独立归属。
- [ ] 路由单测/真实服务集成全绿后提交。

## Task 5: 动态成果呈现与偏好

**Files:** 新增 `src/shared/contact-output.ts`、`src/renderer/src/components/Contacts/ContactOutput.tsx` 与样式/测试；修改 `src/shared/agent-delivery.ts`、生成提示、`ContactDeliveryReader.tsx`、`ChatPanel/MessageArea.tsx`、偏好存储及工具。

**Interfaces:** 校验后的展示描述随固定成果版本保存；公共 `ContactOutput` 接收正式正文、来源、展示描述和已授权动作引用。聊天/阅读器使用同一描述和组件；旧版fallback Markdown。

- [ ] 写失败测试：写作/idea/评审/调研/计划/晨报及未知类型完整保留正文，链接绑定固定版本，长文不截断丢内容。
- [ ] 在原成果生成协议加入可选展示描述，确定性呈现，保持既有自定义sandbox与阅读位置。
- [ ] 持久保存单次/任务/联系人偏好，接入自然语言修改；成果反馈使用任务3事项绑定原版本。
- [ ] 测试样式修改不改正文/执行状态，临时偏好不泄漏，失败回退、主题/键盘和非法动作拒绝；全绿后提交。

## Task 6: 全覆盖验收与整合

**Files:** 新增 `src/main/smoke/contact-conversation-smoke.ts` 并接入现有smoke入口；`docs/contact-conversation-acceptance-20261014.md`、`docs/contact-task-spec.md`、相关使用文档。

- [ ] 建立 CONV/CARD/VIEW 每项实现、单测、集成、真实模型证据表；未证明项保持未完成。
- [ ] `npm test -- --maxWorkers=2`、`npm run typecheck`、`npm run build` 全部退出0。
- [ ] 隔离Electron交互与截图：375/1024、深浅色、Esc、鼠标边界、失败保留输入、卡片跨入口同步；agents/assistant-routines相关回归。
- [ ] 真实模型抽测区别于夹具；核对既有长期运行、托盘、休眠实际证据，缺口不勾通过。
- [ ] 按 executing-plans 技能进行独立全分支审查，修复发现并回归受影响项。
- [ ] 更新唯一规范的覆盖与缺口，核对全部需求后整合可交付变更；不发布或推送。

## 执行记录

- 2026-10-14：用户已明确授权全部迭代，按完整方案开始；主目录基点 `2b1ef0a` 干净，使用原生隔离工作区 `a860/ChouYu`，分支 `codex/contact-conversation-work`。
- 选择当前会话连续实施，最终独立审查。原有测试基线运行中。
- Pre-flight: 任务1补丁由任务3动作执行复用；任务2公共配置写入由任务3无任务事项引用；任务3提交协议供任务4使用；任务5成果动作引用任务3事项。旧API兼容，跨存储域不宣称原子事务。
