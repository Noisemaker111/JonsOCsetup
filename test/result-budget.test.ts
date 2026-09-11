/**
 * @core-prevents an oversized or clamp-truncated tool result entering the conversation, where it is re-sent every later turn as unparseable JSON
 * @core-observed The host's 51,200-byte tool-output clamp cut quest and usage snapshots mid-structure, leaving ~12,800 tokens of invalid JSON resident and opening sessions above 20,000 tokens (2026-09-11).
 */
import {test,expect} from 'bun:test'
import {applyResultBudget,budgetText,DEFAULT_RESULT_BUDGET} from '../models/result-budget'

const {maxCharacters,structuredCharacters}=DEFAULT_RESULT_BUDGET

test('an oversized structured result enters the conversation bounded, parseable and complete in shape',()=>{
 // Shaped like the account snapshot a Quest Giver opens with: a few decision fields beside one
 // enormous per-session tally. Code Mode hands the hook the pretty-printed form.
 const snapshot={schema:1,plan:{name:'max',multiplier:5},windows:[{id:'five_hour',usedPercent:12},{id:'seven_day',usedPercent:54}],
  sessionBurn:Array.from({length:4000},(_,i)=>({sessionID:'ses_'+i,input:i*13,output:i,note:'x'.repeat(120)}))}
 const raw=JSON.stringify(snapshot,null,2)
 expect(raw.length).toBeGreaterThan(600000)
 const budgeted=budgetText(raw,'execute')
 expect(budgeted.length).toBeLessThanOrEqual(structuredCharacters)
 // Invalid JSON is what a blind character cut produces, and it is what the model then has to read.
 const value=JSON.parse(budgeted)
 expect(value.plan).toEqual(snapshot.plan)
 expect(value.windows).toEqual(snapshot.windows)
 expect(JSON.stringify(value.sessionBurn)).toContain('more entries elided')
 expect(value.resultBudget).toContain('return only the fields you need')

 // Indentation carries nothing, so a result that fits once compacted keeps every byte of meaning.
 const small={items:Array.from({length:200},(_,i)=>({id:i,title:'step '+i}))}
 const pretty=JSON.stringify(small,null,2)
 expect(pretty.length).toBeGreaterThan(structuredCharacters)
 expect(JSON.stringify(small).length).toBeLessThanOrEqual(structuredCharacters)
 expect(JSON.parse(budgetText(pretty,'execute'))).toEqual(small)

 // Prose has no shape to trade away, so it keeps the head, the tail and a marker naming the tool.
 const prose='a'.repeat(200000)
 const clipped=budgetText(prose,'read')
 expect(clipped.length).toBeLessThanOrEqual(maxCharacters)
 expect(clipped).toContain('call read again with offset and limit')

 // Only completed results are budgeted, and non-text parts are never touched.
 const event={status:'completed',tool:'execute',result:{content:[{type:'text',text:raw},{type:'file',uri:'data:image/png;base64,AAAA'}]}}
 expect(applyResultBudget(event)).toBeGreaterThan(0)
 expect(event.result.content[0].text.length).toBeLessThanOrEqual(structuredCharacters)
 expect(event.result.content[1]).toEqual({type:'file',uri:'data:image/png;base64,AAAA'})
 expect(applyResultBudget({status:'error',tool:'execute',result:{content:[{type:'text',text:raw}]}})).toBe(0)
})
