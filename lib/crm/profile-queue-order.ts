/** Unfinished first; oldest ZVI date first, missing dates last, then oldest deal. */
export function sortProfileQueue<T extends {dealId:string;zviDate:string;profileSavedAt:string}>(items:T[]) {
  const time=(value:string)=>{const t=value?Date.parse(value):NaN;return Number.isFinite(t)?t:Infinity;};
  return [...items].sort((a,b)=>
    Number(Boolean(a.profileSavedAt))-Number(Boolean(b.profileSavedAt)) ||
    time(a.zviDate)-time(b.zviDate) || Number(a.dealId)-Number(b.dealId));
}
