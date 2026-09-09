import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
const db=new Database(join(homedir(),'.local/share/opencode/opencode.db'),{readonly:true})
for(const id of ['ses_f88850097ffew70LUDSU8NQaV8','ses_f888b522affeDu6TlSf4cj7cb9']) {
 const s=db.query('select * from session_v2 where id=?').get(id) as any
 console.log(JSON.stringify({session:id,keys:Object.keys(s??{}),data:s?.data?JSON.parse(s.data):undefined}))
 const rows=db.query('select type,data from session_message where session_id=? order by time_created').all(id) as any[]
 console.log(JSON.stringify({session:id,observed:rows.filter(r=>r.type==='assistant').map(r=>{const d=JSON.parse(r.data);return {agent:d.agent,model:d.model,tools:(d.content??[]).filter((p:any)=>p.type==='tool').map((p:any)=>({name:p.name,status:p.state?.status}))}})}))
}
db.close()
