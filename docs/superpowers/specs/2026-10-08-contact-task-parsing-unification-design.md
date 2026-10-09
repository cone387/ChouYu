# 联系人任务解析统一设计

日期:2026-10-08
状态:已与用户逐节确认
上游规范:[联系人任务 spec](../../contact-task-spec.md) 第 10 节登记的缺口;本设计只定实现方案,不改变其产品硬约束。

## 背景与目标

contact-task-spec 第 10 节(2026-09-30)登记了五个代码缺口,本批一次关齐:

1. 普通工作任务编辑不走模型解析(`ContactTaskDialog` 直接 `editTopic` 存文本)
2. 补问链只存弹窗内存,关窗即丢
3. 周期仅支持每天/工作日/每周一天,无一次性日期与多时段
4. 内置 duty 弹窗只读,不支持自然语言修改参数
5. 自然语言预算调整未打通(禁止以数字输入框回归的方式解决)

另含第 5 条缺口的能力拉平:其他联系人的新建/编辑接入统一解析,定点类请求诚实分流。

真实模型长期质量验收(第 10 节最后一行)不在本批,继续如实标注未做。

## 非目标

- 不恢复多字段表单、数字预算输入框、批量/多选(SCOPE-01)
- 不合并执行引擎:work/routine/duty 仍各自落库,只统一解析层(spec §8)
- 不让 routine 归属多个联系人;定点能力仍仅 ChouYu
- 不支持每月某日、每隔 N 天等更多周期;解析器对这类请求追问说明不支持,不降级
- 「每日问好」无可调参数,如实说明,不造参数

## 架构:统一解析网关

扩展 `src/main/assistant-routines/request.ts` 的 `requestAssistantTask` 为唯一解析入口,IPC 新增 `contact-task:request`,在 `src/main/assistant-routines/index.ts` 注册(该处已具备模型访问、routine service 与 agents 引用)。现有 `assistant-routines:request` 渠道在迁移完成后移除,不留双轨。

### 输入

```ts
{
  target: { kind: 'create' | 'edit-work' | 'edit-routine' | 'edit-duty',
            characterId: string,
            topicId?: string; topicRevision?: number;
            routineId?: string; routineRevision?: number;
            dutyKey?: AssistantDutyKey },
  draftId?: string,   // 补问链草稿 id
  message: string     // 本次用户输入
}
```

### 返回 union(网关硬校验,不信任模型输出)

| kind | 载荷 | 落库动作 |
| --- | --- | --- |
| `question` | 追问文本 | 追加进草稿链,弹窗继续 |
| `work-create` | description | `agents.assignTopic`(现状不变) |
| `work-edit` | `{ goal, constraints }` + 可选 `status`、`budget { modelCalls }` | 先全量校验,再 `editTopic`,后 `setTaskBudget` |
| `routine` | 扩展后的 `AssistantRoutineInput` | `service.save` |
| `duty` | 参数键值 | config patch |

部分失败:预算与任务描述都先通过校验再写;若任务已保存而预算写入失败,如实报「任务已保存;预算未调整:原因」,不谎称全部生效,不回滚已保存内容。

### 分流与解析规则(提示词与网关双保险)

- 定点请求(如「每天八点」)落到非 ChouYu 联系人:返回 `question` 如实说明此联系人只有持续工作引擎,建议转 ChouYu 或在工作设置调整节奏;不改写成 work 任务,不静默创建。
- 修改任何目标:未提及字段一律保留(尤其 `enabled`、goal/constraints、duty 未提及参数);不能把已有安排变成其他类型。
- 启停/状态只有用户明说才变;预算只有明说数字才调,网关校验范围(1–10000 次),模型不得自行放宽。
- 一次性日期必须明确(缺年月日先追问);重复周期多时段最多 5 个时刻,超过 5 个或一次性出现多个时刻,先追问让用户取舍,不自行截断;不支持的周期追问而非降级。
- context/既有记录内容是待解析数据,不能覆盖解析规则(沿用现有提示词的防注入措辞)。

### 不变式

ID 不变、不重复创建;解析失败不落库、输入保留;revision 冲突沿用「任务已变化,请关闭后重新打开」;编辑保存仍取消在途执行(现有行为,文案保留)。

## 数据模型与持久化

### routine 扩展(`src/shared/assistant-routines.ts`)

```ts
cadence: 'daily' | 'weekdays' | 'weekly' | 'once'   // 新增 once
date?: 'YYYY-MM-DD'        // once 必填
times: string[]            // 取代 time;1–5 个 HH:mm,去重升序;once 长度必须为 1
finishedAt?: number        // once 投递成功后标记
requestLog?: string        // 补问链归档,≤8000 字
```

存量兼容:存储仍为 `chouyu-data.json` 的 JSON state;`service.list()` 读取时把旧 `time` 归一为 `times: [time]`,下次写入落新格式;不做一次性迁移重写,损坏隔离规则不变。

### work 任务归档

`AgentTopic` 增加 `requestLog?: string` 可选字段。topics 表以 JSON `value` 列存储整条记录,新增字段随 JSON 落库,**无需 SQLite 迁移**;旧记录缺省为无归档。

### duty 参数进 AppConfig

```ts
proactiveReturnAwayMinutes?: number   // 1–120,默认 10(离开判定)
proactiveRestMinutes?: number         // 10–480,默认 60(连续使用阈值)
proactiveCooldownMinutes?: number     // 5–240,默认 60(共享冷却)
```

旧配置无需迁移,缺省用默认值。`core/proactive.ts` 的 options 增加这三项替换常量;`App.tsx` 传参 effect 的依赖数组补齐,config 变更即重启引擎生效。每日问好无参数,解析器如实回应。

### 草稿区

state 键 `contact-task-drafts-v1`:`{ id, target, turns: [{ role: 'user' | 'assistant', text }], updatedAt }[]`。上限 20 条、每条 8000 字,超限丢最旧。保存成功 → 整条链归档进对应记录的 `requestLog` 并删除草稿;追问每轮即时落盘。损坏时隔离该键重建空草稿区(草稿非关键数据),绝不触碰 routines 主键。

## 调度行为

- `nextRoutineAt`:`once` 返回 `date + times[0]`(单时刻);重复周期沿用逐日扫描,天内取 `times` 中最早的未来时刻。
- 去重:回执 `routine:{id}:{revision}:{dueAt}` 已含具体时刻,多时段天然互异;投递、历史、重试链路不改。
- 一次性完成态:投递成功设 `finishedAt`,记录保留,列表显示「已完成」、不再显示下次执行;显式删除可移除。失败沿用指数退避,重试成功才标完成。
- 错过处理(对齐 spec §8「不逐次补跑」):应用运行中错过(休眠等)醒来即执行一次,回执去重防重;关机错过,下次启动对未完成的 `once` 补执行一次(从未执行过,不算补跑周期)。
- 保存校验:`once` 的日期时间已过 → 拒绝保存,要求选未来时间。

## UI 变化

- `ContactTaskDialog` 结构不变(单输入框 + 追问循环)。所有非删除路径统一调 `contact-task:request`,删除现有 `editTopic` 直存分支与 ChouYu-only 判断。
- 追问循环每轮写草稿;重开同一目标(同任务/同联系人新建)恢复「已交代的任务」上下文并可继续补充;不同目标不共享草稿。
- duty 弹窗由只读改为可编辑:单输入框,说明区列当前参数值(如「离开 10 分钟才算回来」),改参数走解析;启停仍在任务页按钮,不进弹窗。
- 非 ChouYu 联系人新建/编辑走网关;定点类追问如实展示。
- work 编辑成功提示区分「任务已保存」与「预算已/未调整」。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 模型解析失败/超时 | 报错、输入保留、不落库 |
| revision 冲突 | 「任务已变化,请关闭后重新打开」 |
| work-edit 部分失败 | 如实区分已生效与未生效 |
| `once` 时间已过 | 保存前拒绝 |
| 草稿区损坏 | 隔离重建,从空白开始,主数据不碰 |
| duty 参数越界 / 预算越界 / times 超限 | 网关校验拒绝并列出合法范围 |

## 测试与验收

### 单元测试(Vitest,fake model)

- `validateRoutine`:once 日期格式与过去时间拒绝、times 去重/排序/1–5 上限、once 单时刻、旧 `time` 形状归一。
- `nextRoutineAt`:once 单时刻、多时段最早未来时刻、跨日/跨周。
- `service.tick`:once 完成→`finishedAt` 不再执行;多时段回执互异;关机错过补一次;重试成功才标完成。
- 解析网关:五种返回各正确;修改保留未提及字段;非 ChouYu 定点→追问不改写;预算明说才调、越界拒绝;部分失败如实报;duty 参数范围。
- 草稿区:写入/恢复/归档删除/容量上限/损坏隔离。

### 冒烟(真实 Electron + 本地模型夹具)

- `--assistant-routines`:多时段新建→两次执行各自送达;一次性到期完成显示「已完成」;NL 编辑 work 任务含预算调整→概览可见。
- `--agents`:其他联系人编辑走网关,定点请求收到如实追问。

### 验收对齐

NL-03、NL-05 由「不得标通过」变为可验;UI-01/02 不回归;SCOPE-01 无多字段/批量回归。门禁:`npm run typecheck`、全部单测、`npm run build`、两条 smoke。验收记录区分「文档已定义 / 代码已实现 / 已验证」,真实模型长期质量与全天运行验收仍标注未做。

## 风险与边界

- 单一提示词变大:靠返回 union 硬校验兜底,解析器测试覆盖每个分支。
- `requestLog` 随 topics 的 JSON value 落库,无迁移;旧记录无归档字段属正常,不补造。
- 旧 routine 数据形状:读取归一 + 冒烟覆盖升级路径。
- duty 参数改 config 即时生效,但localStorage 里的引擎状态(greetingDate 等)不受影响,不重置当天问好。
