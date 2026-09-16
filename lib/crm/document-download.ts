import {DocumentUploadError,readCrmItem,readFileField,createDocumentUploadAdapter,type CrmFileRef} from './document-upload';
import {bitrixHeaders} from './http-headers';
const MAX_BYTES=35*1024*1024;
/** Refresh signed links from the selected CRM item; never accept a caller-supplied link. */
export function createCrmDocumentReader(webhook:string,dealId:string,expectedIin:string,send:typeof fetch=fetch,options:{pdfOnly?:boolean;credentialsOnly?:boolean;onFilename?:(name:string)=>void;onProgress?:(event:Record<string,number|string>)=>void}={}){
 let portal:URL;try{portal=new URL(webhook);}catch{throw new DocumentUploadError('INVALID_DOWNLOAD_CONFIGURATION');}
 if(portal.protocol!=='https:'||portal.username||portal.password||! /^[1-9]\d*$/.test(dealId)||! /^\d{12}$/.test(expectedIin))throw new DocumentUploadError('INVALID_DOWNLOAD_CONFIGURATION');
 async function bytes(response:Response){
  if(response.status!==200||!response.body)throw new DocumentUploadError('CRM_FILE_DOWNLOAD_FAILED');
  const disposition=response.headers.get('content-disposition')||'';
  const encoded=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1],plain=/filename="([^"]+)"|filename=([^;]+)/i.exec(disposition);
  let filename=encoded||plain?.[1]||plain?.[2]||'';try{filename=decodeURIComponent(filename);}catch{/* Some legacy names contain a literal percent. */}
  filename=filename.replace(/[\r\n/\\\x00-\x1f]/g,'_').trim().slice(0,240);
  if(options.pdfOnly&&(/\.(p12|pfx|jks|key)$/i.test(filename)||/эцп|private.?key/i.test(filename))){await response.body.cancel();throw new DocumentUploadError('CREDENTIAL_NOT_ANALYSED');}
  if(options.pdfOnly&&filename&&!/\.pdf$/i.test(filename)){await response.body.cancel();throw new DocumentUploadError('NOT_A_SUPPORTED_PDF');}
  if(options.credentialsOnly&&!/\.(p12|pfx|key|jks)$/i.test(filename)){await response.body.cancel();throw new DocumentUploadError('INVALID_CREDENTIAL_FILE');}
  if(filename)options.onFilename?.(filename);
  const limit=options.credentialsOnly?2*1024*1024:MAX_BYTES;
  const declared=response.headers.get('content-length');if(declared&&Number(declared)>limit){await response.body.cancel();throw new DocumentUploadError('CRM_FILE_TOO_LARGE');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();throw new DocumentUploadError('CRM_FILE_TOO_LARGE');}chunks.push(value);if(chunks.length===1)options.onProgress?.({phase:'first-bytes',bytes:total});}
  options.onProgress?.({phase:'body-complete',bytes:total});
  if(!total)throw new DocumentUploadError('CRM_FILE_EMPTY');
  const result=new Uint8Array(total);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
 }
 return async (reference:CrmFileRef,snapshot?:Record<string,unknown>)=>{
  if(!/^[1-9]\d*$/.test(reference.id))throw new DocumentUploadError('INVALID_FILE_ID');
  try{
   // Verification may reuse its own just-read item for this bounded operation.
   // There is no global cache or shared in-flight request between Workers.
   const item=snapshot??await readCrmItem(webhook,dealId,send);
   if(String(item.id??item.ID)!==dealId)throw new DocumentUploadError('DEAL_NOT_FOUND');
   if((item.ufCrmAiIin??item.UF_CRM_AI_IIN)!==expectedIin)throw new DocumentUploadError('CASE_IDENTITY_CHANGED');
   const field=readFileField(item);if(!field.refs.some(r=>r.id===reference.id))throw new DocumentUploadError('FILE_NOT_IN_DEAL');
   const raw=item[field.key],values=Array.isArray(raw)?raw:[raw];
   const file=values.find(v=>v&&typeof v==='object'&&String((v as Record<string,unknown>).id??(v as Record<string,unknown>).ID)===reference.id) as Record<string,unknown>|undefined;
   if(typeof file?.urlMachine!=='string')throw new DocumentUploadError('CRM_FILE_LINK_UNAVAILABLE');
   let url=new URL(file.urlMachine,portal.origin);
   if(url.origin!==portal.origin||url.username||url.password||url.hash||! /\/crm\.controller\.item\.getFile(?:\.json)?\/?$/i.test(url.pathname))throw new DocumentUploadError('CRM_FILE_LINK_UNTRUSTED');
   for(let redirects=0;redirects<=3;redirects++){
    const started=Date.now();options.onProgress?.({phase:'request-start',redirects});
    const download=await send(url.toString(),{method:'GET',headers:bitrixHeaders(webhook,'file'),redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
    options.onProgress?.({phase:'response-headers',status:download.status,elapsedMs:Date.now()-started,contentLength:Number(download.headers.get('content-length')||0),contentType:(download.headers.get('content-type')||'').split(';')[0].slice(0,60),encoding:(download.headers.get('content-encoding')||'').slice(0,20)});
    if([301,302,303,307,308].includes(download.status)){
     const location=download.headers.get('location');await download.body?.cancel();
     if(!location||redirects===3)throw new DocumentUploadError('CRM_FILE_REDIRECT_FAILED');
     const next=new URL(location,url);
     // Do not forward a signed URL to an unverified storage origin.
     if(next.origin!==portal.origin||next.username||next.password||next.hash)throw new DocumentUploadError('CRM_FILE_REDIRECT_UNTRUSTED');
     url=next;continue;
    }
    return await bytes(download);
   }
   throw new DocumentUploadError('CRM_FILE_DOWNLOAD_FAILED');
  }catch(error){
   const code=error instanceof DocumentUploadError?error.code:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'CRM_FILE_DOWNLOAD_TIMEOUT':'CRM_FILE_DOWNLOAD_FAILED';
   // No URLs, signed tokens, names, file bytes or client identifiers in logs.
   console.warn('assessment-file-readback',JSON.stringify({code}));
   if(error instanceof DocumentUploadError)throw error;throw new DocumentUploadError(code);
  }
 };
}
export function createVerifiedDocumentUploadAdapter(webhook:string,dealId:string,expectedIin:string,send:typeof fetch=fetch){
 return createDocumentUploadAdapter(webhook,createCrmDocumentReader(webhook,dealId,expectedIin,send),send);
}
