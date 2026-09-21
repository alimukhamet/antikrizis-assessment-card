// Preserve the reviewed sales dashboard and contract template while publishing
// the current workflows and credit-report checker. The archived editor never enters this page.
import {readFile,writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const source=await readFile('templates/assessment-card.html','utf8'),dom=new JSDOM(source),doc=dom.window.document;
const head=doc.head.cloneNode(true);head.querySelectorAll('script').forEach(n=>n.remove());
const home=doc.getElementById('homeView').cloneNode(true),hero=home.querySelector('.home-hero'),grid=home.querySelector('.task-grid');
for(const card of [...grid.children])if(!['assessment','handoff'].includes(card.dataset.mainAction))card.remove();
if(grid.children.length!==2)throw Error('Current tools are missing from the canonical launcher');
hero.querySelector('h1').textContent='Работа с клиентом';hero.querySelector(':scope > p').textContent='Подготовьте договор. После подписания передайте клиента юристам.';
grid.querySelector('[data-main-action="assessment"] h2').textContent='Подготовить договор';
grid.querySelector('[data-main-action="assessment"] p').textContent='Документы → ответы → готовый договор.';
grid.querySelector('[data-main-action="handoff"] p').textContent='Подписанный договор, доверенность и ЭЦП.';
const creditTool=hero.querySelector('a[data-main-action="gkb"]');
if(!creditTool)throw Error('Credit-report checker is missing from the canonical launcher');
if(creditTool.previousSibling?.nodeType===3&&!creditTool.previousSibling.textContent.trim())creditTool.previousSibling.remove();
creditTool.className='task-card';creditTool.replaceChildren();
for(const [tag,cls,text] of [['span','task-number','05'],['h2','','Проверить кредитный отчёт'],['p','','Загрузите ГКБ и проверьте кредиты клиента.'],['span','task-link','Открыть проверку ↗']]){const node=doc.createElement(tag);node.className=cls;node.textContent=text;creditTool.append(node);}
grid.append(creditTool);
hero.querySelector('.competition').before(grid);
const style=doc.createElement('style');style.textContent='.home-hero{max-width:1040px;margin:24px auto 0}.home-hero h1{font-size:30px;letter-spacing:-.7px}body[data-view=home] .task-grid{grid-template-columns:repeat(3,minmax(0,1fr));margin:24px 0 30px}body[data-view=home] .task-card{min-height:185px;border-radius:14px;padding:22px;box-shadow:none}.task-card h2{font-size:22px}.task-number{font-size:12px}.competition{margin-top:12px}.home-hero>.payment-shortcut{display:inline-flex;margin:16px 24px 0 0}.personal-shortcuts{margin:20px 0}@media(min-width:621px) and (max-width:850px){body[data-view=home] .task-grid{grid-template-columns:repeat(2,minmax(0,1fr))}body[data-view=home] .task-grid>.task-card:last-child{grid-column:1/-1;min-height:160px}}@media(max-width:620px){body[data-view=home] .task-grid{grid-template-columns:1fr;gap:12px}body[data-view=home] .task-card{min-height:160px}.home-hero h1{font-size:26px}.home-hero>.payment-shortcut{display:flex;margin:12px 0}}';head.append(style);
const start=source.indexOf('const salesToday='),end=source.indexOf('// ── Money input formatting',start);if(start<0||end<0)throw Error('Sales dashboard source markers changed');
const script='// Current tools launcher: sales readback only; no legacy form or CRM writes.\n(()=>{\nconst $=id=>document.getElementById(id);\n'+source.slice(start,end).replaceAll('catch(_){','catch{')+'\n})();\n';
await writeFile('public/tools-home.js',script);
await writeFile('templates/tools-home.html','<!doctype html><html lang="ru">'+head.outerHTML+'<body data-view="home"><div class="wrap">'+home.outerHTML+'</div><script src="/tools-home.js"></script></body></html>\n');dom.window.close();
console.log('Current launcher built: tools 03, 04 and the credit-report checker.');
