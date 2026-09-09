/** Read-only projection measurement over the existing canonical ledger. */
import {readAllQuests} from '../quest/index'
import {questRoot} from '../quest/root'
import {questView} from '../quest/contract'
import {toolSummary,toolDetail,toolSection} from '../quest/tool-projection'
const rows=readAllQuests(questRoot(),{includeArchived:true}),quests=rows.flatMap(r=>r.quest?[r.quest]:[])
const full=JSON.stringify(quests.map(questView)),compact=JSON.stringify(quests.slice(0,25).map(toolSummary)),largest=[...quests].sort((a,b)=>JSON.stringify(b).length-JSON.stringify(a).length)[0]
console.log(JSON.stringify({readOnly:true,records:quests.length,unreadable:rows.length-quests.length,fullListBytes:Buffer.byteLength(full),defaultPageBytes:Buffer.byteLength(compact),largestDefaultDetailBytes:largest?Buffer.byteLength(JSON.stringify(toolDetail(largest))):0,targetedSectionCharacters:largest?toolSection(largest.sessions,'runs').text.length:0,evidence:'Full evidence retained; inspect sections are paginated up to 12000 characters',transport:'Source projection called directly; no mutation, dispatch, or selected-generation claim'},null,2))
