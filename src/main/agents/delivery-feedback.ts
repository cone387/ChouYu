import { containsSecret } from '../../shared/memory'
import type { ContactTaskStore } from '../task-center/contact-store'
import type { AgentOverview } from '../../shared/agents'
import type { RegisteredTool } from '../tools/registry'

export function saveDeliveryFeedback(store: ContactTaskStore, owner: string, topicId: string, revision: number, version: number, action: string, reason: string, conversation: string) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS contact_delivery_feedback (
    id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    action TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL)`)
  return store.db.transaction(() => {
    const topic = store.topics.get(owner, topicId), artifact = store.deliveries.get(topicId)
    if (topic.revision !== revision) throw new Error('任务已变化，请重新读取。')
    if (!Number.isSafeInteger(version) || !artifact || artifact.version !== version) throw new Error('成果版本已变化，请核对当前版本后再反馈。')
    if (!['accept', 'revise'].includes(action) || typeof reason !== 'string' || !reason.trim() || reason.length > 2000 || containsSecret(reason)) throw new Error('成果反馈无效。')
    if (action === 'revise') store.reviseCitation(owner, revision, { ref: { characterId: owner, topicId, version } }, reason, conversation)
    const row = store.db.prepare('INSERT INTO contact_delivery_feedback(character_id,topic_id,version,action,reason,at) VALUES(?,?,?,?,?,?)').run(owner, topicId, version, action, reason.trim(), Date.now())
    return { saved: true, feedbackId: Number(row.lastInsertRowid), topicId, version, action, workCompleted: false,
      message: action === 'accept' ? `已记录你对版本 ${version} 的认可，任务保持原状态。` : `已保存对版本 ${version} 的修改意见并提交修订，尚未产生新版。` }
  }).immediate()
}

export function createDeliveryFeedbackTools(access: { owner(sessionId?: string): string | undefined; request(method: string, owner: string, args?: unknown[]): Promise<any> }): RegisteredTool[] {
  return [{ name: 'submit_contact_delivery_feedback', displayName: '回应成果', source: 'builtin', risk: 'write', requiresConfirmation: true, alwaysConfirm: true,
    description: '认可或修订当前联系人的实际成果。先读取任务revision及最新deliveryVersion。accept仅记录对该版认可，不结束持续任务或恢复暂停任务；revise绑定该版按意见修订，不能把排队说成完成。可放在request_contact_action成果反馈卡中，修改意见用input.reason。',
    inputSchema: { type: 'object', properties: { topicId: { type: 'string' }, revision: { type: 'number' }, deliveryVersion: { type: 'number' }, action: { type: 'string', enum: ['accept', 'revise'] }, reason: { type: 'string' } }, required: ['topicId', 'revision', 'deliveryVersion', 'action', 'reason'], additionalProperties: false },
    async prepareAsync(args, context) {
      const owner = access.owner(context.sessionId)
      if (!owner) throw new Error('会话归属不存在。')
      const data = await access.request('get', owner) as AgentOverview, topic = data.topics.find(t => t.id === args.topicId)
      if (!topic || topic.revision !== args.revision) throw new Error('任务已变化，请重新读取。')
      const artifact = await access.request('delivery', owner, [topic.id])
      if (!artifact || artifact.version !== args.deliveryVersion) throw new Error('成果版本已变化，请重新读取。')
      if (!['accept', 'revise'].includes(String(args.action)) || typeof args.reason !== 'string' || !args.reason.trim() || args.reason.length > 2000 || containsSecret(args.reason)) throw new Error('成果反馈无效。')
      let consumed = false
      return { preview: `${topic.title} · 版本 ${artifact.version}\n${args.action === 'accept' ? '记录对此版的认可；任务保持原状态。' : '按意见修订此版；沿用原任务额度和权限。'}\n${args.reason}`, execute: async () => {
        if (consumed) throw new Error('反馈已执行，请重新读取。')
        consumed = true
        if (access.owner(context.sessionId) !== owner) throw new Error('会话归属已变化。')
        const result = await access.request('deliveryFeedback', owner, [topic.id, topic.revision, artifact.version, args.action, args.reason])
        if (result.saved !== true || result.topicId !== topic.id || result.version !== artifact.version || result.action !== args.action) throw new Error('未取得有效的成果反馈保存回执。')
        return { content: JSON.stringify(result), summary: result.message }
      } }
    }, execute() { throw new Error('请先准备成果反馈。') }
  }]
}
