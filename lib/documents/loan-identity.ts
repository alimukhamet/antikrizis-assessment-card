/** Match printed name variants, including already compacted saved keys.
 * Keep legal forms and the complete brand: no fuzzy or contract-only matching.
 * The full GKB also prints Halyk's exact Russian name without its AO prefix. */
export const creditorKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[\s«»“”„"]/g,'').replace(/^акционерноеобщество(?=.)/u,'ао').replace(/^товариществосограниченнойответственностью(?=.)/u,'тоо').replace(/^тоомикрофинансоваяорганизация(?=.)/u,'тоомфо').replace(/^народныйбанкказахстана$/u,'аонародныйбанкказахстана');
export function loanRowKey(value:string|null|undefined){
 const parts=(value||'').split('|');
 if(parts[0]==='creditors'&&parts.length===4){parts[2]=creditorKey(parts[2]);parts[3]=parts[3].trim();}
 return parts.join('|');
}
