# 联系人技能与文件成果 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技能说明、可运行状态、失败恢复和真实文件成果连起来。
**Architecture:** 保留现有隔离运行器与授权模型，增加不可变文件归档及任务/会话来源。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task G1：文件归档和交付关联

**Files:** 新增 `src/shared/contact-files.ts`、`src/main/agents/files.ts`、`files.test.ts`；修改 `src/main/skills/{runner,tools}.ts`、`src/shared/skills.ts`、`agents/{service,delivery}.ts`、`src/main/ipc.ts`。
**Interfaces:** WorkFileContext={characterId:string;skillId:string;runId?:string;topicId?:string;sessionId?:string;requestId:string}；ContactFile={id:string;context:WorkFileContext;name:string;hash:string;bytes:number;mediaType:string;createdAt:number;deliveryRef?:DeliveryRef}；`archive(context,validatedFiles:{name:string;bytes:Uint8Array}[]):ContactFile[]`、`read(owner,id):{file:ContactFile;bytes:Uint8Array}`、`attach(owner,ref:DeliveryRef,fileIds:string[]):void`。AgentFiles(db,root) 只接受运行器校验后的普通文件。
- [ ] 文件集成测试：同名改写归档后 v1 字节不变；另一联系人读取失败；软链/硬链/路径穿越拒绝；8 MB/128 件/200 KB 边界沿用 runner；临时文件只列工作文件，attach 后才是成果；失败/取消不附会交付；元数据失败保留旧版且清理暂存；重启恢复安全。运行 files.test.ts 确认红。
- [ ] 存储采用内容哈希受管副本与事务元数据、所有删除前校验实际路径；工作目录路径不是成果身份。以实际工具调用传入 context，后台带 run/task，聊天带 session/request；旧文件缺少证明时仅标历史工作文件。
- [ ] 正式交付可引用本轮已归档 fileIds，服务端核对 owner/run/hash；与成果 commit 同事务关联，不凭模型文件名假定生成。取消时即便临时文件存在也不标成功。
- [ ] 运行专项/现有 runner 测试及真实 Docker 输出归档测试、类型检查，通过后提交 `feat(contacts): archive attributable file deliverables`。

## Task G2：能力呈现和可用成果

**Files:** 新增 `src/shared/contact-capabilities.ts`、`src/shared/contact-capabilities.test.ts`、`src/renderer/src/components/Contacts/ContactFiles.tsx`；修改 Contacts 目录的 `ContactSkills.tsx`、`SkillRuntimeDialog.tsx`、`ContactTaskDialog.tsx`、作品集/阅读器，及 `src/renderer/src/components/ChatPanel/ContactInteractionCard.tsx`、`src/main/agents/index.ts`；新增 `src/main/smoke/contact-capability-smoke.ts`。
**Interfaces:** `skillCapability(skill:ContactSkill,runtime:SkillRuntimeStatus):{instructionReady:boolean;scriptReady:boolean;requirements:string[];examples:string[]}`，examples 仅从技能明确用法摘取，无匹配返回空；新 API fileList/readContactFile/exportContactFile，导出使用原系统保存对话框，不接受渲染层任意路径。
- [ ] 测试无需脚本的技能在 Docker 未就绪时 instructionReady=true；脚本未授权不可运行；外部服务只显示未验证条件；没有示例不杜撰；环境修复不清待处理状态。运行 capability 测试确认红。
- [ ] 卡片区分安装/启用/脚本授权/环境/依赖/外部条件，示例只填普通任务弹窗。失败跳精确配置/日志并保留返回原事项定位，明确点击才重试。
- [ ] 文件页预览文本和常见图片，HTML 沙箱/其他格式下载；只读协议核对归属，预览无宿主访问和网络，保留文件来源/历史版本。工作文件与正式成果明确分区。
- [ ] UI 真鼠标验证示例不隐式执行、文件预览/导出取消/权限错误、失败往返；深浅色窄宽屏与类型检查通过后提交 `feat(contacts): surface usable skills and file outcomes`。
