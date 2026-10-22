import { contactCommandDispatcher, type UnknownContactDispatch } from '../task-center/command-boundary'
import type { AgentOverview, AgentRunDetail } from '../../shared/agents'
import { TOPIC_STATUS } from '../../shared/agents'
import { ASSISTANT_CHARACTER_ID } from '../../shared/characters'
import { containsSecret } from '../../shared/memory'
import type { PreparedTool, RegisteredTool, ToolExecutionContext } from '../tools/registry'
import { pendingContinuation } from './continuation'
import { contactWorkSettingProperties, validateContactWorkSettingsPatch, applyContactWorkSettingsPatch, describeContactWorkSettingsPatch } from '../../shared/contact-work-settings'
import { validateCalendarSchedule, calendarScheduleLabel } from '../../shared/calendar-schedule'

interface Access {
  owner(sessionId?: string): string | undefined
  dispatchUnknown: UnknownContactDispatch
}
export function createContactTools(access: Access): RegisteredTool[] {
  const request = contactCommandDispatcher(access.dispatchUnknown)
  const owner = (context: ToolExecutionContext) => {
    const id = access.owner(context.sessionId)
    if (!id || id === ASSISTANT_CHARACTER_ID) throw new Error('请在具体联系人的聊天中操作其事项。')
    return id
  }
  const common = { source: 'builtin' as const, risk: 'write' as const, requiresConfirmation: true, alwaysConfirm: true }
  const prepare = async (args: Record<string, unknown>, context: ToolExecutionContext, answer: boolean): Promise<PreparedTool> => {
    const id = owner(context), topicId = String(args.topicId), revision = args.revision as number
    const overview = await request('get', id) as AgentOverview
    const topic = overview.topics.find(t => t.id === topicId)
    if (!topic || !Number.isInteger(revision) || topic.revision !== revision) throw new Error('事项已变化，请重新读取后再确认。')
    let method: string, values: unknown[], preview: string
    if (answer) {
      const detail = await request('detail', id, [args.runId]) as AgentRunDetail
      if (detail.run.topicId !== topicId || detail.run.status !== 'waiting') throw new Error('这项工作已不在等待回复。')
      const text = String(args.answer || '').trim()
      if (!text || containsSecret(text)) throw new Error('回复不能为空或包含密钥。')
      method = 'answerChecked'; values = [topicId, revision, detail.run.id, text]
      preview = `事项：${topic.title}\n待确认：${detail.run.question}\n你的回复：${text}\n确认后从本轮检查点继续。`
    } else {
      const reason = String(args.reason || '').trim()
      if (!reason || containsSecret(reason)) throw new Error('请说明调整原因，不要包含密钥。')
      if (args.action === 'pause') {
        method = 'topicStatus'; values = [topicId, revision, 'paused', reason]
        preview = `事项：${topic.title}\n状态：${TOPIC_STATUS[topic.status]} → 已暂停\n停止此事项未完成的工作。\n原因：${reason}`
      } else if (args.action === 'end' || args.action === 'abandon') {
        const status = args.action === 'end' ? 'completed' : 'abandoned'
        method = 'topicStatus'; values = [topicId, revision, status, reason]
        preview = `事项：${topic.title}\n状态：${TOPIC_STATUS[topic.status]} → ${TOPIC_STATUS[status]}\n停止此任务，保留全部已保存成果与历史；这不代表成果已通过验收。\n要求：${reason}`
      } else if (args.action === 'delete') {
        method = 'deleteTopic'; values = [topicId, revision]
        preview = `删除任务：${topic.title}\n将删除此任务及其成果、执行历史和任务关联记录，停止后续执行；聊天中已发送的消息保留，其来源可能失效。不能撤销。\n要求：${reason}`
      } else if (args.action === 'continue') {
        const pending = pendingContinuation(overview, topicId)
        if (pending) {
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
          const result = { content: JSON.stringify({ pending: true, workCompleted: false, message: pending }), summary: pending }
          return { noOpResult: result, execute: () => {
            if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
            return result
          } }
        }
        method = 'continueTopic'; values = [topicId, revision, reason]
        preview = `事项：${topic.title}\n${topic.calendar ? `恢复日历安排：${calendarScheduleLabel(topic.calendar)}；到期后按工作时间和额度执行。` : '安排本事项执行一轮，有空余名额时开始。'}\n持续工作：${overview.settings.enabled ? '保持开启' : '保持关闭'}\n按现有来源与调用预算执行。\n原因：${reason}`
      } else if (args.action === 'revise') {
        method = 'reviseTopic'; values = [topicId, revision, reason]
        preview = `事项：${topic.title}\n修改意见：${reason}\n按原额度立即修订一轮，保留旧成果版本；不自动开启持续工作。`
      } else if (args.action === 'constraints') {
        if (typeof args.constraints !== 'string' || containsSecret(args.constraints)) throw new Error('请提供完整的新约束，不要包含密钥。')
        method = 'editTopic'; values = [topicId, revision, { title: topic.title, goal: topic.goal, constraints: args.constraints }, reason]
        preview = `事项：${topic.title}\n原约束：${topic.constraints || '无'}\n新约束：${args.constraints || '无'}\n本事项未完成的轮次会停止，后续按新约束工作。\n原因：${reason}`
      } else throw new Error('任务操作无效。')
    }
    let consumed = false
    return { preview, ...(args.action === 'delete' ? { confirmationRequired: true } : {}), execute: async () => {
      if (consumed) throw new Error('此操作已执行，请重新发起。')
      consumed = true
      if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
      // The worker checks the captured revision atomically with the mutation.
      const result = await request('feedback', id, [overview.revision, method, values]) as AgentOverview
      if (args.action === 'delete') {
        if (result.topics.some(topic => topic.id === topicId)) throw new Error('未能确认任务已删除。')
        return { content: JSON.stringify({ saved: true, deleted: true, message: '已删除这项任务及其成果和执行历史。', workCompleted: false }), summary: '已删除任务' }
      }
      if (args.action === 'end' || args.action === 'abandon') {
        const status = args.action === 'end' ? 'completed' : 'abandoned'
        if (result.topics.find(topic => topic.id === topicId)?.status !== status) throw new Error('未能确认任务状态已保存。')
        const message = `${TOPIC_STATUS[status]}这项任务，已有成果与历史保留。`
        return { content: JSON.stringify({ saved: true, status, message, workCompleted: false }), summary: message }
      }
      if (args.action === 'continue' && topic.calendar) {
        const message = `已恢复「${topic.title}」的日历安排。${result.settings.enabled ? '到期后按工作时间和额度执行，尚未产生本期成果。' : '联系人自动工作仍未开启，启用后才会按日历执行。'}`
        return { content: JSON.stringify({ saved: true, message, workCompleted: false }), summary: message }
      }
      return { content: JSON.stringify({ message: `请求已受理。${preview}`, workCompleted: false, run: result.runs?.find(r => r.topicId === topicId), instruction: '继续或修订仅代表已排入执行，成果是否完成须重新读取实际保存版本。' }), summary: answer ? '已回复，继续本轮工作' : '已提交事项调整' }
    } }
  }
  const topicProperties = {
    topicId: { type: 'string' as const, description: '从 get_contact_topics 获取的事项 ID', maxLength: 128 },
    revision: { type: 'number' as const, description: '当前事项 revision，禁止猜测' }
  }
  return [
    { ...common, name: 'get_contact_topics', displayName: '读取联系人事项', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '读取当前聊天联系人的真实事项及待回复问题。只能操作当前联系人，用户指代不明确时先询问；更新前必须读取版本。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async execute(_args, context) {
        const data = await request('get', owner(context)) as AgentOverview
        return { content: JSON.stringify({ revision: data.revision, topics: data.topics, focusTopicId: data.focusTopicId, pending: data.runs.filter(r => ['waiting', 'queued', 'running', 'interrupted'].includes(r.status)), settings: data.settings }), summary: `已读取 ${data.topics.length} 个事项与工作设置` }
      } },
    { ...common, name: 'update_contact_topic', displayName: '调整联系人事项',
      description: '用户明确要求时继续、暂停、结束、放弃、删除、修改事项约束，或修订成果。结束/放弃保留成果与历史，删除移除该任务成果与历史。reason保留用户原话，先读取版本，展示范围并确认后执行。不修改个人待办。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        action: { type: 'string', description: 'continue（继续）、pause（暂停）、end（结束保留成果）、abandon（放弃保留成果）、delete（删除任务及成果历史）、constraints（替换约束）、revise（修订成果）', maxLength: 20 },
        constraints: { type: 'string', description: 'constraints 操作时必填，完整新约束；空串表示移除约束', maxLength: 2000 },
        reason: { type: 'string', description: '用户要求的调整原因', maxLength: 2000 }
      }, required: ['topicId', 'revision', 'action', 'reason'], additionalProperties: false },
      prepareAsync: (args, context) => prepare(args, context, false), execute: () => { throw new Error('必须先预览确认。') } },
    { ...common, name: 'answer_contact_question', displayName: '回复联系人待确认问题',
      description: '将用户的明确答复交给当前联系人正在等待的事项，先读取待确认问题与版本，展示答复并确认后继续工作。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        runId: { type: 'string', description: '正在 waiting 的轮次 ID', maxLength: 128 },
        answer: { type: 'string', description: '用户对该问题的明确答复', maxLength: 2000 }
      }, required: ['topicId', 'revision', 'runId', 'answer'], additionalProperties: false },
      prepareAsync: (args, context) => prepare(args, context, true), execute: () => { throw new Error('必须先预览确认。') } },
    { source: 'builtin', risk: 'write', requiresConfirmation: false, alwaysConfirm: false,
      name: 'assign_contact_task', displayName: '接下联系人任务',
      description: '用户明确把一项需要执行、研究或持续跟进的任务交给当前联系人时使用。普通问答、讨论想法、引用他人话语不创建任务。保留原始描述；明确指定钟点/日历周期必须填写schedule保存真实安排，不得仅写进description后立即执行；时间或起点不明确先询问。不写入个人待办。已有事项的回复或调整使用对应工具。',
      inputSchema: { type: 'object', properties: { description: { type: 'string', description: '用户交付的单个任务，保留目标和明确约束，不自行添加要求', maxLength: 2000 },
        schedule: { type: 'string', description: '仅用户指定日历时间时填写JSON：times=[HH:mm]，cadence=daily/weekdays/weekly/once/monthly/interval；weekly附weekday(0–6)，once附date且只1个时刻，monthly附monthDay(1–31或last)，interval附intervalDays和anchorDate(YYYY-MM-DD)。最多5个时刻，缺必要信息先询问。' }
      }, required: ['description'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), description = typeof args.description === 'string' ? args.description.trim() : ''
        if (!description || description.length > 2000 || containsSecret(description)) throw new Error('请提供有效的任务描述，不要包含密钥。')
        const schedule = args.schedule === undefined ? undefined : validateCalendarSchedule(JSON.parse(String(args.schedule)))
        const overview = await request('get', id) as AgentOverview
        let consumed = false
        return { preview: `交给当前联系人：${description}\n按联系人的权限与额度执行；忙碌或今日额度不足时先排队，当前任务完成或等待回复时接续。`, execute: async () => {
          if (consumed) throw new Error('此任务已经提交，请勿重复创建。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新发起。')
          const result = await request('feedback', id, [overview.revision, schedule ? 'assignCalendarTopic' : 'assignTopic', schedule ? [{ ...schedule, title: description.slice(0, 100), instruction: description, kind: 'contact-summary', enabled: true }, `用户：${description}`] : [description]]) as AgentOverview
          const topic = result.topics.find(topic => !overview.topics.some(previous => previous.id === topic.id))
          if (schedule) {
            if (!topic?.calendar || !result.taskSchedule?.[topic.id]) throw new Error('未能确认日历安排已保存。')
            const message = `已保存安排：${calendarScheduleLabel(topic.calendar)}。${result.settings.enabled ? '到期由我按工作时间和额度执行，尚未开始本轮工作。' : '当前自动工作未开启，启用后才会按安排执行。'}`
            return { content: JSON.stringify({ saved: true, topicId: topic.id, message, nextAt: result.taskSchedule[topic.id].nextAt, workCompleted: false }), summary: '已保存联系人定时任务' }
          }
          const queued = Boolean(topic && result.queuedTopicIds?.includes(topic.id))
          return { content: JSON.stringify({ message: queued ? '任务已接下并排队，尚未开始执行。不要再次创建。' : '任务已接下，已安排整理方向。不要再次创建，也不要声称研究已经完成。', topicId: topic?.id, queued, run: result.runs.find(run => run.topicId === topic?.id) }), summary: queued ? '已接下任务，排队等待执行' : '已接下任务，已安排执行' }
        } }
      }, execute: () => { throw new Error('请先准备任务。') }
    },
    { source: 'builtin', risk: 'write', requiresConfirmation: false, alwaysConfirm: false,
      name: 'edit_contact_task', displayName: '保存任务新要求',
      description: '用户明确调整现有任务的目标、范围、长期要求、汇报方式、标题或任务额度时使用。先读取真实任务。仅传用户要求修改的字段，goal/constraints 是该字段的完整新内容，保留未撤销的要求。汇报数量不是研究数量，不能擅自改工作批次。不用于一次性正文或样式修订；联系人级设置使用edit_contact_work_settings，定点时间不能冒充普通约束。保存成功才可答应以后照做。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        reason: { type: 'string', description: '用户本次修改的原话', maxLength: 2000 },
        separateEvaluations: { type: 'boolean', description: '用户要求每条只汇报一个评价时为true，明确恢复合并汇报时false；不改变研究批次' },
        goal: { type: 'string', description: '需要修改时提供完整新目标', maxLength: 2000 },
        constraints: { type: 'string', description: '需要修改时提供完整新约束，保留已有未撤销要求；空串仅用于明确清除', maxLength: 2000 },
        title: { type: 'string', description: '仅明确改名时填写', maxLength: 100 },
        modelCalls: { type: 'number', description: '仅用户明确指定的任务累计调用上限，不是每日额度' },
        tokens: { type: 'number', description: '仅用户明确指定的任务累计 Token 上限，不是每日额度' },
        clearTokenLimit: { type: 'boolean', description: '用户明确取消本任务Token上限时为true，不能同时填写tokens；不清除调用次数保护' }
      }, required: ['topicId', 'revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), data = await request('get', id) as AgentOverview
        const topic = data.topics.find(t => t.id === args.topicId)
        if (!topic || topic.revision !== args.revision) throw new Error('任务已变化，请重新读取。')
        if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2000 || containsSecret(args.reason)) throw new Error('修改要求无效。')
        const patch = Object.fromEntries(['goal', 'constraints', 'title', 'modelCalls', 'tokens', 'separateEvaluations', 'clearTokenLimit'].filter(k => args[k] !== undefined).map(k => [k, args[k]]))
        if (!Object.keys(patch).length || containsSecret(JSON.stringify(patch))) throw new Error('没有有效修改。')
        let consumed = false
        return { preview: `任务：${topic.title}\n修改要求：${args.reason}\n旧轮次会停止；已保存成果保留，暂停状态不会自动恢复。`, execute: async () => {
          if (consumed) throw new Error('本次修改已提交，请勿重复执行。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化。')
          const result = await request('feedback', id, [data.revision, 'editTaskFromChat', [topic.id, topic.revision, patch, args.reason]]) as AgentOverview
          const saved = result.topics.find(t => t.id === topic.id)
          if (!saved) throw new Error('没有读取到保存后的任务。')
          return { content: JSON.stringify({ saved: true, workCompleted: false, topic: saved, message: `已保存「${saved.title}」的新要求。${['paused', 'completed', 'abandoned'].includes(saved.status) ? `任务仍为${TOPIC_STATUS[saved.status]}。` : '后续按新要求执行。'}已有成果保留。` }), summary: '任务新要求已保存' }
        } }
      }, execute: () => { throw new Error('请先准备任务修改。') }
    },
    { ...common, name: 'set_contact_schedule', displayName: '保存任务日历安排',
      description: '为当前联系人的现有任务保存或修改真实日历安排。保留目标、约束与暂停/结束状态。必须先读取任务版本；不能仅在普通任务描述中写时间冒充保存。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        schedule: { type: 'string', description: 'JSON字符串：times为1–5个HH:mm，cadence为daily/weekdays/weekly/once/monthly/interval；weekly须weekday(0–6)，once须date且仅一个时刻，monthly须monthDay(1–31或last)，interval须intervalDays和anchorDate。日期YYYY-MM-DD，缺必要信息先询问。' },
        reason: { type: 'string', maxLength: 2000, description: '本次用户原话' }
      }, required: ['topicId', 'revision', 'schedule', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), data = await request('get', id) as AgentOverview
        const topic = data.topics.find(t => t.id === args.topicId)
        if (!topic || topic.revision !== args.revision) throw new Error('任务已变化，请重新读取。')
        if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2000 || containsSecret(args.reason)) throw new Error('安排修改要求无效。')
        const rule = validateCalendarSchedule(JSON.parse(String(args.schedule)))
        const input = { ...rule, title: topic.title, instruction: topic.goal, enabled: !['paused', 'completed', 'abandoned'].includes(topic.status), kind: 'contact-summary' }
        let consumed = false
        return { preview: `任务：${topic.title}\n安排：${calendarScheduleLabel(rule)}\n由本联系人到期执行，仍受工作时间和额度限制；暂停/结束不会自动恢复。`, execute: async () => {
          if (consumed) throw new Error('此安排已经提交。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化。')
          const result = await request('feedback', id, [data.revision, 'editCalendarTopic', [topic.id, topic.revision, input, args.reason]]) as AgentOverview
          const saved = result.topics.find(t => t.id === topic.id)
          if (!saved?.calendar || saved.revision <= topic.revision) throw new Error('没有读取到保存后的安排。')
          const nextAt = result.taskSchedule?.[topic.id]?.nextAt
          const message = `已保存「${saved.title}」的安排：${calendarScheduleLabel(saved.calendar)}。${['paused', 'completed', 'abandoned'].includes(saved.status) ? `任务仍为${TOPIC_STATUS[saved.status]}。` : `下次计划时间：${new Date(nextAt!).toLocaleString()}；仍受工作时间和额度限制。`}`
          return { content: JSON.stringify({ saved: true, topic: saved, nextAt, message, workCompleted: false }), summary: '已保存任务日历安排' }
        } }
      }, execute: () => { throw new Error('请先准备日历安排。') }
    },
    { ...common, name: 'get_contact_delivery', displayName: '读取自己的正式成果', risk: 'read', requiresConfirmation: false, alwaysConfirm: false,
      description: '读取当前聊天联系人的已保存成果目录、真实版本、需求与展示代码。核实完成进度或改排版前使用；需要实际正文时指定目录中的 sectionId。聊天草稿不计为已保存成果。',
      inputSchema: { type: 'object', properties: {
        topicId: topicProperties.topicId,
        version: { type: 'number', description: '可选历史成果版本，省略读取最新版本' },
        sectionId: { type: 'string', description: '可选，读取目录中一个分节的完整正文', maxLength: 64 }
      }, required: ['topicId'], additionalProperties: false },
      async execute(args, context) {
        const id = owner(context)
        const value = await request('inspectDelivery', id, [args.topicId, args.version, args.sectionId])
        return { content: JSON.stringify(value), summary: '已读取正式成果与展示样式' }
      } },
    { ...common, name: 'edit_contact_work_settings', displayName: '修改联系人工作设置',
      description: '保存当前联系人的工作方向、工作方式、每日时间、节奏、并发、额度、进展通知、网页范围、搜索、成果共享及工具确认策略。只传用户明确修改的字段，权限变更须有明确要求，不修改其他联系人；保存成功才回复已生效。新任务默认Token上限不影响已有任务。网页范围变更会停止旧权限下未完成轮次；确认策略不批准已等待的请求。',
      inputSchema: { type: 'object', properties: { ...contactWorkSettingProperties,
        revision: { type: 'number', description: '当前联系人工作设置的revision，先读取不能猜测' },
        reason: { type: 'string', description: '用户本次修改原话', maxLength: 2000 }
      }, required: ['revision', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), data = await request('get', id) as AgentOverview
        if (!Number.isSafeInteger(args.revision) || args.revision !== data.revision) throw new Error('工作设置已变化，请重新读取。')
        if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2000 || containsSecret(args.reason)) throw new Error('工作设置修改要求无效。')
        const { revision: _revision, reason, ...fields } = args
        const patch = validateContactWorkSettingsPatch(fields)
        applyContactWorkSettingsPatch(data.settings, patch)
        const description = describeContactWorkSettingsPatch(patch)
        let consumed = false
        return { preview: `${description}\n未提及设置保持不变；不会恢复已暂停或结束的任务。\n你的要求：${reason}`, execute: async () => {
          if (consumed) throw new Error('此修改已执行，请重新发起。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新确认。')
          const saved = await request('editWorkSettingsFromChat', id, [data.revision, patch, reason]) as AgentOverview
          return { content: JSON.stringify({ saved: true, revision: saved.revision, message: `已保存工作设置：${description}。`, workCompleted: false }), summary: `已保存：${description}` }
        } }
      }, execute: () => { throw new Error('请先预览工作设置修改。') } },
    { ...common, name: 'revise_contact_presentation', displayName: '修改成果展示样式',
      description: '你能修改自己的成果排版。用户要求改阅读样式、字体、目录布局或跟随系统亮色时使用。先读取 get_contact_topics 和 get_contact_delivery；仅修改展示代码，程序保证正文、需求与任务进度不变。返回只代表开始修订，不能说已经改好。',
      inputSchema: { type: 'object', properties: { ...topicProperties,
        deliveryVersion: { type: 'number', description: '刚读取的最新成果版本，不可猜测' },
        reason: { type: 'string', description: '完整的展示修改要求，保留用户偏好', maxLength: 2000 }
      }, required: ['topicId', 'revision', 'deliveryVersion', 'reason'], additionalProperties: false },
      async prepareAsync(args, context) {
        const id = owner(context), data = await request('get', id) as AgentOverview
        const topic = data.topics.find(t => t.id === args.topicId)
        if (!topic || topic.revision !== args.revision) throw new Error('事项已变化，请重新读取。')
        if (data.runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status) && r.topicId === topic.id)) throw new Error('当前还有工作未完成，请等待本轮结束；本任务待回复的问题需要先处理。')
        const artifact = await request('delivery', id, [topic.id])
        if (!artifact || !Number.isSafeInteger(args.deliveryVersion) || artifact.version !== args.deliveryVersion) throw new Error('成果版本已变化或尚未交付，请重新读取。')
        if (typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2000 || containsSecret(args.reason)) throw new Error('请填写有效的样式修改要求。')
        const reason = args.reason.trim(), version = artifact.version, revision = topic.revision
        let consumed = false
        return { preview: `成果：${topic.title} · 版本 ${version}\n展示修改：${reason}\n只更新阅读样式，正文、需求、阶段与任务状态保持不变，保留旧版本。`, execute: async () => {
          if (consumed) throw new Error('此修改已提交，请勿重复执行。')
          consumed = true
          if (owner(context) !== id) throw new Error('聊天归属已变化，请重新发起。')
          const result = await request('feedback', id, [data.revision, 'reviseTopic', [topic.id, revision, reason, undefined, 'presentation', version]]) as AgentOverview
          return { content: JSON.stringify({ requestAccepted: true, workCompleted: false, baseVersion: version, run: result.runs?.find(r => r.topicId === topic.id), message: '样式修订已提交。尚未保存新版本，不能声称已改好；后续读取实际成果核实。' }), summary: '已提交样式修订，正文保持不变' }
        } }
      }, execute: () => { throw new Error('请先预览样式修改。') } }
  ]
}
