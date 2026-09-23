import assert from 'node:assert/strict';
export function syntheticCrm(){
 const deal={ID:'900001',TITLE:'SYNTHETIC ONLY - [whatcrm] line #21',UF_CRM_AI_IIN:'000000000010',CATEGORY_ID:'13',STAGE_ID:'C13:FINAL_INVOICE',STAGE_SEMANTIC_ID:'P'};
 const counts={assessmentWrites:0,historyWrites:0,fileWrites:0,stageWrites:0},files=new Map(),comments=[],history=[];
 let refs=[],blocked=false;
 const lost=()=>Response.json({error:'SYNTHETIC_LOST_RESPONSE'},{status:503});
 const item=()=>({id:deal.ID,ufCrmAiIin:deal.UF_CRM_AI_IIN,ufCrmAnkPrimaryDocs:refs});
 const handle=async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://bitrix.synthetic.invalid','External network is forbidden');
  const method=u.pathname.split('/').at(-1);
  if(method==='crm.controller.item.getFile.json'){
   assert.equal(request.method,'GET');const file=files.get(u.searchParams.get('id'));assert.ok(file,'Unknown synthetic file');
   return new Response(file.bytes,{headers:{'content-length':String(file.bytes.length),'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)}});
  }
  assert.equal(request.method,'POST');
  if(method==='crm.item.update.json'){assert.ok(Number(request.headers.get('content-length'))>0,'Bitrix uploads require fixed-length framing');assert.equal(request.headers.get('transfer-encoding'),null);}
  const body=await request.json();
  if(blocked)return lost();
  switch(method){
   case 'crm.deal.get.json': assert.equal(String(body.id),deal.ID);return Response.json({result:deal});
   case 'crm.deal.update.json':{
    assert.equal(String(body.id),deal.ID);
    if(body.fields.STAGE_ID){
     assert.deepEqual(body.fields,{STAGE_ID:'C13:WON',TITLE:'ВП SYNTHETIC ONLY'});counts.stageWrites++;
     history.push({ID:'1',OWNER_ID:deal.ID,CATEGORY_ID:13,STAGE_ID:'C13:WON',CREATED_TIME:new Date().toISOString()});
     // Existing CRM automation has already moved the case onward. The write
     // response and immediate readback are lost; recovery must use history.
     Object.assign(deal,{TITLE:body.fields.TITLE,CATEGORY_ID:'1',STAGE_ID:'C1:NEW',STAGE_SEMANTIC_ID:'P'});blocked=true;
    }else{counts.assessmentWrites++;Object.assign(deal,body.fields);}
    return lost();
   }
   case 'crm.timeline.comment.list.json':return Response.json({result:comments});
   case 'crm.timeline.comment.add.json':counts.historyWrites++;comments.push({ID:String(comments.length+1),...body.fields});return lost();
   case 'crm.status.list.json':return Response.json({result:[{ENTITY_ID:'DEAL_STAGE_13',STATUS_ID:'C13:FINAL_INVOICE',NAME:'Synthetic sales'},{ENTITY_ID:'DEAL_STAGE_13',STATUS_ID:'C13:WON',NAME:'Synthetic completion',SEMANTICS:'S'}]});
   case 'crm.stagehistory.list.json':return Response.json({result:{items:history}});
   case 'crm.item.get.json':assert.equal(String(body.id),deal.ID);return Response.json({result:{item:item()}});
   case 'crm.item.update.json':{
    assert.equal(String(body.id),deal.ID);assert.deepEqual(Object.keys(body.fields),['ufCrmAnkPrimaryDocs']);counts.fileWrites++;
    refs=body.fields.ufCrmAnkPrimaryDocs.map(value=>{
     if(!Array.isArray(value)){const ref=refs.find(r=>r.id===String(value.id));assert.ok(ref,'Prior file must be preserved');return ref;}
     const id=String(files.size+1);files.set(id,{name:value[0],bytes:Buffer.from(value[1],'base64')});return{id,urlMachine:'https://bitrix.synthetic.invalid/crm.controller.item.getFile.json?id='+id};
    });return lost();
   }
   default:throw Error('Unexpected synthetic CRM method: '+method);
  }
 };
 return{handle,counts,files,deal,restore(){blocked=false;}};
}
