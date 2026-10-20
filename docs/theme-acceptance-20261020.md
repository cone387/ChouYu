# 桌面 ChatGPT 风格主题验收

日期：2026-10-20。

## 参考与实现

用户要求主题配色与其桌面 ChatGPT 一致，并明确要求使用 Computer Use 直接查看窗口。仅参考实际浅色窗口的颜色：浅灰蓝外框、近白侧栏、白色内容区、中性选中背景、黑色主操作。用户纠正后，已撤回超出配色范围的字体、圆角、阴影、间距及控件样式变更。深色是同一配色的适配，未对照用户的 ChatGPT 深色窗口，不声明逐像素复制。

- 仅调整共享背景、文字、边框、强调色及悬停态等颜色变量和外框背景颜色。
- 新增「中性（ChatGPT 风格）」配色，默认及无效配置回退使用中性；旧配置已选紫/粉/蓝/绿/橙时保留原选择，可在设置 → 通用切换。
- 字体、字号、阴影、圆角、间距、聊天输入区及会话列表组件样式恢复修改前版本。
- 保持现有窗口模式、联系人任务组件、单描述表单和输入框焦点规则。

## 首轮验证（范围收窄前）

以下截图包含后来撤回的控件样式，作为首轮历史证据保留，不代表最终仅配色版本。

- `npx vitest run src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts src/renderer/src/components/Settings/Settings.layout.test.ts src/renderer/src/components/Contacts/Contacts.layout.test.ts src/renderer/src/core/theme.test.ts src/shared/config.test.ts`：5 文件、82 项通过，覆盖配置兼容、全部配色深浅色文本/按钮对比度及相关布局约束。
- `npm run typecheck`：通过。
- `npm run build`：通过；保留原有大于 500 kB 的构建产物提示。
- 设置 `CHOUYU_SMOKE_ARTIFACTS=artifacts/theme-20261020` 后执行 `node scripts/smoke-electron.js --chat`：通过。真实 Electron/IPC，使用隔离数据和本地模型夹具；覆盖窗口模式与最大化/还原、草稿保留、页面切换、聊天滚动、设置、记忆及审批键盘操作。
- 冒烟生成 60 张截图，包含深浅色和 375/1024 宽视口；人工查看聊天、窄屏和设置代表性截图。截图保存在本地忽略目录 `artifacts/theme-20261020/`，不包含用户真实聊天。
- 已通过 Computer Use 对照运行中的应用与 ChatGPT 浅色参考窗口。
- 当前用户开发实例已热更新样式，但从设置点击新增配色后仍显示紫色；未声明该实例已成功切换。需重启开发进程后，在设置 → 通用选择「中性（ChatGPT 风格）」。构建后隔离实例已验证中性默认值及实际渲染。

## 仅配色版本验证

- `git diff --exit-code -- src/renderer/src/styles/tokens.css src/renderer/src/components/ChatPanel/ChatPanel.css src/renderer/src/components/ConversationSidebar/ConversationSidebar.css`：通过，三个文件与本轮修改前完全一致；全局字体声明和阴影也已恢复。
- 重新执行上述 5 文件测试：82 项通过。
- 重新执行 `npm run build`：通过；保留既有构建体积提示。
- 未重跑首轮 Electron 冒烟，旧截图不作为本次回退后的视觉验收证据。

## 联系人任务约束与边界

受影响条款为 UI-01/02/03/04/05、SCOPE-01。未新增或复制任务组件，未变更任务表单字段、Esc 逻辑、输入框聚焦装饰、快速新建/批量处理约束或主动未读闪烁。相关组件源码测试通过；本次聊天冒烟不代替完整联系人任务执行验收，也不宣称重新验证所有任务弹窗、真实模型或全天运行。
