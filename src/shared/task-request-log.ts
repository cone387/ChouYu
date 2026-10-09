/** Retain the original request and recent changes within the existing storage limit. */
export function appendTaskRequestLog(previous: string | undefined, next: string): string {
  const combined = previous ? `${previous}\n\n—— 后续修改 ——\n${next}` : next
  if (combined.length <= 8000) return combined
  return `${combined.slice(0, 1800)}\n\n……（中间沟通因长度限制未保留，以下为最近记录）……\n\n${combined.slice(-6100)}`
}
