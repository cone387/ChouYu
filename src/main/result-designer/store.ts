import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { codeHash, sourceSnapshot, taskKey, sourceKey, validateTaskRef, validateSourceRef, validateDesignCode, validateEvidence,
  type ResultTaskRef, type ResultSourceRef, type ResultSourceSnapshot, type ResultDesignCode, type ResultDesignRecord,
  type DesignEvidence, type DesignJob, type DesignPending, type DesignReceipt, type DesignState, type DesignView } from '../../shared/result-design'

type RequestRow = { id: string; task_key: string; source_key: string; revision: number; state: DesignState; environment: string; text: string; explicit: number; error: string }
/** Independent presentation history; shares the source commit's SQLite transaction. */
export class ResultDesignStore {
  constructor(readonly db: Database.Database,private defaultLimit:()=>number|undefined=()=>undefined) {
    db.exec(`CREATE TABLE IF NOT EXISTS result_design_sources (key TEXT PRIMARY KEY,task_key TEXT NOT NULL,snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS result_design_source_task ON result_design_sources(task_key);
      CREATE TABLE IF NOT EXISTS result_design_requests (id TEXT PRIMARY KEY,task_key TEXT NOT NULL UNIQUE,source_key TEXT NOT NULL,
        revision INTEGER NOT NULL,state TEXT NOT NULL,environment TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',explicit INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS result_design_submissions (key TEXT PRIMARY KEY,task_key TEXT NOT NULL,text TEXT NOT NULL,receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS result_design_jobs (id TEXT PRIMARY KEY,request_id TEXT NOT NULL,task_key TEXT NOT NULL,state TEXT NOT NULL,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS result_design_job_task ON result_design_jobs(task_key,state);
      CREATE TABLE IF NOT EXISTS result_design_versions (id TEXT PRIMARY KEY,task_key TEXT NOT NULL,source_key TEXT NOT NULL,version INTEGER NOT NULL,value TEXT NOT NULL,UNIQUE(task_key,version));
      CREATE TABLE IF NOT EXISTS result_design_active (source_key TEXT PRIMARY KEY,design_id TEXT NOT NULL);`)
    db.exec("CREATE TABLE IF NOT EXISTS result_design_notices (id TEXT PRIMARY KEY,task_key TEXT NOT NULL,value TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0)")
    db.exec('CREATE TABLE IF NOT EXISTS result_design_waits (request_id TEXT PRIMARY KEY,signature TEXT NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS result_design_reads (job_id TEXT NOT NULL,section_id TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,created_at INTEGER NOT NULL)')
    db.exec('CREATE TABLE IF NOT EXISTS result_design_limits (request_id TEXT PRIMARY KEY,token_limit INTEGER)')
  }
  private receipt(row: RequestRow): DesignReceipt { return { requestId: row.id, task: validateTaskRef(this.readKey(row.source_key).ref), requestRevision: row.revision, state: row.state } }
  private readKey(key: string): ResultSourceSnapshot {
    const row = this.db.prepare('SELECT snapshot FROM result_design_sources WHERE key=?').get(key) as {snapshot:string}|undefined
    if (!row) throw new Error('成果来源已失效。')
    return JSON.parse(row.snapshot)
  }
  readSource(ref: ResultSourceRef): ResultSourceSnapshot { return this.readKey(sourceKey(validateSourceRef(ref))) }
  recordRead(jobId:string,sectionId:string,start:number,end:number){this.live(jobId);this.db.prepare('INSERT INTO result_design_reads VALUES(?,?,?,?,?)').run(jobId,sectionId,start,end,Date.now())}
  private requestRow(id: string): RequestRow {
    const row = this.db.prepare('SELECT * FROM result_design_requests WHERE id=?').get(id) as RequestRow|undefined
    if (!row) throw new Error('展示请求已失效。')
    return row
  }
  latest(task: ResultTaskRef): ResultSourceSnapshot | null {
    const row = this.db.prepare('SELECT source_key FROM result_design_requests WHERE task_key=?').get(taskKey(validateTaskRef(task))) as {source_key:string}|undefined
    return row ? this.readKey(row.source_key) : null
  }
  accept(input: ResultSourceSnapshot, environment: string): DesignReceipt {
    const snapshot = sourceSnapshot(input.ref, input.ref.sourceId, input.title, input.sections, input.fileIds)
    if (snapshot.ref.contentHash !== input.ref.contentHash || !environment || environment.length > 160) throw new Error('成果来源指纹或设计环境无效。')
    return this.db.transaction(() => {
      const key = sourceKey(snapshot.ref), task = taskKey(snapshot.ref)
      this.db.prepare('INSERT OR IGNORE INTO result_design_sources VALUES(?,?,?)').run(key, task, JSON.stringify(snapshot))
      let row = this.db.prepare('SELECT * FROM result_design_requests WHERE task_key=?').get(task) as RequestRow|undefined
      if (!row) {
        this.db.prepare("INSERT INTO result_design_requests(id,task_key,source_key,revision,state,environment) VALUES(?,?,?,1,'queued',?)").run(randomUUID(), task, key, environment)
      } else if (row.source_key !== key || row.environment !== environment) {
        this.db.prepare("UPDATE result_design_requests SET source_key=?,environment=?,revision=revision+1,state='queued',explicit=0,error='' WHERE id=?").run(key, environment, row.id)
      }
      row = this.db.prepare('SELECT * FROM result_design_requests WHERE task_key=?').get(task) as RequestRow
      this.db.prepare('INSERT OR IGNORE INTO result_design_limits VALUES(?,?)').run(row.id,this.defaultLimit()??null)
      return this.receipt(row)
    })()
  }
  request(task: ResultTaskRef, text: string, identity: string): DesignReceipt {
    validateTaskRef(task)
    if (typeof text !== 'string' || !text.trim() || text.length > 8000 || typeof identity !== 'string' || !identity || identity.length > 1000) throw new Error('展示请求无效。')
    return this.db.transaction(() => {
      const key = JSON.stringify([taskKey(task), identity])
      const old = this.db.prepare('SELECT text,receipt FROM result_design_submissions WHERE key=?').get(key) as {text:string;receipt:string}|undefined
      if (old) { if (old.text !== text) throw new Error('同一请求不能替换内容。'); return JSON.parse(old.receipt) }
      const row = this.db.prepare('SELECT * FROM result_design_requests WHERE task_key=?').get(taskKey(task)) as RequestRow|undefined
      if (!row) throw new Error('尚无可设计的正式成果。')
      this.db.prepare("UPDATE result_design_requests SET revision=revision+1,text=?,explicit=1,state='queued',error='' WHERE id=?").run(text, row.id)
      const receipt = this.receipt(this.requestRow(row.id))
      this.db.prepare('INSERT INTO result_design_submissions VALUES(?,?,?,?)').run(key,taskKey(task),text,JSON.stringify(receipt))
      return receipt
    })()
  }
  tokenLimit(requestId:string):number|undefined{return (this.db.prepare('SELECT token_limit FROM result_design_limits WHERE request_id=?').get(requestId) as {token_limit:number|null}|undefined)?.token_limit??undefined}
  pending(): DesignPending[] {
    return (this.db.prepare(`SELECT r.* FROM result_design_requests r WHERE r.state='queued'
      AND NOT EXISTS(SELECT 1 FROM result_design_jobs j WHERE j.task_key=r.task_key AND j.state IN ('running','validating')) ORDER BY r.rowid`).all() as RequestRow[])
      .map(row => ({ ...this.receipt(row), source: this.readKey(row.source_key).ref, environmentVersion: row.environment, text: row.text, explicit: Boolean(row.explicit) }))
  }
  claim(requestId: string, runId: string): DesignJob {
    return this.db.transaction(() => {
      const row = this.requestRow(requestId)
      if (row.state !== 'queued' || this.db.prepare("SELECT 1 FROM result_design_jobs WHERE task_key=? AND state IN ('running','validating')").get(row.task_key)) throw new Error('展示工作已开始或不在队列中。')
      const ref = this.readKey(row.source_key).ref
      const job: DesignJob = { id: randomUUID(), requestId, requestRevision: row.revision, task: validateTaskRef(ref), source: ref, environmentVersion: row.environment,
        text: row.text, explicit: Boolean(row.explicit), runId, state: 'running', createdAt: Date.now() }
      this.db.prepare('INSERT INTO result_design_jobs VALUES(?,?,?,?,?)').run(job.id,requestId,row.task_key,job.state,JSON.stringify(job))
      this.db.prepare("UPDATE result_design_requests SET state='running' WHERE id=?").run(requestId)
      return job
    })()
  }
  job(id: string): DesignJob {
    const row = this.db.prepare('SELECT value FROM result_design_jobs WHERE id=?').get(id) as {value:string}|undefined
    if (!row) throw new Error('展示工作已失效。')
    return JSON.parse(row.value)
  }
  private live(id: string) {
    const job = this.job(id)
    if (!['running','validating'].includes(job.state)) throw new Error('展示工作已停止。')
    this.readSource(job.source)
    return job
  }
  private state(job: DesignJob, state: DesignState, error = '') {
    this.db.prepare('UPDATE result_design_jobs SET state=?,value=? WHERE id=?').run(state,JSON.stringify({...job,state}),job.id)
    this.db.prepare('UPDATE result_design_requests SET state=?,error=? WHERE id=? AND revision=?').run(state,error,job.requestId,job.requestRevision)
  }
  saveCandidate(jobId: string, input: ResultDesignCode): ResultDesignRecord {
    return this.db.transaction(() => {
      const job = this.live(jobId), code = validateDesignCode(input)
      const n = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS n FROM result_design_versions WHERE task_key=?').get(taskKey(job.task)) as {n:number}
      const record: ResultDesignRecord = { id: randomUUID(),version:n.n,task:job.task,source:job.source,jobId,requestRevision:job.requestRevision,
        environmentVersion:job.environmentVersion,code,codeHash:codeHash(code),createdAt:Date.now() }
      this.db.prepare('INSERT INTO result_design_versions VALUES(?,?,?,?,?)').run(record.id,taskKey(job.task),sourceKey(job.source),record.version,JSON.stringify(record))
      this.state(job,'validating')
      return record
    })()
  }
  design(id: string): ResultDesignRecord {
    const row = this.db.prepare('SELECT value FROM result_design_versions WHERE id=?').get(id) as {value:string}|undefined
    if (!row) throw new Error('展示版本不存在。')
    return JSON.parse(row.value)
  }
  reusable(task:ResultTaskRef,environment:string):ResultDesignRecord|undefined {
    const rows=this.db.prepare('SELECT v.value FROM result_design_versions v JOIN result_design_active a ON a.design_id=v.id WHERE v.task_key=? ORDER BY v.version DESC').all(taskKey(task)) as {value:string}[]
    return rows.map(row=>JSON.parse(row.value) as ResultDesignRecord).find(record=>record.evidence&&record.environmentVersion===environment)
  }
  publish(jobId: string, designId: string, evidence: DesignEvidence): void {
    this.db.transaction(() => {
      const job = this.live(jobId), row = this.requestRow(job.requestId), record = this.design(designId)
      if (row.revision !== job.requestRevision || row.source_key !== sourceKey(job.source) || row.environment !== job.environmentVersion) throw new Error('成果或展示要求已变化，旧设计不能启用。')
      if (record.jobId !== jobId) throw new Error('展示检查对象不匹配。')
      validateEvidence(record,evidence)
      this.db.prepare('UPDATE result_design_versions SET value=? WHERE id=?').run(JSON.stringify({...record,evidence}),designId)
      this.db.prepare('INSERT INTO result_design_active VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET design_id=excluded.design_id').run(row.source_key,designId)
      this.state(job,'ready')
      this.db.prepare('INSERT OR IGNORE INTO result_design_notices(id,task_key,value) VALUES(?,?,?)').run(record.id,taskKey(job.task),JSON.stringify({id:record.id,task:job.task,source:job.source,title:this.readSource(job.source).title,createdAt:Date.now()}))
    })()
  }
  fail(jobId: string, state: 'blocked'|'failed'|'cancelled', error: string): void {
    this.db.transaction(() => { const job = this.job(jobId); if (['running','validating'].includes(job.state)) this.state(job,state,error.slice(0,2000)) })()
  }
  block(requestId: string, reason: string): void {
    this.db.prepare("UPDATE result_design_requests SET state='blocked',error=? WHERE id=? AND state='queued'").run(reason.slice(0,2000),requestId)
  }
  notices():import('../../shared/result-design').ResultDesignNotice[]{return (this.db.prepare('SELECT value FROM result_design_notices WHERE sent=0 ORDER BY rowid LIMIT 32').all() as {value:string}[]).map(row=>JSON.parse(row.value))}
  ackNotice(id:string){this.db.prepare('UPDATE result_design_notices SET sent=1 WHERE id=?').run(id)}
  retry(requestId: string): DesignReceipt {
    const row = this.requestRow(requestId)
    if (['failed','blocked','cancelled'].includes(row.state)) this.db.prepare("UPDATE result_design_requests SET state='queued',error='' WHERE id=?").run(requestId)
    return this.receipt(this.requestRow(requestId))
  }
  waitForChange(requestId:string,signature:string){this.db.prepare('INSERT OR REPLACE INTO result_design_waits VALUES(?,?)').run(requestId,signature)}
  resumeChanged(signature:string){
    for(const row of this.db.prepare('SELECT request_id FROM result_design_waits WHERE signature!=?').all(signature) as {request_id:string}[]){
      if(this.db.prepare('SELECT 1 FROM result_design_requests WHERE id=?').get(row.request_id))this.retry(row.request_id)
      this.db.prepare('DELETE FROM result_design_waits WHERE request_id=?').run(row.request_id)
    }
  }
  view(ref: ResultSourceRef): DesignView {
    validateSourceRef(ref)
    const row = this.db.prepare('SELECT * FROM result_design_requests WHERE task_key=?').get(taskKey(ref)) as RequestRow|undefined
    const active = this.db.prepare('SELECT design_id FROM result_design_active WHERE source_key=?').get(sourceKey(ref)) as {design_id:string}|undefined
    const record = active ? this.design(active.design_id) : undefined
    const history=(this.db.prepare('SELECT value FROM result_design_versions WHERE source_key=? ORDER BY version DESC LIMIT 30').all(sourceKey(ref)) as {value:string}[])
      .map(row=>JSON.parse(row.value) as ResultDesignRecord).filter(record=>Boolean(record.evidence)).map(({id,version,createdAt})=>({id,version,createdAt}))
    return { ...(row ? {receipt:this.receipt(row),...(row.error ? {error:row.error}:{})}:{}), ...(record ? {active:record}:{}),
      history,...(row&&this.readKey(row.source_key).ref.sourceId!==ref.sourceId?{newSourceId:this.readKey(row.source_key).ref.sourceId}:{}),hasUpdate: Boolean(row && (row.source_key !== sourceKey(ref) || row.state!=='ready' && record && row.revision !== record.requestRevision)) }
  }
  restore(designId: string): DesignView {
    return this.db.transaction(() => {
      const record = this.design(designId), row = this.db.prepare('SELECT * FROM result_design_requests WHERE task_key=?').get(taskKey(record.task)) as RequestRow|undefined
      if (!row || row.source_key !== sourceKey(record.source) || row.environment !== record.environmentVersion || !record.evidence) throw new Error('此设计不适用于当前成果。')
      validateEvidence(record,record.evidence)
      this.db.prepare("UPDATE result_design_requests SET revision=revision+1,state='ready',error='' WHERE id=?").run(row.id)
      this.db.prepare('INSERT INTO result_design_active VALUES(?,?) ON CONFLICT(source_key) DO UPDATE SET design_id=excluded.design_id').run(row.source_key,designId)
      return this.view(record.source)
    })()
  }
  recover(): void {
    this.db.transaction(() => {
      this.db.exec("UPDATE result_design_requests SET state='queued',error='' WHERE state IN ('running','validating')")
      for (const row of this.db.prepare("SELECT id FROM result_design_jobs WHERE state IN ('running','validating')").all() as {id:string}[]) {
        const job = this.job(row.id)
        this.db.prepare("UPDATE result_design_jobs SET state='cancelled',value=? WHERE id=?").run(JSON.stringify({...job,state:'cancelled'}),job.id)
      }
    })()
  }
  invalidate(task: ResultTaskRef): void {
    this.db.transaction(() => {
      const key = taskKey(validateTaskRef(task))
      this.db.prepare('DELETE FROM result_design_reads WHERE job_id IN (SELECT id FROM result_design_jobs WHERE task_key=?)').run(key)
      this.db.prepare('DELETE FROM result_design_waits WHERE request_id IN (SELECT id FROM result_design_requests WHERE task_key=?)').run(key)
      this.db.prepare('DELETE FROM result_design_limits WHERE request_id IN (SELECT id FROM result_design_requests WHERE task_key=?)').run(key)
      this.db.prepare('DELETE FROM result_design_active WHERE source_key IN (SELECT key FROM result_design_sources WHERE task_key=?)').run(key)
      for (const table of ['result_design_notices','result_design_versions','result_design_jobs','result_design_submissions','result_design_requests','result_design_sources'])
        this.db.prepare(`DELETE FROM ${table} WHERE task_key=?`).run(key)
    })()
  }
}
