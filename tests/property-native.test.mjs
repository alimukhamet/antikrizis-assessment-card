import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import vm from 'node:vm';

const compiled=buildSync({entryPoints:['lib/documents/extract-native.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const rules={exports:{}};vm.runInNewContext(compiled,{module:rules,exports:rules.exports});
const {extractNative,kazakhPropertyCertificateHeader}=rules.exports;
const issuer='Құжат электрондық үкімет порталымен құрылған\nДокумент сформирован порталом электронного правительства';
const title='Жылжымайтын мүліктің болмауы (болуы) туралы\nақпарат';
const owner='Кімге берілді: СЫНАҚ КЛИЕНТ, 31.12.1999, ИИН 991231300003';
const receiptDate='Алу күні мен уақыты:\n27.08.2026 Дата получения:';
const page=text=>({page:1,text,nativeCharacters:text.replace(/\s/g,'').length,needsOcr:false});
const text=[issuer,receiptDate,title,owner,'1. Жылжымайтын мүлікке құқық тіркелген:', 'Kaspi Bank; выписка регистрации залога; 01.01.2020'].join('\n');

test('Kazakh eGov F6 heading takes priority over incidental bank/statement references and keeps printed owner/date',()=>{
 const original=[page(text)],before=JSON.stringify(original),r=extractNative(original);
 assert.equal(r.kind,'property');assert.equal(r.identity.iin,'991231300003');assert.equal(r.identity.name,'СЫНАҚ КЛИЕНТ');
 assert.equal(r.issuedAt,'2026-08-27');assert.equal(r.bankStatement,undefined);
 assert.equal(r.findings.includes('STATEMENT_RECONCILIATION_REQUIRED'),false);
 assert.equal(r.facts.some(f=>/statement|property|assets/.test(f.key)),false,'F6 recognition must not infer absence or ownership from its title');
 assert.equal(JSON.stringify(original),before);
 const noBank=extractNative([page(text.replace('Kaspi Bank; выписка регистрации залога; 01.01.2020',''))]);
 assert.equal(noBank.kind,'property');assert.equal(noBank.identity.iin,r.identity.iin);assert.equal(noBank.issuedAt,r.issuedAt);
});

test('F6 detection requires its exact first-page title and portal issuer, never an incidental transaction description',()=>{
 for(const first of [title,issuer,title.replace('болмауы (болуы)','тіркелуі')+'\n'+issuer])assert.equal(kazakhPropertyCertificateHeader(first),false);
 const statement=page('Kaspi ВЫПИСКА за период с 01.09.25 по 31.08.26\n01.01.26 - 1,00 ₸ Перевод '+title);
 assert.equal(extractNative([statement]).kind,'kaspi');
 assert.equal(extractNative([statement,{...page(text),page:2}]).kind,'kaspi','Later supporting material must not reclassify the issuing statement');
});

test('property extraction keeps missing or invalid owner/date unresolved and preserves Russian F6 behavior',()=>{
 for(const broken of [text.replace('ИИН 991231300003','ИИН 991231300004'),text.replace(owner,'')]){
  const r=extractNative([page(broken)]);assert.equal(r.kind,'property');assert.equal(r.identity.iin,null);
  assert.ok(r.findings.includes('DOCUMENT_IDENTITY_UNVERIFIED'));
 }
 for(const broken of [text.replace(receiptDate,''),text.replace('27.08.2026','31.02.2026')])assert.equal(extractNative([page(broken)]).issuedAt,null);
 const ru=extractNative([page('Сведения об отсутствии (наличии) недвижимого имущества\nВыдано: СЫНАҚ КЛИЕНТ, ИИН 991231300003\nДата получения: 27.08.2026')]);
 assert.equal(ru.kind,'property');assert.equal(ru.identity.name,'СЫНАҚ КЛИЕНТ');assert.equal(ru.identity.iin,'991231300003');assert.equal(ru.issuedAt,'2026-08-27');
});
