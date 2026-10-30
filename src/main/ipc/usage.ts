import { ipcMain } from 'electron'
import { getUsageStore } from '../usage'
import { registerDomain } from './registration'

export function registerUsageHandlers() {
  return registerDomain(ipcMain, ipc => {
    ipc.handle('usage:statistics', (_event, range: unknown) => {
      if (range !== 7 && range !== 30) throw new Error('看板统计范围须为近 7 天或近 30 天。')
      return getUsageStore().statistics(range)
    })
  })
}
