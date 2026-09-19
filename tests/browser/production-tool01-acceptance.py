import json, os, shutil, tempfile
from pathlib import Path
from zipfile import ZipFile
from playwright.sync_api import sync_playwright

origin=os.environ["ORIGIN"]
password=os.environ["ASSESSMENT_TEST_PASSWORD"]
chrome=shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chromium-browser")
if not chrome:
    raise RuntimeError("SYSTEM_CHROME_NOT_FOUND")

report={
    "dealId":"11665","authenticated":False,"launcher":False,"dealFound":False,
    "confirmation":False,"downloaded":False,"docxValid":False,"success":False,
    "browserErrors":[],"failedResponses":[]
}
try:
    with sync_playwright() as p, tempfile.TemporaryDirectory() as td:
        browser=p.chromium.launch(executable_path=chrome,headless=True,args=["--no-sandbox"])
        context=browser.new_context(accept_downloads=True)
        page=context.new_page()
        page.on("pageerror",lambda e:report["browserErrors"].append(str(e)[:160]))
        page.on("response",lambda r:report["failedResponses"].append({"path":r.url.replace(origin,""),"status":r.status}) if r.url.startswith(origin) and r.status>=400 else None)

        page.goto(origin+"/login?returnTo=%2Fassessment-card",wait_until="domcontentloaded",timeout=30000)
        page.locator('select[name="worker"]').select_option("ali")
        page.locator('input[name="password"]').fill(password)
        page.get_by_role("button",name="Войти").click()
        page.wait_for_url(lambda u:"/login" not in str(u),timeout=30000)

        page.goto(origin+"/assessment-card",wait_until="networkidle",timeout=45000)
        report["authenticated"]="/login" not in page.url
        report["launcher"]=page.locator(".task-grid > .task-card").count()==4
        page.locator('[data-open-view="contract"]').click()
        page.locator("#dealId").fill("11665")
        page.locator("#dealId").press("Enter")
        page.wait_for_function("document.getElementById('dealLookup').dataset.state==='success'",timeout=30000)
        report["dealFound"]=True

        client=page.evaluate("""async()=>{const r=await fetch('/api/assessment/11665');if(!r.ok)throw Error('ASSESSMENT_CONTEXT_'+r.status);const j=await r.json();return{title:j.client?.title||'',iin:j.client?.iin||''}}""")
        if len(client["iin"])!=12 or not client["title"]:
            raise AssertionError("CLIENT_CONTEXT_INVALID")

        values={
            "fio":client["title"],"iin":client["iin"],"dognum":"TEST-11665-A","dependents":"0",
            "incomeClientOff":"300000","incomeClientUnoff":"0","debt":"7000000","overdueDays":"180",
            "lastCreditDate":"2025-01","kaspiTurnover":"100000","creditors":"SYNTHETIC BANK",
            "creditPurpose":"SYNTHETIC ACCEPTANCE TEST","guarantors":"Нет",
            "comment":"SYNTHETIC ACCEPTANCE TEST - NOT FOR SIGNING","summa":"400000",
            "contractDate":"2026-09-19","months":"5","payDay":"20"
        }
        for key,value in values.items():
            page.locator("#"+key).fill(value)
        page.locator("#procedure").select_option("199")
        page.locator("#grafType").select_option("261")
        page.locator("#marital").select_option(index=2)

        page.evaluate("""()=>{
          for(const key of ['works','children','salaryOtherBank','ip','realEstate','cars','carSale','ludo']) setSegmentValue(key,'0');
          const social=document.querySelector('input[name="socialStatus"][value="Нет"]');
          const credit=document.querySelector('input[name="creditType"]');
          social.checked=true; credit.checked=true; onChange();
        }""")

        missing=page.evaluate("validate(readState())")
        if missing:
            raise AssertionError("FORM_VALIDATION_FAILED:"+",".join(map(str,missing)))

        with page.expect_download(timeout=90000) as download_info:
            page.locator("#contractBtn").click()
            page.locator("#targetConfirmModal:not(.hidden)").wait_for(timeout=20000)
            report["confirmation"]=True
            page.locator("#targetConfirmApprove").click()

        download=download_info.value
        target=Path(td)/"contract.docx"
        download.save_as(target)
        if download.failure():
            raise AssertionError("DOWNLOAD_FAILED")
        report["downloaded"]=target.exists() and target.stat().st_size>10000
        with ZipFile(target) as z:
            if z.testzip() is not None:
                raise AssertionError("DOCX_ZIP_INVALID")
            xml=z.read("word/document.xml").decode("utf-8")
            report["docxValid"]="TEST-11665-A" in xml and "{{" not in xml and "undefined" not in xml
        message=page.locator("#info").inner_text()
        report["success"]="Карточка сохранена" in message and "Договор скачан" in message
        context.close()
        browser.close()
finally:
    Path("/tmp/tool01-production.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))

print(json.dumps(report,ensure_ascii=False,indent=2))
assert all([report["authenticated"],report["launcher"],report["dealFound"],report["confirmation"],report["downloaded"],report["docxValid"],report["success"]]),report
