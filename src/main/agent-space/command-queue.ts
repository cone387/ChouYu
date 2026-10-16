/** Per-contact ordering, with exclusive barriers only for initialization/shutdown. */
export class ContactCommandQueue {
  private barrier = Promise.resolve()
  private tails = new Map<string, Promise<void>>()
  owners(): string[] { return [...this.tails.keys()].filter(Boolean) }
  submit<T>(owner: string, exclusive: boolean, operation: () => Promise<T>): Promise<T> {
    const dependencies = exclusive ? [this.barrier, ...this.tails.values()] : [this.barrier, this.tails.get(owner)]
    const result = Promise.all(dependencies).then(operation)
    const settled = result.then(() => {}, () => {})
    if (exclusive) { this.barrier = settled; this.tails.clear() }
    else {
      this.tails.set(owner, settled)
      void settled.then(() => { if (this.tails.get(owner) === settled) this.tails.delete(owner) })
    }
    return result
  }
}
