import {describe,expect,it} from 'vitest'
import {readingScrollRatio,readingScrollTop} from './deliveryScroll'

describe('reading in the shared task scroll pane',()=>{
  const article={top:180,height:1800},viewport=600
  it('measures progress inside the article, excluding surrounding task controls',()=>{
    expect(readingScrollRatio(0,viewport,article)).toBe(0)
    expect(readingScrollRatio(780,viewport,article)).toBe(.5)
    expect(readingScrollRatio(2200,viewport,article)).toBe(1)
  })
  it('restores the same passage when the toolbar or viewport changes size',()=>{
    expect(readingScrollTop(.5,400,{top:240,height:1800})).toBe(940)
    expect(readingScrollRatio(940,400,{top:240,height:1800})).toBe(.5)
  })
  it('keeps short sections and out-of-range positions finite',()=>{
    expect(readingScrollRatio(500,600,{top:180,height:200})).toBe(0)
    expect(readingScrollTop(2,600,article)).toBe(1380)
    expect(readingScrollTop(-1,600,article)).toBe(180)
  })
})
