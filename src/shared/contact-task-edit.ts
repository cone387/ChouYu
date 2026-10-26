export interface ContactTaskEdit {
  endingRequest?: import('./task-ending').TaskEndingRequest
  separateEvaluations?: boolean
  goal?: string
  constraints?: string
  title?: string
  modelCalls?: number
  tokens?: number
  clearTokenLimit?: true
}
