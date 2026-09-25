import {readFile,readdir,mkdir,cp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import {syntheticCrm} from '../tests/runtime/synthetic-crm.mjs';

const dir=resolve('.wrangler/manager-ux-preview'),port=8897,origin='http://127.0.0.1:'+port;await mkdir(dir,{recursive:true});
const previewAssets=join(dir,'assets');await cp(resolve('dist/client'),previewAssets,{recursive:true});
const questionnairePath=join(previewAssets,'questionnaire.html');
await writeFile(questionnairePath,(await readFile(questionnairePath,'utf8')).replace(/(<body\b[^>]*>)/i,'$1<div style="padding:8px 20px;text-align:center;background:#fff3d8;color:#70501b;font:13px system-ui">Предпросмотр · тестовые данные</div>'));
await build({entryPoints:['scripts/preview-manager-ux-fixture.mjs'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:join(dir,'fixture.mjs'),logLevel:'silent'});
const {seedManagerPreview}=await import(pathToFileURL(join(dir,'fixture.mjs')).href);
const paths=(await readdir('dist/server',{recursive:true})).filter(n=>/\.m?js$/.test(n)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const modules=await Promise.all(paths.map(async path=>({type:'ESModule',path,contents:await readFile(join('dist/server',path),'utf8')})));
const crm=syntheticCrm();crm.deal.TITLE='Клиент для просмотра';
const mf=new Miniflare({host:'127.0.0.1',port,modules,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'manager-preview-db'},r2Buckets:{FILES:'manager-preview-files'},d1Persist:join(dir,'d1'),r2Persist:join(dir,'r2'),bindings:{AUTH_PROVIDER:'local',SITE_ACCESS_PASSWORD:'preview-only',SITE_SESSION_TOKEN:'manager-preview-key-isolated-from-production',BITRIX_WEBHOOK:'https://bitrix.synthetic.invalid/rest/'},assets:{directory:previewAssets,binding:'ASSETS',routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none'}},outboundService:crm.handle});
await mf.ready;const db=await mf.getD1Database('DB');
const existing=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assessment_cases'").first();
if(!existing){
 for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const statement of (await readFile(join('drizzle',name),'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
 const fixture=await seedManagerPreview(db,await mf.getR2Bucket('FILES'));let cookie='';
 async function api(path,body){const response=await mf.dispatchFetch(origin+path,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});if(path==='/api/session')cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!response.ok)throw Error(path+' '+response.status+' '+await response.text());return response.json();}
 await api('/api/session',{worker:'ali',password:'preview-only'});
 for(const doc of fixture.documents.filter(d=>!d.kind.startsWith('gkb_')))await api('/api/assessment/900001/document-reviews',{requestId:crypto.randomUUID(),documentId:doc.documentId,identityRevision:1,review:{type:doc.type,iin:fixture.iin,pages:1,complete:true,contentMatches:true,periodChecked:true,reason:'Preview fixture inspection only',issuedAt:fixture.today,expiresAt:'2099-12-31',from:fixture.from,to:fixture.today}});
 await api('/api/assessment/900001/draft',{requestId:crypto.randomUUID(),identityRevision:1,expectedRevision:0,payload:fixture.payload});
}
console.log('Isolated app preview: '+origin+'/assessment-review?dealId=900001');
process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
