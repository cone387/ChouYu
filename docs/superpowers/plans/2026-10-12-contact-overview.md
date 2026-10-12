# 联系人首页和导航 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优先呈现真实待回应事项、交付和当前工作，统一内容入口及往返体验。
**Architecture:** 只读聚合已保存任务/交互/成果；UI 不增加模型调用，不改底层调度或通知。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task A1：内容优先的真实概览

**Files:** 新增 `src/shared/contact-home.ts`、`src/main/agents/home.ts`、`home.test.ts`、`ContactHome.tsx`；修改 `store.ts` dashboard 投影、`ContactsView.tsx`、`ContactCardStats.tsx`、`ContactDailyOverview.tsx` 及 API 接入。
**Interfaces:** `contactHome(owner:string):ContactHomeData`；ContactHomeData 含 pending（原 ContactInteraction 引用）、recentDeliveries（B 的目录项）、tasks（原公共任务投影）、可选 summary 和 measuredAt；`cardHighlights(data:ContactHomeData):{pending?:string;delivery?:string;task?:string}` 仅截取真实正文或状态，不生成发言。
- [ ] 测试待处理按真实 unresolved，不随消息已读消失；新版交付准确指向 ref；没有统计不显示零；暂无当前运行不称忙碌；ChouYu 定时/内置职责只按实际能力展示；数据失败不留旋转状态。运行 home.test.ts 确认红。
- [ ] 主进程聚合 pending 和正式成果，不把整个私人记忆送到全员列表。卡片优先名字/擅长、待回应/成果/当前任务，工作方式保留；模型、用量、条数次级，固定排序不受后台活动抢位。
- [ ] ContactHome 替换联系人概览的默认入口，复用原待处理卡片，时间图/日志/统计仍能展开访问。独立联系人与 ChouYu 复用同一结构并按数据能力显示。
- [ ] 运行 dashboard/状态回归和 Electron 内容排序/失败场景；类型检查通过后提交 `feat(contacts): prioritize responses and outcomes in contact overview`。

## Task A2：导航层级与返回位置

**Files:** 修改 `ContactAgentPanel.tsx`、`ContactsView.tsx`、`Contacts.css`、`ContactAgentPanel.css`、`contactNavigation.tsx`、`src/renderer/src/components/ChatPanel/{ChatPanel,ContactWorkToolbar,ContactPending}.tsx`；新增 `contactReturnLocation.ts`、`contactReturnLocation.test.ts`、`src/main/smoke/contact-navigation-smoke.ts`。
**Interfaces:** ContactReturnLocation={characterId:string;tab:ContactAgentTab;topicId?:string;delivery?:ContentCitation;interactionId?:string;scrollTop:number}；`saveReturnLocation(location):string` 返回当前窗口有界 token，`takeReturnLocation(token):ContactReturnLocation|undefined`；跨重启阅读仍由 B 保存，不将临时返回栈当永久记忆。
- [ ] 测试来源→设置→返回保留联系人/任务/原版本，未知/已删除对象明确报错；切联系人后迟到请求不可覆盖；多次打开最多保留 20 个返回 token 且不可跨窗口复用；用量页返回不丢任务阅读；Esc 与鼠标取消遵循原焦点约定。运行专项确认红。
- [ ] 分组日常入口（概览/任务/成果）、个人内容（记忆/资料）、工具（技能/人设/设置/记录/消耗）；全部仍可键盘访问，窄屏换行/更多菜单有标签。保留公共任务五标签及内联聊天操作栏，不新增独立控制行。
- [ ] 设置跳转和待处理共用返回定位，打开设置不完成事项，提交成功明确回执；按钮读屏名称包含联系人与动作，深浅色不用颜色单独区分状态。
- [ ] Electron 验证 375/1024、深浅色、键盘、Esc、嵌套弹窗边界、实际聊天→待处理→设置→原成果；检查截图与无横向遮挡。专项/类型检查通过后提交 `feat(contacts): organize navigation and preserve return context`。
