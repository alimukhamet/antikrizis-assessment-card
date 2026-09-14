import type {Representative} from './policy';
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
