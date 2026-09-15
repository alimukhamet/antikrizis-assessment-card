(()=>{
 const normalize=value=>String(value||'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
 const format=value=>{const raw=normalize(value);if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return String(value||'');const [integer,fraction='']=raw.split('.'),grouped=integer.replace(/\B(?=(\d{3})+(?!\d))/g,' ');return fraction&&Number(fraction)!==0?grouped+','+fraction:grouped;};
 class MoneyInput extends HTMLElement{
  constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<style>:host{display:block}.box{position:relative}input{box-sizing:border-box;width:100%;min-height:40px;padding:9px 38px 9px 11px;border:1px solid #b8c5bc;border-radius:7px;background:#fff;color:#21392c;font:inherit;font-size:16px;line-height:1.4}input:focus{outline:3px solid #a27725;outline-offset:3px}.currency{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#5c6e61;pointer-events:none}</style><div class="box"><input type="text" inputmode="decimal"><span class="currency">₸</span></div>';this.editor=this.shadowRoot.querySelector('input');
  }
  connectedCallback(){if(!this.source||this.ready)return;this.ready=true;const field=this.source.closest('.field'),label=field?.querySelector('label.lbl'),name=label?.textContent.replace('*','').trim()||'Сумма';this.editor.setAttribute('aria-label',name);this.source.classList.add('money-native');this.source.tabIndex=-1;this.source.setAttribute('aria-hidden','true');
   const sync=()=>{if(!this.editing)this.editor.value=format(this.source.value);this.editor.setAttribute('aria-invalid',String(!this.source.checkValidity()));};
   const write=final=>{const raw=normalize(this.editor.value),partial=/^\d*(?:\.\d{0,2})?$/.test(raw),complete=/^\d+(?:\.\d{1,2})?$/.test(raw);if(!raw){this.source.value='';this.source.setCustomValidity('');}else if(partial&&complete){this.source.value=raw;this.source.setCustomValidity('');}else this.source.setCustomValidity('Введите сумму цифрами, не более двух знаков после запятой.');this.editing=true;this.source.dispatchEvent(new Event(final?'change':'input',{bubbles:true}));this.editing=false;if(final&&this.source.checkValidity())this.editor.value=format(this.source.value);sync();};
   this.source.addEventListener('input',sync);this.source.addEventListener('change',sync);this.source.addEventListener('focus',()=>this.editor.focus());this.source.addEventListener('invalid',()=>{this.editor.setCustomValidity(this.source.validationMessage);this.editor.reportValidity();});this.editor.addEventListener('focus',()=>{this.editor.setCustomValidity('');});this.editor.addEventListener('input',()=>write(false));this.editor.addEventListener('blur',()=>write(true));sync();
  }
 }
 customElements.define('money-input',MoneyInput);
 function scan(root=document){for(const source of root.querySelectorAll?.('input[type="number"]')||[]){if(source.classList.contains('money-native')||source.nextElementSibling?.tagName==='MONEY-INPUT')continue;if(!source.closest('.field')?.querySelector('label.lbl')?.textContent.includes('₸'))continue;const control=document.createElement('money-input');control.source=source;source.after(control);}}
 scan();new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node);}).observe(document.getElementById('questionnaireStep'),{childList:true,subtree:true});
 window.MoneyInput={format,scan};
})();
