export function contactTaskHref(characterId: string, topicId: string): string {
  return `#contact-task?${new URLSearchParams({ characterId, topicId })}`
}
export function parseContactTaskHref(href?: string): { characterId: string; topicId: string } | undefined {
  if (!href?.startsWith('#contact-task?')) return
  const values = new URLSearchParams(href.slice('#contact-task?'.length))
  const characterId = values.get('characterId'), topicId = values.get('topicId')
  if (!characterId || !topicId || characterId.length > 128 || topicId.length > 128) return
  return { characterId, topicId }
}
