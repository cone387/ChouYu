import { createCharacter, getCharacter, getConfig, getState, setState, flushDatabase } from '../database'
import { DEFAULT_CHARACTER_ID, resolveCharacterConfig } from '../../shared/characters'
import { DEFAULT_AGENT_SETTINGS, type AgentOverview } from '../../shared/agents'

/** Explicit development experiment; never runs during an ordinary app startup. */
export async function setupIdeaLab(request: (method: string, id: string, args?: unknown[]) => Promise<AgentOverview>, sync: () => Promise<void>) {
  const key = 'idea-lab:v1'
  const saved = getState(key)
  const state: { producer?: string; reviewer?: string; until: number; started?: boolean } = saved ? JSON.parse(saved) : { until: Date.now() + 24 * 60 * 60 * 1000 }
  if (state.started) {
    await sync()
    for (const id of [state.producer, state.reviewer]) {
      if (!id || !getCharacter(id) || state.until <= Date.now()) continue
      let overview = await request('get', id)
      // Upgrade this explicitly launched experiment without resetting its deadline or budgets.
      if (id === state.producer && overview.settings.paceWriting) {
        overview = await request('savePreferences', id, [{ ...overview.settings, paceWriting: false }])
      }
      const topic = overview.topics.find(t => t.id === overview.focusTopicId)
      if (overview.settings.enabled && overview.runs[0]?.status === 'failed' && topic && ['planned', 'researching', 'needs_evidence'].includes(topic.status)) {
        await request('continueTopic', id, [topic.id, topic.revision, '更新实验执行逻辑后重试失败轮次，保留既有成果。'])
      }
    }
    return state
  }
  if (state.until <= Date.now()) throw new Error('之前的 Idea 实验已到期，请在联系人任务中查看结果。')
  const template = getCharacter('preset-copywriter-bi') || getCharacter(DEFAULT_CHARACTER_ID)!
  const resolved = resolveCharacterConfig(template, getConfig())
  if (!resolved.ok) throw new Error('请先配置阿笔或默认联系人的可用模型，再启动 Idea 实验。')
  const persist = () => { setState(key, JSON.stringify(state)); flushDatabase() }
  for (const [role, name, avatar, soulMd] of [
    ['producer', '阿想 · Idea 实验员', '💡', '你是务实的产品创意研究员，为小团队持续创作可验证的 AI 产品 idea。保留不确定性，避免重复，未经调研不声称已验证需求。'],
    ['reviewer', '阿衡 · Idea 评审员', '📏', '你是独立的产品评审员。自行制定清楚、一致的评价标准与权重，逐项给分、解释理由，区分主观判断与验证证据。不为凑高分而赞美。']
  ] as const) {
    if (state[role]) { if (!getCharacter(state[role]!)) throw new Error('实验联系人已删除，请手动重新建立实验。'); continue }
    state[role] = createCharacter({ name, avatar, category: 'tech', soulMd, providerProfileId: template.providerProfileId, model: resolved.config.model }).id
    persist()
  }
  await sync()
  for (const [id, review] of [[state.producer!, false], [state.reviewer!, true]] as const) {
    const overview = await request('get', id)
    // Recover interrupted setup without duplicating or resetting existing work.
    if (overview.topics.length) continue
    await request('savePreferences', id, [{ ...DEFAULT_AGENT_SETTINGS, goal: '24 小时 AI 产品 idea 生产与独立评审实验', intervalMinutes: 15,
      dailyCalls: review ? 400 : 240, enabled: false, paceWriting: review, shareDeliveries: !review, readContactDeliveries: review, notifyProgress: false }])
    const description = review
      ? '在本次24小时实验期间，持续寻找「阿想 · Idea 实验员」产出的 AI 产品 idea，并对尚未评价或正文已变化的内容进行独立评价。自己规划从哪里检索数据、读取哪些成果及版本，不根据标题或猜测评分。自行制定并说明稳定的评分维度、权重和总分算法，每个 idea 给出分项评分、总分、理由、主要风险及最小验证建议，引用实际读到的成果。没有新内容就等待，不重复评分。可以一次评价1–3个 idea。将每轮实质评价保存在成果正文中，不修改原作者成果。按15分钟间隔检查，任务预算由你按约96轮、每轮检索规划和分析所需调用估算，包含初始规划与重试，最多400次；不只为首个idea分配预算。普通判断可标为假设，不必反复询问用户。评价一个idea不等于整个持续任务完成。'
      : '在本次24小时实验期间，持续生产小团队可以实现的 AI 工具或产品 idea。每轮新增1个，包含目标用户、具体痛点、解决方案、与此前idea的差别、最小验证方法；未经验证的市场和需求判断标为假设，不编造调研。自己规划具体方向、阶段和资源，每轮正文只交付一个完整idea，使用独立分节ID和能体现差异的标题。结合已有成果去重，每8轮在当前idea正文末简短复盘最值得验证的3个方向。每轮完成后立即继续下一条，有新正文时不等待固定间隔；只有缺少必要信息或没有可推进内容时才等待。任务预算覆盖整个实验，每轮规划与写作约两次调用，包含接单和重试，最多240次；额度用尽时等待恢复，不只为第一批分配预算。缺少非关键偏好时做合理假设继续。产出第一批不等于整个持续任务完成。'
    await request('assignTopic', id, [description])
  }
  for (const id of [state.producer!, state.reviewer!]) {
    const overview = await request('get', id)
    // Saving preferences cancels live work; enable through the store before the first run instead.
    if (!overview.settings.enabled) await request('enableContinuous', id)
  }
  state.started = true; persist()
  return state
}
