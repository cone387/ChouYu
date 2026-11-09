import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export const RESULT_DESIGNER_CHARACTER_ID = 'result-designer'
export const DESIGN_ENVIRONMENT_VERSION = 'result-ui-v1'
export type ResultTaskRef = { domain: 'contact' | 'assistant'; ownerId: string; taskId: string }
export type ResultSourceRef = ResultTaskRef & { sourceId: string; contentHash: string }
export type ResultSection = { id: string; title: string; body: string; sources: { title: string; url: string }[] }
export type ResultSourceSnapshot = { ref: ResultSourceRef; title: string; sections: ResultSection[]; fileIds: string[] }
export type ResultDesignCode = { title: string; html: string; css: string; script: string }
export type DesignState = 'queued' | 'running' | 'validating' | 'ready' | 'blocked' | 'failed' | 'superseded' | 'cancelled'
export type DesignReceipt = { requestId: string; task: ResultTaskRef; requestRevision: number; state: DesignState }
export type DesignObservation = { width: number; height: number; theme: 'light'|'dark'; screenshotId: string; contentComplete: boolean; interactionsPassed: boolean; errors: string[]; readingSamples?: {screenshotId:string; y:number; maxY:number}[] }
export type DesignEvidence = {
  codeHash: string; sourceHash: string; environmentVersion: string; observations: DesignObservation[]
  visualReview: { requestId: string; response: string; accepted: boolean }; checkedAt: number
}
export type DesignJob = {
  id: string; requestId: string; requestRevision: number; task: ResultTaskRef; source: ResultSourceRef
  environmentVersion: string; text: string; explicit: boolean; runId: string; state: DesignState; createdAt: number
}
export type DesignPending = DesignReceipt & { source: ResultSourceRef; environmentVersion: string; text: string; explicit: boolean }
export type ResultDesignRecord = {
  id: string; version: number; task: ResultTaskRef; source: ResultSourceRef; jobId: string; requestRevision: number
  environmentVersion: string; code: ResultDesignCode; codeHash: string; createdAt: number; evidence?: DesignEvidence
}
export type DesignView = { receipt?: DesignReceipt; active?: ResultDesignRecord; error?: string; hasUpdate: boolean; newSourceId?:string; source?: ResultSourceSnapshot; history?:{id:string;version:number;createdAt:number}[] }
export interface ResultDesignAPI {
  get(task:ResultTaskRef,sourceId?:string):Promise<DesignView>
  request(task:ResultTaskRef,text:string,identity:string,source:ResultSourceRef):Promise<DesignReceipt>
  retry(task:ResultTaskRef):Promise<DesignReceipt>
  restore(task:ResultTaskRef,designId:string):Promise<DesignView>
  onChanged(callback:()=>void):()=>void
}
export type DesignEnvironment = { version: string; font: string; tokens: Record<string, string>; width: number; height: number; theme: 'light'|'dark' }
export type PreviewAction = { kind: 'click'; target: string } | { kind: 'scroll'; y: number } | {kind:'scroll';fraction:number} | { kind: 'key'; key: 'Tab'|'Enter'|'Escape'|'ArrowDown'|'ArrowUp' }
export type PreviewObservation = DesignObservation & { imageUrl: string; controls: { id: string; label: string }[]; contentIntact?:boolean; reachedSections?:string[]; scroll?:{y:number;maxY:number} }

export const designHash = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))))
export const taskKey = (task: ResultTaskRef) => JSON.stringify([task.domain, task.ownerId, task.taskId])
export const sourceKey = (ref: ResultSourceRef) => JSON.stringify([ref.domain, ref.ownerId, ref.taskId, ref.sourceId, ref.contentHash])
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(v)
export function validateTaskRef(value: unknown): ResultTaskRef {
  const v = value as ResultTaskRef
  if (!v || !['contact','assistant'].includes(v.domain) || !identifier(v.ownerId) || !identifier(v.taskId)) throw new Error('成果任务引用无效。')
  return { domain: v.domain, ownerId: v.ownerId, taskId: v.taskId }
}
export function validateSourceRef(value: unknown): ResultSourceRef {
  const v = value as ResultSourceRef, task = validateTaskRef(v)
  if (!identifier(v.sourceId) || !/^[a-f0-9]{64}$/.test(v.contentHash)) throw new Error('成果来源版本无效。')
  return { ...task, sourceId: v.sourceId, contentHash: v.contentHash }
}
export function validateDesignCode(value: unknown): ResultDesignCode {
  const v = value as ResultDesignCode
  if (!v || typeof v !== 'object' || Object.keys(v).some(k => !['title','html','css','script'].includes(k))) throw new Error('展示代码字段无效。')
  for (const [key, max] of [['title',120],['html',12000],['css',12000],['script',16000]] as const)
    if (typeof v[key] !== 'string' || v[key].length > max || key === 'title' && !v[key].trim()) throw new Error('展示代码无效或过长。')
  return { title: v.title.trim(), html: v.html, css: v.css, script: v.script }
}
export const codeHash = (code: ResultDesignCode) => designHash(validateDesignCode(code))
export function sourceSnapshot(task: ResultTaskRef, sourceId: string, title: string, sections: ResultSection[], fileIds: string[]): ResultSourceSnapshot {
  const checked = validateTaskRef(task)
  if (!identifier(sourceId) || typeof title !== 'string' || title.length > 1000 || !Array.isArray(sections) || !sections.length || sections.length > 300
    || sections.some(s => !identifier(s.id) || typeof s.title !== 'string' || typeof s.body !== 'string' || !Array.isArray(s.sources)
      || s.sources.some(r => typeof r.title !== 'string' || typeof r.url !== 'string'))
    || new Set(sections.map(s => s.id)).size !== sections.length || sections.reduce((n,s) => n+s.body.length,0) > 1000000
    || !Array.isArray(fileIds) || fileIds.some(id => !identifier(id))) throw new Error('正式成果内容无效。')
  const clean = sections.map(s => ({ id: s.id, title: s.title, body: s.body, sources: s.sources.map(r => ({ title: r.title, url: r.url })) }))
  const contentHash = designHash({ title, sections: clean, fileIds })
  return { ref: { ...checked, sourceId, contentHash }, title, sections: clean, fileIds: [...fileIds] }
}
export function validateEvidence(record: ResultDesignRecord, evidence: DesignEvidence): void {
  if (!evidence || evidence.codeHash !== record.codeHash || evidence.sourceHash !== record.source.contentHash || evidence.environmentVersion !== record.environmentVersion
    || !evidence.visualReview?.accepted || !evidence.visualReview.requestId || !evidence.visualReview.response?.trim() || !Number.isFinite(evidence.checkedAt)
    || !Array.isArray(evidence.observations) || ![375,1024].every(width => ['light','dark'].every(theme => evidence.observations.some(o =>
      o.width === width && o.height === (width === 375 ? 700 : 768) && o.theme === theme && Boolean(o.screenshotId)
      && o.contentComplete && o.interactionsPassed && Array.isArray(o.errors) && !o.errors.length)))) throw new Error('展示检查证据不完整或不匹配。')
}
export interface ResultDesignNotice { id:string; task:ResultTaskRef; source:ResultSourceRef; title:string; createdAt:number }
