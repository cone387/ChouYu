const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')

// tasks.sql was exported from TasksStore at tag v1.3.4, schema 7.
// The JSON uses that release's version 4 session format; no real user data.
function seed(directory, legacy) {
  const active = { id: 'upgrade-active', title: '迁移测试对话', characterId: 'chouyu',
    createdAt: 1, updatedAt: 2, lastReadAt: 2, messages: legacy.messages }
  const unread = { id: 'upgrade-unread', title: 'Legacy unread', characterId: 'chouyu',
    createdAt: 1, updatedAt: 3, lastReadAt: 1,
    messages: [{ id: 'upgrade-message', role: 'assistant', content: 'Saved unread body', timestamp: 3 }] }
  const snapshot = { version: 4, config: legacy.config, characters: [], sessions: [active, unread],
    activeSessionId: active.id, state: { ...legacy.state, 'upgrade-saved-receipt': 'delivered' } }
  fs.writeFileSync(path.join(directory, 'chouyu-data.json'), JSON.stringify(snapshot))
  const db = new DatabaseSync(path.join(directory, 'tasks.db'))
  try { db.exec(fs.readFileSync(path.join(__dirname, '../tests/fixtures/upgrade-v1.3.4-tasks.sql'), 'utf8')) }
  finally { db.close() }
}

function verify(directory) {
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'chouyu-data.json.legacy'), 'utf8'))
  assert.equal(original.version, 4)
  const db = new DatabaseSync(path.join(directory, 'chouyu-application.db'), { readOnly: true })
  try {
    const session = JSON.parse(db.prepare('SELECT value FROM sessions WHERE id=?').get('upgrade-unread').value)
    assert.equal(session.lastReadAt, 1, 'unread boundary must survive migration')
    const message = JSON.parse(db.prepare('SELECT value FROM messages WHERE session_id=?').get('upgrade-unread').value)
    assert.equal(message.content, 'Saved unread body')
    assert.equal(message.timestamp, 3)
    assert.equal(db.prepare('SELECT value FROM state WHERE key=?').get('upgrade-saved-receipt').value, 'delivered')
  } finally { db.close() }
  const tasks = new DatabaseSync(path.join(directory, 'tasks.db'), { readOnly: true })
  try {
    const rows = tasks.prepare('SELECT priority,status,note,due_at,completed_at FROM tasks ORDER BY priority').all()
    assert.equal(rows.length, 2)
    assert.deepEqual({ ...rows[0] }, { priority: 'high', status: 'open', note: 'v1.3.4 fixture', due_at: 4070908800000, completed_at: null })
    assert.deepEqual({ ...rows[1] }, { priority: 'low', status: 'done', note: null, due_at: null, completed_at: 2 })
    assert.equal(tasks.prepare('PRAGMA user_version').get().user_version, 12)
  } finally { tasks.close() }
  console.log('V1_3_4_UPGRADE_PASSED chat, unread, receipt, open/done tasks, schema')
}
module.exports = { seed, verify }
