import {validateDesignCode,type ResultSourceSnapshot,type ResultDesignCode,type DesignEnvironment} from './result-design'
import {designEnvironment} from './result-design-environment'
export const resultDesignPolicy=(nonce:string)=>`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`
const json=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')
/** The same opaque document is used by preview and the production reader. */
export function resultDesignDocument(snapshot:ResultSourceSnapshot,input:ResultDesignCode,environment:DesignEnvironment,nonce:string):string {
  if(!/^[a-zA-Z0-9_-]+$/.test(nonce))throw new Error('Invalid design nonce')
  const code=validateDesignCode(input)
  return `<!doctype html><html lang="zh-CN" data-theme="${environment.theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(resultDesignPolicy(nonce))}"><title>${escape(code.title)}</title></head><body><main id="result-root"></main><script nonce="${nonce}">
(()=>{
 const data=${json(snapshot)},code=${json(code)},env=${json(environment)};
 const freeze=o=>{Object.values(o).forEach(v=>{if(v&&typeof v==='object')freeze(v)});return Object.freeze(o)};
 Object.defineProperty(window,'resultSource',{value:freeze(data),writable:false,configurable:false});
 const style=document.createElement('style');style.textContent='*{box-sizing:border-box}html{color-scheme:'+env.theme+'}body{margin:0;padding:24px;background:var(--surface);color:var(--text);font:17px/1.8 '+env.font+';overflow-wrap:anywhere}main{max-width:1120px;margin:auto}.result-body{white-space:pre-wrap;line-height:1.85}section[data-result-section]{scroll-margin-top:24px}button,input,select{font:inherit}button{cursor:pointer}img,svg{max-width:100%}@media(max-width:480px){body{padding:16px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}';
 document.head.append(style);for(const [k,v] of Object.entries(env.tokens))document.documentElement.style.setProperty(k,v);
 const themes=${json({light:designEnvironment(1024,'light').tokens,dark:designEnvironment(1024,'dark').tokens})};
 addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='result-design-theme'||!['light','dark'].includes(event.data.theme))return;const theme=event.data.theme;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;for(const [k,v] of Object.entries(themes[theme]))document.documentElement.style.setProperty(k,v)});
 const root=document.getElementById('result-root');root.innerHTML=code.html;
 const custom=document.createElement('style');custom.textContent=code.css;document.head.append(custom);
 for(const section of data.sections){
  let slot=[...root.querySelectorAll('[data-result-section]')].find(el=>el.dataset.resultSection===section.id);
  if(!slot){slot=document.createElement('section');slot.dataset.resultSection=section.id;root.append(slot)}
  slot.replaceChildren();const heading=document.createElement('h2');heading.textContent=section.title;
  const body=document.createElement('div');body.className='result-body';body.setAttribute('data-result-body',section.id);body.textContent=section.body;
  slot.append(heading,body);if(!slot.id)slot.id='section-'+section.id;
 }
 document.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link){event.preventDefault();const href=link.getAttribute('href');if(href?.startsWith('#'))document.getElementById(href.slice(1))?.scrollIntoView()}},true);
 document.addEventListener('submit',event=>event.preventDefault(),true);
 const failed=()=>parent.postMessage({type:'result-design-error',source:${json(snapshot.ref)},nonce:${json(nonce)}},'*');
 addEventListener('error',failed);addEventListener('unhandledrejection',failed);
 const script=document.createElement('script');script.nonce=${json(nonce)};script.textContent=code.script;document.body.append(script);
 if(parent!==window){
  // The task pane owns vertical scrolling. Measure intrinsic content, not the
  // iframe viewport (scrollHeight would prevent the frame from shrinking).
  const hostStyle=document.createElement('style');hostStyle.textContent='html,body{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important}html{overflow:hidden!important}';document.head.append(hostStyle);
  let pending=false,lastHeight=0,lastWidth=0,stopped=false;
  const changes=[];
  const reportSize=()=>{if(pending||stopped)return;pending=true;requestAnimationFrame(()=>{pending=false;
   const nested=[root,...root.querySelectorAll('*')].some(el=>{const style=getComputedStyle(el);return el.getClientRects().length&&/(auto|scroll)/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+1});
   const height=Math.ceil(Math.max(document.body.getBoundingClientRect().height,root.offsetTop+root.scrollHeight+parseFloat(getComputedStyle(document.body).paddingBottom)));
   if(nested){stopped=true;observer.disconnect();mutations.disconnect();failed();return}
   if(height!==lastHeight){const now=performance.now(),width=document.body.getBoundingClientRect().width,animating=document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime));
    if(width!==lastWidth||animating||Math.abs(innerHeight-lastHeight)>2)changes.length=0;
    else changes.push(now);
    while(changes.length&&changes[0]<now-1000)changes.shift();if(changes.length>20){stopped=true;observer.disconnect();mutations.disconnect();failed();return}
    lastWidth=width;lastHeight=height;parent.postMessage({type:'result-design-size',source:data.ref,height},'*')}
  })};
  const observer=new ResizeObserver(reportSize);observer.observe(document.body);observer.observe(root);reportSize();
  const mutations=new MutationObserver(reportSize);mutations.observe(root,{subtree:true,attributes:true,childList:true,characterData:true});
  addEventListener('keydown',event=>{if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.target.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="textbox"]'))return;const key=event.key;if(!['PageDown','PageUp','Home','End',' '].includes(key))return;event.preventDefault();parent.postMessage({type:'result-design-scroll',source:data.ref,key,shift:event.shiftKey},'*')});
 }
 setTimeout(()=>parent.postMessage({type:'result-design-ready',source:${json(snapshot.ref)}},'*'),0);
})();</script></body></html>`
}
