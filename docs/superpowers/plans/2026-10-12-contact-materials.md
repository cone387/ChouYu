# 联系人资料空间 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 支持文本、Markdown、附件与网页资料的持久版本、范围读取和可追溯引用。
**Architecture:** 资料版本由联系人数据库管理，导入不自动扩大权限；实际模型工具读取记录与来源关联。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task E1：资料版本与范围读取

**Files:** 新增 `src/shared/contact-materials.ts`、`src/main/agents/materials.ts`、`materials.test.ts`；修改 store/API 接入与 D 的 ContextReferences。
**Interfaces:** MaterialInput={name:string;scope:Exclude<ContactScope,{kind:'session'}>;content:string;source:{kind:'text'|'file'|'attachment'|'web';label:string;url?:string}}；MaterialRef={id:string;version:number}；MaterialVersion=MaterialInput & MaterialRef & {owner:string;hash:string;createdAt:number;status:'ready'|'withdrawn'}；MaterialSummary=Omit<MaterialVersion,'content'>。AgentMaterials(db) 提供 `save(owner:string,input:MaterialInput,id?:string,expectedVersion?:number):MaterialVersion`、`list(context:ContactReadContext):MaterialSummary[]`、`read(context:ContactReadContext,ref:MaterialRef,offset?:number):{text:string;nextOffset?:number;ref:MaterialRef}`（offset 默认 0）、`withdraw(owner:string,id:string,version:number):void`、`history(owner:string,id:string):MaterialSummary[]`。
- [x] SQLite 行为测试：同名不同内容不覆盖另一个 id；同 hash 更新不增版本；2 MB/100 份/200 MB 边界；12000 字分片及连续 offset 无遗漏；跨任务读取拒绝；撤回旧版本读取失败；失败更新原有效版本可读；版本冲突拒绝。运行 materials.test.ts 确认红。
- [x] 实现不可变正文版本和元数据事务、UTF-8 字节容量计数、整数游标范围校验；资料索引不复制为记忆。纯文本存 SQLite，无需把原路径作为身份；文件来源仅保留显示名。
- [x] 接入 API materialList/saveMaterial/readMaterial/materialHistory/withdrawMaterial，校验每个任务 scope；上下文有效性检查可核对撤回状态。迁移/重启测试与类型检查通过后提交 `feat(contacts): store versioned reference materials`。

## Task E2：导入 UI、读取工具和来源

**Files:** 新增 `ContactMaterials.tsx`、`ContactMaterialDialog.tsx`（Contacts 目录）、`src/main/agents/material-tools.ts`、`material-tools.test.ts`、`src/main/smoke/contact-material-smoke.ts`；修改 `ContactAgentPanel.tsx`、聊天附件 UI、`src/main/{ipc,database}.ts`、`agents/{context,service,runtime,sources}.ts`、`src/shared/agent-delivery.ts`。
**Interfaces:** `importMaterial(owner,request:{name:string;scope:MaterialInput['scope'];source:MaterialInput['source'];content?:string;id?:string;expectedVersion?:number}):Promise<MaterialVersion>`；工具 list_contact_materials、read_contact_material；实际读取存 {id,version,start,end}。本地选择只接受 .txt/.md/.markdown 的有效 UTF-8，无 NUL；网页经过原 reader 与当前访问权限。
- [ ] 工具测试：目录不伪称读正文；读取结果实际回给下一次模型；网页失败保留旧版；新 URL 不扩权；PDF/二进制拒绝；取消解析不提交；读取后撤回使原轮次提交失效；更新允许该轮保留旧版快照。运行专项确认红。
- [ ] 模态添加/更新，默认范围按显式 task 上下文，否则 contact；文本附件菜单「保存为资料」保留真实附件来源，普通发送不自动入库。导入每次一份，读取失败/超限/取消可见，迟到结果和切联系人不混用。
- [ ] 聊天和后台提供目录/读取工具，实际读取资料进入 D 的参考记录；正文来源含 material ref 和分片位置，引用点击打开当时版本。撤回取消受影响工作、禁止新读取，不删除既有成果正文。
- [ ] UI 导入、更新、删除/撤回、来源、失败保留草稿，类型检查/专项和 Electron 通过后提交 `feat(contacts): use persistent materials in conversations and tasks`；在线理解质量由最终模型样本验证。
