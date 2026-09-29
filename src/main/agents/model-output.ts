// The token allowance includes model reasoning as well as prose and JSON fields.
// Keep the prose length constraint separate from the transport output budget.
export const AGENT_OUTPUT_TOKENS = 8192
export class AgentOutputFormatError extends Error {}

export class AgentOutputTruncatedError extends Error {
  constructor(readonly partial = '') {
    super('模型输出达到长度上限，被截断，无法保存完整成果。本轮未写入成果或记忆，请重新推进一轮。')
  }
}
