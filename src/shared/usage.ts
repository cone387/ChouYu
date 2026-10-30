import type { DashboardRange } from './dashboard'

export interface AppUsageStatistics {
  trackingSince: number
  collectionIssue?: string
  calls: number
  reported: number
  tokens: number | null
  days: { date: string; calls: number; reported: number; tokens: number | null }[]
  models: { model: string; calls: number; reported: number; tokens: number | null }[]
}
export interface UsageAPI { statistics(range: DashboardRange): Promise<AppUsageStatistics> }
