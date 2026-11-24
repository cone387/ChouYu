import { resultDesignDocument, resultDesignPolicy } from '../../shared/result-design-document'
import { validateDesignCode, type ResultDesignCode, type ResultSourceSnapshot, type DesignEnvironment } from '../../shared/result-design'
import { createResultReadingSurface } from '../../shared/result-a2ui'

declare const __RESULT_READER_JS__: string
declare const __RESULT_READER_CSS__: string
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
const escape = (value: string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')

/** Both protocols use the same official SDK and React components as the task reader. */
export function resultPresentationDocument(source: ResultSourceSnapshot, input: ResultDesignCode, environment: DesignEnvironment, nonce: string,
  assets?: { script: string; css: string }): string {
  const code = validateDesignCode(input)
  if (!code.a2ui) return resultDesignDocument(source, code, environment, nonce)
  if (!/^[a-zA-Z0-9_-]+$/.test(nonce)) throw new Error('Invalid design nonce')
  const reading = createResultReadingSurface(source, code.a2ui)
  const bundle = assets ?? { script: __RESULT_READER_JS__, css: __RESULT_READER_CSS__ }
  return `<!doctype html><html lang="zh-CN" data-theme="${environment.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(resultDesignPolicy(nonce))}"><title>${escape(code.title)}</title><style>
*{box-sizing:border-box}body{margin:0;color:var(--text-primary);background:var(--bg-primary);font:16px/1.8 ${environment.font}}button{font:inherit}button,a{cursor:pointer}button{color:inherit}img,svg{max-width:100%}
${bundle.css.replace(/<\/style/gi,'<\\/style')}
</style></head><body><main id="result-root"></main><script nonce="${nonce}">
window.__resultReading=${json({source: {ref:reading.ref,title:reading.title,sections:reading.sections,fileIds:reading.fileIds},layout:reading.layout})};
const tokens=${json(environment.tokens)};for(const [key,value] of Object.entries(tokens))document.documentElement.style.setProperty(key,value);
for(const [key,target] of Object.entries({'--bg-primary':'--surface','--text-primary':'--text','--text-secondary':'--muted','--border':'--line','--bg-secondary':'--panel'}))document.documentElement.style.setProperty(key,'var('+target+')');
</script><script nonce="${nonce}">${bundle.script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`
}
