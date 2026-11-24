import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { ResultSourceSnapshot } from '../../shared/result-design'
import { waitForRenderer } from './storage-smoke'

export async function runResultPortfolioSmoke(window: BrowserWindow, directory: string, source: ResultSourceSnapshot) {
  const js = (code: string) => window.webContents.executeJavaScript(code)
  const ref = { characterId: source.ref.ownerId, topicId: source.ref.taskId, version: Number(source.ref.sourceId) }
  await js(`new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('chouyu:contact-navigation',{detail:{target:{kind:'delivery',ref:${JSON.stringify(ref)}},handled:false,resolve,reject}})))`)
  await waitForRenderer(window, "document.querySelector('.contact-portfolio [data-result-a2ui] [data-reading-section]')?.getClientRects().length>0")
  assert.ok(await js("document.querySelector('.contact-portfolio [data-result-a2ui]').textContent.includes('第36段')"))
  await js("document.querySelector('.contact-portfolio [data-result-a2ui]').scrollIntoView({block:'start'})")
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  writeFileSync(join(directory,'adaptive-portfolio-entry.png'),(await window.webContents.capturePage()).toPNG())
  const point = await js(`(()=>{
    const article=document.querySelector('.contact-portfolio [data-reading-section]');let pane=article.parentElement;
    while(pane&&!(/auto|scroll/.test(getComputedStyle(pane).overflowY)&&pane.clientHeight>0))pane=pane.parentElement;
    pane=pane||document.scrollingElement;pane.scrollTop+=article.getBoundingClientRect().top-pane.getBoundingClientRect().top;
    window.__portfolioScroller=pane;window.__portfolioStart=pane.scrollTop;const r=pane.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}
  })()`)
  await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  window.webContents.sendInputEvent({type:'mouseMove',...point})
  window.webContents.sendInputEvent({type:'mouseWheel',deltaX:0,deltaY:-500,...point})
  await waitForRenderer(window,'window.__portfolioScroller.scrollTop>window.__portfolioStart+100')
  await waitForRenderer(window,`(async()=>{const p=await window.electronAPI.agents.deliveryReading(${JSON.stringify(ref.characterId)},${JSON.stringify(ref.topicId)});return p?.ref.version===${ref.version}&&p?.scrollRatio>0})()`)
  writeFileSync(join(directory,'adaptive-portfolio-reading.png'),(await window.webContents.capturePage()).toPNG())
  // Opening a revision draft validates the exact saved citation; cancel without submitting work.
  const quote=await js(`(()=>{const p=document.querySelector('.contact-portfolio [data-result-a2ui] .contact-markdown p'),range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);return p.textContent})()`)
  await js("document.querySelector('.contact-portfolio [data-delivery-revise]').click()")
  await waitForRenderer(window,"Boolean(document.querySelector('[data-contact-revision-dialog][open] .citation-quote'))")
  assert.equal(await js("document.querySelector('[data-contact-revision-dialog] .citation-quote').textContent"),quote)
  await js("[...document.querySelectorAll('[data-contact-revision-dialog] button')].find(b=>b.textContent==='取消').click()")
  await waitForRenderer(window,"!document.querySelector('[data-contact-revision-dialog]')")
  await js("document.querySelector('.contact-portfolio [data-portfolio-back]').click()")
  await waitForRenderer(window,"Boolean(document.querySelector('.contact-portfolio .portfolio-list'))&&!document.querySelector('.contact-portfolio [data-result-a2ui]')")
}
