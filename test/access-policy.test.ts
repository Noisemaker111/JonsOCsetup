import {expect,test} from "bun:test"
import {assertConfiguredModel,assertConfiguredRequest,installAccessGuard,type AccessPolicy} from "../models/access-policy"
import {assertSubscriptionRequest} from "../models/subscription-policy"
const policy:AccessPolicy={version:1,routes:[{providerID:"paid",modelPattern:"exact",transports:[{origin:"https://allowed.example",pathPrefix:"/v1/"}]}]}
test("configured access is fail-closed and allows an explicitly configured paid route",()=>{
 expect(()=>assertConfiguredModel({providerID:"paid",id:"exact"},policy)).not.toThrow()
 expect(()=>assertConfiguredModel({providerID:"free",id:"other"},policy)).toThrow("User access")
 expect(()=>assertConfiguredRequest({providerID:"paid",id:"exact"},"https://allowed.example/v1/chat",policy)).not.toThrow()
 expect(()=>assertConfiguredRequest({providerID:"paid",id:"exact"},"https://wrong.example/v1/chat",policy)).toThrow("transport")
 expect(()=>assertConfiguredRequest({providerID:"paid",id:"exact"},"https://allowed.example/private",policy)).toThrow("transport")
})
test("migrated policy preserves the previous model and origin boundaries",()=>{
 const cases=[{providerID:"openai",id:"gpt-6-astra",url:"https://chatgpt.com/backend-api/codex/responses"},{providerID:"cliproxyapi",id:"gpt-6-astra",url:"http://127.0.0.1:8317/v1/responses"},{providerID:"opencode",id:"muse-free",url:"https://opencode.ai/zen/v1/chat/completions"},{providerID:"openai",id:"gpt-6-astra",url:"https://api.openai.com/v1/responses"},{providerID:"xai",id:"grok",url:"https://api.x.ai/v1/chat/completions"}]
 const allowed=(fn:()=>unknown)=>{try{fn();return true}catch{return false}}
 for(const c of cases)expect(allowed(()=>assertConfiguredRequest(c,c.url))).toBe(allowed(()=>assertSubscriptionRequest(c,c.url,"http://127.0.0.1:8317")))
})
test("request guard registers at the actual host boundary",async()=>{let fn:Function|undefined;await installAccessGuard({session:{hook:async(name:string,handler:Function)=>{expect(name).toBe("http.request");fn=handler}}});expect(typeof fn).toBe("function")})
