import { existsSync, watch, type FSWatcher } from "node:fs"
import { join } from "node:path"
import { listQuestFiles } from "./index"
/** A first Quest may create the directory after the chat has mounted. */
export function watchQuests(projectRoot: string, onChange: (paths: string[]) => void, debounceMs = 100): () => void {
  const dir = join(projectRoot, ".opencode", "quests")
  let timer: ReturnType<typeof setTimeout> | undefined, pending = new Set<string>(), watcher: FSWatcher | undefined
  const attach=()=>{
    if(watcher||!existsSync(dir))return
    try {
      watcher=watch(dir,(_event,name)=>{
        if(name)pending.add(join(dir,String(name)))
        clearTimeout(timer)
        timer=setTimeout(()=>{const paths=[...pending];pending.clear();onChange(paths.filter(p=>listQuestFiles(projectRoot).includes(p)))},debounceMs)
      })
      onChange(listQuestFiles(projectRoot))
    }catch{return}
  }
  attach()
  const retry=setInterval(attach,500);retry.unref()
  return ()=>{clearInterval(retry);clearTimeout(timer);watcher?.close();pending.clear()}
}
