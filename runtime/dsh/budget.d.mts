export function installBudget(
  scope: { on(name: string, handler: (...args: any[]) => any): unknown },
  peer: { request(method: string, value: any, options?: any): Promise<any> },
  key: { requestId: string; attemptId: string }, sessionId: string, maxTokens: number,
  budgeted?: boolean, onUsageFailure?: () => void
): void
