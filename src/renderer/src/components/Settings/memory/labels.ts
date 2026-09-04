import type { MemoryType } from '../../../../../shared/memory'

export const TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  person: '人物',
  project: '项目',
  workflow: '工作方式'
}

export const ARCHIVE_LABELS: Record<string, string> = {
  expired: '到期归档',
  capacity: '容量整理',
  cleanup: '手动整理',
  manual: '手动归档',
  replace: '被新记忆替换'
}
