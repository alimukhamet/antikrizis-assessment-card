/* Native file inputs keep their original upload path; edits never touch Bitrix. */
(()=>{
 const $=id=>document.getElementById(id),locked=()=>Boolean($('contractBtn')?.dataset.busy||$('docsBtn')?.dataset.busy);
 const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const groups=[...document.querySelectorAll('.doc-item input[type=file]')].map(input=>{const list=make('div',null,'file-selection-list');input.after(list);return{input,list,signature:null};});
 function setFiles(input,files){
  if(!files.length){input.value='';return true;}
  try{const data=new DataTransfer();files.forEach(file=>data.items.add(file));input.files=data.files;return true;}
  catch{toast('Не удалось изменить выбор. Выберите файлы заново.',false);return false;}
 }
 function changed(input,removed){
  if(input.id==='docEds'){$('docEdsPassword').value='';setEdsPasswordVisibility(false);}
  if(typeof activePreviewFile!=='undefined'&&activePreviewFile===removed)closeFilePreview();
  input.dispatchEvent(new Event('change',{bubbles:true}));onChange();
 }
 function remove(input,file){
  if(locked())return;const before=[...input.files];if(!before.includes(file))return;
  if(setFiles(input,before.filter(item=>item!==file)))changed(input,file);
 }
 function replace(input,file){
  if(locked())return;const before=[...input.files],deal=$('dealId').value,picker=make('input');picker.type='file';picker.accept=input.accept;
  picker.onchange=()=>{
   const next=picker.files[0],current=[...input.files];
   if(!next||locked()||$('dealId').value!==deal||current.length!==before.length||current.some((item,i)=>item!==before[i]))return;
   if(setFiles(input,before.map(item=>item===file?next:item)))changed(input,file);
  };picker.click();
 }
 function refresh(){
  const disabled=locked();
  for(const group of groups){
   const files=[...group.input.files],signature=JSON.stringify(files.map(file=>[file.name,file.size,file.lastModified]));
   // Rebuild after every selection event even for the same filename: callbacks use File identity.
   if(group.signature!==signature){group.signature=signature;group.list.replaceChildren();
    for(const file of files){const row=make('div',null,'file-selection-row'),actions=make('div',null,'file-selection-actions');
     for(const [text,fn]of [['Заменить',replace],['Убрать',remove]]){const b=make('button',text,'btn btn-ghost');b.type='button';b.setAttribute('aria-label',text+' '+file.name);b.onclick=()=>fn(group.input,file);actions.append(b);}
     row.append(make('span',file.name,'file-selection-name'),actions);group.list.append(row);
    }
   }
   group.list.hidden=!files.length;group.list.querySelectorAll('button').forEach(e=>e.disabled=disabled);
  }
  document.querySelectorAll('#batchRows .batch-remove').forEach(e=>e.disabled=disabled);
 }
 for(const group of groups)group.input.addEventListener('change',()=>{group.signature=null;refresh();});
 const previous=onChange;onChange=function(){previous();refresh();};
 for(const id of ['contractBtn','docsBtn'])new MutationObserver(refresh).observe($(id),{attributes:true,attributeFilter:['data-busy']});
 refresh();
})();
