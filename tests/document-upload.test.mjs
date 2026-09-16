import{test}from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import vm from'node:vm';import ts from'typescript';import{createHash}from'node:crypto';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../lib/crm/document-upload.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({sha256:async bytes=>createHash('sha256').update(bytes).digest('hex')}),Map,Set,Uint8Array,AbortSignal,btoa,TextEncoder,ReadableStream});const{readFileField,createDocumentUploadAdapter}=exports;
function fixture(options={}){let refs=[{id:'11'}],iin='000000000010';const writes=[],bytes=new Map([['22',new Uint8Array([1,2,3])]]);const send=async(url,init)=>{const body=JSON.parse(typeof init.body==='string'?init.body:await new Response(init.body).text());assert.equal(body.id,'11665');assert.equal(body.entityTypeId,2);if(url.endsWith('crm.item.update.json')){writes.push(body.fields);refs=options.removeOld?[{id:'22'}]:[{id:'11'},{id:'22'}];if(options.changeIdentity)iin='000000000020';if(options.loseResponse)throw Error('lost response after write');}return Response.json({result:{item:{id:11665,ufCrmAiIin:iin,ufCrmAnkPrimaryDocs:refs}}});};const readFile=async ref=>{if(options.unreadable)throw Error('offline');return options.wrongBytes?new Uint8Array([9]):bytes.get(ref.id);};return{adapter:createDocumentUploadAdapter('https://synthetic.invalid/',readFile,send),writes};}
const baseline=[{id:'11'}],files=[{name:'SYNTHETIC.pdf',bytes:new Uint8Array([1,2,3])}];
test('existing mixed reference formats preserved; unrecognized or ambiguous fields block updates',()=>{assert.deepEqual(Array.from(readFileField({UF_CRM_ANK_PRIMARY_DOCS:[12,'13',{ID:14}]}).refs,r=>r.id),['12','13','14']);for(const value of [[{url:'unknown'}],[''],[{id:0}]])assert.throws(()=>readFileField({ufCrmAnkPrimaryDocs:value}),/EXISTING_FILE_REFERENCE_UNVERIFIED/);assert.throws(()=>readFileField({ufCrmAnkPrimaryDocs:[],UF_CRM_ANK_PRIMARY_DOCS:[]}),/DOCUMENT_FIELD_UNVERIFIED/);});
test('append changes only file field and verifies uploaded byte hash',async()=>{const f=fixture();const r=await f.adapter.append('11665','000000000010',baseline,files);assert.equal(r.verified,true);assert.deepEqual(Object.keys(f.writes[0]),['ufCrmAnkPrimaryDocs']);assert.deepEqual(f.writes[0].ufCrmAnkPrimaryDocs[0],{id:'11'});assert.equal(f.writes[0].ufCrmAnkPrimaryDocs[1][1],'AQID');assert.equal(r.files[0].sha256,createHash('sha256').update(files[0].bytes).digest('hex'));});
test('lost response is reconciled without a second upload; blind retry stops at changed baseline',async()=>{const f=fixture({loseResponse:true});assert.equal((await f.adapter.append('11665','000000000010',baseline,files)).verified,true);await assert.rejects(f.adapter.append('11665','000000000010',baseline,files),/DOCUMENTS_CHANGED_IN_CRM/);assert.equal(f.writes.length,1);});
test('missing retained file, identity change, different bytes and unavailable download never report success',async()=>{for(const [option,code]of [[{removeOld:true},'EXISTING_FILE_MISSING'],[{changeIdentity:true},'CASE_IDENTITY_CHANGED_AFTER'],[{wrongBytes:true},'UPLOAD_CONTENT_MISMATCH'],[{unreadable:true},'UPLOAD_CONTENT_READBACK_UNCERTAIN']]){const f=fixture(option);await assert.rejects(f.adapter.append('11665','000000000010',baseline,files),new RegExp(code));}});
test('wrong client, stale baseline and duplicate bytes stop before CRM mutation',async()=>{for(const args of [['000000000020',baseline,files],['000000000010',[],files],['000000000010',baseline,[...files,...files]]]){const f=fixture();await assert.rejects(f.adapter.append('11665',...args));assert.equal(f.writes.length,0);}});
test('streamed payload preserves Base64 boundaries, Unicode names and retained IDs',async()=>{for(const length of [1,2,3,6143,6144,6145,12291]){const bytes=Uint8Array.from({length},(_,i)=>i%251);const body=await new Response(exports.uploadBody('11665','ufCrmAnkPrimaryDocs',[{id:'11'}],[{name:'Тест "пример".pdf',bytes}])).json();assert.equal(body.id,'11665');assert.deepEqual(body.fields.ufCrmAnkPrimaryDocs[0],{id:'11'});assert.equal(body.fields.ufCrmAnkPrimaryDocs[1][0],'Тест "пример".pdf');assert.equal(body.fields.ufCrmAnkPrimaryDocs[1][1],Buffer.from(bytes).toString('base64'));}});
test('maximum batch streams in bounded chunks without collecting the expanded body',async()=>{const bytes=new Uint8Array(35*1024*1024),reader=exports.uploadBody('11665','ufCrmAnkPrimaryDocs',[],[{name:'SYNTHETIC.pdf',bytes}]).getReader();let total=0,max=0;for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;max=Math.max(max,value.length);}const overhead=Buffer.byteLength(JSON.stringify({entityTypeId:2,id:'11665',fields:{ufCrmAnkPrimaryDocs:[['SYNTHETIC.pdf','']]}}));assert.equal(total,overhead+4*Math.ceil(bytes.length/3));assert.ok(max<=8192,max);});
test('cancelled body does not encode remaining file data',async()=>{let encodings=0;const bytes={length:35*1024*1024,subarray(){encodings++;return new Uint8Array(6144);}};const reader=exports.uploadBody('11665','ufCrmAnkPrimaryDocs',[],[{name:'TEST.pdf',bytes}]).getReader();await reader.read();await reader.cancel();assert.equal(encodings,0);});
test('later recovery verifies durable metadata after unavailable readback without resending',async()=>{
 const options={unreadable:true},f=fixture(options);
 await assert.rejects(f.adapter.append('11665','000000000010',baseline,files),/UPLOAD_CONTENT_READBACK_UNCERTAIN/);
 options.unreadable=false;
 const intended=files.map(file=>({name:file.name,sha256:createHash('sha256').update(file.bytes).digest('hex'),byteSize:file.bytes.length}));
 const receipt=await f.adapter.reconcile('11665','000000000010',baseline,intended);
 assert.equal(receipt.verified,true);assert.equal(receipt.files[0].id,'22');assert.equal(f.writes.length,1);
 await assert.rejects(f.adapter.reconcile('11665','000000000010',baseline,intended.map(file=>({...file,byteSize:4}))),/UPLOAD_CONTENT_MISMATCH/);
 assert.equal(f.writes.length,1);
});
test('recovery of an upload with no matching CRM files remains uncertain and never writes',async()=>{
 const f=fixture(),intended=[{name:'SYNTHETIC.pdf',sha256:createHash('sha256').update(files[0].bytes).digest('hex'),byteSize:3}];
 await assert.rejects(f.adapter.reconcile('11665','000000000010',baseline,intended),/UPLOAD_REFERENCE_COUNT_MISMATCH/);
 await assert.rejects(f.adapter.reconcile('11665','000000000020',baseline,intended),/CASE_IDENTITY_CHANGED_AFTER_UPLOAD/);
 assert.equal(f.writes.length,0);
});

test('changed selection reuses a verified existing file and uploads only new bytes',async()=>{
 const old=new Uint8Array([1,2,3]),fresh=new Uint8Array([4,5,6]);
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 let refs=[{id:'11'},{id:'22'}],writes=0;const stored=new Map([['22',old],['33',fresh]]);
 const send=async(url,init)=>{if(url.endsWith('crm.item.update.json')){writes++;const body=await new Response(init.body).json();assert.equal(body.fields.ufCrmAnkPrimaryDocs.length,3);assert.equal(body.fields.ufCrmAnkPrimaryDocs[2][1],'BAUG');refs=[...refs,{id:'33'}];}return Response.json({result:{item:{id:11665,ufCrmAiIin:'000000000010',ufCrmAnkPrimaryDocs:refs}}});};
 const adapter=createDocumentUploadAdapter('https://synthetic.invalid/',async ref=>stored.get(ref.id),send),base=refs.slice(),reuse=[{id:'22',sha256:digest(old),byteSize:3}],selection=[{name:'old.pdf',bytes:old},{name:'new.pdf',bytes:fresh}];
 const result=await adapter.append('11665','000000000010',base,selection,reuse);assert.equal(writes,1);assert.deepEqual(Array.from(result.files,f=>f.id),['22','33']);
 const intended=selection.map(f=>({name:f.name,sha256:digest(f.bytes),byteSize:f.bytes.length}));
 assert.equal((await adapter.reconcile('11665','000000000010',base,intended,reuse)).verified,true);assert.equal(writes,1);
});
test('all-existing selection is verified without a write, and changed existing bytes stop reuse',async()=>{
 const bytes=new Uint8Array([1,2,3]),hash=createHash('sha256').update(bytes).digest('hex');let writes=0,current=bytes;
 const send=async(url)=>{if(url.endsWith('crm.item.update.json'))writes++;return Response.json({result:{item:{id:11665,ufCrmAiIin:'000000000010',ufCrmAnkPrimaryDocs:[{id:'22'}]}}});};
 const adapter=createDocumentUploadAdapter('https://synthetic.invalid/',async()=>current,send),base=[{id:'22'}],reuse=[{id:'22',sha256:hash,byteSize:3}];
 assert.equal((await adapter.append('11665','000000000010',base,files,reuse)).verified,true);assert.equal(writes,0);
 current=new Uint8Array([9,9,9]);await assert.rejects(adapter.append('11665','000000000010',base,files,reuse),/REUSED_UPLOAD_CONTENT_CHANGED/);assert.equal(writes,0);
});

test('preflight failure proves no send; post-write readback failure never grants resend permission',async()=>{
 let updates=0;
 const adapter=createDocumentUploadAdapter('https://synthetic.invalid/',async()=>{throw Error('unavailable')},async(url)=>{if(url.includes('update'))updates++;throw Error('read unavailable');});
 await assert.rejects(adapter.append('11665','000000000010',baseline,files),e=>e.notStarted===true&&e.code==='BITRIX_READ_TEMPORARILY_UNAVAILABLE');
 assert.equal(updates,0);
 const f=fixture({unreadable:true});
 await assert.rejects(f.adapter.append('11665','000000000010',baseline,files),e=>e.notStarted===false&&e.code==='UPLOAD_CONTENT_READBACK_UNCERTAIN');
 assert.equal(f.writes.length,1);
});

test('transient metadata failure retries a fresh read, while writes are never retried',async()=>{
 let reads=0,writes=0;const signals=[];
 const send=async(url,init)=>{
  if(url.endsWith('crm.item.update.json')){writes++;throw Error('write response lost');}
  reads++;signals.push(init.signal);if(reads===2)throw Error('stalled read');
  return Response.json({result:{item:{id:11665,ufCrmAiIin:'000000000010',ufCrmAnkPrimaryDocs:reads===1?baseline:[...baseline,{id:'22'}]}}});
 };
 const adapter=createDocumentUploadAdapter('https://synthetic.invalid/',async()=>files[0].bytes,send);
 assert.equal((await adapter.append('11665','000000000010',baseline,files)).verified,true);
 assert.equal(reads,3);assert.equal(writes,1);assert.notEqual(signals[1],signals[2]);
});
test('read retries are bounded and permissions or malformed responses fail closed',async()=>{
 for(const [response,expected]of [[()=>new Response('unavailable',{status:503}),2],[()=>new Response('denied',{status:403}),1],[()=>Response.json({result:{}}),1]]){
  let calls=0;await assert.rejects(exports.readCrmItem('https://synthetic.invalid/','11665',async()=>{calls++;return response();}));assert.equal(calls,expected);
 }
});
