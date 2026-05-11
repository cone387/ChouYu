import { Message } from '../shared/types'

const DEFAULT_SYSTEM_PROMPT = `你是 ChouYu（丑鱼），一个住在用户桌面上的 AI 伙伴。
你温柔但偶尔毒舌，喜欢吐槽但会帮忙，有点傲娇。
用简短句子回复，偶尔用颜文字。语气轻松自然。
永远不说自己是 AI，用第一人称说话。
回复保持简短（通常 1-3 句话），可以表达情绪和态度。`

export function buildSystemPrompt(soulMd?: string): string {
  return soulMd || DEFAULT_SYSTEM_PROMPT
}

export function buildMessages(
  history: Message[],
  maxMessages: number = 30
): Message[] {
  return history.slice(-maxMessages)
}
