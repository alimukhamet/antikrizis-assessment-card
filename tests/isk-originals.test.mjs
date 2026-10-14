import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import vm from 'node:vm';
const fixtureModule = { exports: {} };
vm.runInNewContext(buildSync({entryPoints:['lib/questionnaire/isk-originals.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text,{module:fixtureModule,exports:fixtureModule.exports,Date,JSON});
const { retainedLoanDates, iskOriginalType } = fixtureModule.exports;
const doc = {id:'synthetic-original',original_name:'synthetic.pdf',original_sha256:'a'.repeat(64),byte_size:100};
const iin='991231300003';
const result = () => ({read:{pages:[{page:1,text:'Owner',needsOcr:false},{page:2,text:'Номер договора: NUMBER\nДата начала срока действия контракта: 17.04.2023',needsOcr:false}]},extraction:{version:'rules-native-32',kind:'gkb_full',identity:{iin},credits:[{contractNumber:'NUMBER',contractCode:'CODE',contractStartDate:{key:'contractStartDate',value:'2023-04-17',page:2,source:'Дата начала срока действия контракта: 17.04.2023'}}]}});
test('retained exact dates identify the applicant, both contract identifiers and original evidence',()=>{
 const rows=retainedLoanDates(doc,result(),iin);
 assert.equal(rows.length,1);assert.equal(rows[0].startDate,'2023-04-17');assert.equal(rows[0].subjectIin,iin);assert.equal(rows[0].contractCode,'CODE');assert.equal(rows[0].contractNumber,'NUMBER');assert.equal(rows[0].sha256,doc.original_sha256);assert.equal(rows[0].page,2);assert.equal(rows[0].disbursementDate,null);
 for(const identity of ['',null,undefined,'991231300004','000000000000'])assert.equal(retainedLoanDates(doc,result(),identity).length,0);
});
test('old analyses, spouse identity, scans, missing/malformed days and unsupported quotes never become exact applicant dates',()=>{
 for(const edit of [r=>r.extraction.version='rules-native-31',r=>r.extraction.identity.iin='000000000010',r=>r.read.pages[0].needsOcr=true,r=>r.read.pages[1].needsOcr=true,r=>delete r.extraction.credits[0].contractStartDate,r=>r.extraction.credits[0].contractStartDate.value='2023-04',r=>r.extraction.credits[0].contractStartDate.value='2023-02-31',r=>r.extraction.credits[0].contractStartDate.source='fabricated',r=>r.extraction.credits[0].contractNumber='']){
  const r=result();edit(r);assert.equal(retainedLoanDates(doc,r,iin).length,0);
 }
});
test('catalog supports originals while excluding credentials, archives and malformed descriptors',()=>{
 for(const name of ['client.p12','client.p12.pdf','client.pfx.pdf','client.zip','client.docx'])assert.equal(iskOriginalType({...doc,original_name:name}),null);
 assert.equal(iskOriginalType(doc),'application/pdf');assert.equal(iskOriginalType({...doc,original_name:'scan.JPG'}),'image/jpeg');assert.equal(iskOriginalType({...doc,original_name:'report.pdf.sig'}),'application/octet-stream');assert.equal(iskOriginalType({...doc,byte_size:0}),null);
});

test('start and issuance retain their separate source pages for one exact contract',()=>{
 const input=result();input.extraction.version='rules-native-33';input.read.pages.push({page:3,text:'Дата фактической выдачи кредита: 19.04.2023',needsOcr:false});
 input.extraction.credits[0].disbursementDate={key:'disbursementDate',value:'2023-04-19',page:3,source:'Дата фактической выдачи кредита: 19.04.2023'};
 const rows=retainedLoanDates(doc,input,iin);assert.equal(rows.length,2);assert.equal(rows[0].startDate,'2023-04-17');assert.equal(rows[0].disbursementDate,null);assert.equal(rows[0].page,2);assert.equal(rows[1].startDate,null);assert.equal(rows[1].disbursementDate,'2023-04-19');assert.equal(rows[1].page,3);assert.equal(rows[0].contractCode,rows[1].contractCode);
 input.extraction.credits[0].disbursementDate.page=2;assert.equal(retainedLoanDates(doc,input,iin).length,1);
});
