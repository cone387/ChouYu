# A2UI Result Reader Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 已保存成果中增加可实际比较的 A2UI 分节阅读模式。
**Architecture:** 宿主生成协议 1.0 描述，官方 React renderer 渲染自定义只读组件；现有成果库和设计师继续提供来源、版本与回退。
**Tech Stack:** React 18, TypeScript, A2UI 0.15.0, Electron.
**Spec:** `docs/superpowers/specs/2026-11-17-a2ui-result-reader-design.md`

## Global Constraints

- 正文来自固定成果快照，不重写，不执行新业务操作。
- 复用主题、Markdown、共同成果页；保留原文和现有设计。
- 不声称首版实现模型自主组合，不新增模型请求。

## Review Focus

- 重复标题仍可正确定位各节；长文不截断。
- 切换来源/任务不串内容，后台更新不替换正在阅读的版本。
- 渲染或加载失败可见报错并显示原文。
- 深浅色与窄屏沿宿主滚动，按钮可键盘操作。
- 首次打开与切回原文不影响原来的设计师与来源行为。

## Tasks

- [x] 先写 `result-a2ui.test.ts`，验证读取投影的顺序、来源隔离、完整正文和空输入；运行失败后实现纯投影模块。
- [x] 安装精确 SDK，新增 `ResultA2uiReader.tsx` 和局部 CSS；自定义目录/分节组件只从 React context 读取正文。
- [x] 在 `ResultDesignView.tsx` 接入懒加载、模式切换和错误边界，保留原文降级；扩展现有真实 Electron smoke 验证。
- [x] 执行相关单测、类型、构建、边界与 Electron 深浅色/宽窄截图检查；更新规范第 10/11 节及验收文档。

## Execution record

本次在用户指定工作区实现，起始工作区干净。用户已授权前述局部试用方案，直接实施，不重复索取方案许可。

独立审查指出内部来源链接不可点击，已通过失败的真实 React 渲染测试复现并修复；真实 SDK DOM 测试额外发现组件 ID 的协议约束，已修复。新增 7 项测试、相关设计师 42 项、此前失败执行器组单独复测 64 项通过，最终 Electron 实际视口及截图验收通过。详见验收记录，保留首次全量测试和早期验收失败，不以最终局部复测声称首次全量绿灯。
