// Reused from the newer Quest interaction adapter.
/** Minimal validator for the JSON Schema vocabulary used by these tools, also used by raw stdio callers. */
export function validateToolSchema(value,schema,path="request") {
 const fail=message=>{throw Object.assign(new Error(path+": "+message),{code:"INVALID_INPUT"})}
 if(schema.anyOf){if(!schema.anyOf.some(option=>{try{validateToolSchema(value,option,path);return true}catch{return false}}))fail("does not match a supported shape");return}
 if(schema.enum&&!schema.enum.includes(value))fail("expected "+schema.enum.join(" | "))
 if(schema.type==="object"){
  if(value===null||typeof value!=="object"||Array.isArray(value))fail("expected an object")
  for(const key of schema.required??[])if(!(key in value))fail("missing "+key)
  for(const [key,child] of Object.entries(value)){if(schema.additionalProperties===false&&!(key in (schema.properties??{})))fail("unsupported field "+key);if(schema.properties?.[key])validateToolSchema(child,schema.properties[key],path+"."+key)}
 }else if(schema.type==="array"){
  if(!Array.isArray(value))fail("expected an array")
  if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)fail("invalid item count")
  if(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)fail("duplicate items")
  value.forEach((item,index)=>validateToolSchema(item,schema.items,path+"["+index+"]"))
 }else if(schema.type==="integer"){
  if(!Number.isInteger(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum)fail("invalid integer")
 }else if(schema.type==="null"){if(value!==null)fail("expected null")}
 else if(schema.type&&typeof value!==schema.type)fail("expected "+schema.type)
 if(typeof value==="string"&&(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength))fail("invalid text length")
}
