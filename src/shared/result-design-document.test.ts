import {expect,it} from 'vitest'
import {resultDesignDocument} from './result-design-document'
import {sourceSnapshot} from './result-design'
import {designEnvironment} from './result-design-environment'
it('projects authoritative prose as escaped text and isolates executable code',()=>{
  const source=sourceSnapshot({domain:'contact',ownerId:'a',taskId:'t'},'1','标题',[{id:'one',title:'第一节',body:'</script><img src=x onerror=alert(1)>',sources:[]}],[])
  const html=resultDesignDocument(source,{title:'阅读',html:'<section data-result-section="one"></section>',css:'body{background:var(--surface)}',script:'const x="</script>";'},designEnvironment(375,'dark'),'nonce')
  expect(html).toContain("connect-src 'none'")
  expect(html).toContain('data-result-body')
  expect(html).not.toContain('</script><img')
  expect(html).toContain('var(--surface)')
  expect(html).not.toContain('localStorage')
})
