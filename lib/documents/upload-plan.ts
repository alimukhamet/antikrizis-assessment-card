import {RepositoryError,sha256,type EvidenceRepository,type CaseRow} from './repository';
import type {DraftPayload} from '../questionnaire/draft';
const prefixes:Record<string,string>={'ГКБ — краткий отчёт':'07 Клиент - ГКБ краткий','ГКБ — полный отчёт':'08 Клиент - ГКБ полный','Выписка Kaspi Gold':'13 Клиент - Выписка Kaspi Gold','Справка ЕНПФ':'14 Клиент - Справка ЕНПФ','Удостоверение личности':'23 Удостоверение личности','Ф6 об отсутствии имущества':'24 Ф6 об отсутствии имущества','Доверенность':'25 Доверенность','Справка по выплатам пенсии и пособий':'27 Справка выплат пенсии и пособий','Выписка зарплатного банка':'28 Выписка зарплатного банка'};
export const MAX_UPLOAD_BATCH=35*1024*1024;
const sanitize=(value:string,fallback:string)=>value.trim().replace(/[^\p{L}\p{N}\- ]/gu,'').replace(/\s+/g,' ').trim()||fallback;
/** Preserve canonical numbering/naming; credentials never enter the evidence upload plan. */
export async function documentUploadPlan(repository:EvidenceRepository,record:CaseRow,payload:DraftPayload){
 const name=payload.answers.find(a=>a.key==='fio')?.value.trim().split(/\s+/).filter(Boolean)||[];
 const suffix=sanitize(name.length>1?`${name[0]} ${name[1][0]}.`:name[0]||`ID ${record.external_id}`,'client');
 const files:Array<{documentId:string;name:string;sha256:string;byteSize:number}>=[],seen=new Set<string>();
 for(const selected of payload.documents.filter(d=>!['Доверенность','Подписанный договор'].includes(d.type))){
  if(!prefixes[selected.type]||selected.person!=='Клиент'||seen.has(selected.documentId))throw new RepositoryError('INVALID_UPLOAD_SELECTION',400);seen.add(selected.documentId);
  const doc=await repository.document(record.id,selected.documentId);if(!doc)throw new RepositoryError('DOCUMENT_NOT_IN_CASE');
  const group=payload.documents.filter(d=>d.type===selected.type),index=group.findIndex(d=>d.documentId===selected.documentId);
  const ext=/(\.[A-Za-z0-9]{1,12})$/.exec(doc.original_name)?.[1].toLowerCase()||'.file';
  const filename=`${prefixes[selected.type]} - ${suffix}${group.length>1?` - ${index+1}`:''}${ext}`;
  if(filename.length>240||!Number.isSafeInteger(doc.byte_size)||doc.byte_size<=0||doc.byte_size>MAX_UPLOAD_BATCH)throw new RepositoryError('INVALID_UPLOAD_FILE',400);
  files.push({documentId:doc.id,name:filename,sha256:doc.original_sha256,byteSize:doc.byte_size});
 }
 if(!files.length)throw new RepositoryError('INVALID_UPLOAD_SELECTION',400);
 const planHash=await sha256(JSON.stringify(files)),batches:Array<typeof files>=[];let size=0;
 for(const file of files){if(!batches.length||size+file.byteSize>MAX_UPLOAD_BATCH){batches.push([]);size=0;}batches[batches.length-1].push(file);size+=file.byteSize;}
 return {planHash,batches};
}
export async function uploadBatchId(requestId:string,index:number){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)||!Number.isInteger(index)||index<0||index>199)throw new RepositoryError('INVALID_UPLOAD_REQUEST',400);
 const h=await sha256(`assessment-upload:${requestId}:${index}`);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
