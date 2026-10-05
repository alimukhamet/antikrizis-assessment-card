import assert from 'node:assert/strict';
export function syntheticCrm(){
 const deal={ID:'900001',TITLE:'SYNTHETIC ONLY - [whatcrm] line #21',UF_CRM_AI_IIN:'000000000010',CATEGORY_ID:'13',STAGE_ID:'C13:FINAL_INVOICE',STAGE_SEMANTIC_ID:'P'};
 const counts={assessmentWrites:0,historyWrites:0,fileWrites:0,stageWrites:0},files=new Map(),comments=[],history=[];
 let refs=[],blocked=false,fileReads=0;
 const lost=()=>Response.json({error:'SYNTHETIC_LOST_RESPONSE'},{status:503});
 const item=()=>({id:deal.ID,ufCrmAiIin:deal.UF_CRM_AI_IIN,ufCrmAnkPrimaryDocs:refs});
 const handle=async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://bitrix.synthetic.invalid','External network is forbidden');
  const method=u.pathname.split('/').at(-1);
  if(method==='crm.controller.item.getFile.json'){
   fileReads++;
   assert.equal(request.method,'GET');const file=files.get(u.searchParams.get('id'));assert.ok(file,'Unknown synthetic file');
   return new Response(file.bytes,{headers:{'content-length':String(file.bytes.length),'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)}});
  }
  assert.equal(request.method,'POST');
  if(method==='crm.item.update.json'){assert.ok(Number(request.headers.get('content-length'))>0,'Bitrix uploads require fixed-length framing');assert.equal(request.headers.get('transfer-encoding'),null);}
  const body=await request.json();
  if(blocked)return lost();
  switch(method){
   case 'crm.deal.list.json':{
    const filter=body.filter||{};
    if(filter.UF_CRM_1781335943568==='263')return Response.json({result:[]});
    const rows=[['7609',550000],['2093',450000],['4351',500000]].map(([manager,value],index)=>({ID:String(910001+index),TITLE:'SYNTHETIC SALES ONLY',ASSIGNED_BY_ID:manager,OPPORTUNITY:value,UF_CRM_1777554129345:'2026-09-15',UF_CRM_1781335943568:'261',STAGE_ID:'C1:NEW'}));
    return Response.json({result:rows.filter(row=>row.ASSIGNED_BY_ID===filter.ASSIGNED_BY_ID&&row.UF_CRM_1777554129345>=filter['>=UF_CRM_1777554129345']&&row.UF_CRM_1777554129345<=filter['<=UF_CRM_1777554129345']&&Number(row.ID)>Number(filter['>ID']||0))});
   }
   case 'crm.deal.get.json': assert.equal(String(body.id),deal.ID);return Response.json({result:deal});
   case 'crm.deal.update.json':{
    assert.equal(String(body.id),deal.ID);
    assert.equal(body.fields.STAGE_ID,undefined,'Legacy sales-final writes are forbidden');
    counts.assessmentWrites++;Object.assign(deal,body.fields);
    return lost();
   }
   case 'crm.timeline.comment.list.json':return Response.json({result:comments});
   case 'crm.timeline.comment.add.json':counts.historyWrites++;comments.push({ID:String(comments.length+1),...body.fields});return lost();
   case 'crm.status.list.json':return Response.json({result:body.filter.ENTITY_ID==='DEAL_STAGE_1'?[{ENTITY_ID:'DEAL_STAGE_1',STATUS_ID:'C1:NEW',NAME:'В ожидании',SEMANTICS:'P'}]:[{ENTITY_ID:'DEAL_STAGE_13',STATUS_ID:'C13:FINAL_INVOICE',NAME:'Synthetic sales'},{ENTITY_ID:'DEAL_STAGE_13',STATUS_ID:'C13:WON',NAME:'Synthetic completion',SEMANTICS:'S'}]});
   case 'crm.stagehistory.list.json':return Response.json({result:{items:history}});
   case 'crm.item.get.json':assert.equal(String(body.id),deal.ID);return Response.json({result:{item:item()}});
   case 'crm.item.update.json':{
    assert.equal(String(body.id),deal.ID);
    if(body.fields.stageId){
     assert.equal(body.entityTypeId,2);assert.deepEqual(body.fields,{categoryId:1,stageId:'C1:NEW',title:'ВП SYNTHETIC ONLY'});counts.stageWrites++;
     history.push({ID:'1',OWNER_ID:deal.ID,CATEGORY_ID:1,STAGE_ID:'C1:NEW',CREATED_TIME:new Date().toISOString()});
     // The direct transition succeeds, then another automation moves onward.
     // Lost response/readback must recover through history without another write.
     Object.assign(deal,{TITLE:body.fields.title,CATEGORY_ID:'1',STAGE_ID:'C1:LATER',STAGE_SEMANTIC_ID:'P'});blocked=true;
     return lost();
    }
    assert.deepEqual(Object.keys(body.fields),['ufCrmAnkPrimaryDocs']);counts.fileWrites++;
    refs=body.fields.ufCrmAnkPrimaryDocs.map(value=>{
     if(!Array.isArray(value)){const ref=refs.find(r=>r.id===String(value.id));assert.ok(ref,'Prior file must be preserved');return ref;}
     const id=String(files.size+1);files.set(id,{name:value[0],bytes:Buffer.from(value[1],'base64')});return{id,urlMachine:'https://bitrix.synthetic.invalid/crm.controller.item.getFile.json?id='+id};
    });return lost();
   }
   default:throw Error('Unexpected synthetic CRM method: '+method);
  }
 };
 return{handle,counts,files,deal,get fileReads(){return fileReads;},seedFile(id,bytes,name){files.set(id,{bytes,name});refs.push({id,urlMachine:'https://bitrix.synthetic.invalid/crm.controller.item.getFile.json?id='+id});},removeFile(id){files.delete(id);refs=refs.filter(ref=>ref.id!==id);},restore(){blocked=false;}};
}
