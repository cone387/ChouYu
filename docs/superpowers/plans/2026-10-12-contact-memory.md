# 联系人独立记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 提供记忆纠正、历史、范围和真实模型参考记录，保留独立身份与共同经历。
**Architecture:** 把 store 的直接记忆增删抽到领域存储；聊天和任务共用范围检索并在提交前检查撤回。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task D1：记忆版本、范围和纠正

**Files:** 新增 `src/shared/contact-memories.ts`、`src/main/agents/memories.ts`、`memories.test.ts`；修改 `store.ts`、`agents.ts`、API 接入；扩展 `ContactMemoryDialog.tsx`，抽出 `ContactMemories.tsx`。
**Interfaces:** MemoryKind='preference'|'project'|'experience'|'research'；ContactMemory 含 id/owner/revision/content/kind/scope/source/createdAt/updatedAt/status('active'|'candidate'|'forgotten')；MemoryInput 含 content/kind/scope/source。AgentMemories(db) 提供 `create(owner:string,input:MemoryInput):ContactMemory`、`update(owner:string,id:string,revision:number,input:MemoryInput):ContactMemory`、`list(owner:string):ContactMemory[]`、`history(owner:string,id:string):ContactMemory[]`、`forget(owner:string,id:string,revision:number):void`、`select(context:ContactReadContext):{items:ContactMemory[];truncated:boolean}`。
- [x] 真实 SQLite 测试：update 同一 id 的 revision 1→2，旧 revision 拒绝；研究候选不覆盖用户纠正；100 条有效记忆上限，101 条拒绝、历史不计数；任务/会话交叉检索为空；忘记后历史正文也不继续暴露；旧记录保留原来源不猜范围。运行 `npx vitest run src/main/agents/memories.test.ts` 确认红。
- [x] 实现增量迁移（原 memories 可保持兼容投影），幂等新建与原位更新；检索先范围过滤，再按查询词命中/明确纠正/更新时间稳定排序，总提供最多 12 条和 16000 字，截断返回 truncated；没有相关信息时不靠另一联系人补齐。
- [x] 原 remember/forget API 兼容调用新模块；新增 memoryList/updateMemory/memoryHistory/createMemory/forgetMemory，分别绑定领域 list/update/history/create/forget（list 按 owner 返回可见 active/candidate，select 用于模型检索）。研究输出写候选，用户明确记忆写 active；记忆 UI 新建/编辑/历史均显示来源及范围，不增加任务字段。任务/会话 scope 服务端验证真实归属。
- [x] 跑专项、现有 service 测试、类型检查和记忆 Electron 新增/改正/忘记/重启/写失败场景，通过后提交 `feat(contacts): version and scope independent memories`。

## Task D2：统一检索、聊天纠正与参考记录

**Files:** 新增 `src/main/agents/context.ts`、`context.test.ts`、`memory-tools.ts`、`memory-tools.test.ts`；修改 `src/main/{ipc,database}.ts`、`agents/{index,service,store,runtime}.ts`、`assistant-routines/companion.ts`、`src/renderer/src/components/ChatPanel/MessageArea.tsx`、`src/shared/contact-communication.ts`。
**Interfaces:** `buildContactContext(store:AgentStore, context:ContactReadContext):{text:string; memories:{id:string;revision:number}[];truncated:boolean}`；`assertContextCurrent(owner:string, refs:ContextReferences):void`。ContextReferences 在 contact-content.ts 定义 memories 数组及可选 materials（E 提供）；actual request/消息/轮次保存此快照。工具名称 list_contact_memories、update_contact_memory、remember_contact_memory、forget_contact_memory。
- [x] 捕获实际聊天和后台模型请求：任务 A 不见任务 B/会话 C 记忆；ChouYu 检查别人不见其记忆；改变旧记忆后原检查点提交拒绝；参数含糊不写；跨人 ID 拒绝；关闭 UI 的迟到回调不展示到另一人；工具策略确认次数与原配置一致。运行 context/memory-tools 测试确认红。
- [x] 移除聊天最近 12 条硬截取，统一传 context（会话 ID/明确任务/当前用户文本），后台构造相同范围快照；普通聊天自动聚焦任务不等于用户指定任务。请求发出后才记录实际提供项，失败标实际失败，不显示为模型必然使用。
- [x] 记忆纠正走工具读真实 id/revision 后更新；必要才追问。共同经历允许从真实消息/成果创建有 source 的候选，未经事实核对不写 active；用户明确记住直接按权限策略保存。更新/忘记取消引用受影响版本的轮次，保留暂停及原调度，不取消无关任务。
- [x] MessageArea 展示「本次参考记忆」，打开当时版本；被忘记只显示移除提示。运行真实 IPC 烟测与最终 --experience 模型样本；通过专项/类型检查后提交 `feat(contacts): share scoped memory context and corrections`。
