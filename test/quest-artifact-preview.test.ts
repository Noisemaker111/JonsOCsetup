import {expect,test} from 'bun:test'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {artifactPreview} from '../quest/artifact-preview'
const artifact=(path:string)=>({name:'Recorded deliverable',path,at:'2026-09-10T00:00:00Z',verified:true})
test('artifact text previews read bounded real content and redact secret values',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-preview-'));try{
  writeFileSync(join(root,'result.txt'),'Actual verification passed\npassword=not-for-display\nThird line\nFourth line\nFifth line\n'+ 'z'.repeat(10000))
  const preview=artifactPreview(artifact('result.txt'),[root])
  expect(preview.kind).toBe('Text');expect(preview.lines).toEqual(['Actual verification passed','[REDACTED]','Third line','Fourth line']);expect(preview.uri).toContain('result.txt')
  expect(artifactPreview(artifact('missing.txt'),[root]).lines).toEqual(['File unavailable in recorded workspace'])
  writeFileSync(join(root,'auth.json'),'private content')
  expect(artifactPreview(artifact('auth.json'),[root]).lines).toEqual(['Preview unavailable'])
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('recorded artifact paths cannot preview outside their workspace through relative paths or junctions',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-preview-path-'));try{
  const owned=join(root,'owned'),outside=join(root,'outside');mkdirSync(owned);mkdirSync(outside);writeFileSync(join(outside,'result.txt'),'Outside content')
  symlinkSync(outside,join(owned,'linked'),process.platform==='win32'?'junction':'dir')
  for(const path of ['../outside/result.txt','linked/result.txt',join(outside,'result.txt')])expect(artifactPreview(artifact(path),[owned]).uri).toBeUndefined()
 }finally{rmSync(root,{recursive:true,force:true})}
})
test('canonical Quest capture paths resolve from the ledger root within the allowed asset directory',()=>{
 const root=mkdtempSync(join(tmpdir(),'quest-preview-canonical-'));try{
  const assets=join(root,'.opencode','quests-assets','owned');mkdirSync(assets,{recursive:true});writeFileSync(join(assets,'capture.txt'),'Recorded actual capture');writeFileSync(join(root,'private.txt'),'Outside allowed assets');
  expect(artifactPreview(artifact('.opencode/quests-assets/owned/capture.txt'),[assets],root).lines).toEqual(['Recorded actual capture']);
  expect(artifactPreview(artifact('private.txt'),[assets],root).uri).toBeUndefined();
 }finally{rmSync(root,{recursive:true,force:true})}
})
