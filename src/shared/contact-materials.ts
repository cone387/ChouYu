import type { ContactReadContext, ContactScope } from './contact-content'
export type MaterialInput = { name: string; scope: Exclude<ContactScope, { kind: 'session' }>; content: string; source: { kind: 'text' | 'file' | 'attachment' | 'web'; label: string; url?: string } }
export type MaterialRef = { id: string; version: number }
export type MaterialVersion = MaterialInput & MaterialRef & { owner: string; hash: string; createdAt: number; status: 'ready' | 'withdrawn' }
export type MaterialSummary = Omit<MaterialVersion, 'content'>
export type MaterialRead = { text: string; nextOffset?: number; ref: MaterialRef }
export type MaterialImport = Omit<MaterialInput, 'content'> & { content?: string; id?: string; expectedVersion?: number; requestId?: string }
export type MaterialReadRef = MaterialRef & { start: number; end: number; topicId?: string }
export interface ContactMaterialAPI {
  materialList(owner: string, context: Omit<ContactReadContext, 'characterId'>): Promise<MaterialSummary[]>
  saveMaterial(owner: string, input: MaterialInput, id?: string, expectedVersion?: number): Promise<MaterialVersion>
  importMaterial(owner: string, input: MaterialImport): Promise<MaterialVersion | null>
  cancelMaterialImport(owner: string, requestId: string): Promise<void>
  readMaterial(owner: string, context: Omit<ContactReadContext, 'characterId'>, ref: MaterialRef, offset?: number): Promise<MaterialRead>
  materialHistory(owner: string, id: string): Promise<MaterialSummary[]>
  withdrawMaterial(owner: string, id: string, version: number): Promise<void>
}
