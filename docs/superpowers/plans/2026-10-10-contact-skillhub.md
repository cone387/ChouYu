# 联系人 SkillHub 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在联系人内完成技能搜索、安装、独立启用与聊天/后台加载闭环。

**Architecture:** 官方固定版本 Python CLI 负责商店检索和下载；主进程技能库负责校验、持久化、关联及文本快照。现有聊天与后台运行器消费同一技能上下文，运行中使用持久快照。

**Tech Stack:** Electron、TypeScript、React、Vitest、Python 标准库。

**Spec:** [已确认设计](../specs/2026-10-10-contact-skillhub-design.md)。2026-10-10 用户确认推荐范围：说明、文本参考资料和现有工具；不执行技能脚本。

## Global Constraints

- 任务表单保持单描述；技能独立于人设、公共交流规则和权限。
- 官方 CLI 固定 2026.8.5，应用专属目录与配置，显式 --dir。
- 不静默截断技能要求；无法加载明确错误；脚本和外部运行依赖明确标注。
- 运行轮次技能快照稳定，停用下轮生效；保存失败不误报成功。
- 复用界面样式，表单聚焦无彩色边框，弹窗支持 Esc。

## Review Focus

- 同名/命名空间技能、重复安装：按来源稳定 ID 隔离，并发互斥。
- 坏归档、越界路径和链接：发布前验证，旧库保持可用。
- 写入失败和过期设置：拒绝覆盖、保留原配置。
- 联系人切换和删除：拒绝迟到响应串用，清理关联。
- 恢复旧轮次、配置变化：消费已保存快照，包含实际输入额度计量。

### Task 1: 技能内容与联系人库

Files: `src/shared/skills.ts`、`src/main/skills/library.ts`、对应测试。
Interfaces: `SkillLibrary` 提供 list/detail/configure/remove/uninstall/snapshot；`SkillSnapshot` 为版本、条目和可直接消费的 instruction。

- [x] 先写内容解析、目录边界、依赖、文本预算、两联系人隔离、旧版本拒绝与重启测试，运行确认失败。
- [x] 实现纯文本技能校验及原子持久化，安装只发布完整目录。
- [x] 运行 `npm test -- src/main/skills` 验证通过。

### Task 2: 官方商店与主进程 API

Files: `src/main/skills/skillhub.ts`、`src/main/skills/index.ts`、`src/preload/index.ts`、`src/renderer/src/shared/types.ts`、对应测试。
Interfaces: `SkillAPI` 提供 status/setup/search/install/list/detail/configure/uninstall；应用根目录为 userData/contact-skills。

- [x] 先写搜索 JSON 映射、引用校验、安装失败回滚和取消测试。
- [x] 实现固定包摘要校验、Python 检测、CLI 启动、超时/取消与严格 IPC 参数验证。
- [x] 使用应用隔离配置完成真实 CLI 安装、版本与搜索验证；真实下载只作为未启用技能样本。

### Task 3: 运行时统一加载

Files: `src/main/ipc.ts`、`src/main/agents/service.ts`、`src/main/agents/index.ts`、`src/main/assistant-routines/index.ts`、`companion-summary.ts`、对应测试。
Interfaces: `getContactSkills(id): SkillSnapshot`，后台 `AgentIdentity.skills` 可选，模型输入前保存 run.input.skills。

- [x] 先写技能隔离、运行快照、恢复与用量计量测试，确认失败。
- [x] 接入聊天、联系人后台模型、ChouYu 晨报/工作检查；技能不拼入 soul，不改人设签名。
- [x] 测试当前轮次不混用新配置、旧轮次无技能时兼容以及失败如实反馈。

### Task 4: 联系人技能界面

Files: `ContactSkills.tsx`、`ContactSkills.css`、`ContactAgentPanel.tsx`。
Interfaces: 消费统一 SkillAPI，配置使用预期 revision，异步切换使用组件生命周期隔离。

- [x] 共用“技能”导航、已安装/已配置列表、搜索与安装详情弹窗。
- [x] 支持安装与启用分离、停用、移除关联、卸载引用保护、错误保留及取消。
- [x] 验证实际界面在深浅色、窄宽窗口、Esc 和失败情况下可操作。

### Task 5: 验收与文档

- [x] 更新产品规范、使用说明、架构与验收记录。
- [x] 运行 `npm test`、`npm run typecheck`、`npm run build` 与相关 Electron 冒烟。
- [x] 独立审查最终改动，修复重要问题；记录真实网络、模拟模型及未覆盖边界。

## 执行记录

Ruling: 用户已确认接入方案及执行范围，按上层授权规则直接在本会话实施，不再次请求授权。当前工作区仅有本任务草案，创建 `feat/contact-skillhub` 分支保留用户工作目录及已有依赖，不额外创建工作树。变更保持可审阅，不自动推送。
