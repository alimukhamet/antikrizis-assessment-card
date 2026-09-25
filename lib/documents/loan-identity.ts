/** Match printed name variants, including already compacted saved keys.
 * Keep legal forms and the complete brand: no fuzzy or contract-only matching.
 * The full GKB also prints Halyk's exact Russian name without its AO prefix.
 * ACF's exact legal-form alias is documented by the lender:
 * https://asiancreditfund.com/payment (АКФ / Азиатский Кредитный Фонд).
 * Latin look-alike legal forms (TOO/AO) are folded to Cyrillic. */
export const creditorKey=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[\s«»“”„"]/g,'').replace(/^too(?=.)/u,'тоо').replace(/^ao(?=.)/u,'ао').replace(/^акционерноеобщество(?=.)/u,'ао').replace(/^товариществосограниченнойответственностью(?=.)/u,'тоо').replace(/^тоомикрофинансоваяорганизация(?=.)/u,'тоомфо').replace(/^народныйбанкказахстана$/u,'аонародныйбанкказахстана').replace(/^тоомфоакф$/u,'тоомфоазиатскийкредитныйфонд')
 // SB Sberbank Russia JSC (Kazakhstan) was renamed Bereke Bank JSC in 2022; the
 // full GKB can still print the old name while the short report prints the new one.
 .replace(/^(?:дочернийбанк)?(?:акционерноеобщество|ао)?(?:дб)?(?:ао)?сбербанкроссии$/u,'аоberekebank').replace(/^аоberekebank(?:\(дбleshabankllc\(public\)\))?$/u,'аоberekebank');
export function loanRowKey(value:string|null|undefined){
 const parts=(value||'').split('|');
 if(parts[0]==='creditors'&&parts.length===4){parts[2]=creditorKey(parts[2]);parts[3]=parts[3].trim();}
 return parts.join('|');
}
