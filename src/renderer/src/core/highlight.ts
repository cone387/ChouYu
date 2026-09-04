/**
 * Lightweight syntax highlighting for chat code blocks.
 *
 * Uses highlight.js core with a curated language set (keeps bundle small);
 * unknown languages fall back to plain text rendering by returning null.
 */
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)

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

/** Returns highlighted HTML, or null when the language is unknown/unsafe. */
export function highlightCode(code: string, language: string): string | null {
  const normalized = language.trim().toLowerCase()
  if (!normalized) return null
  const resolved = LANGUAGE_ALIASES[normalized] || normalized
  if (!hljs.getLanguage(resolved)) return null
  try {
    return hljs.highlight(code, { language: resolved }).value
  } catch {
    return null
  }
}
