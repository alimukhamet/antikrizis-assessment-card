/** Original manual tools, real form/handlers/renderer; CRM responses are synthetic. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const html=fs.readFileSync('templates/assessment-card.html','utf8');
async function setup(t){
 const dom=new JSDOM(html,{url:'https://synthetic.invalid/assessment-card.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,calls=[],downloads=[],blobs=new Map();
 t.after(()=>w.close());w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.URL.createObjectURL=blob=>{const url='blob:test-'+blobs.size;blobs.set(url,blob);return url;};w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:blobs.get(this.href)});};
 const deal={ID:'900001',TITLE:'SYNTHETIC TEST DEAL'};let item={id:900001,ufCrmAnkPrimaryDocs:[{id:451}]};
 w.fetch=async(path,options={})=>{
  let result;const url=new URL(path,w.location.href),body=options.body?JSON.parse(options.body):null;
  if(url.pathname==='/api/status')return{ok:true,json:async()=>({ok:true,source:'bitrix'})};
  if(url.pathname==='/api/sales-metrics')return{ok:true,json:async()=>({relatedMetrics:['7609','2093','4351'].map(managerId=>({managerId,paymentType:url.searchParams.get('paymentType'),contractTotal:0,contractAverage:0,handoffs:0,missingContractValues:0})),lastSyncAt:'2026-09-17T00:00:00Z'})};
  assert.match(url.pathname,/^\/api\/bitrix\//,'Original tools must not call the new assessment/submission APIs');
  const method=url.pathname.split('/').at(-1).replace(/\.json$/,'');calls.push({method,body});
  if(method==='crm.deal.get')result={...deal};
  else if(method==='crm.deal.update'){Object.assign(deal,body.fields);result=true;}
  else if(method==='crm.timeline.comment.add')result=765;
  else if(method==='crm.item.get')result={item};
  else if(method==='crm.item.update'){item={...item,...body.fields};result={item};}
  else throw Error('Unexpected method '+method);
  return{ok:true,json:async()=>({result})};
 };
 for(const script of d.querySelectorAll('script:not([src])'))w.eval(script.textContent);
 await w.eval('verifyBitrixConnection()');
 for(const name of ['pizzip-3.1.7.min.js','docxtemplater-3.50.0.min.js'])w.eval(fs.readFileSync('public/vendor/contracts/'+name,'utf8'));
 const set=(id,value)=>{d.getElementById(id).value=value;};
 const fillContract=()=>{
  const values={dealId:'900001',fio:'SYNTHETIC TEST CLIENT',iin:'111111111111',dognum:'TEST-ONLY',marital:'Не в браке',dependents:'0',procedure:'199',incomeClientOff:'300000',incomeClientUnoff:'0',debt:'7000000',overdueDays:'180',lastCreditDate:'2025-01',kaspiTurnover:'100000',creditors:'SYNTHETIC BANK',creditPurpose:'TEST PURPOSE',guarantors:'Нет',comment:'SYNTHETIC NOT FOR SIGNING',summa:'400000',contractDate:'2026-09-17',months:'5',payDay:'20',grafType:'261'};
  for(const [id,value]of Object.entries(values))set(id,value);
  // Select the available unmarried option, without relying on its display spelling.
  const marital=d.getElementById('marital');if(!marital.value)marital.selectedIndex=2;
  for(const key of ['works','children','salaryOtherBank','ip','realEstate','cars','carSale','ludo'])w.eval(`setSegmentValue('${key}','0')`);
  d.querySelector('input[name="socialStatus"][value="Нет"]').checked=true;
  d.querySelector('input[name="creditType"]').checked=true;
  w.eval('onChange()');assert.deepEqual([...w.eval('validate(readState())')],[]);
 };
 const confirm=async(approve=true)=>{
  for(let i=0;i<50&&d.getElementById('targetConfirmModal').classList.contains('hidden');i++)await new Promise(r=>setTimeout(r,2));
  assert.equal(d.getElementById('targetConfirmModal').classList.contains('hidden'),false,'Must confirm destination before writes');
  d.getElementById(approve?'targetConfirmApprove':'targetConfirmCancel').click();
 };
 return{w,d,calls,downloads,deal,set,fillContract,confirm};
}

test('contract tool generates a real DOCX and saves through the original Bitrix path without documents or the new save engine',async t=>{
 const s=await setup(t);s.fillContract();s.d.querySelector('[data-open-view="contract"]').click();
 const pending=s.d.getElementById('contractBtn').onclick();await s.confirm();await pending;
 assert.equal(s.downloads.length,1,s.d.getElementById('info').textContent);
 assert.match(s.downloads[0].name,/SYNTHETIC TEST CLIENT.*\.docx$/);
 const bytes=await new Promise((resolve,reject)=>{const r=new s.w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsArrayBuffer(s.downloads[0].blob);});
 const zip=new s.w.PizZip(bytes);const xml=zip.file('word/document.xml').asText();
 assert.match(xml,/SYNTHETIC TEST CLIENT/);assert.match(xml,/TEST-ONLY/);assert.ok(!xml.includes('{{'));
 assert.equal(s.calls.filter(x=>x.method==='crm.deal.update').length,1);
 assert.equal(s.calls.filter(x=>x.method==='crm.timeline.comment.add').length,1);
 assert.equal(s.calls.some(x=>x.method==='crm.item.update'),false);
});

test('upload tool sends the original selected files, preserves existing attachments, and needs no contract questionnaire',async t=>{
 const s=await setup(t);s.set('dealId','900001');s.set('docClientName','SYNTHETIC TEST CLIENT');
 s.w.eval("setSegmentValue('docSocialPayments','0');setSegmentValue('docSalaryBank','0');");
 s.d.querySelector('[data-open-view="documents"]').click();
 for(const id of ['docGkbShort','docGkbFull','docKaspi','docEnpf','docIdCard','docF6Absence','docPower','docEds']){
  const file=new s.w.File(['SYNTHETIC DOCUMENT'],id+(id==='docEds'?'.p12':'.pdf'),{type:'application/octet-stream'});
  Object.defineProperty(s.d.getElementById(id),'files',{value:[file],configurable:true});
 }
 s.set('docEdsPassword','synthetic-test-only');s.w.eval('onChange()');
 const pending=s.d.getElementById('docsBtn').onclick();await s.confirm();await pending;
 assert.equal(s.downloads.length,0);
 assert.equal(s.calls.some(x=>x.method==='crm.deal.update'||x.method==='crm.timeline.comment.add'),false);
 const writes=s.calls.filter(x=>x.method==='crm.item.update');assert.equal(writes.length,1,s.d.getElementById('toast').textContent);
 const refs=writes[0].body.fields.ufCrmAnkPrimaryDocs;assert.deepEqual(refs[0],{id:451});assert.equal(refs.length,9);
 for(const file of refs.slice(1)){assert.equal(Buffer.from(file[1],'base64').toString(),'SYNTHETIC DOCUMENT');}
});

test('cancelling the original contract confirmation sends no write and downloads nothing',async t=>{
 const s=await setup(t);s.fillContract();
 const pending=s.d.getElementById('contractBtn').onclick();await s.confirm(false);await pending;
 assert.equal(s.downloads.length,0);assert.equal(s.calls.some(x=>x.method!=='crm.deal.get'),false);
});

test('incomplete original forms still block submission and local DOCX libraries precede CDN fallbacks',async t=>{
 const s=await setup(t);await s.d.getElementById('contractBtn').onclick();await s.d.getElementById('docsBtn').onclick();
 assert.equal(s.calls.length,0);assert.equal(s.downloads.length,0);
 assert.match(html,/pizzip: \[\s*"\/vendor\/contracts\/pizzip-3\.1\.7\.min\.js"/);
 assert.match(html,/docxtemplater: \[\s*"\/vendor\/contracts\/docxtemplater-3\.50\.0\.min\.js"/);
});
