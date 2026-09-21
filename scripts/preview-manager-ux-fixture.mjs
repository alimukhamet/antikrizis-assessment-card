import {EvidenceRepository} from '../lib/documents/repository.ts';
import {analysisVersion} from '../lib/documents/analysis-version.ts';
import {seed} from '../tests/runtime/fixture.mjs';
import schema from '../lib/questionnaire/schema.json' with {type:'json'};

// Isolated preview data only. Originals are valid PDFs so the actual viewer works.
function pdf(pages){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const kids=[];
 for(const lines of pages){const page=objects.length+1,content=page+1;kids.push(page+' 0 R');const stream='BT /F1 13 Tf 50 780 Td '+lines.map((line,i)=>(i?'0 -25 Td ':'')+'('+line.replace(/[()\\]/g,'\\$&')+') Tj').join('\n')+' ET';objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);}
 objects[1]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
 let out='%PDF-1.4\n',offsets=[0];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(out));out+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});const xref=Buffer.byteLength(out);out+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new TextEncoder().encode(out);
}
export async function seedManagerPreview(db,files){
 const base=await seed(db,files),repo=new EvidenceRepository(db,files),actor={id:'worker:ali',worker:'ali',displayName:'Preview',authentication:'shared-password-worker-selection'};
 const values=[433819,440002,151380,4300000,3500000,5000000,440358.15,0,0];
 const loans=values.map((value,i)=>({creditor:i<3?'ТОО «Ломбард Пример»':['АО «Kaspi Bank»','АО «Halyk Bank»','АО «Банк ЦентрКредит»'][i%3],number:'DEMO-'+String(i+1).padStart(3,'0'),value:value.toFixed(2),page:i<3?16+i*2:2+(i-3)*2}));
 const documents=[],payload=structuredClone(base.payload);payload.documents=[];payload.docContext={social:'1',salary:'1',salaryBank:'other'};
 payload.answers.find(a=>a.key==='fio').value='Клиент для просмотра';
 payload.groups.find(g=>g.id==='creditors').rows=loans.map(l=>schema.groups.find(g=>g.id==='creditors').fields.map(f=>({key:f.key,value:({n8038:l.creditor,loanContractId:l.number,n8038Start:'2025-01',n8039:'Потребительский кредит',loanStatus:'Платится по графику',n8040:l.value,n8041:'0',n8042:'0',loanParticipants:'Нет'})[f.key]||'',checked:false})));
 payload.groups.find(g=>g.id==='creditors').rowKeys=loans.map(l=>`creditors|${base.iin}|${l.creditor}|${l.number}`);
 for(const [type,kind] of [['ГКБ — краткий отчёт','gkb_short'],['ГКБ — полный отчёт','gkb_full'],['Справка ЕНПФ','enpf'],['Ф6 об отсутствии имущества','property'],['Удостоверение личности','identity'],['Выписка Kaspi Gold','kaspi'],['Выписка зарплатного банка','salary'],['Справка по выплатам пенсии и пособий','benefits']]){
  const full=kind==='gkb_full',short=kind==='gkb_short',gkb=full||short,totalPages=full?20:short?2:1;
  const pageLines=Array.from({length:totalPages},(_,i)=>['PREVIEW ONLY - NO REAL CLIENT DATA',kind+' / page '+(i+1),'Client: DEMO / '+base.iin,'Document date: '+base.today]);
  if(gkb)for(const [i,l]of loans.entries()){const lines=pageLines[(full?l.page:2)-1];lines.push('Contract '+l.number,full&&i<3?'Outstanding balance: not provided':'Outstanding balance: '+l.value+' KZT','Overdue days: 0');}
  const result={read:{totalPages,pages:pageLines.map((lines,i)=>({page:i+1,text:lines.join('\n'),needsOcr:false}))},extraction:{kind,identity:{iin:base.iin,name:'Клиент для просмотра'},issuedAt:base.today,facts:[],findings:full?['TOTAL_DEBT_REQUIRES_RECONCILIATION']:short?['SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED']:[],coverage:{from:base.from,to:base.today},bankStatement:{from:base.from,to:base.today,reconciled:true,rowsReadable:true},credits:gkb?loans.map((l,i)=>({contractNumber:l.number,page:full?l.page:2,facts:Object.entries({creditor:l.creditor,contractIdentifier:l.number,loanStatus:'Платится по графику',...(full&&i<3?{}:{debtOutstanding:l.value}),monthlyPayment:'0',overdueDays:'0'}).map(([key,value])=>({key,value,page:full?l.page:2,source:'PREVIEW ONLY '+l.number})),...(full&&i<3?{components:{remaining:null,arrears:'0.00',penalty:'0.00',interest:null,fine:null}}:{})})):[],...(gkb?{creditList:{complete:full,declared:9}}:{})}};
  const saved=await repo.store(base.record.id,pdf(pageLines),type+' — пример.pdf',actor,analysisVersion,result),doc={documentId:saved.document.id,type,kind,person:'Клиент'};documents.push(doc);payload.documents.push({documentId:doc.documentId,type,person:'Клиент'});
 }
 return {...base,payload,documents};
}
