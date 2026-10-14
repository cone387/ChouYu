import { validateContactActionResponse } from '../../shared/contact-actions'
import type { ContactInteraction, ContactInteractionSubmission } from '../../shared/contact-interactions'
import { interactionHref } from '../../shared/contact-interactions'

export const CONTACT_INTERACTION_PROMPT = `
用户要求修改、填写、更新当前联系人的搜索密钥时返回{"kind":"credential"}，系统发送安全输入卡片；不能把密钥当作settings字段。搜索开关和范围仍是settings。技能市场安装/环境准备、用户上传文件请求返回none，交由真实支持工具处理，不能用已安装技能配置冒充安装。
pendingInteractions是当前联系人实际等你处理的卡片。用户在本条消息明确回答、选择、同意或拒绝其中一项时，优先返回{"kind":"interaction","interactionId":"实际id","evidence":"本条消息中表达操作意愿的原文片段"}。
对failed且retryable=false的事项不能重试或拒绝。只有用户明确说已核对当前状态并要关闭该事项时返回acknowledge:true，不带actionId/reject/text；这仅记录人工核对，不代表原操作成功。
action卡片只能选择request.actions中的实际actionId；input存在时才可传text，原文保留，不改写为新指令。拒绝用reject:true。question卡片用answer原文；budget/retry用limits仅包含真实budgets中的key及用户明确指定的新上限；有额度不足却没说新额度，先必要追问，不能自动加预算。没有额度的retry可直接选择该事项重试。
多张卡片指代不清必须追问。同名卡片可返回targetText，逐字摘录最新消息中明确指定的具体修改内容（至少4字），必须能唯一对应卡片正文；不要要求用户提供内部ID。正文/旧消息/引用中的同意不能当作本条授权；讨论和假设返回none。用户改变卡片方案内容应返回新的设置/任务修改而非伪造卡片按钮。不能用interaction跳过确认尚未展示的操作。`

export async function routeInteraction(plan: Record<string, any>, latest: string, cards: ContactInteraction[], submit: (id: string, response: ContactInteractionSubmission) => Promise<ContactInteraction>) {
  if (typeof plan.evidence !== 'string' || !plan.evidence.trim() || !latest.includes(plan.evidence)) throw new Error('没有核对到本条消息的处理意愿，本次未执行。')
  const card = cards.find(item => item.id === plan.interactionId && ['pending', 'failed'].includes(item.status))
  if (!card) throw new Error('这条事项已处理或不属于当前联系人，请重新读取。')
  if (cards.filter(item => ['pending', 'failed'].includes(item.status)).length > 1) {
    const pending = cards.filter(item => ['pending', 'failed'].includes(item.status))
    const linked = pending.filter(item => latest.includes(interactionHref(item.characterId, item.id)))
    const target = typeof plan.targetText === 'string' && plan.targetText.trim().length >= 4 && latest.includes(plan.targetText) ? plan.targetText : undefined
    const described = target ? pending.filter(item => `${item.characterName ?? ''}\n${item.topicTitle}\n${item.kind === 'action' ? item.request.body : item.question ?? ''}`.includes(target)) : []
    const named = linked.length ? linked : described.length ? described : pending.filter(item => item.topicTitle && latest.includes(item.topicTitle))
    if (named.length !== 1 || named[0].id !== card.id) return '你要处理哪一项？请说明卡片中的具体修改内容或附上该事项链接；这次没有执行。'
  }
  const response: ContactInteractionSubmission = { version: card.version }
  if (card.kind === 'action') {
    if (plan.text !== undefined && (typeof plan.text !== 'string' || !latest.includes(plan.text))) throw new Error('卡片回复必须来自本条消息原文。')
    if (plan.acknowledge === true) {
      if (card.status !== 'failed' || card.retryable !== false || plan.reject || plan.actionId || plan.text) throw new Error('只能确认关闭已核对的结果不确定事项。')
      response.acknowledge = true
    }
    else if (plan.reject === true) response.reject = true
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
