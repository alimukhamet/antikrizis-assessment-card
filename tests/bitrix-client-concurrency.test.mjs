import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
test('concurrent reads share a live request but every later read revalidates the CRM identity',async()=>{
 let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const exports={},send=async()=>{calls++;await gate;return Response.json({result:{ID:'900001',TITLE:'SYNTHETIC ONLY',UF_CRM_AI_IIN:calls===1?'991231300003':''}});};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/crm/bitrix.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({validIin:value=>value==='991231300003'}),fetch:send,AbortSignal,Date,Map});
 const first=exports.readClientContext('900001','https://synthetic.invalid/rest/'),second=exports.readClientContext('900001','https://synthetic.invalid/rest/');
 assert.equal(calls,1);release();assert.equal((await first).iin,'991231300003');assert.equal((await second).iin,'991231300003');
 assert.equal((await exports.readClientContext('900001','https://synthetic.invalid/rest/')).iin,null);assert.equal(calls,2,'No stale context cache may survive a completed request');
});
