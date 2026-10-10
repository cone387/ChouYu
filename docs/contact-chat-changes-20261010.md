# 聊天修改需求与验收（2026-10-10）

关联规范：NL-03/04/05、RUN-02/03、RES-01、MSG-01/03/04、HIST-01、SCOPE-01。

## 实现

阿衡在“一次汇报一个”后两次口头答应，后台仍按原规则交付。普通联系人已有任务的聊天现先进行结构化意图路由，再经现有工具权限、归属和版本检查执行。明确修改按实际工具回执回复；普通问答继续原聊天。使用当前联系人的模型，有任务时增加一次意图解析，格式最多修正一次，失败不继续生成“已调整”承诺。

`edit_contact_task` 保存明确变化的字段与用户原话。内容和任务额度联合修改是同一事务，失败全部回滚；已有成果、未提及字段、暂停/结束状态保留。旧轮次取消，后续使用新版本。

`separateEvaluations` 是内部派生参数，不新增设置表单。单独调整汇报粒度时不修改工作目标。每项评审从已保存评价生成对应原文，独立投递、来源校验、回执、重启去重，保留同轮其他评价。任一消息写入失败，报告、成果和所有消息一同回滚。自动成果不再挤掉后台近期普通交流。

## 需求矩阵

| 需求或边界 | 预期行为 | 验证入口 |
| --- | --- | --- |
| 一次只汇报一个评价 | 三个评价分别交付，各条一个；研究批次不变 | chat-changes、chat-edit、真实模型 report-unit、Electron smoke |
| 恢复合并汇报 | 后续合并；旧消息不改写 | chat-edit |
| 语言、语气、先结论/依据、篇幅 | 保存长期约束，保留其他要求 | chat-changes；真实模型 language；具体正文语义仍依赖生成模型 |
| 目标/范围/名称 | 原任务更新，不重复创建 | chat-changes、chat-edit |
| 任务累计调用/Token 上限 | 严格数字和单位校验，不能低于已用/占用，不改每日额度 | chat-edit；真实模型 budget |
| 内容和额度一起改 | 同一事务成功或全部失败 | chat-edit |
| 暂停/继续 | 原任务操作，不将排队视为成果完成 | chat-changes、tools、既有 service；真实模型 pause |
| 回答追问 | 绑定真实等待轮次，拒绝旧问题；接单补充保留旧约束及需求记录，重复答复不重复写入 | chat-changes、chat-edit、tools |
| 单次正文修订 | 原成果修订，不混成长久要求 | chat-changes、tools |
| 阅读样式 | 读取真实版本，仅样式修订 | chat-changes、既有 presentation 测试 |
| 暂停/结束任务修改要求 | 不恢复执行 | chat-edit、Electron smoke |
| 多任务含糊指代 | 不能猜当前焦点，询问名称 | chat-changes；真实模型 ambiguous |
| 普通讨论/不改/引用他人 | 不写任务 | chat-changes；真实模型 discussion/quote |
| 无效模型输出/数字字符串 | 最多修正一次，失败不写入 | chat-changes；真实模型发现后增加校验 |
| 版本变化/跨联系人/归属变化 | 拒绝覆盖和串写 | chat-edit、tools |
| 磁盘失败/非法额度 | 事务回滚，无成功回执 | chat-edit |
| 运行中修改/迟到旧结果 | 取消旧轮次，旧结果不能提交 | chat-edit、既有 service |
| 重启 | 新要求、原话、回执保留 | chat-edit |
| 工具关闭/拒绝批准/执行失败 | 明确未完成 | chat-changes |
| 自动成果占满上下文 | 排除通知，保留最新普通交流 | chat-changes |
| 联系人模式/时段/每日额度 | 当前聊天如实说明未修改，指向工作设置 | chat-changes；真实模型 daily-budget |
| 定点/周期安排 | 普通联系人不假装支持，说明可交给 ChouYu | chat-changes；真实模型 unsupported |
| 解除额度/删除/结束 | 当前路由说明能力限制，不用文本冒充操作 | chat-changes |

## 验证与边界

- 专项入口：`npx vitest run src/main/agents/chat-changes.test.ts src/main/agents/chat-edit.test.ts src/main/agents/notices.test.ts src/main/agents/tools.test.ts`。
- 真实模型：`CHOUYU_CHAT_CHANGE_ACCEPTANCE=1` 启用 `chat-change-model.acceptance.test.ts`，使用阿衡实际模型配置、合成任务，不写真实任务/聊天。配置须通过应用解密后以进程环境传入，不能将磁盘密文当 API Key；不保存明文配置。结果位于 `temp/chat-change-model/`。
- Electron：`CHOUYU_SMOKE_CHAT_CHANGE_ONLY=1 node scripts/smoke-electron.js --agents` 覆盖聊天路由 → IPC → 工作进程 → SQLite → 操作回执，验证暂停保留与原话记录。操作回执随 IPC 结果原子返回，由前端先显示再完成，避免流事件晚于调用结果被丢弃；另有前端回归测试。使用本地模型夹具，不能冒充真实模型理解测试。
- 完整回归、类型检查、构建、烟测结果在 `temp/chat-change-*.log`。
- 模型抽测证明具体表达的表现，不能保证任意自然语言百分之百识别。联系人级设置聊天修改、任意非结构化成果按语义拆分、ChouYu 安排入口的同类路由仍有缺口，没有做长期在线运行验收。

本轮记录：完整单元/集成回归结果见 `temp/chat-change-full.log`；另行启用真实模型抽测 9 项通过。类型检查、构建、Electron 聊天修改专项及完整 `--agents` 烟测通过。完整烟测最初误选了共同列表中的 ChouYu 职责，已改为按真实测试任务 ID 定位；没有为测试切换用户当前任务的产品行为。完整日志为 `temp/chat-change-smoke.log`。

实机修复：已通过原聊天操作链路把用户已提出的“一次汇报一个”保存到阿衡原任务；核对目标与额度未改，需求原话持久化。实机数据修改不用于替代上述隔离测试。
