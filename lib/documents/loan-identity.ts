/** Match creditor spelling only; client and contract identifiers remain exact. */
export const creditorKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').trim().replace(/^акционерное\s+общество(?=\s|[«"“])/u,'ао').replace(/[«»“”„]/g,'"').replace(/\s+/g,'');
export function loanRowKey(value:string|null|undefined){
 const parts=(value||'').split('|');
 if(parts[0]==='creditors'&&parts.length===4){parts[2]=creditorKey(parts[2]);parts[3]=parts[3].trim();}
 return parts.join('|');
}
