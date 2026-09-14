import {RepositoryError,sha256} from './repository';
export const MAX_CREDENTIAL_BYTES=2*1024*1024;
const sanitize=(value:string,fallback='contract')=>(value.trim()||fallback).replace(/[^\p{L}\p{N}\- ]/gu,'').replace(/\s+/g,' ').trim()||fallback;
/** Preserve the explicitly approved legacy handoff. Never pass this plan to OCR or drafts. */
export async function credentialUploadPlan(input:{clientName:string;dealId:string;password:string;files:Array<{name:string;bytes:Uint8Array}>}){
 if(!/^[1-9]\d*$/.test(input.dealId)||!input.password.trim()||input.password.length>256||!input.files.length||input.files.length>10)throw new RepositoryError('INVALID_CREDENTIAL_UPLOAD',400);
 const parts=input.clientName.trim().split(/\s+/).filter(Boolean),suffix=sanitize(parts.length>1?`${parts[0]} ${parts[1][0]}.`:parts[0]||`ID ${input.dealId}`,'client');
 const files=[],seen=new Set<string>();let total=0;
 for(const [index,file] of input.files.entries()){
  const ext=/\.(p12|pfx|key|jks)$/i.exec(file.name)?.[0].toLowerCase();
  total+=file.bytes.byteLength;
  if(!ext||!file.bytes.byteLength||total>MAX_CREDENTIAL_BYTES)throw new RepositoryError('INVALID_CREDENTIAL_FILE',400);
  const hash=await sha256(file.bytes);if(seen.has(hash))throw new RepositoryError('DUPLICATE_CREDENTIAL_FILE',400);seen.add(hash);
  const name=`26 ЭЦП - ${suffix}${input.files.length>1?` - ${index+1}`:''} - пароль ${sanitize(input.password)}${ext}`;
  if(name.length>240)throw new RepositoryError('CREDENTIAL_FILENAME_TOO_LONG',400);
  files.push({documentId:`eds:${hash}`,sha256:hash,byteSize:file.bytes.byteLength,name});
 }
 return {files,planHash:await sha256(JSON.stringify({scope:'credentials',files}))};
}
