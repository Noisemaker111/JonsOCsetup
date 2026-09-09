import {test,expect} from 'bun:test'
import {join} from 'node:path'

test('event disconnect reconnects once and delivers later host outcomes',async()=>{
 // Other suites install the process-wide plugin singleton. Exercise a fresh host lifecycle.
 const child=Bun.spawn([process.execPath,'-e',String.raw`
  const {installQuestEvents}=await import('./quest/server.ts');
  const key=Symbol.for('opencode-config.quests.host-events');let connects=0;const events=[];
  installQuestEvents({event:{subscribe:async function*(){connects++;if(connects===1)throw Error('fixture connection lost');yield {type:'session.execution.succeeded',data:{sessionID:'ses_fixture'}};await new Promise(done=>globalThis[key].controller.signal.addEventListener('abort',done,{once:true}))}}},{onHostEvent:event=>events.push(event)});
  const end=Date.now()+2500;while(!events.length&&Date.now()<end)await Bun.sleep(20);
  globalThis[key].controller.abort();await Bun.sleep(20);console.log(JSON.stringify({connects,events}));
 `],{cwd:join(import.meta.dir,'..'),stdout:'pipe',stderr:'pipe',windowsHide:true})
 const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
 expect(code).toBe(0);expect(err).toContain('fixture connection lost');const result=JSON.parse(out);expect(result.connects).toBe(2);expect(result.events[0]?.type).toBe('session.execution.succeeded')
})
