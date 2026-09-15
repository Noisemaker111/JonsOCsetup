/**
 * @core-prevents temporary reviewer overload becoming a permanent permission escalation or retrying an uncertain native reply
 * @core-observed September 15 a native Luna reviewer overload left authorized README reads blocked until manual Allow once.
 */
import {expect,test} from 'bun:test'
import {permissionCapacityFailure,permissionReviewDue,type PermissionReview} from '../quest/permission-reviewer'

test('capacity retries preserve the permission boundary and honor saved delay and changed authority',()=>{
 const saved:PermissionReview={state:'retrying',authorizationKey:'original',reason:'Provider overloaded',attempt:2,retryAt:120000}
 const reopened=JSON.parse(JSON.stringify(saved))
 expect(permissionReviewDue(reopened,'original',119999)).toBe(false)
 expect(permissionReviewDue(reopened,'original',120000)).toBe(true)
 expect(permissionReviewDue(reopened,'changed',119999)).toBe(true)
 for(const state of ['unknown','reviewing','decided'] as const)expect(permissionReviewDue({...saved,state},'changed',120001)).toBe(false)
 expect(permissionReviewDue({...saved,state:'escalated'},'original',120001)).toBe(false)
 expect(permissionReviewDue({...saved,state:'escalated'},'changed',120001)).toBe(true)
 expect(permissionCapacityFailure(new Error('auth_unavailable (last upstream error: server_is_overloaded)'))).toBe(true)
 for(const error of ['auth_unavailable','quota exhausted','invalid API key','Reviewer returned an invalid decision','Permission reply outcome is uncertain'])expect(permissionCapacityFailure(new Error(error))).toBe(false)
})
