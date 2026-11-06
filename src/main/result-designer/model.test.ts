import {expect,it} from 'vitest'
import {createBackgroundHarnesses} from '../harness/background'
import {createDesignModel} from './model'
import type {DesignBudget} from './budget'
it('blocks non-visual engines before any provider call without changing engine',()=>{
  expect(()=>createDesignModel({id:'result-designer',soul:'',conversation:'',config:null,backgroundHarnessEngine:'dsh'},createBackgroundHarnesses({home:"unused",node:"unused",helper:"unused"}),{} as DesignBudget,async()=>{})).toThrow(/不支持图片/)
})
