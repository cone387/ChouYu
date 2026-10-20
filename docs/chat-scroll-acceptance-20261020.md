# 聊天内容区滚动条修复

2026-10-20。范围仅为聊天长对话的原生滚动条交互，未修改字体、配色、圆角或静态布局。

## 原因与修复

220 条消息的隔离会话中，通过 Chromium 原生鼠标输入持续向上拖动滑块，复现到滚动位置反向回跳。长对话按需渲染新消息行时，会重新测量高度并补偿阅读位置；同时总内容高度变化，浏览器又重新计算滑块位置。两种调整与正在进行的拖动相互干扰。

拖动原生滚动条期间暂停阅读位置补偿，并临时保持列表总高度，避免滑块比例在拖动中变化。松手、取消、窗口失焦、切换会话或隐藏页面时解除临时限制。普通滚轮阅读及底部新内容跟随继续使用原逻辑。

## 验证

- 新增 `node scripts/smoke-electron.js --chat-scroll`，同时接入原有 `--chat` 冒烟。使用隔离数据及真实 Electron/Chromium 输入，不调用用户模型或修改真实聊天。
- 修复前专项回归失败：`Upward native scrollbar drag jumped back down during row measurements`；只取消位置补偿时仍有回跳，保持拖动期间总高度后通过。
- 最终 `node scripts/smoke-electron.js --chat` 退出 0：拖动方向一致、松手解除限制、内容变化不抢走历史阅读位置、滚轮回到底部后恢复跟随；原有窗口模式、页面切换、草稿、流式回复及搜索回归通过。
- `npx vitest run src/renderer/src/components/ChatPanel/useMessageWindow.test.ts src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts src/renderer/src/components/ChatPanel/MessageArea.identity.test.ts`：34 项通过。
- `npm run typecheck`、`npm run build` 通过。

本地证据位于忽略目录：`artifacts/scroll-before.log`、`artifacts/scroll-after.log`、`artifacts/scroll-final-smoke.log`、`artifacts/scroll-final-build.log`。最终冒烟日志另有隐藏窗口捕获 `UnknownVizError` 及退出夹具清理后的会话保存错误；测试断言与最终退出均通过，此次未处理这些独立问题。未将本次聊天回归表述为其他页面或所有滚动输入设备的全面验收。
