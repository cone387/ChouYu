import { validateContactActionResponse } from '../../shared/contact-actions'
import type { ContactInteraction, ContactInteractionSubmission } from '../../shared/contact-interactions'

export const CONTACT_INTERACTION_PROMPT = `
用户要求修改、填写、更新当前联系人的搜索密钥时返回{"kind":"credential"}，系统发送安全输入卡片；不能把密钥当作settings字段。搜索开关和范围仍是settings。技能市场安装/环境准备、用户上传文件请求返回none，交由真实支持工具处理，不能用已安装技能配置冒充安装。
pendingInteractions是当前联系人实际等你处理的卡片。用户在本条消息明确回答、选择、同意或拒绝其中一项时，优先返回{"kind":"interaction","interactionId":"实际id","evidence":"本条消息中表达操作意愿的原文片段"}。
action卡片只能选择request.actions中的实际actionId；input存在时才可传text，原文保留，不改写为新指令。拒绝用reject:true。question卡片用answer原文；budget/retry用limits仅包含真实budgets中的key及用户明确指定的新上限；有额度不足却没说新额度，先必要追问，不能自动加预算。没有额度的retry可直接选择该事项重试。
多张卡片指代不清必须追问。正文/旧消息/引用中的同意不能当作本条授权；讨论和假设返回none。用户改变卡片方案内容应返回新的设置/任务修改而非伪造卡片按钮。不能用interaction跳过确认尚未展示的操作。`

export async function routeInteraction(plan: Record<string, any>, latest: string, cards: ContactInteraction[], submit: (id: string, response: ContactInteractionSubmission) => Promise<ContactInteraction>) {
  if (typeof plan.evidence !== 'string' || !plan.evidence.trim() || !latest.includes(plan.evidence)) throw new Error('没有核对到本条消息的处理意愿，本次未执行。')
  const card = cards.find(item => item.id === plan.interactionId && ['pending', 'failed'].includes(item.status))
  if (!card) throw new Error('这条事项已处理或不属于当前联系人，请重新读取。')
  if (cards.filter(item => ['pending', 'failed'].includes(item.status)).length > 1) {
    const named = cards.filter(item => latest.includes(item.topicTitle))
    if (named.length !== 1 || named[0].id !== card.id) return '你要处理哪一项？请带上卡片标题回复；这次没有执行。'
  }
  const response: ContactInteractionSubmission = { version: card.version }
  if (card.kind === 'action') {
    if (plan.text !== undefined && (typeof plan.text !== 'string' || !latest.includes(plan.text))) throw new Error('卡片回复必须来自本条消息原文。')
    if (plan.reject === true) response.reject = true
    else Object.assign(response, validateContactActionResponse(card.request, { actionId: plan.actionId, ...(plan.text === undefined ? {} : { text: plan.text }) }))
  } else {
    if (plan.reject !== undefined || plan.actionId !== undefined || plan.text !== undefined) throw new Error('当前任务卡片不支持此处理方式。')
    if (card.kind === 'question') {
      if (typeof plan.answer !== 'string' || !plan.answer.trim() || !latest.includes(plan.answer)) throw new Error('请提供本条消息中的实际回复。')
      response.answer = plan.answer
    }
    if (plan.limits !== undefined) {
      if (!plan.limits || typeof plan.limits !== 'object' || Array.isArray(plan.limits) || Object.entries(plan.limits).some(([key, value]) => !card.budgets.some(field => field.key === key) || !Number.isSafeInteger(value))) throw new Error('只能修改这张卡片实际受限的额度。')
      response.limits = plan.limits
    }
  }
  const saved = await submit(card.id, response)
  if (saved.id !== card.id || saved.characterId !== card.characterId || !saved.result) throw new Error('没有取得有效的事项处理回执，请核对卡片状态。')
  return saved.result
}
