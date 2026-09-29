import type { AgentDelivery } from './agent-delivery'

export const presentationPolicy = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Content and generated code never become markup in the trusted application. */
export function deliveryDocument(title: string, artifact: AgentDelivery, nonce: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(nonce)) throw new Error('Invalid presentation nonce')
  const { presentation, sections, version, summary, inputs } = artifact
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(presentationPolicy(nonce))}"><title>${escape(title)}</title><style>
  :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,40px);font:17px/1.9 'Noto Serif SC','Songti SC',SimSun,serif;background:light-dark(#fff,#202124);color:light-dark(#242424,#eee);overflow-wrap:anywhere}main{max-width:42em;margin:auto}h1{font-size:1.7em}h2{font-size:1.3em}article{margin:2em 0}article .body{white-space:pre-wrap}img,svg{max-width:100%}button,input,select{font:inherit;max-width:100%}:focus-visible{outline:2px solid #497fb5;outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  </style></head><body><main id="root"></main><script nonce="${nonce}">
  (()=>{
    const data=${json({ title, version, summary, inputs: inputs ?? [], sections })};
    const presentation=${json(presentation ?? null)};
    const root=document.getElementById('root');
    const send=(state)=>parent.postMessage({type:'delivery-preview',state},'*');
    addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='delivery-theme'&&['light','dark'].includes(e.data.theme)){document.documentElement.style.colorScheme=e.data.theme;document.documentElement.dataset.theme=e.data.theme}});
    addEventListener('error',()=>send('error'));addEventListener('unhandledrejection',()=>send('error'));
    // No navigation, downloads, form submission or host bridge in generated views.
    document.addEventListener('click',e=>{if(e.target.closest?.('a'))e.preventDefault()},true);
    document.addEventListener('submit',e=>e.preventDefault(),true);
    Object.defineProperty(window,'delivery',{value:data,writable:false});
    if(presentation){root.innerHTML=presentation.html;const style=document.createElement('style');style.textContent=presentation.css;document.head.append(style)}
    let content=document.getElementById('content');
    if(!content){content=document.createElement('div');content.id='content';root.append(content)}
    const heading=document.createElement('h1');heading.textContent=data.title;content.append(heading);
    for(const section of data.sections){const article=document.createElement('article');article.dataset.sectionId=section.id;const h=document.createElement('h2');h.textContent=section.title;const body=document.createElement('div');body.className='body';body.textContent=section.body;article.append(h,body);content.append(article)}
    if(presentation?.script){const script=document.createElement('script');script.nonce=${json(nonce)};script.textContent=presentation.script;document.body.append(script)}
    send('ready');
  })();</script></body></html>`
}

export function deliveryHtmlExport(title: string, artifact: AgentDelivery, nonce: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(presentationPolicy(nonce))}"><title>${escape(title)}</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style><iframe title="${escape(title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escape(deliveryDocument(title, artifact, nonce))}"></iframe></html>`
}
