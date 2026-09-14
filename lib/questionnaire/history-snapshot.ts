import type {CaseRow,DocumentRow} from '../documents/repository';
import type {Actor} from '../worker-session';
import type {DraftPayload} from './draft';
/** Plain text pinned at preparation. Credential contents and names are never included. */
export function historySnapshot(record:CaseRow,actor:Actor,fullCard:string,documents:DraftPayload['documents'],originals:DocumentRow[],time:string){
 const names=new Map(originals.map(d=>[d.id,d.original_name]));
 return [
  'ОЦЕНКА КЛИЕНТА — СОХРАНЁННАЯ ВЕРСИЯ',
  `Клиент: ${record.title}`,`Сделка: № ${record.external_id}`,`ИИН: ${record.client_iin}`,
  `Сотрудник: ${actor.displayName}`,`Подготовлено: ${time}`,'',fullCard,'','ДОКУМЕНТЫ ЭТОЙ ВЕРСИИ',
  ...documents.map(d=>`• ${d.type} · ${d.person} · ${names.get(d.documentId)||d.documentId}`),
  'ЭЦП: отдельная защищённая загрузка; ключ и пароль в комментарий не включаются.'
 ].join('\n');
}
