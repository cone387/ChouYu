# 联系人成果与续读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立跨任务作品集、收藏、全文查询、精确版本阅读和重启续读。
**Architecture:** 以正式 delivery_versions 为唯一正文源；索引和阅读状态独立保存，共用原成果阅读器。
**Tech Stack:** Electron 44、React 18、TypeScript 5.6、SQLite/better-sqlite3、现有 LangGraph、Vitest 5。
**Spec:** [完整设计](../specs/2026-10-12-contact-experience-design.md)；[唯一产品规范](../../contact-task-spec.md)。
**Global Constraints:** 完整继承[总计划](2026-10-12-contact-experience.md)的约束、接口和公共交付步骤。
**Review Focus:** 每项任务列出的失败场景属于必验项；总计划列出跨模块五项重点及归属。

## Task B1：有版本的作品查询和个人状态

**Files:** 新增 `src/shared/contact-content.ts`、`src/main/agents/portfolio.ts`、`portfolio.test.ts`；修改 `agents/store.ts`、`delivery.ts` 及总计划的 API 接入文件。
**Interfaces:** `AgentPortfolio(db: Database.Database)` 提供 `resolve(owner: string, ref: DeliveryRef): { artifact: AgentDelivery; section?: DeliverySection }`、`list(owner: string, query: PortfolioQuery): PortfolioPage`、`favorite(owner: string, topicId: string, value: boolean): void`、`saveReading(owner: string, input: ReadingPosition): void`、`reading(owner: string, topicId: string): ReadingPosition | null`。公共查询类型在 contact-content.ts 定义：PortfolioQuery 包含可选 query/topicId/cursor、favoritesOnly、sort='updated'|'name'；PortfolioPage 含 items/nextCursor；每项含 ref/title/excerpt/createdAt/favorite。ReadingPosition 含 ref、可选 anchor、scrollRatio(0～1)、updatedAt；已读分节哈希另表记录。
- [ ] 在 portfolio.test.ts 用真实 AgentStore/临时数据库和正式 commit 构造 31 项、两联系人及多版本夹具。测试：`expect(first.items).toHaveLength(30)`；并发新增后旧 cursor 最后一页只剩原第 31 项；跨联系人 resolve 抛错；只搜最新版正文；相同时间/中文同名稳定分页；收藏和阅读 reopen 后一致；样式更新不变更已读正文哈希；坏 cursor/非法版本/事务失败不更新。
- [ ] 运行 `npx vitest run src/main/agents/portfolio.test.ts`，确认失败。
- [ ] 实现公共契约及增量数据库迁移；在 contact-content.ts 定义 `deliveryText(body:string):string`，作为正文选择/阅读锚点的唯一纯文本投影（复用当前 Markdown 语义，保留可见段落与代码文本，统一换行），偏移按 JS UTF-16。索引保留版本创建时的标题/正文哈希，查询水位锁定索引序号，删除仅移除该任务。原成果 commit 事务同步写索引；旧库按真实成果重建索引而非伪造阅读记录。API 名为 portfolio、setDeliveryFavorite、saveDeliveryReading、deliveryReading。
- [ ] 重跑专项与 `npm run typecheck`，补旧库升级/未来 schema 拒绝测试，通过后提交 `feat(contacts): persist portfolio and reading state`。

## Task B2：作品集与共用阅读器

**Files:** 新增 `src/renderer/src/components/Contacts/ContactPortfolio.tsx`、`ContactDeliveryReader.tsx`、`deliveryReading.ts`、`deliveryReading.test.ts`；修改 `ContactDelivery.tsx`、`ContactPresentation.tsx`、`ContactAgentPanel.tsx`、`contactNavigation.tsx`、`src/shared/delivery-presentation.ts`；新增 `src/main/smoke/contact-portfolio-smoke.ts`。
**Interfaces:** ContactPortfolio({characterId,onOpen})；ContactDeliveryReader({characterId,topic,artifact,onNavigate,onCite?})；`restoreReading(position: ReadingPosition, sections: DeliverySection[]): {sectionId: string; anchor?: TextAnchor; changed: boolean}`；导航新增 `{kind:'delivery'; ref:DeliveryRef; anchor?:TextAnchor}`。onCite 在 C 接入，B 不伪造讨论。
- [ ] 测试 restoreReading：重复段落/emoji 保留正确偏移，内容修改返回 changed=true 和该节开头，原节消失允许回旧版；仅滚动到的分节记录哈希，版本切换不误标全部读完。
- [ ] 运行 reading 单测与新增 UI 场景，确认旧代码不具备作品集/重启续读。
- [ ] 实现作品集搜索、任务范围、收藏和排序，30 项分页；组件请求代次防迟到覆盖。抽出阅读器供任务成果和作品集调用，保留原样式、版本比较、导出。阅读滚动 500ms 节流且切换/关闭 flush；禁止应用程序恢复滚动触发假已读。保存失败可见但不中断阅读。
- [ ] 自定义展示通过 origin/source + ref + 请求 nonce 校验消息，只信正式正文可核对的 selection/位置；无法对齐提供正文定位。移除/关闭清理订阅，后台新版只显示入口。
- [ ] 用 Electron 验证搜索命中原版、后台更新不抢阅读、收藏重启、窗口关闭末次位置、伪造 iframe 消息无效；375/1024 深浅色截图。专项/类型检查通过后提交 `feat(contacts): add portfolio browsing and resume reading`。
