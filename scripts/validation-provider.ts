import {randomUUID} from "node:crypto"
export const VALIDATION_MODEL = "validation-fixture/model"
/** Deterministic local host-load probe. Never forwards a request or uses an account credential. */
export function startValidationProvider(){
 const receipt="VALID_"+randomUUID().replaceAll("-",""),requests:{count:number}={count:0}
 const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  if(request.method!=="POST"||new URL(request.url).pathname!=="/v1/chat/completions")return new Response("Not found",{status:404})
  let body:any;try{body=await request.json()}catch{return new Response("Invalid JSON",{status:400})}
  if(body.model!=="model")return new Response("Unexpected fixture model",{status:400})
  requests.count++
  const base={id:"fixture-"+requests.count,model:"model",created:Math.floor(Date.now()/1000)}
  if(!body.stream)return Response.json({...base,object:"chat.completion",choices:[{index:0,message:{role:"assistant",content:receipt},finish_reason:"stop"}]})
  const chunk={...base,object:"chat.completion.chunk",choices:[{index:0,delta:{role:"assistant",content:receipt},finish_reason:"stop"}]}
  return new Response("data: "+JSON.stringify(chunk)+"\n\ndata: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}})
 }})
 return {receipt,requests,origin:"http://127.0.0.1:"+server.port,stop:()=>server.stop(true)}
}
