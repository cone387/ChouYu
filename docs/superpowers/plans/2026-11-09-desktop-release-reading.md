# 桌面使用、发布收尾与成果阅读 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户指定顺序完成桌面可靠性与 Windows 候选包验证，随后改善独立成果设计师的实际阅读效果。

**Architecture:** 保留当前 Electron 桌面、模块化单体、原任务引擎和共同阅读器。先复现当前代码的失败，区分产品故障和验收前置条件错误，再做最小修复；设计师沿现有生成、预览、复核与发布链路优化。

**Tech Stack:** Electron 44、React 18、TypeScript、SQLite、Vitest、electron-builder。

**Spec:** `AGENTS.md`、`docs/contact-task-spec.md`、`docs/superpowers/specs/2026-11-06-result-designer-agent-design.md`；本会话用户选择先完成桌面使用与发布收尾，再打磨成果设计师。

## Global Constraints

- 共同任务 UI、单描述弹窗、正文与展示独立、固定来源、未读闪烁均保持现行规范。
- 使用隔离用户目录和合成成果；不能用测试结果冒充实际休眠、多显示器或在线模型验收。
- 不操作用户正在运行的实例，不修改其任务、成果或凭据。
- 不恢复 24 小时长测门槛；本地候选包和公开发布分别记账。
- 只在确有失败证据时修改产品；不放宽断言或仅重跑来关闭历史缺口。

## Review Focus

- 鼠标未移动而弹窗/布局变化时，点击穿透状态仍须正确；任务 1 覆盖。
- DPI、滚动和窗口边缘的真实输入坐标与渲染状态不能混用；任务 1 覆盖。
- 恢复后不得重复提醒、丢失保存数据或复活暂停任务；任务 2 覆盖。
- 长成果后部、折叠内容、表格和窄窗不可仅凭首屏截图宣称可读；任务 3 覆盖。
- 复用已有设计时来源变化仍须重新验证，显式调整不能被自动更新覆盖；任务 3 覆盖。

### Task 1: 完整桌面复现与修复

**Files:** `src/main/smoke/agents-smoke.ts`、`src/main/mouse-events.ts`、`src/renderer/src/core/mouse-events.ts` 及实际复现涉及的窗口组件与对应测试。

**Interfaces:** 沿用 `attachMouseEventsController`、`isInteractiveHit`、既有窗口事件和 Electron IPC；不新增执行引擎。

- [x] 运行生产构建和完整 `node scripts/smoke-electron.js`，保存初始失败、状态和几何证据。
- [x] 对已定位根因增加最小失败回归，执行后确认失败原因，再做修复。
- [x] 核对启动、拖拽、各边缘缩放、弹窗内外穿透、取消和焦点恢复，运行完整桌面回归至通过；未能复现项保留边界。

### Task 2: 恢复与 Windows 候选包

**Files:** `src/main/mouse-events.test.ts`、`src/main/journal/service.test.ts`、`scripts/smoke-electron.js`、`scripts/release-upgrade-fixture.cjs`、`electron-builder.yml`、发布验收文档。

**Interfaces:** 既有 `--packaged`、`--upgrade-v134`、原生依赖成品探针及恢复专项。

- [x] 验证休眠/唤醒事件路径、任务恢复及通知去重；区分模拟事件与实体休眠。
- [x] 执行类型、模块边界、全量单测和构建；发现失败先定位。
- [x] 构建 Windows 本地候选包，执行成品启动、原生依赖、数据升级和关键桌面回归，记录产物哈希。
- [x] 更新发布记录，准确列出安装器、自动更新和实际硬件验证覆盖；公开发布为单独动作。

### Task 3: 成果设计师阅读质量

**Files:** `src/main/result-designer/workflow.ts`、`preview.ts`、`src/shared/result-design-environment.ts`、共同成果阅读器、相关单测和 `src/main/smoke/result-designer-smoke.ts`；按实际问题选择最小修改范围。

**Interfaces:** 沿用 `runResultDesign(job, ports, signal)`、`DesignPreviewPort`、正式 `ResultSourceSnapshot` 和固定版本阅读器。

- [ ] 使用长文、研究、想法和评审四种样例，检查当前实际页面、正文后部、目录、表格、主题和窄窗；记录生成次数、耗时与用量。
- [x] 将已确认的阅读缺陷固化为失败回归，再改进环境说明、预览验证或阅读器。
- [ ] 在线调用使用明确的现有模型配置和合成内容，保留失败样本；能力不支持图片时不改成夹具成功。
- [x] 执行设计师、成果集及相关 Electron 专项并人工看图；最后全量检查和独立审查，重新制作包含最终改动的候选包。
- [x] 同步联系人规范、成果设计师说明、当前状态及本轮验收；区分已实现、实际验证和外部限制。

## 执行记录

- 基线 `670e4ac`；隔离工作区 `C:/Users/Administrator/.codex/worktrees/8ee3/ChouYu`，分支 `fix/desktop-release-reading`。
- 本地代码、全量 2385 项单测、完整桌面及成品恢复/升级/设计师专项通过；候选安装包已校验并交付，详见 `docs/desktop-release-reading-acceptance-20261109.md`。
- 四类本地样例 10 次协议调用、41 张实图；在线视觉能力/审美未验收，表格语义投影仍为已登记缺口。未执行实体睡眠、多屏、干净系统安装或公开发布。
