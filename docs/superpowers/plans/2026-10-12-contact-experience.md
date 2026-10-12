# 联系人完整体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完整实现用户认可的七个联系人能力/体验模块，并逐项验证 EXP-01～15。
**Architecture:** 在原联系人数据库、worker/service、任务执行与消息链路上增量扩展；正式成果保持不可变版本。阅读、消息、资料和协作共用有归属的版本引用，任务 UI 与执行引擎不分叉。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5；Node 项目要求 >=24.0.0 <25。
**Spec:** [已确认完整设计](../specs/2026-10-12-contact-experience-design.md)，唯一产品规范为 [contact-task-spec.md](../../contact-task-spec.md)。
**Status:** 用户以「en」确认设计；此总计划及七份子计划已完成，待审阅与执行方式选择。仅已有规范修复 ea98736 已实现，不能将本计划打勾为已完成。

## Global Constraints

- 任务新建、编辑复用公共单自然语言描述弹窗；资料/记忆属性不搬进任务表单。
- 各联系人身份、记忆、权限、额度独立；ChouYu 只读检查别人工作，不代答或代改。
- 所有主动消息保留未读闪烁，已读不等于已处理；聊天直接引用已保存正文，不额外调模型改写。
- 禁止快速新建、多选/批量任务操作、今天页过期提示和筛选条件标签。
- 表单聚焦保留默认边框，无彩色 outline/ring/阴影；Esc 沿用公共清焦规则，鼠标取消恢复入口焦点。
- 成果每页 30 项，查询快照内稳定分页；收藏指向任务最新成果，历史引用指向精确版本。
- 记忆有效记录最多 100 条，每条 2000 字，历史版本不占有效条数。
- 资料每次导入一份，文本上限 2 MB、每位联系人 100 份有效资料、含历史正文 200 MB；单次读取 12000 字并返回下一段游标。
- 复用技能现有 8 MB/128 文件总导出和单文件 200 KB 限制，不擅自放宽权限或容器隔离。
- 旧数据库增量升级，未知未来版本拒绝写入；不伪造历史阅读、记忆来源或文件任务归属。
- 新请求校验 owner、版本、范围；写操作失败保留输入，重复提交幂等；取消/撤权后的迟到结果不提交。
- 测试用隔离数据库、合成资料；不得为了验收修改用户真实任务、权限或聊天。局部通过不代替完整完成。

## Review Focus

1. 重复文字、Markdown 格式与 emoji UTF-16 偏移造成引文定位错误：B2/C1 验证重复段落必须携带偏移，不能只做 includes 匹配。
2. 读到旧版后并发写入新版：B1/B2/C2/F2 验证搜索快照稳定、阅读不跳转、修订过期拒绝和旧评审仍可读。
3. 切换联系人、关闭窗口或 worker 重启时仍有请求返回：A2/D2/E2 验证草稿/回调不串人、末次阅读落盘与新轮次权限重查。
4. 资料/记忆被撤回但已进入模型检查点：D2/E2 验证提交前引用有效性重查、受影响轮次取消、不恢复已暂停工作。
5. 重复交接、文件写入与数据库提交部分失败：F1/G1 验证幂等键、事务回滚、孤立暂存清理及旧文件版本不变。

## 文件职责与共享契约

- 新领域类型放 `src/shared/contact-content.ts`、`contact-memories.ts`、`contact-materials.ts`、`contact-handoffs.ts`、`contact-files.ts`，分别由对应子计划定义；不把所有实现继续堆入 `agents.ts`。
- 各领域 API 接口由 `AgentAPI` 扩展；新增方法同时接入 `src/preload/index.ts`、`src/main/agents/index.ts` 白名单与 `service.ts`，worker 保留串行写入。
- 领域存储类分别持有同一个 `Database.Database`；关键写入与原成果/任务提交共用事务。
- 按既定顺序分配数据库版本：B1 从现有 8 升至 9，D1 至 10，E1 至 11，F1 至 12，G1 至 13；每次同步更新 store 的未来版本拒绝上限和迁移测试。已应用的迁移不再重复，UI 模块不提高版本。聊天消息新增可选字段沿用其独立存储格式，不混用 agent schema 号。
- 技能文件最大值、资料/记忆上限和新型权限沿用批准设计；实施计划新增的引文条数/长度、检索预算和返回栈容量是待本计划审阅的工程边界，失败明确，不作为缩减核心功能的方式。
- B1 定义以下公共类型（实现时保持名称一致）：

```ts
type ContactScope = { kind: 'contact' } | { kind: 'task'; topicId: string } | { kind: 'session'; sessionId: string }
type DeliveryRef = { characterId: string; topicId: string; version: number; sectionId?: string }
type TextAnchor = { start: number; end: number; quote: string; textHash: string }
type ContentCitation = { ref: DeliveryRef; anchor?: TextAnchor }
type ContactReadContext = { characterId: string; topicId?: string; sessionId?: string; query: string }
type ContactSourceRef =
  | { kind: 'conversation'; sessionId: string; messageId: string }
  | { kind: 'delivery'; ref: DeliveryRef }
  | { kind: 'research'; runId: string }
  | { kind: 'user'; at: number }
```

- B1 的 `AgentPortfolio.resolve(owner, ref)` 验证归属后返回正式 `AgentDelivery` 与可选 `DeliverySection`；跨联系人只通过 F 的权限检查后读，不能把此方法暴露为任意读取工具。
- 结构化引用/参考记录进入实际消息持久层及备份/迁移校验；不只保存在 React 状态。缺失旧字段兼容为空。
- 每个 API 对象的字段、数值、长度及枚举均在 shared validator 和服务端校验，UI 校验不作为保护边界。

## 依赖与执行顺序

| 顺序 | 子计划 | 可独立验收的交付 | 验收 |
| --- | --- | --- | --- |
| 1 | [B 成果与续读](2026-10-12-contact-portfolio.md) | B1 成果查询/个人状态；B2 共用阅读器与作品集 | EXP-03/04 |
| 2 | [C 正文引用](2026-10-12-contact-citations.md) | C1 可校验引用；C2 聊天讨论与版本修订 | EXP-05 |
| 3 | [D 独立记忆](2026-10-12-contact-memory.md) | D1 版本/范围；D2 检索/聊天/参考来源 | EXP-06/07 |
| 4 | [E 资料空间](2026-10-12-contact-materials.md) | E1 版本存储；E2 导入/模型读取/来源 | EXP-08/09 |
| 5 | [F 协作交接](2026-10-12-contact-handoffs.md) | F1 幂等交接；F2 评审及意见交回 | EXP-10/11 |
| 6 | [G 技能与文件](2026-10-12-contact-capabilities.md) | G1 文件归档；G2 能力/失败往返 | EXP-12/13 |
| 7 | [A 信息层级](2026-10-12-contact-overview.md) | A1 真实首页投影；A2 导航与往返 | EXP-01/02 |
| 8 | 本文最终验收 | 跨模块整合、文档、完整审计 | EXP-14/15 及全部 |

这是一套计划的模块拆分，不要求每完成一份子计划再找用户批准既定设计。执行中仅遇到改变已确认产品规则的选择才提问。

## 每个任务的公共交付步骤

每份子计划中的 task 都须逐项完成：
1. 写该任务列出的行为测试，先在旧代码运行，确认失败来自缺失能力。
2. 实现标明的接口和接入路径，不用测试专用生产分支绕过真实存储、权限或调度。
3. 运行该任务的专项测试和类型检查；UI 变化还需 Electron 交互、深浅色及 375/1024 宽截图人工检查。
4. 通过后进行一次代码复核，修复重要发现；按选择的执行方式决定逐任务独立复核还是最终独立复核。
5. 只提交本任务文件及验收文档，提交说明写行为与验证范围。失败或未覆盖项不标通过。

## Task FINAL：完整验收与交付

**Files:** 更新 `docs/contact-task-spec.md`、`docs/contact-experience-acceptance-20261012.md`、`docs/contact-topics.md`、`docs/contact-custom-deliveries.md`、`docs/contact-skills-20261010.md`；新增 `src/main/smoke/contact-experience-smoke.ts`，接入 `src/main/index.ts` 与 `scripts/smoke-electron.js` 的 `--contact-experience` 开关；扩展 `scripts/test-contact-model.cjs` 的 `--experience` 与 `src/main/agents/experience-model.acceptance.test.ts`。
- [ ] 实现跨模块场景：导入资料 → 保存有范围记忆 → 联系人产出正文和文件 → 重启续读 → 引文讨论 → 交给另一人评审 → 新版冲突 → 用户选择意见交回 → 修订后从回执定位。每步断言真实数据库版本、请求来源和 UI，失败注入不改用户数据。
- [ ] 执行 `npm run typecheck`、`npm test`、`npm run build`；全部通过才进入最终烟测。
- [ ] 执行 `node scripts/smoke-electron.js --agents`、`--assistant-routines`、`--presentation`、`--contacts`、`--contact-experience`；各命令退出 0 且有对应通过标记，保存日志与截图。
- [ ] 设置 `CHOUYU_TEST_DOCKER=1` 后执行 `npx vitest run src/main/skills/docker.integration.test.ts`；执行 `node scripts/test-contact-model.cjs --experience`，验证实际模型的记忆纠正、资料/引文引用与版本评审。明确测试账户/合成数据和实际消耗，不记录凭据；真实环境失败不能用夹具结果替代。
- [ ] 逐项检查设计 A1–G7、迁移/失败规则与 EXP-01～15；在阶段验收表给出代码、测试/截图证据和边界。缺失任何功能或证据继续推进，不缩减目标。
- [ ] 最终独立代码复核、按执行技能完成开发分支整合；确认工作树、文档与最终代码一致后才能标记目标完成。

## 自检与交接

已逐条映射设计七模块；五项 Review Focus 均指向拥有测试的任务。现有 ea98736 修复作为基线保留，不重复实现。所有新增功能的实施复选框保持未勾选。

建议 Native：由当前会话顺序实施，最后独立复核。模块共用版本、来源、数据库与 IPC，顺序推进能减少跨任务接口返工。另一选项是 Subagent-driven，每个任务由新的实施者和审查者完成，独立检查更频繁，消耗更多上下文。等待用户审阅本总计划（包含所链接七份子计划）并选择方式。
