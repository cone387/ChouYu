# 联系人完整体验迭代：阶段验收

日期：2026-10-12。完整目标仍未完成；[完整设计](superpowers/specs/2026-10-12-contact-experience-design.md)仍待审阅。

## 本轮落实的既有规范

本轮只修正早已明确的身份与新增表单约定，不将这两项修复当作完整设计的实现。

- 联系人卡片、资料页、人设编辑占位文案不再声称空人设会使用默认丑鱼人格；改为未设置说明及该联系人的身份/交流风格提示。未改模型人设处理。
- 独立记忆页通过「新增记忆」打开模态表单，保留原单条 2000 字、容量和存储接口。保存成功后更新列表并关闭，失败保留文字及弹窗内错误。同步提交锁防止重入，卸载后忽略迟到回调。
- 复用已有任务弹窗控件样式与有边界的鼠标交互约定，未添加彩色聚焦边框、outline 或阴影。
- 鼠标取消恢复入口焦点；Esc 只关闭该弹窗并按公共 Escape 规则清除按钮焦点，底层联系人详情保留。保存中不允许关闭，避免把已经提交的写入误称为取消。

## 已验证

- `npm test`：1394 项通过、19 项默认跳过，160 个文件通过、4 个文件跳过。日志 `temp/contact-memory-tests.log`。
- `npm run typecheck`：通过。日志 `temp/contact-memory-typecheck.log`。
- `npm run build`：通过，保留既有大 chunk 提示。日志 `temp/contact-memory-build.log`。
- `node scripts/smoke-electron.js --contacts`：通过，包含新增记忆流程、原联系人增删/模型对话、技能与全局搜索。日志 `temp/contact-memory-contacts.log`。
- 专项：设置 `CHOUYU_SMOKE_CONTACT_MEMORY_ONLY=1`、`CHOUYU_SMOKE_ARTIFACTS=artifacts/contact-memory-dialog` 后执行上述 contacts 命令。通过真实鼠标、键盘、Electron IPC 与 SQLite 验证：页面无可见内嵌新增表单；弹窗自动聚焦；Esc 保留父层；取消不保存；鼠标取消恢复入口；实际 SQLite 写入失败保留原文；解除故障后重试只落盘一条；重新打开数据库核对持久内容。初次在旧实现上因内嵌表单失败，见 `temp/contact-memory-red.log`；通过记录为 `temp/contact-memory-green.log`。
- 375/1024 宽、深浅色截图位于 `artifacts/contact-memory-dialog/`；检查弹窗可见边界和聚焦前后边框一致、无 outline/阴影，人工查看窄屏浅色和宽屏深色图。
- 独立代码复核未发现需修复的具体生产问题；代码中的联系人 key、卸载保护和同步锁已经审查。

## 验证边界与剩余范围

全部界面测试使用隔离数据，不写用户真实任务或记忆。本轮未跑真实模型、后台全天工作或所有 agent 引擎专项；没有改变这些执行逻辑。专项的恰好一条断言覆盖失败后重试，不声称已做保存中切换联系人或快速重复提交的独立 UI 验收。

完整设计的列表/概览重排、成果集/收藏/搜索/续读、正文引用、记忆版本与适用范围、资料空间、协作交接、技能文件成果仍未实现。EXP-01/06/15 仅有上述局部证据，不能标记整项通过；其余 EXP 项待实施与验收。
