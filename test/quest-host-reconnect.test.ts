import {test,expect} from 'bun:test'
import {installQuestEvents} from '../quest/server'

test('event disconnect reconnects once and delivers later host outcomes',async()=>{
 const key=Symbol.for('opencode-config.quests.host-events'),state=globalThis as any
 const prior=state[key];if(prior?.installed)throw Error('Unexpected existing test subscription')
 let connects=0;const events:any[]=[]
 try{
  installQuestEvents({event:{subscribe:async function*(){connects++;if(connects===1)throw Error('fixture connection lost');yield {type:'session.execution.succeeded',data:{sessionID:'ses_fixture'}};await new Promise<void>(done=>state[key].controller.signal.addEventListener('abort',()=>done(),{once:true}))}}},{onHostEvent:(event:any)=>events.push(event)} as any)
  const end=Date.now()+2500;while(events.length===0&&Date.now()<end)await Bun.sleep(20)
  expect(connects).toBe(2);expect(events[0]?.type).toBe('session.execution.succeeded')
 }finally{state[key]?.controller.abort();await Bun.sleep(20);if(prior)state[key]=prior;else delete state[key]}
})
