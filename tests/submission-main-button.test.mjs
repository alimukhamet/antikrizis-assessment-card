/** Same main button, actual browser coordinator; server responses are synthetic. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../public/submission-flow.js',import.meta.url),'utf8');
const version='a'.repeat(64),requestId='00000000-0000-0000-0000-000000000001';
function fixture(t,{historyFails=false,conflict=false}={}){
 const dom=new JSDOM('<button id="anchor">Check</button><div id="status"></div>',{url:'https://synthetic.invalid/',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window,actions=[];let tries=0,historyTries=0,downloads=0;
 const payload={answers:[],documents:[],pendingFiles:[]},bindings=[];
 let row={requestId,state:'prepared',assessmentSaved:false,historySaved:false,historyState:'pending',contractNumber:'TEST',clientName:'SYNTHETIC'};
 w.HostedAssessment={ready:()=>true,getContext:()=>({client:{title:'SYNTHETIC',external:{dealId:'11665'}}})};
 w.ServerDrafts={capture:()=>payload,reviewBindings:()=>bindings,save:async()=>true};
 w.SubmissionDestination={confirm:async()=>({dealId:'11665'})};
 w.ContractRenderer={ready:async()=>true};w.ContractRenderers={[version]:{render:async()=>new w.Blob(['SYNTHETIC DOCX'])}};
 w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};
 w.HTMLAnchorElement.prototype.click=()=>{downloads++;};
 w.fetch=async(url,options)=>{
  if(!options?.body)return{ok:true,json:async()=>({submission:row})};
  const body=JSON.parse(options.body);actions.push(body.action);
  if(body.action==='prepare')return{ok:true,json:async()=>({...row})};
  assert.equal(body.requestId,requestId);
  if(body.action==='complete'){
   tries++;
   if(tries===1&&!historyFails)row={...row,outcomeCode:conflict?'NOT_SENT:ASSESSMENT_CHANGED_IN_CRM':'NOT_SENT:ASSESSMENT_PREFLIGHT_FAILED',message:conflict?'Карточка изменилась в Bitrix. Ничего не отправлено.':'Карточка ещё не отправлялась. Повторите действие.'};
   else{
    row={...row,state:'verified',assessmentSaved:true};historyTries++;
    row=historyFails&&historyTries===1?{...row,historyState:'pending',historyOutcomeCode:'NOT_SENT:HISTORY_PREFLIGHT_FAILED',message:'Запись в историю ещё не отправлялась.'}:{...row,historySaved:true,historyState:'verified',contract:{data:{synthetic:true},rendererVersion:version}};
   }
  }else assert.fail('The browser must not coordinate individual CRM actions: '+body.action);
  return{ok:true,json:async()=>({...row})};
 };
 w.eval(source);
 const flow=w.SubmissionFlow.mount(w.document.getElementById('anchor'),w.document.getElementById('status'));
 flow.checked({readyToSubmit:true,identityRevision:1},{dealId:'11665',signature:JSON.stringify({payload,bindings}),payload,bindings});
 async function click(){
  const button=w.document.getElementById('saveAssessment');button.click();
  for(let i=0;i<100&&button.disabled;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(button.disabled,false,'Operation should complete without a recovery-panel click');
  await new Promise(resolve=>setTimeout(resolve,0));
 }
 return{click,actions,status:()=>w.document.getElementById('status').textContent,downloads:()=>downloads,recovery:()=>w.document.querySelector('details')};
}
test('same main button recovers a proven-unsent card and downloads without a manual resume click',async t=>{
 const f=fixture(t);await f.click();assert.match(f.status(),/ещё не отправлялась/);assert.equal(f.recovery().open,true);
 await f.click();assert.equal(f.downloads(),1);
 assert.deepEqual(f.actions,['prepare','complete','prepare','complete']);
});
test('same main button resumes a pending history without committing the card again',async t=>{
 const f=fixture(t,{historyFails:true});await f.click();assert.match(f.status(),/историю ещё не отправлялась/);
 await f.click();assert.equal(f.downloads(),1);
 assert.deepEqual(f.actions,['prepare','complete','prepare','complete']);
});
test('a known CRM conflict is shown as a conflict, not an instruction to blindly resend',async t=>{
 const f=fixture(t,{conflict:true});await f.click();assert.match(f.status(),/Карточка изменилась в Bitrix/);
 assert.doesNotMatch(f.status(),/Нажмите «Сохранить и скачать» ещё раз/);assert.equal(f.downloads(),0);
});
