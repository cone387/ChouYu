export interface RecoveryAllowance { calls: number; tokens: number }
export interface RecoveryTaskReview {
  reviewedAt: number
  externalEffects: 'unresolved' | 'verified'
  evidence: string
}
export interface ContactRecoveryOwner {
  scopeReviewedAt?: number
  tasks: Record<string, RecoveryTaskReview>
  daily: Record<string, RecoveryAllowance>
  allowances: Record<string, RecoveryAllowance>
}
export interface RecoveryReservation {
  owner: string; topicId: string; day: string; tokens: number; reservedTokens: number; settled: boolean
}
export interface ContactRecoveryRecord {
  restoreId: string; group: string; at: number; unknownHistory: true
  owners: Record<string, ContactRecoveryOwner>
  grants: Record<string, string>
  requests: Record<string, RecoveryReservation>
}
export interface RecoveryRequest {
  restoreId: string; requestId: string; owner: string; topicId: string; tokens: number
}
export interface RecoveryReview {
  restoreId: string; requestId: string; owner: string; topicId: string
  scopesReviewed: boolean; externalEffects: 'unresolved' | 'verified'; evidence: string
  daily?: RecoveryAllowance; task?: RecoveryAllowance
}
export interface ContactRecoveryIdentity {
  restoreId: string; scopeReviewed: boolean; allowedTopics: string[]
  additional?: { day: string; daily: RecoveryAllowance; tasks: Record<string, RecoveryAllowance> }
}
