/**
 * @core-prevents a waiting quota refresh overwriting a newer pacing record with a false clock-rollback hold
 * @core-observed On 2026-09-14 native Quest dispatch failed with Clock moved backwards while the clock advanced; two processes reproduced it through the production pacing lock.
 */
import {test,expect} from "bun:test"
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs"
import {tmpdir} from "node:os"
import {join} from "node:path"
import {updateBurnControls,decideBurnControl} from "../usage/burn-control"
import type {UsageTarget} from "../usage/usage-target"
test("a contending refresh samples live time after acquiring the ledger; real rollback still holds",async()=>{
 const root=mkdtempSync(join(tmpdir(),"burn-clock-test-")),now=Date.now()
 const target:UsageTarget={accountID:"fixture",deadlineAt:now+86400000,reservePoints:0,updatedAt:now-10000,pacing:{windowID:"weekly",maxConcurrent:1,regime:"fixture",resetAt:now+86400000}}
 writeFileSync(join(root,"target.json"),JSON.stringify(target))
 const child=Bun.spawn([process.execPath,join(import.meta.dir,"fixtures/burn-refresh-holder.ts"),root],{stdout:"pipe",stderr:"pipe"})
 try{
  const reader=child.stdout.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain("locked");reader.releaseLock()
  const before=Date.now();writeFileSync(join(root,"start"),"go")
  const control=updateBurnControls([],[],undefined,[target],join(root,"controls.json"))[0]
  expect(await child.exited).toBe(0)
  expect(control.updatedAt).toBeGreaterThan(before)
  expect(control.reason).toBe("Account is not currently connected")
  expect(JSON.parse(readFileSync(join(root,"controls.json"),"utf8"))[0]).toEqual(control)
  expect(decideBurnControl(target,undefined,[],control,control.updatedAt-1).reason).toBe("Clock moved backwards; refresh before dispatch")
 }finally{await child.exited;rmSync(root,{recursive:true,force:true})}
})
