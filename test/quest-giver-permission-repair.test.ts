import {test,expect} from 'bun:test'
import JSON5 from 'json5'
import {permissionRepair} from '../scripts/repair-quest-giver-permissions'
const actions=['project_discover','project_resolve','project_select','project_route','project_result','project_clone','project_route_status','project_verify','project_goal']
const selected={agents:{'quest-giver':{permissions:actions.map(action=>({action,resource:'*',effect:'allow'}))}}}
test('permission repair preserves unrelated dirty text, guards and model; repeat is a no-op',()=>{
 const text='// keep dirty comment\n'+JSON.stringify({providers:{custom:{value:'untouched'}},agents:{'quest-giver':{model:'user-choice',permissions:[{action:'*',resource:'*',effect:'deny'},{action:'quest',resource:'*',effect:'allow'}]}}},null,2)
 const plan=permissionRepair(text,selected),q=JSON5.parse(plan.text)
 expect(plan.changed).toBe(true);expect(plan.text.startsWith('// keep dirty comment')).toBe(true)
 expect(q.agents['quest-giver'].model).toBe('user-choice');expect(q.agents['quest-giver'].permissions[0].effect).toBe('deny')
 expect(q.providers.custom.value).toBe('untouched');expect(q.agents['quest-giver'].permissions.slice(2).map(p=>p.action)).toEqual(actions)
 expect(permissionRepair(plan.text,selected).changed).toBe(false)
 expect(()=>permissionRepair(text,{agents:{}})).toThrow('does not authorize')
})
