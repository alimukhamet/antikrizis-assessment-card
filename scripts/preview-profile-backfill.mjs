// Isolated local preview of the documentologist profile backfill. Synthetic data and fake Bitrix only.
import {readFile,readdir,mkdir,cp,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import {syntheticCrm} from '../tests/runtime/synthetic-crm.mjs';

const dir=resolve('.wrangler/profile-preview'),port=8898,origin='http://127.0.0.1:'+port;await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
const previewAssets=join(dir,'assets');await cp(resolve('dist/client'),previewAssets,{recursive:true});
const questionnairePath=join(previewAssets,'questionnaire.html');
await writeFile(questionnairePath,(await readFile(questionnairePath,'utf8')).replace(/(<body\b[^>]*>)/i,'$1<div style="padding:8px 20px;text-align:center;background:#fff3d8;color:#70501b;font:13px system-ui">Предпросмотр · тестовые данные · Bitrix не подключён</div>'));
await build({entryPoints:['tests/runtime/fixture.mjs'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:join(dir,'fixture.mjs'),logLevel:'silent'});
const {seed}=await import(pathToFileURL(join(dir,'fixture.mjs')).href);
const paths=(await readdir('dist/server',{recursive:true})).filter(n=>/\.m?js$/.test(n)).sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const modules=await Promise.all(paths.map(async path=>({type:'ESModule',path,contents:await readFile(join('dist/server',path),'utf8')})));

// The openable synthetic deal sits on a ZVI stage with an old free-text card; three more deals fill the queue.
const crm=syntheticCrm();
Object.assign(crm.deal,{TITLE:'Тестовый клиент Иванова А.',CATEGORY_ID:'1',STAGE_ID:'C1:ZVI',CONTACT_ID:'5',UF_CRM_1778066504937:'2026-09-20T00:00:00+05:00',UF_CRM_1773655613972:'199',
 UF_CRM_1773669702495:'Иванова Айгуль Тестовна',UF_CRM_AI_MARITAL:'',UF_CRM_AI_DEBT:'',
 UF_CRM_AI_CARD:'Старая карточка (тест): клиентка работает продавцом, двое детей, кредиты в 3 банках, просрочка 4 месяца.'});
const others=[
 {ID:'900002',TITLE:'Тестовый клиент Петров Б.',STAGE_ID:'C1:WAIT',UF_CRM_1778066504937:'2026-09-18T00:00:00+05:00',UF_CRM_1773655613972:'203',UF_CRM_AI_IIN:'000000000029',UF_CRM_AI_CARD:''},
 {ID:'900003',TITLE:'Тестовый клиент Сидорова В.',STAGE_ID:'C1:ZVI',UF_CRM_1778066504937:'2026-09-10T00:00:00+05:00',UF_CRM_1773655613972:'201',UF_CRM_AI_IIN:'',UF_CRM_AI_CARD:'старая карточка'},
 {ID:'900004',TITLE:'Тестовый клиент Ахметов Г.',STAGE_ID:'C1:ZVI',UF_CRM_1778066504937:'2026-09-01T00:00:00+05:00',UF_CRM_1773655613972:'199',UF_CRM_AI_IIN:'000000000037',UF_CRM_AI_CARD:''},
];
const stages=[{ENTITY_ID:'DEAL_STAGE_1',STATUS_ID:'C1:ZVI',NAME:'ЗВИ'},{ENTITY_ID:'DEAL_STAGE_1',STATUS_ID:'C1:WAIT',NAME:'В ожидании'},{ENTITY_ID:'DEAL_STAGE_1',STATUS_ID:'C1:NEW',NAME:'Новая'}];
const handle=async request=>{
 const method=new URL(request.url).pathname.split('/').at(-1);
 const body=()=>request.clone().json();
 if(method==='crm.status.list.json'){const b=await body();if(b.filter?.ENTITY_ID==='DEAL_STAGE_1')return Response.json({result:stages});}
 if(method==='crm.deal.fields.json')return Response.json({result:{UF_CRM_1773655613972:{items:[{ID:'199',VALUE:'ВП'},{ID:'201',VALUE:'СБ'},{ID:'203',VALUE:'ВБ'},{ID:'205',VALUE:'График'}]}}});
 if(method==='crm.deal.list.json')return Response.json({result:[{...crm.deal},...others]});
 if(method==='crm.contact.get.json')return Response.json({result:{PHONE:[{VALUE:'+7 700 000 00 01'}]}});
 if(method==='crm.deal.update.json'){const b=await body();if(!b.fields.STAGE_ID){Object.assign(crm.deal,b.fields);return Response.json({result:true});}}
 if(method==='crm.timeline.comment.add.json')return Response.json({result:1});
 return crm.handle(request);
};
const mf=new Miniflare({host:'127.0.0.1',port,modules,compatibilityDate:'2026-05-22',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'profile-preview-db'},r2Buckets:{FILES:'profile-preview-files'},d1Persist:join(dir,'d1'),r2Persist:join(dir,'r2'),
 bindings:{AUTH_PROVIDER:'local',SITE_ACCESS_PASSWORD:'preview-only',AZHAR_PASSWORD:'preview',SITE_SESSION_TOKEN:'profile-preview-key-isolated-from-production',BITRIX_WEBHOOK:'https://bitrix.synthetic.invalid/rest/'},
 assets:{directory:previewAssets,binding:'ASSETS',routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none'}},outboundService:handle});
await mf.ready;const db=await mf.getD1Database('DB');
for(const name of (await readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())for(const statement of (await readFile(join('drizzle',name),'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(statement).run();
await seed(db,await mf.getR2Bucket('FILES'));
// Signed in as Azhar through a local proxy, like the manager preview: the browser never handles a password.
const login=await mf.dispatchFetch(origin+'/api/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({worker:'azhar',password:'preview'})});
if(!login.ok)throw Error('Preview login failed '+login.status);
const session=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
const http=await import('node:http'),proxyPort=8899;
http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 const headers={...req.headers,cookie:session,origin};delete headers.host;
 const response=await mf.dispatchFetch(origin+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'manual'});
 const out={};response.headers.forEach((v,k)=>{if(k!=='set-cookie'&&k!=='content-encoding'&&k!=='content-length')out[k]=v.replaceAll(origin,'http://127.0.0.1:'+proxyPort);});
 res.writeHead(response.status,out);res.end(Buffer.from(await response.arrayBuffer()));
}).listen(proxyPort,'127.0.0.1');
console.log('Profile backfill preview: http://127.0.0.1:'+proxyPort+'/profile-backfill (signed in as Azhar)');
process.on('SIGINT',async()=>{await mf.dispose();process.exit(0);});
