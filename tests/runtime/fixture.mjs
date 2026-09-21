import {EvidenceRepository} from '../../lib/documents/repository.ts';
import {analysisVersion} from '../../lib/documents/analysis-version.ts';
import schema from '../../lib/questionnaire/schema.json' with {type:'json'};

export async function seed(db,files){
 const iin='000000000010',today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty'}).format(new Date());
 const prior=new Date(today+'T00:00:00Z');prior.setUTCFullYear(prior.getUTCFullYear()-1);const from=prior.toISOString().slice(0,10);
 const repo=new EvidenceRepository(db,files),record=await repo.syncCase({external:{system:'bitrix',dealId:'900001'},title:'SYNTHETIC ONLY',iin,retrievedAt:new Date().toISOString()});
 const actor={id:'worker:ali',worker:'ali',displayName:'Synthetic',authentication:'shared-password-worker-selection'};
 const values={fio:'SYNTHETIC ONLY',enforcementStatus:'no',enforcementDetails:'Нет',iin,dognum:'TEST-NOT-FOR-SIGNING',marital:'Холост / не замужем',dependents:'0',childrenTotal:'0',procedure:'199','count-clientjobs':'0','count-clientunofficial':'0',clientBenefitsCount:'0',c8037:'0',hardshipReason:'Платежи вношу, трудностей нет',kaspiAnnual:'0',gamblingTransfers:'no',lawyerNotesStatus:'no',n8044:'0',summa:'500000',contractDate:today,months:'5',payDay:'7',grafType:'423'};
 const credit={n8038:'АО «TEST BANK»',loanContractId:'TEST-001',n8038Start:'2025-01',n8039:'Потребительский кредит',loanStatus:'Платится по графику',n8040:'100.25',n8041:'10.00',n8042:'0',loanParticipants:'Нет'};
 const payload={schemaVersion:1,answers:schema.scalar.map(f=>({key:f.key,value:values[f.key]||'',checked:['choice:socialStatus:Нет','holding:client:none','holding:client:businessNone','choice:debtPurpose:Жильё'].includes(f.key)})),groups:schema.groups.map(g=>({id:g.id,rows:g.id==='creditors'?[g.fields.map(f=>({key:f.key,value:credit[f.key]||'',checked:false}))]:[],rowKeys:g.id==='creditors'?[`creditors|${iin}|АО «TEST BANK»|TEST-001`]:[]})),docContext:{social:'0',salary:'0',salaryBank:'none'},documents:[],pendingFiles:[]};
 const documents=[];
 for(const [type,kind] of [['ГКБ — краткий отчёт','gkb_short'],['ГКБ — полный отчёт','gkb_full'],['Справка ЕНПФ','enpf'],['Ф6 об отсутствии имущества','property'],['Удостоверение личности','identity'],['Выписка Kaspi Gold','kaspi'],['Доверенность','power_of_attorney'],['Подписанный договор','unknown']]){
  // Intentionally seeded extracted fixtures: this suite tests storage and the
  // workflow, while native PDF interpretation has separate regression tests.
  const result={read:{totalPages:1,pages:[{page:1,text:'SYNTHETIC ONLY '+kind,needsOcr:false}]},extraction:{kind,identity:{iin,name:'SYNTHETIC ONLY'},issuedAt:today,facts:[],findings:[],coverage:{from,to:today},bankStatement:{from,to:today,reconciled:true,rowsReadable:true},credits:kind.startsWith('gkb_')?[{contractNumber:'TEST-001',page:1,facts:Object.entries({creditor:'АО «TEST BANK»',contractIdentifier:'TEST-001',loanStatus:'Платится по графику',debtOutstanding:'100.25',monthlyPayment:'10.00',overdueDays:'0'}).map(([key,value])=>({key,value,page:1,source:'SYNTHETIC ONLY'}))}]:[]}};
  if(kind.startsWith('gkb_'))result.extraction.creditList={complete:kind==='gkb_full',declared:1};
  if(kind==='gkb_short'){result.extraction.findings=['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED'];result.extraction.credits[0].contractNumber='TEST-00 ..';result.extraction.credits[0].facts.find(f=>f.key==='creditor').value='Акционерное общество «TEST BANK»';}
  const saved=await repo.store(record.id,new TextEncoder().encode('%PDF-1.4\nSYNTHETIC ONLY '+kind+'\n%%EOF'),kind+'.pdf',actor,analysisVersion,result);
  const document={documentId:saved.document.id,type,person:'Клиент',kind,originalKey:saved.document.original_key};documents.push(document);
  if(!['power_of_attorney','unknown'].includes(kind))payload.documents.push({documentId:document.documentId,type,person:'Клиент'});
 }
 return {payload,documents,record,today,from,iin};
}

export async function seedMissingBalance(db,files,fixture){
 const repo=new EvidenceRepository(db,files),document=await repo.document(fixture.record.id,fixture.documents.find(d=>d.kind==='gkb_full').documentId);
 const cached=await repo.cached(fixture.record.id,document.original_sha256,analysisVersion),result=structuredClone(cached.result);
 result.extraction.findings=['TOTAL_DEBT_REQUIRES_RECONCILIATION'];
 const loan=result.extraction.credits[0];loan.facts=loan.facts.filter(f=>f.key!=='debtOutstanding');loan.components={remaining:null,arrears:'0.00',penalty:'0.00',interest:null,fine:null};
 const saved=await repo.store(fixture.record.id,new TextEncoder().encode('%PDF-1.4 SYNTHETIC MISSING BALANCE ONLY'), 'missing-balance.pdf',{id:'worker:ali',worker:'ali',displayName:'Synthetic',authentication:'shared-password-worker-selection'},analysisVersion,result);
 const payload=structuredClone(fixture.payload);payload.documents.find(d=>d.type==='ГКБ — полный отчёт').documentId=saved.document.id;
 return {payload,shortDocumentId:fixture.documents.find(d=>d.kind==='gkb_short').documentId,fullDocumentId:saved.document.id};
}
