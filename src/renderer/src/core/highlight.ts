/**
 * Lightweight syntax highlighting for chat code blocks.
 *
 * highlight.js and its language grammars are loaded lazily via dynamic
 * import, so conversations without code blocks never pay for them. Unknown
 * languages fall back to plain text rendering by resolving to null.
 */

const LANGUAGES = [
  'javascript', 'typescript', 'python', 'json', 'bash', 'css', 'xml', 'sql',
  'yaml', 'markdown', 'diff', 'go', 'rust', 'java', 'c', 'cpp'
] as const

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  html: 'xml', vue: 'xml', svg: 'xml',
  yml: 'yaml', md: 'markdown',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  golang: 'go', rs: 'rust'
}

const SUPPORTED = new Set<string>([...LANGUAGES, ...Object.keys(LANGUAGE_ALIASES)])

type HighlightFn = (code: string, resolvedLanguage: string) => string | null

let highlighterPromise: Promise<HighlightFn | null> | null = null

async function loadHighlighter(): Promise<HighlightFn | null> {
  try {
    const [core, ...languages] = await Promise.all([
      import('highlight.js/lib/core'),
      import('highlight.js/lib/languages/javascript'),
      import('highlight.js/lib/languages/typescript'),
      import('highlight.js/lib/languages/python'),
      import('highlight.js/lib/languages/json'),
      import('highlight.js/lib/languages/bash'),
      import('highlight.js/lib/languages/css'),
      import('highlight.js/lib/languages/xml'),
      import('highlight.js/lib/languages/sql'),
      import('highlight.js/lib/languages/yaml'),
      import('highlight.js/lib/languages/markdown'),
      import('highlight.js/lib/languages/diff'),
      import('highlight.js/lib/languages/go'),
      import('highlight.js/lib/languages/rust'),
      import('highlight.js/lib/languages/java'),
      import('highlight.js/lib/languages/c'),
      import('highlight.js/lib/languages/cpp')
    ])
    const hljs = core.default
    LANGUAGES.forEach((name, index) => {
      hljs.registerLanguage(name, languages[index].default)
    })
    return (code, resolvedLanguage) => {
      try {
        return hljs.highlight(code, { language: resolvedLanguage }).value
      } catch {
        return null
      }
    }
  } catch {
    return null
  }
}

function resolveLanguage(language: string): string | null {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return null
  return LANGUAGE_ALIASES[normalized] || normalized
}

/** True when the language is offered at all, without loading the highlighter. */
export function isSupportedLanguage(language: string): boolean {
  const resolved = resolveLanguage(language)
  return resolved !== null && SUPPORTED.has(resolved)
}

/**
 * Resolves to highlighted HTML, or null when the language is unknown, the
 * highlighter failed to load, or highlighting itself fails.
 */
export async function highlightCode(code: string, language: string): Promise<string | null> {
  const resolved = resolveLanguage(language)
  if (!resolved || !SUPPORTED.has(resolved)) return null
  highlighterPromise ??= loadHighlighter()
  const highlighter = await highlighterPromise
  if (!highlighter) return null
  return highlighter(code, resolved)
}
