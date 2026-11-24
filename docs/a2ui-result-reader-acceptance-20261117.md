# A2UI 成果阅读试用（2026-11-17）

此文保留首版试用记录；同日用户反馈后的默认展示、设计师 A2UI 布局与引用/阅读完善见 [继续迭代验收](a2ui-adaptive-results-acceptance-20261117.md)。当前操作入口以新记录为准。

## 使用方式

打开联系人任务的「任务成果」，或 ChouYu 已保存的安排成果，在原工具栏点击「分节阅读」。目录可展开/收起，点击分节跳到对应正文；正文沿任务页同一滚动区域阅读。可随时切回「原文」或已有「成果界面」。无正式来源时不出现入口，不生成示例冒充成果。需要加载本次构建的应用才能使用；未替换正在运行的应用或发布安装包。

## 实现与边界

- 官方 `@a2ui/react` / `@a2ui/web_core` 0.15.0，协议 1.0；依赖 npm 包，不依赖本机 A2UI checkout。
- SDK 及分节阅读组件懒加载，本轮构建的独立 JS chunk 约 309 KB（压缩前的 minified 文件大小）。首次启动不主动加载该 chunk。
- `@a2ui/markdown-it` 0.2.2 的 peer 范围仍是 Web Core ^0.14.0，使用 npm override 统一为 0.15.0；本项目正文使用已有 ContactMarkdown，不使用其 Markdown 渲染实现。实际 SDK 适配以真实 Electron 验收为准。
- 自定义目录只有文档、目录、已保存分节三个组件；描述中存索引，正文从独立来源快照读取。组件不注册模型可调用的业务动作。
- 延续固定版本、来源校验、原文回退、主题和 Markdown 链接规则。目录导航是本地阅读操作，原文状态和通知不受影响。
- 首版布局由宿主确定性生成，未实现模型自主生成 A2UI 布局、图表、业务交互或阅读模式跨重启保存。现有 HTML 设计师保留。没有线上模型效果或性能收益结论。

## 验证记录

受影响条款：UI-01、UI-05、UI-07、UI-08、MSG-03/04 的固定正文与来源约束。

- 投影单测先失败（模块缺失），实现后 4 项通过；覆盖正文不进入 UI 指令、完整长文、重复标题顺序、来源隔离、快照独立与失配拒绝。
- 相关共享契约和设计师模块共 13 文件、42 项通过；独立审查发现内部来源链接不可点击，新增两项真实 React 服务端渲染测试先复现，再复用 ContactMaterialLink 修复，新增来源测试 2 项通过。
- 类型检查、构建、模块边界通过；构建仍有主界面大 chunk 提示。
- 官方 SDK 的真实 DOM 测试发现协议 1.0 组件标识符不能带连字符，已改为合法标识符；分节数量、重复标题定位、完整正文、Markdown 与来源替换由真实 MessageProcessor/A2uiSurface 验证，非替身渲染器。
- 首次全量单测：2422 通过、62 跳过、9 失败及 1 未处理错误。失败来自 `chapter-continuation`、Harness `reliability-protocol` 和 DSH `runtime-lifecycle`、`background`、`runtime`、`background-rounds`；包含启动/等待超时和取消回收断言，另有 ECONNRESET。该轮与 Electron 验收并行，不能直接归因于本改动或视为通过。随后对这 6 个文件使用 `npx vitest run <上述文件> --maxWorkers=1` 单独复核，64 项全部通过（78.63 秒），无执行器代码变更。保留首次日志，不宣称首次全量绿灯。
- 新增测试最终 3 文件、7 项通过，包含官方 SDK 实际挂载、重复标题定位和切换来源后旧正文清理。
- 首次 Electron 验收未完成：执行进程启动延迟，且验收期间再次构建更新了同一 out 目录，该次结果无效；固定最终构建后单独重跑。真实 SDK 验收暴露的组件 ID 问题由 DOM 回归复现后修复。截图审查还发现最大化窗口下 `setSize` 不改变实际视口，验收改用 device emulation 并断言 `innerWidth`，不沿用无效的尺寸结论。
- 最终 `node scripts/smoke-electron.js --result-designer` 通过（退出码 0）。真实 Electron 中验证完整第 36 段、目录定位及焦点、分节/原文/原设计往返，逻辑视口 375/1024、深浅色的无横向溢出；包含原设计师全链路回归。入口及正文截图已人工查看。退出阶段仍有原 IPC 的「应用正在退出」/handler 注销日志，不属于 A2UI 成果渲染失败。
- Electron 使用隔离数据和本地模型协议夹具，不访问线上模型或用户真实任务库；不能代替线上模型审美或性能验收。截图在 `temp/a2ui-result-reader/result-designer/a2ui-*.png`（入口和正文各四张）。最终日志为 `temp/a2ui-result-smoke-viewport.log`；类型与构建日志为 `temp/a2ui-typecheck.log`、`temp/a2ui-build.log`；全量及失败组单独复测为 `temp/a2ui-full-tests.log`、`temp/a2ui-executor-recheck.log`。
