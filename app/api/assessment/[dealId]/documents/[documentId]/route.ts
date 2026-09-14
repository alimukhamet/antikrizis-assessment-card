import {unwrapPdf} from '../../../../../../lib/documents/read-pdf';
import {requireStaffRequest} from '../../../../staff-access';
import {evidenceContext,evidenceError} from '../../../../../../lib/documents/request-context';
import {RepositoryError} from '../../../../../../lib/documents/repository';
export async function GET(request:Request,context:{params:Promise<{dealId:string;documentId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{const {dealId,documentId}=await context.params,{repository,record}=await evidenceContext(request,dealId);
  const doc=await repository.document(record.id,documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE',404);
  let data=await repository.original(doc);const preview=new URL(request.url).searchParams.get('view')==='pdf';if(preview)data=new Uint8Array(unwrapPdf(data).bytes);
  return new Response(data,{headers:{'content-type':preview?'application/pdf':'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':`${preview?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(doc.original_name)}`}});
 }catch(error){return evidenceError(error);}
}
