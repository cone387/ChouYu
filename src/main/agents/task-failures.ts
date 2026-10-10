import type Database from 'better-sqlite3'

/** Each task owns its retry streak, even when another task succeeds concurrently. */
export class AgentTaskFailures {
  constructor(private db: Database.Database) {
    const existed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_failures'").get()
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS task_failures (
        topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL, failures INTEGER NOT NULL, next_at INTEGER NOT NULL);`)
      if (!existed) {
        // Legacy serial execution had only one streak per contact. Preserve its actual failed run.
        const profiles = db.prepare('SELECT character_id,failures,next_at FROM profiles WHERE failures>0').all() as { character_id: string; failures: number; next_at: number }[]
        for (const p of profiles) {
          const run = db.prepare("SELECT id,topic_id,status FROM runs WHERE character_id=? AND status='failed' AND COALESCE(json_extract(input,'$.revisionScope'),'')!='presentation' ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(p.character_id) as { id: string; topic_id: string; status: string } | undefined
          if (run?.topic_id && run.status === 'failed' && db.prepare('SELECT 1 FROM topics WHERE id=?').get(run.topic_id))
            db.prepare('INSERT INTO task_failures VALUES(?,?,?,?)').run(run.topic_id, run.id, p.failures, p.next_at)
        }
      }
    })()
  }
  get(topicId: string | null) {
    return this.db.prepare('SELECT * FROM task_failures WHERE topic_id=?').get(topicId) as { topic_id: string; run_id: string; failures: number; next_at: number } | undefined
  }
  set(owner: string, topicId: string, runId: string, failures: number, nextAt: number) {
    this.db.prepare('INSERT OR REPLACE INTO task_failures VALUES(?,?,?,?)').run(topicId, runId, failures, nextAt)
    this.refresh(owner)
  }
  clear(owner: string, topicId: string | null) {
    this.db.prepare('DELETE FROM task_failures WHERE topic_id=?').run(topicId)
    this.refresh(owner)
  }
  refresh(owner: string) {
    this.db.prepare(`UPDATE profiles SET failures=(SELECT COALESCE(MAX(f.failures),0) FROM task_failures f
      JOIN topics t ON t.id=f.topic_id WHERE t.character_id=?) WHERE character_id=?`).run(owner, owner)
  }
}
