import {httpHeaders} from './bitrix-headers-helper.mjs'; import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('a stalled invocation cannot trap later client loads or reuse an old identity',async()=>{
 let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const exports={},send=async()=>{const call=++calls;if(call===1)await gate;return Response.json({result:{ID:'900001',TITLE:'SYNTHETIC ONLY',UF_CRM_AI_IIN:call===1?'991231300003':''}});};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/crm/bitrix.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>n==='./http-headers'?httpHeaders:({validIin:value=>value==='991231300003'}),fetch:send,AbortSignal,Date,Map});
 const first=exports.readClientContext('900001','https://synthetic.invalid/rest/'),second=exports.readClientContext('900001','https://synthetic.invalid/rest/');
 assert.equal(calls,2);let timer;
 try{const fresh=await Promise.race([second,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('New load is stuck on the old request')),100);})]);assert.equal(fresh.iin,null);}finally{clearTimeout(timer);release();}
 assert.equal((await first).iin,'991231300003');
 assert.equal((await exports.readClientContext('900001','https://synthetic.invalid/rest/')).iin,null);assert.equal(calls,3,'Each invocation revalidates the CRM identity');
});
