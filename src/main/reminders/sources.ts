import { getCharacter, getReminderLocations, getState } from '../database'
import { contactAgentsCall } from '../agents'
import { taskReminderState, finishTaskReminder } from '../tasks'
import type { ReminderItem, ReminderSourceState } from '../../shared/reminder-followups'

export async function reminderSourceState(item: ReminderItem): Promise<ReminderSourceState> {
  if (!getCharacter(item.owner)) return { status: 'obsolete', reason: '联系人已删除' }
  const locations = getReminderLocations(item)
  if (!locations.length) return { status: 'obsolete', reason: '原消息或会话已清除' }
  const { sessionId, messageId } = locations.at(-1)!
  const location = { sessionId, messageId }
  const source = item.source
  if (source.kind === 'todo') return { ...taskReminderState(source.ref), location }
  if (source.kind === 'interaction' || source.kind === 'contact-task') return { ...await contactAgentsCall(item.owner, 'reminderSource', [source]), location }
  if (source.routineId) {
    const raw = getState('assistant-routines-v1')
    const routines = raw ? JSON.parse(raw) : []
    if (!Array.isArray(routines)) throw new Error('安排记录无法读取。')
    if (!routines.some(routine => routine.id === source.routineId)) return { status: 'obsolete', reason: '原安排已删除' }
  }
  return { status: 'pending', location }
}
export async function completeReminderTask(item: ReminderItem): Promise<void> {
  if (item.source.kind !== 'todo') throw new Error('此提醒不是待办任务。')
  await finishTaskReminder(item.source.ref)
}
