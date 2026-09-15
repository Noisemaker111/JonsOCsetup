// @core-prevents Child Quest timers and event subscriptions surviving generation teardown or partial setup failure.
// @core-observed The generation bootstrap discarded every child setup return, including Quest and project-router disposers, on 2026-09-15.
import {expect,test} from 'bun:test'
import {setupServerPlugins} from '../scripts/server-plugin-lifecycle'

test('generation cleanup releases every child once, even after another cleanup rejects', async()=>{
  const events:string[]=[]
  const dispose=await setupServerPlugins({} as any,[
    async()=>({setup:()=>()=>{events.push('quest')}}),
    async()=>({setup:()=>async()=>{events.push('router');throw Error('cleanup failure')}}),
  ],()=>{})
  await expect(dispose()).rejects.toThrow('Server plugin cleanup failed')
  await dispose()
  expect(events).toEqual(['router','quest'])
})

test('failed generation setup releases previously started children and keeps both errors', async()=>{
  let active=0
  const startup=Error('setup failure'),cleanup=Error('cleanup failure')
  const result=setupServerPlugins({} as any,[
    async()=>({setup:()=>{active++;return()=>{active--;throw cleanup}}}),
    async()=>{throw startup},
  ],()=>{})
  const error=await result.catch(error=>error)
  expect(active).toBe(0)
  expect(error.errors[0]).toBe(startup)
  expect(error.errors[1].errors[0]).toBe(cleanup)
})
