export const participantRoles=['Созаёмщик','Гарант','Поручитель','Залогодатель'];

// The existing per-loan string remains portable in drafts, evidence and contracts.
export function parseParticipants(value){
 const text=String(value||'').trim();
 if(text==='Нет')return {choice:'none',people:[],valid:true,legacy:''};
 if(!text)return {choice:'',people:[],valid:false,legacy:''};
 const people=[];
 for(const entry of text.split(';')){
  const match=/^(.*?)\s*—\s*(.*?)$/.exec(entry.trim());
  if(!match)return {choice:'',people:[],valid:false,legacy:text};
  const name=match[1].trim(),rawRole=match[2].trim();
  const role=rawRole==='Созаемщик'?'Созаёмщик':rawRole==='Залогодатель (в ГКБ: Кепіл беруші)'?'Залогодатель':rawRole;
  if(role&&!participantRoles.includes(role))return {choice:'',people:[],valid:false,legacy:text};
  people.push({name,role});
 }
 const valid=people.length>0&&people.length<=20&&people.every(p=>p.name.length>=2&&p.name.length<=200&&!/[;\r\n—]/.test(p.name)&&participantRoles.includes(p.role));
 return {choice:'some',people,valid,legacy:''};
}
export function formatParticipants(choice,people){
 if(choice==='none')return 'Нет';
 if(choice!=='some')return '';
 return people.map(p=>`${p.name.trim()} — ${p.role}`).join('; ');
}
