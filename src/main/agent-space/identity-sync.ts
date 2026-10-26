import type { ContactIdentity } from '../contact-agent/contracts'
export interface IdentityCapture {
  generation: number; roster?: string[]; rosterChanged: boolean
  items: { revision: number; identity: ContactIdentity }[]
}
/** Source revisions are cheap metadata; message bodies are read only after invalidation. */
export class ContactIdentitySync {
  private epoch = 0
  private sequence = 0
  private cache = new Map<string, { source: string; revision: number; identity: ContactIdentity }>()
  private acknowledged = new Map<string, number>()
  private roster = ''
  constructor(private version: (owner: string) => string, private source: (owner: string) => ContactIdentity) {}
  generation(value: number) {
    if (value === this.epoch) return
    this.epoch = value; this.acknowledged.clear(); this.roster = ''
  }
  private current(owner: string) {
    const source = this.version(owner), previous = this.cache.get(owner)
    if (previous?.source === source) return previous
    const identity = this.source(owner)
    if (identity.id !== owner) throw new Error('联系人身份快照归属不一致。')
    const entry = { source, revision: ++this.sequence, identity: structuredClone(identity) }
    this.cache.set(owner, entry); return entry
  }
  read(owner: string) { return structuredClone(this.current(owner).identity) }
  capture(owners: string[], roster = true): IdentityCapture {
    if (new Set(owners).size !== owners.length) throw new Error('联系人列表重复。')
    if (roster) for (const id of this.cache.keys()) if (!owners.includes(id)) { this.cache.delete(id); this.acknowledged.delete(id) }
    return { generation: this.epoch, ...(roster ? { roster: [...owners] } : {}), rosterChanged: roster && JSON.stringify(owners) !== this.roster,
      items: owners.flatMap(owner => { const value = this.current(owner); return this.acknowledged.get(owner) === value.revision ? [] : [{ revision: value.revision, identity: structuredClone(value.identity) }] }) }
  }
  confirm(capture: IdentityCapture) {
    if (capture.generation !== this.epoch) return
    for (const item of capture.items) if (this.cache.has(item.identity.id)) this.acknowledged.set(item.identity.id, item.revision)
    if (capture.roster) this.roster = JSON.stringify(capture.roster)
  }
}
