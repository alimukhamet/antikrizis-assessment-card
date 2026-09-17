"""Synthetic browser regression tests. Never connects to Bitrix or production.
Requires Python Playwright and Chromium. Renderer and server boundaries are stubbed;
this verifies real DOM, Blob downloads, recovery, and stale-result handling.
"""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HTML = '<!doctype html><html lang="ru"><meta charset="UTF-8"><body><button id="anchor">Проверить</button><p id="status" role="status"></p></body></html>'
SETUP = r'''() => {
 const w=window;if(!crypto.randomUUID)crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000001';let payload={answers:['INITIAL']},dealId='11665',row=null;
 const calls=[],generated=[],downloads=[];
 w.HostedAssessment={ready:()=>true,getContext:()=>({client:{title:'SYNTHETIC CLIENT',iin:'SYNTHETIC',external:{dealId}}})};
 w.ServerDrafts={capture:()=>payload,reviewBindings:()=>[],save:async()=>true};
 w.SubmissionDestination={confirm:async()=>({dealId,iin:'SYNTHETIC',identityRevision:1})};
 w.ContractRenderer={ready:async()=>{}};
 const renderer={render:async(data)=>{generated.push(data);return new Blob(['SYNTHETIC CONTRACT'],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});}};
 w.ContractRenderers={['a'.repeat(64)]:renderer};
 w.fetch=async(url,options)=>{
  if(!options?.method)return {ok:true,json:async()=>({submission:row})};
  const b=JSON.parse(options.body);calls.push(b);
  if(['complete','resume'].includes(b.action))row={requestId:row?.requestId||b.requestId,state:'verified',assessmentSaved:true,historySaved:true,contractNumber:'SYNTHETIC',reviewText:'SYNTHETIC SNAPSHOT',workflow:{status:'ready'},contract:{rendererVersion:'a'.repeat(64),data:{client_name:'SAVED PERSON'}}};
  else throw Error('Unexpected browser save step '+b.action);
  if(b.action===w.editOnAction)payload={answers:['EDITED']};
  return{ok:true,json:async()=>row};
 };
 document.addEventListener('click',e=>{if(e.target.id==='downloadContractFile'&&!e.defaultPrevented)downloads.push(e.target.href);});
 w.fixture={calls,generated,downloads,renderer,edit:()=>payload={answers:['EDITED']},switchClient:()=>dealId='900001',mark:()=>{const context={dealId,payload,bindings:[],signature:JSON.stringify({payload,bindings:[]})};w.fixture.flow.checked({readyToSubmit:true,identityRevision:1},context);}};
}'''
FLOW = (ROOT/'public/submission-flow.js').read_text()

def run():
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context(accept_downloads=True)
        page=None
        def setup():
            nonlocal page
            if page: page.close()
            page=context.new_page()
            page.set_default_timeout(3000)
            page.set_content(HTML)
            page.evaluate(SETUP)
            page.add_script_tag(content=FLOW)
            page.evaluate("fixture.flow=SubmissionFlow.mount(document.getElementById('anchor'),document.getElementById('status')); fixture.save=document.getElementById('saveAssessment'); fixture.mark();;void 0;")
        def state():
            return page.evaluate("({downloads:fixture.downloads.length,actions:fixture.calls.map(x=>x.action),status:document.getElementById('status').textContent,disabled:fixture.save.disabled,linkHidden:document.getElementById('downloadContractFile').hidden})")
        def passed(name):
            results.append({'test':name,'result':'PASS'})
            print('PASS: '+name,file=sys.stderr,flush=True)

        setup()
        with page.expect_download() as d:
            page.evaluate('fixture.save.onclick()')
        assert d.value.suggested_filename.endswith('11665.docx')
        assert state()['actions']==['complete']
        assert not state()['disabled'] and not state()['linkHidden']
        assert page.evaluate('fixture.generated[0].client_name')=='SAVED PERSON'
        passed('one click creates a real browser download from the saved snapshot')
        before=state()['actions']
        with page.expect_download(): page.locator('#downloadContractFile').click()
        assert state()['actions']==before
        passed('persistent direct download link does not repeat CRM writes')

        setup()
        page.evaluate("fixture.renderer.render=()=>new Promise(resolve=>window.finishRender=resolve); window.job=fixture.save.onclick(); void 0;;void 0;")
        page.wait_for_function('!!window.finishRender')
        page.evaluate("fixture.edit();finishRender(new Blob(['STALE']));;void 0;")
        page.evaluate('window.job')
        assert state()['downloads']==0 and not state()['disabled']
        assert 'изменились' in state()['status']
        passed('editing answers during rendering blocks a stale contract')

        setup()
        page.evaluate("fixture.renderer.render=()=>new Promise(resolve=>window.finishRender=resolve); window.job=fixture.save.onclick(); void 0;;void 0;")
        page.wait_for_function('!!window.finishRender')
        page.evaluate("fixture.switchClient();finishRender(new Blob(['WRONG CLIENT']));;void 0;")
        page.evaluate('window.job')
        assert state()['downloads']==0
        passed('switching clients during rendering blocks the wrong client file')

        for action in ['complete']:
            setup();page.evaluate('(action)=>window.editOnAction=action',action);page.evaluate('fixture.save.onclick()')
            assert state()['downloads']==0
            assert page.evaluate('fixture.generated.length')==0
            passed(f'editing during {action} response prevents outdated generation')

        setup();page.evaluate("fixture.renderer.render=async()=>new Blob([]);void 0;");page.evaluate('fixture.save.onclick()')
        assert state()['downloads']==0 and 'пустой файл' in state()['status']
        assert not state()['disabled']
        passed('empty file is reported as an error rather than success')

        setup()
        page.evaluate("const originalTimer=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===60000?10:ms,...args);fixture.renderer.render=()=>new Promise(resolve=>window.finishRender=resolve);;void 0;")
        page.evaluate('fixture.save.onclick()')
        assert state()['downloads']==0 and not state()['disabled']
        assert 'слишком много времени' in state()['status']
        page.evaluate("finishRender(new Blob(['LATE']));void 0;")
        page.wait_for_timeout(20)
        assert state()['downloads']==0
        passed('stalled renderer releases controls and cannot download after timeout')

        setup();page.evaluate("ContractRenderer.ready=async()=>{throw Error('SYNTHETIC DEPENDENCY FAILURE')};void 0;");page.evaluate('fixture.save.onclick()')
        assert state()['actions']==[] and state()['downloads']==0
        assert not state()['disabled']
        page.evaluate('ContractRenderer.ready=async()=>{}')
        with page.expect_download(): page.evaluate('fixture.save.onclick()')
        assert state()['actions'].count('complete')==1
        passed('dependency failure prevents writes and a retry works without reloading')

        setup();page.evaluate("const render=fixture.renderer.render;let first=true;fixture.renderer.render=async(...args)=>{if(first){first=false;throw Error('SYNTHETIC RENDER FAILURE')}return render(...args)};void 0;");page.evaluate('fixture.save.onclick()')
        assert state()['downloads']==0
        page.wait_for_function("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Скачать сохранённый договор')")
        page.locator('details').evaluate('(node)=>node.open=true')
        with page.expect_download(): page.get_by_role('button',name='Скачать сохранённый договор',exact=True).click()
        assert state()['actions']==['complete','resume']
        passed('saved contract can be recovered after render failure without duplicate writes')

        setup()
        page.evaluate("ContractRenderer.ready=async()=>{fixture.edit()};void 0;")
        page.evaluate('fixture.save.onclick()')
        assert state()['actions']==[] and state()['downloads']==0
        passed('editing during dependency preparation stops all external writes')
        context.close();browser.close()
    print(json.dumps({'scope':'Synthetic Chromium browser tests; server and DOCX renderer stubbed','passed':len(results),'tests':results},ensure_ascii=False,indent=2))

if __name__=='__main__': run()
