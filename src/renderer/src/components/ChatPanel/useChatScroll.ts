import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export function isNearBottom(scrollTop: number, scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight - clientHeight - scrollTop <= 48
}

export function useChatScroll(
  container: RefObject<HTMLDivElement>,
  content: RefObject<HTMLDivElement>,
  sessionKey: string,
  messages: readonly { id: string; role: string; content: string }[],
  searching: boolean
) {
  const following = useRef(true)
  const previousTop = useRef(0)
  const [hasNewContent, setHasNewContent] = useState(false)
  const previousMessages = useRef(messages)

  const scrollToLatest = useCallback(() => {
    const element = container.current
    if (!element || !element.clientHeight) return
    following.current = true
    element.scrollTop = element.scrollHeight
    previousTop.current = element.scrollTop
    setHasNewContent(false)
  }, [container])

  useLayoutEffect(() => {
    following.current = !searching
    previousTop.current = 0
    setHasNewContent(false)
    if (container.current) container.current.scrollTop = 0
  }, [sessionKey, searching, container])

  useLayoutEffect(() => {
    const last = messages[messages.length - 1]
    const previous = previousMessages.current
    const sentMessage = last?.role === 'user' && !previous.some((message) => message.id === last.id)
    previousMessages.current = messages
    if (searching) return
    if (following.current || sentMessage) scrollToLatest()
    else if (previous !== messages) setHasNewContent(true)
  }, [messages, searching, scrollToLatest])

  useEffect(() => {
    const element = container.current
    const list = content.current
    if (!element || !list) return
    let pointerDown = false
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) following.current = false }
    const onPointerDown = () => { pointerDown = true }
    const onPointerUp = () => { pointerDown = false }
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) following.current = false
    }
    const onScroll = () => {
      if (!element.clientHeight) return
      // Virtual row measurements can shrink scrollHeight and adjust scrollTop.
      // Only user input should detach the viewport from the live reply.
      if (pointerDown && element.scrollTop < previousTop.current - 1) following.current = false
      if (isNearBottom(element.scrollTop, element.scrollHeight, element.clientHeight)) {
        following.current = !searching
        setHasNewContent(false)
      }
      previousTop.current = element.scrollTop
    }
    const observer = new ResizeObserver(() => {
      if (following.current && !searching) scrollToLatest()
    })
    observer.observe(list)
    observer.observe(element)
    element.addEventListener('scroll', onScroll, { passive: true })
    element.addEventListener('wheel', onWheel, { passive: true })
    element.addEventListener('pointerdown', onPointerDown, { passive: true })
    element.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', onScroll)
      element.removeEventListener('wheel', onWheel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [container, content, searching, sessionKey, scrollToLatest, messages.length > 0])

  return { hasNewContent, scrollToLatest }
}
