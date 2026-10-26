import { useEffect } from 'react'
import { matchesSearchShortcut } from '../../../../shared/search-shortcut'
import { isOverlayEscape } from '../../core/escape'
import type { AppConfig } from '../../shared/types'
import type { ToolApprovalRequest } from '../../../../shared/tools'
interface Options {
  visible: boolean
  toolApprovalRequest: ToolApprovalRequest | null
  config: AppConfig
  isChat: boolean
  showMessageSearch: boolean
  confirmClear: boolean
  onClose(): void
  requestComposerFocus(): void
  setShowGlobalSearch(value: boolean): void
  setShowMessageSearch(value: boolean): void
  setConfirmClear(value: boolean): void
}
/** Business dialogs consume Escape first; only the exposed workspace closes. */
export function useWorkspaceOverlays({ visible, toolApprovalRequest, config, isChat, showMessageSearch, confirmClear, onClose, requestComposerFocus, setShowGlobalSearch, setShowMessageSearch, setConfirmClear }: Options) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible || toolApprovalRequest || event.defaultPrevented || isOverlayEscape(event) || Array.from(document.querySelectorAll('dialog[open]:not([aria-modal="false"]), [aria-modal="true"]')).some(element => element.getClientRects().length > 0)) return
      if (matchesSearchShortcut(event, config.searchHotkey, navigator.platform.includes('Mac'))) {
        event.preventDefault(); setShowGlobalSearch(true); return
      }
      if (isChat && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setShowMessageSearch(true)
        return
      }
      if (event.key !== 'Escape') return
      if (isChat && showMessageSearch) {
        setShowMessageSearch(false)
        requestComposerFocus()
        return
      }
      if (isChat && confirmClear) {
        setConfirmClear(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [config.searchHotkey, confirmClear, isChat, onClose, requestComposerFocus, showMessageSearch, toolApprovalRequest, visible])



}
