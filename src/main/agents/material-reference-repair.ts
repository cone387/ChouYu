/** A bad model-supplied reference can be corrected without widening the saved scope. */
export class MaterialReferenceError extends Error {
  constructor() { super('资料不在本轮目录快照内，请按本轮提供的版本读取。') }
}
export function withMaterialReferenceRepair<Args extends unknown[]>(execute: (...args: Args) => Promise<string>) {
  let repairs = 0
  return async (...args: Args): Promise<string> => {
    try { return await execute(...args) } catch (error) {
      if (!(error instanceof MaterialReferenceError) || repairs++ >= 1) throw error
      return JSON.stringify({ error: { code: 'material-reference', message: '该资料或版本不在本次目录中，未读取任何正文。请调用 list_contact_materials 核对真实 id/version；仅使用目录中的资料。目录为空时不要猜测资料，也不要声称已读。再次传入无效引用将停止本次尝试。' } })
    }
  }
}
