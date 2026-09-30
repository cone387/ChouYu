# 任务编辑体验

本文适用于用户待办模块，不适用于联系人任务。联系人新建、设置与编辑遵循 [联系人任务 spec](contact-task-spec.md) 的单描述弹窗规范。

2026-09-29，工作区 `ChouYu-task-edit`，分支 `feat/task-edit-experience`。

- 新建与编辑任务：关闭按钮、取消、遮罩和 Esc 检查未保存修改；未添加的子项输入也参与检查。取消放弃后继续编辑，确认放弃才关闭。保存失败沿用原表单保留输入。
- 列表与看板：点击优先级或截止时间打开单字段编辑框；未设日期时可设置截止时间。只提交对应字段，日期联动由原有存储逻辑处理。改期或清除前显示提醒、重复规则的影响。
- 单字段编辑失败保留输入；保存前重新读取任务，发现内容变化时提示重新打开。此检查不是数据库原子版本锁。
- 未增加今天页过期提示、筛选条件标签、快速新建、多选或批量操作。排除要求已写入 AGENTS.md。

验证通过：

```powershell
npm run typecheck
npm test -- src/renderer/src/components/Tasks src/shared/tasks.test.ts src/shared/taskScheduling.test.ts src/main/tasks
npm run build
node scripts/smoke-electron.js --task-edit
node scripts/smoke-electron.js --task-scheduling
node scripts/smoke-electron.js
```

任务相关测试 13 个文件、146 项通过。新增专项使用隔离数据验证取消放弃、确认放弃、单字段更新保留其他数据、看板改期及提醒平移、外部更新后拒绝旧编辑并保留输入。完整回归日志位于 `temp/task-edit-full-smoke.log`；亮暗主题截图位于 `temp/task-edit/`。构建仍有入口 chunk 超过 500 kB 的既有提示。

## 卡片子项操作

- 列表、看板点击子项进度展开步骤；点击名称或复选框可完成、恢复一个子项，支持键盘空格操作。展开区域不会触发父卡片编辑或拖拽。
- 写入期间显示保存状态并防止重复提交；失败不改变勾选结果，显示错误并允许重试。
- 新增单子项状态 IPC，在数据库事务中读取最新子项再更新指定状态，保留其他子项、日期、提醒及其发送记录。勾完子项不自动完成父任务，也不生成重复任务的下一期。
- 修复原有调度器仍发送已完成子项提醒的问题；恢复子项后可发送尚未发送的到期提醒，已发送提醒不重复发送。
- 子项日期、提醒和内容仍在完整任务表单编辑。

类型检查、构建、149 项任务相关测试和 `--task-edit` 专项通过。专项新增列表点击、展开状态保留、看板键盘勾选，以及子项已删除导致写入失败后的重试验证。截图位于 `temp/task-checklist/`，日志位于 `temp/task-checklist-smoke.log`。

完整 Electron 回归独立重跑通过，见 `temp/task-checklist-full-smoke-retry.log`。首次与截图专项同时运行时在通讯录删除断言 `Character was not deleted` 失败，见 `temp/task-checklist-full-smoke.log`；独立重跑未复现，本轮未据此宣称已定位该失败原因。
