type ArticleBounds = { top: number; height: number }
const clamp = (value: number) => Math.max(0, Math.min(1, value))

export function readingScrollRatio(scrollTop: number, viewportHeight: number, article: ArticleBounds): number {
  const distance = article.height - viewportHeight
  return distance > 0 ? clamp((scrollTop - article.top) / distance) : 0
}
export function readingScrollTop(ratio: number, viewportHeight: number, article: ArticleBounds): number {
  return Math.max(0, article.top + clamp(ratio) * Math.max(0, article.height - viewportHeight))
}
/** The task sheet (or portfolio sheet) owns scrolling, never the prose article. */
export function readingScrollContainer(article: HTMLElement, includeSelf = false): HTMLElement {
  for (let parent: HTMLElement | null = includeSelf ? article : article.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.clientHeight > 0) return parent
  }
  return document.scrollingElement as HTMLElement
}
export function readingArticleBounds(article: HTMLElement, scroller: HTMLElement): ArticleBounds {
  return { top: article.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop, height: article.offsetHeight }
}
