export type UpdatePhase = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'installing' | 'error' | 'unsupported'

export interface AppUpdateState {
  revision: number
  phase: UpdatePhase
  version?: string
  percent?: number
  error?: string
  errorStage?: 'check' | 'download' | 'install'
  checkedAt?: number
}

export interface AppUpdateAPI {
  getState: () => Promise<AppUpdateState>
  download: () => Promise<AppUpdateState>
  install: () => Promise<AppUpdateState>
  onState: (callback: (state: AppUpdateState) => void) => () => void
}
