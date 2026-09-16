"""Real Chromium/DOCX regression: network and CRM are synthetic, renderer is real."""
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile
import importlib.util
import json
import os
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('download_fixture', Path(__file__).with_name('contract-download.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

with sync_playwright() as p, TemporaryDirectory() as temp:
    executable = os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium')
    browser = p.chromium.launch(executable_path=executable, headless=True, args=['--no-sandbox'])
    context = browser.new_context(accept_downloads=True)
    requested = []
    def route(request):
        requested.append(request.request.url)
        request.abort()
    # Libraries are loaded from checked-in files. No external network is allowed.
    context.route('**/*', route)
    page = context.new_page()
    page.set_content(fixture.HTML)
    page.evaluate(fixture.SETUP)
    for name in ['pizzip-3.1.7.min.js','docxtemplater-3.50.0.min.js']:
        page.add_script_tag(content=(ROOT/'public/vendor/contracts'/name).read_text())
    source = (ROOT/'public/contract-renderer.js').read_text()
    page.add_script_tag(content=source)
    page.evaluate('ContractRenderer.ready()')
    page.evaluate(r'''source => {
        const template=source.match(/const TEMPLATE_B64 = '([^']+)';/)[1];
        const original=new PizZip(template,{base64:true});
        const data={payments:[{index:'1',amount:'200 000',date:'17 сентября 2026 г.'},{index:'2',amount:'200 000',date:'17 октября 2026 г.'}]};
        for(const name of Object.keys(original.files).filter(n=>n.endsWith('.xml'))){
            const text=original.file(name).asText().replace(/<[^>]*>/g,'');
            for(const [,key] of text.matchAll(/\{\{([^{}]+)\}\}/g))if(!/^[#/]/.test(key))data[key]='SYNTHETIC';
        }
        data.client_name='SYNTHETIC TEST CLIENT';data.contract_number='TEST-NOT-FOR-SIGNING';
        const send=window.fetch;
        window.fetch=async(url,options)=>{
            const response=await send(url,options);
            if(options?.body&&JSON.parse(options.body).action==='contract')return{ok:true,json:async()=>({contract:{rendererVersion:ContractRenderer.version,data}})};
            return response;
        };
    }''', source)
    page.add_script_tag(content=fixture.FLOW)
    page.evaluate("fixture.flow=SubmissionFlow.mount(document.getElementById('anchor'),document.getElementById('status'));fixture.save=document.getElementById('saveAssessment');fixture.mark();void 0")
    with page.expect_download() as event:
        page.locator('#saveAssessment').click()
    download = event.value
    target = Path(temp)/'synthetic.docx'
    download.save_as(target)
    assert download.failure() is None
    assert target.stat().st_size > 10000
    with ZipFile(target) as doc:
        assert doc.testzip() is None
        text = doc.read('word/document.xml').decode()
        assert 'SYNTHETIC TEST CLIENT' in text
        assert 'TEST-NOT-FOR-SIGNING' in text
        assert '{{' not in text and 'undefined' not in text
    actions = page.evaluate('fixture.calls.map(x=>x.action)')
    assert actions == ['prepare','commit','history','contract']
    with page.expect_download():
        page.locator('#downloadContractFile').click()
    assert page.evaluate('fixture.calls.map(x=>x.action)') == actions
    assert len(requested) == 0
    print(json.dumps({'result':'PASS','scope':'Native Chromium, real contract renderer and DOCX libraries; CRM responses synthetic; actual pinned libraries preloaded locally; no network','download':download.suggested_filename,'docxBytes':target.stat().st_size,'crmActions':actions,'persistentLinkDidNotRepeatWrites':True,'networkRequests':requested},ensure_ascii=False,indent=2))
    context.close()
    browser.close()
