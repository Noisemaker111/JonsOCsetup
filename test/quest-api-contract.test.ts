/**
 * @core-prevents a stripped legacy update reporting success without saving any requested change
 * @core-observed September 13 the real giver reported that nested update arguments became a successful no-op through Code Mode; the new methods use flat arguments.
 */
import {test,expect} from 'bun:test'
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv-provider.js'
import {questOperations} from '../quest/operations.mjs'

test('updates require a real change and reject the old nested envelope',()=>{
 const validate=new AjvJsonSchemaValidator().getValidator(questOperations.update.input)
 expect(validate({id:'quest'}).valid).toBe(false)
 expect(validate({id:'quest',update:{reward:'saved'}}).valid).toBe(false)
 expect(validate({id:'quest',reward:'saved'}).valid).toBe(true)
 expect(validate({id:'quest',workflow:{readOnly:true,task:'review'}}).valid).toBe(true)
})
