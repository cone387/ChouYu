import { describe, expect, it } from 'vitest'
import { buildTasks, reconcileTaskIds, taskId } from './tasks'
import type { TaskOverride } from './tasks'
import type { JournalActivity, JournalSummary, JournalSummaryItem } from '../../shared/journal'

const activities: JournalActivity[] = [
  { id: 1, app: 'editor.exe', title: '修复登录', startedAt: 100, endedAt: 200 },
  { id: 2, app: 'browser.exe', title: '登录协议', startedAt: 300, endedAt: 400 },
  { id: 3, app: 'browser.exe', title: '午餐菜单', startedAt: 500, endedAt: 600 }
]
const item: JournalSummaryItem = { title: '修复登录流程', text: '检查代码与协议', sourceIds: ['activity:1', 'capture:frame'], kind: 'activity' }
const summary: JournalSummary = { from: 0, to: 1000, createdAt: 700, model: 'fixture', items: [item], sources: [], truncated: false }
const frames = [{ id: 'frame', activityId: 2, capturedAt: 350 }, { id: 'extra', activityId: 1, capturedAt: 150 }]

describe('journal task evidence and corrections', () => {
  it('connects cross-app sources, counts sampled duration without gaps, and retains uncovered activity', () => {
    const tasks = buildTasks(activities, frames, summary, [])
    expect(tasks).toHaveLength(2)
    expect(tasks.find(task => task.organized)).toMatchObject({ activityIds: [1, 2], captureIds: ['frame', 'extra'], durationMs: 200, startedAt: 100, endedAt: 400, apps: ['editor.exe', 'browser.exe'] })
    expect(tasks.find(task => !task.organized)).toMatchObject({ title: '午餐菜单', activityIds: [3] })
  })
  it('does not merge unrelated activities just because they use the same app', () => {
    expect(buildTasks(activities, frames, null, [])).toHaveLength(3)
  })
  it('keeps edits and original evidence when a summary is regenerated or invalidated', () => {
    const id = taskId(item)
    const edit: TaskOverride = { id, from: 0, to: 1000, item, title: '核对登录协议', category: '开发', note: '待补回归', }
    const regenerated = { ...summary, items: reconcileTaskIds([{ ...item, title: '模型改写的标题' }], [{ ...item, id }]) }
    for (const current of [regenerated, null]) {
      const task = buildTasks(activities, frames, current, [edit]).find(task => task.id === id)!
      expect(task).toMatchObject({ title: edit.title, note: edit.note, category: edit.category, edited: true, sourceIds: item.sourceIds })
      expect(activities[0].title).toBe('修复登录')
    }
  })
  it('does not transfer an edit to a different or ambiguous new task', () => {
    const old = { ...item, id: 'task:old' }
    expect(reconcileTaskIds([{ ...item, sourceIds: ['activity:3'] }], [old])[0].id).not.toBe(old.id)
    expect(reconcileTaskIds([item], [old, { ...old, id: 'task:other' }])[0].id).not.toBe(old.id)
  })
  it('drops missing sources and never inflates duration for repeated references', () => {
    const tasks = buildTasks(activities, frames, { ...summary, items: [{ ...item, sourceIds: ['activity:1', 'activity:1', 'capture:extra', 'activity:999'] }] }, [])
    expect(tasks.find(task => task.organized)).toMatchObject({ activityIds: [1], durationMs: 100 })
  })
})
