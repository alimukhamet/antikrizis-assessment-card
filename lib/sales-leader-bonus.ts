import {PEOPLE,type Person,type Totals} from './personal-sales';

export type LeaderCompetition={id:string;start:string;end:string;prize:number};
// Owner-confirmed competitions. Ranking uses the same full contract values and
// lawyer-handoff dates as the individual volume plan, across all three sellers.
export const LEADER_COMPETITIONS:LeaderCompetition[]=[
  {id:'september-2026',start:'2026-09-01',end:'2026-09-30',prize:100000},
  {id:'october-2026',start:'2026-10-01',end:'2026-10-21',prize:100000},
];
export type LeaderAward=LeaderCompetition&{amount:number|null;status:'pending'|'won'|'not_won'|'needs_review'};
export function leaderCompetitionFor(start:string,end:string){return LEADER_COMPETITIONS.find(item=>item.start===start&&item.end===end);}
export function leaderAward(competition:LeaderCompetition,person:Person,today:string,totals:Partial<Record<Person,Totals>>|null):LeaderAward{
  if(today<=competition.end)return {...competition,amount:0,status:'pending'};
  const people=Object.keys(PEOPLE) as Person[];
  if(!totals||people.some(person=>!totals[person]||totals[person]!.missing>0||!Number.isFinite(totals[person]!.volume)||totals[person]!.volume<0))return {...competition,amount:null,status:'needs_review'};
  const value=(person:Person)=>Math.round(totals[person]!.volume*100);
  const best=Math.max(...people.map(value)),leaders=people.filter(person=>value(person)===best);
  // No invented tie-breaker, shared prize, or zero-sales winner.
  if(best<=0||leaders.length!==1)return {...competition,amount:null,status:'needs_review'};
  const won=leaders[0]===person;
  return {...competition,amount:won?competition.prize:0,status:won?'won':'not_won'};
}
export async function leaderAwardsFor(person:Person,today:string,load:(competition:LeaderCompetition)=>Promise<Record<Person,Totals>>,month?:string){
  return Promise.all(LEADER_COMPETITIONS.filter(competition=>competition.start<=today&&(!month||competition.start.startsWith(month))).map(async competition=>{
    if(today<=competition.end)return leaderAward(competition,person,today,null);
    try{return leaderAward(competition,person,today,await load(competition));}
    catch{return leaderAward(competition,person,today,null);}
  }));
}
