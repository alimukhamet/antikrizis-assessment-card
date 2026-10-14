import {extractNative,validIin,type NativeExtraction,type Credit} from './extract-native';
import type {PageText} from './read-pdf';
import type {DocumentRow,ExtractionRow} from './repository';

export const LOAN_DATE_EVIDENCE_VERSION='loan-dates-1';
type Source={extraction:NativeExtraction;read:{pages:PageText[];originalSha256?:string;readAllPhysicalPages?:boolean;totalPages?:number}};
const cache=new Map<string,NativeExtraction|null>();
const lender=(credit:Credit)=>credit.facts.find(f=>f.key==='creditor')?.value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[\s«»“”"]/g,'')||'';
const identifiers=(credit:Credit)=>[credit.contractCode,credit.contractNumber].filter((s):s is string=>typeof s==='string'&&!!s&&!/[.…]{2}/u.test(s));
const matches=(a:Credit,b:Credit)=>lender(a)===lender(b)&&!!lender(a)&&identifiers(a).some(id=>identifiers(b).includes(id));

/** Derive only date evidence from hash-verified retained text. Never replace a loan analysis. */
export function deriveLoanDateEvidence(document:DocumentRow,source:ExtractionRow,result:Source,subjectIin:string){
 const previous=result.extraction,read=result.read;
 if(!validIin(subjectIin)||previous?.kind!=='gkb_full'||previous.identity?.iin!==subjectIin||read?.originalSha256!==document.original_sha256||!read.readAllPhysicalPages||!Array.isArray(read.pages)||!Array.isArray(previous.credits)||read.pages.length!==read.totalPages||read.pages.some(p=>!p||typeof p.text!=='string'||!Number.isInteger(p.page)||p.needsOcr)||read.pages.length>500)return null;
 const key=[LOAN_DATE_EVIDENCE_VERSION,source.result_sha256,document.original_sha256,subjectIin].join(':');
 if(cache.has(key))return cache.get(key)!;
 const current=extractNative(read.pages);
 if(current.identity.iin!==subjectIin||current.kind!=='gkb_full')return null;
 const credits:Credit[]=[];
 for(const credit of current.credits){
  const old=previous.credits.filter(c=>matches(c,credit));
  if(old.length!==1||current.credits.filter(c=>matches(c,old[0])).length!==1||!credit.contractStartDate&&!credit.disbursementDate)continue;
  credits.push({contractNumber:old[0].contractNumber,...(old[0].contractCode?{contractCode:old[0].contractCode}:{}),page:credit.page,facts:old[0].facts.filter(f=>f.key==='creditor'),...(credit.contractStartDate?{contractStartDate:credit.contractStartDate}:{}),...(credit.disbursementDate?{disbursementDate:credit.disbursementDate}:{}),components:{}});
 }
 const evidence:NativeExtraction|null=credits.length?{version:LOAN_DATE_EVIDENCE_VERSION,kind:'gkb_full',identity:{...current.identity},issuedAt:previous.issuedAt,facts:[],credits,findings:[]}:null;
 if(cache.size>=64)cache.delete(cache.keys().next().value!);cache.set(key,evidence);return evidence;
}
