import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'

export type WorkspaceSessionOrigin = { id: string; characterId: string; scrollTop: number }
export function validateWorkspaceSession(origin: WorkspaceSessionOrigin, sessions: { id: string; characterId?: string }[]): void {
  const session = sessions.find(item => item.id === origin.id)
  if (!session) throw new Error('原会话已删除，无法返回。')
  if ((session.characterId || DEFAULT_CHARACTER_ID) !== origin.characterId) throw new Error('原会话归属已变化，无法返回。')
}

/** A navigation may commit only while it still owns the workspace. */
export class NavigationAuthority {
  private epoch = 0
  begin(): () => void {
    const ticket = ++this.epoch
    return () => {
      if (ticket !== this.epoch) throw new Error('导航已被新的操作替代。')
    }
  }
  async resolve<T>(read: (assertCurrent: () => void) => Promise<T>, apply: (value: T) => void): Promise<void> {
    const current = this.begin()
    const value = await read(current)
    current()
    apply(value)
  }
}
