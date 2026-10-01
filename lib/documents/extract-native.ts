import labels from './kz-labels.json';
import type { PageText } from './read-pdf';
import {extractPowerParties,type PowerParties} from './power-of-attorney';
export const EXTRACTION_VERSION = 'rules-native-31';
export type Fact = { key: string; value: string; page: number; source: string };
export type Credit = { contractNumber: string; contractCode?: string; page: number; facts: Fact[]; components: Record<string, string | null>; comparisonDebt?:Fact; relatedPartiesNotice?: {page:number;source:string} };
export type BankStatement={from:string|null;to:string|null;credits:string;topUps:string;topUpsVerified:boolean;debits:string;transactions:number;reconciled:boolean;rowsReadable:boolean;sourcePage:number;reconciliation?:string;gambling?:{total:string;matches:Array<{date:string;amount:string;description:string;page:number}>}};
export type NativeExtraction = { version: string; kind: string; identity: { iin: string | null; name: string | null }; issuedAt: string | null; expiresAt?:string|null; facts: Fact[]; credits: Credit[]; findings: string[];creditList?:{complete:boolean;declared:number|null};bankStatement?:BankStatement;coverage?:{from:string|null;to:string|null};power?:PowerParties };
export function validIin(s: string | null): s is string {
  if (!s || !/^\d{12}$/.test(s) || /^0+$/.test(s)) return false;
  const a = [...s].map(Number); let n = a.slice(0, 11).reduce((sum, x, i) => sum + x * (i + 1), 0) % 11;
  if (n === 10) n = a.slice(0, 11).reduce((sum, x, i) => sum + x * [3,4,5,6,7,8,9,10,11,1,2][i], 0) % 11;
  return n < 10 && n === a[11];
}
function value(pattern: RegExp, text: string): string | null { return pattern.exec(text)?.[1]?.trim() || null; }
function canonical(text: string): string {
  for (const [from, to] of Object.entries(labels).sort((a,b) => b[0].length-a[0].length)) text = text.split(from).join(to);
  return text.replace(/(\/\s*валюта)\s+(?=[0-9])/g, '$1: ').replace(/Фаза контракта:\s*:?\s*/g,'Фаза контракта: ');
}
function amount(label: string, text: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const v = value(new RegExp(escaped + '\\s*/?\\s*валюта:\\s*([\\d ,.]+)\\s*KZT','i'), text)?.replace(/\s/g, '').replace(',', '.');
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [integer, fraction = ''] = v.split('.'); return `${integer}.${fraction.padEnd(2,'0')}`;
}
function day(v: string | null): string | null {
  if (!v || !/^\d{2}\.\d{2}\.\d{4}$/.test(v)) return null;
  const iso = v.slice(6)+'-'+v.slice(3,5)+'-'+v.slice(0,2), d = new Date(iso+'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === iso ? iso : null;
}
/** Date proposals from an ID's printed labels or its explicit validity range, never its birthday. */
export function identityCardDates(pages:Array<{page:number;text:string}>){
 const issued=new Map<string,number>(),expires=new Map<string,number>();let invalid=false;
 const date='(\\d{2}\\.\\d{2}\\.\\d{4})';
 const labels={issued:'(?:дата выдачи|берілген күні)',expires:'(?:действителен до|действительно до|действует до|жарамдылық мерзімі|жарамды мерзімі)'};
 const add=(target:Map<string,number>,raw:string,page:number)=>{const parsed=day(raw);if(parsed)target.set(parsed,page);else invalid=true;};
 for(const page of pages){
  for(const m of page.text.matchAll(new RegExp(date+'\\s*[-–—]\\s*'+date,'gu'))){add(issued,m[1],page.page);add(expires,m[2],page.page);}
  for(const [key,label]of Object.entries(labels))for(const m of page.text.matchAll(new RegExp(label+'(?:[\\s/:]+'+label+')*[\\s/:]*'+date,'giu'))){add(key==='issued'?issued:expires,m[1],page.page);}
 }
 const issuedAt=issued.size===1?[...issued.keys()][0]:null,expiresAt=expires.size===1?[...expires.keys()][0]:null;
 if(invalid||issued.size>1||expires.size>1||issuedAt&&expiresAt&&issuedAt>expiresAt)return {issuedAt:null,expiresAt:null,page:null};
 return {issuedAt,expiresAt,page:issuedAt?issued.get(issuedAt)!:expiresAt?expires.get(expiresAt)!:null};
}
function identityCardHeader(text:string){
 // Digital cards may omit a patronymic and print sex beside the birth date.
 // Still demand the adjacent IIN/card-number structure, not any ID in the PDF.
 const card=/^((?:[А-ЯӘІҢҒҮҰҚӨҺЁ '-]+\n){2,3})\d{2}\.\d{2}\.\d{4}[ \t]*(?:[МЖӘЕMF][ \t]*)?\n\s*(\d{12})\s*\n\d{9}\b/m.exec(text);
 return card?{iin:card[2],name:card[1].replace(/\s+/g,' ').trim()}:null;
}
function identityCardWithoutIssuer(text:string,pages:PageText[]){
 const header=identityCardHeader(text),dates=identityCardDates(pages);
 // Some digital cards render the title/issuer as graphics. Demand the full
 // printed card structure, a checksum-valid IIN, MRZ and an unambiguous term.
 return !!header&&validIin(header.iin)&&/^[A-Z]+<<[A-Z<]+\s*$/m.test(text)&&!!dates.issuedAt&&!!dates.expiresAt;
}
const isLombard=(creditor:string)=>/(?:^|[^\p{L}\p{N}])(?:ломбард|lombard)(?=$|[^\p{L}\p{N}])/iu.test(creditor);
/** The F6 title and issuing portal identify the document before bank names in its property records. */
export function kazakhPropertyCertificateHeader(firstPage:string):boolean{
 const front=firstPage.toLowerCase().replace(/\s+/g,' ');
 return /жылжымайтын мүліктің болмауы \(болуы\) туралы ақпарат/u.test(front)
  && /құжат электрондық үкімет порталымен құрылған|документ сформирован порталом электронного правительства/u.test(front);
}
/** Repayment-account transfers do not establish Kaspi Gold card turnover. */
export function loanAccountStatementHeader(firstPage:string):boolean{
 return /(?:^|\n)[ \t]*выписка\s+по\s+кредитам\s+за\s+период\s+с\s+\d{2}\.\d{2}\.(?:\d{4}|\d{2})\b/iu.test(firstPage);
}
/** Questionnaire categories agreed for GKB intake; preserve the bureau wording in the source. */
function questionnaireCreditType(financing:string|null,purpose:string|null,object:string|null,security:string|null):string|null{
 if(financing==='Кредитная карта')return 'Кредитная карта';
 if(/микрокредит|микрозайм/i.test(financing||''))return 'Микрозайм';
 if(/ипоте[кч]/i.test(financing||''))return 'Ипотека';
 if(/жилая недвижимость|тұрғын үй жылжымайтын мүлік/i.test(object||'')&&/приобретени|покуп|сатып\s*алу/i.test(purpose||'')&&/залог недвижимости|жылжымайтын мүлік кепілі/i.test(security||''))return 'Ипотека';
 if(/автомобил|автокөлік/i.test(object||'')&&!/кроме|исключен|басқас|қоспағанда/i.test(object||''))return 'Автокредит';
 const consumerGoods=/потребительск.{0,40}товар|тұтынушылық.{0,30}тауар/i.test(object||'');
 if(/товарный кредит/i.test(financing||'')||consumerGoods&&/приобретени|покуп|сатып\s*алу/i.test(purpose||''))return 'Товарный кредит';
 if(/пополнение оборотных средств|айналым қаражатын толтыру/i.test(purpose||'')||/производственн|өндірістік/i.test(object||''))return 'Другое';
 if(/^(?:қарыз|за[её]м|займ|потребительский кредит)$/i.test(financing||'')&&!/недвижим|жылжымайтын/i.test(object||'')||/потребительск|тұтынушылық/i.test(object||''))return 'Потребительский кредит';
 if(/^(?:кредитная линия|транш в рамках кредитной линии|несие желісі|шектелмелі келісім аясындағы транш|овердрафт|факторинг)$/i.test(financing||''))return 'Другое';
 return null;
}
export function extractNative(pages: PageText[]): NativeExtraction {
  const raw = pages.map(p => p.text).join('\n'), head = raw.slice(0,14000).toLowerCase().replace(/ё/g,'е');
  // Choose the layout from the first report title. Older reports also mention
  // "Дербес кредиттік есеп" in their explanatory pages; that is not their format.
  const reportTitle=/(?:дербес\s+кредиттік есеп|персональный кредитный отчет|жеке кредиттік есеп)/u.exec(head)?.[0];
  const modernShort=Boolean(reportTitle?.startsWith('дербес')&&/қысқаша нысан/.test(head.slice(0,1500)));
  const firstBureauKz=/^\s*(?:толық\s+)?дербес несиелік есеп\s+id\s+\d+/u.test(head)&&/\b1cb\.kz\b/u.test(head);
  const firstBureau=firstBureauKz||/^\s*(?:полный\s+)?персональный кредитный отчет\s+id\s+\d+/u.test(head)&&/\b1cb\.kz\b/u.test(head);
  const credit = modernShort || /персональный кредитный отчет|жеке кредиттік есеп/.test(head);
  // Identify the issuing bank before transaction counterparties. A transfer to
  // Kaspi must not turn a Eurasian account statement into a Kaspi statement.
  const statementFront=(pages[0]?.text||'').toLowerCase().replace(/ё/g,'е');
  const compactFront=statementFront.replace(/\s+/g,' '),compactHead=head.replace(/\s+/g,' ');
  const pensionAccount=/сведения об остатках и о движении денег на счете/.test(compactFront)
    && /выписка с (?:условного|индивидуального) пенсионного счета/.test(compactHead);
  const propertyRights=/о зарегистрированных правах \(обременениях\)/.test(compactFront)
    && /на недвижимое имущество и его технических характеристиках/.test(compactFront);
  const eurasian=/^\s*ао\s*[«"“]?евразийский банк[»"”]?/u.test(statementFront)&&/выписка по сч[её]ту/u.test(statementFront)&&/eubank\.kz|eurikzka/u.test(statementFront);
  const halyk=/выписка по счету/.test(head)&&/тип счета\s*:[^\n]*зарплата/.test(head)&&/народный банк казахстана|halykbank\.kz/.test(head);
  const loanAccountStatement=loanAccountStatementHeader(pages[0]?.text||'');
  const kind = firstBureau ? 'gkb_full' : credit ? /краткая форма|қысқаша/.test(head) ? 'gkb_short' : 'gkb_full'
    : loanAccountStatement ? 'unknown'
    : eurasian||halyk ? 'salary'
    : pensionAccount ? 'enpf'
    : kazakhPropertyCertificateHeader(pages[0]?.text||'') ? 'property'
    : /kaspi/.test(head) && /выписка|үзінді\s+көшірме/u.test(head) ? 'kaspi'
    : /об отсутствии \(наличии\) недвижимого имущества/.test(head) ? 'property'
    : propertyRights ? 'encumbrance'
    : /информация о пенсионных выплатах и пособиях/.test(head) ? 'benefits'
    : /выдача\s+информации\s+о\s+поступлении\s+и\s+движении\s+средств\s+вкладчика\s+единого\s+накопительного\s+пенсионного\s+фонда/.test(head) ? 'enpf'
    : /удостоверение личности|жеке куәлік/.test(head)||/МИНИСТЕРСТВО ВНУТРЕННИХ ДЕЛ РК|(?:ҚАЗАҚСТАН РЕСПУБЛИКАСЫНЫҢ|ҚР)\s+ІШКІ ІСТЕР МИНИСТРЛІГІ/iu.test(raw)&&/^[A-Z]+<<[A-Z<]+$/m.test(raw)&&/^\d{12}\s*$/m.test(raw)||identityCardWithoutIssuer(raw,pages) ? 'identity'
    : /(?:^|\n)\s*доверенность\s*(?:\n|$)/i.test(raw) ? 'power_of_attorney' : 'unknown';
  const output: NativeExtraction = { version: EXTRACTION_VERSION, kind, identity: { iin:null, name:null }, issuedAt:null, facts:[], credits:[], findings:[] };
  if (pages.some(p => p.needsOcr)) output.findings.push('OCR_OR_PAGE_REVIEW_REQUIRED');
  const transformed = credit ? pages.map(p => ({...p,text:canonical(p.text)})) : pages;
  const text = transformed.map(p => p.text).join('\n');
  if (credit&&!firstBureau) {
    const russian = [...raw.matchAll(/Страница\s+(\d+)\s+из\s+(\d+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    const kazakh = [...raw.matchAll(/(\d+)\s+беттің\s+(\d+)\s+бет(?:і)?(?=\s|$)/gu)].map(m=>[Number(m[1]),Number(m[2])]);
    // Both Kazakh footer layouts exist. Accept only an entire, ordered 1..N sequence.
    // An e-government signing certificate may follow the last numbered report page.
    const complete=(marks:number[][])=>marks.length>0&&marks.every(([number,total],i)=>total===marks.length&&number===i+1);
    if (!complete([...russian,...kazakh]) && !complete([...russian,...kazakh.map(([a,b])=>[b,a])])) output.findings.push('PAGE_COMPLETENESS_UNVERIFIED');
  }
  if (credit) {
    const front = text.slice(0,10000);
    const iin = value(/(?:ИИН|ЖСН)\s*:?\s*(\d{12})\b/,front);
    if (validIin(iin)) output.identity.iin = iin;
    const parts = ['Фамилия','Имя','Отчество'].map(label => value(new RegExp(label+':[ \\t]*([^\\n]+)'),front));
    if (parts[0] && parts[1]) output.identity.name = parts.filter(p => p && p !== 'Нет данных').join(' ');
    output.issuedAt = day(value(/Дата выдачи:\s*(\d{2}\.\d{2}\.\d{4})/,front));
    if(modernShort){
      const header=pages[0]?.layoutText||pages[0]?.text||'';
      const owner=value(/ЖСН:\s*(\d{12})\b/u,header);
      if(validIin(owner))output.identity.iin=owner;
      output.identity.name=value(/ТАӘ:[ \t]*([^\n]+)/u,header);
      output.issuedAt=day(value(/БЕРІЛГЕН КҮНІ МЕН УАҚЫТЫ:[ \t]*(\d{2}\.\d{2}\.\d{4})/u,header));
    }
  } else if (['kaspi','property','encumbrance','benefits','identity','salary'].includes(kind)) {
    const front = raw.slice(0,8000), iin = value(/(?:ИИН|ЖСН)\s*\/?\s*(?:ИИН)?\s*:?\s*(\d{12})\b/,front);
    if (validIin(iin)) output.identity.iin = iin;
    output.identity.name = kind === 'kaspi' ? (value(/подтверждает,\s*что\s+([\s\S]+?),\s*ИИН/i,front)||value(/«Kaspi\s+Bank»\s+АҚ\s+([^,]+),\s*ЖСН/u,front))?.replace(/\s+/g,' ') || null : kind === 'property' ? value(/(?:Выдан[ао]|Кімге\s+берілді):[ \t]*([^,\n]+)/iu,front) : null;
  }
  if(kind==='salary'){
    const front=(pages[0]?.text||'').replace(/:(?:[ \t]*:)+/g,':');
    const iin=value(/(?:ИИН|ЖСН)\s*:\s*(\d{12})\b/,front);
    if(validIin(iin))output.identity.iin=iin;
    output.identity.name=value(/ФИО\s*:\s*([^\n]+?)(?=\s+Дата формирования(?: выписки)?\s*:|\n|$)/,front);
    output.issuedAt=day(value(/Дата формирования(?: выписки)?\s*:\s*(\d{2}\.\d{2}\.\d{4})/,front));
    const period=/Период(?: выписки)?\s*:\s*(?:с\s*)?(\d{2}\.\d{2}\.\d{4})\s*(?:по|[-–—])\s*(\d{2}\.\d{2}\.\d{4})/.exec(front);
    output.coverage={from:day(period?.[1]||null),to:day(period?.[2]||null)};
    // A salary account statement includes transfers as well as wages. Its totals are not income facts.
  }
  if(kind==='power_of_attorney'){
    output.power=extractPowerParties(raw);output.findings.push(...output.power.findings);
    if(output.power.principal&&validIin(output.power.principal.iin))output.identity={iin:output.power.principal.iin,name:output.power.principal.name};
  }
  if(kind==='enpf'){
    const owner=/\b(\d{12})\s*\n([^\n]+?)\s*ТАӘ\/ФИО:\s*ЖСН\/ИИН:/.exec(pages[0]?.text||'');
    if(owner&&validIin(owner[1]))output.identity={iin:owner[1],name:owner[2].trim()};
    output.issuedAt=day(value(/(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}:\d{2}\s+Алу\s+күні\/Дата\s+получения:/,raw));
    const period=/(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s+Период:/.exec(pages[0]?.text||'');
    output.coverage={from:day(period?.[1]||null),to:day(period?.[2]||null)};
    if(pensionAccount){
      const front=pages[0]?.text||'';
      const ids=[...new Set([...front.matchAll(/(?:ИИН|ЖСН)\s*:?\s*(\d{12})\b/g)].map(m=>m[1]).filter(validIin))];
      output.identity={iin:ids.length===1?ids[0]:null,name:value(/(?:^|\n)\s*ФИО[ \t:]+([^\n]+)/,front)};
      output.issuedAt=day(value(/по состоянию на\s*(\d{2}\.\d{2}\.\d{4})/i,front));
      const periods=[...raw.matchAll(/за\s+период\s+с\s*(\d{2}\.\d{2}\.\d{4})\s*г?\.?\s*по\s*(\d{2}\.\d{2}\.\d{4})/gi)];
      const distinct=[...new Set(periods.map(m=>JSON.stringify([day(m[1]),day(m[2])])))]
        .map(pair=>JSON.parse(pair) as [string|null,string|null]);
      const period=distinct.length===1?distinct[0]:null;
      output.coverage=period?.[0]&&period[1]&&period[0]<=period[1]?{from:period[0],to:period[1]}:{from:null,to:null};
      // Account balances and pension contributions are not salary. This layout
      // has no supported payer-table parser; keep employment answers for review.
      output.findings.push('ENPF_ROWS_REVIEW_REQUIRED');
    }else extractEnpfPayers(pages,output);
  }
  if(kind==='encumbrance'||kind==='property'){
    const front=pages[0]?.text||'';
    output.issuedAt=day(value(/(?:Дата получения\s*:?\s*(\d{2}\.\d{2}\.\d{4}))/,front)
      ||value(/(\d{2}\.\d{2}\.\d{4})\s+Дата получения/,front));
  }
  if(kind==='identity'&&!output.identity.iin){
    const card=identityCardHeader(raw);
    if(card&&validIin(card.iin))output.identity={iin:card.iin,name:card.name};
  }
  if(kind==='identity'){const dates=identityCardDates(pages);output.issuedAt=dates.issuedAt;output.expiresAt=dates.expiresAt;}
  if(kind==='benefits'){
    output.issuedAt=day(value(/Дата получения:\s*(\d{2}\.\d{2}\.\d{4})/,raw));
    // Some exports place the history table's column labels before its title.
    const active=/Действующие выплаты:\s*([\s\S]*?)(?:Төленген төлемдер\s*\/\s*Выплаченные выплаты:|Кезең\s*\/\s*Период)/.exec(raw);
    if(active){
      const term='(?:\\d{2}\\.\\d{2}\\.\\d{4}|мерзімсіз\\s*\\/\\s*бессрочно|өмір\\s+бойы\\s*\\/\\s*пожизненно|БЖЗҚ\\s+шотындағы\\s+қаражат\\s+таусылғанға\\s+дейін\\s*\\/\\s*до\\s+исчерпания\\s+средств,\\s*имеющихся\\s+на\\s+счете\\s+в\\s+ЕНПФ)';
      const rows=[...active[1].matchAll(new RegExp('(?:^|\\n)[ \\t]*(\\d{1,3})\\s+([\\s\\S]+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+('+term+')(?=\\s*(?:\\n[ \\t]*\\d{1,3}\\s+|$))','giu'))];
      const first=rows[0]?.index??0,last=rows.at(-1);
      // Only headings may precede the rows; no unmatched row or tail can vanish.
      const prefix=active[1].slice(0,first),tail=last?active[1].slice(last.index!+last[0].length):active[1];
      const contiguous=rows.every((r,i)=>i===0||!active[1].slice(rows[i-1].index!+rows[i-1][0].length,r.index).trim());
      if(output.issuedAt&&rows.length&&!/\d/.test(prefix)&&!tail.trim()&&contiguous&&rows.every((r,i)=>Number(r[1])===i+1&&day(r[4])&&(!/^\d/.test(r[5])||day(r[5]))&&!/\n[ \t]*\d{1,3}(?:[ \t]+(?=\S)|[ \t]*\n)/.test(r[2]))){
        const evidence=rows.map(r=>r[2].replace(/\s+/g,' ').trim()+'; сумма в строке '+r[3]+' ₸; назначено '+r[4]+(/^\d/.test(r[5])?'; до ':'; срок ')+r[5].replace(/\s+/g,' ').trim()).join(' | ');
        output.facts.push({key:'benefits.count',value:String(rows.length),page:pages.find(p=>p.text.includes('Действующие выплаты:'))?.page||1,source:'Действующие выплаты на дату справки '+output.issuedAt+': '+evidence+'. Исторические выплаты не включены; актуальность, сумму и периодичность уточните у клиента.'});
      }else output.findings.push('BENEFITS_ACTIVE_TABLE_REVIEW_REQUIRED');
    }
  }
  if(firstBureau)parseFirstCreditBureau(firstBureauKz?firstBureauKzPages(pages):pages,output,firstBureauKz?pages:undefined);
  if (output.identity.iin) output.facts.push({key:'identity.iin',value:output.identity.iin,page:1,source:'ИИН владельца документа'});
  else output.findings.push('DOCUMENT_IDENTITY_UNVERIFIED');
  if (output.identity.name) output.facts.push({key:'identity.name',value:output.identity.name,page:1,source:'ФИО владельца документа'});
  if (kind === 'unknown') output.findings.push('DOCUMENT_TYPE_UNVERIFIED');
  if(loanAccountStatement)output.findings.push('KASPI_LOAN_STATEMENT_NOT_GOLD');
  if (kind === 'gkb_full'&&!firstBureau) {
    let at=0; const starts = transformed.map(p => { const out={at,page:p.page};at+=p.text.length+1;return out; });
    const blocks=[...text.matchAll(/(?:^|\n)Обязательство\s+\d+\s*(?:\n|$)/g)];
    for (let n=0;n<blocks.length;n++) {
      const match=blocks[n], index=match.index!, block=text.slice(index+match[0].length,blocks[n+1]?.index ?? text.length);
      if (!/Фаза контракта:\s*Действующий/.test(block)) continue;
      const role=value(/Роль субъекта:[ \t]*([^\n]+)/,block);
      if (!role?.split(/[,;]/).some(r=>/^за[её]мщик$/i.test(r.trim()))) { output.findings.push('OTHER_BORROWER_ROLE_REQUIRES_REVIEW');continue; }
      const contractNumber=value(/Номер договора:\s*([^\n]+)/,block), contractCode=value(/Код контракта:\s*([^\n]+)/,block), creditor=value(/Кредитор:\s*([\s\S]*?)(?=\n[^\n]*:|$)/,block)?.replace(/\s+/g,' ')||null;
      if (!contractNumber || !creditor) {output.findings.push('INCOMPLETE_CONTRACT');continue;}
      const page=starts.filter(p => p.at<=index+match[0].indexOf('Обязательство')).at(-1)!.page;
      const overdue=value(/Количество дней просрочки:\s*(\d+)\b/,block);
      const remaining=amount('Остаточная (использованная) сумма',block) ?? amount('Сумма предстоящих платежей',block);
      const arrears=amount('Сумма просроченных взносов',block), aggregatePenalty=amount('Сумма непогашенной неустойки',block), unpaidFine=amount('Сумма непогашенного штрафа',block), penalty=aggregatePenalty??unpaidFine, interest=amount('Пеня',block), fine=amount('Штраф',block);
      const scheduledPayment=amount('Ежемесячная сумма взноса',block) ?? amount('Сумма ежемесячного платежа',block);
      const nextPayment=amount('Сумма предстоящего платежа',block);
      const defaulted=overdue!==null&&Number(overdue)>0;
      const start=day(value(/Дата начала срока действия контракта:\s*(\d{2}\.\d{2}\.\d{4})/,block));
      const facts: Fact[]=[]; const add=(key:string,v:string|null,source:string,needle=source)=>{if(v!==null){const offset=block.indexOf(needle),factPage=offset<0?page:starts.filter(p=>p.at<=index+match[0].length+offset).at(-1)!.page;facts.push({key,value:v,page:factPage,source});}};
      add('creditor',creditor,'Кредитор');
      add('contractIdentifier',contractCode??contractNumber,contractCode?'Код контракта':'Номер договора');
      add('loanStatus',overdue===null?null:defaulted?'В просрочке — требуют полную сумму':'Платится по графику','Статус по количеству дней просрочки','Количество дней просрочки');
      add('startedAtMonth',start?.slice(0,7)||null,'Дата начала срока действия контракта');
      if(!defaulted)add('monthlyPayment',scheduledPayment??nextPayment,'Ежемесячный платёж по графику',scheduledPayment!==null?(/Ежемесячная сумма взноса|Сумма ежемесячного платежа/.exec(block)?.[0]||''):'Сумма предстоящего платежа');
      add('overdueDays',overdue,'Количество дней просрочки');
      const ambiguous = overdue === null || arrears===null || Number(arrears)>0 || [penalty,interest,fine].some(v => v!==null && Number(v)>0);
      // The singular "next payment" is an instalment even on an overdue loan.
      // It is never evidence of the full accelerated balance.
      if (remaining !== null && !ambiguous) add('debtOutstanding',remaining,'Остаток / предстоящие платежи при отсутствии показанной просрочки; требуется проверка',amount('Остаточная (использованная) сумма',block)!==null?'Остаточная (использованная) сумма':'Сумма предстоящих платежей');
      const financing=value(/Вид финансирования:\s*([^\n]+)/,block),purpose=value(/Цель кредита:\s*([^\n]+)/,block),object=value(/Объект кредитования:\s*([\s\S]*?)(?=\n[^\n]*:|$)/,block)?.replace(/\s+/g,' ')||null;
      const security=value(/Вид обеспечения:\s*([^\n]+)/,block);
      const lombard=isLombard(creditor),type=lombard?'Ломбард':questionnaireCreditType(financing,purpose,object,security);
      add('creditType',type,lombard?'Кредитор: '+creditor+'; ломбард указан в названии кредитора.':'Вид финансирования: '+(financing||'—')+'; цель кредита: '+(purpose||'—')+'; объект кредитования: '+(object||'—'),lombard?'Кредитор:':'Вид финансирования:');
      const purposes: Array<[RegExp,string]>=[[/рефинанс|қайта қаржыландыру/i,'Погашение других долгов'],[/приобретение жилья|сатып.*тұрғын|тұрғын.*сатып/i,'Жильё'],[/лечение|емдеу/i,'Лечение'],[/образование|оқу ақысын/i,'Образование'],[/ремонт|жөндеу/i,'Ремонт']];
      const mapped=purposes.find(([pattern])=>pattern.test(purpose||''));if(mapped)add('purpose',mapped[1],'Цель кредита: '+purpose,'Цель кредита:');
      // A broad purpose such as "purchase" does not establish what the client spent it on.
      const related=/Связанные субъекты\s*([\s\S]*?)(?=Информация о просрочках|Информация по состоянию|Данные по количеству дней и сумме просроченных платежей|Шарттың [^\n]*күндер саны|\n\d{4} (?:год|жыл)|$)/.exec(block)?.[1]
       ?.replace(/(?:^|\n)\s*(?:Страница\s+\d+\s+из\s+\d+|\d+\s+беттің\s+\d+\s+бет(?:і)?)\s*(?=\n|$)/gmu,'\n');
      let relatedPartiesNotice:Credit['relatedPartiesNotice'];
      if(related){
       const empty=related.match(/Нет данных/g)?.length||0;
       const people=[...related.matchAll(/(?:^|\n)\s*(Соза[её]мщик(?:\s*\(присоединившееся\s+лицо\)\s+с\s+солидарными\s+обязательствами)?|Гарант|Поручитель|Залогодатель|Кепіл беруші|Кепілдік\s+беруші\s*-\s*[OО]|Ынтымақты\s+міндеттемелері\s+бар\s+қосалқы\s+қарыз\s+алушы\s*\(қосылған\s+тұлға\))\s+([\p{L}\s'-]{3,180}?)\s+(\d{12})\b/giu)];
       if(people.length&&people.length===(related.match(/\b\d{12}\b/g)||[]).length&&people.every(p=>validIin(p[3]))){
        // Preserve the role. "Кепіл беруші" is a pledgor, not a guarantor (Kaspi bilingual pledge form, clauses 1.1.2).
        const described=people.map(p=>`${p[2].replace(/\s+/g,' ').trim()} — ${p[1]==='Кепіл беруші'?'Залогодатель (в ГКБ: Кепіл беруші)':p[1].replace(/\s+/g,' ')}`);
        add('relatedParties',described.join('; '),'Связанные субъекты: '+related.trim(),'Связанные субъекты');
       }else if(empty===5&&/(?:Номер документа|Құжат нөмірі):\s*(?:Нет данных\s*){5}$/.test(related.trim())&&!/Соза[её]мщик|Гарант|Поручитель|Залогодатель|Кепіл беруші|\b\d{12}\b/i.test(related)){
        // The explicit five-cell empty row maps to "Нет" under the agreed intake rule.
        // An absent, partial, or unreadable table still supplies no answer.
        add('relatedParties','Нет','Связанные субъекты: во всех пяти графах указано «Нет данных» / «Деректер жоқ».','Связанные субъекты');
       }
      }
      // Calculate debt only from three explicitly reported, non-overlapping components.
      // Never treat "Нет данных" as zero or add both aggregate and itemized fees.
      let comparisonDebt:Fact|undefined;
      if(remaining!==null&&arrears!==null&&penalty!==null&&!(aggregatePenalty!==null&&unpaidFine!==null)&&!/(?:^|\n)\s*(?:Пеня|Штраф)\s*\/?\s*валюта/.test(block)){
       const cents=(s:string)=>BigInt(s.split('.')[0])*BigInt(100)+BigInt((s.split('.')[1]||'').padEnd(2,'0'));
       const sum=cents(remaining)+cents(arrears)+cents(penalty),number=`${sum/BigInt(100)}.${String(sum%BigInt(100)).padStart(2,'0')}`;
       comparisonDebt={key:'debtComponentsTotal',value:number,page,source:`Расчёт по полному ГКБ: остаток / предстоящие платежи ${remaining} + просроченные взносы ${arrears} + ${aggregatePenalty!==null?'неустойка':'непогашенный штраф'} ${penalty} = ${number} ₸.`};
       if(!facts.some(f=>f.key==='debtOutstanding'))facts.push({...comparisonDebt,key:'debtOutstanding'});
      }
      if(!facts.some(f=>f.key==='debtOutstanding'))output.findings.push('TOTAL_DEBT_REQUIRES_RECONCILIATION');
      output.credits.push({contractNumber,...(contractCode?{contractCode}:{}),page,facts,components:{remaining,arrears,penalty,interest,fine},...(comparisonDebt?{comparisonDebt}:{}),...(relatedPartiesNotice?{relatedPartiesNotice}:{})});
    }
    // A borrower can also be the pledgor of the same loan. The role total can
    // therefore exceed the number of debts; use the borrower's summary row.
    const summary=text.slice(0,blocks[0]?.index??text.length).split(/(?:Действующие обязательства|Действующий міндеттемелер)\s*:?\s*\(\d+\)/)[1]?.split(/(?:Шарт кезеңі|Фаза контракта):|Завершенн/)[0];
    const borrowers=summary?value(/(?:^|\n)\s*За[её]мщик\s+(\d+)\b/,summary):null;
    const roleTotal=value(/(?:Действующие обязательства|Действующий міндеттемелер)\s*:?\s*\((\d+)\)/,text);
    const declared=borrowers??roleTotal;
    const unique=new Set(output.credits.map(c=>(c.facts.find(f=>f.key==='creditor')?.value||'').toLowerCase().replace(/\s/g,'')+'|'+(c.contractCode||c.contractNumber))).size===output.credits.length;
    const complete=declared!==null&&Number(declared)===output.credits.length&&unique&&!output.findings.includes('INCOMPLETE_CONTRACT')&&(borrowers!==null||!output.findings.includes('OTHER_BORROWER_ROLE_REQUIRES_REVIEW'));
    output.creditList={complete,declared:declared===null?null:Number(declared)};
    if (!complete) output.findings.push('CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES');
  }
  if(kind==='gkb_short'&&modernShort)parseModernShort(pages,output);
  if(kind==='gkb_short'&&!modernShort){
    const declared=value(/(?:Действующие обязательства|Действующий міндеттемелер|Қолданыстағы міндеттемелер)\s*:\s*(\d+)/,text);
    const summary=text.split(/(?:Общая сумма задолженности\/валюта|Жалпы қарыз\/валюта)\s*:/)[1]?.slice(0,700);
    const total=summary?value(/([0-9][0-9 .,]*)\s+KZT/,summary):null;
    const cents=(v:string)=>{const n=v.replace(/\s/g,'').replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(n)?BigInt(n.split('.')[0])*BigInt(100)+BigInt((n.split('.')[1]||'').padEnd(2,'0')):null;};
    const expected=total===null?null:cents(total);let sum=BigInt(0);
    const seen=new Set<string>();
    for(const page of transformed){
      // Last payment is historical; it must never become a monthly payment suggestion.
      const rows=page.text.matchAll(/((?:АО|ТОО|АҚ|ЖШС|TOO|AO|Акционерное\s+общество|Товарищество\s+с\s+ограниченной\s+ответственностью)\s+[\s\S]{1,240}?)(?:[ \t]{2,}|\n)(\S+(?:[ \t]\S+)*)\s{2,}((?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s+KZT\s{2,}(\d+)\s{2,}(?:\d{4}-\d{2}-\d{2}|Нет данных)\s{2,}(?:[0-9][0-9 .,]*?\s+KZT|Нет данных)/g);
      for(const row of rows){
        const creditor=row[1].replace(/\s+/g,' ').trim(),contractNumber=row[2],debt=cents(row[3]);
        if(debt===null||creditor.length>240)continue;
        if(/\.\.|…/.test(contractNumber))output.findings.push('SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED');
        const key=JSON.stringify([creditor,contractNumber]);if(seen.has(key)){output.findings.push('SHORT_DUPLICATE_CREDIT','SHORT_CREDIT_LIST_UNVERIFIED');continue;}seen.add(key);sum+=debt;
        const amount=`${debt/BigInt(100)}.${String(debt%BigInt(100)).padStart(2,'0')}`;
        output.credits.push({contractNumber,page:page.page,facts:[{key:'creditor',value:creditor,page:page.page,source:row[0]},{key:'debtOutstanding',value:amount,page:page.page,source:row[0]},{key:'overdueDays',value:row[4],page:page.page,source:row[0]}],components:{}});
      }
    }
    if(declared===null||expected===null)output.findings.push('SHORT_SUMMARY_MISSING');
    if(declared!==null&&Number(declared)!==output.credits.length)output.findings.push('SHORT_CREDIT_COUNT_MISMATCH');
    if(expected!==null&&expected!==sum)output.findings.push('SHORT_TOTAL_MISMATCH');
    if(declared===null||Number(declared)!==output.credits.length||expected===null||expected!==sum)output.findings.push('SHORT_CREDIT_LIST_UNVERIFIED');
    output.creditList={complete:!output.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'),declared:declared===null?null:Number(declared)};
  }
  if(kind==='gkb_short')for(const credit of output.credits){
    const overdue=credit.facts.find(f=>f.key==='overdueDays');
    if(overdue&&/^\d+$/.test(overdue.value)&&!credit.facts.some(f=>f.key==='loanStatus'))credit.facts.push({key:'loanStatus',value:Number(overdue.value)>0?'В просрочке — требуют полную сумму':'Платится по графику',page:overdue.page,source:'Статус по указанному в кратком ГКБ количеству дней просрочки: '+overdue.value+'. '+overdue.source});
    // Older short layouts also print the full contract number. Expose it as
    // reviewable evidence so the form does not ask staff to type it again.
    if(credit.contractNumber&&!/\.\.|…/.test(credit.contractNumber)&&!credit.facts.some(f=>f.key==='contractIdentifier'))credit.facts.push({key:'contractIdentifier',value:credit.contractNumber,page:credit.page,source:'Номер договора: '+credit.contractNumber});
    const creditor=credit.facts.find(f=>f.key==='creditor');
    if(creditor&&isLombard(creditor.value))credit.facts.push({key:'creditType',value:'Ломбард',page:creditor.page,source:'Кредитор: '+creditor.value+'; ломбард указан в названии кредитора.'});
  }
  if(kind==='kaspi'){
    output.bankStatement=parseKaspiStatement(pages);
    const statement=output.bankStatement;
    if(!statement.rowsReadable||!statement.reconciled||!statement.topUpsVerified)output.findings.push('STATEMENT_RECONCILIATION_REQUIRED');
    else {output.facts.push({key:'statement.topUps',value:statement.topUps,page:statement.sourcePage,source:`«Пополнения» за ${statement.from}–${statement.to}: ${statement.topUps} ₸. Сумма сверена с операциями выписки. Переводы со своих счетов, зачисления кредитов и возвраты покупок не включены. Это поступления, а не подтверждённый доход.`});if(statement.gambling?.matches.length)output.facts.push({key:'statement.gambling',value:statement.gambling.total,page:statement.gambling.matches[0].page,source:'Распознаны получатели букмекеров/казино только в этой выписке. Подтвердите полноту, в том числе другие банки. '+statement.gambling.matches.map(m=>`${m.date}: ${m.amount} ₸ · ${m.description} (стр. ${m.page})`).join('; ').slice(0,12000)});}
  }
  if (!['gkb_full','gkb_short','kaspi'].includes(kind)) output.findings.push('DETAILED_EXTRACTION_PENDING');
  output.findings=[...new Set(output.findings)]; return output;
}
// Only this explicitly identified 1cb.kz layout uses these labels. Normalize
// labels for the shared contract-card parser; monetary/identity values stay raw.
const firstBureauKzLabels:Array<[string,string]>=[
 ['ТОЛЫҚ ДЕРБЕС НЕСИЕЛІК ЕСЕП','ПОЛНЫЙ ПЕРСОНАЛЬНЫЙ КРЕДИТНЫЙ ОТЧЕТ'],['ДЕРБЕС НЕСИЕЛІК ЕСЕП','ПЕРСОНАЛЬНЫЙ КРЕДИТНЫЙ ОТЧЕТ'],['ЖСН/БСН','ИИН/БИН'],
 ['Қолданыстағы кешігусіз келісім-шарттар','Действующие договоры без просрочки'],['Қолданыстағы кешігуі бар келісім-шарттар','Действующие договоры с просрочкой'],
 ['ҚОЛДАНЫСТАҒЫ ШАРТ','ДЕЙСТВУЮЩИЕ ДОГОВОРА'],['АЯҚТАЛҒАН ШАРТТАР','ЗАВЕРШЕННЫЕ ДОГОВОРЫ'],['5 ЖЫЛ БҰРЫН АЯҚТАЛҒАН ШАРТТАР','ДОГОВОРЫ, ЗАВЕРШЕННЫЕ БОЛЕЕ 5 ЛЕТ НАЗАД'],['ҚАЙТАРЫЛҒАН ШАРТТАР','ОТОЗВАННЫЕ ДОГОВОРЫ'],
 ['КЕЛІСІМ-ШАРТ','КОНТРАКТ'],['Ақпарат көзі (несиелендіруші)','Источник информации (Кредитор)'],['Несиенің жалпы сомасы / валюта','Общая сумма кредита'],['Несие лимиті','Сумма кредитного лимита'],
 ['Несие бойынша өтелмеген сома','Непогашенная сумма по кредиту'],['Қалдық сома','Использованная сумма (подлежащая погашению)'],['Мерзімі өткен жарналар сомасы','Сумма просроченных взносов'],['Мерзімін өткізген күндер саны','Количество дней просрочки'],
 ['Тұрақсыздық айыбы (айыппұл, өсімпұл)','Сумма неустойки (штраф, пеня)'],['Ең төмен төлем','Минимальный платеж'],['Мерзімді төлемнің сомасы','Сумма периодического платежа'],
 ['Қаржыландыру түрі','Вид финансирования'],['Субъектінің рөлі','Роль субъекта'],['Несиенің мақсаты','Цель кредита'],['Несиелендіру объектісі','Объект кредитования'],['Ақпарат көзінің (несиелендірушінің) түрі','Тип источника информации'],
 ['Шарт коды','Код контракта'],['Келісім-шарт нөмірі','Номер договора'],['Өтінім күні','Дата заявки'],['Несиенің нақты берілген күні','Дата начала срока действия договора'],['Нақты берілген күні','Дата фактической выдачи'],
 ['Шарт фазасы','Фаза договора'],['Шарт жіктелімі','Классификация'],['М Ə РТЕБЕСІ','СОСТОЯНИЕ'],['БАЛАНС ТУРАЛЫ М Ə ЛІМЕТТЕР (ҚАЛДЫҚ)','ДЕТАЛИЗАЦИЯ БАЛАНСА (ОСТАТОК)'],
 ['Мерзімі өтпеген негізгі қарыз','Непросроченный основной долг'],['Өтелмеген сыйақы','Непогашенное вознаграждение'],['Мерзімі өткен негізгі қарыз','Просроченный основной долг'],['Мерзімі өткен сыйақы','Просроченное вознаграждение'],
 ['Есептен шығарылған негізгі қарыз','Списанный основной долг'],['Есептен шығарылған сыйақы','Списанное вознаграждение'],['Өтелмеген тұрақсыздық айыбы (айыппұл, өсімпұл)','Непогашенная неустойка (штраф, пеня)'],['Есептен шығарылған тұрақсыздық айыбы (айыппұл, өсімпұл)','Списанная неустойка (штраф, пеня)'],
 ['ҚОСЫМША М Ə ЛІМЕТ','ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ'],['КЕПІЛДЕР','ЗАЛОГИ'],['Келісімшарт басталғаннан мерзімінен кешіктірілген максималды күндер','Максимальное количество дней'],['Келісімшарт басталғаннан мерзімінен кешіктірілген максималды сома','Максимальная сумма'],
];
const firstBureauLabelRegex=(label:string)=>new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/М Ə /g,'М\\s*[ӘƏ]\\s*').replace(/ /g,'\\s+'),'gu');
function firstBureauKzPages(pages:PageText[]):PageText[]{
 return pages.map(p=>{let text=p.text;for(const [kz,ru]of [...firstBureauKzLabels].sort((a,b)=>b[0].length-a[0].length))text=text.replace(firstBureauLabelRegex(kz),ru);
  text=text.replace(/(Роль субъекта\s*:\s*)Қарызгер(?=\s|$)/gu,'$1Заёмщик').replace(/(Вид финансирования\s*:\s*)Несие картасы/gu,'$1Кредитная карта').replace(/(Фаза договора\s*:\s*)Қолданыстағы(?=\s|$)/gu,'$1Действующий').replace(/(\d{2}\.\d{2}\.\d{4}\s+)ж\.(\s*\))/gu,'$1г.$2');return {...p,text};});
}

/** 1cb.kz contract cards share completeness and financial reconciliation rules. */
function parseFirstCreditBureau(pages:PageText[],output:NativeExtraction,originalPages?:PageText[]){
 const header=pages[0]?.text||'';
 const report=/^\s*(?:ПОЛНЫЙ\s+)?ПЕРСОНАЛЬНЫЙ КРЕДИТНЫЙ ОТЧЕТ\s+ID\s+(\d+)\s+(\d{2}\.\d{2}\.\d{4})\s+\d{2}:\d{2}:\d{2}/iu.exec(header);
 const iin=value(/(?:^|\n)\s*ИИН(?:\s*\/\s*БИН)?\s*:\s*(\d{12})\b/u,header);
 output.identity={iin:validIin(iin)?iin:null,name:value(/\n\s*([^\n]+?)\s*\(\d{2}\.\d{2}\.\d{4}\s+г\.(?:р\.)?\)\s*\n/u,header)};
 output.issuedAt=day(report?.[2]||null);
 const footer=/(?:Полный\s+)?персональный кредитный отчет[^\n]*?\bID\s+(\d+)\s*-\s*\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}\s+(\d+)\s*\/\s*(\d+)\s*$/imu;
 if(!report||!pages.every((p,i)=>{const m=footer.exec(p.text);return p.page===i+1&&m?.[1]===report[1]&&Number(m[2])===i+1&&Number(m[3])===pages.length;}))output.findings.push('PAGE_COMPLETENESS_UNVERIFIED');
 let offset=0;
 const cleanPages=pages.map(p=>{const text=p.text.replace(footer,'');const result={page:p.page,text,offset};offset+=text.length+1;return result;});
 const text=cleanPages.map(p=>p.text).join('\n'),pageAt=(at:number)=>cleanPages.filter(p=>p.offset<=at).at(-1)?.page||1;
 const noArrears=value(/(?:^|\n)\s*(\d+)\s+Действующие договоры без просрочки/iu,header),withArrears=value(/(?:^|\n)\s*(\d+)\s+Действующие договоры с просрочкой/iu,header);
 const declared=noArrears!==null&&withArrears!==null?Number(noArrears)+Number(withArrears):null;
 const blocks=[...text.matchAll(/(?:^|\n)[ \t]*КОНТРАКТ\s+(\d+)[ \t]*(?=\n|$)/gu)];
 const sections=[...text.matchAll(/(?:^|\n)[ \t]*(ДЕЙСТВУЮЩИЕ (?:ДОГОВОРА|ДОГОВОРЫ|ТРАНШИ)|ЗАВЕРШЕННЫЕ ДОГОВОРЫ|ДОГОВОРЫ, ЗАВЕРШЕННЫЕ БОЛЕЕ 5 ЛЕТ НАЗАД|ОТОЗВАННЫЕ ДОГОВОРЫ)[ \t]*(?=\n|$)/gu)];
 const cents=(v:string)=>{const n=v.replace(/\s/g,'').replace(',','.');return /^\d+(?:\.\d{1,2})?$/.test(n)?BigInt(n.split('.')[0])*BigInt(100)+BigInt((n.split('.')[1]||'').padEnd(2,'0')):null;};
 const money=(n:bigint)=>`${n/BigInt(100)}.${String(n%BigInt(100)).padStart(2,'0')}`;
 let activeCards=0;
 for(let i=0;i<blocks.length;i++){
  const at=blocks[i].index!+blocks[i][0].length;
  // Historical maximums and repayment calendars are never current balances.
  const nextSection=sections.find(s=>s.index!>at)?.index??text.length;
  const block=text.slice(at,Math.min(blocks[i+1]?.index??text.length,nextSection)).split(/Максимальное количество дней|Максимальная сумма|Платежная дисциплина/u)[0];
  const section=sections.filter(s=>s.index!<at).at(-1)?.[1],phase=value(/Фаза\s+договора\s*:[ \t]*([^\n]+)/u,block);
  // Older cards omit the phase field; their explicit section still identifies
  // active contracts. Never inherit that section past a completed-loan heading.
  if(!section?.startsWith('ДЕЙСТВУЮЩИЕ')||phase!==null&&phase!=='Действующий')continue;
  activeCards++;
  const role=value(/Роль\s+субъекта\s*:[ \t]*([^\n]+)/u,block);
  if(!/^за[её]мщик$/iu.test(role||'')){output.findings.push('OTHER_BORROWER_ROLE_REQUIRES_REVIEW');continue;}
  // Read wrapped identifiers only up to the following labelled field, never a date/heading.
  const identifier=(label:string)=>value(new RegExp(label.replace(/ /g,'\\s+')+'\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:Дата|Номер договора|СОСТОЯНИЕ|ДОГОВОР|Классификация|Фаза договора|ДЕТАЛИЗАЦИЯ))','u'),block)?.replace(/\s+/g,'')||null;
  const contractNumber=identifier('Номер договора'),contractCode=identifier('Код контракта');
  const creditor=value(/Источник\s+информации\s*\(Кредитор\)\s*:?\s*([\s\S]*?)(?=\s+(?:Сумма кредитного лимита|Общая сумма кредита))/u,block)?.replace(/\s+/g,' ')||null;
  if(!contractNumber||/^(?:-|Нетданных)$|[.…]{2}|:/u.test(contractNumber)||!creditor){output.findings.push('INCOMPLETE_CONTRACT');continue;}
  const page=pageAt(at),facts:Fact[]=[];
  const add=(key:string,v:string|null,needle:string,source=needle)=>{
   if(v===null)return;
   const pattern=new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+'),'gu'),relative=Math.max(0,block.search(pattern)),absolute=at+relative,page=pageAt(absolute);
   if(originalPages){
    const original=originalPages.find(p=>p.page===page),normalized=cleanPages.find(p=>p.page===page),label=firstBureauKzLabels.find(([,ru])=>ru.startsWith(needle)||needle.startsWith(ru));
    if(original&&normalized&&label){const ordinal=[...normalized.text.slice(0,absolute-normalized.offset+needle.length+80).matchAll(pattern)].filter(m=>m.index<=absolute-normalized.offset).length-1;const match=[...original.text.matchAll(firstBureauLabelRegex(label[0]))][Math.max(0,ordinal)];if(match)source+='; оригинал: '+original.text.slice(match.index,match.index+280).trim();}
   }
   facts.push({key,value:v,page,source});
  };
  const balance=block.split(/Вид\s+финансирования/u)[0];
  const balanceAmount=(label:string)=>{const m=new RegExp(label.replace(/ /g,'\\s+')+'\\s*:?\\s*([0-9][0-9\\s.,]*)KZT','u').exec(balance);const n=m?cents(m[1]):null;return n===null?null:money(n);};
  const remaining=balanceAmount('Использованная сумма\\s*\\(подлежащая\\s+погашению\\)')??balanceAmount('Непогашенная сумма по кредиту');
  const arrears=balanceAmount('Сумма просроченных взносов'),penalty=balanceAmount('Сумма неустойки\\s*\\(штраф, пеня\\)');
  const overdue=value(/Количество\s+дней\s+просрочки\s*:\s*(\d+(?:[ \t]+\d{3})*)(?=\s|$)/u,balance)?.replace(/\s/g,'')||null;
  const payment=balanceAmount('Минимальный платеж')??balanceAmount('Сумма периодического платежа');
  const start=day(value(/Дата\s+начала\s+срока\s+действия\s+договора\s*:\s*(\d{2}\.\d{2}\.\d{4})/u,block));
  const usableCode=contractCode&&!/^(?:-|Нетданных)$|[.…]{2}|:/u.test(contractCode)?contractCode:null;
  add('creditor',creditor,'Источник информации',`ПКБ: источник информации (кредитор): ${creditor}`);
  add('contractIdentifier',usableCode||contractNumber,usableCode?'Код контракта':'Номер договора');
  add('startedAtMonth',start?.slice(0,7)||null,'Дата начала срока действия');
  add('overdueDays',overdue,'Количество дней просрочки');
  add('loanStatus',overdue===null?null:Number(overdue)>0?'В просрочке — требуют полную сумму':'Платится по графику','Количество дней просрочки');
  if(overdue==='0')add('monthlyPayment',payment,balance.includes('Минимальный платеж')?'Минимальный платеж':'Сумма периодического платежа');
  const financing=value(/Вид\s+финансирования\s*:[ \t]*([^\n]+)/u,block)?.split(/\s+(?:ДОГОВОР|СОСТОЯНИЕ|ДЕТАЛИЗАЦИЯ)/u)[0]||null,purpose=value(/Цель\s+кредита\s*:[ \t]*([^\n]+)/u,block);
  const object=value(/Объект\s+кредитования\s*:\s*([\s\S]*?)(?=\s+(?:Тип\s+источника\s+информации|ДОГОВОР|Код контракта))/u,block)?.replace(/\s+/g,' ')||null;
  const security=value(/ЗАЛОГИ\s*:[^\n]*\n([^\n]+)/u,block);
  add('creditType',isLombard(creditor)?'Ломбард':questionnaireCreditType(financing,purpose,object,security),'Вид финансирования',`ПКБ: ${financing||'—'}; цель: ${purpose||'—'}; объект: ${object||'—'}; кредитор: ${creditor}`);
  // In this layout the headline unpaid balance may overlap arrears. Sum only
  // the explicitly non-overlapping current/overdue principal and interest.
  const detail=block.split(/ДЕТАЛИЗАЦИЯ БАЛАНСА\s*\(ОСТАТОК\)/u)[1]?.split(/ДОПОЛНИТЕЛЬНАЯ/u)[0]||'';
  const detailAmount=(label:string)=>{const m=new RegExp('(?:^|\\n)\\s*'+label.replace(/ /g,'\\s+')+'\\s*:\\s*([0-9][0-9\\s.,]*)KZT','u').exec(detail);return m?cents(m[1]):null;};
  const parts=['Непросроченный основной долг','Непогашенное вознаграждение','Просроченный основной долг','Просроченное вознаграждение','Непогашенная неустойка\\s*\\(штраф, пеня\\)'].map(detailAmount);
  const writtenOff=['Списанный основной долг','Списанное вознаграждение','Списанная неустойка\\s*\\(штраф, пеня\\)'].some(label=>(detailAmount(label)??BigInt(0))>BigInt(0));
  const reconciled=parts.every((n):n is bigint=>n!==null)&&remaining!==null&&arrears!==null&&penalty!==null&&parts[0]+parts[1]===cents(remaining)&&parts[2]+parts[3]===cents(arrears)&&parts[4]===cents(penalty);
  const currentKnown=(parts[0]??BigInt(0))+(parts[1]??BigInt(0));
  const scheduledDetailCompatible=remaining!==null&&currentKnown<=cents(remaining)!&&(parts[0]===null||parts[1]===null||currentKnown===cents(remaining))&&parts.slice(2).every(n=>n===null||n===BigInt(0));
  if(reconciled&&!writtenOff)add('debtOutstanding',money(parts.reduce((a,b)=>a+b!,BigInt(0))),'ДЕТАЛИЗАЦИЯ БАЛАНСА','ПКБ: текущий основной долг и вознаграждение + просроченный основной долг и вознаграждение + неустойка. Каждая часть сверена с блоком «Баланс».');
  else if(!writtenOff&&remaining!==null&&overdue==='0'&&arrears==='0.00'&&(penalty===null||penalty==='0.00')&&scheduledDetailCompatible)add('debtOutstanding',remaining,balance.includes('Использованная сумма')?'Использованная сумма':'Непогашенная сумма по кредиту','ПКБ: непогашенная сумма при отсутствии показанной просрочки; требуется сверка по оригиналу.');
  if(!facts.some(f=>f.key==='debtOutstanding'))output.findings.push('TOTAL_DEBT_REQUIRES_RECONCILIATION');
  const related=/СВЯЗАННЫЕ\s+СУБЪЕКТЫ\s*:\s*([\s\S]*?)(?=СВЯЗАННЫЕ\s+КОНТРАКТЫ|$)/u.exec(block)?.[1];
  if(related){
   const people=[...related.matchAll(/(?:^|\n)\s*(Соза[её]мщик|Гарант|Поручитель|Залогодатель)\s+([\p{L}\s'-]{3,180}?)\s+(\d{12})\b/giu)];
   if(people.length&&people.length===(related.match(/\b\d{12}\b/g)||[]).length&&people.every(p=>validIin(p[3])))add('relatedParties',people.map(p=>`${p[2].replace(/\s+/g,' ').trim()} — ${p[1]}`).join('; '),'СВЯЗАННЫЕ',related.trim());
  }
  output.credits.push({contractNumber,...(usableCode?{contractCode:usableCode}:{}),page,facts,components:{remaining,arrears,penalty,interest:null,fine:null}});
 }
 const unique=new Set(output.credits.map(c=>`${c.facts.find(f=>f.key==='creditor')?.value}|${c.contractCode||c.contractNumber}`)).size===output.credits.length;
 const complete=declared!==null&&declared===activeCards&&declared===output.credits.length&&unique&&!output.findings.includes('INCOMPLETE_CONTRACT');
 output.creditList={complete,declared};
 if(!complete)output.findings.push('CONTRACT_LIST_INCOMPLETE_OR_OTHER_ROLES');
}
/** 2026 Kazakh short report: explicit current-contract table, three debt columns. */
function parseModernShort(pages:PageText[],output:NativeExtraction){
 const raw=pages.map(p=>p.text).join('\n');
 const declaredValues=[...raw.matchAll(/Барлығы\s*-\s*(\d+)/gu)].map(m=>Number(m[1]));
 const declared=declaredValues.length&&new Set(declaredValues).size===1?declaredValues[0]:null;
 const money='(?:\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
 const cents=(v:string)=>{const n=v.replace(/\s/g,'').replace(',','.');return BigInt(n.split('.')[0])*BigInt(100)+BigInt((n.split('.')[1]||'').padEnd(2,'0'));};
 const format=(n:bigint)=>`${n/BigInt(100)}.${String(n%BigInt(100)).padStart(2,'0')}`;
 const totals=[BigInt(0),BigInt(0),BigInt(0)],seen=new Set<string>(),numbers:number[]=[];
 const rowPattern=new RegExp('^\\s*(\\d+)(?:[ \\t]{2,}|\\s*\\n)([\\s\\S]+?)(?:[ \\t]{2,}|\\n)(\\S+(?:[ \\t]\\S+)*)\\s{2,}KZT\\s{2,}([^\\n]+?)\\s{2,}(\\d{2}\\.\\d{2}\\.\\d{4})\\s{2,}('+money+')\\s{2,}(?:([^\\d\\n][^\\n]*?)\\s{2,})?('+money+')\\s{2,}('+money+')\\s{2,}('+money+')\\s{2,}(\\d+)\\s{2,}(Жоқ|Иә|Иə)(?=\\s|$)','u');
 for(const page of pages){
  for(const block of page.text.split(/\n(?=\d+(?:[ \t]{2,}|\s*\n))/u)){
   const row=rowPattern.exec(block);if(!row)continue;
   numbers.push(Number(row[1]));
   const creditor=row[2].replace(/\s+/g,' ').trim(),contractNumber=row[3];
   if(creditor.length>240||!day(row[5])){output.findings.push('SHORT_CREDIT_LIST_UNVERIFIED');continue;}
   const key=creditor+'|'+contractNumber;
   if(seen.has(key)){output.findings.push('SHORT_DUPLICATE_CREDIT','SHORT_CREDIT_LIST_UNVERIFIED');continue;}seen.add(key);
   if(/[.…]{2}|…/.test(contractNumber))output.findings.push('SHORT_CONTRACT_ID_TRUNCATED','SHORT_CREDIT_LIST_UNVERIFIED');
   const components=row.slice(8,11).map(cents);components.forEach((n,i)=>totals[i]+=n);
   if(row[4].trim()!=='Қарыз алушы'){output.findings.push('OTHER_BORROWER_ROLE_REQUIRES_REVIEW','SHORT_CREDIT_LIST_UNVERIFIED');continue;}
   const source=`Строка ${row[1]}: ${creditor}, ${contractNumber}. Остаток ${format(components[0])} + просрочка ${format(components[1])} + штраф/пеня ${format(components[2])} KZT.`,overdue=Number(row[11]);
   const fact=(key:string,value:string,quote=source):Fact=>({key,value,page:page.page,source:quote});
   const facts=[fact('creditor',creditor),fact('contractIdentifier',contractNumber),fact('debtOutstanding',format(components.reduce((a,b)=>a+b,BigInt(0)))),fact('overdueDays',row[11]),fact('loanStatus',overdue>0?'В просрочке — требуют полную сумму':'Платится по графику')];
   if(overdue===0)facts.push(fact('monthlyPayment',format(cents(row[6])),`Ай сайынғы жарна: ${row[6]} KZT; ${creditor}, ${contractNumber}.`));
   output.credits.push({contractNumber,page:page.page,facts,components:{remaining:format(components[0]),arrears:format(components[1]),penalty:format(components[2])}});
  }
 }
 const total=new RegExp('Барлығы\\s*\\(KZT\\):\\s{2,}('+money+')\\s{2,}('+money+')\\s{2,}('+money+')(?=\\s|$)','u').exec(raw);
 if(declared===null||!total)output.findings.push('SHORT_SUMMARY_MISSING','SHORT_CREDIT_LIST_UNVERIFIED');
 if(declared!==output.credits.length||numbers.some((n,i)=>n!==i+1))output.findings.push('SHORT_CREDIT_COUNT_MISMATCH','SHORT_CREDIT_LIST_UNVERIFIED');
 if(total&&total.slice(1).some((n,i)=>cents(n)!==totals[i]))output.findings.push('SHORT_TOTAL_MISMATCH','SHORT_CREDIT_LIST_UNVERIFIED');
 output.creditList={complete:!output.findings.includes('SHORT_CREDIT_LIST_UNVERIFIED'),declared};
}
export function parseKaspiStatement(pages:PageText[]):BankStatement{
 // Translate structural labels only. Preserve original pages and transaction descriptions.
 pages=pages.map(page=>({...page,text:page.text
  .replace(/(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))(?:ж\.?)?\s+бастап\s+(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))(?:ж\.?)?\s+дейінгі\s+кезең(?:ге|\s+үшін)/gu,'за период с $1 по $2')
  .replace(/(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))(?:ж\.?)?\s+қолжетімді:/gu,'Доступно на $1')
  .replace(/Карта бойынша операциялардың қысқаша мазмұны:/gu,'Краткое содержание операций:')
  .replace(/^(Толықтыру|Өз шоттарыңыздан түскені|Кредиттер сомасын шотқа түсіру|Аударым|Өз шоттарыңызға аудару|Зат сатып алу|Ақша алу|[ӘƏ]ртүрлі)(?=[ \t]+[+−-])/gmu,label=>({'Толықтыру':'Пополнения','Өз шоттарыңыздан түскені':'Поступления со своих счетов','Кредиттер сомасын шотқа түсіру':'Зачисления кредитов','Аударым':'Переводы','Өз шоттарыңызға аудару':'Переводы на свои счета','Зат сатып алу':'Покупки','Ақша алу':'Снятия','Әртүрлі':'Разное','Əртүрлі':'Разное'}[label]!))}));
 const text=pages.map(p=>p.text).join('\n');
 const parseDate=(raw:string)=>{
  const match=/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(raw);if(!match)return null;
  const year=match[3].length===2?'20'+match[3]:match[3];
  const iso=`${year}-${match[2]}-${match[1]}`,date=new Date(iso+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:null;
 };
 const amount=(sign:string,raw:string)=>BigInt(raw.replace(/[\s,.]/g,''))*(sign==='-'||sign==='−'?BigInt(-1):BigInt(1));
 const money=(cents:bigint)=>{const sign=cents<BigInt(0)?'-':'';const abs=cents<BigInt(0)?-cents:cents;return `${sign}${abs/BigInt(100)}.${String(abs%BigInt(100)).padStart(2,'0')}`;};
 const period=/за период с\s*(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))\s+по\s+(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))/i.exec(text);
 const from=period?parseDate(period[1]):null,to=period?parseDate(period[2]):null;
 const gamblingMatches:Array<{date:string;amount:string;description:string;page:number}>=[];let gamblingTotal=BigInt(0);
 let credits=BigInt(0),topUps=BigInt(0),debits=BigInt(0),transactions=0,rowsReadable=!!from&&!!to&&from<=to,sourcePage=1,knownCreditRows=true,knownOperationRows=true;
 const operationTotals=Array<bigint>(7).fill(BigInt(0));
 const operationKinds=[/^(?:Пополнение|Толықтыру)(?:\s|$)/iu,/^(?:Поступление со|Өз шоттарыңыздан түскені|Өз шотыңыздан)(?:\s|$)/iu,/^(?:Зачисление|Кредиттер сомасын шотқа түсіру|Кредит)(?:\s|$)/iu,/^(?:Перевод|Аударым|Өз шоттарыңызға аудару|Өз шотыңызға)(?:\s|$)/iu,/^(?:Покупка|Зат сатып алу)(?:\s|$)/iu,/^(?:Снятие|Ақша алу)(?:\s|$)/iu,/^(?:Разное|[ӘƏ]ртүрлі)(?:\s|$)/iu];
 for(const page of pages){
  const candidates=[...page.text.matchAll(/^\d{2}\.\d{2}\.(?:\d{4}|\d{2})\s+[+−-]/gm)].length;
  const rows=[...page.text.matchAll(/^(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))\s+([+−-])\s*([\d \u00a0]+[,.]\d{2})\s*₸[^\n]*/gm)];
  if(page.needsOcr||rows.length!==candidates)rowsReadable=false;
  for(const row of rows){
   const date=parseDate(row[1]);if(!date||!from||!to||date<from||date>to)rowsReadable=false;
   const cents=amount(row[2],row[3]);if(cents>BigInt(0))credits+=cents;else debits+=cents;
   const operation=row[0].replace(/^.*?₸\s*/,'');
   const category=operationKinds.findIndex(pattern=>pattern.test(operation));
   if(category<0){knownOperationRows=false;if(cents>BigInt(0))knownCreditRows=false;}
   else operationTotals[category]+=cents;
   // Returns reverse the original operation's category, including negative top-ups.
   if(category===0)topUps+=cents;
   if(cents<BigInt(0)&&/букмекер|bookmaker|онлайн.?казино|casino|\b(?:1xbet|olimpbet|fonbet|parimatch|winline|tennisi)\b/i.test(row[0])){gamblingTotal-=cents;gamblingMatches.push({date:date||'',amount:money(-cents),description:row[0].replace(/^.*?₸\s*/,''),page:page.page});}
   if(!transactions)sourcePage=page.page;transactions++;
  }
 }
 const balances=new Map<string,Set<string>>();
 for(const hit of text.matchAll(/Доступно на\s+(\d{2}\.\d{2}\.(?:\d{4}|\d{2}))\s+([+−-]?)\s*([\d \u00a0]+[,.]\d{2})\s*₸/g)){
  const date=parseDate(hit[1]);if(!date)continue;const values=balances.get(date)||new Set<string>();values.add(String(amount(hit[2],hit[3])));balances.set(date,values);
 }
 const start=from?balances.get(from):null,end=to?balances.get(to):null;
 const balancesReconciled=!!start&&!!end&&start.size===1&&end.size===1&&transactions>0&&BigInt([...start][0])+credits+debits===BigInt([...end][0]);
 // Available funds may include blocked sums. Independently reconcile every summary category.
 const summary=text.slice(text.indexOf('Краткое содержание операций'),text.indexOf('Краткое содержание операций')+1800);
 const categories=['Пополнения','Поступления со своих счетов','Зачисления кредитов','Переводы','Переводы на свои счета','Покупки','Снятия','Разное'];
 const totals=categories.map(label=>{const m=new RegExp('(?:^|\\n)'+label+'[ \\t]+([+−-])\\s*([\\d \\u00a0]+[,.]\\d{2})\\s*₸').exec(summary);return m?amount(m[1],m[2]):null;});
 // Summary categories are net amounts. Purchase refunds are not new top-ups,
 // and a returned top-up must be subtracted before comparing with the summary.
 const summaryGroups=[totals[0],totals[1],totals[2],totals[3]!==null&&totals[4]!==null?totals[3]+totals[4]:null,totals[5],totals[6],totals[7]];
 const summaryReconciled=transactions>0&&knownOperationRows&&totals.every(v=>v!==null)&&summaryGroups.every((value,index)=>value===operationTotals[index]);
 const reconciled=balancesReconciled||summaryReconciled;
 const topUpSummaries=pages.flatMap(p=>[...p.text.matchAll(/(?:^|\n)Пополнения[ \t]+([+−-])\s*([\d \u00a0]+[,.]\d{2})\s*₸/g)].map(m=>({amount:amount(m[1],m[2]),page:p.page})));
 // The questionnaire asks for the bank's top-up category, not every positive row.
 // Reconcile that category separately so own transfers, loans and purchase refunds stay excluded.
 const topUpsVerified=topUps>=BigInt(0)&&knownCreditRows&&(topUpSummaries.length===1?topUpSummaries[0].amount===topUps:topUpSummaries.length===0&&!text.includes('Краткое содержание операций'));
 if(topUpSummaries.length===1)sourcePage=topUpSummaries[0].page;
 return {from,to,credits:money(credits),topUps:money(topUps),topUpsVerified,debits:money(debits),transactions,reconciled,rowsReadable,sourcePage,reconciliation:balancesReconciled?'balances':summaryReconciled?'summary':'unverified',gambling:{total:money(gamblingTotal),matches:gamblingMatches}};
}

/** A recent pension payer is evidence for employee review, not proof of an active job. */
function extractEnpfPayers(pages:PageText[],output:NativeExtraction){
 const marks=pages.map(p=>/Стр\s+(\d+)\s+из\s+(\d+)/.exec(p.text));
 if(marks.some((m,i)=>!m||Number(m[1])!==i+1||Number(m[2])!==pages.length)){output.findings.push('PAGE_COMPLETENESS_UNVERIFIED');return;}
 if(!output.issuedAt)return;
 const issued=new Date(output.issuedAt+'T00:00:00Z'),end=output.issuedAt.slice(0,7),start=new Date(Date.UTC(issued.getUTCFullYear(),issued.getUTCMonth()-3,1)).toISOString().slice(0,7);
 const payers=new Map<string,{name:string;page:number;periods:Set<string>}>();let complete=true;
 for(const page of pages){
  const starts=[...page.text.matchAll(/^\d{2}\.\d{2}\.\d{4}\s+\d{2}\.\d{2}\.\d{4}\s+\d+\s+\d{2}\.\d{2}\.\d{4}/gm)];
  for(let i=0;i<starts.length;i++){
   const row=page.text.slice(starts[i].index,starts[i+1]?.index??page.text.length);
   const m=/^(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})\s+(\d+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{3})\s+([\s\S]+?)\s+(\d{12})\s+([\s\S]+?)\s+(\d+(?:\.\d+)?)\s+(ОБРАБОТАННЫЕ|ВОЗВРАЩЕННЫЕ)\s+(\d{6})\b/.exec(row);
   if(!m){complete=false;continue;}const period=m[11].slice(2)+'-'+m[11].slice(0,2);
   if(m[5]!=='010'||m[10]!=='ОБРАБОТАННЫЕ'||Number(m[9])<=0||period<start||period>=end)continue;
   const payer=payers.get(m[7])||{name:m[6].replace(/\s+/g,' ').trim(),page:page.page,periods:new Set<string>()};payer.periods.add(period);payers.set(m[7],payer);
  }
 }
 if(!complete){output.findings.push('ENPF_ROWS_REVIEW_REQUIRED');return;}
 if(payers.size)output.facts.push({key:'employment.payersCount',value:String(payers.size),page:[...payers.values()][0].page,source:'Плательщики взносов за три полных месяца перед датой справки '+output.issuedAt+': '+[...payers.values()].map(p=>p.name+' ('+[...p.periods].join(', ')+', стр. '+p.page+')').join('; ')+'. Подтвердите у клиента, какие места работы действуют сейчас. Доход после удержаний по взносам не рассчитывается.'});
}
