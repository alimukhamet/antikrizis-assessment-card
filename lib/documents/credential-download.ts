import {RepositoryError,sha256,type CaseRow} from './repository';
import type {UploadManifestRepository,UploadManifest,UploadReceipt} from './upload-manifest';
import {MAX_CREDENTIAL_BYTES} from './credential-plan';
/** Only a verified credential receipt in the current case can authorize a read. */
export async function downloadCredential(manifests:UploadManifestRepository,record:CaseRow,requestId:string,fileId:string,readFile:(reference:{id:string})=>Promise<Uint8Array>){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)||! /^[1-9]\d*$/.test(fileId))throw new RepositoryError('INVALID_CREDENTIAL_REFERENCE',400);
 const row=await manifests.get(record.id,requestId);
 if(!row||row.identity_revision!==record.identity_revision||row.state!=='verified'||!row.receipt_json)throw new RepositoryError('CREDENTIAL_RECEIPT_NOT_VERIFIED',404);
 const manifest=JSON.parse(row.manifest_json) as UploadManifest,receipt=JSON.parse(row.receipt_json) as UploadReceipt;
 if(manifest.scope!=='credentials'||manifest.credentialOwnerConfirmed!==true||receipt.verified!==true)throw new RepositoryError('CREDENTIAL_RECEIPT_NOT_VERIFIED',404);
 const ref=receipt.files.find(f=>f.id===fileId),file=ref&&manifest.files.find(f=>f.sha256===ref.sha256);
 if(!file||file.byteSize>MAX_CREDENTIAL_BYTES||file.byteSize<=0)throw new RepositoryError('CREDENTIAL_NOT_IN_RECEIPT',404);
 const bytes=await readFile({id:fileId});
 if(bytes.length!==file.byteSize||await sha256(bytes)!==file.sha256)throw new RepositoryError('CREDENTIAL_CONTENT_CHANGED');
 // The sensitive legacy filename remains in the protected manifest, not response headers.
 return {bytes,sha256:file.sha256,filename:`credential-${fileId}${/\.(p12|pfx|key|jks)$/i.exec(file.name)?.[0]||'.key'}`};
}
