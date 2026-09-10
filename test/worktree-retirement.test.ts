import {test,expect} from 'bun:test'
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {git,removeIntegratedWorktree,registeredWorktrees,pathKey} from '../quest/cleanup-git.mjs'

test('retirement preserves unique work, unknown ignored files and locked trees; removes only integrated disposable checkouts',()=>{
 const root=realpathSync.native(mkdtempSync(join(tmpdir(),'retirement-')))
 try{
  git(root,['init']);git(root,['config','user.email','test@example.invalid']);git(root,['config','user.name','Test'])
  writeFileSync(join(root,'.gitignore'),'node_modules/\n.env\n');writeFileSync(join(root,'file'),'base');git(root,['add','.gitignore','file']);git(root,['commit','-m','base'])
  const path=join(root,'.worktrees','task');git(root,['worktree','add','-b','task',path]);const options={root,path,ref:'refs/heads/master'}
  options.ref=git(root,['symbolic-ref','HEAD'])
  expect(registeredWorktrees(root).map(row=>pathKey(row.worktree))).toContain(pathKey(path))
  writeFileSync(join(path,'file'),'work');expect(removeIntegratedWorktree(options).removed).toBe(false)
  git(path,['add','file']);git(path,['commit','-m','work']);expect(removeIntegratedWorktree(options).removed).toBe(false)
  git(root,['merge','--ff-only','task']);writeFileSync(join(path,'.env'),'private');expect(removeIntegratedWorktree(options).reason).toContain('Ignored')
  rmSync(join(path,'.env'));git(root,['worktree','lock',path]);expect(removeIntegratedWorktree(options).removed).toBe(false);git(root,['worktree','unlock',path])
  mkdirSync(join(path,'node_modules'));writeFileSync(join(path,'node_modules','cache'),'disposable')
  expect(removeIntegratedWorktree(options).removed).toBe(true);expect(existsSync(path)).toBe(false);expect(git(root,['rev-parse','task'])).toBe(git(root,['rev-parse','HEAD']))
 }finally{rmSync(root,{recursive:true,force:true})}
})
