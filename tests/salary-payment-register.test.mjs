import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {Miniflare} from 'miniflare';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/salary-payment-register.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({env:{}})});
const {loadRegisterFirstPayments:load}=exports;
test('canonical register classifies received contract money, not invoice labels or planned/analysis/refund/void rows',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['FINANCE_DB']});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('FINANCE_DB');
 await db.exec("CREATE TABLE register_state(key TEXT PRIMARY KEY,value TEXT); INSERT INTO register_state VALUES('active','1'); CREATE TABLE register_entries(id INTEGER PRIMARY KEY,client_id INTEGER,kind TEXT,amount_minor INTEGER,currency TEXT,event_date TEXT,service_type_id INTEGER,source_invoice_id INTEGER); CREATE TABLE register_voids(entry_id INTEGER PRIMARY KEY);");
 // Imported recurring receipts and staff register-only receipts have identical
 // canonical evidence; no installment label, reconciliation flag or CRM ID gate.
 await db.prepare(`INSERT INTO register_entries(id,client_id,kind,amount_minor,currency,event_date,service_type_id) VALUES
 (1,1,'receipt',8000000,'KZT','2026-09-07',187),(2,1,'receipt',8000000,'KZT','2026-10-05',187),
 (3,2,'receipt',6000000,'KZT','2026-10-06',187),
 (4,3,'receipt',500000,'KZT','2026-09-01',215),
 (5,4,'planned',10000000,'KZT','2026-09-01',187),
 (6,5,'refund',10000000,'KZT','2026-09-01',187),
 (7,6,'receipt',10000000,'KZT','2026-09-01',187),
 (8,7,'receipt',10000000,'USD','2026-09-01',187),
 (9,8,'receipt',10000000,'KZT','2026-09-01',NULL),
 (10,9,'receipt',10000000,'KZT','2026-09-01',189),
 (11,10,'receipt',0,'KZT','2026-09-01',187),
 (12,11,'receipt',10000000,'KZT',NULL,187),
 (13,12,'receipt',10000000,'KZT','2026-09-01',187),
 (14,12,'refund',10000000,'KZT','2026-09-02',187),
 (15,999,'receipt',10000000,'KZT','2026-09-01',187)`).run();
 await db.prepare('INSERT INTO register_voids VALUES(7)').run();
 await db.prepare('UPDATE register_entries SET source_invoice_id=id*100 WHERE id IN(6,7)').run();
 const before=await db.prepare('SELECT * FROM register_entries ORDER BY id').all();
 const rows=await load(Array.from({length:12},(_,i)=>({id:String(i+1),serviceType:'199'})),db);
 assert.equal(rows.get('1').amount,80000);assert.equal(rows.get('1').entryId,1);assert.equal(rows.get('2').amount,60000);
 for(const id of ['3','4','5','6'])assert.equal(rows.get(id).status,'not_registered',id);
 for(const id of ['7','8','9','10'])assert.equal(rows.get(id).status,'review_required',id);
 assert.equal(rows.get('11').amount,100000);assert.equal(rows.get('11').date,'');
 assert.deepEqual(Array.from(rows.get('6').ignoredLegacyInvoiceIds),[700]);
 assert.deepEqual(Array.from(rows.get('5').ignoredLegacyInvoiceIds),[600]);
 assert.equal(rows.get('12').amount,100000,'Refund-driven salary clawback is not an approved rule');
 assert.equal(rows.has('999'),false);assert.equal(rows.size,12);
 assert.deepEqual((await db.prepare('SELECT * FROM register_entries ORDER BY id').all()).results,before.results,'Reads preserve every payment');
 assert.equal((await load([{id:'9',serviceType:'201'}],db)).get('9').amount,100000);
 assert.equal((await load([{id:'1',serviceType:''}],db)).get('1').status,'review_required');
 await db.prepare("UPDATE register_state SET value='0'").run();
 await assert.rejects(()=>load([{id:'1',serviceType:'199'}],db),/не активен/);
});
test('missing, malformed, out-of-scope and duplicate evidence fails instead of fabricating zero salary',async()=>{
 await assert.rejects(()=>load([{id:'1',serviceType:'199'}]),/недоступен/);
 const row={id:1,client_id:1,kind:'receipt',amount_minor:100000,currency:'KZT',event_date:'2026-09-01',service_type_id:187};
 for(const response of [{success:false,results:[]},{success:true},{success:true,results:[{...row,client_id:999}]},{success:true,results:[row,row]},{success:true,results:[{...row,kind:'invalid'}]}]){
  const db={prepare:()=>({first:async()=>({value:'1'}),bind:()=>({all:async()=>response})})};
  await assert.rejects(()=>load([{id:'1',serviceType:'199'}],db));
 }
});
