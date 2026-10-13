# 联系人任务场景测试记录（2026-10-13）

本轮针对用户提出的“设计测试场景，实际模拟人操作，看看有哪些问题”进行测试。基线为 `3293576`，应用版本 1.3.5，Windows / Electron，Asia/Shanghai。验收依据为 [联系人任务规范](contact-task-spec.md)，不新增产品规则。

**首次测试结论（修复前）：复现两个产品界面问题、一处操作文案不一致，完整任务回归未通过。用户随后要求修复，当前结果见第 6 节。** 新建到成果投递的核心路径做了原生桌面操作，其余功能结合真实 Electron 集成测试、单元测试和故障注入检查。真实在线模型、全天调度、系统休眠与真实技能容器运行未在本轮验收；修复通过不代表每个功能均已完成真人操作验收。

## 1. 测试方式与隔离

- **N：原生桌面操作。** 在真实应用窗口中点击、滚动、按 Esc，通过 Windows UI Automation 填写输入框；观察截图和可访问性树。填写使用控件赋值，不宣称逐键输入。正常应用引擎、IPC、SQLite 和消息投递均运行。
- **E：Electron 集成测试。** 启动真实 Electron，使用现有脚本的 DOM 操作、IPC、测试数据注入和部分原生鼠标事件。不是每一步都模拟系统鼠标，也不冒充真人操作。
- **U：模块测试。** 验证状态、权限、协议、持久化等程序边界，不能替代交互验收。
- **D：诊断副本。** 仅在忽略的 artifacts 中修正测试夹具/选择器后运行，区分于原始套件通过。
- **待测：** 场景已设计，但本轮没有足够执行证据；不计通过。

本轮使用独立 userData 与本地 SSE 模型夹具，未使用用户的模型密钥、真实任务或付费服务。原生窗口标题为“ChouYu UI 测试（隔离数据）”。模型夹具用于稳定制造缺时间、待回复、解析失败和正文交付，不能证明真实模型的理解或写作质量。真实用户应用未被关闭或修改。

证据根目录：[contact-task-audit-20261013](../artifacts/contact-task-audit-20261013/)。`native-actions.jsonl` 记录原生操作后的界面状态；`manual-model.jsonl` 记录本地模型请求；`manual-data` 保留合成数据。artifacts 被 Git 忽略，报告中的证据链接面向当前工作区，分享报告时需一并打包相应文件。

## 2. 发现的问题

### F1 · P2：从聊天工具栏打开任务后，回复输入框出现紫色聚焦描边

**复现：** 新建一个需要补充问题的持续任务 → 从聊天顶部任务入口进入公共任务详情 → 点击待回复输入框，填写“面向成人，请继续。”。

**实际：** 输入框出现紫色 2px outline。**预期：** 保持默认边框，不出现彩色描边或阴影（UI-03）。这里指输入框自身的新增 outline，不把问题卡片原有的紫色边框误判为问题。

已在原生窗口复现，见 [截图](../artifacts/contact-task-audit-20261013/reply-focus-purple.png)。进一步使用实际构建的 CSS 对相同输入框结构进行聚焦伪状态探针，结果见 [focus-probe.json](../artifacts/contact-task-audit-20261013/focus-probe.json)：嵌入 `#root` 时无 outline，portal 外层时为 `rgb(108, 92, 231) solid 2px`，新建任务输入框仍正常。

原因明确：`ContactWorkToolbar.tsx:135–164` 把任务面板 portal 到 `document.body`；`styles/controls.css:28` 的表单中性聚焦规则仅覆盖 `#root`；`styles/index.css:238–246` 的全局 `:focus-visible` 使用 `!important`，压过 `ContactAgentPanel.css:13` 的普通规则。现有测试只检查部分入口，因此会出现“新建聚焦测试通过，但回复输入框违规”。建议修复后同时复测嵌入页与聊天浮层入口，保留按钮键盘焦点提示，不扩大到重做布局。

### F2 · P2：解析失败提示直接显示内部 IPC 异常包装

**复现：** 新建任务输入“解析失败：这是用于检查输入保留的测试任务”，本地模型故意返回无效 JSON → 提交。

**实际：** 弹窗保留输入，未新增任务，按钮恢复可用；但错误直接显示 `Error invoking remote method 'contact-task:request': Error: 没有解析出有效任务，请重试；尚未保存安排。`。

**预期：** 显示可理解的失败原因与下一步，内部接口名及英文异常包装留在诊断日志。失败保留输入、不误报保存的功能正确，问题是错误信息的呈现。原生界面证据在 `native-actions.jsonl`；代码位置 `ContactTaskDialog.tsx:72` 将异常 `message` 直接呈现。应测试“模型解析失败、IPC 拒绝、落盘失败”三类错误的用户文案，避免只处理这一条字符串。

### F3 · P3：定时任务编辑的提交按钮仍写“交给 AI”

**复现：** 保存工作日 08:30 提醒 → 暂停 → 编辑为“改成九点，其他要求不变”。

**实际：** 标题为“修改任务”，按钮仍为“交给 AI”；普通任务和职责编辑则为“保存”。保存后的任务 ID、暂停状态及 09:00 时间正确，没有重复创建。属于一致性观察，不是数据错误。

代码 `ContactTaskDialog.tsx:85` 的“保存”判断包含 `editTask || duty`，未包含 `routine`。建议统一编辑提交文案，并继续复用当前单输入框。

### T1 · 测试缺陷：主动工作检查脚本仍使用旧会话 DOM

原始 `--companion` 等待 `.conversation-item.active .conversation-item-title`，并按会话标题匹配按钮正文。当前侧栏可见文本是联系人名，会话名在按钮 `title`，原 class 已不存在。见 `src/main/smoke/companion-smoke.ts:43–44` 与 `ConversationSidebar.tsx:187–203`。

仅在诊断副本修正定位后，真实 IPC/SQLite、工作检查、模型摘要、任务链接、不切会话、去重、共享基线和工具关闭场景通过。原始套件仍记失败，不把诊断副本通过写成主套件通过。

### T2 · 测试缺陷：工作设置夹具缺失成果阅读接口

原始 `scripts/smoke-work-settings.cjs` 运行到成果阅读时抛出 `window.electronAPI.agents.deliveryReading is not a function`。前面的设置失败保留、冲突保护和响应式检查已经运行，但整套未通过。

在诊断副本补齐 `deliveryReading`、`saveDeliveryReading` 和 `portfolio` 模拟接口后得到 `CHOUYU_WORK_SETTINGS_SMOKE_PASSED`。产品 preload 接口与该脚本模拟接口不同步；不能把此错误认定为正式应用缺少 API。

### T3 · 待定位：完整 agents 套件连续三次未通过

| 执行 | 失败位置 | 已知证据与判断 |
| --- | --- | --- |
| 首次 | `contact-interactions-smoke.ts:40` 等不到失败卡片提交按钮 | 页面报“待处理事项不存在或不属于此联系人”，夹具联系人任务/待处理计数为 0。尚未证明是用户路径数据丢失；需排查夹具直接写库与联系人身份同步的竞态。 |
| 第二次 | `agents-smoke.ts:833` 等不到可见成果阅读器和修改按钮 | 超时界面仍停在工作设置。可能涉及导航时序，原因未确认，不能记通过。 |
| 第三次 | `contact-interactions-smoke.ts:122` 等待“已排队” | 当前动态重试状态为“已重新排队”或很快进入运行/完成，不满足旧的连续文本匹配。已确认断言依赖旧文案及短暂状态；其他两次失败不能因此自动结案。 |

建议先更新测试定位和稳定状态断言，再独立复现卡片消失与阅读器导航问题。修正测试时仍应核对真实操作结果、同一任务/轮次关联和落盘，不能只删除失败断言。

## 3. 逐项场景与本轮结果

“通过”仅指该行写明的方法和样本。“部分”表示相关步骤已有证据但不能覆盖整条规范。“待测”不等于功能不存在。

### 3.1 入口、表单与任务列表

| 编号 / 规范 | 操作场景与预期 | 方法 | 本轮结果 / 证据 |
| --- | --- | --- | --- |
| A01 / UI-01 | ChouYu、普通联系人打开任务，共用卡片、5 个详情标签及表单 | N+E | 通过；普通联系人主要由 routines/contacts 集成覆盖 |
| A02 / UI-02 | 点击新建，检查只有任务描述；空白不能提交 | N+E | 通过 |
| A03 / UI-04 | 补问过程中按 Esc，再打开；仅表单关闭，底层保留、草稿恢复 | N+E | 通过；原生再次打开仍保留请求 |
| A04 / UI-03 | 点击新建与待回复输入框，比较默认边框与聚焦状态 | N+D | **失败 F1**；新建正常，portal 回复框异常 |
| A05 / UI-06 | 检查空列表、职责、晨报模板的数量与缺失指标 | N+E | 通过；3 个关闭职责计总数 3，未配置晨报不计入，不补造统计 |
| A06 / UI-06 | 保存、暂停、删除安排后检查总数与启用数 | N+E | 通过；总数 3→4→3，暂停后启用数下降 |
| A07 / UI-05 | 375/1024、深浅色下打开任务、阅读、排队及设置 | E+D | 已生成截图并抽查，无已复现横向溢出；不是所有控件均做原生点击 |
| A08 / SCOPE-01 | 检查新建/设置未恢复多字段、快速新建、批量操作 | N+E | 所查联系人任务入口符合；未对用户待办全模块复验 |

### 3.2 自然语言新建、补问和修改

| 编号 / 规范 | 操作场景与预期 | 方法 | 本轮结果 / 证据 |
| --- | --- | --- | --- |
| B01 / NL-01 | 输入完整工作任务，提交后实际产生归属正确的任务 | N+E | 通过；“UI测试短篇”保存并进入执行 |
| B02 / NL-02 | 输入“每个工作日早上提醒我喝水”，补充“八点半” | N+E | 通过；仅追问时间，最终 weekday/08:30 |
| B03 / NL-02 | 多轮补问后检查前文，不重复要求已给的信息 | N+E | 通过夹具上下文链；真实模型理解质量待测 |
| B04 / NL-04 | 返回无效 JSON，再修改输入重试 | N+E | 保存语义通过；**错误显示失败 F2**；输入可保留并重新提交 |
| B05 / NL-03 | 暂停定时任务，编辑为 09:00，其他不变 | N+E | 数据通过，ID/暂停状态保留；**文案观察 F3** |
| B06 / NL-03 | 普通任务修改目标/约束，旧要求保留、不新增任务 | E | routines、chat-change 通过 |
| B07 / NL-05 | 自然语言修改任务调用/Token 预算，核对持久化 | E+U | 通过所测明确数字场景；不代表任意表达都能理解 |
| B08 / NL-05 | 修改休息/回来职责参数为 15 分钟，再读配置 | E | routines 通过；未等待真实闲置 15 分钟 |
| B09 / NL-02 | 普通联系人提出不具备的定点安排，不能偷换普通任务 | E | routines 通过，如实拒绝/补问 |
| B10 / NL-02 | 每月、隔 N 天、矛盾日期、模糊时区组合 | U / 待测 | 未逐一原生提交；完整自然语言组合矩阵待测 |
| B11 / NL-04 | 存储失败或旧版本修改不能覆盖新数据 | E+U+D | 工作设置/权限/任务工具栏保护有证据；新建任务磁盘写满的原生演练待测 |
| B12 / NL-03 | 在聊天直接调整现有任务，原话和回执可追溯 | E | chat-change 通过，暂停状态未丢失 |

### 3.3 执行、调度与资源

| 编号 / 规范 | 操作场景与预期 | 方法 | 本轮结果 / 证据 |
| --- | --- | --- | --- |
| C01 / RUN-01 | 新建后进入真实执行/待回复，不只显示成功提示 | N+E | 通过；本地模型由执行引擎调用 |
| C02 / RUN-02 | 回复“面向成人，请继续”，沿原问题与原轮次继续 | N+E | 通过；保存答复，问题变已处理，待处理数归零 |
| C03 / RUN-02 | 聊天工具栏暂停当前任务，选择对象不变 | N+E | 通过；状态图标、继续按钮及原因一致 |
| C04 / RUN-02 | 连续点击继续，避免重复开轮，其他联系人不受影响 | E | toolbar 通过；含旧版本拒绝及失败回滚 |
| C05 / RUN-02 | 暂停后强制结束独立测试进程，再启动相同数据 | N+存储核验 | 通过；仍 paused，仍 2 个轮次，消息仍 2 条，无自动复活 |
| C06 / RUN-01 | 多时段及一次性安排到期，实际投递并保存历史 | E | routines 通过；使用受控测试时间，不是现实等待全天 |
| C07 / RUN-05 | 单轮交付后等待，不能误称整项任务已结束 | N+E+U | 所测通过；短篇交付后为等待，终止边界见模块测试 |
| C08 / RUN-04 | 同时推进数设 2，3 项工作产生 2 运行+1 排队 | D+U | settings 诊断副本通过；并发增加/降低/重启全部原生操作待测 |
| C09 / RES-01 | 额度耗尽、每日额度不足一轮、任务累计预算不足 | E部分+U | 多类提示与保护有证据；完整 agents 未通过，不作整条验收 |
| C10 / RUN-03 | 执行中修改/删除，迟到结果不能覆盖或复活 | U+E部分 | 模块保护通过；持续输出中的原生删除竞态待测 |
| C11 / RUN-03 | 删除新建测试安排，核对确认范围和持久化 | N+E | 通过；独立数据内 routines 最终为空 |
| C12 / RUN-05 | 失败重试、取消、恢复后状态投影及时更新 | E部分+U | **完整回归受 T3 阻塞**；不标全通过 |
| C13 / RUN-01/02 | 睡眠唤醒、离线恢复、跨午夜、时区变更及长时间运行 | 待测 | 未改变宿主时钟/休眠；本轮无实机长期证据 |

### 3.4 成果、互动、消息与历史

| 编号 / 规范 | 操作场景与预期 | 方法 | 本轮结果 / 证据 |
| --- | --- | --- | --- |
| D01 / MSG-03 | 三段短篇交付，聊天直接出现保存正文和段落 | N+E | 通过；无 active/done、内部阶段 ID 或进度拼接 |
| D02 / MSG-03 | 两轮产生相同正文，不重复发送；重启后不重发 | N+存储核验+U | 通过夹具样本；两版相同正文只投递一条成果消息 |
| D03 / MSG-04 | 点击“查看本轮成果·第1版”，打开该版而非最新 | N+E | 通过；有第2版时仍显示第1版并提供新版提示 |
| D04 / NL-03/HIST-01 | 互动标签展开请求原文、补问、答复和后续修改 | N+E | 通过；喝水请求、08:30答复、09:00修改可追溯 |
| D05 / HIST-01 | 无执行时阶段/成果/历史正确显示空状态 | N+E | 通过；未伪造阶段、历史或成果 |
| D06 / HIST-01/MSG-02 | 到点执行记录关联消息，跨联系人导航，删除后提示失效 | E | routines 通过；分页大量历史未做原生翻页 |
| D07 / MSG-03 | 引用确切正文讨论，提出修改，生成新版本 | E | contact-experience 通过；原生读到旧版，但未完成原生修订提交 |
| D08 / MSG-03 | 交给独立联系人评审，回传意见，拒绝过期版本冲突 | E | contact-experience 通过；未用真实在线模型评估评论质量 |
| D09 / UI-04 | 收藏、续读、精确搜索版本，更新不替换正在读的内容 | E | portfolio 通过 |
| D10 / MSG-03 | 自定义成果视图、窄屏、视图失败时回退正文 | E | presentation 通过；脚本故意触发 CSP/坏视图错误属预期 |
| D11 / MSG-01/02 | 主动检查真实任务状态，只读汇报、不切走当前会话 | D+U | companion 诊断副本通过；原始脚本 T1 失败 |
| D12 / MSG-01 | 各类消息未读托盘闪烁、点击定位、读后停止 | 待测 | 本轮未逐类原生观察系统托盘；不能以消息入库代替闪烁验收 |
| D13 / MSG-04 | 新角色继承交流规则，空人设不冒用 ChouYu | E+U | 所测身份/来源契约通过；真实模型多轮语义待测 |

### 3.5 联系人工作设置、资料、权限与技能

| 编号 / 规范 | 操作场景与预期 | 方法 | 本轮结果 / 证据 |
| --- | --- | --- | --- |
| E01 / RUN-02 | 工作方式切换、节奏、工作时间、额度直接保存 | D+U | settings 诊断副本通过；原始脚本 T2 失败 |
| E02 / NL-04 | 设置保存失败保留输入，过期版本不覆盖 | D+E | 通过相应脚本样本 |
| E03 / RES-01 | 四种工具确认策略持久化且联系人隔离 | E+U | permissions 通过 |
| E04 / RES-01 | 关闭工具不能被自动执行策略绕过，失败入口可转设置再重试 | E | permissions 通过，含实际点击边界检查 |
| E05 / MSG-04 | 任务使用授权资料与记忆，引用固定来源版本 | E | contact-experience 通过 |
| E06 / MSG-04 | 更正/忘记联系人记忆，重启保留且旧缓存不恢复 | E+U | contacts/portfolio 中记忆专项通过 |
| E07 / MSG-04 | 后台工具产生文件，正文和来源持久化 | E | contact-experience 通过；非真实第三方技能运行 |
| E08 / SKILL-01/02/05 | 市场列表、安装、按联系人启停、取消与错误 | E+U | contacts 中模拟市场场景通过；真实网络下载未测 |
| E09 / SKILL-03/07 | 技能正文进入各模型请求、按轮计费、撤销权限 | U+E部分 | 模块与部分集成证据；全部角色/场景的真实模型链路待测 |
| E10 / SKILL-04/08 | 技能详情、深浅色、窄屏、Esc与鼠标边界 | E部分 | 有集成覆盖；本轮未逐控件原生复验，不作全面通过 |
| E11 / SKILL-06 | Docker Node/Python/Bash、依赖、无网隔离、超时和撤销 | 待测 | 本轮没有实际启动技能容器，不沿用历史记录冒充本轮执行 |
| E12 / SCOPE-01 | 删除联系人仅清理其任务/关联，不串其他联系人 | E+U | contacts 通过合成数据样本 |

以上共 58 个场景行，覆盖规范的全部验收 ID，但覆盖深度不同。一个场景行可能含多个断言；不能将“覆盖 ID”解释为全部断言已通过，更不能等同于 58 项原生操作全部完成。

## 4. 执行入口与证据

构建和类型检查通过。针对性模块测试为 **75 个文件通过、4 个跳过；605 条通过、18 条跳过**。跳过包含在线模型验收，不计通过。

```powershell
npm run build
npm run typecheck
npm test -- src/main/agents src/main/assistant-routines src/shared/contact src/shared/task-state.test.ts src/shared/task-request-log.test.ts src/renderer/src/components/Contacts src/renderer/src/components/ChatPanel/ChatPanel.layout.test.ts
```

日志分别为 `artifacts/contact-task-build-20261013.log`、`contact-task-typecheck-20261013.log`、`contact-task-unit-20261013.log`。

| 入口 | 结果 | `artifacts/` 日志 |
| --- | --- | --- |
| `node scripts/smoke-electron.js --assistant-routines` | 通过 | `contact-task-routines-20261013.log` |
| `node scripts/smoke-electron.js --contacts` | 通过 | `contact-task-contacts-20261013.log` |
| `CHOUYU_SMOKE_TASK_TOOLBAR_ONLY=1` + `--agents` | 通过 | `contact-task-toolbar-20261013.log` |
| `CHOUYU_SMOKE_PERMISSIONS_ONLY=1` + `--agents` | 通过 | `contact-task-permissions-20261013.log` |
| `CHOUYU_SMOKE_CHAT_CHANGE_ONLY=1` + `--agents` | 通过 | `contact-task-chat-edit-20261013.log` |
| `node scripts/smoke-electron.js --contact-experience` | 通过 | `contact-task-experience-20261013.log` |
| `CHOUYU_SMOKE_CONTACT_PORTFOLIO_ONLY=1` + `--contacts` | 通过 | `contact-task-portfolio-20261013.log` |
| `node scripts/smoke-electron.js --presentation` | 通过 | `contact-task-presentation-20261013.log` |
| `node scripts/smoke-electron.js --agents` | 三次均未完整通过，见 T3 | `contact-task-agents-20261013.log`、`contact-task-agents-repeat-20261013.log`、`contact-task-agents-final-20261013.log` |
| `node scripts/smoke-electron.js --companion` | 未通过，见 T1 | `contact-task-companion-20261013.log` |
| `node scripts/smoke-work-settings.cjs` | 未通过，见 T2 | `contact-task-work-settings-20261013.log` |
| 诊断副本 `diagnostic-tests.cjs --companion` | 通过诊断，未修正式测试 | `contact-task-companion-diagnostic-20261013.log` |
| 诊断副本 `diagnostic-tests.cjs --settings` | 通过诊断，未修正式测试 | `contact-task-settings-diagnostic-20261013.log` |

表中环境变量为简写，PowerShell 应设置 `$env:变量名='1'`，单独执行对应命令，结束后移除该变量；不可同时遗留多个 ONLY 开关。诊断入口位于证据根目录，不能作为正式回归的替代入口。

原生操作前后证据：

- [原生界面状态记录](../artifacts/contact-task-audit-20261013/native-actions.jsonl)
- [重启前持久化快照](../artifacts/contact-task-audit-20261013/persisted-evidence-before-restart.json)
- [重启后持久化快照](../artifacts/contact-task-audit-20261013/persisted-evidence-after-restart.json)
- [回复框聚焦截图](../artifacts/contact-task-audit-20261013/reply-focus-purple.png)
- [窄屏补问截图](../artifacts/contact-task-audit-20261013/routines/task-clarification-light-375.png)
- [窄屏保存后截图](../artifacts/contact-task-audit-20261013/routines/assistant-natural-saved-light-375.png)

截图已抽查，包含新建/补问、成果旧版、工作设置、排队及待处理场景；没有逐张人工审阅全部自动生成截图。

## 5. 后续验收顺序

1. 修复 F1 聚焦回归、F2 错误呈现，统一 F3 编辑文案；复测两个任务入口、鼠标和键盘聚焦、失败保留输入。
2. 修复 T1/T2 测试夹具，更新 T3 的稳定结果断言，单独定位任务卡片消失和阅读器导航；完整 agents 套件通过前不宣称全量回归通过。
3. 补做矩阵中的原生操作缺口，优先重试/取消/终止、执行中修改删除、并发调整、权限撤销、各类托盘闪烁。
4. 使用真实模型和真实技能环境补测自然语言组合、内容质量、技能下载及容器，并做跨夜/离线/睡眠唤醒的持续观察；单独记录模型用量和环境。

首次测试未修改产品实现或正式测试脚本。诊断工具和合成数据均留在 artifacts。上述待测项是尚未取得的验收证据，不是用户批准的产品例外。

## 6. 用户授权修复后的结果（2026-10-13）

F1、F2、F3 已修复，T1、T2、T3 的正式回归入口已修正。上文保留首次测试记录，不能将当时的失败与当前修复结果混为一谈。

| 问题 | 修复与验证 |
| --- | --- |
| F1 回复框聚焦 | 公共联系人表单的中性聚焦规则提高优先级，覆盖 body portal；未修改默认边框及按钮焦点。正式 toolbar 测试针对真实回复框强制 `focus-visible`，核对 outline/阴影为空、聚焦前后边框一致。修复前该检查失败，修复后通过。 |
| F2 错误提示 | 公共任务弹窗沿用已有联系人页面的处理方式，去掉 Electron IPC 异常包装，保留业务失败原因及原输入。正式 routines 测试检查“尚未保存”、无内部接口名，再继续补问、保存；修复前失败，修复后通过。 |
| F3 编辑文案 | 定时安排编辑统一显示“保存”；正式 routines 测试检查文案，并核对同一 ID、修改后的 09:00 和暂停状态。 |
| T1 主动检查 | 改为当前会话按钮的 title/选中态定位，正式 `--companion` 通过。 |
| T2 工作设置 | 补齐测试 preload 的成果阅读和作品集接口，转发给真实 AgentService；未使用空返回值掩盖服务问题。正式工作设置脚本通过。 |
| T3 交互夹具 | 新联系人创建后先完成 worker 身份同步，再直接写入测试 SQLite，避免旧身份快照清理刚注入的夹具。重试同时验证原互动已 resolved、原任务恰好新增一轮，不依赖瞬时“已排队”文案。 |
| T3 阅读器 | 失败现场显示已进入成果标签，但当前选中任务没有正文；脚本错误地期待后台研究切换用户阅读对象。现在先明确选择研究任务并核对选中 ID，再检查成果。保留产品“不擅自切走当前阅读任务”的行为。 |
| 其他脚本时序 | 定时补问后等待提交按钮实际可用；工具栏继续后等待新轮次落盘；余额卡检查当前业务提示和真实自动重试时间，技术诊断与正文分开检查。 |

修复后验证：

- `npm run build`、`npm run typecheck` 通过。
- `npm test` 全量执行：179 个文件通过、5 个跳过；**1474 条通过、20 条跳过**。
- 正式 `--agents` 连续两次通过；`--assistant-routines`、`--companion`、工具栏专项以及 `scripts/smoke-work-settings.cjs` 通过。第二次完整回归日志为 `artifacts/contact-task-fix-agents-confirm-20261013.log`。
- [聚焦修复后的真实任务界面截图](../artifacts/contact-task-fix-20261013/task-reply-neutral-focus.png) 已查看。此截图来自真实 Electron 界面，聚焦伪状态由测试固定以消除无头 Chromium 输入模式差异，不冒充额外一轮原生桌面操作。
- 独立只读代码审查未发现阻断问题；补充了聚焦前默认边框基线及定时编辑“保存”断言。

日志位于 `artifacts/contact-task-fix-{build,typecheck,unit,agents,routines,toolbar,companion,settings}-20261013.log`；修复前失败证据保留为 `contact-task-fix-routines-red-20261013.log` 和 `contact-task-fix-toolbar-red-20261013.log`。中间排查失败不计通过，以最后一次正式执行结果为准。

这次修复没有改变任务引擎、数据结构、单描述表单或用户真实数据，也未调用付费模型。第 3 节标注的真实模型、长期运行等待测项仍保留，不能因本次回归通过而改为已验收。
