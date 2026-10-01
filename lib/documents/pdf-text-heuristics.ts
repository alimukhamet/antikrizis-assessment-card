// This text-only predicate identifies which cached sparse Kaspi page requires a
// native reread. It does not establish readability without PDF operator checks.
export function sparseKaspiClosingText(text:string,previousText:string,statementText:string){
 const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
 const statement=normalize(statementText);
 if(!/ВЫПИСКА по Kaspi Gold за период с \d{2}\.\d{2}\.\d{2} по \d{2}\.\d{2}\.\d{2}/.test(statement)||!statement.includes('Краткое содержание операций по карте:'))return false;
 const footer='АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz';
 const continuation='счета» содержит информацию об операциях клиента между счетами в Kaspi.';
 const prefix='Раздел «Краткое содержание операций по карте», в строках «Поступления со своих счетов», «Зачисления кредитов», «Переводы на свои';
 return normalize(text)===footer+' '+continuation&&normalize(previousText).endsWith(prefix);
}
