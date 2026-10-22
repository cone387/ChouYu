import { validateContactCommand, type ContactCommandName, type ContactResult } from '../../shared/contact-commands'

export type UnknownContactDispatch = (method: ContactCommandName, owner: string, args: unknown[]) => Promise<unknown>
/** Compile-check each worker branch against the same public response contract. */
export function contactCommandResult<M extends ContactCommandName>(_method: M, value: NoInfer<ContactResult<M>>): ContactResult<M> { return value }
/** Tool/IPC arguments are untrusted; result types still belong to the selected command. */
export function contactCommandDispatcher(dispatch: UnknownContactDispatch) {
  return async <M extends ContactCommandName>(method: M, owner: string, args: unknown[] = []): Promise<ContactResult<M>> => {
    validateContactCommand(method, owner, args)
    return await dispatch(method, owner, args) as ContactResult<M>
  }
}
