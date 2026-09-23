import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
class RepositoryError extends Error {constructor(code,status=409){super(code);this.status=status;}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/questionnaire/submission-recovery.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>({
 '../documents/repository':{RepositoryError},'../worker-session':{WORKERS:{ali:'Ali',darkhan:'Darkhan'}},'./draft':{validateDraft:structuredClone},
}[n])});
function input(){const draft={answers:[{key:'test',value:'unchanged'}],documents:[{documentId:'d'}],pendingFiles:[]};return{actor:{worker:'ali',id:'worker:ali'},record:{id:'case',identity_revision:1},row:{case_id:'case',actor_id:'worker:darkhan',authentication:'shared-password-worker-selection',identity_revision:1,payload_hash:'a'.repeat(64),state:'prepared',payload_json:JSON.stringify({draft})},expectedHash:'a'.repeat(64),latestDraft:{identity_revision:1,payload_json:JSON.stringify(draft)},repository:{credentialStatus:async()=>({verified:true,passwordStored:true})}};}
test('owner recovery preserves employee authorship and requires the exact immutable intent',async()=>{
 const s=input(),before=JSON.stringify(s.row);assert.equal((await exports.authorizeSubmissionRecovery(s)).id,'worker:darkhan');assert.equal(JSON.stringify(s.row),before);
 for(const changed of [{actor:{worker:'darkhan'}},{expectedHash:'b'.repeat(64)},{record:{id:'other',identity_revision:1}},{record:{id:'case',identity_revision:2}},{row:{...s.row,state:'cancelled'}}])await assert.rejects(exports.authorizeSubmissionRecovery({...s,...changed}));
});
test('recovery refuses changed answers, documents and ordinary pending files',async()=>{
 for(const change of [d=>d.answers[0].value='changed',d=>d.documents.push({documentId:'new'}),d=>d.pendingFiles.push('missing.pdf')]){
  const s=input(),d=JSON.parse(s.latestDraft.payload_json);change(d);s.latestDraft.payload_json=JSON.stringify(d);await assert.rejects(exports.authorizeSubmissionRecovery(s),/RECOVERY_DRAFT_CHANGED/);
 }
 const s=input(),d=JSON.parse(s.latestDraft.payload_json);d.pendingFiles=['legacy.key'];s.latestDraft.payload_json=JSON.stringify(d);
 await exports.authorizeSubmissionRecovery(s);s.repository.credentialStatus=async()=>null;await assert.rejects(exports.authorizeSubmissionRecovery(s),/RECOVERY_DRAFT_CHANGED/);
});
test('uncertain writes may only continue their saved reconciliation despite later draft edits',async()=>{
 const s=input();s.row.state='uncertain';s.latestDraft=null;assert.equal((await exports.authorizeSubmissionRecovery(s)).id,'worker:darkhan');
});
