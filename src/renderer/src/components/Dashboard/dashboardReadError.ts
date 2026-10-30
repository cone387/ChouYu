import type { DashboardRange } from '../../../../shared/dashboard'
import type { UsageAPI } from '../../../../shared/usage'

class DashboardReadError extends Error {}
const restartMessage = 'Token 统计组件已更新，请退出并重新打开应用后再试。'

/** Renderer hot updates cannot add a bridge or handler to an already running Electron process. */
export async function readUsageStatistics(range: DashboardRange, api: { usage?: UsageAPI } = window.electronAPI) {
  if (typeof api.usage?.statistics !== 'function') throw new DashboardReadError(restartMessage)
  try { return await api.usage.statistics(range) }
  catch (error) {
    if (error instanceof Error && /No handler registered for ['"]usage:statistics['"]/.test(error.message)) throw new DashboardReadError(restartMessage)
    if (error instanceof Error && /Token 用量(存储暂时不可用|统计尚未初始化)/.test(error.message)) throw new DashboardReadError('Token 用量存储暂不可用，请退出并重新打开应用后再试。')
    throw error
  }
}

export function dashboardReadError(error: unknown, hasData: boolean): string {
  const message = error instanceof DashboardReadError ? error.message : '读取失败，请重试。'
  return message + (hasData ? '已显示的数据为上次读取结果。' : '')
}
