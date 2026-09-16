import {sha256} from '../documents/repository';
import {bitrixHeaders} from './http-headers';
export type CrmFileRef={id:string};
export type ReusedUpload={id:string;sha256:string;byteSize:number};
export type PreparedUpload={name:string;bytes:Uint8Array};
export class DocumentUploadError extends Error{constructor(public code:string,public notStarted=false){super(code);}}
/** Retry only read-only metadata requests. Never share in-flight I/O between Workers. */
export async function readCrmItem(webhook:string,dealId:string,send:typeof fetch=fetch){
 if(!webhook)throw new DocumentUploadError('BITRIX_NOT_CONFIGURED');
 for(let attempt=0;attempt<2;attempt++){
  try{
   const response=await send(webhook.replace(/\/?$/,'/')+'crm.item.get.json',{method:'POST',headers:bitrixHeaders(webhook),body:JSON.stringify({entityTypeId:2,id:dealId}),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8000)});
   if(!response.ok){await response.body?.cancel();throw new DocumentUploadError(response.status===429||response.status>=500?'BITRIX_READ_TEMPORARILY_UNAVAILABLE':'BITRIX_UPLOAD_REQUEST_FAILED');}
   const json=await response.json() as {result?:{item?:Record<string,unknown>};error?:string};
   if(json.error||!json.result?.item)throw new DocumentUploadError(['QUERY_LIMIT_EXCEEDED','OPERATION_TIME_LIMIT'].includes(json.error||'')?'BITRIX_READ_TEMPORARILY_UNAVAILABLE':'BITRIX_UPLOAD_REQUEST_FAILED');
   return json.result.item;
  }catch(error){
   if(error instanceof DocumentUploadError&&error.code!=='BITRIX_READ_TEMPORARILY_UNAVAILABLE')throw error;
   if(attempt===1)throw new DocumentUploadError('BITRIX_READ_TEMPORARILY_UNAVAILABLE');
  }
 }
 throw new DocumentUploadError('BITRIX_READ_TEMPORARILY_UNAVAILABLE');
}
const normalized=(key:string)=>key.replace(/[^a-z0-9]/gi,'').toLowerCase();
/** Unknown existing values must stop an update, never disappear during normalization. */
export function readFileField(item:Record<string,unknown>){
 const keys=Object.keys(item).filter(k=>normalized(k)==='ufcrmankprimarydocs');
 if(keys.length!==1)throw new DocumentUploadError('DOCUMENT_FIELD_UNVERIFIED');
 const raw=item[keys[0]],values=raw===null||raw===false||raw===''?[]:Array.isArray(raw)?raw:[raw];
 const refs=values.map(value=>{
  const candidate=value&&typeof value==='object'&&!Array.isArray(value)?(value as Record<string,unknown>).id??(value as Record<string,unknown>).ID:value;
  if((typeof candidate!=='string'&&typeof candidate!=='number')||! /^[1-9]\d*$/.test(String(candidate)))throw new DocumentUploadError('EXISTING_FILE_REFERENCE_UNVERIFIED');
  return {id:String(candidate)};
 });
 if(new Set(refs.map(r=>r.id)).size!==refs.length)throw new DocumentUploadError('DUPLICATE_EXISTING_FILE_REFERENCE');
 return {key:keys[0],refs};
}
/** Multiples of three preserve Base64 alignment between independently encoded chunks. */
export function uploadBody(dealId:string,field:string,retained:CrmFileRef[],files:PreparedUpload[]){
 const encoder=new TextEncoder();
 function* chunks(){
  yield `{"entityTypeId":2,"id":${JSON.stringify(dealId)},"fields":{${JSON.stringify(field)}:[`;
  let comma=false;
  for(const ref of retained){yield (comma?',':'')+JSON.stringify(ref);comma=true;}
  for(const file of files){
   yield (comma?',':'')+'['+JSON.stringify(file.name)+',"';comma=true;
   for(let offset=0;offset<file.bytes.length;offset+=6144)yield btoa(String.fromCharCode(...file.bytes.subarray(offset,offset+6144)));
   yield '"]';
  }
  yield ']}}';
 }
 const iterator=chunks();
 return new ReadableStream<Uint8Array>({pull(controller){const next=iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(next.value));},cancel(){iterator.return();}},{highWaterMark:1});
}
export function createDocumentUploadAdapter(webhook:string,readFile:(reference:CrmFileRef,snapshot?:Record<string,unknown>)=>Promise<Uint8Array>,send:typeof fetch=fetch){
 async function call(method:string,body:unknown,stream=false){
  if(!webhook)throw new DocumentUploadError('BITRIX_NOT_CONFIGURED');
  const options:RequestInit&{duplex?:'half'}={method:'POST',headers:bitrixHeaders(webhook),body:stream?body as ReadableStream<Uint8Array>:JSON.stringify(body),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(30000)};
  if(stream)options.duplex='half';
  const response=await send(webhook.replace(/\/?$/,'/')+method+'.json',options);
  if(!response.ok)throw new DocumentUploadError('BITRIX_UPLOAD_REQUEST_FAILED');
  const json=await response.json() as {result?:{item?:Record<string,unknown>};error?:string};
  if(json.error||!json.result?.item)throw new DocumentUploadError('BITRIX_UPLOAD_REQUEST_FAILED');return json.result.item;
 }
 async function read(dealId:string){
  if(!/^[1-9]\d*$/.test(dealId))throw new DocumentUploadError('INVALID_DEAL_ID');
  const item=await readCrmItem(webhook,dealId,send);
  if(String(item.id??item.ID)!==dealId)throw new DocumentUploadError('DEAL_NOT_FOUND');
  return {...readFileField(item),iin:item.ufCrmAiIin??item.UF_CRM_AI_IIN,item};
 }
 async function append(dealId:string,expectedIin:string,baseline:CrmFileRef[],files:PreparedUpload[],reused:ReusedUpload[]=[]){
  const {hashes,before,newFiles}=await (async()=>{
  if(!/^\d{12}$/.test(expectedIin))throw new DocumentUploadError('CLIENT_IDENTITY_UNVERIFIED');
  if(!files.length||files.length>200||files.some(f=>!f.name||f.name.length>240||/[\r\n/\\]/.test(f.name)||!f.bytes.byteLength)||files.reduce((n,f)=>n+f.bytes.byteLength,0)>35*1024*1024)throw new DocumentUploadError('INVALID_UPLOAD_BATCH');
  const hashes:string[]=[];for(const file of files)hashes.push(await sha256(file.bytes));
  if(new Set(hashes).size!==hashes.length)throw new DocumentUploadError('DUPLICATE_UPLOAD_CONTENT');
  const before=await read(dealId);
  if(before.iin!==expectedIin)throw new DocumentUploadError('CASE_IDENTITY_CHANGED');
  const oldIds=new Set(baseline.map(r=>r.id));
  if(oldIds.size!==baseline.length||before.refs.length!==baseline.length||before.refs.some(r=>!oldIds.has(r.id)))throw new DocumentUploadError('DOCUMENTS_CHANGED_IN_CRM');
  validateReuse(baseline,files.map((file,index)=>({sha256:hashes[index],byteSize:file.bytes.length})),reused);
  for(const ref of reused){const bytes=await readFile(ref,before.item);if(bytes.length!==ref.byteSize||await sha256(bytes)!==ref.sha256)throw new DocumentUploadError('REUSED_UPLOAD_CONTENT_CHANGED');}
  const reusedHashes=new Set(reused.map(file=>file.sha256)),newFiles=files.filter((_,index)=>!reusedHashes.has(hashes[index]));
   return {hashes,before,newFiles};
  })().catch(error=>{throw new DocumentUploadError(error instanceof DocumentUploadError?error.code:'UPLOAD_PREFLIGHT_FAILED',true);});
  // Caller serializes an immutable upload intent. Never retry this write automatically.
  try{if(newFiles.length)await call('crm.item.update',uploadBody(dealId,before.key,before.refs,newFiles),true);}catch{/* Lost response: reconcile by reading, not by resending. */}
  return reconcile(dealId,expectedIin,baseline,files.map((file,index)=>({name:file.name,sha256:hashes[index],byteSize:file.bytes.length})),reused);
 }
 /** Read-only recovery from a durable manifest. This method never uploads files. */
 async function reconcile(dealId:string,expectedIin:string,baseline:CrmFileRef[],files:Array<{name:string;sha256:string;byteSize:number}>,reused:ReusedUpload[]=[]){
  if(!/^\d{12}$/.test(expectedIin))throw new DocumentUploadError('CLIENT_IDENTITY_UNVERIFIED');
  if(!files.length||files.length>200||new Set(files.map(f=>f.sha256)).size!==files.length||files.some(f=>! /^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.byteSize)||f.byteSize<=0))throw new DocumentUploadError('INVALID_UPLOAD_BATCH');
  const oldIds=new Set(baseline.map(r=>r.id));
  if(oldIds.size!==baseline.length)throw new DocumentUploadError('DUPLICATE_EXISTING_FILE_REFERENCE');
  validateReuse(baseline,files,reused);
  let after:Awaited<ReturnType<typeof read>>;
  try{after=await read(dealId);}catch{throw new DocumentUploadError('UPLOAD_OUTCOME_UNCERTAIN');}
  if(after.iin!==expectedIin)throw new DocumentUploadError('CASE_IDENTITY_CHANGED_AFTER_UPLOAD');
  const afterIds=new Set(after.refs.map(r=>r.id));
  if([...oldIds].some(id=>!afterIds.has(id)))throw new DocumentUploadError('EXISTING_FILE_MISSING_AFTER_UPLOAD');
  const added=after.refs.filter(r=>!oldIds.has(r.id));
  if(added.length!==files.length-reused.length)throw new DocumentUploadError('UPLOAD_REFERENCE_COUNT_MISMATCH');
  const verified:Array<{id:string;sha256:string;name:string}>=[],remaining=new Map(files.map(f=>[f.sha256,f]));
  for(const ref of [...reused,...added]){
   let bytes:Uint8Array;try{bytes=await readFile(ref,after.item);}catch{throw new DocumentUploadError('UPLOAD_CONTENT_READBACK_UNCERTAIN');}
   const hash=await sha256(bytes),file=remaining.get(hash);
   if(!file||bytes.length!==file.byteSize)throw new DocumentUploadError('UPLOAD_CONTENT_MISMATCH');
   remaining.delete(hash);verified.push({id:ref.id,sha256:hash,name:file.name});
  }
  return {verified:true as const,preserved:baseline,files:verified};
 }
 function validateReuse(baseline:CrmFileRef[],files:Array<{sha256:string;byteSize:number}>,reused:ReusedUpload[]){
  if(new Set(reused.map(f=>f.id)).size!==reused.length||new Set(reused.map(f=>f.sha256)).size!==reused.length||reused.some(f=>!baseline.some(b=>b.id===f.id)||!files.some(v=>v.sha256===f.sha256&&v.byteSize===f.byteSize)))throw new DocumentUploadError('INVALID_UPLOAD_REUSE');
 }
 return{read,append,reconcile};
}
