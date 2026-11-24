import { createRoot } from 'react-dom/client'
import ResultA2uiReader from './components/Contacts/ResultA2uiReader'
import type { ResultSourceSnapshot } from '../../shared/result-design'
import type { ResultReadingLayout } from '../../shared/result-reading-layout'

// Compiled into a self-contained, network-free preview asset by electron.vite.config.
const input = (window as unknown as { __resultReading: { source: ResultSourceSnapshot; layout: ResultReadingLayout } }).__resultReading
const root = document.getElementById('result-root')!
createRoot(root).render(<ResultA2uiReader source={input.source} layout={input.layout} onError={() => {
  root.dataset.readingError = 'true'
  console.error('成果组件预览失败。')
}} />)
// Preview links are visible evidence only. Real source navigation belongs to the app.
document.addEventListener('click', event => {
  if ((event.target as HTMLElement).closest('a,[data-delivery-source],.result-a2ui-sources button')) {
    event.preventDefault(); event.stopPropagation()
  }
}, true)
