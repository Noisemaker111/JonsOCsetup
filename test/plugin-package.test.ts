import { afterAll, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { importsOf, inside, planPackage, writePackage, type PluginPackage } from "../scripts/plugin-package"
const root = join(import.meta.dir,"..")
const fixtures: string[] = []
afterAll(() => { for(const dir of fixtures) rmSync(inside(join(root,".candidates"),dir),{recursive:true,force:true}) })
const fixture = () => { const dir=join(root,".candidates",`package-test-${crypto.randomUUID()}`);mkdirSync(join(dir,"quest"),{recursive:true});writeFileSync(join(dir,"LICENSE"),"MIT");fixtures.push(dir);return dir }
const spec: PluginPackage={schema:1,name:"opencode-test",description:"Test",server:"quest/server.ts",assets:[]}

test("package graph finds all import forms, without parsing comments or inventing React",()=>{
  expect(importsOf("entry.tsx",`// import "./fake"\nimport "./side"; export * from './export'; import type { T } from './types'; const p=import('./dynamic'); const q=require('./required'); const el=<box/>`)).toEqual(["./side","./export","./types","./dynamic","./required"])
})
test("missing transitive imports fail before a package is staged",()=>{
  const dir=fixture();writeFileSync(join(dir,"quest/server.ts"),`export * from './helper'`);writeFileSync(join(dir,"quest/helper.ts"),`import './missing'`)
  expect(()=>planPackage(dir,spec)).toThrow("Unresolved import: quest/helper.ts -> ./missing")
})
test("private config, outside paths and sibling checkout escapes are rejected",()=>{
  const dir=fixture();writeFileSync(join(dir,"quest/server.ts"),`import '../opencode.json'`);writeFileSync(join(dir,"opencode.json"),"{}")
  expect(()=>planPackage(dir,spec)).toThrow("Unapproved distribution input")
  expect(()=>inside(dir,"../other.ts")).toThrow("Path escapes")
  writeFileSync(join(dir,"quest/server.ts"),"export const ok=1")
  expect(()=>planPackage(dir,{...spec,assets:["quest/../opencode.json"]})).toThrow("Unapproved distribution input")
  expect(()=>planPackage(dir,{...spec,assets:["usage/usage-cache.json"]})).toThrow("Unapproved JSON asset")
})
test("package output is self-contained, records provenance and refuses overwrite",()=>{
  const dir=fixture();writeFileSync(join(dir,"quest/server.ts"),`export * from './helper'`);writeFileSync(join(dir,"quest/helper.ts"),`export const x=1`)
  const plan=planPackage(dir,spec),output=join(dir,"output");writePackage(dir,output,plan)
  expect(plan.files).toEqual(["quest/helper.ts","quest/server.ts"])
  expect(JSON.parse(readFileSync(join(output,"package.json"),"utf8")).exports["."]).toBe("./quest/server.ts")
  expect(JSON.parse(readFileSync(join(output,"distribution.json"),"utf8")).files).toHaveLength(2)
  expect(()=>writePackage(dir,output,plan)).toThrow("Refusing to overwrite")
})
test("all owned manifests including project-router resolve their full runtime dependency closure",()=>{
  const config=JSON.parse(readFileSync(join(root,"plugin-set.json"),"utf8"));expect(config.packages).toContain('project-router/plugin.json')
  for(const file of config.packages) {
    const plan=planPackage(root,JSON.parse(readFileSync(join(root,file),"utf8")))
    expect(plan.files).toContain(plan.spec.server)
    expect(plan.dependencies["@opencode-ai/plugin"]).toBeDefined()
    expect(plan.files).not.toContain("opencode.jsonc")
    if(plan.files.includes("usage/usage-lib.ts")) expect(plan.files).toContain("usage/usage-collector.ts")
    if(plan.spec.tui) expect(plan.files).toContain(plan.spec.tui)
  }
})
