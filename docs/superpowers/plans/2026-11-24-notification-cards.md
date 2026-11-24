# 通知卡片实施计划

> 执行：按 superpowers:executing-plans 在当前会话推进；用户已确认卡片效果图。沿用当前工作区，不迁移或提交其他未完成改动。

**目标：** 将提醒内容和操作合成一张紧凑卡片，突出事项，次要设置收进更多。

**架构：** 复用 FollowupActions 与 TrackedReminderActions，前者提供公共卡片及操作浮层，后者适配原消息正文/催办标题。MessageArea 只组合公共卡片，不更改消息存储、投递或已读规则。

**技术：** React、TypeScript、主题 CSS、Electron。

**依据：** 用户确认的效果图；docs/contact-task-spec.md 第 7、10、11 节。

## 约束与复核重点

- 首次成果、晨报的实际正文不能截断或被提醒标题替代；催办隐藏泛化正文，用来源标题。
- 已读与处理独立；持久化失败保留输入与错误，不能先关闭设置或宣布成功。
- 普通聊天无额外卡片；旧多事项提醒仍保留各项入口，不伪造历史。
- 浮层不得被聊天滚动区域裁切；窄屏可达，Esc 只关闭当前浮层，返回触发按钮。
- 处理完成/失效后收起操作，保留来源菜单、内容和状态。隐藏聊天时不得留下浮层。

## Task 1：公共通知卡片与验证

文件：ChatPanel/FollowupActions.tsx、ReminderActions.tsx、MessageArea.tsx、新 NotificationCard.css、FollowupActions.test.tsx 与 notification-card.test.tsx、main/smoke/reminders-smoke.ts。

- [x] 先写渲染/交互失败测试：默认只有主要操作和稍后提醒，原文完整，催办无泛化气泡；更多、延期、设置、失败重试、Esc 与隐藏面板。
- [x] 实现卡片标题/正文插槽、阅读与处理状态、主要操作，复用原提醒 API；菜单采用定位浮层及受限键盘处理。
- [x] 更新 Electron 提醒验收，覆盖更多/设置/延期、来源入口与已读，生成 375/1024 深浅色截图。
- [x] 跑相关测试、类型检查、构建、完整测试及 Electron 验收；独立审查此次改动。
- [x] 同步规范与验收记录；保留已有工作区改动，不自动发布或替换运行中的应用。

完成证据：全套低并发复跑 2462 通过、62 跳过；类型检查、构建、Electron 提醒专项通过。审查发现跨卡片 Tab 导航可能保留旧菜单，失败测试复现后补充离焦关闭，红→绿。首轮运行时取消测试的时序失败和独立复跑结果见 `docs/individual-reminders-acceptance-20261124.md`；源码之外无发布操作。
