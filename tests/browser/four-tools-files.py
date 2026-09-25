"""Native Chromium file selections. All API responses synthetic; no production writes."""
from pathlib import Path
import json
import shutil
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    context = browser.new_context()
    errors = []
    context.route('**/*', lambda request: request.abort())
    def load(page,kind,mode='contract'):
        html=(ROOT/('templates/assessment-card.html' if kind=='legacy' else 'public/questionnaire.html')).read_text()
        scripts=re.findall(r'<script([^>]*)>(.*?)</script>',html,re.S)
        markup=re.sub(r'<script[^>]*>.*?</script>','',html,flags=re.S)
        markup=re.sub(r'<link[^>]*>','',markup)
        page.set_content(markup)
        page.evaluate("""()=>{window.fixtureCalls=[];window.fetch=async(path,options={})=>{
          fixtureCalls.push({path,method:options.method||'GET'});let data={};
          if(path==='/api/status')data={ok:true,source:'bitrix'};
          else if(path.startsWith('/api/sales-metrics'))data={relatedMetrics:[],lastSyncAt:'2026-09-17T00:00:00Z'};
          else if(path==='/api/assessment/900001')data={caseId:'synthetic',identityRevision:1,assessmentDay:'2026-09-17',client:{title:'SYNTHETIC',iin:'000000000010',external:{dealId:'900001',system:'bitrix'}}};
          else if(path.endsWith('/draft'))data={draft:null};
          else if(path.endsWith('/credentials'))data={credentials:{verified:false},identityRevision:1};
          else if(path.endsWith('/handoff'))data={handoff:null,destination:{fromStageName:'Договор',stageName:'Успех'},stageError:null,delivery:{ready:true}};
          else if(path.endsWith('/uploads'))data={unsent:null};
          else if(path.endsWith('/submission'))data={submission:null};
          else if(path.endsWith('/crm-intake'))data={documents:[]};
          return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
        };}""")
        for attrs,content in scripts:
            if 'type="module"' in attrs:continue
            match=re.search(r'src="([^"]+)"',attrs)
            if match:
                file=ROOT/'public'/match[1].lstrip('/')
                if not file.is_file():continue
                content=file.read_text()
                if file.name=='client-context-ui.js':
                    # Supply the iframe's query-string input without network navigation.
                    content=content.replace('new URLSearchParams(location.search)', "new URLSearchParams('?mode="+mode+"')")
            page.add_script_tag(content=content)
        for name in ['assessment-review.css','assessment-workflow.css','pdf-preview.css','tool-feedback.css','operations.css','file-selection-controls.css'] if kind!='legacy' else ['file-selection-controls.css']:
            page.add_style_tag(content=(ROOT/'public'/name).read_text())
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    load(page,'legacy')
    assert page.locator('.task-grid > .task-card').count()==4
    assert page.locator('[data-main-action=assessment]').get_attribute('href')=='/assessment-review'
    assert page.locator('[data-main-action=handoff]').get_attribute('href')=='/lawyer-handoff'
    page.locator('[data-open-view=documents]').click()
    a={'name':'wrong.pdf','mimeType':'application/pdf','buffer':b'SYNTHETIC WRONG'}
    b={'name':'keep.pdf','mimeType':'application/pdf','buffer':b'SYNTHETIC KEEP'}
    page.locator('#docGkbShort').set_input_files([a,b])
    row=page.locator('[data-doc=gkbShort]')
    row.get_by_role('button',name='Убрать wrong.pdf',exact=True).click()
    assert page.locator('#docGkbShort').evaluate('(e)=>Array.from(e.files).map(f=>f.name)')==['keep.pdf']
    # Cancelling replacement is non-destructive; a real file choice swaps only that entry.
    with page.expect_file_chooser() as chooser: row.get_by_role('button',name='Заменить keep.pdf',exact=True).click()
    chooser.value.set_files([])
    assert page.locator('#docGkbShort').evaluate('(e)=>e.files[0].name')=='keep.pdf'
    with page.expect_file_chooser() as chooser: row.get_by_role('button',name='Заменить keep.pdf',exact=True).click()
    chooser.value.set_files(a)
    assert page.locator('#docGkbShort').evaluate('(e)=>e.files[0].name')=='wrong.pdf'
    page.evaluate("document.getElementById('docsBtn').dataset.busy='1'")
    assert row.get_by_role('button',name='Убрать wrong.pdf',exact=True).is_disabled()
    page.evaluate("delete document.getElementById('docsBtn').dataset.busy")
    row.get_by_role('button',name='Убрать wrong.pdf',exact=True).click()
    assert page.locator('#docGkbShort').evaluate('(e)=>e.files.length')==0
    page.locator('#docGkbShort').set_input_files(a)
    assert row.get_by_role('button',name='Убрать wrong.pdf',exact=True).is_visible()
    assert not page.evaluate("fixtureCalls.some(c=>c.method==='POST')")
    page.locator('#backBtn').click();page.screenshot(path='/mnt/data/four-tools-home-desktop.png',full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.screenshot(path='/mnt/data/four-tools-home-mobile.png',full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    for mode in ['contract','handoff']:
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        load(page,'assessment',mode)
        page.wait_for_function('window.FileSelectionControls && window.ServerDrafts')
        page.evaluate("document.getElementById('hostDealId').value='900001';document.getElementById('hostLoadDeal').onclick()")
        page.wait_for_function('ClientContextUI.ready() && !FileSelectionControls.locked()')
        page.evaluate("""()=>{
          ServerDrafts.save=async()=>true;
          document.getElementById('needsSocialDoc').value='0';document.getElementById('needsSalaryDoc').value='none';
          selectedFiles=[{id:++fileSequence,type:'Доверенность',person:'Клиент',file:new File(['TEST'],'wrong.pdf'),storedDocumentId:'wrong'}];
          af.results.set(fileSequence,{server:{documentId:'wrong'},sourceOnly:true});
          renderDocuments();afRenderResults();afRefresh();FileSelectionControls.refresh();document.dispatchEvent(new Event('assessment-files-selected'));
        }""")
        if mode=='handoff':
            page.wait_for_function('!FileSelectionControls.locked()')
            remove=page.locator('#uxHandoff').get_by_role('button',name='Убрать wrong.pdf',exact=True)
        else: remove=page.locator('#afFileResults').get_by_role('button',name='Убрать wrong.pdf',exact=True)
        assert remove.is_visible()
        page.screenshot(path=f'/mnt/data/{mode}-file-controls.png',full_page=True)
        remove.click();assert page.evaluate('selectedFiles.length')==0
        if mode=='handoff':
            page.evaluate("""()=>{selectedFiles=[{id:++fileSequence,type:'Подписанный договор',person:'Клиент',file:new File(['TEST'],'signed.pdf'),storedDocumentId:'signed'}];document.getElementById('handoffSignedConfirmed').checked=true;renderDocuments();document.dispatchEvent(new Event('assessment-files-selected'));}""")
            page.locator('#handoffSignedRemove').click()
            assert page.evaluate('selectedFiles.length')==0
            assert not page.locator('#handoffSignedConfirmed').is_checked()
            assert page.locator('#handoffSend').is_disabled()
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        page.close()
    assert not errors, errors
    print(json.dumps({'result':'PASS','scope':'Actual HTML, DOM controls and Chromium FileList; synthetic API responses; no production access','checks':['four menu entries','per-file native removal','replacement cancellation','replacement','busy lock','same file re-selection','assessment visible remove','handoff visible remove','signed-PDF approval reset','mobile overflow'],'browserErrors':errors},indent=2))
    browser.close()
