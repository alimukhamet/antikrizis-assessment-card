import { analysisResponse,analysisVersion } from '../../../../../lib/documents/analysis-service';
import { evidenceRepository } from '../../../../../lib/documents/storage';
import { sha256, RepositoryError } from '../../../../../lib/documents/repository';
import { readSessionCookie, verifySession } from '../../../../../lib/worker-session';
import { requireStaffRequest } from '../../../staff-access';
import { readClientContext } from '../../../../../lib/crm/bitrix';
import { readPdf, MAX_DOCUMENT_BYTES, DocumentReadError } from '../../../../../lib/documents/read-pdf';
import { extractNative } from '../../../../../lib/documents/extract-native';

export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
export async function POST(request: Request, context: { params: Promise<{dealId:string}> }) {
  const denied=await requireStaffRequest(request,{binary:true}); if (denied) return denied;
  const {dealId}=await context.params;
  if (!/^[1-9]\d*$/.test(dealId)) return Response.json({error:'INVALID_DEAL_ID'},{status:400,headers});
  let client;
  try { client=await readClientContext(dealId,process.env.BITRIX_WEBHOOK??''); }
  catch { return Response.json({error:'DEAL_READ_FAILED'},{status:503,headers}); }
  let filename='';try{filename=decodeURIComponent(request.headers.get('x-document-name')||'');}catch{return Response.json({error:'INVALID_FILENAME'},{status:400,headers});}
  if (/\.(p12|pfx|jks|key)$/i.test(filename)||/эцп/i.test(filename)) return Response.json({error:'CREDENTIAL_NOT_ANALYSED'},{status:415,headers});
  const declared=Number(request.headers.get('content-length')||0);
  if (declared>MAX_DOCUMENT_BYTES) return Response.json({error:'FILE_TOO_LARGE'},{status:413,headers});
  try {
    const reader=request.body?.getReader();if(!reader)throw new DocumentReadError('EMPTY_FILE');
    const chunks:Uint8Array[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_DOCUMENT_BYTES){await reader.cancel();throw new DocumentReadError('FILE_TOO_LARGE',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}chunks.length=0;
    const repository=await evidenceRepository(),record=await repository.syncCase(client);
    const actor=await verifySession(readSessionCookie(request.headers.get('cookie')),process.env.SITE_SESSION_TOKEN??'');
    if(!actor)return Response.json({error:'SIGN_IN_REQUIRED'},{status:401,headers});
    const version=analysisVersion;
    const originalHash=await sha256(bytes),cached=await repository.cached(record.id,originalHash,version);
    const result=cached?.result as {read:Awaited<ReturnType<typeof readPdf>>;extraction:ReturnType<typeof extractNative>}|undefined;
    const read=result?.read??await readPdf(bytes),extraction=result?.extraction??extractNative(read.pages);
    const stored=cached??await repository.store(record.id,bytes,filename||'document.pdf',actor,version,{read,extraction});
    return Response.json(await analysisResponse(client,record,repository,stored,Boolean(cached)),{headers});
  } catch(error) {
    return Response.json({error:error instanceof DocumentReadError||error instanceof RepositoryError?error.code:'DOCUMENT_PROCESSING_FAILED'},{status:error instanceof DocumentReadError||error instanceof RepositoryError?error.status:422,headers});
  }
}
