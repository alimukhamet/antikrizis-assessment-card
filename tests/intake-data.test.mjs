import {test} from 'node:test';import assert from 'node:assert/strict';import {normalizeIntake} from '../public/intake-data.mjs';
const payload=keys=>({schemaVersion:1,answers:keys.map(key=>({key:'holding:client:'+key,value:key,checked:true})),groups:[],documents:[{documentId:'unchanged'}]});
const checked=(p,key)=>p.answers.find(a=>a.key==='holding:client:'+key)?.checked;
test('legacy combined answers migrate once without changing the original payload or losing metadata',()=>{
 for(const [keys,none,businessNone] of [[['none'],true,true],[['car'],undefined,true],[['ip'],true,false],[['car','ip'],undefined,false],[['unknown'],undefined,false],[[],undefined,false]]){
  const p=payload(keys),before=JSON.stringify(p),m=normalizeIntake(p);assert.equal(checked(m,'none'),none);assert.equal(checked(m,'businessNone'),businessNone);assert.equal(JSON.stringify(p),before);assert.deepEqual(normalizeIntake(m),m);assert.deepEqual(m.documents,p.documents);
 }
});
test('new unanswered business question is never inferred from property',()=>{
 const p=payload(['car']);p.answers.push({key:'holding:client:businessNone',value:'businessNone',checked:false});assert.equal(checked(normalizeIntake(p),'businessNone'),false);
});
