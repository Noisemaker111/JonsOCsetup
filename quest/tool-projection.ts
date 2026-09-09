import { compactQuestDetail, compactQuestSummary } from './context'
import type { Quest } from './types'
export function toolSummary(q:Quest){return {...compactQuestSummary(q),project:q.project,progress:{done:q.stages.filter(s=>s.status==='done').length,total:q.stages.length}}}
export function toolDetail(q:Quest){return {...compactQuestDetail(q),project:q.project,reward:q.reward?.slice(0,1200),steps:q.stages.slice(0,30).map(s=>({id:s.id,title:s.title.slice(0,160),state:s.status,note:s.note?.slice(0,400)})),inspect:'Use inspect.section with offset/limit for complete evidence, descriptions, steps, runs, artifacts, changes or continuation'} }
export function toolSection(value:unknown,section:string,offset=0,limit=8000){
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>12000)throw new Error('Invalid detail pagination')
 const text=JSON.stringify(value??null);return {section,offset,totalCharacters:text.length,text:text.slice(offset,offset+limit),nextOffset:offset+limit<text.length?offset+limit:null}
}
