import {test,expect} from "bun:test"
import {startValidationProvider} from "../scripts/validation-provider"
test("promotion fixture serves a unique receipt only for its exact local route",async()=>{
 const fixture=startValidationProvider();try{
 const wrong=await fetch(fixture.origin+"/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"real-provider-model"})});expect(wrong.status).toBe(400);expect(fixture.requests.count).toBe(0)
 const response=await fetch(fixture.origin+"/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"model",stream:true})}),body=await response.text();expect(body).toContain(fixture.receipt);expect(body).toContain("data: [DONE]");expect(fixture.requests.count).toBe(1)
 }finally{fixture.stop()}
})
