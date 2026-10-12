// Explicit release acceptance through normal staff authentication.
// Only authentication receipts are created; no client or employee record is changed.
import {writeFile} from 'node:fs/promises';
const assessment='https://assessment.anti-krizis.kz',platform='https://platform.anti-krizis.kz';
const report={checkedAt:new Date().toISOString(),passed:false,people:[],scope:'normal login, issued ticket, view-only session, workspace read, forbidden empty mutation, replay denial; no client-data export'};
const requireThat=(condition,code)=>{if(!condition)throw Error(code);};
const request=(url,init={})=>fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000),...init});
const cookieOf=response=>response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
try{
 requireThat(Boolean(process.env.ASSESSMENT_TEST_PASSWORD),'verification_credential_missing');
 const health=await request(platform+'/api/health');requireThat(health.status===200,'platform_health_unavailable');
 const release=await health.json();report.platformRelease=release.release??null;
 for(const worker of ['darkhan','ramazan','nurdaulet']){
  const result={worker,passed:false};report.people.push(result);
  const login=await request(assessment+'/api/session',{method:'POST',headers:{origin:assessment,'content-type':'application/json'},body:JSON.stringify({worker,password:process.env.ASSESSMENT_TEST_PASSWORD})});
  requireThat(login.status===200,'assessment_login_failed');const assessmentCookie=cookieOf(login);requireThat(Boolean(assessmentCookie),'assessment_cookie_missing');
  const page=await request(assessment+'/assessment-card.html',{headers:{cookie:assessmentCookie}});requireThat(page.status===200,'launcher_unavailable');
  const markup=await page.text();requireThat(/<form data-platform-entry(?:="")? method="post" action="\/platform-entry" target="_blank" rel="noopener">/.test(markup),'launcher_button_missing');result.button=true;
  const entry=await request(assessment+'/platform-entry',{method:'POST',headers:{cookie:assessmentCookie,origin:assessment,'sec-fetch-site':'same-origin'}});
  requireThat(entry.status===200,'issuer_failed');requireThat(entry.headers.get('referrer-policy')==='strict-origin','issuer_origin_policy_invalid');requireThat(entry.headers.get('cache-control')==='private, no-store','issuer_cache_policy_invalid');
  const html=await entry.text();requireThat(html.includes('action="'+platform+'/api/auth/assessment-entry"'),'entry_destination_invalid');
  const ticket=html.match(/name="ticket" value="([A-Za-z0-9_.-]+)"/)?.[1];requireThat(Boolean(ticket),'ticket_missing');
  const redemption={method:'POST',headers:{origin:assessment,'sec-fetch-site':'same-site','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket})};
  const accepted=await request(platform+'/api/auth/assessment-entry',redemption);
  requireThat(accepted.status===303&&accepted.headers.get('location')==='/after-sales#deals','platform_entry_failed');
  const platformCookie=cookieOf(accepted);requireThat(Boolean(platformCookie),'platform_cookie_missing');
  const session=await request(platform+'/api/auth/session',{headers:{cookie:platformCookie}});requireThat(session.status===200,'platform_session_failed');
  const data=await session.json();requireThat(data.user?.employeeId==='sales-'+worker&&data.user?.viewOnly===true&&data.user?.role==='support','platform_session_scope_invalid');result.viewOnlySession=true;
  const workspace=await request(platform+'/api/crm/operations/workspace',{headers:{cookie:platformCookie}});requireThat(workspace.status===200,'workspace_read_failed');await workspace.body?.cancel();result.workspaceRead=true;
  const denied=await request(platform+'/api/admin/employee-logins',{method:'POST',headers:{origin:platform,cookie:platformCookie,'content-type':'application/json'},body:'{}'});requireThat(denied.status===403,'mutation_not_denied');await denied.body?.cancel();result.mutationDenied=true;
  const replay=await request(platform+'/api/auth/assessment-entry',redemption);requireThat(replay.status===409,'replay_not_denied');await replay.body?.cancel();result.replayDenied=true;
  result.passed=true;
 }
 report.passed=true;console.log('Three sales entries verified: normal authentication, view-only session, workspace read, mutation denial, replay denial.');
}catch(error){report.error=error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'verification_failed';console.error(report.error);process.exitCode=1;}
finally{await writeFile('live-platform-entry-audit.json',JSON.stringify(report,null,2)+'\n');}
