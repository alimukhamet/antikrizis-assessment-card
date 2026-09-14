/* Render private PDFs locally in the browser; no document is sent to a viewer service. */
import {getDocument,GlobalWorkerOptions} from '/pdf-assets/pdf.mjs';
GlobalWorkerOptions.workerSrc='/pdf-assets/pdf.worker.mjs';
export async function mount(container,{url,page=1,onPage=()=>{}}){
 const source=new URL(url,location.origin);
 if(source.origin!==location.origin||!/^\/api\/assessment\/[1-9]\d*\/documents\/[a-f0-9-]+\?view=pdf$/i.test(source.pathname+source.search))throw Error('Недоступный источник документа.');
 let destroyed=false,pdf=null,rendering=null,loading=null,sequence=0,current=Math.max(1,Number(page)||1),zoom=1;
 container.innerHTML='<div class="pdf-tools"><button type="button" aria-label="Предыдущая страница">←</button><label>Страница <input aria-label="Номер страницы PDF" type="number" min="1" value="1" data-optional></label><span class="pdf-total"></span><button type="button" aria-label="Следующая страница">→</button><button type="button" aria-label="Уменьшить PDF">−</button><button type="button" aria-label="Увеличить PDF">+</button><a download>Скачать PDF</a></div><p class="pdf-status" role="status">Открываем PDF…</p><div class="pdf-sheet"><canvas role="img" aria-label="Страница документа"></canvas></div>';
 const status=container.querySelector('.pdf-status'),canvas=container.querySelector('canvas'),sheet=container.querySelector('.pdf-sheet'),input=container.querySelector('input'),buttons=container.querySelectorAll('button');
 container.querySelector('a').href=source.href;
 async function render(){
  if(!pdf||destroyed)return;const token=++sequence;
  if(rendering){rendering.cancel();try{await rendering.promise;}catch{/* Page navigation cancels an earlier render. */}}
  if(token!==sequence||destroyed)return;
  current=Math.max(1,Math.min(pdf.numPages,current));input.value=current;buttons[0].disabled=current===1;buttons[1].disabled=current===pdf.numPages;
  status.textContent='Открываем страницу '+current+'…';
  try{const p=await pdf.getPage(current);if(token!==sequence||destroyed)return;
   const base=p.getViewport({scale:1}),width=Math.max(260,sheet.clientWidth-24),view=p.getViewport({scale:width/base.width*zoom}),ratio=Math.min(window.devicePixelRatio||1,2);
   canvas.width=Math.floor(view.width*ratio);canvas.height=Math.floor(view.height*ratio);canvas.style.width=Math.floor(view.width)+'px';canvas.style.height=Math.floor(view.height)+'px';
   rendering=p.render({canvasContext:canvas.getContext('2d'),viewport:view,transform:[ratio,0,0,ratio,0,0]});await rendering.promise;
   if(token!==sequence||destroyed)return;canvas.setAttribute('aria-label','Страница '+current+' из '+pdf.numPages);container.dataset.renderedPage=String(current);status.textContent='Страница '+current+' из '+pdf.numPages;onPage(current);sheet.scrollTop=0;
  }catch(error){if(error.name!=='RenderingCancelledException'&&!destroyed)status.textContent='Не удалось показать страницу. Можно скачать PDF и открыть на компьютере.';}
 }
 buttons[0].onclick=()=>{current--;render();};buttons[1].onclick=()=>{current++;render();};buttons[2].onclick=()=>{zoom=Math.max(.5,zoom-.25);render();};buttons[3].onclick=()=>{zoom=Math.min(3,zoom+.25);render();};input.onchange=()=>{current=Number(input.value)||1;render();};
 const controller=new AbortController();
 const dispose=()=>{destroyed=true;sequence++;controller.abort();rendering?.cancel();loading?.destroy();};container.pdfDispose=dispose;
 try{const response=await fetch(source.href,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
  if(response.status===401){
   status.textContent='Сессия завершилась. Войдите в новой вкладке и повторите. Ответы останутся здесь.';
   const login=document.createElement('a');login.textContent='Войти';login.target='_blank';login.rel='noopener';
   login.href='/login?returnTo='+encodeURIComponent('/assessment-review?dealId='+source.pathname.split('/')[3]);
   const retry=document.createElement('button');retry.type='button';retry.textContent='Повторить';
   retry.onclick=()=>{dispose();mount(container,{url,page:current,onPage});};
   const actions=document.createElement('div');actions.className='pdf-tools';actions.append(login,retry);status.after(actions);sheet.hidden=true;return dispose;
  }
  if(!response.ok)throw Error('PDF недоступен. Проверьте вход и доступ к клиенту.');
  const bytes=new Uint8Array(await response.arrayBuffer());if(destroyed)return dispose;
  loading=getDocument({data:bytes,cMapUrl:'/pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf-assets/standard_fonts/',wasmUrl:'/pdf-assets/wasm/',isEvalSupported:false,useSystemFonts:true});pdf=await loading.promise;if(destroyed)return dispose;
  input.max=pdf.numPages;container.querySelector('.pdf-total').textContent='из '+pdf.numPages;await render();
 }catch(error){if(!destroyed)status.textContent=error.name==='PasswordException'?'PDF защищён паролем. Откройте исходный файл на компьютере.':'Не удалось открыть PDF. Проверьте вход или скачайте файл.';}
 return dispose;
}
