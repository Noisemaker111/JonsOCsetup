/** Literal read commands need neither a repository reservation nor dependencies.
 * Reject expressions, invocation, redirection, pipelines and command substitution.
 * This is classification only; native host filesystem permissions still apply. */
export function readOnlyShell(command:string):boolean{
 if(/[\r\n]/.test(command))return false
 const parts=command.trim().split(';')
 return parts.length>0&&parts.every(part=>{
  const tokens:string[]=[];let rest=part.trim()
  while(rest){
   const m=/^(?:'([^'\r\n]*)'|"([^"$\x60\r\n]*)"|([^\s'"$\x60|&<>{}();]+))(?:\s+|$)/.exec(rest)
   if(!m)return false
   tokens.push(m[1]??m[2]??m[3]);rest=rest.slice(m[0].length)
  }
  const name=tokens.shift()?.toLowerCase()
  if(name==='get-location')return tokens.length===0
  const flags=name==='get-content'?new Set(['-literalpath','-path','-totalcount','-head','-tail','-raw','-encoding']):name==='get-childitem'?new Set(['-literalpath','-path','-filter','-file','-directory','-name','-force','-recurse']):name==='rg'?new Set(['--files','-n','--line-number','-l','--files-with-matches','-f','--fixed-strings','-i','--ignore-case','--hidden','-g','--glob','--no-ignore','--json','--count','-c','--','--only-matching','-o']):undefined
  if(!flags||!tokens.length)return false
  // rg -f reads a pattern file, while -F is fixed strings; both are read-only.
  return tokens.every(token=>!token.startsWith('-')||flags.has(token.toLowerCase()))
 })
}
