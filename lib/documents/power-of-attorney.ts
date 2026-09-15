import type {Representative} from './policy';
const months=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const ordinals=['перв','втор','треть','четверт','пят','шест','седьм','восьм','девят','десят','одиннадцат','двенадцат','тринадцат','четырнадцат','пятнадцат','шестнадцат','семнадцат','восемнадцат','девятнадцат'];
function ordinal(value:string):number|null{
 const word=value.replace(/(?:ого|его|ое|ее|ой)$/,'');
 const simple=ordinals.indexOf(word);if(simple>=0)return simple+1;
 const tens:Record<string,number>={'двадцат':20,'тридцат':30,'сороков':40,'пятидесят':50,'шестидесят':60,'семидесят':70,'восьмидесят':80,'девяност':90};
 if(tens[word])return tens[word];
 const compound=/^(двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто) (.+)$/.exec(value);
 if(!compound)return null;
 const unit=ordinal(compound[2]);if(!unit||unit>9)return null;
 return ['двадцать','тридцать','сорок','пятьдесят','шестьдесят','семьдесят','восемьдесят','девяносто'].indexOf(compound[1])*10+20+unit;
}
/** Printed dates in the firm's Russian template; no notary/registry verification. */
export function powerDate(value:string):string|null{
 const text=value.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[«»"']/g,'').replace(/\s+/g,' ').trim();
 const numeric=/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
 const words=/^(.+?) (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) (.+?)(?: года| г\.?)?$/.exec(text);
 let day:number,month:number,year:number;
 if(numeric){day=Number(numeric[1]);month=Number(numeric[2]);year=Number(numeric[3]);}
 else if(words){
  day=/^\d{1,2}$/.test(words[1])?Number(words[1]):ordinal(words[1])||0;month=months.indexOf(words[2])+1;
  const y=words[3];year=/^20\d{2}$/.test(y)?Number(y):y==='двухтысячного'?2000:y.startsWith('две тысячи ')?2000+(ordinal(y.slice(11))||0):0;
  if(y.startsWith('две тысячи ')&&!ordinal(y.slice(11)))return null;
 }else return null;
 if(year<2000||year>2099||day<1||month<1||month>12)return null;
 const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 const parsed=new Date(date+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:null;
}
export function powerTemplateDetails(text:string){
 const normalized=text.normalize('NFKC').replace(/ё/g,'е').replace(/\s+/g,' ');
 const expiry=/Доверенность выдана сроком\s+до\s+(.+?)\s+года\s*\./i.exec(normalized);
 const heading=text.split(/(?:^|\n)\s*ДОВЕРЕННОСТЬ\s*(?:\n|$)/i)[1]?.split(/Я,?\s*гр\./i)[0]||'';
 const dates=heading.split(/\r?\n/).map(line=>powerDate(line.trim())).filter((date):date is string=>Boolean(date));
 const issuedAt=new Set(dates).size===1?dates[0]:null;
 const expiresAt=expiry?powerDate(expiry[1]+' года'):null;
 const standardScopeMatched=[/право подписания и подачи заявления о признании банкротом/i,/представления интересов в суде в рамках дела о банкротстве/i,/с правом на подписание искового заявления/i].every(pattern=>pattern.test(normalized))&&!/(?:без|не предоставля\S*|исключая|за исключением)[^.;:]{0,100}(?:подписани|банкротств|банкротом|искового)/i.test(normalized);
 return {issuedAt,expiresAt,standardScopeMatched};
}
export type PowerParties={principal:{name:string;iin:string}|null;representative:Representative|null;representativeText:string;expiresText:string|null;findings:string[]};
/** Role-delimited extraction: never take an issuer/notary IIN as the principal. */
export function extractPowerParties(text:string):PowerParties{
 const normalized=text.normalize('NFKC').replace(/\s+/g,' ');
 const principalBlock=/\bЯ,?\s*гр\.\s*([\s\S]+?)настоящей доверенностью\s+уполномочиваю\s+/i.exec(normalized)
  || /Я,?\s*гр\.\s*([\s\S]+?)настоящей доверенностью\s+уполномочиваю\s+/i.exec(normalized);
 const result:PowerParties={principal:null,representative:null,representativeText:'',expiresText:null,findings:[]};
 if(principalBlock){
  const name=/^([^,]+),/.exec(principalBlock[1])?.[1]?.trim(),ids=[...principalBlock[1].matchAll(/ИИН\s*:?\s*(\d{12})\b/g)];
  if(name&&ids.length===1)result.principal={name,iin:ids[0][1]};
  const tail=normalized.slice(principalBlock.index+principalBlock[0].length);
  const end=tail.search(/(?:на следующее|\(далее\s*[-–—]|представлять мои интересы)/i);
  if(end>=0&&end<2500){
   const block=tail.slice(0,end);result.representativeText=block;
   const person=/^гр\.\s*([^,]+),/i.exec(block),organization=/^(ТОО\s*[«"][^»"]+[»"])/i.exec(block);
   const ids=[...block.matchAll(/(ИИН|БИН)\s*:?\s*(\d{12})\b/g)];
   if(ids.length===1&&person&&ids[0][1]==='ИИН')result.representative={kind:'person',legalName:person[1].trim(),identifier:ids[0][2]};
   else if(ids.length===1&&organization&&ids[0][1]==='БИН')result.representative={kind:'organization',legalName:organization[1].trim(),identifier:ids[0][2]};
  }
 }
 result.expiresText=/Доверенность выдана сроком\s+([^\.]+)\./i.exec(normalized)?.[1]?.trim()||null;
 if(!result.principal)result.findings.push('POWER_PRINCIPAL_UNVERIFIED');
 if(!result.representative)result.findings.push('REPRESENTATIVE_IDENTITY_UNVERIFIED');
 // Printed authority/expiry claims are retained; registry/signature validity is not inferred.
 result.findings.push('POWER_AUTHORITY_REVIEW_REQUIRED');
 return result;
}
