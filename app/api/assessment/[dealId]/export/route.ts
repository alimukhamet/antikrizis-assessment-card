import questionnaireDefinition from '../../../../../lib/questionnaire/schema.json';
import {requireStaffRequest} from '../../../staff-access';
import {evidenceContext,evidenceError} from '../../../../../lib/documents/request-context';
export async function GET(request:Request,context:{params:Promise<{dealId:string}>}){
 const denied=await requireStaffRequest(request);if(denied)return denied;
 try{const {dealId}=await context.params,{repository,record}=await evidenceContext(request,dealId),bundle=await repository.exportCase(record.id);
  async function* entries(){
   yield {type:'manifest',schemaVersion:bundle.schemaVersion,historyOrder:'sequence-ascending-within-record-type',originalFiles:'authenticated-download-paths',format:'assessment-ndjson',questionnaireDefinition,exportedAt:bundle.exportedAt,case:bundle.case};
   for(const doc of bundle.documents)yield {type:'document',...doc,downloadPath:`/api/assessment/${dealId}/documents/${doc.id}`};
   for(const extraction of bundle.extractions)yield {type:'extraction',...extraction,result:await repository.readResult(extraction)};
   for(const draft of bundle.drafts)yield {type:'questionnaire-draft',...draft,payload:JSON.parse(draft.payload_json),payload_json:undefined};
   for(const review of bundle.reviews)yield {type:'review',...review};
   for(const submission of bundle.submissions)yield {type:'assessment-submission',...submission,payload:JSON.parse(submission.payload_json),payload_json:undefined};
   for(const upload of bundle.uploads){
    const manifest=JSON.parse(upload.manifest_json),receipt=upload.receipt_json?JSON.parse(upload.receipt_json):null;
    const credentialDownloads=manifest.scope==='credentials'&&upload.state==='verified'&&upload.identity_revision===record.identity_revision&&receipt?.verified?receipt.files.map((file:{id:string;sha256:string})=>({id:file.id,sha256:file.sha256,downloadPath:`/api/assessment/${dealId}/credentials?requestId=${encodeURIComponent(upload.request_id)}&fileId=${encodeURIComponent(file.id)}`})):undefined;
    yield {type:'document-upload',...upload,manifest,receipt,credentialDownloads,manifest_json:undefined,receipt_json:undefined};
   }
   yield {type:'complete',documents:bundle.documents.length,extractions:bundle.extractions.length,reviews:bundle.reviews.length,drafts:bundle.drafts.length,submissions:bundle.submissions.length,uploads:bundle.uploads.length};
  }
  const iterator=entries(),encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(encoder.encode(JSON.stringify(next.value)+'\n'));}catch(error){controller.error(error);}},async cancel(){await iterator.return();}});
  return new Response(stream,{headers:{'content-type':'application/x-ndjson','cache-control':'no-store','content-disposition':`attachment; filename="assessment-${record.id}.ndjson"`}});
 }catch(error){return evidenceError(error);}
}
