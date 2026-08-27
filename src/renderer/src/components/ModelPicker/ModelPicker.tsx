import { useEffect, useId, useMemo, useRef, useState } from 'react'
import './ModelPicker.css'

export type ModelPickerStatus = 'loading' | 'ready' | 'unavailable'

interface ModelPickerProps {
  value?: string
  models: string[]
  status: ModelPickerStatus
  statusMessage?: string
  onChange: (model: string) => void
  onRefresh?: () => void
  onManualRequest?: () => void
  variant?: 'toolbar' | 'field'
  placement?: 'top' | 'bottom'
  invalid?: boolean
  id?: string
  describedBy?: string
  openRequest?: number
}

export function filterModels(models: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return models
  return models.filter((model) => model.toLowerCase().includes(normalizedQuery))
}

export default function ModelPicker({
  value,
  models,
  status,
  statusMessage,
  onChange,
  onRefresh,
  onManualRequest,
  variant = 'toolbar',
  placement = 'top',
  invalid = false,
  id,
  describedBy,
  openRequest
}: ModelPickerProps) {
  const generatedId = useId().replace(/:/g, '')
  const listboxId = `model-picker-list-${generatedId}`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filteredModels = useMemo(() => filterModels(models, query), [models, query])
  const [activeIndex, setActiveIndex] = useState(0)

  const openPicker = () => {
    setQuery('')
    const currentIndex = models.indexOf(value || '')
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0)
    setOpen(true)
  }

  const closePicker = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const chooseModel = (model: string) => {
    onChange(model)
    closePicker(true)
  }

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closePicker()
    }
    document.addEventListener('mousedown', dismiss)
    requestAnimationFrame(() => searchRef.current?.focus())
    return () => document.removeEventListener('mousedown', dismiss)
  }, [open])

  useEffect(() => {
    if (openRequest && openRequest > 0) openPicker()
  }, [openRequest])

  useEffect(() => {
    setActiveIndex((previous) => Math.min(previous, Math.max(0, filteredModels.length - 1)))
  }, [filteredModels.length])

  useEffect(() => {
    if (!open) return
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && filteredModels.length > 0) {
      event.preventDefault()
      setActiveIndex((previous) => (previous + 1) % filteredModels.length)
      return
    }
    if (event.key === 'ArrowUp' && filteredModels.length > 0) {
      event.preventDefault()
      setActiveIndex((previous) => (previous - 1 + filteredModels.length) % filteredModels.length)
      return
    }
    if (event.key === 'Enter' && filteredModels[activeIndex]) {
      event.preventDefault()
      chooseModel(filteredModels[activeIndex])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker(true)
    }
  }

  return (
    <div
      ref={rootRef}
      className={`searchable-model-picker searchable-model-picker-${variant}${open ? ' open' : ''}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`model-picker-trigger${invalid ? ' invalid' : ''}`}
        onClick={() => open ? closePicker(true) : openPicker()}
        onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'Enter', ' '].includes(event.key)) {
            event.preventDefault()
            openPicker()
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-label={`当前模型 ${value || 'AI'}${invalid ? '，当前不可用' : ''}，点击选择模型`}
        title={value || '选择模型'}
      >
        <span className="model-picker-trigger-label">{value || '选择模型'}</span>
        {invalid && <span className="model-picker-warning-dot" aria-hidden="true">!</span>}
        <svg className="model-picker-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M2 4l3 3 3-3"/>
        </svg>
      </button>

      {open && (
        <div className={`model-picker-popover placement-${placement}`}>
          <div className="model-picker-search-wrap">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>
            </svg>
            <input
              ref={searchRef}
              className="model-picker-search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
              onKeyDown={handleSearchKeyDown}
              placeholder={`搜索 ${models.length} 个模型…`}
              aria-label="搜索模型"
              aria-controls={listboxId}
              aria-activedescendant={filteredModels[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
            />
            {query && (
              <button type="button" className="model-picker-clear" onClick={() => { setQuery(''); setActiveIndex(0); searchRef.current?.focus() }} aria-label="清空模型搜索">×</button>
            )}
          </div>

          <div className="model-picker-summary">
            <span>{query ? `${filteredModels.length} 个匹配结果` : `${models.length} 个可用模型`}</span>
            {invalid && <span className="model-picker-current-invalid">当前模型不可用</span>}
          </div>

          <div id={listboxId} className="model-picker-list" role="listbox" aria-label="可用模型">
            {filteredModels.map((model, index) => (
              <button
                key={model}
                ref={(element) => { optionRefs.current[index] = element }}
                id={`${listboxId}-${index}`}
                type="button"
                className={`model-picker-option${model === value ? ' selected' : ''}${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseModel(model)}
                role="option"
                aria-selected={model === value}
                title={model}
              >
                <span>{model}</span>
                {model === value && (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7"/>
                  </svg>
                )}
              </button>
            ))}

            {filteredModels.length === 0 && status === 'loading' && (
              <div className="model-picker-empty" role="status">正在加载可用模型…</div>
            )}
            {filteredModels.length === 0 && status === 'ready' && (
              <div className="model-picker-empty">没有匹配“{query}”的模型</div>
            )}
            {status === 'unavailable' && models.length === 0 && (
              <div className="model-picker-empty model-picker-error" role="alert">
                <span>{statusMessage || '未获取到可用模型。'}</span>
                {onRefresh && <button type="button" onClick={onRefresh}>重新检查</button>}
              </div>
            )}
          </div>

          {onManualRequest && (
            <button
              type="button"
              className="model-picker-manual"
              onClick={() => { closePicker(); onManualRequest() }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 13l1-4L11.5 1.5a1.4 1.4 0 012 2L6 11l-3 2zM9.5 3.5l3 3"/>
              </svg>
              手动输入其他模型
            </button>
          )}
        </div>
      )}
    </div>
  )
}
